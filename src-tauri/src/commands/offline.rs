// Split from the original single-file commands.rs (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. Shared imports and state types
// come from the parent module (mod.rs) via the glob below.
use super::*;

// Close an async file handle and delete the file from disk.
// On Windows, an open file handle prevents remove_file from succeeding, so the
// handle must be fully released first. into_std() hands the async wrapper back
// to blocking I/O; dropping the returned std::fs::File closes the OS handle.
// Used by every error/cancel path in download_item.
async fn delete_partial(file: tokio::fs::File, path: &std::path::Path) {
    drop(file.into_std().await);
    let _ = std::fs::remove_file(path);
}

#[tauri::command]
pub fn get_cache_dir() -> Result<String, String> {
    // Delegates to paths so a user relocation (set_cache_dir) is reflected here.
    Ok(paths::cache_dir()?.to_string_lossy().into_owned())
}

/// Absolute path of the downloads directory — where offline audio files actually
/// live. Distinct from get_cache_dir (offline library cache + covers); the
/// Downloads settings "Location" shows this so it points at the real files.
#[tauri::command]
pub fn get_downloads_dir() -> Result<String, String> {
    Ok(downloads::downloads_dir()?.to_string_lossy().into_owned())
}

/// Open the downloads directory in the OS file explorer, creating it if needed.
#[tauri::command]
pub fn reveal_downloads_dir() -> Result<(), String> {
    let dir = downloads::downloads_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::process::Command::new("explorer")
        .arg(&dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// Recursively copy a directory tree (used as the cross-volume fallback for
// move_dir_contents — std::fs::rename fails across drives on Windows).
fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| format!("Create dir failed: {e}"))?;
    for entry in std::fs::read_dir(src).map_err(|e| format!("Read dir failed: {e}"))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let s = entry.path();
        let d = dst.join(entry.file_name());
        if s.is_dir() {
            copy_dir_all(&s, &d)?;
        } else {
            std::fs::copy(&s, &d).map_err(|e| format!("Copy failed: {e}"))?;
        }
    }
    Ok(())
}

// Normalize a path for comparison: lowercased, forward slashes folded to back
// slashes, trailing separators trimmed. Windows paths are case-insensitive, so
// this lets us reliably detect "same folder" and "nested folder" regardless of
// casing or a trailing slash from the OS folder picker.
fn norm_path(p: &std::path::Path) -> String {
    p.to_string_lossy().replace('/', "\\").trim_end_matches('\\').to_lowercase()
}

// Classify the relationship between a current root `old` and a requested `new`:
// returns Ok(true) when they are the same folder (caller should no-op), Err when
// one is nested inside the other (moving would drop a directory into itself), and
// Ok(false) when they are safely disjoint.
fn relocation_same_or_reject(old: &std::path::Path, new: &std::path::Path) -> Result<bool, String> {
    let (o, n) = (norm_path(old), norm_path(new));
    if o == n {
        return Ok(true);
    }
    if n.starts_with(&format!("{o}\\")) || o.starts_with(&format!("{n}\\")) {
        return Err("Pick a folder that isn't inside (or a parent of) the current one.".into());
    }
    Ok(false)
}

// Move everything inside `from` into `to`, creating `to` first. A fast rename is
// attempted per child; on failure (e.g. a different volume) it falls back to a
// recursive copy + delete so relocation works across drives. A non-existent
// source is a no-op (nothing has been downloaded/cached yet).
fn move_dir_contents(from: &std::path::Path, to: &std::path::Path) -> Result<(), String> {
    if !from.exists() {
        return Ok(());
    }
    std::fs::create_dir_all(to).map_err(|e| format!("Create dir failed: {e}"))?;
    for entry in std::fs::read_dir(from).map_err(|e| format!("Read dir failed: {e}"))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let src = entry.path();
        let dst = to.join(entry.file_name());
        if std::fs::rename(&src, &dst).is_err() {
            if src.is_dir() {
                copy_dir_all(&src, &dst)?;
                std::fs::remove_dir_all(&src).map_err(|e| format!("Remove failed: {e}"))?;
            } else {
                std::fs::copy(&src, &dst).map_err(|e| format!("Copy failed: {e}"))?;
                std::fs::remove_file(&src).map_err(|e| format!("Remove failed: {e}"))?;
            }
        }
    }
    Ok(())
}

