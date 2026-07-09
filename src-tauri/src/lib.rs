pub mod models;
pub mod api;
pub mod auth;
pub mod eq;
pub mod audio;
pub mod commands;
pub mod session;
pub mod cover_cache;
pub mod paths;     // Onboarding: user-relocatable downloads + cache roots
pub mod socket;    // Phase B: Socket.IO transport for live sync
pub mod downloads; // Phase B: persistent registry of downloaded books
pub mod probe;     // Local Library: ffprobe-based metadata + chapter reader
pub mod tone;      // Local Library: tone-based metadata writer
pub mod scanner;   // Local Library: local folder scanner (emits ABS-shaped items)
pub mod catalog;   // Local Library: SQLite catalog for local libraries + items
pub mod ingest;    // Local Library: file-system organize layer (Author/Series/Title)
pub mod providers; // Local Library: server-free metadata providers (match flow)
pub mod watcher;   // Local Library: staging-folder file-system watcher
pub mod podcast_feed; // Local Podcasts: server-free RSS/Atom feed + OPML parsing
pub mod podcast_scheduler; // Local Podcasts: auto-download poll + retention

use std::sync::Arc;
use tokio::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // SessionManager is initialized without an AudioPlayer — libvlc.dll is
    // loaded lazily on the first start_session call, not at app startup.
    let session_mgr: Arc<Mutex<session::SessionManager>> = Arc::new(Mutex::new(
        session::SessionManager::new(api::AbsClient::new(String::new())),
    ));
    let session_mgr_for_exit = Arc::clone(&session_mgr);

    // Shared map from shortcut ID to action name, written by register_shortcuts
    // command and read by the global-shortcut event handler.
    let shortcut_map: commands::ShortcutActionMap =
        Arc::new(std::sync::RwLock::new(std::collections::HashMap::new()));
    let shortcut_map_for_handler = Arc::clone(&shortcut_map);

    // Socket.IO client slot — None until the user enables live sync.
    // Arc<Mutex<Option<Client>>> so connect/disconnect commands can
    // safely swap the client from any tokio task.
    let socket_state: socket::SocketState = Arc::new(Mutex::new(None));
    // Cloned here so the ExitRequested handler can tear down the socket while
    // the original Arc remains in managed state until the runtime shuts down.
    let socket_state_for_exit = Arc::clone(&socket_state);

    // Cancel token registry for in-progress downloads.
    // Maps item_id → CancellationToken; the cancel_download command looks up
    // the token by item_id and calls token.cancel() to abort the stream loop.
    let cancel_registry: downloads::DownloadCancelRegistry =
        Arc::new(Mutex::new(std::collections::HashMap::new()));

    // Staging-folder watcher slot (Local Library) — None until the frontend calls
    // start_staging_watch with the local libraries' staging paths.
    let staging_watcher: watcher::StagingWatcher = Arc::new(std::sync::Mutex::new(None));

    // Cancel token registry for in-progress server uploads (uploadId → token),
    // the upload-side mirror of cancel_registry above.
    let upload_registry =
        commands::UploadCancelRegistry(Mutex::new(std::collections::HashMap::new()));

    tauri::Builder::default()
        // Diagnostic logging — registered first so it captures startup and other
        // plugins. Rust `log::*` and the frontend @tauri-apps/plugin-log API both
        // write here: stdout (dev terminal) + a rotated file under app_log_dir
        // (skald.log). The feature category rides in the log target (e.g.
        // "skald::sync"). See the Diagnostic Logging roadmap.
        .plugin(
            tauri_plugin_log::Builder::new()
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Stdout,
                ))
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir { file_name: Some("skald".into()) },
                ))
                // Webview target + the frontend attachConsole() surfaces Rust logs in
                // devtools too (dev convenience). No console monkey-patching, so no loop.
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Webview,
                ))
                .level(log::LevelFilter::Info)
                .max_file_size(5_000_000) // ~5 MB before rotation
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    use tauri::Emitter;
                    use tauri_plugin_global_shortcut::ShortcutState;
                    if event.state() == ShortcutState::Pressed {
                        if let Some(action) = shortcut_map_for_handler
                            .read()
                            .unwrap()
                            .get(&shortcut.id())
                        {
                            let _ = app.emit(&format!("shortcut-{action}"), ());
                        }
                    }
                })
                .build(),
        )
        .manage(session_mgr)
        .manage(shortcut_map)
        .manage(socket_state) // Socket.IO client — accessed by connect/disconnect commands
        .manage(cancel_registry) // per-download CancellationTokens — accessed by cancel_download
        .manage(staging_watcher) // Local Library staging-folder watcher slot
        .manage(upload_registry) // per-upload CancellationTokens — accessed by cancel_upload
        .setup(|app| {
            use tauri::Manager;

            // Set VLC_PLUGIN_PATH to the bundled plugins directory so LibVLC can
            // find its codecs/demuxers regardless of whether VLC is installed on
            // the target machine. Must run before the first Instance::new() call,
            // which is lazy (triggered by open_playback_session / play_local_file).
            if let Ok(resource_dir) = app.path().resource_dir() {
                let plugins = resource_dir.join("plugins");
                std::env::set_var("VLC_PLUGIN_PATH", &plugins);

                // Pre-build the LibVLC plugin cache (plugins.dat) when it's missing.
                // Without it, libvlccore rebuilds the cache on the first Instance::new()
                // (i.e. first playback) — on Windows that spawns the console-subsystem
                // vlc-cache-gen and/or rescans every plugin, flashing command-prompt
                // windows and adding a multi-second first-play delay. The NSIS installer
                // builds this at install time for production; a dev run (no installer)
                // has no cache, so build it here. Idempotent (skipped once present) and
                // run WINDOWLESS. vlc-cache-gen needs libvlccore.dll in its own dir (it
                // sits beside it in resource_dir) and an ABSOLUTE plugins path.
                let cache_gen = resource_dir.join("vlc-cache-gen.exe");
                if cache_gen.exists() && plugins.is_dir() && !plugins.join("plugins.dat").exists() {
                    let mut cmd = std::process::Command::new(&cache_gen);
                    cmd.arg(&plugins);
                    #[cfg(windows)]
                    {
                        use std::os::windows::process::CommandExt;
                        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
                    }
                    match cmd.status() {
                        Ok(s) => log::info!(target: "skald::app", "built LibVLC plugin cache (exit {:?})", s.code()),
                        Err(e) => log::warn!(target: "skald::app", "LibVLC plugin cache build failed: {e}"),
                    }
                }
            }

            // Resolve the bundled helper binaries (ffprobe = read metadata/chapters,
            // tone = write). build.rs copies them next to the exe in dev; Tauri
            // bundles them into the resource dir. Prefer whichever actually has them,
            // and let the modules fall back to PATH if neither is found.
            let bin_dir = app
                .path()
                .resource_dir()
                .ok()
                .filter(|d| d.join("ffprobe.exe").exists())
                .or_else(|| std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf())));
            if let Some(dir) = bin_dir {
                let ffprobe = dir.join("ffprobe.exe");
                if ffprobe.exists() {
                    crate::probe::set_ffprobe_path(ffprobe);
                }
                let tone = dir.join("tone.exe");
                if tone.exists() {
                    crate::tone::set_tone_path(tone);
                }
            }

            // The cover cache path is user-relocatable and Store/MSIX installs can
            // canonicalize AppData paths through the package identity. Authorize
            // the resolved directory at runtime instead of relying only on a
            // hard-coded assetProtocol scope from tauri.conf.json.
            match crate::cover_cache::allow_asset_scope(app.handle()) {
                Ok(dir) => log::info!(target: "skald::app", "cover cache asset scope allowed {}", dir.display()),
                Err(e) => log::warn!(target: "skald::app", "cover cache asset scope failed: {e}"),
            }

            // The main window is created here instead of in tauri.conf.json so we
            // can call disable_file_drop_handler(). Tauri 2.x removed fileDropEnabled
            // from the JSON config schema — the option only exists on the builder.
            //
            // Without this, WebView2 registers a native IDropTarget that intercepts
            // ALL drag events and returns DROPEFFECT_NONE for internal DOM drags,
            // which forces the OS "no-drop" cursor regardless of the JS dropEffect.
            let win = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App(std::path::PathBuf::default()),
            )
            .title("Skald")
            .inner_size(1280.0, 800.0)
            .min_inner_size(1024.0, 640.0)
            .decorations(false)
            .transparent(true)
            .shadow(true)
            .disable_drag_drop_handler()
            .build()?;

            // Confirm the handler was disabled at startup — regressing this silently
            // re-breaks all internal DOM drags (see CLAUDE.md critical lesson 12).
            log::info!(target: "skald::app", "window '{}' created with file-drop handler disabled", win.label());

            // Start the local-podcast auto-download scheduler (launch catch-up +
            // per-minute cron evaluation). No-op until a podcast enables it.
            crate::podcast_scheduler::start(app.handle().clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::login,
            commands::logout,
            commands::has_token,
            commands::get_me,
            commands::fetch_libraries,
            commands::fetch_library_items,
            commands::get_library_series,
            commands::get_series_items,
            commands::get_continue_listening,
            commands::fetch_item,
            commands::fetch_listening_stats,
            commands::create_bookmark,
            commands::update_progress,
            commands::sync_session,
            commands::close_session,
            commands::save_token,
            commands::open_playback_session,
            commands::play_audio,
            commands::pause_audio,
            commands::seek_audio,
            commands::set_speed,
            commands::set_volume,
            commands::get_cover,
            commands::cache_remote_image,
            commands::get_audio_devices,
            commands::set_audio_device,
            commands::delete_progress,
            commands::update_media,
            commands::update_chapters,
            // Cover management (admin/canUpload)
            commands::find_covers,
            commands::set_cover_url,
            commands::upload_cover,
            commands::remove_cover,
            commands::search_books,
            commands::search_providers,
            commands::get_cache_dir,
            commands::reveal_cache_dir,
            commands::get_downloads_dir,
            commands::reveal_downloads_dir,
            commands::set_downloads_dir,
            commands::set_cache_dir,
            commands::reveal_path,
            commands::read_skald_log,
            commands::open_log_dir,
            commands::export_text_file,
            // Library disk cache — read/write for offline launch fallback
            commands::save_library_cache,
            commands::load_library_cache,
            // Per-item chapter cache — bulk library endpoint omits chapter data;
            // this cache is written from fetchItem results while online.
            commands::save_chapter_cache,
            commands::load_chapter_cache,
            // Offline progress queue — flush queued entries to the server on reconnect
            commands::flush_offline_progress,
            // Read one entry from the queue — used to restore position on offline launch
            commands::get_offline_progress,
            // Flag a downloaded book as no longer present on the server
            commands::mark_server_deleted,
            commands::close_active_session,
            commands::close_all_open_sessions,
            commands::delete_item,
            commands::rescan_item,
            commands::get_collections,
            commands::create_collection,
            commands::add_book_to_collection,
            commands::update_collection,
            commands::remove_book_from_collection,
            commands::register_shortcuts,
            commands::login_with_api_key,
            commands::clear_stored_token,
            // Stats commands for GreetingPane
            commands::get_user_stats,
            commands::get_library_stats,
            // Downloads — Phase A/B/C: stream to disk, progress events, cancellation, registry
            commands::download_item,
            commands::get_downloads,
            commands::remove_download,
            commands::cancel_download,
            // Downloads — Phase D: offline playback via local file
            commands::play_local_file,
            // Server upload — POST /api/upload from the shelf's Upload modal
            commands::upload_media,
            commands::cancel_upload,
            commands::resolve_upload_files,
            // Local Library — Phase 1: scan a local folder into ABS-shaped items
            commands::scan_folder,
            // Local Library — Phase 2: SQLite catalog (libraries + items)
            commands::create_local_library,
            commands::get_local_libraries,
            commands::delete_local_library,
            commands::scan_local_library,
            commands::get_local_library_items,
            // Local Library — Phase 3: ingest/organize into Author/Series/Title
            commands::ingest_local_paths,
            commands::auto_ingest_staging,
            commands::set_local_library_config,
            // Local Library — Phase 4: local progress + bookmarks
            commands::get_local_progress,
            commands::get_local_library_progress,
            commands::set_local_progress,
            commands::add_local_bookmark,
            commands::get_local_bookmarks,
            commands::delete_local_bookmark,
            // Local Library — Phase 5: provider search + match flow
            commands::search_metadata,
            commands::get_unidentified_items,
            commands::apply_local_metadata,
            commands::set_local_chapters,
            commands::file_and_insert_local_match,
            commands::delete_local_item,
            // Local Library — Phase 7: staging-folder watcher
            commands::start_staging_watch,
            // Local Library — Phase 8: local cover (sidecar/embedded, resized)
            commands::get_local_cover,
            // Local Podcasts — server-free RSS subscribe / browse / download / play
            commands::get_local_podcast_feed,
            commands::subscribe_local_podcast,
            commands::get_local_podcast_items,
            commands::get_local_recent_episodes,
            commands::download_local_episode,
            commands::update_local_podcast_settings,
            commands::check_local_new_episodes,
            commands::delete_local_podcast,
            commands::search_local_podcasts,
            commands::parse_local_opml,
            commands::subscribe_local_opml,
            commands::export_local_opml,
            // Listening sessions — Settings → Playback → Sessions tab
            commands::get_listening_sessions,
            commands::delete_session,
            commands::get_open_sessions, // open sessions via GET /api/users/online → openSessions
            // Phase B: Socket.IO transport commands
            commands::connect_socket,
            commands::disconnect_socket,
            // Presence — any authenticated user; used for the admin user-list dot.
            commands::get_online_users,
            // Admin user-management commands (admin/root only — ABS enforces this)
            commands::get_all_users,
            commands::create_user,
            commands::update_user,
            commands::delete_user,
            commands::get_user,
            commands::change_password,
            commands::get_auth_settings,
            // Local stop-point log — position safety net independent of the server
            commands::record_stop_point,
            commands::get_stop_points,
            // Playlists — per-user, private (unlike collections which are library-wide)
            commands::get_playlists,
            commands::get_playlist,
            commands::create_playlist,
            commands::update_playlist,
            commands::delete_playlist,
            commands::batch_add_to_playlist,
            commands::batch_remove_from_playlist,
            commands::create_playlist_from_collection,
            // Equalizer commands
            commands::get_eq_presets,
            commands::get_eq_band_frequencies,
            commands::get_eq_settings,
            commands::set_eq_enabled,
            commands::set_eq_band,
            commands::set_eq_preamp,
            commands::apply_eq_preset,
            commands::reset_eq,
            // Library management (admin/root only — ABS enforces this server-side)
            commands::browse_server_filesystem,
            commands::get_libraries_full,
            commands::create_library,
            commands::update_library,
            commands::delete_library,
            commands::scan_library,
            // Custom metadata providers (admin)
            commands::get_custom_metadata_providers,
            commands::create_custom_metadata_provider,
            commands::delete_custom_metadata_provider,
            // Server settings (admin/root only — ABS enforces this server-side)
            commands::fetch_server_settings,
            commands::update_server_settings,
            commands::update_sorting_prefixes,
            // Notification settings (Apprise — admin/root only)
            commands::get_notifications,
            commands::update_notification_settings,
            commands::create_notification,
            commands::update_notification,
            commands::delete_notification,
            commands::test_notification,
            commands::fire_test_notification_event,
            // Backups (admin/root only)
            commands::get_backups,
            commands::create_backup,
            commands::delete_backup,
            commands::apply_backup,
            // Scheduled tasks (admin-gated in the UI)
            commands::get_tasks,
            commands::validate_cron,
            // Server logs (admin-gated in the UI)
            commands::get_logger_data,
            commands::start_log_stream,
            commands::stop_log_stream,
            // Podcasts (cluster E)
            commands::get_podcast_feed,
            commands::create_podcast,
            commands::parse_opml,
            commands::create_podcasts_from_opml,
            commands::check_new_episodes,
            commands::get_episode_downloads,
            commands::clear_episode_download_queue,
            commands::download_episodes,
            commands::find_episode,
            commands::match_episodes,
            commands::get_episode,
            commands::update_episode,
            commands::delete_episode,
            commands::get_recent_episodes,
            commands::export_opml,
            commands::create_share,
            commands::delete_share,
            commands::get_share_by_slug,
            commands::get_item_share,
            commands::get_feeds,
            commands::open_feed,
            commands::close_feed,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app_handle, event| {
            // CLAUDE.md critical lesson 4: sync-before-close to avoid losing
            // the final ~30 seconds of progress on exit.
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let mgr = Arc::clone(&session_mgr_for_exit);
                // Clone the socket Arc so the shutdown thread owns it.
                let socket = Arc::clone(&socket_state_for_exit);
                let t = std::thread::spawn(move || {
                    // Build a fresh single-thread runtime for the shutdown request
                    // so we never block the Tauri event loop indefinitely.
                    let rt = tokio::runtime::Builder::new_current_thread()
                        .enable_all()
                        .build()
                        .expect("shutdown runtime");
                    rt.block_on(async move {
                        // Ensure the socket is cleanly disconnected when the app
                        // closes — prevents orphaned server-side socket connections.
                        // disconnect() is a no-op when no socket is open.
                        socket::disconnect(socket).await;

                        // Extract data while holding the lock, then drop it
                        // before the async HTTP call (MutexGuard is not Send).
                        let (sid, ct, tl, client) = {
                            let guard = mgr.lock().await;
                            // Cancel the background tick and sync tasks before releasing
                            // the lock — prevents a racing 10-second sync from firing
                            // between the lock release and the close HTTP request below.
                            guard.cancel_tasks();

                            // ── Local playback shutdown path ───────────────────────────
                            // If the session was a local file, write the final position to
                            // the offline progress queue and return — there is no server
                            // session to close so no HTTP call is needed.
                            if guard.is_local {
                                if let Some(ref item_id) = guard.local_item_id {
                                    let pos = *guard.current_time.lock().unwrap();
                                    // Read duration directly from the player (poison-tolerant
                                    // so a panicked lock elsewhere can't abort the final write).
                                    let dur = {
                                        let p = guard.player.lock().unwrap_or_else(|e| e.into_inner());
                                        p.as_ref().map(|pl| pl.duration()).unwrap_or(0.0)
                                    };
                                    // Preserve the finished state at exit: the tick commits
                                    // current_time = duration on a true book end, so treat a
                                    // position at/after the end as finished rather than writing
                                    // false and relying on the catalog preserve rule alone.
                                    let finished = dur > 0.0 && pos + 1.0 >= dur;
                                    if guard.is_local_library {
                                        // Local-library item — final position to the catalog
                                        // (keyed per episode for podcasts).
                                        if let Err(e) = catalog::set_progress(item_id, guard.local_episode_id.as_deref(), pos, dur, finished) {
                                            log::warn!(target: "skald::library", "shutdown progress write failed: {e}");
                                        }
                                    } else if let Ok(dl_dir) = downloads::downloads_dir() {
                                        // Downloaded ABS book — offline queue (flushes later).
                                        let entry = downloads::OfflineProgressEntry {
                                            item_id: item_id.clone(),
                                            current_time: pos,
                                            duration: dur,
                                            progress: if dur > 0.0 { pos / dur } else { 0.0 },
                                            is_finished: finished,
                                            recorded_at: std::time::SystemTime::now()
                                                .duration_since(std::time::UNIX_EPOCH)
                                                .unwrap_or_default()
                                                .as_millis() as i64,
                                        };
                                        if let Err(e) = downloads::upsert_progress_entry(&dl_dir, entry) {
                                            log::warn!(target: "skald::downloads", "shutdown progress write failed: {e}");
                                        }
                                    }
                                }
                                return; // no server session — nothing more to do
                            }

                            match guard.session_id.clone() {
                                None => return,
                                Some(id) => (
                                    id,
                                    *guard.current_time.lock().unwrap(),
                                    *guard.time_listened.lock().unwrap(),
                                    guard.client.clone(),
                                ),
                            }
                        };
                        let _ = tokio::time::timeout(
                            std::time::Duration::from_secs(5),
                            client.close_session(&sid, ct, tl),
                        )
                        .await;
                    });
                });
                let _ = t.join();
            }
        });
}
