pub mod models;
pub mod api;
pub mod auth;
pub mod audio;
pub mod commands;
pub mod session;
pub mod cover_cache;

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
        .invoke_handler(tauri::generate_handler![
            commands::login,
            commands::logout,
            commands::has_token,
            commands::get_me,
            commands::fetch_libraries,
            commands::fetch_library_items,
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
            commands::close_active_session,
            commands::register_shortcuts,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app_handle, event| {
            // CLAUDE.md critical lesson 4: sync-before-close to avoid losing
            // the final ~30 seconds of progress on exit.
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let mgr = Arc::clone(&session_mgr_for_exit);
                let t = std::thread::spawn(move || {
                    // Build a fresh single-thread runtime for the shutdown request
                    // so we never block the Tauri event loop indefinitely.
                    let rt = tokio::runtime::Builder::new_current_thread()
                        .enable_all()
                        .build()
                        .expect("shutdown runtime");
                    rt.block_on(async move {
                        // Extract data while holding the lock, then drop it
                        // before the async HTTP call (MutexGuard is not Send).
                        let (sid, ct, tl, client) = {
                            let guard = mgr.lock().await;
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