/// Relocate the downloads root to `path` (First-Launch Onboarding roadmap, Phase 4
/// / gap #1). Moves existing downloads + the registry into the new folder, rewrites
/// each registry record's absolute file_path from the old prefix to the new one so
/// offline playback still resolves, then persists the override last — once saved,
/// all future resolutions point at the new location.
#[tauri::command]
pub fn set_downloads_dir(path: String) -> Result<(), String> {
    let new = std::path::PathBuf::from(path.trim());
    if new.as_os_str().is_empty() {
        return Err("A folder is required.".into());
    }
    let old = downloads::downloads_dir()?;
    if relocation_same_or_reject(&old, &new)? {
        return Ok(()); // same folder — leave everything as-is
    }
    log::info!(target: "skald::app", "set_downloads_dir start");
    move_dir_contents(&old, &new)?;
    // Repoint registry file paths (old prefix → new prefix). load/save operate on
    // the directory we pass, so read+write the registry now living under `new`.
    let old_s = old.to_string_lossy().to_string();
    let new_s = new.to_string_lossy().to_string();
    let mut records = downloads::load_registry(&new);
    for r in records.iter_mut() {
        if let Some(rest) = r.file_path.strip_prefix(&old_s) {
            r.file_path = format!("{new_s}{rest}");
        }
    }
    downloads::save_registry(&new, &records)?;
    paths::set_downloads_override(&new_s)?;
    log::info!(target: "skald::app", "set_downloads_dir success — {} record(s) repointed", records.len());
    Ok(())
}

/// Relocate the cover/library cache root to `path` (Onboarding roadmap, Phase 4 /
/// gap #1; Settings-only per Resolved decisions #2). Moves existing cache files
/// (covers, library cache, chapter caches) then persists the override. No registry
/// rewrite is needed — cache entries are resolved by computed path each lookup.
#[tauri::command]
pub fn set_cache_dir(path: String, app: tauri::AppHandle) -> Result<(), String> {
    let new = std::path::PathBuf::from(path.trim());
    if new.as_os_str().is_empty() {
        return Err("A folder is required.".into());
    }
    let old = paths::cache_dir()?;
    if relocation_same_or_reject(&old, &new)? {
        return Ok(());
    }
    log::info!(target: "skald::app", "set_cache_dir start");
    move_dir_contents(&old, &new)?;
    paths::set_cache_override(&new.to_string_lossy())?;
    match cover_cache::allow_asset_scope(&app) {
        Ok(dir) => log::info!(target: "skald::app", "cover cache asset scope allowed {}", dir.display()),
        Err(e) => log::warn!(target: "skald::app", "cover cache asset scope failed after relocation: {e}"),
    }
    log::info!(target: "skald::app", "set_cache_dir success");
    Ok(())
}

