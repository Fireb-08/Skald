// Split from the original single-file commands.rs (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. Shared imports and state types
// come from the parent module (mod.rs) via the glob below.
use super::*;

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
            let (is_playing, failed) = player_arc
                .lock()
                .unwrap()
                .as_ref()
                .map(|p| (p.is_playing(), p.playback_error()))
                .unwrap_or((false, false));
            if is_playing {
                return Ok(());
            }
            if failed {
                log::error!(target: "skald::playback", "LibVLC entered the error state while opening media");
                return Err("LibVLC could not open or decode the selected audio".to_string());
            }
        }
        let state_name = player_arc
            .lock()
            .unwrap()
            .as_ref()
            .map(|p| p.playback_state_name())
            .unwrap_or("missing-player");
        log::warn!(target: "skald::playback", "playback did not reach Playing during startup check; state={state_name}");
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
        if client.close_session_by_id(id).await.is_ok() {
            closed += 1;
        }
    }
    Ok(closed)
}

#[tauri::command]
pub async fn close_active_session(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    let mut mgr = state.lock().await;
    if mgr.session_id.is_none() {
        return Ok(()); // no session open, nothing to do
    }
    let result = mgr.close().await;
    let current_time = *mgr.current_time.lock().unwrap_or_else(|e| e.into_inner());
    match &result {
        Ok(()) => {
            if mgr.mark_sync_restored() {
                log::info!(target: "skald::sync", "server session close restored progress sync");
                let _ = app.emit(
                    "session-sync-restored",
                    serde_json::json!({ "currentTime": current_time }),
                );
            }
        }
        Err(error) => {
            let queued = match mgr.queue_current_server_progress() {
                Ok(()) => true,
                Err(queue_error) => {
                    log::error!(target: "skald::sync", "failed session close fallback persist failed: {queue_error}");
                    false
                }
            };
            mgr.mark_sync_degraded();
            log::warn!(target: "skald::sync", "server session close failed queued_locally={queued}: {error}");
            let _ = app.emit(
                "session-sync-warning",
                serde_json::json!({ "currentTime": current_time, "queued": queued }),
            );
        }
    }
    // Prevent the old session id and fallback identity from leaking into the
    // next book after the close attempt has been handled locally.
    mgr.clear_server_identity();
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
    // True for local-library items (progress → catalog); false/absent for
    // downloaded ABS books (progress → offline queue → server flush).
    local_library: Option<bool>,
    // For a local podcast episode, its id so progress is written per (item, episode).
    episode_id: Option<String>,
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    let mut mgr = state.lock().await;
    mgr.play_local(&file_path, &item_id, start_time, local_library.unwrap_or(false), episode_id.as_deref(), app).await
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
