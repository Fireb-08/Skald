// Split from the original single-file commands.rs (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. Shared imports and state types
// come from the parent module (mod.rs) via the glob below.
use super::*;

#[derive(serde::Deserialize)]
pub struct ShortcutBinding {
    pub action: String,
    pub shortcut: String,
}

// register_shortcuts can be invoked twice near-simultaneously (React StrictMode
// double-mounts useGlobalShortcuts in dev) and sync commands run on a thread
// pool, so two calls interleave their unregister_all/register pairs — the loser
// hits "HotKey already registered" and can leave the action map half-built.
// Serializing the whole unregister→register swap makes the command idempotent
// for any caller timing.
static REGISTER_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[tauri::command]
pub fn register_shortcuts(
    bindings: Vec<ShortcutBinding>,
    app: tauri::AppHandle,
    action_map: tauri::State<'_, ShortcutActionMap>,
) -> Result<(), String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

    // Poison-tolerant: a panic in a previous call must not wedge shortcuts.
    let _serialized = REGISTER_LOCK.lock().unwrap_or_else(|e| e.into_inner());

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
/// The session JWT is loaded from the OS keyring here rather than passed in —
/// the frontend holds only an auth-presence flag, never the token value.
#[tauri::command]
pub async fn connect_socket(
    server_url: String,
    app: tauri::AppHandle,
    socket: tauri::State<'_, socket::SocketState>,
) -> Result<(), String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    socket::connect(server_url, token, app, socket.inner().clone()).await
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

/// Open an arbitrary local folder in the OS file explorer. Used by the Local
/// Library path buttons; mirrors reveal_cache_dir but takes a caller-supplied path.
#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("path does not exist: {path}"));
    }
    // Directories only (review H4): `explorer <path>` on a FILE launches it via
    // its default handler, which would let a compromised renderer execute an
    // arbitrary local file through this command. Every caller reveals a folder
    // (staging, cache, library root); a future file-reveal must use
    // `explorer /select,<file>` rather than lifting this check.
    if !p.is_dir() {
        return Err(format!("not a folder: {path}"));
    }
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

/// Open a save dialog and write `contents` to the chosen path — used by the
/// About tab to export the third-party notices / diagnostic report. The dialog
/// runs HERE, on the Rust side, so the renderer never supplies a filesystem
/// path: the old split (frontend dialog → write_text_file(path, contents))
/// handed any compromised WebView script an arbitrary-file-write primitive.
/// Returns false when the user cancels the dialog.
#[tauri::command]
pub async fn export_text_file(
    app: tauri::AppHandle,
    default_name: String,
    contents: String,
) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("Text", &["txt"])
        .save_file(move |path| { let _ = tx.send(path); });
    let picked = rx.await.map_err(|e| format!("save dialog failed: {e}"))?;
    let Some(file_path) = picked else { return Ok(false) }; // user cancelled
    let path = file_path
        .into_path()
        .map_err(|e| format!("save path unavailable: {e}"))?;
    std::fs::write(&path, contents).map_err(|e| format!("write failed: {e}"))?;
    Ok(true)
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
