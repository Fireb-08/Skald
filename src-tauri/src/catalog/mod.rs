// catalog/ — local library catalog backed by SQLite (rusqlite).
// (Local Library & Split Libraries roadmap, Phase 2.)
//
// Stores local libraries and their scanned items so a folder on disk becomes a
// first-class library that lists alongside ABS libraries in the switcher. Items
// are stored as the same ABS-shaped LibraryItem JSON the scanner emits, so the
// frontend renders them with no special-casing.
//
// Each call opens its own connection (SQLite open is cheap for a local file),
// which keeps every catalog function self-contained and safe to run inside
// `spawn_blocking`.
//
// Split by domain (God-File Decomposition roadmap, L3/L7): this mod.rs holds
// the connection/schema/migration infrastructure, shared id + fs helpers, and
// the temp-DB test suite; the domain functions live in the submodules below.
// Every public fn is glob re-exported so `crate::catalog::<fn>` callers are
// untouched (same pattern as the commands/ and api/ splits).

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Mutex;

use crate::{ingest, scanner};
use std::path::Path;

mod items;
mod libraries;
mod podcasts;
mod progress;

pub use items::*;
pub use libraries::*;
pub use podcasts::*;
pub use progress::*;

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
         CREATE UNIQUE INDEX IF NOT EXISTS idx_episodes_guid ON podcast_episodes(podcast_id, guid);
         -- ── Local listening stats (Local Listening Stats roadmap) ─────────────
         -- listen_days: one row per local calendar day with any local-library
         -- playback. time is SECONDS — the same unit ABS listening-stats uses
         -- (verified against the web client's totalTime/60 minutes conversion),
         -- so local and server stats merge without conversion.
         CREATE TABLE IF NOT EXISTS listen_days (
            day  TEXT PRIMARY KEY,
            time REAL NOT NULL DEFAULT 0
         );
         -- listen_sessions: one row per continuous local playback of one item or
         -- episode — powers the Recent sessions list. Pruned to the newest ~100
         -- on write; day aggregates live in listen_days, so pruning loses nothing.
         CREATE TABLE IF NOT EXISTS listen_sessions (
            id             TEXT PRIMARY KEY,
            item_id        TEXT NOT NULL,
            episode_id     TEXT NOT NULL DEFAULT '',
            display_title  TEXT NOT NULL DEFAULT '',
            date           TEXT NOT NULL DEFAULT '',
            time_listening REAL NOT NULL DEFAULT 0,
            updated_at     INTEGER NOT NULL
         );",
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

/// Generate a stable, path-independent item id. Catalog-assigned at first INSERT
/// so a later re-file (which changes the folder path) keeps the same id, and the
/// progress/bookmarks keyed by id survive. Seeded with the source path plus a
/// monotonic counter + wall-clock nanos to avoid collisions within a scan.
pub(crate) fn new_item_id(seed: &str) -> String {
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
    fn delete_local_episode_flips_download_state_and_clears_progress() {
        let (dir, conn) = test_conn();
        let parent = dir.path().to_string_lossy().into_owned();
        let lib = create_library_conn(&conn, "Pods", &parent, "podcast").unwrap();
        let lib_id = lib["id"].as_str().unwrap().to_string();

        let feed = json!({
            "metadata": { "title": "Show" },
            "episodes": [json!({ "guid": "g1", "title": "One", "enclosure": { "url": "https://x/g1.mp3" } })],
        });
        let (pod_id, _, _) = subscribe_podcast_conn(&conn, &lib_id, &feed, "https://x/feed.xml", false).unwrap();

        // Download the episode to a real temp file and give it progress.
        let audio = dir.path().join("one.mp3");
        std::fs::write(&audio, b"mp3").unwrap();
        set_episode_downloaded_conn(&conn, &pod_id, "g1", &audio.to_string_lossy()).unwrap();
        let items = list_podcast_items_conn(&conn, &lib_id).unwrap();
        let ep_id = items[0]["media"]["episodes"][0]["id"].as_str().unwrap().to_string();
        set_progress_conn(&conn, &pod_id, Some(&ep_id), 120.0, 1800.0, false).unwrap();

        delete_local_episode_conn(&conn, &pod_id, &ep_id).unwrap();

        // File gone; row kept (guid dedupe) but back to not-downloaded; progress cleared.
        assert!(!audio.exists(), "audio file must be deleted");
        let (dl, path, guid): (i64, Option<String>, String) = conn
            .query_row(
                "SELECT downloaded, audio_path, guid FROM podcast_episodes WHERE id = ?1",
                params![ep_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!((dl, path), (0, None), "episode must return to not-downloaded");
        assert_eq!(guid, "g1", "feed identity must survive the delete");
        assert!(get_progress_conn(&conn, &pod_id, Some(&ep_id)).unwrap().is_none());

        // A second delete (already not-downloaded) is a no-op, not an error;
        // an unknown episode id is a real error.
        delete_local_episode_conn(&conn, &pod_id, &ep_id).unwrap();
        assert!(delete_local_episode_conn(&conn, &pod_id, "nope").is_err());
    }

    #[test]
    fn listen_time_accumulates_days_and_sessions() {
        let (_dir, conn) = test_conn();
        insert_item(&conn, "b1", "lib1", r#"{"media":{"metadata":{"title":"My Book"}}}"#);

        // Two flushes of one session on one day accumulate both aggregates;
        // a second session on another day stays separate.
        add_listen_time_conn(&conn, "s1", "b1", None, 30.0, "2026-07-09").unwrap();
        add_listen_time_conn(&conn, "s1", "b1", None, 15.0, "2026-07-09").unwrap();
        add_listen_time_conn(&conn, "s2", "b1", None, 60.0, "2026-07-10").unwrap();
        // Zero-second flushes are no-ops (no phantom day/session rows).
        add_listen_time_conn(&conn, "s3", "b1", None, 0.0, "2026-07-11").unwrap();

        let stats = get_listening_stats_conn(&conn).unwrap();
        assert_eq!(stats["totalTime"], json!(105.0));
        assert_eq!(stats["numDaysListened"], json!(2));
        assert_eq!(stats["days"]["2026-07-09"], json!(45.0));
        assert_eq!(stats["days"]["2026-07-10"], json!(60.0));

        let sessions = stats["recentSessions"].as_array().unwrap();
        assert_eq!(sessions.len(), 2);
        // Newest first (rowid breaks same-millisecond updated_at ties); the
        // title is resolved from the items table at write time.
        assert_eq!(sessions[0]["id"], json!("s2"));
        assert_eq!(sessions[0]["displayTitle"], json!("My Book"));
        assert_eq!(sessions[1]["timeListening"], json!(45.0));

        // Finished/listened counts derive from whole-item progress rows.
        set_progress_conn(&conn, "b1", None, 3600.0, 3600.0, true).unwrap();
        let stats = get_listening_stats_conn(&conn).unwrap();
        assert_eq!(stats["numBooksFinished"], json!(1));
        assert_eq!(stats["numBooksListened"], json!(1));
    }

    #[test]
    fn listen_sessions_prune_to_newest_hundred() {
        let (_dir, conn) = test_conn();
        for i in 0..105 {
            add_listen_time_conn(&conn, &format!("s{i}"), "b1", None, 10.0, "2026-07-09").unwrap();
        }
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM listen_sessions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 100, "sessions must prune to the newest 100");
        // The earliest sessions are the ones dropped (rowid tiebreak).
        let oldest: i64 = conn
            .query_row("SELECT COUNT(*) FROM listen_sessions WHERE id = 's0'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(oldest, 0);
        // Day totals are untouched by session pruning.
        let stats = get_listening_stats_conn(&conn).unwrap();
        assert_eq!(stats["totalTime"], json!(1050.0));
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