// Flush offline progress entries to the server after reconnecting.
// Uses latest-wins conflict resolution — the local recorded_at timestamp
// is not sent; we simply write what we have. If the server has newer
// progress (e.g. from another device used while offline), the server's
// value will be overwritten only if our recorded_at is more recent.
// For simplicity in v0.1.0, always write local progress on reconnect.
#[tauri::command]
pub async fn flush_offline_progress(server_url: String) -> Result<u32, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    let client = AbsClient::new(server_url).with_token(token);
    let dl_dir = downloads::downloads_dir()?;
    // Snapshot the queue before iterating so remove_progress_entry modifies the
    // file independently of our iteration — no borrow-checker conflict.
    let queue = downloads::load_progress_queue(&dl_dir);
    if queue.is_empty() { return Ok(0); }
    // Snapshot the server's current progress once for last-write-wins conflict
    // resolution. The offline queue is book-only (no episode id), so map book-level
    // (episodeId == null) records by library item id. If the snapshot can't be
    // fetched (still offline / transient error), proceed without the guard — a
    // best-effort flush is better than stranding progress, and the guard only
    // prevents *regressions*, never forward progress.
    let server_last_update: std::collections::HashMap<String, i64> = match client.get_me().await {
        Ok(me) => me
            .media_progress
            .into_iter()
            .filter(|p| p.episode_id.is_none())
            .map(|p| (p.library_item_id, p.last_update))
            .collect(),
        Err(_) => std::collections::HashMap::new(),
    };
    let mut flushed: u32 = 0;
    for entry in &queue {
        // Local-library items (id prefix "local_") have no server counterpart —
        // their progress lives in the catalog, so never attempt to flush them.
        if entry.item_id.starts_with("local_") { continue; }
        // Skip (and drop) any queued entry the server has already superseded with a
        // newer update — e.g. the user listened on another device while this one was
        // offline. Without this, a stale local position would clobber the newer
        // server one on reconnect.
        if let Some(&server_lu) = server_last_update.get(&entry.item_id) {
            if server_lu >= entry.recorded_at {
                let _ = downloads::remove_progress_entry(&dl_dir, &entry.item_id, entry.recorded_at);
                continue;
            }
        }
        // Offline downloads are book-only (the queue carries no episode id), so
        // episode_id is None here — see OfflineProgressEntry in downloads.rs.
        match client.update_progress(&entry.item_id, None, entry.current_time, entry.duration, entry.is_finished).await {
            Ok(()) => {
                // Remove only after a confirmed server write — and only the exact
                // entry we sent (matched on recorded_at), so a newer position the
                // tick loop queued mid-flush isn't dropped.
                let _ = downloads::remove_progress_entry(&dl_dir, &entry.item_id, entry.recorded_at);
                flushed += 1;
            }
            Err(_) => {
                // Non-fatal — entry stays in the queue for the next flush.
            }
        }
    }
    Ok(flushed)
}

// Marks a downloaded book as server-deleted — the item was removed from the
// ABS server but the local audio file still exists and is playable offline.
// The badge on the book cover changes from brass ↓ to amber ! to indicate this.
// Called from the library-item-removed socket event handler in the frontend.
#[tauri::command]
pub fn mark_server_deleted(item_id: String) -> Result<(), String> {
    let dir = downloads::downloads_dir()?;
    downloads::set_server_deleted(&dir, &item_id, true)
}

// Returns the offline progress queue entry for a specific item, or None if
// no entry exists. Used by the offline playback path to restore the last
// known position when st.mediaProgress is empty (server unreachable and no
// cached server progress available).
#[tauri::command]
pub fn get_offline_progress(item_id: String) -> Result<Option<downloads::OfflineProgressEntry>, String> {
    let dl_dir = downloads::downloads_dir()?;
    let queue = downloads::load_progress_queue(&dl_dir);
    // upsert_progress_entry keeps at most one entry per item_id, so find() is sufficient.
    Ok(queue.into_iter().find(|e| e.item_id == item_id))
}

// Saves chapter data for a specific item to a per-item JSON cache file.
// Called after every successful fetchItem so offline playback has chapters.
// Stored separately from the library cache because the bulk library endpoint
// returns chapters: [] — only the single-item fetchItem response has real data.
#[tauri::command]
pub async fn save_chapter_cache(
    item_id: String,
    chapters: serde_json::Value,
) -> Result<(), String> {
    let cache_path = std::path::PathBuf::from(get_cache_dir()?)
        .join(format!("chapters_{}.json", item_id));
    // Ensure the cache directory exists before writing — get_cache_dir() resolves
    // the path but does not create it.
    std::fs::create_dir_all(cache_path.parent().unwrap_or(&cache_path))
        .map_err(|e| format!("Create dir failed: {e}"))?;
    let json = serde_json::to_string(&chapters)
        .map_err(|e| format!("Serialize failed: {e}"))?;
    std::fs::write(&cache_path, json)
        .map_err(|e| format!("Write failed: {e}"))?;
    Ok(())
}

