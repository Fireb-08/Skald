use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Duration;

use tauri::Emitter;

use crate::{api::AbsClient, audio::AudioPlayer};

// ── Pure tick decisions (Test Seams roadmap) ─────────────────────────────────
// The per-tick position/persistence rules, extracted from the two tick loops so
// they are unit-testable without a LibVLC player. Values in, decision out — no
// I/O may creep in here (that would break the seam).

/// The position the player should load at: an explicit caller start (chapter/
/// bookmark jump) always beats the server's possibly-stale currentTime.
fn resolve_load_time(start_time: Option<f64>, server_current_time: f64) -> f64 {
    start_time.unwrap_or(server_current_time)
}

/// End-of-media / pre-buffer guard: on a true end commit the exact duration (so
/// the server marks the item finished instead of resetting it to 0%); while
/// steadily playing commit the live position; through transient Opening/
/// Buffering states hold the last good value, so the UI never flashes 0:00 and
/// progress never regresses on a transient 0.
fn commit_position(prev: f64, pos: f64, dur: f64, live: bool, ended: bool) -> f64 {
    if ended && dur > 0.0 {
        dur
    } else if live {
        pos
    } else {
        prev
    }
}

/// Throttle state for the offline persist loop (play_local's tick task).
#[derive(Default)]
struct PersistState {
    ticks: u32,
    /// Most recent (pos, dur) not yet persisted; the loop-end flush writes it
    /// on stop/book-switch so a throttled write is never lost.
    pending: Option<(f64, f64)>,
    /// Set once the completed book is recorded so the finished row isn't
    /// rewritten every tick while the player sits in Ended.
    finished_recorded: bool,
}

/// A progress write the loop should perform on this tick.
struct PersistRecord {
    pos: f64,
    dur: f64,
    finished: bool,
}

/// The offline loop's per-tick persistence decision — three cases mirroring the
/// position guard: a true end records completion exactly once; a live tick
/// buffers into `pending` and flushes every `every`th tick (1 Hz ticks, but
/// 1 Hz disk writes are needless for a resume position); transient states leave
/// `pending` intact for the loop-end flush. A live position after an end means
/// the book was restarted, so the finished latch re-arms.
fn persist_decision(
    st: &mut PersistState,
    report: f64,
    dur: f64,
    live: bool,
    ended: bool,
    every: u32,
) -> Option<PersistRecord> {
    if ended && dur > 0.0 {
        if !st.finished_recorded {
            st.finished_recorded = true;
            st.pending = None;
            return Some(PersistRecord { pos: dur, dur, finished: true });
        }
        None
    } else if live {
        st.finished_recorded = false;
        st.pending = Some((report, dur));
        st.ticks += 1;
        if st.ticks.is_multiple_of(every) {
            st.pending = None;
            return Some(PersistRecord { pos: report, dur, finished: false });
        }
        None
    } else {
        None
    }
}

/// Watch a spawned playback task and make its death observable (review H5): a
/// panic inside a tick/sync loop is otherwise swallowed by tokio and progress
/// tracking silently stops for the rest of the session. The watcher logs the
/// panic and emits `sync-failed` so the frontend can tell the user to restart
/// playback. Normal task exit (session teardown via the active flag) is not an
/// error and passes through silently.
fn watch_task<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    task: &'static str,
    handle: tokio::task::JoinHandle<()>,
) {
    tokio::spawn(async move {
        if let Err(e) = handle.await {
            if e.is_panic() {
                log::error!(target: "skald::sync", "{task} task panicked — progress tracking stopped: {e}");
                let _ = app.emit("sync-failed", serde_json::json!({ "task": task }));
            }
        }
    });
}

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
    // ── Local listening stats (Local Listening Stats roadmap) ────────────────
    // Seconds of local-library listening not yet flushed to the catalog. The
    // 1-second tick increments it; flush_listen_time() drains it every
    // LISTEN_FLUSH_EVERY seconds, at loop end, and from the shutdown handler.
    // Shared (Arc) because the tick task and the shutdown path both drain it —
    // mem::take-style draining makes a concurrent double-flush harmless.
    pub local_listen_pending: Arc<Mutex<f64>>,
    // The listen_sessions row id for the CURRENT local-library playback (one
    // continuous play of one item/episode). None during online playback and for
    // downloaded ABS books — their listening reaches server stats via session
    // sync, and counting them locally too would double-represent them in a
    // combined stats view.
    pub local_listen_session: Option<String>,
}

