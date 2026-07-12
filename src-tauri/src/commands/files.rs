use crate::{api::AbsClient, auth, models};
use std::path::PathBuf;

fn client(server_url: String) -> Result<AbsClient, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    Ok(AbsClient::new(server_url).with_token(token))
}

#[tauri::command]
pub async fn fetch_item_expanded(
    server_url: String,
    item_id: String,
) -> Result<models::LibraryItem, String> {
    log::info!(target: "skald::library", "file inspector load start item={item_id}");
    let result = client(server_url)?.get_item_expanded(&item_id).await;
    match &result {
        Ok(item) => log::info!(target: "skald::library", "file inspector load success item={} files={}", item_id, item.library_files.as_ref().map_or(0, Vec::len)),
        Err(error) => log::warn!(target: "skald::library", "file inspector load failed item={item_id}: {error}"),
    }
    result
}

#[tauri::command]
pub async fn get_audio_file_probe(
    server_url: String,
    item_id: String,
    file_id: String,
) -> Result<serde_json::Value, String> {
    log::info!(target: "skald::library", "audio probe start item={item_id} file={file_id}");
    let result = client(server_url)?.get_audio_file_probe(&item_id, &file_id).await;
    match &result {
        Ok(_) => log::info!(target: "skald::library", "audio probe success item={item_id} file={file_id}"),
        Err(error) => log::warn!(target: "skald::library", "audio probe failed item={item_id} file={file_id}: {error}"),
    }
    result
}

#[tauri::command]
pub async fn download_library_file(
    server_url: String,
    item_id: String,
    file_id: String,
    destination: String,
) -> Result<u64, String> {
    log::info!(target: "skald::downloads", "individual file download start item={item_id} file={file_id}");
    let result = client(server_url)?
        .download_library_file(&item_id, &file_id, &PathBuf::from(destination))
        .await;
    match &result {
        Ok(bytes) => log::info!(target: "skald::downloads", "individual file download success item={item_id} file={file_id} bytes={bytes}"),
        Err(error) => log::warn!(target: "skald::downloads", "individual file download failed item={item_id} file={file_id}: {error}"),
    }
    result
}

#[tauri::command]
pub async fn delete_library_file(
    server_url: String,
    item_id: String,
    file_id: String,
) -> Result<(), String> {
    log::info!(target: "skald::library", "individual file delete start item={item_id} file={file_id}");
    let result = client(server_url)?.delete_library_file(&item_id, &file_id).await;
    match &result {
        Ok(()) => log::info!(target: "skald::library", "individual file delete success item={item_id} file={file_id}"),
        Err(error) => log::warn!(target: "skald::library", "individual file delete failed item={item_id} file={file_id}: {error}"),
    }
    result
}

#[tauri::command]
pub async fn update_item_tracks(
    server_url: String,
    item_id: String,
    ordered_file_data: Vec<models::TrackUpdateInput>,
) -> Result<models::LibraryItem, String> {
    if ordered_file_data.is_empty() {
        return Err("Track update requires at least one audio file".to_string());
    }
    let mut seen = std::collections::HashSet::new();
    if ordered_file_data.iter().any(|entry| !seen.insert(entry.ino.clone())) {
        return Err("Track update contains duplicate audio files".to_string());
    }
    let included = ordered_file_data.iter().filter(|entry| !entry.exclude).count();
    let excluded = ordered_file_data.len() - included;
    log::info!(target: "skald::playback", "track update start item={item_id} included={included} excluded={excluded}");
    let result = client(server_url)?.update_item_tracks(&item_id, &ordered_file_data).await;
    match &result {
        Ok(_) => log::info!(target: "skald::playback", "track update success item={item_id} included={included} excluded={excluded}"),
        Err(error) => log::warn!(target: "skald::playback", "track update failed item={item_id}: {error}"),
    }
    result
}
