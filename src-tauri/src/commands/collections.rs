// Split from the original single-file commands.rs (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. Shared imports and state types
// come from the parent module (mod.rs) via the glob below.
use super::*;

#[tauri::command]
pub async fn get_collections(
    server_url: String,
    library_id: String,
) -> Result<Vec<models::Collection>, String> {
    AbsClient::authenticated(server_url)
        .await?
        .get_collections(&library_id)
        .await
}

#[tauri::command]
pub async fn create_collection(
    server_url: String,
    library_id: String,
    name: String,
    book_id: String,
) -> Result<models::Collection, String> {
    AbsClient::authenticated(server_url)
        .await?
        .create_collection(&library_id, &name, &book_id)
        .await
}

#[tauri::command]
pub async fn add_book_to_collection(
    server_url: String,
    collection_id: String,
    book_id: String,
) -> Result<(), String> {
    AbsClient::authenticated(server_url)
        .await?
        .add_book_to_collection(&collection_id, &book_id)
        .await
}

/// PATCH /api/collections/:id — update a collection (reorder books, or edit
/// name/description). `payload` is e.g. { books: [ids] } or { name, description }.
#[tauri::command]
pub async fn update_collection(
    server_url: String,
    collection_id: String,
    payload: serde_json::Value,
) -> Result<models::Collection, String> {
    AbsClient::authenticated(server_url).await?.update_collection(&collection_id, payload).await
}

/// DELETE /api/collections/:id/book/:bookId — remove a book from a collection.
#[tauri::command]
pub async fn remove_book_from_collection(
    server_url: String,
    collection_id: String,
    book_id: String,
) -> Result<models::Collection, String> {
    AbsClient::authenticated(server_url).await?.remove_book_from_collection(&collection_id, &book_id).await
}

// ── Playlist commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_playlists(
    server_url: String,
    library_id: String,
) -> Result<Vec<models::Playlist>, String> {
    AbsClient::authenticated(server_url)
        .await?
        .get_playlists(&library_id)
        .await
}

#[tauri::command]
pub async fn get_playlist(
    server_url: String,
    playlist_id: String,
) -> Result<models::Playlist, String> {
    AbsClient::authenticated(server_url)
        .await?
        .get_playlist(&playlist_id)
        .await
}

#[tauri::command]
pub async fn create_playlist(
    server_url: String,
    library_id: String,
    name: String,
    description: Option<String>,
    items: Option<Vec<models::PlaylistItemInput>>,
) -> Result<models::Playlist, String> {
    AbsClient::authenticated(server_url)
        .await?
        .create_playlist(&library_id, &name, description.as_deref(), items)
        .await
}

#[tauri::command]
pub async fn update_playlist(
    server_url: String,
    playlist_id: String,
    name: Option<String>,
    description: Option<String>,
    items: Option<Vec<models::PlaylistItemInput>>,
) -> Result<models::Playlist, String> {
    AbsClient::authenticated(server_url)
        .await?
        .update_playlist(&playlist_id, name.as_deref(), description.as_deref(), items)
        .await
}

#[tauri::command]
pub async fn delete_playlist(
    server_url: String,
    playlist_id: String,
) -> Result<(), String> {
    AbsClient::authenticated(server_url)
        .await?
        .delete_playlist(&playlist_id)
        .await
}

#[tauri::command]
pub async fn batch_add_to_playlist(
    server_url: String,
    playlist_id: String,
    items: Vec<models::PlaylistItemInput>,
) -> Result<models::Playlist, String> {
    AbsClient::authenticated(server_url)
        .await?
        .batch_add_to_playlist(&playlist_id, items)
        .await
}

#[tauri::command]
pub async fn batch_remove_from_playlist(
    server_url: String,
    playlist_id: String,
    items: Vec<models::PlaylistItemInput>,
) -> Result<models::Playlist, String> {
    AbsClient::authenticated(server_url)
        .await?
        .batch_remove_from_playlist(&playlist_id, items)
        .await
}

#[tauri::command]
pub async fn create_playlist_from_collection(
    server_url: String,
    collection_id: String,
) -> Result<models::Playlist, String> {
    AbsClient::authenticated(server_url)
        .await?
        .create_playlist_from_collection(&collection_id)
        .await
}