// Loads chapter data for a specific item from the per-item cache file.
// Returns None if no cache exists yet (e.g. the book was never opened online).
#[tauri::command]
pub async fn load_chapter_cache(
    item_id: String,
) -> Result<Option<serde_json::Value>, String> {
    let cache_path = std::path::PathBuf::from(get_cache_dir()?)
        .join(format!("chapters_{}.json", item_id));
    // Missing file is normal on first offline launch — not an error.
    if !cache_path.exists() { return Ok(None); }
    let json = std::fs::read_to_string(&cache_path)
        .map_err(|e| format!("Read failed: {e}"))?;
    let val = serde_json::from_str(&json)
        .map_err(|e| format!("Parse failed: {e}"))?;
    Ok(Some(val))
}

// Saves the library to a local JSON cache file so it can be loaded
// when the server is unreachable on next launch.
#[tauri::command]
pub async fn save_library_cache(items: Vec<serde_json::Value>) -> Result<(), String> {
    let cache_path = std::path::PathBuf::from(get_cache_dir()?).join("library_cache.json");
    // get_cache_dir() resolves the path but does not create the directory.
    std::fs::create_dir_all(cache_path.parent().unwrap_or(&cache_path))
        .map_err(|e| format!("Create dir failed: {e}"))?;
    let json = serde_json::to_string(&items)
        .map_err(|e| format!("Serialize failed: {e}"))?;
    std::fs::write(&cache_path, json)
        .map_err(|e| format!("Write failed: {e}"))?;
    Ok(())
}

// Loads the library from the local cache file.
// Returns an empty array if no cache exists yet.
#[tauri::command]
pub async fn load_library_cache() -> Result<Vec<serde_json::Value>, String> {
    let cache_path = std::path::PathBuf::from(get_cache_dir()?).join("library_cache.json");
    // No cache on first launch — return an empty list so callers can distinguish
    // "no cache" from "cache exists but is empty".
    if !cache_path.exists() { return Ok(vec![]); }
    let json = std::fs::read_to_string(&cache_path)
        .map_err(|e| format!("Read failed: {e}"))?;
    serde_json::from_str(&json)
        .map_err(|e| format!("Parse failed: {e}"))
}

