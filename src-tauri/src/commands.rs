use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::Emitter; // .emit() on AppHandle is a trait method — must be in scope
use tokio_util::sync::CancellationToken;

use crate::{api::AbsClient, audio, auth, cover_cache, downloads, eq::EqSettings, models::{self, BackupsResponse, CustomMetadataProvider, LoggerData, NotificationSettings, NotificationsResponse, ServerSettings, TasksResponse}, session::SessionManager, socket};

// Close an async file handle and delete the file from disk.
// On Windows, an open file handle prevents remove_file from succeeding, so the
// handle must be fully released first. into_std() hands the async wrapper back
// to blocking I/O; dropping the returned std::fs::File closes the OS handle.
// Used by every error/cancel path in download_item.
async fn delete_partial(file: tokio::fs::File, path: &std::path::Path) {
    drop(file.into_std().await);
    let _ = std::fs::remove_file(path);
}


/// Return type bundles the authenticated User with the ServerSettings that ABS
/// includes in the login response — capturing them here avoids a separate fetch.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginResult {
    pub user: models::User,
    pub server_settings: Option<ServerSettings>,
}

#[tauri::command]
pub async fn login(
    server_url: String,
    username: String,
    password: String,
) -> Result<LoginResult, String> {
    let abs_client = AbsClient::new(server_url.clone());
    let (mut user, server_settings) = abs_client.login(&username, &password).await?;
    let legacy_token = user.token.clone();

    // After /login, call POST /api/authorize with the legacy token to obtain a
    // proper JWT access token (with exp field) that the socket validator accepts.
    // The legacy token from /login works for HTTP Bearer auth but is rejected by
    // the ABS socket middleware which expects a signed JWT.
    // Note: /api/authorize is a POST route in ABS — a GET request returns 404.
    let http = reqwest::Client::new();
    let server_root = server_url.trim_end_matches('/');
    let auth_resp = http
        .post(format!("{server_root}/api/authorize"))
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

    // If /login didn't include serverSettings, try extracting it from the
    // authorize response (ABS may return it there instead).
    let resolved_settings = server_settings.or_else(|| {
        let raw = auth_json.get("serverSettings")?;
        serde_json::from_value::<ServerSettings>(raw.clone()).ok()
    });

    auth::save_token(&token)?;
    user.token = token;
    Ok(LoginResult { user, server_settings: resolved_settings })
}

#[tauri::command]
pub fn logout() -> Result<(), String> {
    auth::clear_token()
}

/// PATCH /api/settings — update one or more server settings fields. Admin only.
/// `payload` is a sparse JSON object; ABS merges it with existing values.
#[tauri::command]
pub async fn update_server_settings(
    server_url: String,
    payload: serde_json::Value,
) -> Result<ServerSettings, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).update_server_settings(payload).await
}

/// PATCH /api/sorting-prefixes — replace the server's sorting prefix list. Admin only.
/// Triggers a full title re-index on the server, so use sparingly.
#[tauri::command]
pub async fn update_sorting_prefixes(
    server_url: String,
    prefixes: Vec<String>,
) -> Result<ServerSettings, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).update_sorting_prefixes(prefixes).await
}

/// POST /api/authorize via the stored token to refresh serverSettings on an
/// already-logged-in app launch (the login-time payload is no longer available).
/// Admin only in practice — the Server Settings panel is the sole consumer — but
/// ABS returns serverSettings to any authenticated user, so no role check here.
#[tauri::command]
pub async fn fetch_server_settings(server_url: String) -> Result<ServerSettings, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).fetch_server_settings().await
}

// ── Notification settings (Apprise) — admin only ─────────────────────────────
// ABS restricts these endpoints to admins (403 otherwise). Each command loads
// the stored token and delegates to the matching AbsClient method.

/// GET /api/notifications — fetch the current settings + event catalog.
#[tauri::command]
pub async fn get_notifications(server_url: String) -> Result<NotificationsResponse, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).get_notifications().await
}

