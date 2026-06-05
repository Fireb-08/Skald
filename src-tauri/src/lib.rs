pub mod models;
pub mod api;
pub mod auth;
pub mod audio;
pub mod commands;
pub mod session;
pub mod cover_cache;
pub mod socket;    // Phase B: Socket.IO transport for live sync
pub mod downloads; // Phase B: persistent registry of downloaded books

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

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
        .setup(|app| {
            // Set VLC_PLUGIN_PATH to the bundled plugins directory so LibVLC can
            // find its codecs/demuxers regardless of whether VLC is installed on
            // the target machine. Must run before the first Instance::new() call,
            // which is lazy (triggered by open_playback_session / play_local_file).
            use tauri::Manager;
            if let Ok(resource_dir) = app.path().resource_dir() {
                std::env::set_var("VLC_PLUGIN_PATH", resource_dir.join("plugins"));
            }
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
            commands::get_audio_devices,
            commands::set_audio_device,
            commands::delete_progress,
            commands::update_media,
            commands::search_books,
            commands::get_cache_dir,
            commands::reveal_cache_dir,
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
            // Local stop-point log — position safety net independent of the server
            commands::record_stop_point,
            commands::get_stop_points,
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
                                    // Read duration directly from the player.
                                    let dur = {
                                        let p = guard.player.lock().unwrap();
                                        p.as_ref().map(|pl| pl.duration()).unwrap_or(0.0)
                                    };
                                    if let Ok(dl_dir) = downloads::downloads_dir() {
                                        let entry = downloads::OfflineProgressEntry {
                                            item_id: item_id.clone(),
                                            current_time: pos,
                                            duration: dur,
                                            progress: if dur > 0.0 { pos / dur } else { 0.0 },
                                            is_finished: false,
                                            recorded_at: std::time::SystemTime::now()
                                                .duration_since(std::time::UNIX_EPOCH)
                                                .unwrap_or_default()
                                                .as_millis() as i64,
                                        };
                                        let _ = downloads::upsert_progress_entry(&dl_dir, entry);
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
