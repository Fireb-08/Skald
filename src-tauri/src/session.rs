use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Duration;

use tauri::Emitter;

use crate::{api::AbsClient, audio::AudioPlayer};

pub struct SessionManager {
    pub client: AbsClient,
    pub session_id: Option<String>,
    pub current_time: Arc<Mutex<f64>>,
    pub time_listened: Arc<Mutex<f64>>,
    // None until start_session is first called — avoids loading libvlc.dll at
    // app startup before the user has a chance to see the window.
    pub player: Arc<Mutex<Option<AudioPlayer>>>,
    active: Arc<AtomicBool>,
    // True while playing from a local file (no server session).
    // Set by play_local(); cleared by start_session() when returning to online playback.
    // The sync task is never spawned during local playback, so this flag is
    // primarily an observability marker for the shutdown handler and future phases.
    pub is_local: bool,
    // ABS library item ID of the locally-playing book. Set by play_local() and
    // used by the shutdown handler to write a final offline progress entry on exit.
    pub local_item_id: Option<String>,
}

impl SessionManager {
    pub fn new(client: AbsClient) -> Self {
        Self {
            client,
            session_id: None,
            current_time: Arc::new(Mutex::new(0.0)),
            time_listened: Arc::new(Mutex::new(0.0)),
            player: Arc::new(Mutex::new(None)),
            active: Arc::new(AtomicBool::new(false)),
            is_local: false,
            local_item_id: None,
        }
    }

