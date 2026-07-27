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

fn spawn_session_sync(
    app: tauri::AppHandle,
    manager: Arc<Mutex<SessionManager>>,
    reason: &'static str,
) {
    tauri::async_runtime::spawn(async move {
        let manager = manager.lock().await;
        if let Err(error) = manager.sync_now(&app, reason).await {
            log::warn!(target: "skald::sync", "immediate session sync failed reason={reason}: {error}");
        }
    });
}

#[tauri::command]
pub async fn open_playback_session(
    server_url: String,
    item_id: String,
    episode_id: Option<String>,
    start_time: Option<f64>,
    user_id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<OpenSessionResult, String> {
    let client = AbsClient::authenticated(server_url).await?;
    let resolved_user_id = if user_id.trim().is_empty() {
        client.get_me().await?.id
    } else {
        user_id
    };
    // Scope the SessionManager lock so it is released before this command
    // returns — play_audio acquires the same lock and must not see it held.
    let result = {
        let mut mgr = state.lock().await;
        mgr.client = client;
        let current_time = mgr.start_session(
            &item_id,
            episode_id.as_deref(),
            app.clone(),
            start_time,
            &resolved_user_id,
        ).await?;
        let session_id = mgr.session_id.clone()
            .ok_or_else(|| "Session ID not set after start".to_string())?;
        OpenSessionResult { session_id, current_time }
    };
    let _ = app.emit("session-sync-success", serde_json::json!({
        "currentTime": result.current_time,
        "reason": "session-open",
        "at": chrono::Utc::now().timestamp_millis(),
    }));
    Ok(result)
}

/// Retry only session IDs durably recorded by this Skald installation for the
/// authenticated ABS user. The active session is excluded defensively.
#[tauri::command]
pub async fn cleanup_owned_playback_sessions(
    server_url: String,
    user_id: String,
    state: tauri::State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<u32, String> {
    let client = AbsClient::authenticated(server_url).await?;
    let resolved_user_id = if user_id.trim().is_empty() {
        client.get_me().await?.id
    } else {
        user_id
    };
    let active_session_id = state.lock().await.session_id.clone();
    crate::session_ownership::retry_owned(&client, &resolved_user_id, active_session_id.as_deref()).await
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
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    let player_arc = Arc::clone(&state.lock().await.player);
    let pause_result = match player_arc.lock().unwrap().as_ref() {
        Some(p) => { p.pause(); Ok(()) }
        None => Err("No audio player initialized".to_string()),
    };
    if pause_result.is_ok() {
        // Start the clock the adaptive rewind curve reads on resume.
        state.lock().await.paused_at = Some(std::time::Instant::now());
        spawn_session_sync(app, Arc::clone(state.inner()), "pause");
    }
    pause_result
}

/// What `resume_audio` did, so the caller can bring the UI into line without a
/// second round-trip.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeOutcome {
    /// Where playback actually resumed from.
    pub position: f64,
    /// Seconds stepped back. Zero when adaptive rewind is off or did not apply.
    pub rewound: f64,
}

/// Resume the current book, applying the adaptive rewind curve first.
///
/// This is the *single* place a paused→playing transition is decided, so the
/// transport buttons and the Space key cannot drift apart — the previous design
/// had the rewind computed independently in two frontend call sites.
///
/// `chapter_start` is the beginning of the chapter the listener is in, or `None`
/// when the chapter barrier is off or the book has no chapters. Skald's chapter
/// list lives on the frontend, so the caller supplies it rather than the backend
/// looking it up.
#[tauri::command]
pub async fn resume_audio(
    chapter_start: Option<f64>,
    state: tauri::State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<ResumeOutcome, String> {
    use crate::auto_rewind::{rewind_amount, rewind_target};

    // Take the pause timestamp: resuming consumes it, so a second resume with no
    // pause in between rewinds nothing.
    let (cfg, paused_for, player_arc) = {
        let mut manager = state.lock().await;
        let paused_for = manager.paused_at.take().map(|at| at.elapsed().as_secs_f64());
        (manager.auto_rewind, paused_for, Arc::clone(&manager.player))
    };

    let position = player_arc
        .lock()
        .unwrap()
        .as_ref()
        .map(|p| p.position())
        .unwrap_or(0.0);

    let amount = rewind_amount(paused_for, &cfg);
    let barrier = if cfg.chapter_barrier { chapter_start } else { None };
    let target = rewind_target(position, amount, barrier);
    let rewound = (position - target).max(0.0);

    if rewound > 0.0 {
        // Seek before starting playback, not after — a seek landing on top of a
        // running tick is what makes the playhead visibly jump. This is also
        // local intent and must win over any in-flight background sync position.
        let seek_result = match player_arc.lock().unwrap().as_ref() {
            Some(p) => p.seek(target),
            None => Err("No audio player initialized".to_string()),
        };
        if let Err(e) = seek_result {
            // A failed rewind is not a reason to refuse to resume playback.
            log::warn!(target: "skald::playback", "auto-rewind seek failed, resuming in place: {e}");
            return resume_after_rewind(state, position, 0.0).await;
        }
        log::debug!(
            target: "skald::playback",
            "auto-rewind applied: pausedFor={:.1}s amount={:.1}s barrierClamped={}",
            paused_for.unwrap_or(0.0),
            rewound,
            barrier.is_some_and(|b| (target - b).abs() < f64::EPSILON)
        );
    }

    resume_after_rewind(state, target, rewound).await
}

/// Shared tail of `resume_audio`: start playback and report where we landed.
async fn resume_after_rewind(
    state: tauri::State<'_, Arc<Mutex<SessionManager>>>,
    position: f64,
    rewound: f64,
) -> Result<ResumeOutcome, String> {
    play_audio(state).await?;
    Ok(ResumeOutcome { position, rewound })
}

/// Push the adaptive-rewind settings down from Settings → Playback.
#[tauri::command]
pub async fn set_auto_rewind_cfg(
    cfg: crate::auto_rewind::AutoRewindCfg,
    state: tauri::State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    log::info!(
        target: "skald::playback",
        "auto-rewind config: adaptive={} fixed={:.0}s min={:.0}s max={:.0}s delay={:.0}s barrier={}",
        cfg.adaptive, cfg.fixed_secs, cfg.min_secs, cfg.max_secs,
        cfg.activation_delay_secs, cfg.chapter_barrier
    );
    state.lock().await.auto_rewind = cfg;
    Ok(())
}

#[tauri::command]
pub async fn seek_audio(
    secs: f64,
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    let player_arc = Arc::clone(&state.lock().await.player);
    let seek_result = match player_arc.lock().unwrap().as_ref() {
        Some(p) => p.seek(secs),
        None => Err("No audio player initialized".to_string()),
    };
    if seek_result.is_ok() {
        let manager = Arc::clone(state.inner());
        let generation = manager.lock().await.next_seek_sync_generation();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(
                crate::sync_config::playback_sync_cadence().seek_debounce_milliseconds,
            )).await;
            let manager = manager.lock().await;
            if manager.seek_sync_is_current(generation) {
                if let Err(error) = manager.sync_now(&app, "settled-seek").await {
                    log::warn!(target: "skald::sync", "settled seek sync failed: {error}");
                }
            }
        });
    }
    seek_result
}

