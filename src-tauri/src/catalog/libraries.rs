// catalog/libraries.rs — local library CRUD/config, folder-walk scan, and item
// listing. Split verbatim from catalog.rs (God-File Decomposition roadmap, L3/L7).
use super::*;

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
pub(crate) fn create_library_conn(conn: &Connection, name: &str, parent_path: &str, media_type: &str) -> Result<Value, String> {
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
pub(crate) fn podcasts_root(conn: &Connection, library_id: &str) -> Result<PathBuf, String> {
    Ok(Path::new(&library_root(conn, library_id)?).join(PODCASTS_DIR))
}

pub fn list_libraries() -> Result<Vec<Value>, String> {
    let conn = open()?;
    list_libraries_conn(&conn)
}

pub(crate) fn list_libraries_conn(conn: &Connection) -> Result<Vec<Value>, String> {
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

pub(crate) fn delete_library_conn(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM items WHERE library_id = ?1", params![id])
        .map_err(|e| format!("delete library items: {e}"))?;
    conn.execute("DELETE FROM libraries WHERE id = ?1", params![id])
        .map_err(|e| format!("delete library: {e}"))?;
    log::info!(target: "skald::library", "catalog: delete library id={id}");
    Ok(())
}

pub(crate) fn library_root(conn: &Connection, id: &str) -> Result<String, String> {
    conn.query_row(
        "SELECT root_path FROM libraries WHERE id = ?1",
        params![id],
        |r| r.get::<_, String>(0),
    )
    .map_err(|e| format!("library root lookup: {e}"))
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

pub(crate) fn list_items_conn(conn: &Connection, library_id: &str) -> Result<Vec<Value>, String> {
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