    /// Open a playback session for `item_id`, spawn the 1-second tick loop
    /// (position updates + `playback-tick` events) and the 10-second sync loop.
    /// Returns the server's `currentTime` so the caller can seek after play starts.
    pub async fn start_session<R: tauri::Runtime>(
        &mut self,
        item_id: &str,
        app: tauri::AppHandle<R>,
        start_time: Option<f64>,
    ) -> Result<f64, String> {
        // Stop any tasks from a previous session (online or local).
        self.active.store(false, Ordering::Relaxed);
        // Clear the local flag — this is an online session, sync is required.
        self.is_local = false;
        // Clear the local item ID — no longer tracking offline progress.
        self.local_item_id = None;

        // Initialize the audio player on first call (deferred to avoid
        // requiring libvlc.dll on PATH at startup).
        {
            let mut p = self.player.lock().unwrap();
            if p.is_none() {
                *p = Some(AudioPlayer::new()?);
            }
        }

        let session = self.client.open_session(item_id, start_time).await?;
        self.session_id = Some(session.id.clone());
        // Prefer the caller-supplied start_time so LibVLC loads at the exact
        // chapter position even if the server's currentTime differs slightly.
        let load_time = start_time.unwrap_or(session.current_time);
        *self.current_time.lock().unwrap() = load_time;
        *self.time_listened.lock().unwrap() = 0.0;

        // Load first audio track into the player.
        // Token-in-URL pattern (CLAUDE.md critical lesson 2): LibVLC HTTP headers
        // are unreliable on Windows — never use Authorization headers for media URLs.
        if let Some(track) = session.audio_tracks.first() {
            let token = self.client.token.as_deref().unwrap_or("");
            let url = format!(
                "{}{}?token={}",
                self.client.base_url.trim_end_matches('/'),
                track.content_url,
                token,
            );
            let player_guard = self.player.lock().unwrap();
            if let Some(p) = player_guard.as_ref() {
                p.load(&url, load_time)?;
            }
        }

        let active = Arc::new(AtomicBool::new(true));
        self.active = Arc::clone(&active);

        // ── Tick task: every 1 second ────────────────────────────────────────
        let ct_tick = Arc::clone(&self.current_time);
        let tl_tick = Arc::clone(&self.time_listened);
        let player_tick = Arc::clone(&self.player);
        let active_tick = Arc::clone(&active);
        let app_tick = app.clone();

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(1));
            loop {
                interval.tick().await;
                if !active_tick.load(Ordering::Relaxed) {
                    break;
                }
                let (pos, dur, playing) = {
                    let guard = player_tick.lock().unwrap();
                    match guard.as_ref() {
                        Some(p) => (p.position(), p.duration(), p.is_playing()),
                        None => (0.0, 0.0, false),
                    }
                };
                *ct_tick.lock().unwrap() = pos;
                if playing {
                    *tl_tick.lock().unwrap() += 1.0;
                }
                let _ = app_tick.emit(
                    "playback-tick",
                    serde_json::json!({
                        "currentTime": pos,
                        "duration":    dur,
                        "isPlaying":   playing,
                    }),
                );
            }
        });

        // ── Sync task: every 10 seconds (CLAUDE.md critical lesson 3) ─────────
        let ct_sync = Arc::clone(&self.current_time);
        let tl_sync = Arc::clone(&self.time_listened);
        let client_sync = self.client.clone();
        let session_id_sync = session.id.clone();
        let active_sync = Arc::clone(&active);

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(10));
            interval.tick().await; // skip the immediate first tick
            loop {
                interval.tick().await;
                if !active_sync.load(Ordering::Relaxed) {
                    break;
                }
                let ct = *ct_sync.lock().unwrap();
                let tl = *tl_sync.lock().unwrap();
                let _ = client_sync.sync_session(&session_id_sync, ct, tl).await;
            }
        });

        Ok(session.current_time)
    }

    /// Load a local audio file into LibVLC and start playback without opening a
    /// server session. Used by the offline playback path introduced in Phase D.
    ///
    /// Behaviour differences from start_session:
    /// - No server call is made; session_id stays None.
    /// - Only the 1-second tick task is spawned (no 10-second sync task).
    /// - is_local is set to true so the shutdown handler skips the HTTP close.
    /// - item_id is stored so the tick task can queue progress entries to disk
    ///   and the shutdown handler can write a final entry on app close.
    pub async fn play_local<R: tauri::Runtime>(
        &mut self,
        file_path: &str,
        item_id: &str,
        start_time: f64,
        app: tauri::AppHandle<R>,
    ) -> Result<(), String> {
        // Kill any background tasks from a previous online or local session so
        // stale sync or tick loops do not race with the new local playback.
        self.active.store(false, Ordering::Relaxed);

        // No server session — clear the ID so the shutdown handler and
        // close_active_session both exit early without an HTTP call.
        self.session_id = None;

        // Mark as local so any code that inspects this flag knows we are offline.
        self.is_local = true;
        // Store the ABS item ID so the tick task and shutdown handler can key
        // offline progress queue entries to the correct library item.
        self.local_item_id = Some(item_id.to_string());

        // Initialize the audio player on first call (deferred init matches start_session).
        {
            let mut p = self.player.lock().unwrap();
            if p.is_none() {
                *p = Some(AudioPlayer::new()?);
            }
        }

        // Build a file:/// URI for LibVLC from the registry path.
        // If the path is a directory (multi-file book), scan for audio files sorted
        // by name — alphabetical order matches ABS export chapter order — and use
        // the first file. Single-file books are loaded directly.
        let audio_ext = ["m4b", "mp3", "aac", "ogg", "flac", "opus", "m4a"];
        let uri = if std::path::Path::new(file_path).is_dir() {
            let mut files: Vec<_> = std::fs::read_dir(file_path)
                .map_err(|e| format!("Failed to read download directory: {e}"))?
                .filter_map(|e| e.ok())
                .filter(|e| {
                    e.path()
                        .extension()
                        .and_then(|x| x.to_str())
                        .map(|x| audio_ext.contains(&x.to_lowercase().as_str()))
                        .unwrap_or(false)
                })
                .collect();
            // Sort by file name so multi-file books play in chapter order.
            files.sort_by_key(|e| e.file_name());
            if files.is_empty() {
                return Err("No audio files found in download directory".to_string());
            }
            // LibVLC expects forward slashes even on Windows.
            format!(
                "file:///{}",
                files[0].path().to_string_lossy().replace('\\', "/")
            )
        } else {
            // Single audio file — convert the Windows path to a file:/// URI.
            format!("file:///{}", file_path.replace('\\', "/"))
        };

        // Load the URI into LibVLC. AudioPlayer::load() applies the :start-time
        // media option when start_time > 0, so no explicit seek is needed after play().
        {
            let guard = self.player.lock().unwrap();
            if let Some(p) = guard.as_ref() {
                p.load(&uri, start_time)?;
            }
        }

        // Create a fresh active flag for the new tick task. The old flag was set to
        // false above, so any previous tick task exits on its next iteration.
        let active = Arc::new(AtomicBool::new(true));
        self.active = Arc::clone(&active);

        // Reset progress counters for the new local playback session.
        *self.current_time.lock().unwrap() = start_time;
        *self.time_listened.lock().unwrap() = 0.0;

        // ── Tick task: every 1 second ────────────────────────────────────────
        // Identical to start_session's tick task — emits playback-tick events so
        // the waveform, chapter indicator, and transport controls all stay live.
        // No sync task is spawned because there is no server session to sync to.
        // After each tick, progress is also queued to disk so no position is lost
        // if the app closes before the device comes back online.
        let ct_tick         = Arc::clone(&self.current_time);
        let tl_tick         = Arc::clone(&self.time_listened);
        let player_tick     = Arc::clone(&self.player);
        let active_tick     = Arc::clone(&active);
        let app_tick        = app;
        // Clone the item_id string into the task — it outlives this method call.
        let item_id_tick    = item_id.to_string();
        // Resolve the downloads dir once before spawning; propagate None if it
        // fails (unlikely) so the tick loop still runs without queue writes.
        let dl_dir_tick     = crate::downloads::downloads_dir().ok();

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(1));
            loop {
                interval.tick().await;
                if !active_tick.load(Ordering::Relaxed) {
                    break;
                }
                let (pos, dur, playing) = {
                    let guard = player_tick.lock().unwrap();
                    match guard.as_ref() {
                        Some(p) => (p.position(), p.duration(), p.is_playing()),
                        None    => (0.0, 0.0, false),
                    }
                };
                *ct_tick.lock().unwrap() = pos;
                if playing {
                    *tl_tick.lock().unwrap() += 1.0;
                }
                let _ = app_tick.emit(
                    "playback-tick",
                    serde_json::json!({
                        "currentTime": pos,
                        "duration":    dur,
                        "isPlaying":   playing,
                    }),
                );
                // Queue progress locally on every tick during offline/local playback.
                // This ensures no progress is lost even if the app closes mid-session.
                // The queue is flushed to the server when connectivity is restored.
                if let Some(ref dl_dir) = dl_dir_tick {
                    let entry = crate::downloads::OfflineProgressEntry {
                        item_id: item_id_tick.clone(),
                        current_time: pos,
                        duration: dur,
                        progress: if dur > 0.0 { pos / dur } else { 0.0 },
                        is_finished: false,
                        // Stable timestamp without pulling in chrono — same
                        // precision as chrono::Utc::now().timestamp_millis().
                        recorded_at: std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as i64,
                    };
                    let _ = crate::downloads::upsert_progress_entry(dl_dir, entry);
                }
            }
        });

        // Start playback after the tick task is spawned so the first tick fires
        // while audio is already playing (avoids a spurious isPlaying=false tick).
        {
            let guard = self.player.lock().unwrap();
            if let Some(p) = guard.as_ref() {
                p.play()?;
            }
        }

        Ok(())
    }

    /// Sync the current position to the server.
    pub async fn sync(&self) -> Result<(), String> {
        let sid = self
            .session_id
            .as_deref()
            .ok_or_else(|| "No active session".to_string())?;
        let ct = *self.current_time.lock().unwrap();
        let tl = *self.time_listened.lock().unwrap();
        self.client.sync_session(sid, ct, tl).await
    }

    /// Signal the tick and sync background tasks to stop on their next iteration.
    /// Called from the ExitRequested shutdown handler before the final close call
    /// so no further sync fires between the lock release and the HTTP request.
    pub fn cancel_tasks(&self) {
        self.active.store(false, Ordering::Relaxed);
    }

    /// Close the session on the server and stop background tasks.
    /// Called on shutdown (CLAUDE.md critical lesson 4).
    pub async fn close(&self) -> Result<(), String> {
        self.active.store(false, Ordering::Relaxed);
        let sid = self
            .session_id
            .as_deref()
            .ok_or_else(|| "No active session".to_string())?;
        let ct = *self.current_time.lock().unwrap();
        let tl = *self.time_listened.lock().unwrap();
        self.client.close_session(sid, ct, tl).await
    }
}