/// Streams GET /api/items/{id}/download to a local file in the app's downloads directory.
/// Chunks the response body so multi-GB audiobooks never exhaust memory.
/// Emits download-progress events per chunk, download-complete on success,
/// download-cancelled on user cancel, and download-failed on network/write errors.
/// Partial files are always cleaned up on any non-successful exit path.
#[tauri::command]
pub async fn download_item(
    server_url: String,
    item_id: String,
    file_name: String,
    title: String,            // included in progress events and stored in the registry
    author: String,           // stored in the registry for the Downloads settings list
    app_handle: tauri::AppHandle,
    cancel_registry: tauri::State<'_, downloads::DownloadCancelRegistry>,
) -> Result<String, String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;

    // Resolve and create the downloads directory (e.g. AppData\Local\Skald\data\downloads).
    let dl_dir = downloads::downloads_dir()?;
    std::fs::create_dir_all(&dl_dir)
        .map_err(|e| format!("Failed to create downloads directory: {e}"))?;

    // Sanitise the caller-supplied file name to prevent path-traversal attacks.
    let safe_name = file_name.replace(['/', '\\', ':'], "_");
    let file_path = dl_dir.join(&safe_name);

    // Create a cancellation token for this download and insert it into the shared
    // registry so cancel_download() can signal this stream loop by item_id.
    // The token is cloned into the registry; the original is checked in the loop.
    let cancel_token = CancellationToken::new();
    cancel_registry.lock().await.insert(item_id.clone(), cancel_token.clone());

    // The token-in-header pattern is fine for file downloads (unlike media streaming
    // where we use token-in-URL per CLAUDE.md critical lesson 2). The bounded
    // client's read-stall timeout is per-chunk, so multi-GB downloads are safe.
    let client = crate::api::bounded_client();

    // If the HTTP request itself fails, remove the registry entry before returning.
    let response = match client
        .get(format!("{}/api/items/{}/download", server_url.trim_end_matches('/'), item_id))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            cancel_registry.lock().await.remove(&item_id);
            return Err(format!("Download request failed: {e}"));
        }
    };

    // Non-2xx status — clean up registry and report.
    if !response.status().is_success() {
        cancel_registry.lock().await.remove(&item_id);
        return Err(format!("Download failed: HTTP {}", response.status()));
    }

    // 0 signals an unknown length — frontend shows an indeterminate progress bar.
    let total_bytes = response.content_length().unwrap_or(0);

    // Signal the start immediately so the progress toast appears before the first chunk.
    let _ = app_handle.emit("download-progress", serde_json::json!({
        "itemId": item_id,
        "title": title,
        "bytesDownloaded": 0u64,
        "totalBytes": total_bytes,
    }));

    // Create the output file. Clean up registry on failure (no partial file yet).
    let mut file = match tokio::fs::File::create(&file_path).await {
        Ok(f) => f,
        Err(e) => {
            cancel_registry.lock().await.remove(&item_id);
            return Err(format!("Failed to create file: {e}"));
        }
    };

    // ── Stream loop ───────────────────────────────────────────────────────────
    // An enum captures the reason the loop exited so file ownership can be
    // transferred to delete_partial() in error/cancel branches without hitting
    // the borrow checker's "potentially moved" restriction on loop variables.
    enum LoopExit {
        Done,
        Cancelled,
        NetworkError(String),
        WriteError(String),
    }

    let mut stream = response.bytes_stream();
    let mut bytes_downloaded: u64 = 0;

    let exit = loop {
        let chunk_result = stream.next().await;

        // Check cancellation at the top of each iteration before processing the chunk.
        // CancellationToken::is_cancelled() is a lock-free atomic read — no await needed.
        if cancel_token.is_cancelled() {
            break LoopExit::Cancelled;
        }

        let chunk = match chunk_result {
            None => break LoopExit::Done, // stream exhausted — all bytes received
            Some(Ok(c)) => c,
            Some(Err(e)) => break LoopExit::NetworkError(format!("Network error: {e}")),
        };

        bytes_downloaded += chunk.len() as u64;

        if let Err(e) = file.write_all(&chunk).await {
            // Detect disk-full before falling through to the generic write error.
            // OS error 112 is ERROR_DISK_FULL on Windows; 28 is ENOSPC on Linux/macOS.
            let msg = if let Some(os_err) = e.raw_os_error() {
                if os_err == 112 || os_err == 28 {
                    "Not enough disk space to complete the download.".to_string()
                } else {
                    format!("Write error: {e}")
                }
            } else {
                format!("Write error: {e}")
            };
            break LoopExit::WriteError(msg);
        }

        // Fire-and-forget progress event — a slow frontend cannot stall the download.
        let _ = app_handle.emit("download-progress", serde_json::json!({
            "itemId": item_id,
            "title": title,
            "bytesDownloaded": bytes_downloaded,
            "totalBytes": total_bytes,
        }));
    };

    // ── Error/cancel cleanup ──────────────────────────────────────────────────
    // delete_partial() takes ownership of `file`, releases the OS handle via
    // into_std().await, then calls remove_file — required order on Windows
    // where an open handle blocks deletion.
    match exit {
        LoopExit::Cancelled => {
            delete_partial(file, &file_path).await;
            cancel_registry.lock().await.remove(&item_id);
            let _ = app_handle.emit("download-cancelled", serde_json::json!({
                "itemId": item_id,
                "title": title,
            }));
            return Err("cancelled".to_string());
        }
        LoopExit::NetworkError(msg) | LoopExit::WriteError(msg) => {
            delete_partial(file, &file_path).await;
            cancel_registry.lock().await.remove(&item_id);
            let _ = app_handle.emit("download-failed", serde_json::json!({
                "itemId": item_id,
                "title": title,
                "error": msg.clone(),
            }));
            return Err(msg);
        }
        // Normal completion — fall through to the flush + registry upsert below.
        LoopExit::Done => {}
    }

    // ── Normal completion ─────────────────────────────────────────────────────
    // Flush pending write-buffer bytes, then move the async handle into a
    // synchronous one so the OS file handle is released before metadata reads.
    let flush_result = file.flush().await;
    // into_std().await hands the file to the blocking thread pool; dropping the
    // returned std::fs::File closes the OS handle immediately.
    drop(file.into_std().await);

    if let Err(e) = flush_result {
        // Flush failed after all chunks were received — treat as a write failure.
        let _ = std::fs::remove_file(&file_path);
        cancel_registry.lock().await.remove(&item_id);
        let msg = format!("Flush error: {e}");
        let _ = app_handle.emit("download-failed", serde_json::json!({
            "itemId": item_id,
            "title": title,
            "error": msg.clone(),
        }));
        return Err(msg);
    }

    // ── ZIP extraction ────────────────────────────────────────────────────────
    // The ABS download endpoint returns a ZIP archive. Extract it into a
    // subdirectory named after item_id so multiple books never overwrite each
    // other's files even when they have identically-named tracks inside.
    // item_id is server-originated: sanitize it before use as a path component
    // so a malformed/hostile id (separators, "..") cannot escape the downloads
    // root — same posture as the file_name sanitization above. Normal ABS ids
    // are alphanumeric UUIDs, so this is a no-op for well-formed servers.
    let safe_item_dir: String = item_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '-' | '_') { c } else { '_' })
        .collect();
    if safe_item_dir.is_empty() {
        cancel_registry.lock().await.remove(&item_id);
        return Err("Download failed: empty item id".to_string());
    }
    let extract_dir = dl_dir.join(&safe_item_dir);
    std::fs::create_dir_all(&extract_dir)
        .map_err(|e| format!("Failed to create extract dir: {e}"))?;

    // Run extraction inside a closure so all failure branches share one cleanup
    // block rather than duplicating the remove_dir_all / remove_file calls.
    let zip_result: Result<(), String> = (|| {
        let zip_file = std::fs::File::open(&file_path)
            .map_err(|e| format!("Failed to open zip: {e}"))?;
        let mut archive = zip::ZipArchive::new(zip_file)
            .map_err(|e| format!("Failed to read zip: {e}"))?;

        for i in 0..archive.len() {
            let mut entry = archive.by_index(i)
                .map_err(|e| format!("Zip entry error: {e}"))?;
            // Skip directory entries — only extract regular files.
            if entry.is_dir() { continue; }
            // mangled_name() normalises path separators; .file_name() then strips
            // any leading path components to prevent path-traversal writes outside
            // extract_dir (e.g. a malicious entry named "../../evil.exe").
            let entry_name = entry.mangled_name();
            let entry_path = extract_dir.join(entry_name.file_name().unwrap_or_default());
            let mut out = std::fs::File::create(&entry_path)
                .map_err(|e| format!("Failed to create extracted file: {e}"))?;
            std::io::copy(&mut entry, &mut out)
                .map_err(|e| format!("Extraction error: {e}"))?;
        }
        Ok(())
    })();

    // On extraction failure: clean up whatever was partially written, remove the
    // ZIP, evict the registry token, and surface the error to the frontend.
    if let Err(e) = zip_result {
        let _ = std::fs::remove_dir_all(&extract_dir); // partial extracted files
        let _ = std::fs::remove_file(&file_path);      // the ZIP itself
        cancel_registry.lock().await.remove(&item_id);
        let _ = app_handle.emit("download-failed", serde_json::json!({
            "itemId": item_id,
            "title": title,
            "error": e.clone(),
        }));
        return Err(e);
    }

    // Delete the ZIP after successful extraction — the audio files are now in
    // extract_dir and the ZIP serves no further purpose.
    // Non-fatal: if removal fails (e.g. the file is transiently locked) the
    // download is still usable — log and continue rather than failing.
    let _ = std::fs::remove_file(&file_path);

    // ── Locate the primary audio file ─────────────────────────────────────────
    // Single-file books: the registry points directly to the audio file.
    // Multi-file books: the registry points to the directory; Phase D will scan
    // it and build a playlist sorted by file name (= chapter order for ABS exports).
    let audio_extensions = ["m4b", "mp3", "aac", "ogg", "flac", "opus", "m4a"];
    let mut audio_files: Vec<_> = std::fs::read_dir(&extract_dir)
        .map_err(|e| format!("Failed to read extract dir: {e}"))?
        .filter_map(|e| e.ok())
        .filter(|e| {
            // Retain only entries whose extension is a known audio format.
            e.path().extension()
                .and_then(|x| x.to_str())
                .map(|x| audio_extensions.contains(&x.to_lowercase().as_str()))
                .unwrap_or(false)
        })
        .collect();

    // Sort by file name so multi-file books play in chapter order.
    audio_files.sort_by_key(|e| e.file_name());

    let playback_path = if audio_files.len() == 1 {
        // Single file — point directly to the audio file.
        audio_files[0].path().to_string_lossy().to_string()
    } else {
        // Multi-file (or no recognised audio files) — point to the directory.
        // Phase D will scan the directory and build a VLC playlist from it.
        extract_dir.to_string_lossy().to_string()
    };

    // Sum the sizes of all extracted audio files for the storage display in Settings.
    // Falls back to bytes_downloaded if no audio files were found (edge case).
    let file_size: u64 = {
        let sum: u64 = audio_files.iter()
            .filter_map(|e| e.metadata().ok())
            .map(|m| m.len())
            .sum();
        if sum > 0 { sum } else { bytes_downloaded }
    };

    let downloaded_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    // Store the audio file path (or directory for multi-file books), not the ZIP.
    downloads::upsert_record(&dl_dir, downloads::DownloadRecord {
        item_id: item_id.clone(),
        title: title.clone(),
        author,
        file_path: playback_path.clone(),
        file_size,
        downloaded_at,
        // Newly downloaded books are always present on the server.
        server_deleted: false,
    })?;

    // Remove the cancellation token now that the download completed successfully.
    cancel_registry.lock().await.remove(&item_id);

    let _ = app_handle.emit("download-complete", serde_json::json!({
        "itemId": item_id,
        "title": title,
    }));

    Ok(playback_path)
}

