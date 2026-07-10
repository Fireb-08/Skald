// Split from the original single-file commands.rs (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. Shared imports and state types
// come from the parent module (mod.rs) via the glob below.
use super::*;

// ── Local progress & bookmarks (Local Library roadmap, Phase 4) ──────────────

#[tauri::command]
pub async fn get_local_progress(
    item_id: String,
    episode_id: Option<String>,
) -> Result<Option<serde_json::Value>, String> {
    tokio::task::spawn_blocking(move || {
        crate::catalog::get_progress(&item_id, episode_id.as_deref())
    })
    .await
    .map_err(|e| format!("get_local_progress task panicked: {e}"))?
}

/// Set local-library playback progress for an item — used by user actions like
/// "Mark as Finished" that write the catalog outside the playback tick loop.
#[tauri::command]
pub async fn set_local_progress(
    item_id: String,
    episode_id: Option<String>,
    current_time: f64,
    duration: f64,
    is_finished: bool,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        crate::catalog::set_progress(
            &item_id,
            episode_id.as_deref(),
            current_time,
            duration,
            is_finished,
        )
    })
    .await
    .map_err(|e| format!("set_local_progress task panicked: {e}"))?
}

#[tauri::command]
pub async fn get_local_library_progress(
    library_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    tokio::task::spawn_blocking(move || crate::catalog::list_progress(&library_id))
        .await
        .map_err(|e| format!("get_local_library_progress task panicked: {e}"))?
}

#[tauri::command]
pub async fn add_local_bookmark(
    item_id: String,
    title: String,
    time: f64,
) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || crate::catalog::add_bookmark(&item_id, &title, time))
        .await
        .map_err(|e| format!("add_local_bookmark task panicked: {e}"))?
}

#[tauri::command]
pub async fn get_local_bookmarks(item_id: String) -> Result<Vec<serde_json::Value>, String> {
    tokio::task::spawn_blocking(move || crate::catalog::list_bookmarks(&item_id))
        .await
        .map_err(|e| format!("get_local_bookmarks task panicked: {e}"))?
}

#[tauri::command]
pub async fn delete_local_bookmark(id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || crate::catalog::delete_bookmark(&id))
        .await
        .map_err(|e| format!("delete_local_bookmark task panicked: {e}"))?
}

// ── Local listening stats (Local Listening Stats roadmap) ────────────────────

/// Aggregate catalog-tracked local listening into the same UserStats shape the
/// server returns from GET /api/me/listening-stats, so GreetingPane can render
/// it directly or merge it with the server payload.
#[tauri::command]
pub async fn get_local_listening_stats() -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(crate::catalog::get_listening_stats)
        .await
        .map_err(|e| format!("get_local_listening_stats task panicked: {e}"))?
}

// ── Local covers (Local Library roadmap, Phase 8) ────────────────────────────

/// Resolve a local item's cover (sidecar image or embedded art), resize to 400px,
/// cache it, and return the on-disk path (the frontend loads it via asset://,
/// exactly like ABS covers). Errors when the item has no cover — the caller then
/// falls back to the generated template.
#[tauri::command]
pub async fn get_local_cover(item_id: String, bust: Option<u32>) -> Result<String, String> {
    let version = bust.unwrap_or(0);
    if cover_cache::is_cached(&item_id, Some(400), version) {
        return Ok(cover_cache::cache_path(&item_id, Some(400), version)
            .to_string_lossy()
            .into_owned());
    }
    let id_for_path = item_id.clone();
    let bytes = tokio::task::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let dir = crate::catalog::get_item_path(&id_for_path)?
            .ok_or_else(|| "item has no path".to_string())?;
        let raw = crate::scanner::find_cover_bytes(std::path::Path::new(&dir))
            .ok_or_else(|| "no cover found".to_string())?;
        let img = image::load_from_memory(&raw).map_err(|e| format!("decode cover: {e}"))?;
        // thumbnail preserves aspect within 400×400; covers render square via CSS.
        let small = img.thumbnail(400, 400);
        let mut buf = std::io::Cursor::new(Vec::new());
        small
            .write_to(&mut buf, image::ImageFormat::Jpeg)
            .map_err(|e| format!("encode cover: {e}"))?;
        Ok(buf.into_inner())
    })
    .await
    .map_err(|e| format!("local cover task panicked: {e}"))??;
    cover_cache::save_cover(&item_id, Some(400), version, &bytes)?;
    Ok(cover_cache::cache_path(&item_id, Some(400), version)
        .to_string_lossy()
        .into_owned())
}