/// How many accumulated local listening seconds trigger a catalog flush. The
/// tail below this is captured by the loop-end / shutdown drains.
const LISTEN_FLUSH_EVERY: f64 = 30.0;

/// Drain the pending local listen-time counter into the catalog (listen_days +
/// listen_sessions). Shared by the tick loop (periodic + loop-end flush) and
/// lib.rs's ExitRequested handler (final flush — the tick task may never fire
/// again once the runtime is shutting down). On a failed write the drained
/// seconds are put back so the next flush retries instead of losing them.
pub fn flush_listen_time(
    session_id: Option<&str>,
    item_id: &str,
    episode_id: Option<&str>,
    pending: &Arc<Mutex<f64>>,
) {
    let Some(sid) = session_id else { return };
    let secs = {
        // Poison-tolerant like the tick's player lock — stats must never be the
        // thing that blocks a flush during teardown.
        let mut p = pending.lock().unwrap_or_else(|e| e.into_inner());
        std::mem::take(&mut *p)
    };
    if secs < 1.0 {
        return;
    }
    if let Err(e) = crate::catalog::add_listen_time(sid, item_id, episode_id, secs) {
        log::warn!(target: "skald::playback", "local listen flush failed: {e}");
        *pending.lock().unwrap_or_else(|p| p.into_inner()) += secs;
    } else {
        log::debug!(target: "skald::playback", "local listen flush session={sid} secs={secs}");
    }
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
            local_listen_pending: Arc::new(Mutex::new(0.0)),
            local_listen_session: None,
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
        // Online playback is counted by the server's own listening stats — stop
        // any local stats session (the old tick task drains pending on exit).
        self.local_listen_session = None;

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
        let load_time = resolve_load_time(start_time, session.current_time);
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

        let tick_handle = tokio::spawn(async move {
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
                // collapse to 0 (see commit_position).
                {
                    // Poison-tolerant like the player lock (review H5): these plain
                    // f64 cells can't be left in a broken state, so inheriting a
                    // poison here would only kill progress capture for no benefit.
                    let mut ct = ct_tick.lock().unwrap_or_else(|e| e.into_inner());
                    *ct = commit_position(*ct, pos, dur, live, ended);
                }
                if playing {
                    *tl_tick.lock().unwrap_or_else(|e| e.into_inner()) += 1.0;
                }
                // Report the committed position (held through transient states), not
                // the raw `pos`, so the UI never flashes 0:00 at the end / during buffer.
                let report = *ct_tick.lock().unwrap_or_else(|e| e.into_inner());
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
        watch_task(app.clone(), "online tick", tick_handle);

        // ── Sync task: every 10 seconds (CLAUDE.md critical lesson 3) ─────────
        let ct_sync = Arc::clone(&self.current_time);
        let tl_sync = Arc::clone(&self.time_listened);
        let client_sync = self.client.clone();
        let session_id_sync = session.id.clone();
        let active_sync = Arc::clone(&active);

        let sync_handle = tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(10));
            interval.tick().await; // skip the immediate first tick
            loop {
                interval.tick().await;
                if !active_sync.load(Ordering::Relaxed) {
                    break;
                }
                // Poison-tolerant (review H5): a stale read is strictly better
                // than the sync loop dying and progress never persisting again.
                let ct = *ct_sync.lock().unwrap_or_else(|e| e.into_inner());
                let tl = *tl_sync.lock().unwrap_or_else(|e| e.into_inner());
                let _ = client_sync.sync_session(&session_id_sync, ct, tl).await;
            }
        });
        watch_task(app.clone(), "session sync", sync_handle);

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

        // New local playback = new listening-stats session row (Local Listening
        // Stats roadmap). Only LOCAL-LIBRARY playback is counted — downloaded ABS
        // books reach server stats via session sync once online. The pending
        // counter gets a FRESH Arc (same pattern as the active flag) so the
        // previous tick task's loop-end flush drains its own counter under its
        // own session id, never racing this session's accumulation.
        self.local_listen_session = if local_library {
            let started = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis();
            Some(format!("local-{item_id}-{started}"))
        } else {
            None
        };
        self.local_listen_pending = Arc::new(Mutex::new(0.0));

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
        let app_tick        = app.clone();
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
        // Listening-stats accumulation (local-library only — see the field docs).
        let listen_pending_tick = Arc::clone(&self.local_listen_pending);
        let listen_session_tick = self.local_listen_session.clone();

        let local_tick_handle = tokio::spawn(async move {
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
            // Throttle/latch state for persist_decision. Its pending pair is flushed
            // when the loop ends so a throttled write is never lost on book-switch/
            // stop. A stop is not a finish, so the flush always writes finished = false.
            let mut pstate = PersistState::default();
            loop {
                interval.tick().await;
                if !active_tick.load(Ordering::Relaxed) {
                    if let Some((pos, dur)) = pstate.pending.take() { persist(pos, dur, false); }
                    // Book-switch/stop: drain the listen tail so short sessions
                    // (< LISTEN_FLUSH_EVERY) still register in the stats.
                    flush_listen_time(listen_session_tick.as_deref(), &item_id_tick, episode_id_tick.as_deref(), &listen_pending_tick);
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
                // Same end-of-media / pre-buffer guard as the online tick (see
                // commit_position).
                {
                    // Poison-tolerant f64 cells (review H5) — same reasoning as the
                    // online tick: never let an inherited poison stop progress capture.
                    let mut ct = ct_tick.lock().unwrap_or_else(|e| e.into_inner());
                    *ct = commit_position(*ct, pos, dur, live, ended);
                }
                if playing {
                    *tl_tick.lock().unwrap_or_else(|e| e.into_inner()) += 1.0;
                    // Local listening stats: count the second, flush to the
                    // catalog once enough accrue (1 Hz SQLite writes for stats
                    // would be needless churn — same reasoning as PERSIST_EVERY).
                    if listen_session_tick.is_some() {
                        let due = {
                            let mut pend = listen_pending_tick.lock().unwrap_or_else(|e| e.into_inner());
                            *pend += 1.0;
                            *pend >= LISTEN_FLUSH_EVERY
                        };
                        if due {
                            flush_listen_time(listen_session_tick.as_deref(), &item_id_tick, episode_id_tick.as_deref(), &listen_pending_tick);
                        }
                    }
                }
                // Report the committed position (never the raw 0 from Ended/buffering).
                let report = *ct_tick.lock().unwrap_or_else(|e| e.into_inner());
                let _ = app_tick.emit(
                    "playback-tick",
                    serde_json::json!({
                        "currentTime": report,
                        "duration":    dur,
                        "isPlaying":   playing,
                    }),
                );
                // Persistence — the throttle/latch state machine lives in
                // persist_decision (pure, unit-tested); this loop only does the write.
                if let Some(rec) = persist_decision(&mut pstate, report, dur, live, ended, PERSIST_EVERY) {
                    persist(rec.pos, rec.dur, rec.finished);
                }
            }
        });
        watch_task(app, "local tick", local_tick_handle);

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

// Unit tests for the pure tick decisions (Test Seams roadmap) — no LibVLC, no
// tokio runtime: the helpers take plain values and return decisions.
#[cfg(test)]
mod tick_tests {
    use super::{commit_position, persist_decision, resolve_load_time, PersistState};

    #[test]
    fn load_time_prefers_explicit_start_over_server_time() {
        // Chapter/bookmark jump: the caller's position wins over the server's
        // stale currentTime (Testing Suite plan regression #8).
        assert_eq!(resolve_load_time(Some(120.5), 3000.0), 120.5);
        // Explicit restart-from-zero is still an override.
        assert_eq!(resolve_load_time(Some(0.0), 3000.0), 0.0);
        // Plain resume: fall back to the server's saved position.
        assert_eq!(resolve_load_time(None, 3000.0), 3000.0);
    }

    #[test]
    fn commit_position_guards_transient_zero_and_end_of_media() {
        // Steady playback commits the live position.
        assert_eq!(commit_position(100.0, 101.0, 3600.0, true, false), 101.0);
        // Live zero is a genuine restart, not noise — commit it.
        assert_eq!(commit_position(100.0, 0.0, 3600.0, true, false), 0.0);
        // Transient Opening/Buffering (not live): hold the last good value so a
        // transient 0 never resets UI/server progress.
        assert_eq!(commit_position(100.0, 0.0, 3600.0, false, false), 100.0);
        // True book end commits the exact duration (server marks it finished).
        assert_eq!(commit_position(100.0, 0.0, 3600.0, false, true), 3600.0);
        // Ended but duration unknown: nothing trustworthy to commit — hold.
        assert_eq!(commit_position(100.0, 0.0, 0.0, false, true), 100.0);
    }

    #[test]
    fn persist_throttles_to_every_nth_live_tick_and_buffers_between() {
        let mut st = PersistState::default();
        // Ticks 1-4 buffer into pending, no write.
        for i in 1..5u32 {
            let rec = persist_decision(&mut st, i as f64, 3600.0, true, false, 5);
            assert!(rec.is_none(), "tick {i} must not write");
            assert_eq!(st.pending, Some((i as f64, 3600.0)));
        }
        // Tick 5 writes the latest position and clears the buffer.
        let rec = persist_decision(&mut st, 5.0, 3600.0, true, false, 5).expect("5th tick writes");
        assert_eq!((rec.pos, rec.finished), (5.0, false));
        assert_eq!(st.pending, None);
        // A transient tick leaves pending untouched — the loop-end flush relies
        // on it holding the last live position on stop/book-switch.
        persist_decision(&mut st, 6.0, 3600.0, true, false, 5);
        assert_eq!(st.pending, Some((6.0, 3600.0)));
        assert!(persist_decision(&mut st, 6.0, 3600.0, false, false, 5).is_none());
        assert_eq!(st.pending, Some((6.0, 3600.0)));
    }

    #[test]
    fn persist_records_finish_once_and_rearms_on_restart() {
        let mut st = PersistState::default();
        // True end: exactly one finished write, even across repeated Ended ticks.
        let rec = persist_decision(&mut st, 3600.0, 3600.0, false, true, 5).expect("end writes");
        assert!((rec.finished, rec.pos, rec.dur) == (true, 3600.0, 3600.0));
        assert!(persist_decision(&mut st, 3600.0, 3600.0, false, true, 5).is_none());
        assert!(persist_decision(&mut st, 3600.0, 3600.0, false, true, 5).is_none());
        // A live tick after the end is a restart: the latch re-arms so a
        // re-listen can record completion again.
        persist_decision(&mut st, 1.0, 3600.0, true, false, 5);
        let rec = persist_decision(&mut st, 3600.0, 3600.0, false, true, 5).expect("re-finish writes");
        assert!(rec.finished);
        // An end with no known duration records nothing (mirror of the
        // commit_position hold) — the latch stays armed for the real end.
        let mut st = PersistState::default();
        assert!(persist_decision(&mut st, 100.0, 0.0, false, true, 5).is_none());
        assert!(!st.finished_recorded);
    }
}
