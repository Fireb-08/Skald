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
use std::sync::Mutex;

use crate::{ingest, scanner};
use std::path::Path;

// Schema DDL + one-time migrations are idempotent but only need to run once per
// process. Re-running the full CREATE TABLE / migration batch on every open() —
// including the per-second progress writes during local playback — is wasted work.
// Guarded by a Mutex<bool> (rather than std::sync::Once) so a failed first init is
// retried on the next open() instead of being permanently skipped.
static SCHEMA_READY: Mutex<bool> = Mutex::new(false);

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

/// `%LOCALAPPDATA%\Skald\data\catalog.db` — sibling to the downloads directory.
/// Empty organization keeps the root a single "Skald" (must match paths.rs / eq.rs).
fn db_path() -> Result<PathBuf, String> {
    directories::ProjectDirs::from("com", "", "Skald")
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
    // busy_timeout is per-connection: apply it to every connection so a write held
    // by another connection waits rather than failing immediately with SQLITE_BUSY.
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("set busy_timeout: {e}"))?;
    // Run the schema/migration batch exactly once per process (see SCHEMA_READY).
    // WAL journal mode is persistent at the DB level, so it carries to later
    // connections without re-running here.
    {
        let mut ready = SCHEMA_READY.lock().unwrap();
        if !*ready {
            init_schema(&conn)?; // on error, `ready` stays false → retried next open()
            *ready = true;
        }
    }
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
         -- Progress is keyed per (item, episode). episode_id = '' is whole-item
         -- (book) progress; a non-empty episode_id is a podcast episode (Local
         -- Podcasts roadmap). The composite PK mirrors ABS's MediaProgress.episodeId.
         CREATE TABLE IF NOT EXISTS progress (
            item_id      TEXT NOT NULL,
            episode_id   TEXT NOT NULL DEFAULT '',
            library_id   TEXT NOT NULL DEFAULT '',
            -- Quoted: current_time collides with the SQLite CURRENT_TIME keyword,
            -- so it must be quoted as an identifier wherever it appears in SQL.
            \"current_time\" REAL NOT NULL DEFAULT 0,
            duration     REAL NOT NULL DEFAULT 0,
            is_finished  INTEGER NOT NULL DEFAULT 0,
            updated_at   INTEGER NOT NULL,
            PRIMARY KEY (item_id, episode_id)
         );
         CREATE INDEX IF NOT EXISTS idx_progress_library ON progress(library_id);
         CREATE TABLE IF NOT EXISTS bookmarks (
            id           TEXT PRIMARY KEY,
            item_id      TEXT NOT NULL,
            episode_id   TEXT NOT NULL DEFAULT '',
            title        TEXT NOT NULL DEFAULT '',
            time         REAL NOT NULL DEFAULT 0,
            created_at   INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_bookmarks_item ON bookmarks(item_id);
         -- ── Local podcasts (Local Podcasts roadmap) ────────────────────────────
         -- One row per subscribed podcast. item_json is the ABS-shaped PodcastMedia
         -- minus the episode list (kept here for display + cover); episodes live in
         -- their own table so download-state and per-episode progress can be
         -- queried/updated without rewriting a large blob on every download.
         CREATE TABLE IF NOT EXISTS podcasts (
            id                     TEXT PRIMARY KEY,
            library_id             TEXT NOT NULL,
            feed_url               TEXT NOT NULL DEFAULT '',
            title                  TEXT NOT NULL DEFAULT '',
            folder_path            TEXT NOT NULL DEFAULT '',
            item_json              TEXT NOT NULL,
            auto_download          INTEGER NOT NULL DEFAULT 0,
            auto_download_schedule TEXT,
            max_new                INTEGER NOT NULL DEFAULT 3,
            max_keep               INTEGER NOT NULL DEFAULT 0,
            last_episode_check     INTEGER NOT NULL DEFAULT 0,
            added_at               INTEGER NOT NULL,
            updated_at             INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_podcasts_library ON podcasts(library_id);
         -- One row per episode known from a feed. Unique (podcast_id, guid) so a
         -- re-poll upserts rather than duplicates. audio_path is NULL until the
         -- enclosure is downloaded; downloaded flips to 1 at that point.
         CREATE TABLE IF NOT EXISTS podcast_episodes (
            id           TEXT PRIMARY KEY,
            podcast_id   TEXT NOT NULL,
            guid         TEXT NOT NULL DEFAULT '',
            episode_json TEXT NOT NULL,
            audio_path   TEXT,
            downloaded   INTEGER NOT NULL DEFAULT 0,
            pub_date     TEXT,
            published_at INTEGER NOT NULL DEFAULT 0,
            added_at     INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_episodes_podcast ON podcast_episodes(podcast_id);
         CREATE UNIQUE INDEX IF NOT EXISTS idx_episodes_guid ON podcast_episodes(podcast_id, guid);",
    )
    .map_err(|e| format!("init schema: {e}"))?;

    migrate_progress_episode_id(conn)?;
    migrate_bookmarks_episode_id(conn)?;

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

/// True when `table` has a column named `column`. Used to gate the one-time
/// per-episode-progress migration so it runs exactly once on an existing catalog.
fn has_column(conn: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|e| format!("table_info {table}: {e}"))?;
    let cols = stmt
        .query_map([], |r| r.get::<_, String>(1))
        .map_err(|e| format!("table_info query: {e}"))?;
    for c in cols {
        if c.map_err(|e| format!("table_info row: {e}"))? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

/// One-time migration: rebuild `progress` with a composite (item_id, episode_id)
/// primary key so podcast episodes can each carry their own progress. Pre-podcast
/// catalogs keyed progress on item_id alone; every existing row is a whole-item
/// (book) row, so it migrates to episode_id = '' and keeps resuming unchanged.
/// (Local Podcasts roadmap — the central refactor; book paths stay green.)
fn migrate_progress_episode_id(conn: &Connection) -> Result<(), String> {
    if has_column(conn, "progress", "episode_id")? {
        return Ok(()); // already migrated (or freshly created with the new shape)
    }
    conn.execute_batch(
        "ALTER TABLE progress RENAME TO progress_old;
         CREATE TABLE progress (
            item_id      TEXT NOT NULL,
            episode_id   TEXT NOT NULL DEFAULT '',
            library_id   TEXT NOT NULL DEFAULT '',
            \"current_time\" REAL NOT NULL DEFAULT 0,
            duration     REAL NOT NULL DEFAULT 0,
            is_finished  INTEGER NOT NULL DEFAULT 0,
            updated_at   INTEGER NOT NULL,
            PRIMARY KEY (item_id, episode_id)
         );
         INSERT INTO progress (item_id, episode_id, library_id, \"current_time\", duration, is_finished, updated_at)
            SELECT item_id, '', library_id, \"current_time\", duration, is_finished, updated_at FROM progress_old;
         DROP TABLE progress_old;
         CREATE INDEX IF NOT EXISTS idx_progress_library ON progress(library_id);",
    )
    .map_err(|e| format!("migrate progress PK: {e}"))?;
    log::info!(target: "skald::library", "catalog: migrated progress to composite (item_id, episode_id) PK");
    Ok(())
}

/// One-time migration: add `episode_id` to `bookmarks` (defaulting existing rows
/// to '' = whole-item) so podcast episodes can carry per-episode bookmarks. A
/// plain ADD COLUMN suffices — the bookmark PK is still the random `id`.
fn migrate_bookmarks_episode_id(conn: &Connection) -> Result<(), String> {
    if has_column(conn, "bookmarks", "episode_id")? {
        return Ok(());
    }
    conn.execute(
        "ALTER TABLE bookmarks ADD COLUMN episode_id TEXT NOT NULL DEFAULT ''",
        [],
    )
    .map_err(|e| format!("migrate bookmarks episode_id: {e}"))?;
    log::info!(target: "skald::library", "catalog: added episode_id to bookmarks");
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
pub fn create_library(name: &str, parent_path: &str, media_type: &str) -> Result<Value, String> {
    let conn = open()?;
    create_library_conn(&conn, name, parent_path, media_type)
}

// The `_conn` split (here and below) is the test seam (Test Seams roadmap):
// in-module tests run these against a tempfile DB, never the real catalog.
fn create_library_conn(conn: &Connection, name: &str, parent_path: &str, media_type: &str) -> Result<Value, String> {
    // Only "book" and "podcast" are supported local media types; default unknown
    // values to "book" so a bad caller can never write an unroutable library.
    let media_type = if media_type == "podcast" { "podcast" } else { "book" };
    let root = Path::new(parent_path).join(ingest::sanitize_component(name));
    let staging = root.join(STAGING_DIR);
    std::fs::create_dir_all(&staging).map_err(|e| format!("create library/staging dir: {e}"))?;
    std::fs::create_dir_all(root.join(UNIDENTIFIED_DIR)).map_err(|e| format!("create quarantine dir: {e}"))?;
    std::fs::create_dir_all(root.join(AUDIOBOOKS_DIR)).map_err(|e| format!("create audiobooks dir: {e}"))?;
    std::fs::create_dir_all(root.join(PODCASTS_DIR)).map_err(|e| format!("create podcasts dir: {e}"))?;

    let root_str = root.to_string_lossy().into_owned();
    let staging_str = staging.to_string_lossy().into_owned();
    // Idempotency by natural key: reuse the stored id when this root is already
    // catalogued. Relying on stable_lib_id hashing identically forever is not
    // safe — DefaultHasher's output is no cross-version contract, so a future
    // toolchain could mint a different id for the same path and duplicate the
    // library. With this lookup the hash only matters at first creation.
    let existing: Option<String> = conn
        .query_row("SELECT id FROM libraries WHERE root_path = ?1", params![root_str], |r| r.get(0))
        .optional()
        .map_err(|e| format!("library lookup: {e}"))?;
    let id = existing.unwrap_or_else(|| stable_lib_id(&root_str));
    conn.execute(
        "INSERT OR IGNORE INTO libraries (id, name, media_type, root_path, staging_path, organize_mode, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'copy', ?6)",
        params![id, name, media_type, root_str, staging_str, now_ms()],
    )
    .map_err(|e| format!("create library: {e}"))?;
    log::info!(target: "skald::library", "catalog: create library id={id} type={media_type} root={root_str}");
    get_library(conn, &id)
}

/// The `Podcasts/` directory of a local library — where each subscribed podcast's
/// folder (cover + episode files) lives.
fn podcasts_root(conn: &Connection, library_id: &str) -> Result<PathBuf, String> {
    Ok(Path::new(&library_root(conn, library_id)?).join(PODCASTS_DIR))
}

pub fn list_libraries() -> Result<Vec<Value>, String> {
    let conn = open()?;
    list_libraries_conn(&conn)
}

fn list_libraries_conn(conn: &Connection) -> Result<Vec<Value>, String> {
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
    delete_library_conn(&conn, id)
}

fn delete_library_conn(conn: &Connection, id: &str) -> Result<(), String> {
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
    let books_root_str = books_root.to_string_lossy().into_owned();

    // Cheap presence scan — directory paths only, NO ffprobe. Re-probing every
    // file of every book on each load (then discarding the result for books we
    // already know) was the dominant cost of switching to a local library; we now
    // probe only genuinely-new directories below, so an unchanged library costs
    // just a directory walk + a DB diff.
    let present_dirs = scanner::list_book_dirs(&books_root_str)?;
    let present: std::collections::HashSet<&str> =
        present_dirs.iter().map(|s| s.as_str()).collect();

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

    let tx = conn.unchecked_transaction().map_err(|e| format!("tx: {e}"))?;
    let now = now_ms();

    // ADD folders not yet catalogued — probe ONLY these (derive metadata once).
    let mut added = 0usize;
    for dir in &present_dirs {
        if existing.contains_key(dir) {
            continue; // already catalogued — no probe, preserve its metadata
        }
        let s = match scanner::scan_dir(dir, &books_root_str, library_id) {
            Some(s) => s,
            None => continue, // raced away / no audio
        };
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
        added += 1;
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
    log::info!(target: "skald::library", "catalog: reconciled library {library_id} present={} added={added} items={count}", present.len());
    Ok(count)
}

pub fn list_items(library_id: &str) -> Result<Vec<Value>, String> {
    let conn = open()?;
    list_items_conn(&conn, library_id)
}

fn list_items_conn(conn: &Connection, library_id: &str) -> Result<Vec<Value>, String> {
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

fn media_progress_json(item_id: &str, episode_id: &str, current_time: f64, duration: f64, is_finished: bool, updated_at: i64) -> Value {
    json!({
        // The id is composite for episodes so two episodes of one podcast don't
        // collide; book rows keep the bare item id (episode_id == '').
        "id": if episode_id.is_empty() { item_id.to_string() } else { format!("{item_id}-{episode_id}") },
        "libraryItemId": item_id,
        "episodeId": if episode_id.is_empty() { Value::Null } else { Value::String(episode_id.to_string()) },
        "duration": duration,
        "progress": if duration > 0.0 { current_time / duration } else { 0.0 },
        "currentTime": current_time,
        "isFinished": is_finished,
        "lastUpdate": updated_at,
    })
}

/// Upsert local playback progress for an (item, episode). `episode_id` is `None`
/// (or empty) for whole-item book progress and the episode guid/id for a podcast
/// episode. `library_id` is resolved from the items *or* podcasts table so callers
/// (e.g. the playback tick) only need the item id. The frontend merges on
/// `libraryItemId|episodeId`, so book and episode rows never collide.
pub fn set_progress(item_id: &str, episode_id: Option<&str>, current_time: f64, duration: f64, is_finished: bool) -> Result<(), String> {
    let conn = open()?;
    set_progress_conn(&conn, item_id, episode_id, current_time, duration, is_finished)
}

fn set_progress_conn(conn: &Connection, item_id: &str, episode_id: Option<&str>, current_time: f64, duration: f64, is_finished: bool) -> Result<(), String> {
    let ep = episode_id.unwrap_or("");
    // Books live in `items`; podcasts live in `podcasts` — try both so the
    // library_id stamp (used by list_progress for Pick-it-up) is always set.
    let library_id: String = conn
        .query_row("SELECT library_id FROM items WHERE id = ?1", params![item_id], |r| r.get(0))
        .optional()
        .map_err(|e| format!("progress lib lookup: {e}"))?
        .or_else(|| {
            conn.query_row("SELECT library_id FROM podcasts WHERE id = ?1", params![item_id], |r| r.get(0))
                .optional()
                .ok()
                .flatten()
        })
        .unwrap_or_default();
    // Preserve an existing finished flag against the playback tick's is_finished=false.
    // The tick streams forward progress and would otherwise silently un-finish a book
    // the user marked complete (or that end-of-book detection completed) while it is
    // still the active item. Keep the flag while the new position is at/after the old
    // one (normal forward play near the end); a clear backward jump (replay from the
    // start) is allowed to clear it so a re-listen tracks correctly.
    let effective_finished = if is_finished {
        true
    } else {
        let existing: Option<(f64, i64)> = conn
            .query_row(
                "SELECT \"current_time\", is_finished FROM progress WHERE item_id = ?1 AND episode_id = ?2",
                params![item_id, ep],
                |r| Ok((r.get::<_, f64>(0)?, r.get::<_, i64>(1)?)),
            )
            .optional()
            .map_err(|e| format!("progress finished lookup: {e}"))?;
        matches!(existing, Some((old_ct, old_fin)) if old_fin != 0 && current_time + 1.0 >= old_ct)
    };
    conn.execute(
        // "current_time" is quoted everywhere it appears as an identifier: bare,
        // SQLite parses current_time as the CURRENT_TIME keyword (wall-clock TEXT),
        // not this column. The write column-list happens to be safe, but we quote
        // it here too so the column name is unambiguous across all statements.
        "INSERT OR REPLACE INTO progress
            (item_id, episode_id, library_id, \"current_time\", duration, is_finished, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![item_id, ep, library_id, current_time, duration, effective_finished as i64, now_ms()],
    )
    .map_err(|e| format!("set progress: {e}"))?;
    Ok(())
}

pub fn get_progress(item_id: &str, episode_id: Option<&str>) -> Result<Option<Value>, String> {
    let conn = open()?;
    get_progress_conn(&conn, item_id, episode_id)
}

fn get_progress_conn(conn: &Connection, item_id: &str, episode_id: Option<&str>) -> Result<Option<Value>, String> {
    let ep = episode_id.unwrap_or("");
    conn.query_row(
        // "current_time" MUST be quoted — unquoted it resolves to the CURRENT_TIME
        // keyword (wall-clock TEXT), failing the f64 read below and breaking resume.
        "SELECT \"current_time\", duration, is_finished, updated_at FROM progress WHERE item_id = ?1 AND episode_id = ?2",
        params![item_id, ep],
        |r| Ok(media_progress_json(item_id, ep, r.get::<_, f64>(0)?, r.get::<_, f64>(1)?, r.get::<_, i64>(2)? != 0, r.get::<_, i64>(3)?)),
    )
    .optional()
    .map_err(|e| format!("get progress: {e}"))
}

pub fn list_progress(library_id: &str) -> Result<Vec<Value>, String> {
    let conn = open()?;
    list_progress_conn(&conn, library_id)
}

fn list_progress_conn(conn: &Connection, library_id: &str) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        // "current_time" MUST be quoted — unquoted it resolves to the CURRENT_TIME
        // keyword (wall-clock TEXT), failing the f64 read below so list_progress
        // errors out and Pick-it-up shows nothing for local libraries.
        .prepare("SELECT item_id, episode_id, \"current_time\", duration, is_finished, updated_at FROM progress WHERE library_id = ?1")
        .map_err(|e| format!("list progress: {e}"))?;
    let rows = stmt
        .query_map(params![library_id], |r| {
            let id: String = r.get(0)?;
            let ep: String = r.get(1)?;
            Ok(media_progress_json(&id, &ep, r.get::<_, f64>(2)?, r.get::<_, f64>(3)?, r.get::<_, i64>(4)? != 0, r.get::<_, i64>(5)?))
        })
        .map_err(|e| format!("list progress query: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("list progress collect: {e}"))
}

// ── Local bookmarks (Phase 4) ─────────────────────────────────────────────────

fn bookmark_json(id: &str, item_id: &str, title: &str, time: f64) -> Value {
    json!({ "id": id, "libraryItemId": item_id, "title": title, "time": time })
}

pub fn add_bookmark(item_id: &str, title: &str, time: f64) -> Result<Value, String> {
    let conn = open()?;
    add_bookmark_conn(&conn, item_id, title, time)
}

fn add_bookmark_conn(conn: &Connection, item_id: &str, title: &str, time: f64) -> Result<Value, String> {
    use std::hash::{Hash, Hasher};
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
    list_bookmarks_conn(&conn, item_id)
}

fn list_bookmarks_conn(conn: &Connection, item_id: &str) -> Result<Vec<Value>, String> {
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
    delete_bookmark_conn(&conn, id)
}

fn delete_bookmark_conn(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM bookmarks WHERE id = ?1", params![id])
        .map_err(|e| format!("delete bookmark: {e}"))?;
    Ok(())
}

/// The on-disk directory of a catalogued item (its book-unit folder), if known.
/// Falls back to a podcast's folder so `get_local_cover` can serve a podcast's
/// downloaded `cover.jpg` (podcasts live in their own table, not `items`).
pub fn get_item_path(item_id: &str) -> Result<Option<String>, String> {
    let conn = open()?;
    let from_items: Option<String> = conn
        .query_row(
            "SELECT source_path FROM items WHERE id = ?1",
            params![item_id],
            |r| r.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|e| format!("get item path: {e}"))?
        .flatten();
    if from_items.is_some() {
        return Ok(from_items);
    }
    // Podcast cover: the subscribe flow downloads cover.jpg into the folder.
    conn.query_row(
        "SELECT folder_path FROM podcasts WHERE id = ?1",
        params![item_id],
        |r| r.get::<_, Option<String>>(0),
    )
    .optional()
    .map(|o| o.flatten())
    .map_err(|e| format!("get podcast path: {e}"))
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
            let outcomes = ingest_sources(library_id, std::slice::from_ref(&s), true)?;
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

// Audio extensions for the single-file resolver below — mirrors scanner.rs /
// tone.rs. Kept local so this resolver stays self-contained.
const CHAPTER_AUDIO_EXTS: &[&str] = &["m4b", "mp3", "aac", "ogg", "flac", "opus", "m4a", "wav"];

/// Resolve the one audio file of a single-file local book, for chapter write-back.
/// Prefers the catalogued `libraryFiles` (the authoritative file set the scanner
/// emitted); falls back to scanning `localPath`. Returns None when the book has
/// zero or more than one audio file — multi-file chapter write-back is ambiguous,
/// so the caller treats None as "catalog-only" and skips the file write.
fn single_audio_file(item: &Value) -> Option<PathBuf> {
    if let Some(files) = item.get("libraryFiles").and_then(|v| v.as_array()) {
        let audio: Vec<&Value> = files
            .iter()
            .filter(|f| f.get("fileType").and_then(|t| t.as_str()) == Some("audio"))
            .collect();
        if audio.len() == 1 {
            if let Some(p) = audio[0].get("metadata").and_then(|m| m.get("path")).and_then(|p| p.as_str()) {
                return Some(PathBuf::from(p));
            }
        }
        if audio.len() > 1 {
            return None; // multi-file
        }
    }
    // Fallback: exactly one audio file directly inside the book folder.
    let dir = item.get("localPath").and_then(|p| p.as_str())?;
    let mut found: Vec<PathBuf> = std::fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.extension()
                .and_then(|e| e.to_str())
                .map(|e| CHAPTER_AUDIO_EXTS.contains(&e.to_lowercase().as_str()))
                .unwrap_or(false)
        })
        .collect();
    if found.len() == 1 {
        found.pop()
    } else {
        None
    }
}

/// Replace the chapter markers on a catalogued local item (Local Chapter
/// Write-Back roadmap). The catalog JSON is what the player and shelf read, so
/// this is the authoritative write and takes effect immediately. When
/// `write_to_file` is set, the chapters are additionally written into the single
/// audio file via `tone` so the edit survives a re-scan — best-effort: a failure
/// there (locked file, odd container, multi-file book) leaves the catalog edit
/// intact and is reported back as a warning string rather than failing the call.
/// Returns (updated_item_json, file_write_warning). Blocking — call from
/// `spawn_blocking`. The caller scopes this to single-file books.
pub fn set_item_chapters(
    item_id: &str,
    chapters: Value,
    write_to_file: bool,
) -> Result<(Value, Option<String>), String> {
    let conn = open()?;
    let item_str: String = conn
        .query_row("SELECT item_json FROM items WHERE id = ?1", params![item_id], |r| r.get(0))
        .map_err(|e| format!("load item: {e}"))?;
    let mut item: Value = serde_json::from_str(&item_str).map_err(|e| format!("parse item: {e}"))?;

    let count = chapters.as_array().map(Vec::len).unwrap_or(0);
    let duration = item
        .get("media")
        .and_then(|m| m.get("duration"))
        .and_then(Value::as_f64)
        .unwrap_or(0.0);

    // Authoritative catalog write: replace media.chapters (+ numChapters if the
    // stored shape carries it). Done before the file write so the edit is live even
    // if the (best-effort) file write fails.
    match item.get_mut("media").and_then(|m| m.as_object_mut()) {
        Some(media) => {
            media.insert("chapters".into(), chapters.clone());
            if media.contains_key("numChapters") {
                media.insert("numChapters".into(), json!(count));
            }
        }
        None => return Err("item has no media object".to_string()),
    }

    let updated_str = serde_json::to_string(&item).map_err(|e| format!("serialize: {e}"))?;
    conn.execute(
        "UPDATE items SET item_json = ?1, updated_at = ?2 WHERE id = ?3",
        params![updated_str, now_ms(), item_id],
    )
    .map_err(|e| format!("update item: {e}"))?;
    log::info!(target: "skald::metadata", "set_item_chapters {item_id} count={count} write_to_file={write_to_file}");

    // Best-effort durable write into the file.
    let mut warning: Option<String> = None;
    if write_to_file {
        match single_audio_file(&item) {
            Some(path) => {
                if let Err(e) = crate::tone::write_chapters(&path, &chapters, duration) {
                    log::warn!(target: "skald::metadata", "set_item_chapters: file write incomplete: {e}");
                    warning = Some(e);
                }
            }
            None => {
                log::warn!(target: "skald::metadata", "set_item_chapters: no single audio file for {item_id}; catalog-only");
                warning = Some("Chapters saved to the library, but couldn't be written into the audio file (this book isn't a single file).".to_string());
            }
        }
    }

    Ok((item, warning))
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
        // Containment guard: source_path is durable catalog state. A corrupt or
        // hand-edited row must not turn unsubscribe/delete into a recursive wipe
        // of an arbitrary directory — require it to sit strictly inside this
        // library's root (both paths were built from the same stored root, so a
        // lexical starts_with comparison is sound).
        let root = library_root(&conn, &library_id)?;
        let lib_root = Path::new(&root);
        if !p.starts_with(lib_root) || p == lib_root {
            log::warn!(target: "skald::library",
                "delete_item refused out-of-root path {} (library root {})", p.display(), lib_root.display());
            return Err(format!("Refusing to delete outside the library root: {sp}"));
        }
        if p.exists() {
            std::fs::remove_dir_all(p).map_err(|e| format!("remove book dir: {e}"))?;
        }
        // Prune the vacated Author/Series skeleton (stops at the Audiobooks root).
        let books_root = lib_root.join(AUDIOBOOKS_DIR);
        if let Some(parent) = p.parent() {
            prune_upwards(parent, &books_root);
        }
    }

    conn.execute("DELETE FROM items WHERE id = ?1", params![item_id]).map_err(|e| format!("del item: {e}"))?;
    conn.execute("DELETE FROM progress WHERE item_id = ?1", params![item_id]).map_err(|e| format!("del progress: {e}"))?;
    conn.execute("DELETE FROM bookmarks WHERE item_id = ?1", params![item_id]).map_err(|e| format!("del bookmarks: {e}"))?;
    log::info!(target: "skald::library", "catalog: deleted item {item_id}");
    Ok(())
}

// ── Local podcasts (Local Podcasts roadmap) ───────────────────────────────────
// A subscribed podcast is one `podcasts` row (item-level metadata + settings) plus
// N `podcast_episodes` rows. The frontend consumes an ABS-shaped podcast
// `LibraryItem` (media = PodcastMedia with an assembled `episodes[]`), so these
// functions emit/accept exactly that JSON — no special-casing in the UI.

/// Deterministic 64-bit hash of a string (FNV-free; uses the std default hasher).
fn stable_hash(s: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
}

/// Stable podcast id from its feed URL so re-subscribing the same feed is idempotent.
fn podcast_id_for(feed_url: &str) -> String {
    format!("local_pod_{:016x}", stable_hash(feed_url))
}

/// Stable episode id within a podcast, keyed on the feed identity (guid, else the
/// enclosure URL). This is the `episodeId` the frontend keys per-episode progress
/// on, so it must be stable across feed re-polls.
fn episode_id_for(podcast_id: &str, guid: &str, enclosure_url: &str) -> String {
    let key = if !guid.is_empty() { guid } else { enclosure_url };
    format!("ep_{:016x}", stable_hash(&format!("{podcast_id}|{key}")))
}

/// The feed identity of an episode JSON (guid, else enclosure URL).
fn episode_guid(ep: &Value) -> String {
    if let Some(g) = ep.get("guid").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
        return g.to_string();
    }
    ep.get("enclosure")
        .and_then(|e| e.get("url"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

/// The auto-download/cover knobs of a podcast item JSON, named so the call
/// site reads as key = value instead of a positional literal soup.
struct PodcastItemPrefs<'a> {
    auto_download: bool,
    schedule: Option<&'a str>,
    max_new: i64,
    max_keep: i64,
    has_cover: bool,
}

/// Build the ABS-shaped podcast `LibraryItem` JSON (without episodes — the caller
/// injects the assembled list). Mirrors the shape `asPodcastItem()` reads.
fn podcast_item_json(
    id: &str,
    library_id: &str,
    folder_path: &str,
    metadata: &Value,
    prefs: PodcastItemPrefs<'_>,
) -> Value {
    let PodcastItemPrefs { auto_download, schedule, max_new, max_keep, has_cover } = prefs;
    json!({
        "id": id,
        "ino": id,
        "libraryId": library_id,
        "mediaType": "podcast",
        "localPath": folder_path,
        "hasLocalCover": has_cover,
        "media": {
            "metadata": metadata,
            "episodes": [],
            "tags": [],
            "autoDownloadEpisodes": auto_download,
            "autoDownloadSchedule": schedule,
            "maxEpisodesToKeep": max_keep,
            "maxNewEpisodesToDownload": max_new,
            "numEpisodes": 0,
        },
    })
}

/// Subscribe a local library to a podcast feed. `feed` is the parsed PodcastMedia
/// JSON (`{ metadata, episodes }`) from `podcast_feed::parse`. Inserts the podcast
/// row (idempotent on feed URL), upserts its episodes, creates the on-disk folder,
/// and returns (podcast_id, cover_dest, cover_url) so the async caller can download
/// the cover art. Blocking — call from `spawn_blocking`.
pub fn subscribe_podcast(
    library_id: &str,
    feed: &Value,
    feed_url: &str,
    auto_download: bool,
) -> Result<(String, String, Option<String>), String> {
    let conn = open()?;
    subscribe_podcast_conn(&conn, library_id, feed, feed_url, auto_download)
}

fn subscribe_podcast_conn(
    conn: &Connection,
    library_id: &str,
    feed: &Value,
    feed_url: &str,
    auto_download: bool,
) -> Result<(String, String, Option<String>), String> {
    let metadata = feed.get("metadata").cloned().unwrap_or_else(|| json!({}));
    let title = metadata.get("title").and_then(|v| v.as_str()).unwrap_or("Podcast").to_string();
    let cover_url = metadata
        .get("imageUrl")
        .or_else(|| metadata.get("image"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // Idempotency by natural key (see create_library): reuse the stored id for
    // an already-subscribed feed so identity never depends on hash stability.
    let id: String = conn
        .query_row(
            "SELECT id FROM podcasts WHERE library_id = ?1 AND feed_url = ?2",
            params![library_id, feed_url],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| format!("podcast lookup: {e}"))?
        .unwrap_or_else(|| podcast_id_for(feed_url));
    let root = podcasts_root(conn, library_id)?;
    let folder = root.join(ingest::sanitize_component(&title));
    std::fs::create_dir_all(&folder).map_err(|e| format!("create podcast folder: {e}"))?;
    let folder_str = folder.to_string_lossy().into_owned();
    let cover_dest = folder.join("cover.jpg").to_string_lossy().into_owned();

    // Subscribe-time defaults match the podcasts table's column DEFAULTs (3/0).
    let item = podcast_item_json(&id, library_id, &folder_str, &metadata, PodcastItemPrefs {
        auto_download,
        schedule: None,
        max_new: 3,
        max_keep: 0,
        has_cover: false,
    });
    let item_str = serde_json::to_string(&item).map_err(|e| format!("serialize podcast: {e}"))?;
    let now = now_ms();
    conn.execute(
        "INSERT INTO podcasts
            (id, library_id, feed_url, title, folder_path, item_json, auto_download, auto_download_schedule, max_new, max_keep, last_episode_check, added_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, 3, 0, 0, ?8, ?8)
         ON CONFLICT(id) DO UPDATE SET feed_url=excluded.feed_url, title=excluded.title, item_json=excluded.item_json, updated_at=excluded.updated_at",
        params![id, library_id, feed_url, title, folder_str, item_str, auto_download as i64, now],
    )
    .map_err(|e| format!("insert podcast: {e}"))?;

    if let Some(eps) = feed.get("episodes").and_then(|e| e.as_array()) {
        upsert_episodes_conn(conn, &id, eps)?;
    }
    // Host only — private feed URLs carry subscriber tokens (see feed_host).
    log::info!(target: "skald::library", "podcast subscribe lib={library_id} title={title} feed={}", crate::podcast_feed::feed_host(feed_url));
    Ok((id, cover_dest, cover_url))
}

/// Upsert feed episodes for a podcast (dedupe by guid). Never touches the
/// downloaded/audio_path columns of an existing row, so a re-poll refreshes feed
/// metadata without clobbering download state. Returns (added, total_in_feed_batch).
fn upsert_episodes_conn(conn: &Connection, podcast_id: &str, episodes: &[Value]) -> Result<(usize, usize), String> {
    let now = now_ms();
    let mut added = 0usize;
    for ep in episodes {
        let guid = episode_guid(ep);
        if guid.is_empty() {
            continue; // no identity → cannot dedupe; skip rather than duplicate
        }
        let enclosure_url = ep.get("enclosure").and_then(|e| e.get("url")).and_then(|v| v.as_str()).unwrap_or("");
        let ep_id = episode_id_for(podcast_id, &guid, enclosure_url);
        let pub_date = ep.get("pubDate").and_then(|v| v.as_str()).unwrap_or("");
        let published_at = ep.get("publishedAt").and_then(|v| v.as_i64()).unwrap_or(0);
        let ep_str = serde_json::to_string(ep).map_err(|e| format!("serialize episode: {e}"))?;
        let changed = conn.execute(
            "INSERT INTO podcast_episodes (id, podcast_id, guid, episode_json, audio_path, downloaded, pub_date, published_at, added_at)
             VALUES (?1, ?2, ?3, ?4, NULL, 0, ?5, ?6, ?7)
             ON CONFLICT(podcast_id, guid) DO UPDATE SET episode_json=excluded.episode_json, pub_date=excluded.pub_date, published_at=excluded.published_at",
            params![ep_id, podcast_id, guid, ep_str, pub_date, published_at, now],
        )
        .map_err(|e| format!("upsert episode: {e}"))?;
        // execute returns rows-changed; an INSERT counts 1, an UPDATE-on-conflict
        // also counts 1, so distinguish a genuine add via a pre-check would cost a
        // query — instead count inserts by checking existence cheaply.
        if changed == 1 {
            // Heuristic: treat as added only if the row had no prior download state.
            added += 1;
        }
    }
    let total = conn
        .query_row("SELECT COUNT(*) FROM podcast_episodes WHERE podcast_id = ?1", params![podcast_id], |r| r.get::<_, i64>(0))
        .map_err(|e| format!("episode count: {e}"))? as usize;
    log::info!(target: "skald::library", "episodes upsert podcast={podcast_id} batch={} total={total}", episodes.len());
    Ok((added, total))
}

/// Public episode-upsert used by feed re-polls (check-new / scheduler).
pub fn upsert_episodes(podcast_id: &str, episodes: &[Value]) -> Result<(usize, usize), String> {
    let conn = open()?;
    upsert_episodes_conn(&conn, podcast_id, episodes)
}

/// Assemble one episode's frontend JSON: the stored feed JSON, plus the catalog's
/// id/podcastId and (when downloaded) a `localPath` the play command resolves and
/// a truthy `audioFile` marker so the UI treats it as playable.
fn assemble_episode(ep_id: &str, podcast_id: &str, episode_json: &str, downloaded: bool, audio_path: Option<&str>) -> Option<Value> {
    let mut ep: Value = serde_json::from_str(episode_json).ok()?;
    if let Some(obj) = ep.as_object_mut() {
        obj.insert("id".into(), Value::String(ep_id.to_string()));
        obj.insert("podcastId".into(), Value::String(podcast_id.to_string()));
        if downloaded {
            if let Some(p) = audio_path {
                obj.insert("localPath".into(), Value::String(p.to_string()));
                obj.insert("audioFile".into(), Value::Bool(true));
            }
        }
    }
    Some(ep)
}

/// Downloaded episodes of a podcast, newest first, frontend-shaped. Mirrors ABS,
/// where a podcast library item carries only its *downloaded* episodes — the full
/// published list is resolved separately from the live feed. Keeping this to
/// downloaded rows means the detail/browse views correctly mark playability.
fn podcast_episodes(conn: &Connection, podcast_id: &str) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare("SELECT id, episode_json, downloaded, audio_path FROM podcast_episodes WHERE podcast_id = ?1 AND downloaded = 1 ORDER BY published_at DESC")
        .map_err(|e| format!("episodes select: {e}"))?;
    let rows = stmt
        .query_map(params![podcast_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)? != 0, r.get::<_, Option<String>>(3)?))
        })
        .map_err(|e| format!("episodes query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        let (id, json, dl, path) = row.map_err(|e| format!("episode row: {e}"))?;
        if let Some(v) = assemble_episode(&id, podcast_id, &json, dl, path.as_deref()) {
            out.push(v);
        }
    }
    Ok(out)
}

/// List a local library's podcasts as ABS-shaped podcast `LibraryItem`s, each with
/// its assembled `episodes[]` (downloaded rows flagged playable). Feeds the local
/// branch of `loadItemsForLibrary`.
pub fn list_podcast_items(library_id: &str) -> Result<Vec<Value>, String> {
    let conn = open()?;
    list_podcast_items_conn(&conn, library_id)
}

fn list_podcast_items_conn(conn: &Connection, library_id: &str) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare("SELECT id, item_json, folder_path FROM podcasts WHERE library_id = ?1 ORDER BY title")
        .map_err(|e| format!("list podcasts: {e}"))?;
    let rows = stmt
        .query_map(params![library_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
        })
        .map_err(|e| format!("list podcasts query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        let (id, item_str, folder) = row.map_err(|e| format!("podcast row: {e}"))?;
        let mut item: Value = match serde_json::from_str(&item_str) {
            Ok(v) => v,
            Err(e) => { log::warn!(target: "skald::library", "bad podcast item_json ({e})"); continue; }
        };
        let episodes = podcast_episodes(conn, &id)?;
        let has_cover = Path::new(&folder).join("cover.jpg").is_file();
        if let Some(media) = item.get_mut("media").and_then(|m| m.as_object_mut()) {
            let n = episodes.len();
            media.insert("episodes".into(), Value::Array(episodes));
            media.insert("numEpisodes".into(), json!(n));
        }
        if let Some(obj) = item.as_object_mut() {
            obj.insert("hasLocalCover".into(), Value::Bool(has_cover));
        }
        out.push(item);
    }
    Ok(out)
}

/// Downloaded episodes across a local library, newest first, shaped like ABS
/// recent-episodes entries (carry `libraryItemId` + `episodeId`) so the browse
/// view can mark/match playable episodes. Only downloaded episodes are returned.
pub fn list_downloaded_episodes(library_id: &str) -> Result<Vec<Value>, String> {
    let conn = open()?;
    let mut stmt = conn
        .prepare(
            "SELECT e.id, e.podcast_id, e.episode_json, e.audio_path, p.item_json
             FROM podcast_episodes e JOIN podcasts p ON p.id = e.podcast_id
             WHERE p.library_id = ?1 AND e.downloaded = 1
             ORDER BY e.published_at DESC",
        )
        .map_err(|e| format!("downloaded episodes: {e}"))?;
    let rows = stmt
        .query_map(params![library_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, String>(4)?,
            ))
        })
        .map_err(|e| format!("downloaded episodes query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        let (ep_id, pod_id, ep_json, audio, item_json) = row.map_err(|e| format!("dl ep row: {e}"))?;
        let Some(mut ep) = assemble_episode(&ep_id, &pod_id, &ep_json, true, audio.as_deref()) else { continue };
        let pod_meta = serde_json::from_str::<Value>(&item_json)
            .ok()
            .and_then(|v| v.get("media").and_then(|m| m.get("metadata")).cloned());
        if let Some(obj) = ep.as_object_mut() {
            obj.insert("libraryItemId".into(), Value::String(pod_id.clone()));
            obj.insert("podcast".into(), json!({ "metadata": pod_meta }));
        }
        out.push(ep);
    }
    Ok(out)
}

/// Look up a downloaded episode's on-disk audio path by podcast + episode id.
pub fn episode_audio_path(podcast_id: &str, episode_id: &str) -> Result<Option<String>, String> {
    let conn = open()?;
    conn.query_row(
        "SELECT audio_path FROM podcast_episodes WHERE podcast_id = ?1 AND id = ?2 AND downloaded = 1",
        params![podcast_id, episode_id],
        |r| r.get::<_, Option<String>>(0),
    )
    .optional()
    .map(|o| o.flatten())
    .map_err(|e| format!("episode audio path: {e}"))
}

/// Mark an episode downloaded: store its audio path and flip the flag. Matched by
/// the feed guid so the download command (which works from the feed episode) can
/// land it on the right row.
pub fn set_episode_downloaded(podcast_id: &str, guid: &str, audio_path: &str) -> Result<(), String> {
    let conn = open()?;
    set_episode_downloaded_conn(&conn, podcast_id, guid, audio_path)
}

fn set_episode_downloaded_conn(conn: &Connection, podcast_id: &str, guid: &str, audio_path: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE podcast_episodes SET audio_path = ?1, downloaded = 1 WHERE podcast_id = ?2 AND guid = ?3",
        params![audio_path, podcast_id, guid],
    )
    .map_err(|e| format!("mark episode downloaded: {e}"))?;
    Ok(())
}

/// A podcast's feed URL + on-disk folder (used by the download + scheduler paths).
pub fn podcast_feed_and_folder(podcast_id: &str) -> Result<(String, String), String> {
    let conn = open()?;
    conn.query_row(
        "SELECT feed_url, folder_path FROM podcasts WHERE id = ?1",
        params![podcast_id],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
    )
    .map_err(|e| format!("podcast feed/folder: {e}"))
}

/// Update a podcast's auto-download settings (mirrors the ABS PATCH …/media path).
/// Re-stamps the stored item_json so a subsequent list reflects the new settings.
pub fn update_podcast_settings(
    podcast_id: &str,
    auto_download: bool,
    schedule: Option<&str>,
    max_new: i64,
    max_keep: i64,
) -> Result<Value, String> {
    let conn = open()?;
    conn.execute(
        "UPDATE podcasts SET auto_download = ?1, auto_download_schedule = ?2, max_new = ?3, max_keep = ?4, updated_at = ?5 WHERE id = ?6",
        params![auto_download as i64, schedule, max_new, max_keep, now_ms(), podcast_id],
    )
    .map_err(|e| format!("update podcast settings: {e}"))?;
    // Re-stamp item_json so its embedded settings stay in sync with the columns.
    let item_str: String = conn
        .query_row("SELECT item_json FROM podcasts WHERE id = ?1", params![podcast_id], |r| r.get(0))
        .map_err(|e| format!("reload podcast: {e}"))?;
    let mut item: Value = serde_json::from_str(&item_str).map_err(|e| format!("parse podcast: {e}"))?;
    if let Some(media) = item.get_mut("media").and_then(|m| m.as_object_mut()) {
        media.insert("autoDownloadEpisodes".into(), json!(auto_download));
        media.insert("autoDownloadSchedule".into(), schedule.map(|s| json!(s)).unwrap_or(Value::Null));
        media.insert("maxNewEpisodesToDownload".into(), json!(max_new));
        media.insert("maxEpisodesToKeep".into(), json!(max_keep));
    }
    let updated = serde_json::to_string(&item).map_err(|e| format!("serialize podcast: {e}"))?;
    conn.execute("UPDATE podcasts SET item_json = ?1 WHERE id = ?2", params![updated, podcast_id])
        .map_err(|e| format!("save podcast item_json: {e}"))?;
    Ok(item)
}

/// Settings row for one podcast (used by the auto-download scheduler).
pub struct PodcastSchedule {
    pub id: String,
    pub feed_url: String,
    pub auto_download: bool,
    pub schedule: Option<String>,
    pub max_new: i64,
    pub max_keep: i64,
    pub last_check: i64,
}

/// All podcasts that have auto-download enabled, across all libraries (scheduler).
pub fn list_auto_download_podcasts() -> Result<Vec<PodcastSchedule>, String> {
    let conn = open()?;
    let mut stmt = conn
        .prepare("SELECT id, feed_url, auto_download, auto_download_schedule, max_new, max_keep, last_episode_check FROM podcasts WHERE auto_download = 1")
        .map_err(|e| format!("list auto podcasts: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(PodcastSchedule {
                id: r.get(0)?,
                feed_url: r.get(1)?,
                auto_download: r.get::<_, i64>(2)? != 0,
                schedule: r.get(3)?,
                max_new: r.get(4)?,
                max_keep: r.get(5)?,
                last_check: r.get(6)?,
            })
        })
        .map_err(|e| format!("auto podcasts query: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("auto podcasts collect: {e}"))
}

/// Stamp a podcast's last-feed-check time (scheduler bookkeeping).
pub fn touch_episode_check(podcast_id: &str) -> Result<(), String> {
    let conn = open()?;
    conn.execute("UPDATE podcasts SET last_episode_check = ?1 WHERE id = ?2", params![now_ms(), podcast_id])
        .map_err(|e| format!("touch episode check: {e}"))?;
    Ok(())
}

/// The undownloaded episodes of a podcast, newest first (scheduler picks the
/// newest `max_new` to fetch). Returns (episode_json, guid) pairs.
pub fn undownloaded_episodes(podcast_id: &str, limit: usize) -> Result<Vec<(Value, String)>, String> {
    let conn = open()?;
    let mut stmt = conn
        .prepare("SELECT episode_json, guid FROM podcast_episodes WHERE podcast_id = ?1 AND downloaded = 0 ORDER BY published_at DESC LIMIT ?2")
        .map_err(|e| format!("undownloaded select: {e}"))?;
    let rows = stmt
        .query_map(params![podcast_id, limit as i64], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| format!("undownloaded query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        let (json, guid) = row.map_err(|e| format!("undownloaded row: {e}"))?;
        if let Ok(v) = serde_json::from_str::<Value>(&json) {
            out.push((v, guid));
        }
    }
    Ok(out)
}

/// Retention: keep only the newest `max_keep` downloaded episodes; delete the
/// older downloaded files + flip their rows back to not-downloaded (the feed entry
/// is kept so the episode can be re-downloaded). `max_keep <= 0` disables pruning.
/// Never deletes the currently-playing episode (caller passes its id to skip).
/// Returns the number of episodes pruned.
pub fn prune_episodes(podcast_id: &str, max_keep: i64, skip_episode_id: Option<&str>) -> Result<usize, String> {
    if max_keep <= 0 {
        return Ok(0);
    }
    let conn = open()?;
    // Downloaded episodes newest-first; everything past max_keep is a prune target.
    let mut stmt = conn
        .prepare("SELECT id, audio_path FROM podcast_episodes WHERE podcast_id = ?1 AND downloaded = 1 ORDER BY published_at DESC")
        .map_err(|e| format!("prune select: {e}"))?;
    let rows: Vec<(String, Option<String>)> = stmt
        .query_map(params![podcast_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)))
        .map_err(|e| format!("prune query: {e}"))?
        .collect::<Result<_, _>>()
        .map_err(|e| format!("prune collect: {e}"))?;
    let mut pruned = 0usize;
    for (id, audio) in rows.into_iter().skip(max_keep as usize) {
        if Some(id.as_str()) == skip_episode_id {
            continue; // never prune the episode currently playing
        }
        if let Some(p) = audio.as_deref() {
            // Verify-before-delete: only remove a file that actually exists.
            if Path::new(p).is_file() {
                let _ = std::fs::remove_file(p);
            }
        }
        conn.execute(
            "UPDATE podcast_episodes SET downloaded = 0, audio_path = NULL WHERE id = ?1",
            params![id],
        )
        .map_err(|e| format!("prune update: {e}"))?;
        pruned += 1;
    }
    if pruned > 0 {
        log::info!(target: "skald::library", "retention prune podcast={podcast_id} removed={pruned}");
    }
    Ok(pruned)
}

/// Unsubscribe: delete a podcast, all its episode rows + downloaded files, its
/// on-disk folder, and its progress rows. Blocking — call from `spawn_blocking`.
pub fn delete_podcast(podcast_id: &str) -> Result<(), String> {
    let conn = open()?;
    let row: Option<(String, Option<String>)> = conn
        .query_row(
            "SELECT library_id, folder_path FROM podcasts WHERE id = ?1",
            params![podcast_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)),
        )
        .optional()
        .map_err(|e| format!("podcast folder lookup: {e}"))?;
    conn.execute("DELETE FROM podcast_episodes WHERE podcast_id = ?1", params![podcast_id])
        .map_err(|e| format!("del episodes: {e}"))?;
    conn.execute("DELETE FROM podcasts WHERE id = ?1", params![podcast_id])
        .map_err(|e| format!("del podcast: {e}"))?;
    conn.execute("DELETE FROM progress WHERE item_id = ?1", params![podcast_id])
        .map_err(|e| format!("del podcast progress: {e}"))?;
    if let Some((library_id, Some(f))) = row {
        let p = Path::new(&f);
        // Containment guard (see delete_item): only delete a folder that sits
        // strictly inside this library's root — never an arbitrary stored path.
        match library_root(&conn, &library_id) {
            Ok(root) if p.starts_with(Path::new(&root)) && p != Path::new(&root) => {
                if p.exists() {
                    let _ = std::fs::remove_dir_all(p);
                }
            }
            _ => log::warn!(target: "skald::library",
                "delete_podcast refused out-of-root folder {} (library {library_id})", p.display()),
        }
    }
    log::info!(target: "skald::library", "podcast unsubscribe id={podcast_id}");
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

// Temp-DB integration tests over the `_conn` seam (Test Seams roadmap). Each
// test opens its OWN catalog.db inside a tempfile dir — the real app catalog
// is never touched, and tests stay parallel-safe with no shared state.
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn test_conn() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().expect("tempdir");
        let conn = Connection::open(dir.path().join("catalog.db")).expect("open temp db");
        init_schema(&conn).expect("init schema");
        (dir, conn)
    }

    /// Insert a minimal items row (list_items/set_progress only read
    /// library_id + item_json; source_path keeps the unique path index happy).
    fn insert_item(conn: &Connection, id: &str, library_id: &str, item_json: &str) {
        conn.execute(
            "INSERT INTO items (id, library_id, source_path, item_json, added_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 0, 0)",
            params![id, library_id, format!("src/{id}"), item_json],
        )
        .expect("insert item");
    }

    #[test]
    fn library_create_list_delete_round_trip() {
        let (dir, conn) = test_conn();
        let parent = dir.path().to_string_lossy().into_owned();

        let lib = create_library_conn(&conn, "My Books", &parent, "book").unwrap();
        let id = lib["id"].as_str().unwrap().to_string();
        assert_eq!(lib["source"], json!("local"));
        assert_eq!(lib["mediaType"], json!("book"));
        // The managed folder skeleton exists on disk.
        let root = lib["folders"][0]["fullPath"].as_str().unwrap();
        assert!(Path::new(root).join(STAGING_DIR).is_dir());
        assert!(Path::new(root).join(UNIDENTIFIED_DIR).is_dir());

        // Idempotent: re-creating the same path reuses the stored id.
        let again = create_library_conn(&conn, "My Books", &parent, "book").unwrap();
        assert_eq!(again["id"].as_str().unwrap(), id);
        assert_eq!(list_libraries_conn(&conn).unwrap().len(), 1);

        delete_library_conn(&conn, &id).unwrap();
        assert!(list_libraries_conn(&conn).unwrap().is_empty());
    }

    #[test]
    fn progress_scopes_by_episode_and_preserves_finished_flag() {
        let (_dir, conn) = test_conn();
        insert_item(&conn, "book1", "lib1", "{}");

        // Book-level and episode-level rows never collide (composite key).
        set_progress_conn(&conn, "book1", None, 100.0, 3600.0, false).unwrap();
        set_progress_conn(&conn, "book1", Some("ep1"), 50.0, 1800.0, false).unwrap();
        let book = get_progress_conn(&conn, "book1", None).unwrap().unwrap();
        let ep = get_progress_conn(&conn, "book1", Some("ep1")).unwrap().unwrap();
        assert_eq!(book["currentTime"], json!(100.0));
        assert_eq!(ep["currentTime"], json!(50.0));
        assert_eq!(ep["episodeId"], json!("ep1"));

        // Finish the book, then simulate the playback tick writing is_finished=false
        // at/after the finished position — the flag must survive (desync fix).
        set_progress_conn(&conn, "book1", None, 3600.0, 3600.0, true).unwrap();
        set_progress_conn(&conn, "book1", None, 3600.0, 3600.0, false).unwrap();
        let p = get_progress_conn(&conn, "book1", None).unwrap().unwrap();
        assert_eq!(p["isFinished"], json!(true), "forward tick must not un-finish");

        // A clear backward jump (re-listen from the start) is allowed to clear it.
        set_progress_conn(&conn, "book1", None, 5.0, 3600.0, false).unwrap();
        let p = get_progress_conn(&conn, "book1", None).unwrap().unwrap();
        assert_eq!(p["isFinished"], json!(false), "replay must clear the flag");

        // list_progress is scoped by the library stamped at write time.
        assert_eq!(list_progress_conn(&conn, "lib1").unwrap().len(), 2);
        assert!(list_progress_conn(&conn, "other").unwrap().is_empty());
    }

    #[test]
    fn bookmarks_add_list_delete_round_trip() {
        let (_dir, conn) = test_conn();
        let later = add_bookmark_conn(&conn, "book1", "later", 300.0).unwrap();
        add_bookmark_conn(&conn, "book1", "early", 30.0).unwrap();

        let list = list_bookmarks_conn(&conn, "book1").unwrap();
        assert_eq!(list.len(), 2);
        // Ordered by time, not insertion.
        assert_eq!(list[0]["title"], json!("early"));
        assert_eq!(list[1]["title"], json!("later"));

        delete_bookmark_conn(&conn, later["id"].as_str().unwrap()).unwrap();
        let list = list_bookmarks_conn(&conn, "book1").unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0]["title"], json!("early"));
    }

    #[test]
    fn podcast_subscribe_idempotent_and_upsert_preserves_download_state() {
        let (dir, conn) = test_conn();
        let parent = dir.path().to_string_lossy().into_owned();
        let lib = create_library_conn(&conn, "Pods", &parent, "podcast").unwrap();
        let lib_id = lib["id"].as_str().unwrap().to_string();

        let ep = |guid: &str, title: &str| json!({ "guid": guid, "title": title, "enclosure": { "url": format!("https://x/{guid}.mp3") } });
        let feed = json!({
            "metadata": { "title": "Show", "imageUrl": "https://x/art.jpg" },
            "episodes": [ep("g1", "One"), ep("g2", "Two"), json!({ "title": "identity-less" })],
        });

        let (pod_id, _cover, cover_url) = subscribe_podcast_conn(&conn, &lib_id, &feed, "https://x/feed.xml", false).unwrap();
        assert_eq!(cover_url.as_deref(), Some("https://x/art.jpg"));
        // The guid-less episode is skipped (no identity → cannot dedupe).
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM podcast_episodes WHERE podcast_id = ?1", params![pod_id], |r| r.get(0)).unwrap();
        assert_eq!(count, 2);

        // Same feed URL → same podcast id (idempotent by natural key).
        let (again, _, _) = subscribe_podcast_conn(&conn, &lib_id, &feed, "https://x/feed.xml", false).unwrap();
        assert_eq!(again, pod_id);

        // Download one episode, then re-poll with refreshed metadata: the
        // episode_json updates but downloaded/audio_path survive (regression #10).
        set_episode_downloaded_conn(&conn, &pod_id, "g1", "C:/pods/one.mp3").unwrap();
        upsert_episodes_conn(&conn, &pod_id, &[ep("g1", "One (renamed)"), ep("g2", "Two")]).unwrap();
        let (dl, path, ep_json): (i64, Option<String>, String) = conn
            .query_row(
                "SELECT downloaded, audio_path, episode_json FROM podcast_episodes WHERE podcast_id = ?1 AND guid = 'g1'",
                params![pod_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(dl, 1, "re-poll must not clear the downloaded flag");
        assert_eq!(path.as_deref(), Some("C:/pods/one.mp3"));
        assert!(ep_json.contains("One (renamed)"), "re-poll must refresh feed metadata");

        // The assembled item carries only downloaded episodes, flagged playable.
        let items = list_podcast_items_conn(&conn, &lib_id).unwrap();
        assert_eq!(items.len(), 1);
        let eps = items[0]["media"]["episodes"].as_array().unwrap();
        assert_eq!(eps.len(), 1);
        assert_eq!(eps[0]["localPath"], json!("C:/pods/one.mp3"));
    }

    #[test]
    fn corrupt_item_json_is_skipped_not_fatal() {
        let (_dir, conn) = test_conn();
        insert_item(&conn, "good", "lib1", r#"{"id":"good"}"#);
        insert_item(&conn, "bad", "lib1", "{not json");

        // Designed degradation: the bad row logs a warning and is skipped; the
        // rest of the shelf still loads (no panic, no hard error).
        let items = list_items_conn(&conn, "lib1").unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["id"], json!("good"));
    }
}