/// (Re)start watching the given staging folders; emits `staging-changed` events.
/// Pass an empty list to stop watching. (Local Library roadmap, Phase 7.)
#[tauri::command]
pub fn start_staging_watch(
    paths: Vec<String>,
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::watcher::StagingWatcher>,
) -> Result<(), String> {
    crate::watcher::start(paths, app, &state)
}

// ── Local match flow (Local Library roadmap, Phase 5) ────────────────────────

/// Search a metadata provider directly (server-free) for match candidates.
#[tauri::command]
pub async fn search_metadata(
    query: String,
    provider: String,
    region: Option<String>,
) -> Result<Vec<serde_json::Value>, String> {
    crate::providers::search(&query, &provider, region.as_deref()).await
}

/// List the books in a local library's `_Unidentified` folder awaiting a match.
#[tauri::command]
pub async fn get_unidentified_items(
    library_id: String,
) -> Result<Vec<crate::scanner::ScannedItem>, String> {
    tokio::task::spawn_blocking(move || crate::catalog::get_unidentified(&library_id))
        .await
        .map_err(|e| format!("get_unidentified_items task panicked: {e}"))?
}

/// Apply user-edited metadata to an existing catalogued local item (Match review
/// or Edit Metadata). Writes the catalog (the source of truth), re-files the
/// folder when the identity changed, downloads the chosen cover (best-effort),
/// then returns the updated item so the frontend can patch it in place — no
/// re-scan. `fields` is an optional-keyed metadata object (title, subtitle,
/// authorName, narratorName, seriesName, seriesSequence, publisher, publishedYear,
/// genres, tags, language, isbn, asin, description).
#[tauri::command]
pub async fn apply_local_metadata(
    library_id: String,
    item_id: String,
    fields: serde_json::Value,
    cover_url: Option<String>,
) -> Result<serde_json::Value, String> {
    let has_cover = cover_url.is_some();
    let id_for_clear = item_id.clone();
    let (lib, id, f) = (library_id, item_id, fields);
    let (item, target) = tokio::task::spawn_blocking(move || {
        crate::catalog::apply_metadata(&lib, &id, &f, has_cover)
    })
    .await
    .map_err(|e| format!("apply_metadata task panicked: {e}"))??;

    if let Some(url) = cover_url {
        let dest = std::path::Path::new(&target).join("cover.jpg");
        let _ = crate::providers::download_cover(&url, &dest).await;
        // Drop the stale cached thumbnail so the next fetch re-extracts the new art.
        crate::cover_cache::clear(&id_for_clear);
    }
    Ok(item)
}

/// Replace the chapter markers on a catalogued local item (Local Chapter
/// Write-Back roadmap). The catalog is authoritative (immediate effect); when
/// `write_to_file` is set, the chapters are also written into the single audio
/// file via `tone` so they survive a re-scan (best-effort). Returns
/// `{ item, fileWarning }` — `fileWarning` is a non-null soft message when the
/// optional file write couldn't complete (the catalog edit still applied).
#[tauri::command]
pub async fn set_local_chapters(
    item_id: String,
    chapters: serde_json::Value,
    write_to_file: bool,
) -> Result<serde_json::Value, String> {
    let (item, warning) = tokio::task::spawn_blocking(move || {
        crate::catalog::set_item_chapters(&item_id, chapters, write_to_file)
    })
    .await
    .map_err(|e| format!("set_local_chapters task panicked: {e}"))??;
    Ok(serde_json::json!({ "item": item, "fileWarning": warning }))
}

/// Apply a chosen match to a quarantined (Unidentified) book: file it into
/// Author/Series/Title, insert a catalogued item carrying the chosen metadata,
/// download the cover (best-effort), then return the new item. No re-scan.
#[tauri::command]
pub async fn file_and_insert_local_match(
    library_id: String,
    source_path: String,
    fields: serde_json::Value,
    cover_url: Option<String>,
) -> Result<serde_json::Value, String> {
    let has_cover = cover_url.is_some();
    let (lib, sp, f) = (library_id, source_path, fields);
    let (item, target) = tokio::task::spawn_blocking(move || {
        crate::catalog::file_and_insert(&lib, &sp, &f, has_cover)
    })
    .await
    .map_err(|e| format!("file_and_insert task panicked: {e}"))??;

    if let Some(url) = cover_url {
        let dest = std::path::Path::new(&target).join("cover.jpg");
        let _ = crate::providers::download_cover(&url, &dest).await;
        if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
            crate::cover_cache::clear(id);
        }
    }
    Ok(item)
}

/// Permanently delete a local item (files + catalog row + progress/bookmarks).
#[tauri::command]
pub async fn delete_local_item(item_id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || crate::catalog::delete_item(&item_id))
        .await
        .map_err(|e| format!("delete_local_item task panicked: {e}"))?
}