/// Signals an in-progress download to abort on its next chunk boundary.
/// The streaming loop in download_item polls the token at the start of each
/// chunk iteration; on detection it deletes the partial file and emits
/// download-cancelled. Safe to call when the item_id is not in the registry
/// (download already complete or not started) — returns Ok in that case.
#[tauri::command]
pub async fn cancel_download(
    item_id: String,
    cancel_registry: tauri::State<'_, downloads::DownloadCancelRegistry>,
) -> Result<(), String> {
    // Lock briefly to read the token and call cancel().
    // The streaming loop holds no lock during I/O, so contention here is negligible.
    let map = cancel_registry.lock().await;
    if let Some(token) = map.get(&item_id) {
        // Sets an atomic flag; the streaming loop detects it on the next iteration
        // and performs its own cleanup (file deletion, registry removal, event).
        token.cancel();
    }
    // No error if item_id is absent — download may have already completed or
    // the cancel arrived after the loop exited but before the token was removed.
    Ok(())
}

/// Returns all records in the downloads registry.
/// Called by Settings → Downloads on mount to populate the downloads list.
#[tauri::command]
pub fn get_downloads() -> Result<Vec<downloads::DownloadRecord>, String> {
    let dir = downloads::downloads_dir()?;
    // If the directory does not yet exist, no downloads have been taken; return empty.
    if !dir.exists() {
        return Ok(Vec::new());
    }
    // Validate against disk: files deleted manually outside the app are pruned from
    // the registry here, so the Downloads list and the sidebar count drop to match.
    Ok(downloads::prune_missing(&dir))
}