/// PATCH /api/notifications — update global settings (appriseApiUrl, limits).
#[tauri::command]
pub async fn update_notification_settings(
    server_url: String,
    payload: serde_json::Value,
) -> Result<NotificationSettings, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).update_notification_settings(payload).await
}

/// POST /api/notifications — create a notification rule.
#[tauri::command]
pub async fn create_notification(
    server_url: String,
    payload: serde_json::Value,
) -> Result<NotificationSettings, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).create_notification(payload).await
}

/// PATCH /api/notifications/:id — update one rule.
#[tauri::command]
pub async fn update_notification(
    server_url: String,
    id: String,
    payload: serde_json::Value,
) -> Result<NotificationSettings, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).update_notification(&id, payload).await
}

/// DELETE /api/notifications/:id — delete one rule.
#[tauri::command]
pub async fn delete_notification(
    server_url: String,
    id: String,
) -> Result<NotificationSettings, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).delete_notification(&id).await
}

/// GET /api/notifications/:id/test — send a real test to one rule's URLs.
#[tauri::command]
pub async fn test_notification(server_url: String, id: String) -> Result<(), String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).test_notification(&id).await
}

/// GET /api/notifications/test — fire a synthetic onTest event end-to-end.
#[tauri::command]
pub async fn fire_test_notification_event(server_url: String) -> Result<(), String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).fire_test_event().await
}

// ── Backups (admin only) ─────────────────────────────────────────────────────
// ABS restricts these endpoints to admins (403 otherwise).

/// GET /api/backups — list backups + the backup directory location.
#[tauri::command]
pub async fn get_backups(server_url: String) -> Result<BackupsResponse, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).get_backups().await
}

/// POST /api/backups — create a backup now.
#[tauri::command]
pub async fn create_backup(server_url: String) -> Result<BackupsResponse, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).create_backup().await
}

/// DELETE /api/backups/:id — delete a backup.
#[tauri::command]
pub async fn delete_backup(server_url: String, id: String) -> Result<BackupsResponse, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).delete_backup(&id).await
}

/// GET /api/backups/:id/apply — restore from a backup (destructive; restarts ABS).
#[tauri::command]
pub async fn apply_backup(server_url: String, id: String) -> Result<(), String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).apply_backup(&id).await
}

// ── Scheduled tasks ──────────────────────────────────────────────────────────
// GET /api/tasks and POST /api/validate-cron have no server-side admin check;
// the UI gates them to admins for consistency with the other server panels.

/// GET /api/tasks — current + recently-finished background tasks.
#[tauri::command]
pub async fn get_tasks(server_url: String) -> Result<TasksResponse, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).get_tasks().await
}

/// POST /api/validate-cron — true if the cron expression is valid.
#[tauri::command]
pub async fn validate_cron(server_url: String, expression: String) -> Result<bool, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).validate_cron(&expression).await
}

// ── Server logs (admin only) ─────────────────────────────────────────────────
// get_logger_data seeds the current day's recent entries; the live tail uses the
// socket (start/stop_log_stream emit set/remove_log_listener on the live-sync
// connection). Diagnostics retained until validated, then stripped per CLAUDE.md.

/// GET /api/logger-data — the current day's recent log entries.
#[tauri::command]
pub async fn get_logger_data(server_url: String) -> Result<LoggerData, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).get_logger_data().await
}

/// Register the live-sync socket as a log listener at `level` (TRACE=0…FATAL=5).
#[tauri::command]
pub async fn start_log_stream(
    level: i32,
    socket: tauri::State<'_, socket::SocketState>,
) -> Result<(), String> {
    socket::set_log_listener(socket.inner().clone(), level).await
}

