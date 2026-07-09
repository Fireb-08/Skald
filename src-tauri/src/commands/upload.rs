// Split from the original single-file commands.rs (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. Shared imports and state types
// come from the parent module (mod.rs) via the glob below.
use super::*;

// ── Server upload (Server Upload roadmap) ────────────────────────────────────

/// Registry of in-flight uploads' CancellationTokens, keyed by the client-
/// generated uploadId. A newtype rather than a second downloads-style alias
/// because Tauri managed state is looked up by TYPE — a second
/// Arc<Mutex<HashMap<String, CancellationToken>>> would collide with
/// DownloadCancelRegistry.
pub struct UploadCancelRegistry(pub Mutex<std::collections::HashMap<String, CancellationToken>>);

/// One entry in the Upload modal's file list — resolve_upload_files output.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadFileEntry {
    pub path: String,
    pub name: String,
    pub size: u64,
}

/// Extension allowlist shared by resolve_upload_files and upload_media. The
/// Tauri command layer is the privilege boundary, so BOTH commands enforce it —
/// never only the frontend picker's dialog filter.
fn upload_ext_allowed(p: &std::path::Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .map(|e| {
            crate::scanner::AUDIO_EXTS.contains(&e.as_str())
                || crate::scanner::SUPPLEMENTAL_EXTS.contains(&e.as_str())
                || e == "epub" // readable extra ABS stores alongside the audio
        })
        .unwrap_or(false)
}

/// Expands the Upload modal's picked paths into a flat file list with sizes.
/// Directories contribute their DIRECT child files (no recursion — one upload is
/// one item, so nested folders are more likely stray series trees than tracks).
/// Everything — including plain files the picker already scoped — is filtered to
/// the upload extension allowlist.
#[tauri::command]
pub fn resolve_upload_files(paths: Vec<String>) -> Result<Vec<UploadFileEntry>, String> {
    fn entry_for(path: &std::path::Path) -> Option<UploadFileEntry> {
        let meta = std::fs::metadata(path).ok()?;
        Some(UploadFileEntry {
            path: path.to_string_lossy().into_owned(),
            name: path.file_name()?.to_string_lossy().into_owned(),
            size: meta.len(),
        })
    }

    let mut out = Vec::new();
    for p in &paths {
        let path = std::path::Path::new(p);
        if path.is_dir() {
            let entries = std::fs::read_dir(path)
                .map_err(|e| format!("Cannot read folder {p}: {e}"))?;
            for entry in entries.flatten() {
                let child = entry.path();
                if child.is_file() && upload_ext_allowed(&child) {
                    if let Some(e) = entry_for(&child) {
                        out.push(e);
                    }
                }
            }
        } else if upload_ext_allowed(path) {
            if let Some(e) = entry_for(path) {
                out.push(e);
            }
        }
    }
    // Stable case-insensitive name order so multi-track books list in track
    // order; the server orders tracks by its own scanner rules regardless.
    out.sort_by_key(|e| e.name.to_lowercase());
    Ok(out)
}

