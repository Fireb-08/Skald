use std::sync::Arc;
use tokio::sync::Mutex;

use crate::{api::AbsClient, auth, cover_cache, models, session::SessionManager};

#[tauri::command]
pub async fn login(
    server_url: String,
    username: String,
    password: String,
) -> Result<models::User, String> {
    let client = AbsClient::new(server_url);
    let user = client.login(&username, &password).await?;
    auth::save_token(&user.token)?;
    Ok(user)
}

#[tauri::command]
pub fn logout() -> Result<(), String> {
    auth::clear_token()
}

#[tauri::command]
pub fn has_token() -> Result<bool, String> {
    Ok(auth::load_token()?.is_some())
}

#[tauri::command]
pub fn save_token(token: String) -> Result<(), String> {
    auth::save_token(&token)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSessionResult {
    session_id: String,
    current_time: f64,
}

#[tauri::command]
pub async fn open_playback_session(
    server_url: String,
    item_id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<OpenSessionResult, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    // Scope the SessionManager lock so it is released before this command
    // returns — play_audio acquires the same lock and must not see it held.
    let result = {
        let mut mgr = state.lock().await;
        mgr.client = AbsClient::new(server_url).with_token(token);
        let current_time = mgr.start_session(&item_id, app).await?;
        let session_id = mgr.session_id.clone()
            .ok_or_else(|| "Session ID not set after start".to_string())?;
        OpenSessionResult { session_id, current_time }
    };
    Ok(result)
}

#[tauri::command]
pub async fn play_audio(
    state: tauri::State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    let player_arc = Arc::clone(&state.lock().await.player);
    let guard = player_arc.lock().unwrap();
    match guard.as_ref() {
        Some(p) => p.play(),
        None => Err("No audio player initialized".to_string()),
    }
}

#[tauri::command]
pub async fn pause_audio(
    state: tauri::State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    let player_arc = Arc::clone(&state.lock().await.player);
    let guard = player_arc.lock().unwrap();
    match guard.as_ref() {
        Some(p) => { p.pause(); Ok(()) }
        None => Err("No audio player initialized".to_string()),
    }
}

#[tauri::command]
pub async fn seek_audio(
    secs: f64,
    state: tauri::State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    let player_arc = Arc::clone(&state.lock().await.player);
    let guard = player_arc.lock().unwrap();
    match guard.as_ref() {
        Some(p) => p.seek(secs),
        None => Err("No audio player initialized".to_string()),
    }
}

#[tauri::command]
pub async fn set_speed(
    rate: f32,
    state: tauri::State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    let player_arc = Arc::clone(&state.lock().await.player);
    let guard = player_arc.lock().unwrap();
    match guard.as_ref() {
        Some(p) => p.set_speed(rate),
        None => Err("No audio player initialized".to_string()),
    }
}

#[tauri::command]
pub async fn set_volume(
    vol: i32,
    state: tauri::State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    let player_arc = Arc::clone(&state.lock().await.player);
    let guard = player_arc.lock().unwrap();
    match guard.as_ref() {
        Some(p) => p.set_volume(vol),
        None => Err("No audio player initialized".to_string()),
    }
}

#[tauri::command]
pub async fn get_me(server_url: String) -> Result<models::MeResponse, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url).with_token(token).get_me().await
}

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
pub async fn fetch_listening_stats(
    server_url: String,
    user_id: String,
) -> Result<models::ListeningStats, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .get_listening_stats(&user_id)
        .await
}

#[tauri::command]
pub async fn create_bookmark(
    server_url: String,
    item_id: String,
    time: f64,
    title: String,
) -> Result<models::Bookmark, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .create_bookmark(&item_id, time, &title)
        .await
}

#[tauri::command]
pub async fn delete_progress(
    server_url: String,
    item_id: String,
) -> Result<(), String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .delete_progress(&item_id)
        .await
}

#[tauri::command]
pub async fn update_progress(
    server_url: String,
    item_id: String,
    current_time: f64,
    duration: f64,
    is_finished: bool,
) -> Result<(), String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .update_progress(&item_id, current_time, duration, is_finished)
        .await
}

#[tauri::command]
pub async fn sync_session(
    server_url: String,
    session_id: String,
    current_time: f64,
    time_listened: f64,
) -> Result<(), String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .sync_session(&session_id, current_time, time_listened)
        .await
}

#[tauri::command]
pub async fn get_audio_devices(
    state: tauri::State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<Vec<models::AudioDevice>, String> {
    let player_arc = Arc::clone(&state.lock().await.player);
    let guard = player_arc.lock().unwrap();
    match guard.as_ref() {
        Some(p) => Ok(p.get_audio_devices()),
        None => Ok(vec![models::AudioDevice {
            id: String::new(),
            name: "System Default".to_string(),
        }]),
    }
}

#[tauri::command]
pub async fn set_audio_device(
    device_id: String,
    state: tauri::State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    let player_arc = Arc::clone(&state.lock().await.player);
    let guard = player_arc.lock().unwrap();
    if let Some(p) = guard.as_ref() {
        p.set_audio_device(&device_id);
    }
    Ok(())
}

#[tauri::command]
pub async fn get_cover(
    server_url: String,
    item_id: String,
) -> Result<Vec<u8>, String> {
    if cover_cache::is_cached(&item_id) {
        return cover_cache::load_cover(&item_id);
    }
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    let bytes = AbsClient::new(server_url)
        .with_token(token)
        .fetch_cover(&item_id)
        .await?;
    cover_cache::save_cover(&item_id, &bytes)?;
    Ok(bytes)
}

#[tauri::command]
pub async fn update_media(
    server_url: String,
    item_id: String,
    metadata: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .update_media(&item_id, metadata)
        .await
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
pub async fn close_active_session(
    state: tauri::State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    let mut mgr = state.lock().await;
    if mgr.session_id.is_none() {
        return Ok(()); // no session open, nothing to do
    }
    let result = mgr.close().await;
    mgr.session_id = None; // prevent the sync task from retrying a closed session
    result
}

pub type ShortcutActionMap =
    std::sync::Arc<std::sync::RwLock<std::collections::HashMap<u32, String>>>;

#[derive(serde::Deserialize)]
pub struct ShortcutBinding {
    pub action: String,
    pub shortcut: String,
}

#[tauri::command]
pub fn register_shortcuts(
    bindings: Vec<ShortcutBinding>,
    app: tauri::AppHandle,
    action_map: tauri::State<'_, ShortcutActionMap>,
) -> Result<(), String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

    app.global_shortcut()
        .unregister_all()
        .map_err(|e| e.to_string())?;

    let mut map = action_map.write().unwrap();
    map.clear();

    for binding in bindings {
        let shortcut: Shortcut = binding.shortcut.parse()
            .map_err(|e| format!("Invalid shortcut '{}': {e}", binding.shortcut))?;
        map.insert(shortcut.id(), binding.action.clone());
        app.global_shortcut()
            .register(shortcut)
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn get_cache_dir() -> Result<String, String> {
    directories::ProjectDirs::from("com", "skald", "Skald")
        .map(|dirs| dirs.cache_dir().to_string_lossy().into_owned())
        .ok_or_else(|| "Could not determine cache directory".to_string())
}

#[tauri::command]
pub fn reveal_cache_dir() -> Result<(), String> {
    let path = get_cache_dir()?;
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    std::process::Command::new("explorer")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn close_session(
    server_url: String,
    session_id: String,
    current_time: f64,
    time_listened: f64,
) -> Result<(), String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .close_session(&session_id, current_time, time_listened)
        .await
}