/// Stop the live log stream.
#[tauri::command]
pub async fn stop_log_stream(
    socket: tauri::State<'_, socket::SocketState>,
) -> Result<(), String> {
    socket::remove_log_listener(socket.inner().clone()).await
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
    episode_id: Option<String>,
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
        let current_time = mgr.start_session(&item_id, episode_id.as_deref(), app, start_time).await?;
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
    // Clone the player Arc out of the lock before any async work — the tokio
    // MutexGuard must not be held across .await points.
    let player_arc = Arc::clone(&state.lock().await.player);
    // Lock the inner std Mutex, call play(), then release immediately so the
    // polling loop below can re-acquire without deadlocking.
    let play_result = {
        let guard = player_arc.lock().unwrap();
        match guard.as_ref() {
            Some(p) => p.play(),
            None    => Err("No audio player initialized".to_string()),
        }
    };
    // LibVLC may need a moment to start after play() is called — the media
    // loader runs on an internal LibVLC thread. Poll up to 2 s (20 × 100 ms)
    // so the frontend's optimistic st.setPlaying(true) reflects actual state.
    if play_result.is_ok() {
        for _ in 0..20 {
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            // Each lock/check/drop is synchronous — no guard held across await.
            let is_playing = player_arc.lock().unwrap()
                .as_ref()
                .map(|p| p.is_playing())
                .unwrap_or(false);
            if is_playing { break; }
        }
    }
    play_result
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
    episode_id: Option<String>,
    current_time: f64,
    duration: f64,
    is_finished: bool,
) -> Result<(), String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .update_progress(&item_id, episode_id.as_deref(), current_time, duration, is_finished)
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

/// PATCH /api/collections/:id — update a collection (reorder books, or edit
/// name/description). `payload` is e.g. { books: [ids] } or { name, description }.
#[tauri::command]
pub async fn update_collection(
    server_url: String,
    collection_id: String,
    payload: serde_json::Value,
) -> Result<models::Collection, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url).with_token(token).update_collection(&collection_id, payload).await
}

/// DELETE /api/collections/:id/book/:bookId — remove a book from a collection.
#[tauri::command]
pub async fn remove_book_from_collection(
    server_url: String,
    collection_id: String,
    book_id: String,
) -> Result<models::Collection, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url).with_token(token).remove_book_from_collection(&collection_id, &book_id).await
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
            Err(_) => {}
        }
    }
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
/// item_id is stored in the session manager so the offline progress queue
/// and the shutdown handler can write progress entries keyed to the ABS book.
#[tauri::command]
pub async fn play_local_file(
    file_path: String,
    item_id: String,
    start_time: f64,
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    let mut mgr = state.lock().await;
    mgr.play_local(&file_path, &item_id, start_time, app).await
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

// Flush offline progress entries to the server after reconnecting.
// Uses latest-wins conflict resolution — the local recorded_at timestamp
// is not sent; we simply write what we have. If the server has newer
// progress (e.g. from another device used while offline), the server's
// value will be overwritten only if our recorded_at is more recent.
// For simplicity in v0.1.0, always write local progress on reconnect.
#[tauri::command]
pub async fn flush_offline_progress(server_url: String) -> Result<u32, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    let client = AbsClient::new(server_url).with_token(token);
    let dl_dir = downloads::downloads_dir()?;
    // Snapshot the queue before iterating so remove_progress_entry modifies the
    // file independently of our iteration — no borrow-checker conflict.
    let queue = downloads::load_progress_queue(&dl_dir);
    if queue.is_empty() { return Ok(0); }
    let mut flushed: u32 = 0;
    for entry in &queue {
        // Offline downloads are book-only (the queue carries no episode id), so
        // episode_id is None here — see OfflineProgressEntry in downloads.rs.
        match client.update_progress(&entry.item_id, None, entry.current_time, entry.duration, entry.is_finished).await {
            Ok(()) => {
                // Remove only after a confirmed server write — and only the exact
                // entry we sent (matched on recorded_at), so a newer position the
                // tick loop queued mid-flush isn't dropped.
                let _ = downloads::remove_progress_entry(&dl_dir, &entry.item_id, entry.recorded_at);
                flushed += 1;
            }
            Err(_) => {
                // Non-fatal — entry stays in the queue for the next flush.
            }
        }
    }
    Ok(flushed)
}

