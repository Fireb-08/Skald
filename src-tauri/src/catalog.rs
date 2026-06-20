// catalog.rs — local library catalog backed by SQLite (rusqlite).
// (Local Library & Split Libraries roadmap, Phase 2.)
//
// Stores local libraries and their scanned items so a folder on disk becomes a
// first-class library that lists alongside ABS libraries in the switcher. Items
// are stored as the same ABS-shaped LibraryItem JSON the scanner emits, so the
// frontend renders them with no special-casing.
//
// Each call opens its own connection (SQLite open is cheap for a local file),
// which keeps every catalog function self-contained and safe to run inside
// `spawn_blocking`. Future phases add progress/sessions/bookmarks/collections/
// playlists tables via additional CREATE TABLE IF NOT EXISTS statements here.

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::path::PathBuf;

use crate::{ingest, scanner};
use std::path::Path;

// Managed subfolders created inside every local library root. Organized books
// live under Audiobooks/Author/Series/Title; Staging is the intake inbox;
// Unidentified is the quarantine; Podcasts is reserved for future local podcasts.
const STAGING_DIR: &str = "Staging";
const UNIDENTIFIED_DIR: &str = "Unidentified";
const AUDIOBOOKS_DIR: &str = "Audiobooks";
const PODCASTS_DIR: &str = "Podcasts";

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// `<data_local>/Skald/catalog.db` — sibling to the downloads directory.
fn db_path() -> Result<PathBuf, String> {
    directories::ProjectDirs::from("com", "skald", "Skald")
        .map(|d| d.data_local_dir().join("catalog.db"))
        .ok_or_else(|| "Could not resolve catalog path".to_string())
}

/// Open the catalog DB, creating the parent dir and schema on first use.
fn open() -> Result<Connection, String> {
    let path = db_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create catalog dir: {e}"))?;
    }
    let conn = Connection::open(&path).map_err(|e| format!("open catalog: {e}"))?;
    init_schema(&conn)?;
    Ok(conn)
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA busy_timeout=5000;
         CREATE TABLE IF NOT EXISTS libraries (
            id                TEXT PRIMARY KEY,
            name              TEXT NOT NULL,
            media_type        TEXT NOT NULL DEFAULT 'book',
            root_path         TEXT NOT NULL,
            staging_path      TEXT,
            unidentified_path TEXT,
            organize_mode     TEXT NOT NULL DEFAULT 'copy',
            region            TEXT,
            created_at        INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS items (
            id          TEXT PRIMARY KEY,
            library_id  TEXT NOT NULL,
            source_path TEXT,
            item_json   TEXT NOT NULL,
            confidence  INTEGER NOT NULL DEFAULT 0,
            identified  INTEGER NOT NULL DEFAULT 0,
            added_at    INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_items_library ON items(library_id);
         CREATE TABLE IF NOT EXISTS progress (
            item_id      TEXT PRIMARY KEY,
            library_id   TEXT NOT NULL DEFAULT '',
            -- Quoted: current_time collides with the SQLite CURRENT_TIME keyword,
            -- so it must be quoted as an identifier wherever it appears in SQL.
            \"current_time\" REAL NOT NULL DEFAULT 0,
            duration     REAL NOT NULL DEFAULT 0,
            is_finished  INTEGER NOT NULL DEFAULT 0,
            updated_at   INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_progress_library ON progress(library_id);
         CREATE TABLE IF NOT EXISTS bookmarks (
            id           TEXT PRIMARY KEY,
            item_id      TEXT NOT NULL,
            title        TEXT NOT NULL DEFAULT '',
            time         REAL NOT NULL DEFAULT 0,
            created_at   INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_bookmarks_item ON bookmarks(item_id);",
    )
    .map_err(|e| format!("init schema: {e}"))?;

    // One-time migration: a book path must be unique within a library. Earlier
    // builds enforced uniqueness only on the random `id`, so overlapping reconciles
    // could insert two rows for the same folder (duplicate shelf entries). Dedupe
    // any such rows (keep the oldest), then add the unique index so it can't recur.
    let has_path_idx = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_items_path'",
            [],
            |_| Ok(()),
        )
        .optional()
        .map_err(|e| format!("path index check: {e}"))?
        .is_some();
    if !has_path_idx {
        conn.execute_batch(
            "DELETE FROM items WHERE rowid NOT IN (
                 SELECT MIN(rowid) FROM items GROUP BY library_id, source_path
             );
             CREATE UNIQUE INDEX idx_items_path ON items(library_id, source_path);",
        )
        .map_err(|e| format!("items dedupe + unique index: {e}"))?;
    }
    Ok(())
}