/// Uploads media files to the ABS server as one new library item via
/// POST /api/upload (multipart, streamed — see AbsClient::upload_media).
/// Emits upload-progress (~500 ms throttle), then exactly one of
/// upload-complete / upload-cancelled / upload-failed, all keyed by the
/// client-generated uploadId (mirrors the download event family).
/// Requires the user's `upload` permission — ABS answers 403 otherwise.
// Flat args are the frontend invoke() payload keys one-to-one — the IPC
// contract. Bundling them into a struct would nest the payload; not worth it.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn upload_media(
    server_url: String,
    upload_id: String,
    library_id: String,
    folder_id: String,
    title: String,
    author: String,
    series: String,
    file_paths: Vec<String>,
    app_handle: tauri::AppHandle,
    uploads: tauri::State<'_, UploadCancelRegistry>,
) -> Result<(), String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;

    if file_paths.is_empty() {
        return Err("No files to upload".to_string());
    }

    // Total size up front so every progress event can carry totalBytes.
    // Re-validate each renderer-supplied path here too — this command, not the
    // picker dialog or resolve_upload_files, is the privilege boundary. Without
    // this, a compromised WebView could pass arbitrary readable files and
    // exfiltrate them to the server under the user's account.
    let mut total_bytes: u64 = 0;
    for p in &file_paths {
        let path = std::path::Path::new(p);
        if !upload_ext_allowed(path) {
            return Err(format!("Not an allowed upload file type: {p}"));
        }
        let meta = tokio::fs::metadata(p)
            .await
            .map_err(|e| format!("Cannot read file {p}: {e}"))?;
        if !meta.is_file() {
            return Err(format!("Not a regular file: {p}"));
        }
        total_bytes += meta.len();
    }

    log::info!(
        target: "skald::library",
        "upload start lib={library_id} folder={folder_id} files={} bytes={total_bytes}",
        file_paths.len()
    );

    let cancel = CancellationToken::new();
    uploads.0.lock().await.insert(upload_id.clone(), cancel.clone());

    // Signal the start immediately so the modal's bar appears before the first chunk.
    let _ = app_handle.emit("upload-progress", serde_json::json!({
        "uploadId": upload_id,
        "title": title,
        "bytesSent": 0u64,
        "totalBytes": total_bytes,
    }));

    // Throttled progress emitter (~500 ms) — called from the byte-counting stream
    // on every chunk; a std Mutex is fine because the closure is synchronous.
    let last_emit = Arc::new(std::sync::Mutex::new(std::time::Instant::now()));
    let progress_app = app_handle.clone();
    let progress_id = upload_id.clone();
    let progress_title = title.clone();
    let on_progress = move |bytes_sent: u64| {
        let mut last = last_emit.lock().unwrap_or_else(|e| e.into_inner());
        if last.elapsed() >= std::time::Duration::from_millis(500) {
            *last = std::time::Instant::now();
            let _ = progress_app.emit("upload-progress", serde_json::json!({
                "uploadId": progress_id,
                "title": progress_title,
                "bytesSent": bytes_sent,
                "totalBytes": total_bytes,
            }));
        }
    };

    let result = AbsClient::new(server_url)
        .with_token(token)
        .upload_media(
            crate::api::UploadForm {
                library_id: &library_id,
                folder_id: &folder_id,
                title: &title,
                author: &author,
                series: &series,
            },
            &file_paths,
            cancel.clone(),
            on_progress,
        )
        .await;

    uploads.0.lock().await.remove(&upload_id);

    match result {
        Ok(()) => {
            log::info!(target: "skald::library", "upload complete lib={library_id} title={title} bytes={total_bytes}");
            let _ = app_handle.emit("upload-complete", serde_json::json!({
                "uploadId": upload_id,
                "title": title,
            }));
            Ok(())
        }
        // A cancel surfaces as a body-stream error from reqwest; the token tells
        // the difference between "user aborted" and a genuine network failure.
        Err(_) if cancel.is_cancelled() => {
            log::info!(target: "skald::library", "upload cancelled lib={library_id} title={title}");
            let _ = app_handle.emit("upload-cancelled", serde_json::json!({
                "uploadId": upload_id,
                "title": title,
            }));
            Err("cancelled".to_string())
        }
        Err(e) => {
            log::error!(target: "skald::library", "upload FAIL lib={library_id} title={title} err={e}");
            let _ = app_handle.emit("upload-failed", serde_json::json!({
                "uploadId": upload_id,
                "title": title,
                "error": e.clone(),
            }));
            Err(e)
        }
    }
}

/// Signals an in-progress upload to abort. The byte-counting stream checks the
/// token per chunk and errors the request body, which aborts the HTTP request;
/// upload_media then emits upload-cancelled. Safe to call for an unknown id.
#[tauri::command]
pub async fn cancel_upload(
    upload_id: String,
    uploads: tauri::State<'_, UploadCancelRegistry>,
) -> Result<(), String> {
    let map = uploads.0.lock().await;
    if let Some(token) = map.get(&upload_id) {
        token.cancel();
    }
    Ok(())
}


#[cfg(test)]
mod upload_validation_tests {
    use super::upload_ext_allowed;
    use std::path::Path;

    // The Tauri command boundary must reject non-media files no matter what
    // the frontend picker claimed (2nd-pass review P2). Note .txt/.nfo ARE
    // allowed — they're supplemental liner-note sidecars (SUPPLEMENTAL_EXTS).
    #[test]
    fn rejects_non_media_files() {
        for p in ["C:/secrets/id_rsa", "C:/keys/private.pem", "C:/app/skald.exe", "C:/x/archive.zip", "C:/x/noext", "C:/w/lib.dll"] {
            assert!(!upload_ext_allowed(Path::new(p)), "must reject {p}");
        }
    }

    #[test]
    fn accepts_audio_supplemental_and_epub() {
        for p in ["C:/b/track.m4b", "C:/b/track.MP3", "C:/b/track.flac", "C:/b/cover.jpg", "C:/b/book.epub"] {
            assert!(upload_ext_allowed(Path::new(p)), "must accept {p}");
        }
    }
}
