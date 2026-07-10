// catalog/items.rs — ingest entry points, the unidentified/match queue,
// metadata apply + chapter write-back, re-filing, and item deletion.
// Split verbatim from catalog.rs (God-File Decomposition roadmap, L3/L7).
use super::*;

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