/// Deterministic id from the root path so re-creating the same library is idempotent.
fn stable_lib_id(root_path: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    root_path.hash(&mut h);
    format!("local_lib_{:016x}", h.finish())
}

/// Build the frontend-facing Library JSON for a local library row. `source:
/// "local"` is the routing tag the frontend branches on; the other fields keep
/// the shape parity the existing `Library` interface expects.
fn library_json(
    id: &str,
    name: &str,
    media_type: &str,
    root_path: &str,
    staging_path: Option<&str>,
    organize_mode: &str,
    created_at: i64,
) -> Value {
    json!({
        "id": id,
        "name": name,
        "mediaType": media_type,
        "source": "local",
        "icon": Value::Null,
        "provider": Value::Null,
        "displayOrder": Value::Null,
        "folders": [ { "id": Value::Null, "fullPath": root_path, "libraryId": id, "addedAt": Value::Null } ],
        "settings": Value::Null,
        "lastScan": Value::Null,
        "createdAt": created_at,
        "lastUpdate": Value::Null,
        // Local-only config the ingest UI reads/writes.
        "stagingPath": staging_path,
        "organizeMode": organize_mode,
    })
}

// SELECT column list shared by get_library / list_libraries so the row→JSON
// mapping below stays in lockstep with it.
const LIB_COLS: &str = "id, name, media_type, root_path, staging_path, organize_mode, created_at";

fn row_to_library(r: &rusqlite::Row) -> rusqlite::Result<Value> {
    let staging: Option<String> = r.get(4)?;
    Ok(library_json(
        &r.get::<_, String>(0)?,
        &r.get::<_, String>(1)?,
        &r.get::<_, String>(2)?,
        &r.get::<_, String>(3)?,
        staging.as_deref(),
        &r.get::<_, String>(5)?,
        r.get::<_, i64>(6)?,
    ))
}

fn get_library(conn: &Connection, id: &str) -> Result<Value, String> {
    conn.query_row(
        &format!("SELECT {LIB_COLS} FROM libraries WHERE id = ?1"),
        params![id],
        row_to_library,
    )
    .map_err(|e| format!("get library: {e}"))
}

/// Create a managed local library: makes `<parent_path>/<name>/` on disk plus its
/// `staging/` (import inbox) and `_Unidentified/` (quarantine) subfolders, and
/// records it with staging pre-configured. Idempotent — re-creating the same path
/// returns the existing row. (Folder name is sanitized for the filesystem.)
pub fn create_library(name: &str, parent_path: &str) -> Result<Value, String> {
    let conn = open()?;
    let root = Path::new(parent_path).join(ingest::sanitize_component(name));
    let staging = root.join(STAGING_DIR);
    std::fs::create_dir_all(&staging).map_err(|e| format!("create library/staging dir: {e}"))?;
    std::fs::create_dir_all(root.join(UNIDENTIFIED_DIR)).map_err(|e| format!("create quarantine dir: {e}"))?;
    std::fs::create_dir_all(root.join(AUDIOBOOKS_DIR)).map_err(|e| format!("create audiobooks dir: {e}"))?;
    std::fs::create_dir_all(root.join(PODCASTS_DIR)).map_err(|e| format!("create podcasts dir: {e}"))?;

    let root_str = root.to_string_lossy().into_owned();
    let staging_str = staging.to_string_lossy().into_owned();
    let id = stable_lib_id(&root_str);
    conn.execute(
        "INSERT OR IGNORE INTO libraries (id, name, media_type, root_path, staging_path, organize_mode, created_at)
         VALUES (?1, ?2, 'book', ?3, ?4, 'copy', ?5)",
        params![id, name, root_str, staging_str, now_ms()],
    )
    .map_err(|e| format!("create library: {e}"))?;
    log::info!(target: "skald::library", "catalog: create library id={id} root={root_str}");
    get_library(&conn, &id)
}

