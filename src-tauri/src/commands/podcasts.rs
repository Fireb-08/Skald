// Split from the original single-file commands.rs (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. Shared imports and state types
// come from the parent module (mod.rs) via the glob below.
use super::*;

// ── Podcasts (gap-analysis cluster E) ────────────────────────────────────────
// Thin wrappers over the AbsClient podcast methods. [Podcast] diagnostics are
// retained through the roadmap (per CLAUDE.md) so the user can trace the
// subscribe → browse → download → play flow during `pnpm tauri dev`.

/// POST /api/podcasts/feed — preview an RSS feed before subscribing.
#[tauri::command]
pub async fn get_podcast_feed(server_url: String, rss_feed: String) -> Result<serde_json::Value, String> {
    let token = auth::load_token()?.ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).get_podcast_feed(&rss_feed).await
}

/// POST /api/podcasts — create a podcast item from a previewed feed.
#[tauri::command]
pub async fn create_podcast(server_url: String, payload: serde_json::Value) -> Result<models::LibraryItem, String> {
    let token = auth::load_token()?.ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).create_podcast(payload).await
}

/// POST /api/podcasts/opml/parse — parse OPML text into a feed list.
#[tauri::command]
pub async fn parse_opml(server_url: String, opml_text: String) -> Result<serde_json::Value, String> {
    let token = auth::load_token()?.ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).parse_opml(&opml_text).await
}

/// POST /api/podcasts/opml/create — bulk-subscribe from OPML feed URLs.
#[tauri::command]
pub async fn create_podcasts_from_opml(server_url: String, payload: serde_json::Value) -> Result<(), String> {
    let token = auth::load_token()?.ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).create_from_opml(payload).await
}

/// GET /api/podcasts/:id/checknew — poll the feed for new episodes now.
#[tauri::command]
pub async fn check_new_episodes(server_url: String, item_id: String, limit: Option<u32>) -> Result<serde_json::Value, String> {
    let token = auth::load_token()?.ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).check_new_episodes(&item_id, limit).await
}

/// GET /api/podcasts/:id/downloads — current episode download queue.
#[tauri::command]
pub async fn get_episode_downloads(server_url: String, item_id: String) -> Result<serde_json::Value, String> {
    let token = auth::load_token()?.ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).get_episode_downloads(&item_id).await
}

/// GET /api/podcasts/:id/clear-queue — clear queued episode downloads.
#[tauri::command]
pub async fn clear_episode_download_queue(server_url: String, item_id: String) -> Result<(), String> {
    let token = auth::load_token()?.ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).clear_download_queue(&item_id).await
}

/// POST /api/podcasts/:id/download-episodes — queue episodes for download.
#[tauri::command]
pub async fn download_episodes(server_url: String, item_id: String, episodes: serde_json::Value) -> Result<(), String> {
    let token = auth::load_token()?.ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).download_episodes(&item_id, episodes).await
}

/// GET /api/podcasts/:id/search-episode — find one episode in the live feed.
#[tauri::command]
pub async fn find_episode(server_url: String, item_id: String, title: String) -> Result<serde_json::Value, String> {
    let token = auth::load_token()?.ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).find_episode(&item_id, &title).await
}

/// POST /api/podcasts/:id/match-episodes — quick-match episode metadata.
#[tauri::command]
pub async fn match_episodes(server_url: String, item_id: String, override_existing: bool) -> Result<serde_json::Value, String> {
    let token = auth::load_token()?.ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).match_episodes(&item_id, override_existing).await
}

/// GET /api/podcasts/:id/episode/:episodeId — fetch one episode.
#[tauri::command]
pub async fn get_episode(server_url: String, item_id: String, episode_id: String) -> Result<serde_json::Value, String> {
    let token = auth::load_token()?.ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).get_episode(&item_id, &episode_id).await
}

/// PATCH /api/podcasts/:id/episode/:episodeId — edit episode metadata.
#[tauri::command]
pub async fn update_episode(server_url: String, item_id: String, episode_id: String, payload: serde_json::Value) -> Result<serde_json::Value, String> {
    let token = auth::load_token()?.ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).update_episode(&item_id, &episode_id, payload).await
}

/// DELETE /api/podcasts/:id/episode/:episodeId — remove an episode (hard=disk).
#[tauri::command]
pub async fn delete_episode(server_url: String, item_id: String, episode_id: String, hard: bool) -> Result<serde_json::Value, String> {
    let token = auth::load_token()?.ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).delete_episode(&item_id, &episode_id, hard).await
}

/// GET /api/libraries/:id/recent-episodes — recent-episodes shelf.
#[tauri::command]
pub async fn get_recent_episodes(server_url: String, library_id: String, limit: Option<u32>, page: Option<u32>) -> Result<serde_json::Value, String> {
    let token = auth::load_token()?.ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).get_recent_episodes(&library_id, limit, page).await
}

/// GET /api/libraries/:id/opml — export the podcast library as OPML XML.
#[tauri::command]
pub async fn export_opml(server_url: String, library_id: String) -> Result<String, String> {
    let token = auth::load_token()?.ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).export_opml(&library_id).await
}
