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

#[derive(Debug, PartialEq, Eq)]
enum DownloadRevealTarget {
    Directory(std::path::PathBuf),
    File(std::path::PathBuf),
}

// Resolve a registry-owned path rather than accepting an arbitrary file from the
// renderer. Canonicalising both sides also follows junctions/symlinks before the
// containment check, so a hand-edited downloads.json cannot use this command to
// reveal a file outside the configured downloads root.
fn resolve_download_reveal_target(
    downloads_dir: &std::path::Path,
    records: &[downloads::DownloadRecord],
    item_id: &str,
) -> Result<DownloadRevealTarget, String> {
    let record = records.iter()
        .find(|record| record.item_id == item_id)
        .ok_or_else(|| "Download record not found".to_string())?;
    let display_path = std::path::PathBuf::from(&record.file_path);
    if !display_path.is_absolute() {
        return Err("Downloaded path is not absolute".to_string());
    }
    let root = std::fs::canonicalize(downloads_dir)
        .map_err(|e| format!("Failed to resolve downloads folder: {e}"))?;
    let canonical_path = std::fs::canonicalize(&display_path)
        .map_err(|e| format!("Downloaded path is unavailable: {e}"))?;
    if !canonical_path.starts_with(&root) {
        return Err("Refusing to reveal a path outside the downloads folder".to_string());
    }
    // Keep the registry's ordinary absolute path for Explorer. Windows
    // canonicalize() returns a \\?\-prefixed path that is useful for validation
    // but is not consistently understood by shell command-line parsing.
    if canonical_path.is_file() {
        Ok(DownloadRevealTarget::File(display_path))
    } else if canonical_path.is_dir() {
        Ok(DownloadRevealTarget::Directory(display_path))
    } else {
        Err("Downloaded path is not a regular file or folder".to_string())
    }
}

// Sum the declared uncompressed size before extraction begins. This is read from
// the ZIP central directory, so the caller can reserve room for the extracted
// files while the downloaded archive is still occupying disk space.
fn archive_uncompressed_size<R: std::io::Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
) -> Result<u64, String> {
    let mut total = 0u64;
    for index in 0..archive.len() {
        let entry = archive.by_index(index)
            .map_err(|e| format!("Zip entry error: {e}"))?;
        if !entry.is_dir() {
            total = total.checked_add(entry.size())
                .ok_or_else(|| "ZIP uncompressed size is too large".to_string())?;
        }
    }
    Ok(total)
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
    tauri_plugin_opener::open_path(&dir, None::<&str>).map_err(|e| e.to_string())?;
    Ok(())
}