pub fn list_libraries() -> Result<Vec<Value>, String> {
    let conn = open()?;
    let mut stmt = conn
        .prepare(&format!("SELECT {LIB_COLS} FROM libraries ORDER BY name"))
        .map_err(|e| format!("list libraries: {e}"))?;
    let rows = stmt
        .query_map([], row_to_library)
        .map_err(|e| format!("list libraries query: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("list libraries collect: {e}"))
}

/// Update a local library's ingest config (staging folder, copy/move mode).
/// Either field is optional; only provided fields are written.
pub fn set_config(
    library_id: &str,
    staging_path: Option<&str>,
    organize_mode: Option<&str>,
) -> Result<Value, String> {
    let conn = open()?;
    if let Some(sp) = staging_path {
        conn.execute(
            "UPDATE libraries SET staging_path = ?1 WHERE id = ?2",
            params![sp, library_id],
        )
        .map_err(|e| format!("set staging_path: {e}"))?;
    }
    if let Some(om) = organize_mode {
        conn.execute(
            "UPDATE libraries SET organize_mode = ?1 WHERE id = ?2",
            params![om, library_id],
        )
        .map_err(|e| format!("set organize_mode: {e}"))?;
    }
    get_library(&conn, library_id)
}

pub fn delete_library(id: &str) -> Result<(), String> {
    let conn = open()?;
    conn.execute("DELETE FROM items WHERE library_id = ?1", params![id])
        .map_err(|e| format!("delete library items: {e}"))?;
    conn.execute("DELETE FROM libraries WHERE id = ?1", params![id])
        .map_err(|e| format!("delete library: {e}"))?;
    log::info!(target: "skald::library", "catalog: delete library id={id}");
    Ok(())
}

fn library_root(conn: &Connection, id: &str) -> Result<String, String> {
    conn.query_row(
        "SELECT root_path FROM libraries WHERE id = ?1",
        params![id],
        |r| r.get::<_, String>(0),
    )
    .map_err(|e| format!("library root lookup: {e}"))
}

/// Generate a stable, path-independent item id. Catalog-assigned at first INSERT
/// so a later re-file (which changes the folder path) keeps the same id, and the
/// progress/bookmarks keyed by id survive. Seeded with the source path plus a
/// monotonic counter + wall-clock nanos to avoid collisions within a scan.
fn new_item_id(seed: &str) -> String {
    use std::hash::{Hash, Hasher};
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut h = std::collections::hash_map::DefaultHasher::new();
    (seed, nanos, n).hash(&mut h);
    format!("local_{:016x}", h.finish())
}

/// Presence reconcile of a local library against its `Audiobooks/` tree.
///
/// The catalog is the source of truth for metadata, so this NEVER rewrites an
/// existing item's metadata. It only ADDS book folders that aren't catalogued yet
/// (deriving their metadata once, at first discovery) and REMOVES rows whose
/// folder has disappeared (also clearing that item's progress/bookmarks). Rows are
/// matched to disk by `source_path`; a Skald-initiated re-file updates the row's
/// path in the same operation, so it's never seen as a remove+add. Returns the
/// current item count. Blocking — call from `spawn_blocking`.
pub fn scan_library(library_id: &str) -> Result<usize, String> {
    let conn = open()?;
    let root = library_root(&conn, library_id)?;
    // The shelf catalog is everything under Audiobooks/ — Staging/Unidentified/
    // Podcasts are siblings and are scanned (or not) separately.
    let books_root = Path::new(&root).join(AUDIOBOOKS_DIR);
    let scanned = scanner::scan_folder(&books_root.to_string_lossy(), library_id)?;

    // Existing rows keyed by on-disk path.
    let mut existing: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, source_path FROM items WHERE library_id = ?1")
            .map_err(|e| format!("reconcile select: {e}"))?;
        let rows = stmt
            .query_map(params![library_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
            })
            .map_err(|e| format!("reconcile query: {e}"))?;
        for row in rows {
            let (id, sp) = row.map_err(|e| format!("reconcile row: {e}"))?;
            if let Some(sp) = sp {
                existing.insert(sp, id);
            }
        }
    }
    let present: std::collections::HashSet<&str> =
        scanned.iter().map(|s| s.source_path.as_str()).collect();

    let tx = conn.unchecked_transaction().map_err(|e| format!("tx: {e}"))?;
    let now = now_ms();

    // ADD folders not yet catalogued (derive metadata once; catalog assigns id).
    for s in &scanned {
        if existing.contains_key(&s.source_path) {
            continue; // already catalogued — preserve its metadata
        }
        let id = new_item_id(&s.source_path);
        let mut item = s.item.clone();
        if let Some(obj) = item.as_object_mut() {
            obj.insert("id".into(), Value::String(id.clone()));
            obj.insert("ino".into(), Value::String(id.clone()));
        }
        let item_str = serde_json::to_string(&item).map_err(|e| format!("serialize item: {e}"))?;
        // DO NOTHING on a path conflict: if another reconcile already catalogued
        // this folder, keep its row (and metadata) rather than adding a duplicate.
        tx.execute(
            "INSERT INTO items
                (id, library_id, source_path, item_json, confidence, identified, added_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
             ON CONFLICT(library_id, source_path) DO NOTHING",
            params![id, library_id, s.source_path, item_str, s.confidence as i64, s.identified as i64, now],
        )
        .map_err(|e| format!("insert item: {e}"))?;
    }

    // REMOVE rows whose folder is gone; clear their progress/bookmarks too.
    for (sp, id) in &existing {
        if !present.contains(sp.as_str()) {
            tx.execute("DELETE FROM items WHERE id = ?1", params![id]).map_err(|e| format!("del item: {e}"))?;
            tx.execute("DELETE FROM progress WHERE item_id = ?1", params![id]).map_err(|e| format!("del progress: {e}"))?;
            tx.execute("DELETE FROM bookmarks WHERE item_id = ?1", params![id]).map_err(|e| format!("del bookmarks: {e}"))?;
        }
    }

    tx.commit().map_err(|e| format!("commit: {e}"))?;
    let count = conn
        .query_row("SELECT COUNT(*) FROM items WHERE library_id = ?1", params![library_id], |r| r.get::<_, i64>(0))
        .map_err(|e| format!("count: {e}"))? as usize;
    log::info!(target: "skald::library", "catalog: reconciled library {library_id} present={} items={count}", present.len());
    Ok(count)
}

pub fn list_items(library_id: &str) -> Result<Vec<Value>, String> {
    let conn = open()?;
    let mut stmt = conn
        .prepare("SELECT item_json FROM items WHERE library_id = ?1")
        .map_err(|e| format!("list items: {e}"))?;
    let rows = stmt
        .query_map(params![library_id], |r| r.get::<_, String>(0))
        .map_err(|e| format!("list items query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        let s = row.map_err(|e| format!("row: {e}"))?;
        match serde_json::from_str::<Value>(&s) {
            Ok(v) => out.push(v),
            Err(e) => log::warn!(target: "skald::library", "catalog: bad item_json ({e})"),
        }
    }
    Ok(out)
}

// ── Local progress (Phase 4) ──────────────────────────────────────────────────
// Local items have no server, so their playback progress lives here. Shaped as
// the frontend MediaProgress so it merges into the same `mediaProgress` state the
// ABS path populates (Pick-it-up, cover overlays, resume).

fn media_progress_json(item_id: &str, current_time: f64, duration: f64, is_finished: bool, updated_at: i64) -> Value {
    json!({
        "id": item_id,
        "libraryItemId": item_id,
        "episodeId": Value::Null,
        "duration": duration,
        "progress": if duration > 0.0 { current_time / duration } else { 0.0 },
        "currentTime": current_time,
        "isFinished": is_finished,
        "lastUpdate": updated_at,
    })
}

/// Upsert local playback progress for an item. `library_id` is resolved from the
/// items table so callers (e.g. the playback tick) only need the item id.
pub fn set_progress(item_id: &str, current_time: f64, duration: f64, is_finished: bool) -> Result<(), String> {
    let conn = open()?;
    let library_id: String = conn
        .query_row("SELECT library_id FROM items WHERE id = ?1", params![item_id], |r| r.get(0))
        .optional()
        .map_err(|e| format!("progress lib lookup: {e}"))?
        .unwrap_or_default();
    conn.execute(
        // "current_time" is quoted everywhere it appears as an identifier: bare,
        // SQLite parses current_time as the CURRENT_TIME keyword (wall-clock TEXT),
        // not this column. The write column-list happens to be safe, but we quote
        // it here too so the column name is unambiguous across all statements.
        "INSERT OR REPLACE INTO progress
            (item_id, library_id, \"current_time\", duration, is_finished, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![item_id, library_id, current_time, duration, is_finished as i64, now_ms()],
    )
    .map_err(|e| format!("set progress: {e}"))?;
    Ok(())
}

pub fn get_progress(item_id: &str) -> Result<Option<Value>, String> {
    let conn = open()?;
    conn.query_row(
        // "current_time" MUST be quoted — unquoted it resolves to the CURRENT_TIME
        // keyword (wall-clock TEXT), failing the f64 read below and breaking resume.
        "SELECT \"current_time\", duration, is_finished, updated_at FROM progress WHERE item_id = ?1",
        params![item_id],
        |r| Ok(media_progress_json(item_id, r.get::<_, f64>(0)?, r.get::<_, f64>(1)?, r.get::<_, i64>(2)? != 0, r.get::<_, i64>(3)?)),
    )
    .optional()
    .map_err(|e| format!("get progress: {e}"))
}

pub fn list_progress(library_id: &str) -> Result<Vec<Value>, String> {
    let conn = open()?;
    let mut stmt = conn
        // "current_time" MUST be quoted — unquoted it resolves to the CURRENT_TIME
        // keyword (wall-clock TEXT), failing the f64 read below so list_progress
        // errors out and Pick-it-up shows nothing for local libraries.
        .prepare("SELECT item_id, \"current_time\", duration, is_finished, updated_at FROM progress WHERE library_id = ?1")
        .map_err(|e| format!("list progress: {e}"))?;
    let rows = stmt
        .query_map(params![library_id], |r| {
            let id: String = r.get(0)?;
            Ok(media_progress_json(&id, r.get::<_, f64>(1)?, r.get::<_, f64>(2)?, r.get::<_, i64>(3)? != 0, r.get::<_, i64>(4)?))
        })
        .map_err(|e| format!("list progress query: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("list progress collect: {e}"))
}

// ── Local bookmarks (Phase 4) ─────────────────────────────────────────────────

fn bookmark_json(id: &str, item_id: &str, title: &str, time: f64) -> Value {
    json!({ "id": id, "libraryItemId": item_id, "title": title, "time": time })
}

pub fn add_bookmark(item_id: &str, title: &str, time: f64) -> Result<Value, String> {
    use std::hash::{Hash, Hasher};
    let conn = open()?;
    let mut h = std::collections::hash_map::DefaultHasher::new();
    format!("{item_id}:{time}:{}", now_ms()).hash(&mut h);
    let id = format!("bm_{:016x}", h.finish());
    conn.execute(
        "INSERT OR REPLACE INTO bookmarks (id, item_id, title, time, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, item_id, title, time, now_ms()],
    )
    .map_err(|e| format!("add bookmark: {e}"))?;
    Ok(bookmark_json(&id, item_id, title, time))
}

pub fn list_bookmarks(item_id: &str) -> Result<Vec<Value>, String> {
    let conn = open()?;
    let mut stmt = conn
        .prepare("SELECT id, item_id, title, time FROM bookmarks WHERE item_id = ?1 ORDER BY time")
        .map_err(|e| format!("list bookmarks: {e}"))?;
    let rows = stmt
        .query_map(params![item_id], |r| {
            Ok(bookmark_json(&r.get::<_, String>(0)?, &r.get::<_, String>(1)?, &r.get::<_, String>(2)?, r.get::<_, f64>(3)?))
        })
        .map_err(|e| format!("list bookmarks query: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("list bookmarks collect: {e}"))
}

pub fn delete_bookmark(id: &str) -> Result<(), String> {
    let conn = open()?;
    conn.execute("DELETE FROM bookmarks WHERE id = ?1", params![id])
        .map_err(|e| format!("delete bookmark: {e}"))?;
    Ok(())
}

/// The on-disk directory of a catalogued item (its book-unit folder), if known.
pub fn get_item_path(item_id: &str) -> Result<Option<String>, String> {
    let conn = open()?;
    conn.query_row(
        "SELECT source_path FROM items WHERE id = ?1",
        params![item_id],
        |r| r.get::<_, Option<String>>(0),
    )
    .optional()
    .map(|o| o.flatten())
    .map_err(|e| format!("get item path: {e}"))
}

/// A local library's ingest-relevant config.
struct LibConfig {
    root_path: String,
    organize_mode: String,
}

fn lib_config(conn: &Connection, id: &str) -> Result<LibConfig, String> {
    conn.query_row(
        "SELECT root_path, organize_mode FROM libraries WHERE id = ?1",
        params![id],
        |r| Ok(LibConfig { root_path: r.get(0)?, organize_mode: r.get(1)? }),
    )
    .map_err(|e| format!("lib config: {e}"))
}

/// Ingest each source path into the library's managed tree (Phase 3).
///
/// For every book unit found under a source: identified books are filed into
/// `<root>/Author/[Series/]Title`; unidentified ones go to `<root>/_Unidentified`.
/// Copy vs. move follows the library's `organize_mode`. After placing everything,
/// the catalog is rebuilt from the managed root (the scanner skips `_Unidentified`,
/// so quarantined books never reach the shelf). Blocking — call from spawn_blocking.
pub fn ingest(library_id: &str, sources: &[String]) -> Result<Vec<ingest::IngestOutcome>, String> {
    let conn = open()?;
    let cfg = lib_config(&conn, library_id)?;
    ingest_sources(library_id, sources, cfg.organize_mode == "move")
}

/// Auto-distribute everything currently in the library's staging folder. Always
/// MOVES so staging empties itself — it is a transient intake zone, not a copy
/// source. Returns an empty result when there is no staging folder / nothing in it.
pub fn ingest_staging(library_id: &str) -> Result<Vec<ingest::IngestOutcome>, String> {
    let conn = open()?;
    let staging: Option<String> = conn
        .query_row(
            "SELECT staging_path FROM libraries WHERE id = ?1",
            params![library_id],
            |r| r.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|e| format!("staging lookup: {e}"))?
        .flatten();
    match staging {
        Some(s) if Path::new(&s).exists() => {
            let outcomes = ingest_sources(library_id, &[s.clone()], true)?;
            // Books were moved out — remove the empty folder skeletons left in Staging.
            ingest::prune_empty_dirs(Path::new(&s));
            Ok(outcomes)
        }
        _ => Ok(Vec::new()),
    }
}

fn ingest_sources(
    library_id: &str,
    sources: &[String],
    move_files: bool,
) -> Result<Vec<ingest::IngestOutcome>, String> {
    let conn = open()?;
    let cfg = lib_config(&conn, library_id)?;
    let root = Path::new(&cfg.root_path);
    let books_root = root.join(AUDIOBOOKS_DIR);
    let unidentified_root = root.join(UNIDENTIFIED_DIR);

    let mut outcomes: Vec<ingest::IngestOutcome> = Vec::new();
    for src in sources {
        let scanned = match scanner::scan_folder(src, library_id) {
            Ok(s) => s,
            Err(e) => {
                outcomes.push(ingest::IngestOutcome {
                    title: src.clone(),
                    outcome: "error".into(),
                    target_path: String::new(),
                    message: e,
                });
                continue;
            }
        };

        for s in &scanned {
            let meta = s.item.get("media").and_then(|m| m.get("metadata"));
            let title = meta
                .and_then(|m| m.get("title"))
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown Title")
                .to_string();
            let author = meta
                .and_then(|m| m.get("authorName"))
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown Author");
            let series = meta
                .and_then(|m| m.get("seriesName"))
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty());

            let source_dir = Path::new(&s.source_path);
            // Confidence gate: a book with both author and title (from tags or a
            // recognisable folder layout) is filed; otherwise it is quarantined.
            let (target, kind) = if s.identified {
                (ingest::unique_dir(ingest::book_target_dir(&books_root, author, series, &title)), "filed")
            } else {
                let name = source_dir.file_name().and_then(|n| n.to_str()).unwrap_or("book");
                (ingest::unique_dir(unidentified_root.join(ingest::sanitize_component(name))), "quarantined")
            };

            match ingest::place_book(source_dir, &target, move_files) {
                Ok(()) => outcomes.push(ingest::IngestOutcome {
                    title,
                    outcome: kind.into(),
                    target_path: target.to_string_lossy().into_owned(),
                    message: String::new(),
                }),
                Err(e) => outcomes.push(ingest::IngestOutcome {
                    title,
                    outcome: "error".into(),
                    target_path: String::new(),
                    message: e,
                }),
            }
        }
    }

    // Rebuild the catalog from the managed root so newly filed books appear.
    scan_library(library_id)?;

    let filed = outcomes.iter().filter(|o| o.outcome == "filed").count();
    let quarantined = outcomes.iter().filter(|o| o.outcome == "quarantined").count();
    log::info!(
        target: "skald::library",
        "catalog: ingest into {library_id} filed={filed} quarantined={quarantined} total={}",
        outcomes.len()
    );
    Ok(outcomes)
}

// ── Unidentified queue + match-apply (Phase 5) ────────────────────────────────

/// List the book units sitting in `<root>/_Unidentified` awaiting a match.
/// Returns ScannedItems (seed metadata + source path) — not catalogued, since
/// quarantined books are deliberately kept off the shelf.
pub fn get_unidentified(library_id: &str) -> Result<Vec<scanner::ScannedItem>, String> {
    let conn = open()?;
    let root = library_root(&conn, library_id)?;
    let un = Path::new(&root).join(UNIDENTIFIED_DIR);
    if !un.exists() {
        return Ok(Vec::new());
    }
    scanner::scan_unidentified(&un.to_string_lossy(), library_id)
}

/// Merge a frontend-supplied metadata `fields` object (all keys optional) into an
/// item's `media.metadata` (and `media.tags`), then return the effective
/// (title, author, series) after the merge — used to decide the canonical folder.
/// Only keys that are present and non-null overwrite; everything else is left as
/// it was, so a partial edit (e.g. just the description) keeps the rest intact.
fn merge_metadata(item: &mut Value, fields: &Value) -> (String, String, Option<String>) {
    let obj = item.as_object_mut().expect("item json is an object");
    let media = obj.entry("media").or_insert_with(|| json!({}));
    let media_obj = media.as_object_mut().expect("media is an object");

    // Tags live at the media level (not inside metadata), mirroring ABS.
    if let Some(tags) = fields.get("tags") {
        if !tags.is_null() {
            media_obj.insert("tags".into(), tags.clone());
        }
    }

    let meta = media_obj.entry("metadata").or_insert_with(|| json!({}));
    let meta_obj = meta.as_object_mut().expect("metadata is an object");

    // The full editable field set the match/edit review screens expose.
    const KEYS: &[&str] = &[
        "title", "subtitle", "authorName", "narratorName", "seriesName", "seriesSequence",
        "publisher", "publishedYear", "language", "isbn", "asin", "description", "genres",
    ];
    for k in KEYS {
        if let Some(v) = fields.get(*k) {
            if !v.is_null() {
                meta_obj.insert((*k).to_string(), v.clone());
            }
        }
    }

    let title = meta_obj.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let author = meta_obj.get("authorName").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let series = meta_obj
        .get("seriesName")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    (title, author, series)
}

/// Apply user-edited metadata to an existing catalogued local item (Match or Edit
/// Metadata). Merges `fields` into the stored item_json, re-files the folder when
/// the title/author/series identity changes (pruning the vacated dirs) and updates
/// the stored path, then marks the item identified. The catalog is the source of
/// truth, so this is the authoritative write — no re-derive from disk. Cover
/// download is done by the async caller. Returns (updated_item_json, target_dir).
pub fn apply_metadata(
    library_id: &str,
    item_id: &str,
    fields: &Value,
    has_cover: bool,
) -> Result<(Value, String), String> {
    let conn = open()?;
    let root = library_root(&conn, library_id)?;
    let books_root = Path::new(&root).join(AUDIOBOOKS_DIR);

    let (item_str, source_path): (String, Option<String>) = conn
        .query_row(
            "SELECT item_json, source_path FROM items WHERE id = ?1 AND library_id = ?2",
            params![item_id, library_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)),
        )
        .map_err(|e| format!("load item: {e}"))?;
    let mut item: Value = serde_json::from_str(&item_str).map_err(|e| format!("parse item: {e}"))?;

    let (title, author, series) = merge_metadata(&mut item, fields);

    // Re-file when the canonical folder differs from the current one.
    let cur_path = source_path.unwrap_or_default();
    let mut new_path = cur_path.clone();
    if !cur_path.is_empty() && !title.trim().is_empty() && !author.trim().is_empty() {
        let desired = ingest::book_target_dir(&books_root, &author, series.as_deref(), &title);
        if !same_dir(&desired, Path::new(&cur_path)) {
            let target = ingest::unique_dir(desired);
            ingest::place_book(Path::new(&cur_path), &target, true)?;
            prune_upwards(Path::new(&cur_path), &books_root);
            new_path = target.to_string_lossy().into_owned();
        }
    }

    if let Some(obj) = item.as_object_mut() {
        obj.insert("localPath".into(), Value::String(new_path.clone()));
        if has_cover {
            obj.insert("hasLocalCover".into(), Value::Bool(true));
        }
    }

    // Write the metadata back into the audio files (the durable store). Best-effort:
    // a locked file (e.g. currently playing) still leaves the catalog updated.
    if let Some(meta) = item.get("media").and_then(|m| m.get("metadata")) {
        if let Err(e) = crate::tone::write_book_tags(Path::new(&new_path), meta) {
            log::warn!(target: "skald::metadata", "apply_metadata: file tag write incomplete: {e}");
        }
    }

    let updated_str = serde_json::to_string(&item).map_err(|e| format!("serialize: {e}"))?;
    conn.execute(
        "UPDATE items SET item_json = ?1, source_path = ?2, identified = 1, confidence = 100, updated_at = ?3 WHERE id = ?4",
        params![updated_str, new_path, now_ms(), item_id],
    )
    .map_err(|e| format!("update item: {e}"))?;
    log::info!(target: "skald::metadata", "apply_metadata {item_id} -> {new_path}");
    Ok((item, new_path))
}

/// File a quarantined (Unidentified) book into `Audiobooks/Author/[Series/]Title`
/// from chosen match metadata, then INSERT a new catalogued item carrying that
/// metadata (catalog-assigned id; metadata not re-derived). Cover download is done
/// by the async caller. Returns (new_item_json, target_dir).
pub fn file_and_insert(
    library_id: &str,
    source_path: &str,
    fields: &Value,
    has_cover: bool,
) -> Result<(Value, String), String> {
    let conn = open()?;
    let root = library_root(&conn, library_id)?;
    let books_root = Path::new(&root).join(AUDIOBOOKS_DIR);

    // Derive a base item from the source (duration/chapters/file list), then
    // overlay the user-chosen metadata on top.
    let mut item = scanner::scan_folder(source_path, library_id)?
        .into_iter()
        .next()
        .map(|s| s.item)
        .unwrap_or_else(|| json!({ "mediaType": "book", "media": { "metadata": {} }, "libraryFiles": [] }));

    let (title, author, series) = merge_metadata(&mut item, fields);
    if title.trim().is_empty() || author.trim().is_empty() {
        return Err("a match needs both a title and an author".into());
    }

    let target = ingest::unique_dir(ingest::book_target_dir(&books_root, &author, series.as_deref(), &title));
    ingest::place_book(Path::new(source_path), &target, true)?;
    let new_path = target.to_string_lossy().into_owned();

    // Write the chosen metadata into the audio files (best-effort).
    if let Some(meta) = item.get("media").and_then(|m| m.get("metadata")) {
        if let Err(e) = crate::tone::write_book_tags(Path::new(&new_path), meta) {
            log::warn!(target: "skald::metadata", "file_and_insert: file tag write incomplete: {e}");
        }
    }

    let id = new_item_id(&new_path);
    if let Some(obj) = item.as_object_mut() {
        obj.insert("id".into(), Value::String(id.clone()));
        obj.insert("ino".into(), Value::String(id.clone()));
        obj.insert("libraryId".into(), Value::String(library_id.to_string()));
        obj.insert("localPath".into(), Value::String(new_path.clone()));
        if has_cover {
            obj.insert("hasLocalCover".into(), Value::Bool(true));
        }
    }
    let item_str = serde_json::to_string(&item).map_err(|e| format!("serialize: {e}"))?;
    conn.execute(
        "INSERT OR REPLACE INTO items
            (id, library_id, source_path, item_json, confidence, identified, added_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 100, 1, ?5, ?5)",
        params![id, library_id, new_path, item_str, now_ms()],
    )
    .map_err(|e| format!("insert item: {e}"))?;
    log::info!(target: "skald::metadata", "file_and_insert {source_path} -> {new_path}");
    Ok((item, new_path))
}

/// Permanently delete a catalogued local item: remove its book folder from disk,
/// drop the catalog row plus its progress/bookmarks, and prune the now-empty
/// parent dirs up to the Audiobooks root. Blocking — call from `spawn_blocking`.
pub fn delete_item(item_id: &str) -> Result<(), String> {
    let conn = open()?;
    let (library_id, source_path): (String, Option<String>) = conn
        .query_row(
            "SELECT library_id, source_path FROM items WHERE id = ?1",
            params![item_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)),
        )
        .map_err(|e| format!("load item for delete: {e}"))?;

    if let Some(sp) = source_path.as_deref() {
        let p = Path::new(sp);
        if p.exists() {
            std::fs::remove_dir_all(p).map_err(|e| format!("remove book dir: {e}"))?;
        }
        // Prune the vacated Author/Series skeleton (stops at the Audiobooks root).
        if let Ok(root) = library_root(&conn, &library_id) {
            let books_root = Path::new(&root).join(AUDIOBOOKS_DIR);
            if let Some(parent) = p.parent() {
                prune_upwards(parent, &books_root);
            }
        }
    }

    conn.execute("DELETE FROM items WHERE id = ?1", params![item_id]).map_err(|e| format!("del item: {e}"))?;
    conn.execute("DELETE FROM progress WHERE item_id = ?1", params![item_id]).map_err(|e| format!("del progress: {e}"))?;
    conn.execute("DELETE FROM bookmarks WHERE item_id = ?1", params![item_id]).map_err(|e| format!("del bookmarks: {e}"))?;
    log::info!(target: "skald::library", "catalog: deleted item {item_id}");
    Ok(())
}

/// True when two paths resolve to the same directory. Canonicalize when both
/// exist (handles separator / case / `.` differences); otherwise fall back to a
/// plain comparison — the desired target won't exist when the identity changed,
/// which correctly reports "not the same".
fn same_dir(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

/// Remove `start` if empty, then walk upward removing empty parents, stopping
/// before `stop_root` (the Audiobooks root is never removed). Used after a
/// re-file to clean up the vacated Author/Series/Title skeleton.
fn prune_upwards(start: &Path, stop_root: &Path) {
    let mut cur = start.to_path_buf();
    while cur.starts_with(stop_root) && cur != *stop_root {
        let empty = std::fs::read_dir(&cur)
            .map(|mut it| it.next().is_none())
            .unwrap_or(false);
        if !empty || std::fs::remove_dir(&cur).is_err() {
            break;
        }
        match cur.parent() {
            Some(p) => cur = p.to_path_buf(),
            None => break,
        }
    }
}