/// Returns and clears the corrupt-persistence notices recorded since launch —
/// the human-readable names of files the loaders preserved as *.corrupt before
/// resetting to empty (review L2). Polled once by the frontend after the
/// registry mount load so the user learns visible data was reset rather than
/// finding it mysteriously empty.
#[tauri::command]
pub fn take_corrupt_persistence_notices() -> Vec<String> {
    downloads::take_corrupt_notices()
}

/// Removes a downloaded book: deletes the entire extracted directory (audio file,
/// cover image, and any other extracted files) and removes the registry entry.
/// The registry entry is always removed even when the directory is missing so
/// the UI stays consistent. Returns an error if the directory could not be
/// deleted; callers should still remove the row from local state because the
/// registry is already clean.
#[tauri::command]
pub fn remove_download(item_id: String) -> Result<(), String> {
    let dir = downloads::downloads_dir()?;
    let records = downloads::load_registry(&dir);

    // Capture any directory-removal error without short-circuiting —
    // the registry entry must be removed even when the files are already gone.
    let dir_err = if let Some(record) = records.iter().find(|r| r.item_id == item_id) {
        // The download registry stores the audio file path (or directory path for
        // multi-file books). The actual download lives in a directory named after
        // item_id that also contains the cover image and other extracted files.
        // Walk up to that item_id directory so we remove everything in one call.
        let file_path = std::path::Path::new(&record.file_path);

        // For a single-file book the stored path is the audio file, so its parent
        // is the item_id extraction directory. For a multi-file book the stored path
        // IS the item_id directory already, so parent() is the downloads root —
        // detect that case and use file_path directly.
        let extract_dir = if file_path.is_dir() {
            // Multi-file: file_path already points to the item_id directory.
            file_path.to_path_buf()
        } else {
            // Single-file: step up one level to the item_id directory.
            file_path.parent()
                .ok_or_else(|| "Could not determine extract directory".to_string())?
                .to_path_buf()
        };

        // Containment guards before the recursive delete. The registry is durable
        // local state — a corrupt or hand-edited row must not turn this into an
        // arbitrary-directory wipe, and a legacy row whose file sits directly in
        // the downloads root would otherwise resolve extract_dir to the root and
        // delete EVERY download.
        if extract_dir == dir {
            // File directly in the downloads root: delete just that file.
            match std::fs::remove_file(file_path) {
                Ok(()) => None,
                Err(e) if !file_path.exists() => { let _ = e; None } // already gone
                Err(e) => Some(format!("Failed to remove download file: {e}")),
            }
        } else if !extract_dir.starts_with(&dir) {
            log::warn!(target: "skald::downloads",
                "remove_download refused out-of-root path {}", extract_dir.display());
            Some(format!("Refusing to delete outside downloads root: {}", extract_dir.display()))
        } else if extract_dir.exists() {
            // Recursively remove the item_id directory and all its contents —
            // audio file, cover image, and any other files extracted from the ZIP.
            match std::fs::remove_dir_all(&extract_dir) {
                Ok(()) => None,
                Err(e) => Some(format!("Failed to remove download directory: {e}")),
            }
        } else {
            // Directory already gone (manually deleted outside the app) — not an error.
            None
        }
    } else {
        // item_id not in the registry — nothing to delete from disk.
        None
    };

    // Always remove the registry entry so the downloads list stays consistent.
    downloads::remove_record(&dir, &item_id)?;

    // Propagate the directory error only after the registry is already clean.
    if let Some(e) = dir_err {
        return Err(e);
    }

    Ok(())
}