// Marks a downloaded book as server-deleted — the item was removed from the
// ABS server but the local audio file still exists and is playable offline.
// The badge on the book cover changes from brass ↓ to amber ! to indicate this.
// Called from the library-item-removed socket event handler in the frontend.
#[tauri::command]
pub fn mark_server_deleted(item_id: String) -> Result<(), String> {
    let dir = downloads::downloads_dir()?;
    downloads::set_server_deleted(&dir, &item_id, true)
}

// Returns the offline progress queue entry for a specific item, or None if
// no entry exists. Used by the offline playback path to restore the last
// known position when st.mediaProgress is empty (server unreachable and no
// cached server progress available).
#[tauri::command]
pub fn get_offline_progress(item_id: String) -> Result<Option<downloads::OfflineProgressEntry>, String> {
    let dl_dir = downloads::downloads_dir()?;
    let queue = downloads::load_progress_queue(&dl_dir);
    // upsert_progress_entry keeps at most one entry per item_id, so find() is sufficient.
    Ok(queue.into_iter().find(|e| e.item_id == item_id))
}

// Saves chapter data for a specific item to a per-item JSON cache file.
// Called after every successful fetchItem so offline playback has chapters.
// Stored separately from the library cache because the bulk library endpoint
// returns chapters: [] — only the single-item fetchItem response has real data.
#[tauri::command]
pub async fn save_chapter_cache(
    item_id: String,
    chapters: serde_json::Value,
) -> Result<(), String> {
    let cache_path = std::path::PathBuf::from(get_cache_dir()?)
        .join(format!("chapters_{}.json", item_id));
    // Ensure the cache directory exists before writing — get_cache_dir() resolves
    // the path but does not create it.
    std::fs::create_dir_all(cache_path.parent().unwrap_or(&cache_path))
        .map_err(|e| format!("Create dir failed: {e}"))?;
    let json = serde_json::to_string(&chapters)
        .map_err(|e| format!("Serialize failed: {e}"))?;
    std::fs::write(&cache_path, json)
        .map_err(|e| format!("Write failed: {e}"))?;
    Ok(())
}

// Loads chapter data for a specific item from the per-item cache file.
// Returns None if no cache exists yet (e.g. the book was never opened online).
#[tauri::command]
pub async fn load_chapter_cache(
    item_id: String,
) -> Result<Option<serde_json::Value>, String> {
    let cache_path = std::path::PathBuf::from(get_cache_dir()?)
        .join(format!("chapters_{}.json", item_id));
    // Missing file is normal on first offline launch — not an error.
    if !cache_path.exists() { return Ok(None); }
    let json = std::fs::read_to_string(&cache_path)
        .map_err(|e| format!("Read failed: {e}"))?;
    let val = serde_json::from_str(&json)
        .map_err(|e| format!("Parse failed: {e}"))?;
    Ok(Some(val))
}

// Saves the library to a local JSON cache file so it can be loaded
// when the server is unreachable on next launch.
#[tauri::command]
pub async fn save_library_cache(items: Vec<serde_json::Value>) -> Result<(), String> {
    let cache_path = std::path::PathBuf::from(get_cache_dir()?).join("library_cache.json");
    // get_cache_dir() resolves the path but does not create the directory.
    std::fs::create_dir_all(cache_path.parent().unwrap_or(&cache_path))
        .map_err(|e| format!("Create dir failed: {e}"))?;
    let json = serde_json::to_string(&items)
        .map_err(|e| format!("Serialize failed: {e}"))?;
    std::fs::write(&cache_path, json)
        .map_err(|e| format!("Write failed: {e}"))?;
    Ok(())
}

