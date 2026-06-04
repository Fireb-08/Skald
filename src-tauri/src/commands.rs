use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::Emitter; // .emit() on AppHandle is a trait method — must be in scope
use tokio_util::sync::CancellationToken;

use crate::{api::AbsClient, auth, cover_cache, downloads, models, session::SessionManager, socket};

// Close an async file handle and delete the file from disk.
// On Windows, an open file handle prevents remove_file from succeeding, so the
// handle must be fully released first. into_std() hands the async wrapper back
// to blocking I/O; dropping the returned std::fs::File closes the OS handle.
// Used by every error/cancel path in download_item.
async fn delete_partial(file: tokio::fs::File, path: &std::path::Path) {
    drop(file.into_std().await);
    let _ = std::fs::remove_file(path);
}

// Resolves the downloads directory under the app's local-data folder.
// Factored out so download_item, get_downloads, and remove_download all use the same path.
fn downloads_dir() -> Result<std::path::PathBuf, String> {
    directories::ProjectDirs::from("com", "skald", "Skald")
        .map(|dirs| dirs.data_local_dir().join("downloads"))
        .ok_or_else(|| "Could not determine downloads directory".to_string())
}

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

/// Opens a local audio file in LibVLC for offline playback.
/// Uses the same AudioPlayer state as the online path — all existing
/// transport controls (pause, seek, speed) work identically because they all
/// go through SessionManager.player, which this command also uses.
/// file_path may be either a single audio file path or a directory path
/// (multi-file book); the session layer resolves the correct first file.
#[tauri::command]
pub async fn play_local_file(
    file_path: String,
    start_time: f64,
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    let mut mgr = state.lock().await;
    mgr.play_local(&file_path, start_time, app).await
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

/// Paginated listening sessions with optional server-side sorting.
/// user_id=None → all sessions (admin); "__me__" → own; id → specific user.
/// sort/desc are forwarded to ABS so it orders the full dataset, not just one page.
#[tauri::command]
pub async fn get_listening_sessions(
    server_url: String,
    user_id: Option<String>,
    page: u32,
    items_per_page: u32,
    sort: Option<String>,   // ABS sort field name — None omits the param
    desc: Option<bool>,     // true=descending, false=ascending, None=omit
) -> Result<models::ListeningSessionsResponse, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        // Convert Option<String> to Option<&str> for the AbsClient method.
        .get_listening_sessions(user_id.as_deref(), page, items_per_page, sort.as_deref(), desc)
        .await
}

/// DELETE /api/sessions/{id} — admin-only, permanently removes a session record.
/// The ABS server enforces admin access; Skald additionally hides this button
/// from non-admin users in the UI.
#[tauri::command]
pub async fn delete_session(
    server_url: String,
    session_id: String,
) -> Result<(), String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .delete_session(&session_id)
        .await
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

    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;

    // Resolve and create the downloads directory (e.g. AppData\Local\skald\Skald\downloads).
    let dl_dir = downloads_dir()?;
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
    // where we use token-in-URL per CLAUDE.md critical lesson 2).
    let client = reqwest::Client::new();

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
            break LoopExit::WriteError(format!("Write error: {e}"));
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
    let extract_dir = dl_dir.join(&item_id);
    std::fs::create_dir_all(&extract_dir)
        .map_err(|e| format!("Failed to create extract dir: {e}"))?;

    // Run extraction inside a closure so all failure branches share one cleanup
    // block rather than duplicating the remove_dir_all / remove_file calls.
    let zip_result: Result<(), String> = (|| {
        let zip_file = std::fs::File::open(&file_path)
            .map_err(|e| format!("Failed to open zip: {e}"))?;
        let mut archive = zip::ZipArchive::new(zip_file)
            .map_err(|e| format!("Failed to read zip: {e}"))?;

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
        let _ = std::fs::remove_dir_all(&extract_dir); // partial extracted files
        let _ = std::fs::remove_file(&file_path);      // the ZIP itself
        cancel_registry.lock().await.remove(&item_id);
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
    if let Err(e) = std::fs::remove_file(&file_path) {
        eprintln!("[download_item] could not remove zip {}: {e}", file_path.display());
    }

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
    })?;

    // Remove the cancellation token now that the download completed successfully.
    cancel_registry.lock().await.remove(&item_id);

    let _ = app_handle.emit("download-complete", serde_json::json!({
        "itemId": item_id,
        "title": title,
    }));

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
    let dir = downloads_dir()?;
    // If the directory does not yet exist, no downloads have been taken; return empty.
    if !dir.exists() {
        return Ok(Vec::new());
    }
    Ok(downloads::load_registry(&dir))
}

/// Removes a downloaded book: deletes the entire extracted directory (audio file,
/// cover image, and any other extracted files) and removes the registry entry.
/// The registry entry is always removed even when the directory is missing so
/// the UI stays consistent. Returns an error if the directory could not be
/// deleted; callers should still remove the row from local state because the
/// registry is already clean.
#[tauri::command]
pub fn remove_download(item_id: String) -> Result<(), String> {
    let dir = downloads_dir()?;
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

        if extract_dir.exists() {
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

/// GET /api/users/online → openSessions — returns all currently active playback sessions.
/// The /api/users/online response contains both connected user records and an openSessions
/// array; this command extracts only the sessions, which is what the Settings panel needs.
#[tauri::command]
pub async fn get_open_sessions(server_url: String) -> Result<Vec<models::ListeningSession>, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .get_online_open_sessions() // distinct from get_open_sessions which returns IDs for cleanup
        .await
}

/// GET /api/me/listening-stats — returns listening stats for the authenticated user.
/// Used by GreetingPane for the "Your stats" page: total time, days listened,
/// books finished, 7-day sparkline data, and recent sessions.
#[tauri::command]
pub async fn get_user_stats(server_url: String) -> Result<models::UserStats, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url).with_token(token).get_user_stats().await
}

/// GET /api/libraries/{id}/stats — returns aggregate statistics for a library.
/// Used by GreetingPane for the "Library stats" page: duration, authors, tracks,
/// file size, and top genres.
#[tauri::command]
pub async fn get_library_stats(
    server_url: String,
    library_id: String,
) -> Result<models::LibraryStats, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .get_library_stats(&library_id)
        .await
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