/// Reveal a completed download without weakening `reveal_path`'s directory-only
/// contract. Single-file books are selected in Explorer; multi-file books open
/// their playback directory. The renderer supplies only an item id, and the
/// backend resolves and contains the durable registry path under the downloads
/// root before invoking Explorer.
#[tauri::command]
pub fn reveal_download_location(item_id: String) -> Result<(), String> {
    let dir = downloads::downloads_dir()?;
    let records = downloads::load_registry(&dir);
    let target = resolve_download_reveal_target(&dir, &records, &item_id)
        .map_err(|e| {
            log::warn!(target: "skald::downloads",
                "reveal_download_location refused item {item_id}: {e}");
            e
        })?;

    let result = match target {
        DownloadRevealTarget::File(path) => tauri_plugin_opener::reveal_item_in_dir(path),
        DownloadRevealTarget::Directory(path) => {
            tauri_plugin_opener::open_path(path, None::<&str>)
        }
    };
    result.map_err(|e| format!("Failed to open download location: {e}"))?;
    log::info!(target: "skald::downloads",
        "reveal_download_location opened item {item_id}");
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

#[cfg(windows)]
fn comparable_path(p: &std::path::Path) -> std::path::PathBuf {
    // Windows paths are case-insensitive and accept either separator.
    std::path::PathBuf::from(
    p.to_string_lossy().replace('/', "\\").trim_end_matches('\\').to_lowercase()
    )
}

#[cfg(not(windows))]
fn comparable_path(p: &std::path::Path) -> std::path::PathBuf {
    // Linux paths are case-sensitive. Component normalization removes harmless
    // `.` segments without changing the identity of differently-cased folders.
    p.components().collect()
}

// Classify the relationship between a current root `old` and a requested `new`:
// returns Ok(true) when they are the same folder (caller should no-op), Err when
// one is nested inside the other (moving would drop a directory into itself), and
// Ok(false) when they are safely disjoint.
fn relocation_same_or_reject(old: &std::path::Path, new: &std::path::Path) -> Result<bool, String> {
    let (o, n) = (comparable_path(old), comparable_path(new));
    if o == n {
        return Ok(true);
    }
    if n.starts_with(&o) || o.starts_with(&n) {
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

type ProgressKey = (String, Option<String>);

#[derive(Debug, PartialEq, Eq)]
enum OfflineFlushDecision { Write, AcknowledgeOwnWrite, PreserveServer }

fn progress_matches_write(entry: &downloads::OfflineProgressEntry, progress: &models::MediaProgress) -> bool {
    progress.library_item_id == entry.item_id
        && progress.episode_id == entry.episode_id
        && (entry.current_time - progress.current_time).abs() <= 0.5
        && (!entry.is_finished || progress.is_finished)
}

fn progress_key(item_id: &str, episode_id: Option<&str>) -> ProgressKey {
    (item_id.to_string(), episode_id.map(str::to_string))
}

/// New entries compare the exact ABS revision captured when local playback
/// began; legacy/online-fallback entries retain the timestamp compatibility guard.
fn offline_flush_decision(entry: &downloads::OfflineProgressEntry, server: Option<&models::MediaProgress>) -> OfflineFlushDecision {
    if entry.baseline_captured {
        match (entry.server_last_update, server) {
            (Some(baseline), Some(progress)) if progress.last_update == baseline => return OfflineFlushDecision::Write,
            (None, None) => return OfflineFlushDecision::Write,
            _ => {}
        }
        if let (Some(pending), Some(progress)) = (entry.pending_confirmation_current_time, server) {
            if (pending - progress.current_time).abs() <= 0.5 {
                return OfflineFlushDecision::AcknowledgeOwnWrite;
            }
        }
        if let Some(progress) = server {
            // ABS may still expose the position from before this local playback
            // branch while Skald is waiting to flush its next 30-second batch.
            // Progress is monotonic unless the user explicitly seeks, so a
            // later unfinished local position is safe to publish even when the
            // captured ABS revision changed. Never let that stale revision win
            // and pull active playback backwards.
            if entry.pending_confirmation_current_time.is_none()
                && !progress.is_finished
                && (entry.is_finished || entry.current_time > progress.current_time + 0.5)
            {
                return OfflineFlushDecision::Write;
            }
        }
        return OfflineFlushDecision::PreserveServer;
    }
    if let (Some(pending), Some(progress)) = (entry.pending_confirmation_current_time, server) {
        if (pending - progress.current_time).abs() <= 0.5 {
            return OfflineFlushDecision::AcknowledgeOwnWrite;
        }
    }
    match server {
        Some(progress) if progress.last_update >= entry.recorded_at
            && (progress.is_finished
                || entry.current_time <= progress.current_time + 0.5) =>
        {
            OfflineFlushDecision::PreserveServer
        }
        _ => OfflineFlushDecision::Write,
    }
}

/// `/api/me` is the required conflict snapshot. Failure is terminal for this
/// attempt: no server write or queue removal may occur without it.
fn require_server_progress(result: Result<models::MeResponse, String>) -> Result<std::collections::HashMap<ProgressKey, models::MediaProgress>, String> {
    result
        .map(|me| me.media_progress.into_iter().map(|progress| {
            ((progress.library_item_id.clone(), progress.episode_id.clone()), progress)
        }).collect())
        .map_err(|error| format!("offline progress reconciliation deferred: {error}"))
}

fn preserve_offline_conflict(
    app: &tauri::AppHandle,
    downloads_dir: &std::path::Path,
    entry: &downloads::OfflineProgressEntry,
    server: Option<&models::MediaProgress>,
) {
    let newly_recorded = match downloads::record_conflict_stop_point(
        downloads_dir,
        &entry.item_id,
        entry.current_time,
        entry.recorded_at,
    ) {
        Ok(newly_recorded) => newly_recorded,
        Err(error) => {
            log::warn!(target: "skald::sync", "offline conflict recovery point failed item={}: {error}", entry.item_id);
            return;
        }
    };
    if let Err(error) = downloads::remove_progress_entry(
        downloads_dir,
        &entry.item_id,
        entry.episode_id.as_deref(),
        entry.recorded_at,
    ) {
        log::warn!(target: "skald::sync", "offline conflict queue removal deferred item={}: {error}", entry.item_id);
    }
    log::warn!(target: "skald::sync", "offline progress conflict preserved ABS item={} local_time={} server_time={}", entry.item_id, entry.current_time, server.map(|p| p.current_time).unwrap_or(0.0));
    if newly_recorded {
        let _ = app.emit("offline-sync-conflict", serde_json::json!({
            "itemId": entry.item_id,
            "episodeId": entry.episode_id,
            "localCurrentTime": entry.current_time,
            "serverCurrentTime": server.map(|progress| progress.current_time),
        }));
    }
}

async fn acknowledge_confirmed_progress(
    state: &Arc<Mutex<SessionManager>>,
    downloads_dir: &std::path::Path,
    entry: &downloads::OfflineProgressEntry,
    server_last_update: i64,
    confirmed_current_time: f64,
) -> Result<(), String> {
    let live_revision = state.lock().await.downloaded_revision_for(
        &entry.item_id,
        entry.episode_id.as_deref(),
    );
    if let Some(revision) = live_revision {
        let mut revision = revision.lock().unwrap_or_else(|error| error.into_inner());
        let result = downloads::acknowledge_progress_write(
            downloads_dir,
            entry,
            server_last_update,
            confirmed_current_time,
        );
        revision.baseline_captured = true;
        revision.server_last_update = Some(server_last_update);
        result
    } else {
        downloads::acknowledge_progress_write(
            downloads_dir,
            entry,
            server_last_update,
            confirmed_current_time,
        )
    }
}

/// Sessions whose item still has a queued position are held back.
///
/// ABS mirrors a synced local session into media progress (`syncLocalSession` →
/// `createUpdateMediaProgressFromPayload`), which moves the very `lastUpdate`
/// revision the offline progress queue branched from. Sending one while a
/// position is still queued for that item would make Skald's own write look like
/// a foreign edit on the next flush — a manufactured conflict, complete with a
/// stop point and a user-facing warning. Position is the authoritative channel;
/// listening attribution waits its turn.
fn sessions_clear_to_send(
    sessions: Vec<offline_sessions::LocalSession>,
    queue: &[downloads::OfflineProgressEntry],
) -> (Vec<offline_sessions::LocalSession>, usize) {
    let (ready, deferred): (Vec<_>, Vec<_>) = sessions.into_iter().partition(|session| {
        !queue.iter().any(|entry| {
            entry.item_id == session.library_item_id && entry.episode_id == session.episode_id
        })
    });
    (ready, deferred.len())
}

/// Send acknowledged sessions and drop exactly those from the store.
///
/// Batch first (`/api/session/local-all`); a server without that route falls
/// back to one `/api/session/local` per session. A server without *either* is
/// pre-local-session ABS: the flag is recorded so later reconnects skip the
/// route entirely, and position sync — which never used it — is untouched.
async fn flush_offline_sessions(
    client: &AbsClient,
    server_url: &str,
    dl_dir: &std::path::Path,
    device_info: &serde_json::Value,
) -> u32 {
    if offline_sessions::is_unsupported(dl_dir, server_url) {
        return 0;
    }
    let pending = offline_sessions::pending_sessions(dl_dir);
    if pending.is_empty() {
        return 0;
    }
    // Re-read the queue: the progress pass above has just emptied what it could,
    // so this sees the freshest picture of which items are still unsettled.
    let (ready, deferred) = sessions_clear_to_send(pending, &downloads::load_progress_queue(dl_dir));
    if deferred > 0 {
        log::info!(target: "skald::sync",
            "offline listening flush deferred {deferred} session(s) whose position is still queued");
    }
    if ready.is_empty() {
        return 0;
    }

    let acked: Vec<String> = match client.sync_local_sessions(&ready, device_info).await {
        Ok(results) => {
            for result in results.iter().filter(|result| !result.success) {
                // Per-session rejection (deleted item, missing library). It stays
                // queued: a restored item can still accept it, and the age cap in
                // offline_sessions keeps a permanently-dead session from piling up.
                log::warn!(target: "skald::sync", "offline listening session rejected id={} reason={}",
                    result.id, result.error.as_deref().unwrap_or("unknown"));
            }
            results.into_iter().filter(|r| r.success).map(|r| r.id).collect()
        }
        Err(api::LocalSessionError::Transport(error)) => {
            log::warn!(target: "skald::sync", "offline listening flush deferred: {error}");
            return 0;
        }
        Err(api::LocalSessionError::Unsupported) => {
            // No batch route — send them one at a time before concluding
            // anything about the server.
            let mut acked = Vec::new();
            for session in &ready {
                match client.sync_local_session(session, device_info).await {
                    Ok(()) => acked.push(session.id.clone()),
                    Err(api::LocalSessionError::Unsupported) => {
                        // Neither route exists: this server predates local
                        // sessions. Record it and stop — retrying every reconnect
                        // would be noise, and progress sync is unaffected.
                        if let Err(error) = offline_sessions::mark_unsupported(dl_dir, server_url) {
                            log::warn!(target: "skald::sync", "could not record local-session support: {error}");
                        }
                        log::info!(target: "skald::sync",
                            "server does not support local sessions — offline listening stays local, position sync unaffected");
                        break;
                    }
                    Err(api::LocalSessionError::Transport(error)) => {
                        log::warn!(target: "skald::sync", "offline listening session deferred id={}: {error}", session.id);
                        break;
                    }
                }
            }
            acked
        }
    };

    match offline_sessions::remove_pending(dl_dir, &acked) {
        Ok(removed) => {
            if removed > 0 {
                log::info!(target: "skald::sync",
                    "offline listening flush ok sessions={} acked={removed}", ready.len());
            }
            removed as u32
        }
        Err(error) => {
            // Delivered but not forgotten. Re-sending is safe — ABS upserts by
            // session id and timeListening is cumulative, so the next flush
            // updates the same row rather than double-counting it.
            log::warn!(target: "skald::sync", "offline listening flush delivered but not cleared: {error}");
            0
        }
    }
}

/// Resolve this installation's device identity and flush. Kept apart from
/// `flush_offline_sessions` so the flush itself stays injectable — the identity
/// lives in the real app-data directory, which tests must never touch.
async fn flush_offline_sessions_now(
    client: &AbsClient,
    server_url: &str,
    dl_dir: &std::path::Path,
) -> u32 {
    match crate::session_ownership::device_id() {
        Ok(device_id) => {
            let device_info = offline_sessions::device_info(&device_id);
            flush_offline_sessions(client, server_url, dl_dir, &device_info).await
        }
        Err(error) => {
            // Sessions stay queued; a session with no device is worse than a
            // late one, since ABS files it under an anonymous device row.
            log::warn!(target: "skald::sync", "offline listening flush deferred, no device identity: {error}");
            0
        }
    }
}

// Flush only after obtaining the authoritative ABS conflict snapshot. A
// A genuinely later ABS position becomes a local recovery stop point. A later
// local position is monotonic progress and is pushed instead of being discarded.
#[tauri::command]
pub async fn flush_offline_progress(
    server_url: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<u32, String> {
    let client = AbsClient::authenticated(server_url.clone()).await?;
    let dl_dir = downloads::downloads_dir()?;
    // Snapshot the queue before iterating so remove_progress_entry modifies the
    // file independently of our iteration — no borrow-checker conflict.
    let queue = downloads::load_progress_queue(&dl_dir);
    if queue.is_empty() {
        // No positions to settle, but offline listening may still be waiting —
        // it accrues on its own schedule and outlives the position it came with.
        let sessions = flush_offline_sessions_now(&client, &server_url, &dl_dir).await;
        let _ = app.emit("offline-progress-flushed", serde_json::json!({ "flushed": 0, "queued": 0, "sessions": sessions }));
        return Ok(0);
    }
    let server_progress = match require_server_progress(client.get_me().await) {
        Ok(progress) => progress,
        Err(error) => {
            log::warn!(target: "skald::sync", "offline progress flush deferred because ABS state is unavailable: {error}");
            return Err(error);
        }
    };
    let mut flushed: u32 = 0;
    for entry in &queue {
        // Local-library items (id prefix "local_") have no server counterpart —
        // their progress lives in the catalog, so never attempt to flush them.
        if entry.item_id.starts_with("local_") { continue; }
        let key = progress_key(&entry.item_id, entry.episode_id.as_deref());
        let server = server_progress.get(&key);
        match offline_flush_decision(entry, server) {
            OfflineFlushDecision::PreserveServer => {
                preserve_offline_conflict(&app, &dl_dir, entry, server);
                continue;
            }
            OfflineFlushDecision::AcknowledgeOwnWrite => {
                let confirmed = server.expect("acknowledgement requires server progress");
                if let Err(error) = acknowledge_confirmed_progress(
                    state.inner(), &dl_dir, entry, confirmed.last_update, confirmed.current_time,
                ).await {
                    log::warn!(target: "skald::sync", "recovered offline write but queue acknowledgement failed item={}: {error}", entry.item_id);
                }
                flushed += 1;
                log::info!(target: "skald::sync", "recovered offline progress confirmation item={} server_revision={}", entry.item_id, confirmed.last_update);
                continue;
            }
            OfflineFlushDecision::Write => {}
        }
        if let Err(error) = downloads::mark_progress_write_pending(&dl_dir, entry) {
            log::warn!(target: "skald::sync", "offline progress delivery marker failed item={}: {error}", entry.item_id);
            continue;
        }
        match client.update_progress(&entry.item_id, entry.episode_id.as_deref(), entry.current_time, entry.duration, entry.is_finished).await {
            Ok(()) => {
                // Remove only after a confirmed server write — and only the exact
                // entry we sent (matched on recorded_at), so a newer position the
                // tick loop queued mid-flush isn't dropped.
                match client.get_media_progress(&entry.item_id, entry.episode_id.as_deref()).await {
                    Ok(confirmed) if progress_matches_write(entry, &confirmed) => {
                        let acknowledge = acknowledge_confirmed_progress(
                            state.inner(), &dl_dir, entry, confirmed.last_update, confirmed.current_time,
                        ).await;
                        if let Err(error) = acknowledge {
                            log::warn!(target: "skald::sync", "confirmed offline progress but queue acknowledgement failed item={}: {error}", entry.item_id);
                        }
                        flushed += 1;
                        log::info!(target: "skald::sync", "offline progress confirmed item={} server_revision={}", entry.item_id, confirmed.last_update);
                    }
                    Ok(remote) => {
                        preserve_offline_conflict(&app, &dl_dir, entry, Some(&remote));
                    }
                    Err(error) => {
                        log::warn!(target: "skald::sync", "offline progress confirmation deferred item={}: {error}", entry.item_id);
                    }
                }
            }
            Err(error) => {
                log::warn!(target: "skald::sync", "offline progress write deferred item={}: {error}", entry.item_id);
                // Non-fatal — entry stays in the queue for the next flush.
            }
        }
    }
    // Listening attribution goes last, on purpose: it reads the queue state this
    // pass just settled (see sessions_clear_to_send).
    let sessions = flush_offline_sessions_now(&client, &server_url, &dl_dir).await;
    let queued = downloads::load_progress_queue(&dl_dir).len() as u32;
    let _ = app.emit("offline-progress-flushed", serde_json::json!({ "flushed": flushed, "queued": queued, "sessions": sessions }));
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
    // Downloaded-book resume reads only the book-level entry; failed online
    // podcast syncs remain distinct in the same queue until reconnect flush.
    Ok(queue.into_iter().find(|e| e.item_id == item_id && e.episode_id.is_none()))
}

/// Exposes only queue size for Settings diagnostics; progress payloads remain local.
#[tauri::command]
pub fn get_offline_progress_count() -> Result<u32, String> {
    let dl_dir = downloads::downloads_dir()?;
    Ok(downloads::load_progress_queue(&dl_dir).len() as u32)
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

    // Refresh first if the access token is near expiry: ABS authorizes this
    // request once, at the start, but a download can run for a long time and
    // starting it on a token with seconds left is a needless way to fail.
    let token = crate::token_refresh::fresh_tokens(&server_url)
        .await?
        .effective()
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?
        .to_string();

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

    // Check that the incoming ZIP itself fits before touching the output path.
    // A second preflight after download reads the ZIP's uncompressed total and
    // ensures extraction also fits while this archive remains on disk.
    if total_bytes > 0 {
        let available = match fs2::available_space(&dl_dir) {
            Ok(available) => available,
            Err(e) => {
                cancel_registry.lock().await.remove(&item_id);
                let msg = format!("Failed to inspect download disk space: {e}");
                log::error!(target: "skald::downloads",
                    "download preflight failed for item {item_id}: {msg}");
                let _ = app_handle.emit("download-failed", serde_json::json!({
                    "itemId": item_id, "title": title, "error": msg,
                }));
                return Err(msg);
            }
        };
        if total_bytes > available {
            cancel_registry.lock().await.remove(&item_id);
            let msg = format!("Insufficient disk space: need {total_bytes} bytes, only {available} bytes available");
            log::warn!(target: "skald::downloads",
                "download ZIP preflight rejected item {item_id}: need={total_bytes} available={available}");
            let _ = app_handle.emit("download-failed", serde_json::json!({
                "itemId": item_id, "title": title, "error": msg,
            }));
            return Err(msg);
        }
    }

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
        let _ = std::fs::remove_file(&file_path);
        cancel_registry.lock().await.remove(&item_id);
        let msg = "Download failed: empty item id".to_string();
        let _ = app_handle.emit("download-failed", serde_json::json!({
            "itemId": item_id, "title": title, "error": msg,
        }));
        return Err(msg);
    }
    let extract_dir = dl_dir.join(&safe_item_dir);

    // Run extraction inside a closure so all failure branches share one cleanup
    // block rather than duplicating the remove_dir_all / remove_file calls.
    // Preflight errors happen before extraction_started is set, preserving any
    // pre-existing completed directory while still deleting this failed ZIP.
    let extract_dir_preexisting = extract_dir.exists();
    let mut extraction_started = false;
    let zip_result: Result<(), String> = (|| {
        let zip_file = std::fs::File::open(&file_path)
            .map_err(|e| format!("Failed to open zip: {e}"))?;
        let mut archive = zip::ZipArchive::new(zip_file)
            .map_err(|e| format!("Failed to read zip: {e}"))?;

        // available_space is measured after the ZIP has been written, so the
        // uncompressed total is precisely the additional peak space required.
        let uncompressed_bytes = archive_uncompressed_size(&mut archive)?;
        let available = fs2::available_space(&dl_dir)
            .map_err(|e| format!("Failed to inspect extraction disk space: {e}"))?;
        if uncompressed_bytes > available {
            return Err(format!(
                "Insufficient disk space for extraction: need {uncompressed_bytes} additional bytes while the {bytes_downloaded}-byte archive is retained, only {available} bytes available"
            ));
        }
        log::info!(target: "skald::downloads",
            "download extraction preflight passed for item {item_id}: archive={bytes_downloaded} extracted={uncompressed_bytes} available={available}");

        std::fs::create_dir_all(&extract_dir)
            .map_err(|e| format!("Failed to create extract dir: {e}"))?;
        extraction_started = true;

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
        if extraction_started || !extract_dir_preexisting {
            let _ = std::fs::remove_dir_all(&extract_dir); // partial extracted files
        }
        let _ = std::fs::remove_file(&file_path);      // the ZIP itself
        cancel_registry.lock().await.remove(&item_id);
        log::warn!(target: "skald::downloads",
            "download extraction failed for item {item_id}: {e}");
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
    log::info!(target: "skald::downloads",
        "download completed for item {item_id}: extracted_bytes={file_size}");

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn queued(baseline_captured: bool, server_last_update: Option<i64>) -> downloads::OfflineProgressEntry {
        downloads::OfflineProgressEntry {
            item_id: "book".to_string(), episode_id: None, current_time: 90.0,
            duration: 1000.0, progress: 0.09, is_finished: false,
            recorded_at: 2_000, baseline_captured, server_last_update,
            pending_confirmation_current_time: None,
        }
    }

    fn server(last_update: i64) -> models::MediaProgress {
        models::MediaProgress {
            id: "progress".to_string(), library_item_id: "book".to_string(), episode_id: None,
            duration: 1000.0, progress: 0.2, current_time: 200.0,
            is_finished: false, last_update,
        }
    }

    #[test]
    fn relocation_rejects_nested_paths() {
        let root = std::path::Path::new("/tmp/skald-downloads");
        assert!(relocation_same_or_reject(root, root).unwrap());
        assert!(relocation_same_or_reject(root, &root.join("nested")).is_err());
        assert!(!relocation_same_or_reject(root, std::path::Path::new("/tmp/skald-other")).unwrap());
    }

    #[cfg(not(windows))]
    #[test]
    fn relocation_keeps_linux_path_case_significant() {
        assert!(!relocation_same_or_reject(
            std::path::Path::new("/tmp/Books"),
            std::path::Path::new("/tmp/books"),
        )
        .unwrap());
    }

    #[test]
    fn offline_flush_requires_server_snapshot_before_planning_writes() {
        let error = require_server_progress(Err("HTTP 503".to_string())).unwrap_err();
        assert!(error.contains("reconciliation deferred"));
    }

    #[test]
    fn offline_flush_writes_only_when_captured_revision_is_unchanged() {
        let entry = queued(true, Some(100));
        assert_eq!(offline_flush_decision(&entry, Some(&server(100))), OfflineFlushDecision::Write);
        assert_eq!(offline_flush_decision(&entry, Some(&server(101))), OfflineFlushDecision::PreserveServer);
        assert_eq!(offline_flush_decision(&entry, None), OfflineFlushDecision::PreserveServer);
    }

    #[test]
    fn offline_flush_keeps_later_local_progress_despite_a_newer_server_revision() {
        let mut entry = queued(true, Some(100));
        entry.current_time = 240.0;
        let stale_server = server(101);

        assert_eq!(
            offline_flush_decision(&entry, Some(&stale_server)),
            OfflineFlushDecision::Write,
        );
    }

    #[test]
    fn offline_flush_detects_progress_created_after_empty_baseline() {
        let entry = queued(true, None);
        assert_eq!(offline_flush_decision(&entry, None), OfflineFlushDecision::Write);
        assert_eq!(offline_flush_decision(&entry, Some(&server(100))), OfflineFlushDecision::PreserveServer);
    }

    #[test]
    fn downloaded_progress_can_flush_twice_after_own_revision_is_advanced() {
        let mut entry = queued(true, Some(100));
        assert_eq!(offline_flush_decision(&entry, Some(&server(100))), OfflineFlushDecision::Write);

        // The first confirmed write advances the branch to the revision ABS
        // assigned to Skald's own update. The next local position is therefore
        // writable, while an intervening foreign revision still wins.
        entry.server_last_update = Some(101);
        entry.current_time = 120.0;
        assert_eq!(offline_flush_decision(&entry, Some(&server(101))), OfflineFlushDecision::Write);
        assert_eq!(offline_flush_decision(&entry, Some(&server(102))), OfflineFlushDecision::PreserveServer);
    }

    #[test]
    fn uncertain_patch_is_recovered_only_when_abs_matches_the_sent_position() {
        let mut entry = queued(true, Some(100));
        entry.current_time = 120.0;
        entry.pending_confirmation_current_time = Some(90.0);

        let mut own_write = server(101);
        own_write.current_time = 90.0;
        assert_eq!(offline_flush_decision(&entry, Some(&own_write)), OfflineFlushDecision::AcknowledgeOwnWrite);

        own_write.current_time = 80.0;
        assert_eq!(offline_flush_decision(&entry, Some(&own_write)), OfflineFlushDecision::PreserveServer);

        entry.baseline_captured = false;
        own_write.current_time = 90.0;
        assert_eq!(offline_flush_decision(&entry, Some(&own_write)), OfflineFlushDecision::AcknowledgeOwnWrite);
    }

    fn record(item_id: &str, path: &std::path::Path) -> downloads::DownloadRecord {
        downloads::DownloadRecord {
            item_id: item_id.to_string(),
            title: "Test book".to_string(),
            author: "Test author".to_string(),
            file_path: path.to_string_lossy().into_owned(),
            file_size: 0,
            downloaded_at: 0,
            server_deleted: false,
        }
    }

    #[test]
    fn reveal_target_handles_single_and_multi_file_downloads() {
        let temp = tempfile::tempdir().unwrap();
        let single_dir = temp.path().join("single");
        std::fs::create_dir_all(&single_dir).unwrap();
        let single_file = single_dir.join("book.m4b");
        std::fs::write(&single_file, b"audio").unwrap();
        let multi_dir = temp.path().join("multi");
        std::fs::create_dir_all(&multi_dir).unwrap();
        let records = vec![record("single", &single_file), record("multi", &multi_dir)];

        let single = resolve_download_reveal_target(temp.path(), &records, "single").unwrap();
        let multi = resolve_download_reveal_target(temp.path(), &records, "multi").unwrap();

        assert_eq!(single, DownloadRevealTarget::File(single_file));
        assert_eq!(multi, DownloadRevealTarget::Directory(multi_dir));
    }

    #[test]
    fn reveal_target_rejects_registry_paths_outside_downloads_root() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let outside_file = outside.path().join("outside.m4b");
        std::fs::write(&outside_file, b"audio").unwrap();
        let records = vec![record("outside", &outside_file)];

        let error = resolve_download_reveal_target(root.path(), &records, "outside").unwrap_err();

        assert!(error.contains("outside the downloads folder"));
    }

    // ── Local-session flush (HTTP contract) ──────────────────────────────────
    // The flush is a small state machine over two ABS routes, so these pin the
    // exact paths/methods/bodies Skald sends and what it removes in response.
    // `flush_offline_sessions` takes its directory and device identity as
    // parameters precisely so this can run against a tempdir.

    use wiremock::matchers::{body_json, method as http_method, path as http_path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn test_device() -> serde_json::Value {
        offline_sessions::device_info("device-under-test")
    }

    /// Seed `count` retired sessions and return their ids in order.
    fn seed_sessions(dir: &std::path::Path, count: usize) -> Vec<String> {
        struct FrozenClock;
        impl offline_sessions::Clock for FrozenClock {
            fn now(&self) -> chrono::DateTime<chrono::Local> {
                chrono::Local::now()
            }
        }
        for index in 0..count {
            let context = offline_sessions::SessionContext {
                item_id: format!("li_{index}"),
                episode_id: None,
                media_type: "book".to_string(),
                display_title: format!("Book {index}"),
                display_author: "Author".to_string(),
            };
            offline_sessions::accrue(dir, &context, 60.0, 60.0, 3600.0, &FrozenClock).unwrap();
        }
        offline_sessions::retire_active(dir).unwrap();
        offline_sessions::pending_sessions(dir).into_iter().map(|s| s.id).collect()
    }

    #[tokio::test]
    async fn local_all_batch_flush_removes_acked_only() {
        let dir = tempfile::tempdir().unwrap();
        let ids = seed_sessions(dir.path(), 2);
        let server = MockServer::start().await;

        // ABS answers 200 for the batch as a whole and reports per-session
        // outcomes inside it — one placed, one whose item is gone.
        Mock::given(http_method("POST"))
            .and(http_path("/api/session/local-all"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "results": [
                    { "id": ids[0], "success": true, "progressSynced": true },
                    { "id": ids[1], "success": false, "error": "Media item not found" },
                ],
            })))
            .mount(&server)
            .await;

        let client = AbsClient::new(server.uri()).with_token("tok".into());
        let flushed = flush_offline_sessions(&client, &server.uri(), dir.path(), &test_device()).await;

        assert_eq!(flushed, 1);
        let left = offline_sessions::pending_sessions(dir.path());
        assert_eq!(left.len(), 1, "a rejected session stays queued");
        assert_eq!(left[0].id, ids[1]);
    }

    #[tokio::test]
    async fn per_item_fallback_when_the_batch_route_is_absent() {
        let dir = tempfile::tempdir().unwrap();
        let ids = seed_sessions(dir.path(), 2);
        let server = MockServer::start().await;

        Mock::given(http_method("POST"))
            .and(http_path("/api/session/local-all"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        // The single-session route takes the session itself as the body, with
        // deviceInfo alongside its fields (not wrapped in a `sessions` array).
        Mock::given(http_method("POST"))
            .and(http_path("/api/session/local"))
            .respond_with(ResponseTemplate::new(200))
            .expect(2)
            .mount(&server)
            .await;

        let client = AbsClient::new(server.uri()).with_token("tok".into());
        let flushed = flush_offline_sessions(&client, &server.uri(), dir.path(), &test_device()).await;

        assert_eq!(flushed, 2);
        assert!(offline_sessions::pending_sessions(dir.path()).is_empty());
        assert!(
            !offline_sessions::is_unsupported(dir.path(), &server.uri()),
            "a missing batch route alone must not condemn the server",
        );
        let _ = ids;
    }

    #[tokio::test]
    async fn missing_routes_set_unsupported_and_stop_further_session_traffic() {
        let dir = tempfile::tempdir().unwrap();
        seed_sessions(dir.path(), 1);
        // A queued position must survive untouched: this feature failing has no
        // bearing on where the user is in the book.
        downloads::upsert_progress_entry(dir.path(), downloads::OfflineProgressEntry {
            item_id: "li_untouched".to_string(), episode_id: None, current_time: 12.0,
            duration: 100.0, progress: 0.12, is_finished: false, recorded_at: 1,
            baseline_captured: false, server_last_update: None,
            pending_confirmation_current_time: None,
        }).unwrap();
        let server = MockServer::start().await;

        // Neither route exists — an ABS predating local sessions.
        Mock::given(http_method("POST"))
            .and(http_path("/api/session/local-all"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        Mock::given(http_method("POST"))
            .and(http_path("/api/session/local"))
            .respond_with(ResponseTemplate::new(404))
            .expect(1) // exactly one probe, then Skald stops asking
            .mount(&server)
            .await;

        let client = AbsClient::new(server.uri()).with_token("tok".into());
        assert_eq!(flush_offline_sessions(&client, &server.uri(), dir.path(), &test_device()).await, 0);
        assert!(offline_sessions::is_unsupported(dir.path(), &server.uri()), "the verdict is recorded");

        // A second flush must not touch the network at all — the `expect(1)`
        // above fails on drop if this one probes again.
        assert_eq!(flush_offline_sessions(&client, &server.uri(), dir.path(), &test_device()).await, 0);
        assert_eq!(offline_sessions::pending_sessions(dir.path()).len(), 1, "sessions stay, unsent");
        assert_eq!(downloads::load_progress_queue(dir.path()).len(), 1, "position sync is unaffected");
    }

    #[tokio::test]
    async fn a_transport_failure_leaves_every_session_queued() {
        let dir = tempfile::tempdir().unwrap();
        seed_sessions(dir.path(), 2);
        let server = MockServer::start().await;
        Mock::given(http_method("POST"))
            .and(http_path("/api/session/local-all"))
            .respond_with(ResponseTemplate::new(503))
            .mount(&server)
            .await;

        let client = AbsClient::new(server.uri()).with_token("tok".into());
        let flushed = flush_offline_sessions(&client, &server.uri(), dir.path(), &test_device()).await;

        assert_eq!(flushed, 0);
        assert_eq!(offline_sessions::pending_sessions(dir.path()).len(), 2);
        assert!(
            !offline_sessions::is_unsupported(dir.path(), &server.uri()),
            "a 5xx is a bad moment, not a server without the route",
        );
    }

    /// The body ABS actually receives, pinned field by field. `timeListening` is
    /// *assigned* server-side, so it has to be the cumulative total; `date` and
    /// `updatedAt` have to agree, because the server re-derives the former from
    /// the latter whenever it updates a session it already has.
    #[tokio::test]
    async fn the_batch_body_matches_the_verified_abs_shape() {
        let dir = tempfile::tempdir().unwrap();
        seed_sessions(dir.path(), 1);
        let session = offline_sessions::pending_sessions(dir.path()).remove(0);
        let server = MockServer::start().await;

        Mock::given(http_method("POST"))
            .and(http_path("/api/session/local-all"))
            .and(body_json(serde_json::json!({
                "deviceInfo": test_device(),
                "sessions": [{
                    "id": session.id,
                    "libraryItemId": "li_0",
                    "mediaType": "book",
                    "displayTitle": "Book 0",
                    "displayAuthor": "Author",
                    "duration": 3600.0,
                    "playMethod": 3,
                    "mediaPlayer": "vlc",
                    "timeListening": 60.0,
                    "startTime": 60.0,
                    "currentTime": 60.0,
                    "startedAt": session.started_at,
                    "updatedAt": session.updated_at,
                    "date": session.date,
                    "dayOfWeek": session.day_of_week,
                }],
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "results": [{ "id": session.id, "success": true, "progressSynced": true }],
            })))
            .expect(1)
            .mount(&server)
            .await;

        let client = AbsClient::new(server.uri()).with_token("tok".into());
        assert_eq!(flush_offline_sessions(&client, &server.uri(), dir.path(), &test_device()).await, 1);
    }

    /// Position is the authoritative channel. ABS mirrors a synced session into
    /// media progress, so flushing one for an item whose position is still
    /// queued would move the revision the queue branched from and manufacture a
    /// conflict on the next pass.
    #[test]
    fn sessions_wait_for_their_items_position_to_settle() {
        let dir = tempfile::tempdir().unwrap();
        seed_sessions(dir.path(), 2);
        let sessions = offline_sessions::pending_sessions(dir.path());
        let queue = vec![downloads::OfflineProgressEntry {
            item_id: "li_0".to_string(), episode_id: None, current_time: 60.0,
            duration: 3600.0, progress: 0.016, is_finished: false, recorded_at: 1,
            baseline_captured: true, server_last_update: Some(9),
            pending_confirmation_current_time: None,
        }];

        let (ready, deferred) = sessions_clear_to_send(sessions, &queue);

        assert_eq!(deferred, 1);
        assert_eq!(ready.len(), 1);
        assert_eq!(ready[0].library_item_id, "li_1", "only the settled item is sent");
    }

    #[test]
    fn archive_size_counts_regular_files_before_extraction() {
        let temp = tempfile::tempdir().unwrap();
        let zip_path = temp.path().join("book.zip");
        {
            let file = std::fs::File::create(&zip_path).unwrap();
            let mut writer = zip::ZipWriter::new(file);
            writer.add_directory("tracks/", zip::write::SimpleFileOptions::default()).unwrap();
            writer.start_file("tracks/01.mp3", zip::write::SimpleFileOptions::default()).unwrap();
            writer.write_all(b"abc").unwrap();
            writer.start_file("cover.jpg", zip::write::SimpleFileOptions::default()).unwrap();
            writer.write_all(b"12345").unwrap();
            writer.finish().unwrap();
        }
        let file = std::fs::File::open(zip_path).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();

        assert_eq!(archive_uncompressed_size(&mut archive).unwrap(), 8);
    }
}