// Loads the library from the local cache file.
// Returns an empty array if no cache exists yet.
#[tauri::command]
pub async fn load_library_cache() -> Result<Vec<serde_json::Value>, String> {
    let cache_path = std::path::PathBuf::from(get_cache_dir()?).join("library_cache.json");
    // No cache on first launch — return an empty list so callers can distinguish
    // "no cache" from "cache exists but is empty".
    if !cache_path.exists() { return Ok(vec![]); }
    let json = std::fs::read_to_string(&cache_path)
        .map_err(|e| format!("Read failed: {e}"))?;
    serde_json::from_str(&json)
        .map_err(|e| format!("Parse failed: {e}"))
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
    pub user: models::User,
    pub token: String,
    pub server_settings: Option<ServerSettings>,
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

    // /api/me does not include serverSettings. Call POST /api/authorize with the
    // resolved token to retrieve them (same endpoint used by the password login path).
    let server_settings: Option<ServerSettings> = {
        let auth_resp = reqwest::Client::new()
            .post(format!("{}/api/authorize", server_url.trim_end_matches('/')))
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .await;
        match auth_resp {
            Ok(r) if r.status().is_success() => {
                let auth_json: serde_json::Value = r.json().await.unwrap_or(serde_json::Value::Null);
                auth_json.get("serverSettings")
                    .and_then(|ss| serde_json::from_value::<ServerSettings>(ss.clone()).ok())
            }
            _ => None,
        }
    };

    Ok(ApiKeyLoginResult { user, token, server_settings })
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
    // cluster H: optional permissions blob (carries librariesAccessible /
    // itemTagsSelected nested); None leaves access control untouched.
    permissions: Option<serde_json::Value>,
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
            permissions,
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

// ── Auth & user access (cluster H) ───────────────────────────────────────────

/// GET /api/users/:id — fetch one user with the full permissions object.
#[tauri::command]
pub async fn get_user(server_url: String, user_id: String) -> Result<models::AdminUser, String> {
    let token = auth::load_token()?.ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).get_user(&user_id).await
}

/// PATCH /api/me/password — self-service password change ({ password, newPassword }).
#[tauri::command]
pub async fn change_password(server_url: String, current: String, new_password: String) -> Result<(), String> {
    let token = auth::load_token()?.ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).change_password(&current, &new_password).await
}

/// GET /api/auth-settings — admin-only; read-only check of whether OIDC is enabled.
#[tauri::command]
pub async fn get_auth_settings(server_url: String) -> Result<models::AuthSettings, String> {
    let token = auth::load_token()?.ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).get_auth_settings().await
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

/// Read the current Skald log file (skald.log under app_log_dir, where
/// tauri-plugin-log writes) for the Logs → Skald subtab's "load full file" and
/// the About diagnostic report. Returns "" if the file does not exist yet.
#[tauri::command]
pub fn read_skald_log(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    let path = dir.join("skald.log");
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("read log failed: {e}")),
    }
}

/// Write text to a path chosen via the save dialog — used by the About tab to
/// save the diagnostic report bundle.
#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("write failed: {e}"))
}

/// Reveal the Skald log folder (app_log_dir) in the OS file explorer.
#[tauri::command]
pub fn open_log_dir(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::process::Command::new("explorer")
        .arg(&dir)
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
    let dl_dir = downloads::downloads_dir()?;
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
            // Detect disk-full before falling through to the generic write error.
            // OS error 112 is ERROR_DISK_FULL on Windows; 28 is ENOSPC on Linux/macOS.
            let msg = if let Some(os_err) = e.raw_os_error() {
                if os_err == 112 || os_err == 28 {
                    "Not enough disk space to complete the download.".to_string()
                } else {
                    format!("Write error: {e}")
                }
            } else {
                format!("Write error: {e}")
            };
            break LoopExit::WriteError(msg);
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
    let _ = std::fs::remove_file(&file_path);

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
        // Newly downloaded books are always present on the server.
        server_deleted: false,
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
    let dir = downloads::downloads_dir()?;
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
    let dir = downloads::downloads_dir()?;
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

// record_stop_point — writes a local position snapshot for the given book.
// Called from the frontend at pause, book-switch, and app-close.
// Reuses the downloads directory so no additional path resolution is needed.
#[tauri::command]
pub fn record_stop_point(item_id: String, position: f64) -> Result<(), String> {
    let data_dir = downloads::downloads_dir()?;
    // Ensure the directory exists — it may not exist if the user has never downloaded anything.
    std::fs::create_dir_all(&data_dir).map_err(|e| format!("Create dir: {e}"))?;
    downloads::record_stop_point(&data_dir, &item_id, position)
}

// get_stop_points — returns the stop-point log for a book, most recent first.
// Returns an empty vec when no history exists; never errors on a missing file.
#[tauri::command]
pub fn get_stop_points(item_id: String) -> Result<Vec<downloads::LocalStopPoint>, String> {
    let data_dir = downloads::downloads_dir()?;
    Ok(downloads::load_stop_points(&data_dir, &item_id))
}

// ── Playlist commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_playlists(
    server_url: String,
    library_id: String,
) -> Result<Vec<models::Playlist>, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .get_playlists(&library_id)
        .await
}

