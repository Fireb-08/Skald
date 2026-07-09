// Split from the original single-file commands.rs (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. Shared imports and state types
// come from the parent module (mod.rs) via the glob below.
use super::*;

#[tauri::command]
pub async fn get_cover(
    server_url: String,
    item_id: String,
    width: Option<u32>,
    // Cache-bust version — bumped by the frontend after a cover change so the
    // returned path (and asset:// URL) differs and the WebView reloads the image.
    bust: Option<u32>,
) -> Result<String, String> {
    let version = bust.unwrap_or(0);
    // Returns the absolute path of the cached cover file on disk rather than its
    // bytes. The frontend converts this path to an asset:// URL via Tauri's
    // convertFileSrc so WebView2 can fetch the image straight from disk through
    // the asset protocol — no base64 round-trip over the IPC bridge.
    // `width` is threaded into the cache key so covers fetched at different
    // widths are stored separately and never collide.
    if !cover_cache::is_cached(&item_id, width, version) {
        // Not yet cached: fetch from ABS (resized when width is Some) and write to disk.
        let token = auth::load_token()?
            .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
        let bytes = AbsClient::new(server_url)
            .with_token(token)
            .fetch_cover(&item_id, width)
            .await?;
        cover_cache::save_cover(&item_id, width, version, &bytes)?;
    }
    // The file is now guaranteed to exist in the cache — return its path.
    Ok(cover_cache::cache_path(&item_id, width, version).to_string_lossy().into_owned())
}

/// Download a remote image URL once and cache it on disk, returning the cached
/// file path (which the frontend turns into an asset:// URL). Used for podcast
/// feed artwork the ABS server doesn't store: instead of re-loading the remote
/// `<img src>` on every render, the bytes are fetched a single time and then
/// served from disk, mirroring how server/local covers behave.
#[tauri::command]
pub async fn cache_remote_image(url: String) -> Result<String, String> {
    if cover_cache::remote_is_cached(&url) {
        return Ok(cover_cache::remote_cache_path(&url).to_string_lossy().into_owned());
    }
    let resp = crate::api::bounded_client()
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("remote image fetch failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("remote image fetch HTTP {}", resp.status()));
    }
    // Stream with a byte cap — the URL comes from arbitrary feed metadata, so an
    // unbounded .bytes() read would let a hostile endpoint buffer without limit.
    use futures_util::StreamExt;
    const MAX_IMAGE_BYTES: usize = 25 * 1024 * 1024;
    let mut bytes: Vec<u8> = Vec::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("remote image read failed: {e}"))?;
        if bytes.len() + chunk.len() > MAX_IMAGE_BYTES {
            log::warn!(target: "skald::metadata", "remote image exceeds {} MB cap url={}", MAX_IMAGE_BYTES / (1024 * 1024), crate::redact_url(&url));
            return Err(format!("remote image exceeds the {} MB size limit", MAX_IMAGE_BYTES / (1024 * 1024)));
        }
        bytes.extend_from_slice(&chunk);
    }
    let path = cover_cache::save_remote(&url, &bytes)?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn update_media(
    server_url: String,
    item_id: String,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .update_media(&item_id, payload)
        .await
}

/// PATCH /api/items/:id/chapters — replace the chapter markers.
#[tauri::command]
pub async fn update_chapters(
    server_url: String,
    item_id: String,
    chapters: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .update_chapters(&item_id, chapters)
        .await
}

// ── Cover management (admin/canUpload) ───────────────────────────────────────
// set/upload/remove clear the on-disk cover cache after success so the next
// fetch re-downloads the new art.

/// GET /api/search/covers — find cover candidates (array of image URLs).
#[tauri::command]
pub async fn find_covers(
    server_url: String,
    title: String,
    author: String,
    provider: String,
) -> Result<Vec<String>, String> {
    let token = auth::load_token()?.ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).find_covers(&title, &author, &provider).await
}

/// POST /api/items/:id/cover { url } — set the cover from a remote URL.
#[tauri::command]
pub async fn set_cover_url(server_url: String, item_id: String, url: String) -> Result<(), String> {
    let token = auth::load_token()?.ok_or_else(|| "Not authenticated".to_string())?;
    let result = AbsClient::new(server_url).with_token(token).set_cover_url(&item_id, &url).await;
    if result.is_ok() { cover_cache::clear(&item_id); }
    result
}

/// POST /api/items/:id/cover (multipart) — upload a local image as the cover.
#[tauri::command]
pub async fn upload_cover(server_url: String, item_id: String, file_path: String) -> Result<(), String> {
    let token = auth::load_token()?.ok_or_else(|| "Not authenticated".to_string())?;
    let result = AbsClient::new(server_url).with_token(token).upload_cover(&item_id, &file_path).await;
    if result.is_ok() { cover_cache::clear(&item_id); }
    result
}

/// DELETE /api/items/:id/cover — remove the cover.
#[tauri::command]
pub async fn remove_cover(server_url: String, item_id: String) -> Result<(), String> {
    let token = auth::load_token()?.ok_or_else(|| "Not authenticated".to_string())?;
    let result = AbsClient::new(server_url).with_token(token).remove_cover(&item_id).await;
    if result.is_ok() { cover_cache::clear(&item_id); }
    result
}

#[tauri::command]
pub async fn search_books(
    server_url: String,
    title: String,
    author: String,
    provider: String,
) -> Result<serde_json::Value, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .search_books(&title, &author, &provider)
        .await
}

#[tauri::command]
pub async fn search_providers(server_url: String) -> Result<serde_json::Value, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .search_providers()
        .await
}