#[tauri::command]
pub async fn sync_active_session(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    state.lock().await.sync_now(&app, "lifecycle").await
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
    AbsClient::authenticated(server_url)
        .await?
        .create_bookmark(&item_id, time, &title)
        .await
}

#[tauri::command]
pub async fn delete_progress(
    server_url: String,
    item_id: String,
) -> Result<(), String> {
    AbsClient::authenticated(server_url)
        .await?
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
    AbsClient::authenticated(server_url)
        .await?
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
    AbsClient::authenticated(server_url)
        .await?
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

/// Close a loaded session without sending its position. The frontend uses this
/// only when a pre-close `/api/me` snapshot proves another device is ahead.
#[tauri::command]
pub async fn close_active_session_without_sync(
    state: tauri::State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    let mut mgr = state.lock().await;
    if mgr.session_id.is_none() {
        return Ok(());
    }
    let result = mgr.close_without_sync().await;
    if let Err(error) = &result {
        log::warn!(target: "skald::sync", "conflict-safe session close failed: {error}");
    } else {
        log::info!(target: "skald::sync", "closed stale playback session without replacing newer ABS progress");
    }
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
// Tauri maps these named fields directly from the frontend payload. Keeping
// them explicit preserves command-surface verification and optional defaults.
#[allow(clippy::too_many_arguments)]
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
    // Downloaded ABS playback carries the exact server revision it branched
    // from. Local-library playback ignores both values.
    baseline_captured: Option<bool>,
    server_last_update: Option<i64>,
    // The item's resolved playback rate (per-book memory or the global default).
    // Local playback starts inside this command, so the rate has to travel with
    // it — a separate set_speed call would only take effect after the first
    // moment of audio had already played at the previous item's rate.
    speed: Option<f32>,
    // Whose listening this is. Offline sessions are flushed long after the fact,
    // and ABS credits the user authenticated at flush time — so the account is
    // captured here, while it is still known, and travels with the session.
    server_url: Option<String>,
    user_id: Option<String>,
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<(), String> {
    let mut mgr = state.lock().await;
    mgr.play_local(
        &file_path,
        &item_id,
        start_time,
        local_library.unwrap_or(false),
        episode_id.as_deref(),
        baseline_captured.unwrap_or(false),
        server_last_update,
        speed,
        server_url.as_deref().unwrap_or_default(),
        user_id.as_deref().unwrap_or_default(),
        app,
    ).await
}

#[tauri::command]
pub async fn close_session(
    server_url: String,
    session_id: String,
    current_time: f64,
    time_listened: f64,
) -> Result<(), String> {
    let result = AbsClient::authenticated(server_url)
        .await?
        .close_session(&session_id, current_time, time_listened)
        .await;
    if result.is_ok() {
        if let Err(error) = crate::session_ownership::remove_owned(&session_id) {
            log::warn!(target: "skald::sync", "session closed but journal removal deferred session_id={session_id}: {error}");
        }
    }
    result
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
