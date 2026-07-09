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
    // True when the locally-playing item is a *local-library* item (no server
    // counterpart) rather than a downloaded ABS book. Local-library progress goes
    // to the SQLite catalog; downloaded-book progress goes to the offline queue
    // (which later flushes to the server). Set by play_local().
    pub is_local_library: bool,
    // For a local *podcast episode*, the episode id whose progress is written to
    // the catalog (keyed per (item, episode)). Empty/None for a whole-item book.
    // Set by play_local(); used by the tick loop and the shutdown handler.
    pub local_episode_id: Option<String>,
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
            is_local_library: false,
            local_episode_id: None,
        }
    }

    /// Open a playback session for `item_id`, spawn the 1-second tick loop
    /// (position updates + `playback-tick` events) and the 10-second sync loop.
    /// Returns the server's `currentTime` so the caller can seek after play starts.
    ///
    /// `episode_id` selects an individual podcast episode (cluster E); for a book
    /// it is `None`. It only affects which `/play` route is opened — the session
    /// id drives all subsequent sync, so episode progress persists like a book's.
    pub async fn start_session<R: tauri::Runtime>(
        &mut self,
        item_id: &str,
        episode_id: Option<&str>,
        app: tauri::AppHandle<R>,
        start_time: Option<f64>,
    ) -> Result<f64, String> {
        // Stop any tasks from a previous session (online or local).
        self.active.store(false, Ordering::Relaxed);
        // Clear the local flag — this is an online session, sync is required.
        self.is_local = false;
        self.is_local_library = false;
        // Clear the local item ID — no longer tracking offline progress.
        self.local_item_id = None;

        // Initialize the audio player on first call (deferred to avoid
        // requiring libvlc.dll on PATH at startup).
        let player_newly_created = {
            let mut p = self.player.lock().unwrap();
            if p.is_none() {
                *p = Some(AudioPlayer::new()?);
                true
            } else {
                false
            }
        };
        // Restore persisted EQ settings outside the mutex so the file I/O and
        // FFI cost don't extend the same lock that holds Instance::new().
        if player_newly_created {
            let guard = self.player.lock().unwrap();
            if let Some(p) = guard.as_ref() {
                p.restore_eq();
            }
        }

        let session = self.client.open_session(item_id, episode_id, start_time).await?;
        self.session_id = Some(session.id.clone());
        // Prefer the caller-supplied start_time so LibVLC loads at the exact
        // chapter position even if the server's currentTime differs slightly.
        let load_time = start_time.unwrap_or(session.current_time);
        *self.current_time.lock().unwrap() = load_time;
        *self.time_listened.lock().unwrap() = 0.0;

        // Load the audio track(s) into the player.
        // Token-in-URL pattern (CLAUDE.md critical lesson 2): LibVLC HTTP headers are
        // unreliable on Windows — never use Authorization headers for media URLs.
        // A book with >1 audioTrack is multi-track: load them ALL as one contiguous
        // timeline (ABS's model — each track carries a startOffset). The single ABS
        // session keeps driving sync with the GLOBAL currentTime, so advancing tracks
        // client-side needs no new server session.
        let token = self.client.token.as_deref().unwrap_or("").to_string();
        let base = self.client.base_url.trim_end_matches('/').to_string();
        let online_multitrack = session.audio_tracks.len() > 1;
        {
            let player_guard = self.player.lock().unwrap();
            if let Some(p) = player_guard.as_ref() {
                if online_multitrack {
                    let tracks: Vec<(String, f64)> = session
                        .audio_tracks
                        .iter()
                        .map(|t| (format!("{base}{}?token={token}", t.content_url), t.duration))
                        .collect();
                    p.load_tracks(tracks, load_time)?;
                } else if let Some(track) = session.audio_tracks.first() {
                    let url = format!("{base}{}?token={token}", track.content_url);
                    p.load(&url, load_time)?;
                }
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
                let (pos, dur, playing, live, ended) = {
                    // Poison-tolerant: a panic elsewhere holding the player lock must
                    // not kill progress capture for the rest of the session.
                    let guard = player_tick.lock().unwrap_or_else(|e| e.into_inner());
                    match guard.as_ref() {
                        Some(p) => (p.position(), p.duration(), p.is_playing(), p.position_is_live(), p.book_ended()),
                        None => (0.0, 0.0, false, false, false),
                    }
                };
                // Guard the shared position against the end-of-media / pre-buffer
                // collapse to 0: only commit `pos` when the engine reports a live
                // position. On a true book end, commit the exact duration so the
                // server marks the item finished instead of resetting it to 0%.
                if ended && dur > 0.0 {
                    *ct_tick.lock().unwrap() = dur;
                } else if live {
                    *ct_tick.lock().unwrap() = pos;
                }
                if playing {
                    *tl_tick.lock().unwrap() += 1.0;
                }
                // Report the committed position (held through transient states), not
                // the raw `pos`, so the UI never flashes 0:00 at the end / during buffer.
                let report = *ct_tick.lock().unwrap();
                let _ = app_tick.emit(
                    "playback-tick",
                    serde_json::json!({
                        "currentTime": report,
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

        // Multi-track ABS book → chain its tracks (see spawn_advance_task).
        if online_multitrack {
            self.spawn_advance_task(Arc::clone(&active));
        }

        // Return the position the player actually loaded at (honours a caller
        // start_time override) — the frontend seeds st.position from this, and
        // returning the server's stale currentTime made the UI open a chapter/
        // bookmark jump at the wrong spot until the first playback tick.
        Ok(load_time)
    }

    /// Spawn the track-advance loop for the currently-loaded multi-track book. The
    /// MediaPlayerEndReached callback (audio.rs) wakes the player's `advance` Notify
    /// when a track finishes; this task performs the actual switch to the next track
    /// OFF the libvlc event thread (calling libvlc from within the callback risks a
    /// deadlock). try_advance() is a no-op unless the current track has really ended
    /// and another remains, so the 2s fallback tick — which also lets the task notice
    /// session teardown (active=false) and exit — is harmless. Shared by the local
    /// (play_local) and online (start_session) multi-track paths.
    fn spawn_advance_task(&self, active: Arc<AtomicBool>) {
        let advance = {
            let guard = self.player.lock().unwrap();
            guard.as_ref().map(|p| p.advance_signal())
        };
        let Some(advance) = advance else { return };
        let player_adv = Arc::clone(&self.player);
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = advance.notified() => {}
                    _ = tokio::time::sleep(Duration::from_secs(2)) => {}
                }
                if !active.load(Ordering::Relaxed) {
                    break;
                }
                if let Ok(guard) = player_adv.lock() {
                    if let Some(p) = guard.as_ref() {
                        let _ = p.try_advance();
                    }
                }
            }
        });
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
        local_library: bool,
        // For a local podcast episode, its id (progress keyed per episode). None
        // for a downloaded ABS book or a whole-item local book.
        episode_id: Option<&str>,
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
        // Distinguish a local-library item (catalog progress) from a downloaded
        // ABS book (offline queue → server flush).
        self.is_local_library = local_library;
        // Store the ABS item ID so the tick task and shutdown handler can key
        // offline progress queue entries to the correct library item.
        self.local_item_id = Some(item_id.to_string());
        // Remember the episode (if any) so catalog progress is written per episode.
        self.local_episode_id = episode_id.filter(|s| !s.is_empty()).map(|s| s.to_string());

        // Initialize the audio player on first call (deferred init matches start_session).
        let player_newly_created = {
            let mut p = self.player.lock().unwrap();
            if p.is_none() {
                *p = Some(AudioPlayer::new()?);
                true
            } else {
                false
            }
        };
        if player_newly_created {
            let guard = self.player.lock().unwrap();
            if let Some(p) = guard.as_ref() {
                p.restore_eq();
            }
        }

        // Resolve what to load. A directory is a (potentially) multi-file book:
        // list its audio files in playback order. We sort the full paths with
        // `.sort()` — the SAME ordering the scanner uses when it builds this book's
        // per-file chapters — so each track's global offset lines up exactly with
        // its chapter. >1 file → true multi-track playback (ABS's model: one player,
        // one contiguous timeline across the tracks, auto-advancing). 1 file (or a
        // single-file path) → the original single-media path, untouched.
        let audio_ext = ["m4b", "mp3", "aac", "ogg", "flac", "opus", "m4a", "wav"];
        let dir_files: Option<Vec<std::path::PathBuf>> = if std::path::Path::new(file_path).is_dir() {
            let mut files: Vec<std::path::PathBuf> = std::fs::read_dir(file_path)
                .map_err(|e| format!("Failed to read book directory: {e}"))?
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| {
                    p.extension()
                        .and_then(|x| x.to_str())
                        .map(|x| audio_ext.contains(&x.to_lowercase().as_str()))
                        .unwrap_or(false)
                })
                .collect();
            files.sort();
            if files.is_empty() {
                return Err("No audio files found in book directory".to_string());
            }
            Some(files)
        } else {
            None
        };

        // A true multi-file book drives the track-advance task spawned below.
        let multitrack = matches!(&dir_files, Some(files) if files.len() > 1);

        // Probe each file's duration to build the global timeline (the scanner uses
        // the same ffprobe durations to derive this book's chapters, so offsets line
        // up). Done OUTSIDE the player lock — ffprobe spawns are slow and holding the
        // lock across them would stall the tick loop / transport controls.
        let multitrack_tracks: Option<Vec<(String, f64)>> = if multitrack {
            dir_files.as_ref().map(|files| {
                files
                    .iter()
                    .map(|f| {
                        let uri = format!("file:///{}", f.to_string_lossy().replace('\\', "/"));
                        (uri, crate::probe::probe_file(f).duration_secs)
                    })
                    .collect()
            })
        } else {
            None
        };

        {
            let guard = self.player.lock().unwrap();
            if let Some(p) = guard.as_ref() {
                if let Some(tracks) = multitrack_tracks {
                    p.load_tracks(tracks, start_time)?;
                } else {
                    // Single file (bare path, or the lone file inside a directory).
                    // AudioPlayer::load() applies :start-time so no post-play seek.
                    let uri = match &dir_files {
                        Some(files) => format!("file:///{}", files[0].to_string_lossy().replace('\\', "/")),
                        None => format!("file:///{}", file_path.replace('\\', "/")),
                    };
                    p.load(&uri, start_time)?;
                }
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
        // Episode id (if any) for per-episode catalog progress writes.
        let episode_id_tick = self.local_episode_id.clone();
        // Resolve the downloads dir once before spawning; propagate None if it
        // fails (unlikely) so the tick loop still runs without queue writes.
        let dl_dir_tick     = crate::downloads::downloads_dir().ok();
        // Local-library items persist progress to the SQLite catalog; downloaded
        // ABS books persist to the offline queue (which later flushes to the server).
        let local_library_tick = local_library;

        tokio::spawn(async move {
            // Persist resume progress at most every PERSIST_EVERY seconds — the UI
            // tick stays at 1 Hz, but 1 Hz disk writes are needless for a resume
            // position. The exact final position is still captured on book-switch /
            // stop (the `pending` flush when the loop ends) and on app exit (the
            // ExitRequested handler in lib.rs writes current_time directly).
            const PERSIST_EVERY: u32 = 5;
            // Write the latest position to the catalog (local-library item) or the
            // offline queue (downloaded ABS book). Uses the CAPTURED id/pos — never a
            // re-read of the shared player — so a flush after a book-switch still
            // records THIS book, even though the player may already hold the next one.
            let persist = |pos: f64, dur: f64, finished: bool| {
                if local_library_tick {
                    if let Err(e) = crate::catalog::set_progress(&item_id_tick, episode_id_tick.as_deref(), pos, dur, finished) {
                        // Silent loss here is indistinguishable from a desync bug in the
                        // field — log it so skald.log captures the failure boundary.
                        log::warn!(target: "skald::library", "local progress persist failed: {e}");
                    }
                } else if let Some(ref dl_dir) = dl_dir_tick {
                    let entry = crate::downloads::OfflineProgressEntry {
                        item_id: item_id_tick.clone(),
                        current_time: pos,
                        duration: dur,
                        progress: if dur > 0.0 { pos / dur } else { 0.0 },
                        is_finished: finished,
                        // Stable timestamp without pulling in chrono — same
                        // precision as chrono::Utc::now().timestamp_millis().
                        recorded_at: std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as i64,
                    };
                    if let Err(e) = crate::downloads::upsert_progress_entry(dl_dir, entry) {
                        log::warn!(target: "skald::downloads", "offline progress persist failed: {e}");
                    }
                }
            };

            let mut interval = tokio::time::interval(Duration::from_secs(1));
            let mut ticks: u32 = 0;
            // Most recent (pos, dur) not yet persisted; flushed when the loop ends so
            // a throttled write is never lost on book-switch/stop. A stop is not a
            // finish, so the loop-end flush always writes finished = false.
            let mut pending: Option<(f64, f64)> = None;
            // Set once the completed book is recorded so the finished row isn't
            // rewritten every tick while the player sits in Ended.
            let mut finished_recorded = false;
            loop {
                interval.tick().await;
                if !active_tick.load(Ordering::Relaxed) {
                    if let Some((pos, dur)) = pending.take() { persist(pos, dur, false); }
                    break;
                }
                let (pos, dur, playing, live, ended) = {
                    // Poison-tolerant (see online tick) so progress capture survives a
                    // panic that poisoned the player lock elsewhere.
                    let guard = player_tick.lock().unwrap_or_else(|e| e.into_inner());
                    match guard.as_ref() {
                        Some(p) => (p.position(), p.duration(), p.is_playing(), p.position_is_live(), p.book_ended()),
                        None    => (0.0, 0.0, false, false, false),
                    }
                };
                // Same end-of-media / pre-buffer guard as the online tick: commit the
                // exact duration on a true end, the live position while steadily
                // playing, and hold the last good value through transient states.
                if ended && dur > 0.0 {
                    *ct_tick.lock().unwrap() = dur;
                } else if live {
                    *ct_tick.lock().unwrap() = pos;
                }
                if playing {
                    *tl_tick.lock().unwrap() += 1.0;
                }
                // Report the committed position (never the raw 0 from Ended/buffering).
                let report = *ct_tick.lock().unwrap();
                let _ = app_tick.emit(
                    "playback-tick",
                    serde_json::json!({
                        "currentTime": report,
                        "duration":    dur,
                        "isPlaying":   playing,
                    }),
                );
                // Persistence — three cases mirror the position guard above:
                if ended && dur > 0.0 {
                    // True book end: record completion exactly once (finished = true).
                    if !finished_recorded {
                        persist(dur, dur, true);
                        finished_recorded = true;
                        pending = None;
                    }
                } else if live {
                    // A live position after an end means the book was restarted — re-arm.
                    finished_recorded = false;
                    // Throttled persistence: remember this tick, write on the boundary.
                    pending = Some((report, dur));
                    ticks += 1;
                    if ticks % PERSIST_EVERY == 0 {
                        persist(report, dur, false);
                        pending = None;
                    }
                }
                // Transient (Opening/Buffering) states fall through: hold the last
                // good value, persist nothing.
            }
        });

        // Multi-file book → chain its tracks (see spawn_advance_task).
        if multitrack {
            self.spawn_advance_task(Arc::clone(&active));
        }

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