#[tauri::command]
pub async fn get_playlist(
    server_url: String,
    playlist_id: String,
) -> Result<models::Playlist, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
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
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
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
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .update_playlist(&playlist_id, name.as_deref(), description.as_deref(), items)
        .await
}

#[tauri::command]
pub async fn delete_playlist(
    server_url: String,
    playlist_id: String,
) -> Result<(), String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .delete_playlist(&playlist_id)
        .await
}

#[tauri::command]
pub async fn batch_add_to_playlist(
    server_url: String,
    playlist_id: String,
    items: Vec<models::PlaylistItemInput>,
) -> Result<models::Playlist, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .batch_add_to_playlist(&playlist_id, items)
        .await
}

#[tauri::command]
pub async fn batch_remove_from_playlist(
    server_url: String,
    playlist_id: String,
    items: Vec<models::PlaylistItemInput>,
) -> Result<models::Playlist, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .batch_remove_from_playlist(&playlist_id, items)
        .await
}

#[tauri::command]
pub async fn create_playlist_from_collection(
    server_url: String,
    collection_id: String,
) -> Result<models::Playlist, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .create_playlist_from_collection(&collection_id)
        .await
}

// ── Equalizer commands ────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_eq_presets() -> Result<Vec<models::EqPreset>, String> {
    Ok(crate::eq::PRESETS
        .iter()
        .enumerate()
        .map(|(i, p)| models::EqPreset { index: i as u32, name: p.name.to_string() })
        .collect())
}

#[tauri::command]
pub fn get_eq_band_frequencies() -> Result<Vec<f32>, String> {
    Ok(audio::eq_band_frequencies())
}

#[tauri::command]
pub fn get_eq_settings() -> Result<EqSettings, String> {
    Ok(EqSettings::load())
}

#[tauri::command]
pub async fn set_eq_enabled(
    enabled: bool,
    state: tauri::State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    let player_arc = Arc::clone(&state.lock().await.player);
    let guard = player_arc.lock().unwrap();
    let mut settings = EqSettings::load();
    settings.enabled = enabled;
    if let Some(p) = guard.as_ref() {
        p.apply_eq_settings(&settings);
    }
    settings.save();
    Ok(())
}

#[tauri::command]
pub async fn set_eq_band(
    band: u32,
    gain: f32,
    state: tauri::State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    let player_arc = Arc::clone(&state.lock().await.player);
    let guard = player_arc.lock().unwrap();
    let mut settings = EqSettings::load();
    if (band as usize) < settings.bands.len() {
        settings.bands[band as usize] = gain;
        settings.preset_name = None; // manual band adjust → clear preset label
    }
    if let Some(p) = guard.as_ref() {
        p.set_eq_band(band, gain);
    }
    settings.save();
    Ok(())
}

#[tauri::command]
pub async fn set_eq_preamp(
    gain: f32,
    state: tauri::State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    let player_arc = Arc::clone(&state.lock().await.player);
    let guard = player_arc.lock().unwrap();
    let mut settings = EqSettings::load();
    settings.preamp = gain;
    if let Some(p) = guard.as_ref() {
        p.set_eq_preamp(gain);
    }
    settings.save();
    Ok(())
}

