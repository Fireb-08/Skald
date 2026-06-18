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
            current_time REAL NOT NULL DEFAULT 0,
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
    .map_err(|e| format!("init schema: {e}"))
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

/// Create (or return the existing) local library rooted at `root_path`.
pub fn create_library(name: &str, root_path: &str) -> Result<Value, String> {
    let conn = open()?;
    let id = stable_lib_id(root_path);
    conn.execute(
        "INSERT OR IGNORE INTO libraries (id, name, media_type, root_path, organize_mode, created_at)
         VALUES (?1, ?2, 'book', ?3, 'copy', ?4)",
        params![id, name, root_path, now_ms()],
    )
    .map_err(|e| format!("create library: {e}"))?;
    log::info!(target: "skald::library", "catalog: create library id={id} root={root_path}");
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

/// Full re-scan: clear the library's items, scan its root, store fresh items.
/// Returns the number of items catalogued. Blocking — call from `spawn_blocking`.
pub fn scan_library(library_id: &str) -> Result<usize, String> {
    let conn = open()?;
    let root = library_root(&conn, library_id)?;
    let scanned = scanner::scan_folder(&root, library_id)?;

    // Single transaction so a re-scan is atomic (no window where the library
    // appears empty mid-rebuild).
    let tx = conn.unchecked_transaction().map_err(|e| format!("tx: {e}"))?;
    tx.execute("DELETE FROM items WHERE library_id = ?1", params![library_id])
        .map_err(|e| format!("clear items: {e}"))?;
    let now = now_ms();
    for s in &scanned {
        let item_id = s.item.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let item_str = serde_json::to_string(&s.item).map_err(|e| format!("serialize item: {e}"))?;
        tx.execute(
            "INSERT OR REPLACE INTO items
                (id, library_id, source_path, item_json, confidence, identified, added_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![item_id, library_id, s.source_path, item_str, s.confidence as i64, s.identified as i64, now],
        )
        .map_err(|e| format!("insert item: {e}"))?;
    }
    tx.commit().map_err(|e| format!("commit: {e}"))?;
    log::info!(target: "skald::library", "catalog: scanned library {library_id} items={}", scanned.len());
    Ok(scanned.len())
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
        "INSERT OR REPLACE INTO progress
            (item_id, library_id, current_time, duration, is_finished, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![item_id, library_id, current_time, duration, is_finished as i64, now_ms()],
    )
    .map_err(|e| format!("set progress: {e}"))?;
    Ok(())
}

pub fn get_progress(item_id: &str) -> Result<Option<Value>, String> {
    let conn = open()?;
    conn.query_row(
        "SELECT current_time, duration, is_finished, updated_at FROM progress WHERE item_id = ?1",
        params![item_id],
        |r| Ok(media_progress_json(item_id, r.get::<_, f64>(0)?, r.get::<_, f64>(1)?, r.get::<_, i64>(2)? != 0, r.get::<_, i64>(3)?)),
    )
    .optional()
    .map_err(|e| format!("get progress: {e}"))
}

pub fn list_progress(library_id: &str) -> Result<Vec<Value>, String> {
    let conn = open()?;
    let mut stmt = conn
        .prepare("SELECT item_id, current_time, duration, is_finished, updated_at FROM progress WHERE library_id = ?1")
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
    let root = Path::new(&cfg.root_path);
    let unidentified_root = root.join("_Unidentified");
    let move_files = cfg.organize_mode == "move";

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
                (ingest::unique_dir(ingest::book_target_dir(root, author, series, &title)), "filed")
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
    let un = Path::new(&root).join("_Unidentified");
    if !un.exists() {
        return Ok(Vec::new());
    }
    scanner::scan_unidentified(&un.to_string_lossy(), library_id)
}

/// Move a matched book out of `_Unidentified` into `<root>/Author/[Series/]Title`
/// and return the new directory. The chosen author/title/series drive the folder
/// names, so the subsequent catalog re-scan derives the right metadata via the
/// folder-fallback path even when the files carry no tags. Cover download and the
/// re-scan are done by the caller (async command).
pub fn file_matched(
    library_id: &str,
    source_path: &str,
    title: &str,
    author: &str,
    series: Option<&str>,
) -> Result<String, String> {
    let conn = open()?;
    let root = library_root(&conn, library_id)?;
    let target = ingest::unique_dir(ingest::book_target_dir(Path::new(&root), author, series, title));
    // Move (not copy) — the book is leaving the quarantine folder.
    ingest::place_book(Path::new(source_path), &target, true)?;
    log::info!(target: "skald::metadata", "match filed {source_path} -> {}", target.display());
    Ok(target.to_string_lossy().into_owned())
}
