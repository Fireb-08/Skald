use std::sync::Arc;
use tokio::sync::Mutex;

use crate::{api::AbsClient, auth, cover_cache, models, session::SessionManager, socket};

#[tauri::command]
pub async fn login(
    server_url: String,
    username: String,
    password: String,
) -> Result<models::User, String> {
    let abs_client = AbsClient::new(server_url.clone());
    let mut user = abs_client.login(&username, &password).await?;
    let legacy_token = user.token.clone();

    // After /login, call GET /api/authorize with the legacy token to obtain a
    // proper JWT access token (with exp field) that the socket validator accepts.
    // The legacy token from /login works for HTTP Bearer auth but is rejected by
    // the ABS socket middleware which expects a signed JWT.
    let http = reqwest::Client::new();
    let server_root = server_url.trim_end_matches('/');
    let auth_resp = http
        .get(format!("{server_root}/api/authorize"))
        .header("Authorization", format!("Bearer {legacy_token}"))
        .send()
        .await
        .map_err(|e| format!("Authorize failed: {e}"))?;

    // Parse as generic JSON — avoid hard struct failures if the response shape
    // differs between ABS versions. Null signals a parse problem.
    let auth_json: serde_json::Value = auth_resp
        .json::<serde_json::Value>()
        .await
        .unwrap_or(serde_json::Value::Null);

    // Prefer the top-level accessToken (JWT with exp). Fall back to
    // user.token inside the authorize response, then the legacy token.
    let token = auth_json["accessToken"]
        .as_str()
        .filter(|t| !t.is_empty())
        .or_else(|| auth_json["user"]["token"].as_str().filter(|t| !t.is_empty()))
        .unwrap_or(&legacy_token)
        .to_string();

    auth::save_token(&token)?;
    user.token = token;
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
    start_time: Option<f64>,
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
        let current_time = mgr.start_session(&item_id, app, start_time).await?;
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

#[tauri::command]
pub async fn get_collections(
    server_url: String,
    library_id: String,
) -> Result<Vec<models::Collection>, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
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
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .create_collection(&library_id, &name, &book_id)
        .await
}

#[tauri::command]
pub async fn add_book_to_collection(
    server_url: String,
    collection_id: String,
    book_id: String,
) -> Result<(), String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .add_book_to_collection(&collection_id, &book_id)
        .await
}

/// Closes all open listening sessions for the current user. Called once on
/// app startup to clean up ghost sessions left from previous runs so the
/// server's session list stays consistent.
#[tauri::command]
pub async fn close_all_open_sessions(server_url: String) -> Result<u32, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    let client = AbsClient::new(server_url).with_token(token);
    let ids = client.get_open_sessions().await?;
    let mut closed: u32 = 0;
    for id in &ids {
        match client.close_session_by_id(id).await {
            Ok(()) => { closed += 1; }
            Err(e) => { eprintln!("[close_all_open_sessions] failed to close {id}: {e}"); }
        }
    }
    eprintln!("[close_all_open_sessions] closed {closed} of {} sessions", ids.len());
    Ok(closed)
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

// ── Admin user-management commands ──────────────────────────────────────────
// These four commands wrap the AbsClient admin endpoints. They are gated by
// the ABS server itself (HTTP 403 for non-admin callers); Skald additionally
// hides the UI for non-admin users so normal accounts never trigger them.

// ── Phase B: Socket.IO transport commands ────────────────────────────────────
// connect_socket and disconnect_socket are the only public interface into
// socket.rs from the frontend.  All Phase C/D/E event handling will be wired
// inside socket.rs — these commands remain the sole entry points.

/// Opens an authenticated Socket.IO connection to the ABS server.
/// Called when the user enables live sync, or automatically on startup when
/// the `onyx.sync.live` preference is already true.
/// Takes server_url and token explicitly so the command is stateless from
/// the caller's perspective — the connection object is stored internally.
#[tauri::command]
pub async fn connect_socket(
    server_url: String,
    token: String,
    app: tauri::AppHandle,
    socket: tauri::State<'_, socket::SocketState>,
) -> Result<(), String> {
    socket::connect(server_url, token, app, socket.inner().clone()).await
}

/// Return type for login_with_api_key — carries both the user profile and the
/// user session JWT extracted from the /api/me response. The frontend uses the
/// JWT for both HTTP Bearer auth and socket authentication; the raw API key is
/// not stored after login.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyLoginResult {
    /// User profile fields (id, username, type, etc.)
    pub user: models::User,
    /// User session JWT from the token field of the /api/me response.
    /// This is the credential used for socket auth, not the API key itself.
    pub token: String,
}