/// Scan a local folder and return ABS-shaped library items (Local Library
/// roadmap, Phase 1). Runs on a blocking thread so a large scan never stalls the
/// async runtime. `library_id` tags the emitted items so they slot into a local
/// library; defaults to "local" for the standalone spike.
#[tauri::command]
pub async fn scan_folder(
    path: String,
    library_id: Option<String>,
) -> Result<Vec<crate::scanner::ScannedItem>, String> {
    let lib = library_id.unwrap_or_else(|| "local".to_string());
    tokio::task::spawn_blocking(move || crate::scanner::scan_folder(&path, &lib))
        .await
        .map_err(|e| format!("scan task panicked: {e}"))?
}

// ── Local library catalog (Local Library roadmap, Phase 2) ───────────────────
// Each command runs the (blocking) SQLite/scan work on a blocking thread so the
// async runtime is never stalled. Returns ABS-shaped JSON the frontend consumes.

#[tauri::command]
pub async fn create_local_library(
    name: String,
    parent_path: String,
    // "book" (default) or "podcast" — selects the local media type.
    media_type: Option<String>,
) -> Result<serde_json::Value, String> {
    let mt = media_type.unwrap_or_else(|| "book".to_string());
    tokio::task::spawn_blocking(move || crate::catalog::create_library(&name, &parent_path, &mt))
        .await
        .map_err(|e| format!("create_local_library task panicked: {e}"))?
}

#[tauri::command]
pub async fn get_local_libraries() -> Result<Vec<serde_json::Value>, String> {
    tokio::task::spawn_blocking(crate::catalog::list_libraries)
        .await
        .map_err(|e| format!("get_local_libraries task panicked: {e}"))?
}

#[tauri::command]
pub async fn delete_local_library(id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || crate::catalog::delete_library(&id))
        .await
        .map_err(|e| format!("delete_local_library task panicked: {e}"))?
}

#[tauri::command]
pub async fn scan_local_library(
    library_id: String,
    app: tauri::AppHandle,
) -> Result<usize, String> {
    tokio::task::spawn_blocking(move || {
        let event_library_id = library_id.clone();
        crate::catalog::scan_library_with_progress(
            &library_id,
            |phase, processed, total, current| {
                let current_item = current
                    .and_then(|path| std::path::Path::new(path).file_name())
                    .and_then(|name| name.to_str());
                let _ = app.emit(
                    "local-scan-progress",
                    serde_json::json!({
                        "libraryId": &event_library_id,
                        "phase": phase,
                        "processed": processed,
                        "total": total,
                        "currentItem": current_item,
                    }),
                );
            },
        )
    })
    .await
    .map_err(|e| format!("scan_local_library task panicked: {e}"))?
}

#[tauri::command]
pub async fn get_local_library_items(library_id: String) -> Result<Vec<serde_json::Value>, String> {
    tokio::task::spawn_blocking(move || crate::catalog::list_items(&library_id))
        .await
        .map_err(|e| format!("get_local_library_items task panicked: {e}"))?
}

// ── Local library ingest (Local Library roadmap, Phase 3) ────────────────────

/// Ingest source paths (folders/files) into a local library's managed tree —
/// filing identified books as Author/Series/Title and quarantining the rest.
#[tauri::command]
pub async fn ingest_local_paths(
    library_id: String,
    sources: Vec<String>,
) -> Result<Vec<crate::ingest::IngestOutcome>, String> {
    tokio::task::spawn_blocking(move || crate::catalog::ingest(&library_id, &sources))
        .await
        .map_err(|e| format!("ingest_local_paths task panicked: {e}"))?
}

/// Auto-distribute everything in a local library's staging folder (always moves,
/// so staging empties). Triggered by the staging watcher and the manual button.
#[tauri::command]
pub async fn auto_ingest_staging(
    library_id: String,
) -> Result<Vec<crate::ingest::IngestOutcome>, String> {
    tokio::task::spawn_blocking(move || crate::catalog::ingest_staging(&library_id))
        .await
        .map_err(|e| format!("auto_ingest_staging task panicked: {e}"))?
}

/// Update a local library's ingest config (staging folder, copy/move mode).
#[tauri::command]
pub async fn set_local_library_config(
    library_id: String,
    staging_path: Option<String>,
    organize_mode: Option<String>,
) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        crate::catalog::set_config(
            &library_id,
            staging_path.as_deref(),
            organize_mode.as_deref(),
        )
    })
    .await
    .map_err(|e| format!("set_local_library_config task panicked: {e}"))?
}
