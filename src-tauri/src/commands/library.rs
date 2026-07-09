// Split from the original single-file commands.rs (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. Shared imports and state types
// come from the parent module (mod.rs) via the glob below.
use super::*;

#[tauri::command]
pub async fn fetch_libraries(server_url: String) -> Result<Vec<models::Library>, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url).with_token(token).get_libraries().await
}

#[tauri::command]
pub async fn fetch_library_items(
    server_url: String,
    library_id: String,
) -> Result<Vec<models::LibraryItem>, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .get_library_items(&library_id)
        .await
}

#[tauri::command]
pub async fn get_library_series(
    server_url: String,
    library_id: String,
) -> Result<Vec<models::LibrarySeries>, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .get_library_series(&library_id)
        .await
}

/// Fetch books belonging to one series using the ABS server-side filter.
/// The series_id must be Base64-encoded by the API layer before appending to the filter param.
#[tauri::command]
pub async fn get_series_items(
    server_url: String,
    library_id: String,
    series_id: String,
) -> Result<Vec<models::LibraryItem>, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .get_series_items(&library_id, &series_id)
        .await
}

#[tauri::command]
pub async fn get_continue_listening(
    server_url: String,
    library_id: String,
) -> Result<Vec<models::LibraryItem>, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .get_continue_listening(&library_id)
        .await
}

#[tauri::command]
pub async fn fetch_item(
    server_url: String,
    item_id: String,
) -> Result<models::LibraryItem, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .get_item(&item_id)
        .await
}

#[tauri::command]
pub async fn delete_item(
    server_url: String,
    item_id: String,
) -> Result<(), String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .delete_item(&item_id)
        .await
}

#[tauri::command]
pub async fn rescan_item(
    server_url: String,
    item_id: String,
) -> Result<(), String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .rescan_item(&item_id)
        .await
}
