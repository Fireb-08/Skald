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
        // Stop any tasks from a previous session.
        self.active.store(false, Ordering::Relaxed);

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