#[tauri::command]
pub async fn apply_eq_preset(
    index: u32,
    state: tauri::State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    let player_arc = Arc::clone(&state.lock().await.player);
    let guard = player_arc.lock().unwrap();
    let settings = EqSettings::from_custom_preset(index)
        .unwrap_or_default();
    if let Some(p) = guard.as_ref() {
        p.apply_eq_settings(&settings);
    }
    settings.save();
    Ok(())
}

#[tauri::command]
pub async fn reset_eq(
    state: tauri::State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    let player_arc = Arc::clone(&state.lock().await.player);
    let guard = player_arc.lock().unwrap();
    let settings = EqSettings::default();
    if let Some(p) = guard.as_ref() {
        p.apply_eq_settings(&settings); // applies zeros + disables (enabled: false)
    }
    settings.save();
    Ok(())
}

// ── Library management commands (admin only) ─────────────────────────────────
// All five commands require an admin or root token. ABS enforces this server-side
// and returns HTTP 403 for unauthorized callers.

/// Lists subdirectories on the ABS server at `path` (admin only).
/// Returns the directory listing so the frontend can build a server-side folder picker.
#[tauri::command]
pub async fn browse_server_filesystem(
    server_url: String,
    path: String,
) -> Result<models::FsDirectory, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url).with_token(token).get_filesystem(&path).await
}

/// Returns all libraries with the full expanded shape (folders, settings, timestamps).
/// Functionally identical to fetch_libraries now that Library carries all fields,
/// but exposed under a distinct command name so the LibrariesSection can call it
/// without aliasing concerns in the frontend.
#[tauri::command]
pub async fn get_libraries_full(server_url: String) -> Result<Vec<models::Library>, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url).with_token(token).get_libraries().await
}

/// Creates a new library on the server and returns the created Library.
#[tauri::command]
pub async fn create_library(
    server_url: String,
    name: String,
    media_type: String,
    folders: Vec<models::FolderInput>,
    icon: Option<String>,
    provider: Option<String>,
    settings: Option<models::LibrarySettings>,
) -> Result<models::Library, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    let payload = models::CreateLibraryPayload { name, media_type, folders, icon, provider, settings };
    AbsClient::new(server_url).with_token(token).create_library(&payload).await
}

/// Partially updates a library. Only fields set in the payload are sent to the server.
#[tauri::command]
pub async fn update_library(
    server_url: String,
    library_id: String,
    payload: models::UpdateLibraryPayload,
) -> Result<models::Library, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url).with_token(token).update_library(&library_id, &payload).await
}

/// Permanently deletes a library and all its items.
#[tauri::command]
pub async fn delete_library(
    server_url: String,
    library_id: String,
) -> Result<(), String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url).with_token(token).delete_library(&library_id).await
}

/// Triggers a server-side library scan. `force=true` requests a full rescan;
/// `force=false` runs an incremental scan. The server runs asynchronously.
#[tauri::command]
pub async fn scan_library(
    server_url: String,
    library_id: String,
    force: bool,
) -> Result<(), String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url).with_token(token).scan_library(&library_id, force).await
}

// ── Custom metadata providers (admin) ────────────────────────────────────────

/// GET /api/custom-metadata-providers — list custom providers.
#[tauri::command]
pub async fn get_custom_metadata_providers(server_url: String) -> Result<Vec<CustomMetadataProvider>, String> {
    let token = auth::load_token()?.ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).get_custom_metadata_providers().await
}

/// POST /api/custom-metadata-providers — register a custom provider.
#[tauri::command]
pub async fn create_custom_metadata_provider(
    server_url: String,
    payload: serde_json::Value,
) -> Result<CustomMetadataProvider, String> {
    let token = auth::load_token()?.ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).create_custom_metadata_provider(payload).await
}

/// DELETE /api/custom-metadata-providers/:id — remove a custom provider.
#[tauri::command]
pub async fn delete_custom_metadata_provider(server_url: String, id: String) -> Result<(), String> {
    let token = auth::load_token()?.ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).delete_custom_metadata_provider(&id).await
}

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

