// Split from the original single-file commands.rs (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. Shared imports and state types
// come from the parent module (mod.rs) via the glob below.
use super::*;

// ── Sharing & RSS feeds (cluster G) ──────────────────────────────────────────
// Admin-gated on the server (isAdminOrUp → 403).

/// POST /api/share/mediaitem — create a public share link. `expires_at` is Unix
/// ms; pass 0 for never-expires (ABS rejects null). Returns the created share.
#[tauri::command]
pub async fn create_share(
    server_url: String,
    slug: String,
    media_item_type: String,
    media_item_id: String,
    expires_at: Option<i64>,
    is_downloadable: bool,
) -> Result<models::MediaItemShare, String> {
    let token = auth::load_token()?.ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .create_share(&slug, &media_item_type, &media_item_id, expires_at, is_downloadable)
        .await
}

/// DELETE /api/share/mediaitem/:id — revoke a share.
#[tauri::command]
pub async fn delete_share(server_url: String, share_id: String) -> Result<(), String> {
    let token = auth::load_token()?.ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).delete_share(&share_id).await
}

/// GET /public/share/:slug — public re-validation of a tracked share (404 ⇒ gone).
#[tauri::command]
pub async fn get_share_by_slug(server_url: String, slug: String) -> Result<models::MediaItemShare, String> {
    AbsClient::new(server_url).get_share_by_slug(&slug).await
}

/// GET /api/items/:id?expanded=1&include=share — recover an item's existing share
/// (admin + book only). Returns None when the item has no share. This is how the
/// modal shows a link that already exists, even one created on the web client.
#[tauri::command]
pub async fn get_item_share(server_url: String, item_id: String) -> Result<Option<models::MediaItemShare>, String> {
    // Authenticated route (/api/items/:id) — unlike the public get_share_by_slug,
    // this needs the stored token.
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .get_item_share(&item_id)
        .await
}

/// GET /api/feeds — list all open RSS feeds.
#[tauri::command]
pub async fn get_feeds(server_url: String) -> Result<Vec<models::RssFeed>, String> {
    let token = auth::load_token()?.ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).get_feeds().await
}

/// POST /api/feeds/:kind/:id/open — open a feed for an item/collection/series.
/// `entity_kind` is "item" | "collection" | "series"; `server_address` is the
/// public ABS origin (pass the configured server URL).
#[tauri::command]
pub async fn open_feed(
    server_url: String,
    entity_kind: String,
    entity_id: String,
    server_address: String,
    slug: String,
) -> Result<models::RssFeed, String> {
    let token = auth::load_token()?.ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .open_feed(&entity_kind, &entity_id, &server_address, &slug)
        .await
}

/// POST /api/feeds/:id/close — close/revoke an open feed.
#[tauri::command]
pub async fn close_feed(server_url: String, feed_id: String) -> Result<(), String> {
    let token = auth::load_token()?.ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).close_feed(&feed_id).await
}