/// Validates an API key by calling GET /api/me with the key as Bearer token.
/// Returns both the user profile and the session JWT extracted from the response.
/// The API key is only used once to obtain the JWT; callers store the JWT.
#[tauri::command]
pub async fn login_with_api_key(
    server_url: String,
    api_key: String,
) -> Result<ApiKeyLoginResult, String> {
    let client = reqwest::Client::new();
    let response = client
        .get(format!("{}/api/me", server_url.trim_end_matches('/')))
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| format!("Connection failed: {e}"))?;

    // Capture status before consuming the body — status() borrows the response
    // but text()/json() consume it, so we must copy the value first.
    let status = response.status();

    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Invalid API key — server returned {status}: {body}"));
    }

    // Parse as generic JSON so we can extract token and user fields separately.
    let body_text = response.text().await.unwrap_or_default();
    let body_json: serde_json::Value = serde_json::from_str(&body_text)
        .map_err(|e| format!("Failed to parse response: {e}"))?;

    // Extract the user session JWT from the token field — socket auth needs
    // this JWT, not the raw API key the user entered.
    let token = body_json["token"]
        .as_str()
        .unwrap_or("")
        .to_string();

    // Deserialize User fields — extra fields (mediaProgress, bookmarks, etc.)
    // are silently ignored by serde.
    let user: models::User = serde_json::from_value(body_json)
        .map_err(|e| format!("Failed to parse user: {e}"))?;

    Ok(ApiKeyLoginResult { user, token })
}

/// Clears the stored keyring token so the next launch forces a fresh login.
/// Intended for one-time use from devtools when the stored token is stale.
#[tauri::command]
pub fn clear_stored_token() -> Result<(), String> {
    auth::clear_token()
}

/// Tears down the active Socket.IO connection cleanly.
/// Called when the user disables live sync, on logout, or on app close.
/// Safe to call when no connection is open.
#[tauri::command]
pub async fn disconnect_socket(
    socket: tauri::State<'_, socket::SocketState>,
) -> Result<(), String> {
    socket::disconnect(socket.inner().clone()).await;
    Ok(())
}

/// GET /api/users/online — returns the IDs of users currently connected via WebSocket.
/// Used to drive the presence dot on each user row in the admin account panel.
/// Any authenticated user can call this; the ABS server does not restrict it to admins.
#[tauri::command]
pub async fn get_online_users(server_url: String) -> Result<Vec<String>, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url).with_token(token).get_online_users().await
}

/// GET /api/users — returns every user account on the server.
/// Admin and root accounts only; the ABS server returns 403 for others.
#[tauri::command]
pub async fn get_all_users(server_url: String) -> Result<Vec<models::AdminUser>, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url).with_token(token).get_all_users().await
}

/// POST /api/users — creates a new user account on the server.
/// `user_type` must be "user" or "admin"; "root" cannot be created via API.
#[tauri::command]
pub async fn create_user(
    server_url: String,
    username: String,
    password: String,
    user_type: String,
) -> Result<models::AdminUser, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .create_user(&username, &password, &user_type)
        .await
}

/// PATCH /api/users/{id} — partially updates a user account.
/// Any `None` field is omitted from the request body so the server keeps the
/// existing value. An empty string `password` is converted to `None` here so
/// that leaving the password field blank in the UI does not overwrite it.
#[tauri::command]
pub async fn update_user(
    server_url: String,
    user_id: String,
    username: Option<String>,
    password: Option<String>,
    user_type: Option<String>,
) -> Result<models::AdminUser, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    // Treat an empty password string the same as None so the server keeps the
    // existing hash rather than overwriting it with an empty password.
    let pw = password.as_deref().filter(|s| !s.is_empty());
    AbsClient::new(server_url)
        .with_token(token)
        .update_user(
            &user_id,
            username.as_deref(),
            pw,
            user_type.as_deref(),
        )
        .await
}

/// DELETE /api/users/{id} — permanently removes a user account from the server.
/// The UI prevents deletion of the currently logged-in user's own row, but
/// the server would reject self-deletion anyway.
#[tauri::command]
pub async fn delete_user(server_url: String, user_id: String) -> Result<(), String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .delete_user(&user_id)
        .await
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

