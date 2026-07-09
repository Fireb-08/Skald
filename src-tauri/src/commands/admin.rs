// Split from the original single-file commands.rs (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. Shared imports and state types
// come from the parent module (mod.rs) via the glob below.
use super::*;

/// PATCH /api/settings — update one or more server settings fields. Admin only.
/// `payload` is a sparse JSON object; ABS merges it with existing values.
#[tauri::command]
pub async fn update_server_settings(
    server_url: String,
    payload: serde_json::Value,
) -> Result<ServerSettings, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).update_server_settings(payload).await
}

/// PATCH /api/sorting-prefixes — replace the server's sorting prefix list. Admin only.
/// Triggers a full title re-index on the server, so use sparingly.
#[tauri::command]
pub async fn update_sorting_prefixes(
    server_url: String,
    prefixes: Vec<String>,
) -> Result<ServerSettings, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).update_sorting_prefixes(prefixes).await
}

/// POST /api/authorize via the stored token to refresh serverSettings on an
/// already-logged-in app launch (the login-time payload is no longer available).
/// Admin only in practice — the Server Settings panel is the sole consumer — but
/// ABS returns serverSettings to any authenticated user, so no role check here.
#[tauri::command]
pub async fn fetch_server_settings(server_url: String) -> Result<ServerSettings, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).fetch_server_settings().await
}

// ── Notification settings (Apprise) — admin only ─────────────────────────────
// ABS restricts these endpoints to admins (403 otherwise). Each command loads
// the stored token and delegates to the matching AbsClient method.

/// GET /api/notifications — fetch the current settings + event catalog.
#[tauri::command]
pub async fn get_notifications(server_url: String) -> Result<NotificationsResponse, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).get_notifications().await
}

/// PATCH /api/notifications — update global settings (appriseApiUrl, limits).
#[tauri::command]
pub async fn update_notification_settings(
    server_url: String,
    payload: serde_json::Value,
) -> Result<NotificationSettings, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).update_notification_settings(payload).await
}

/// POST /api/notifications — create a notification rule.
#[tauri::command]
pub async fn create_notification(
    server_url: String,
    payload: serde_json::Value,
) -> Result<NotificationSettings, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).create_notification(payload).await
}

/// PATCH /api/notifications/:id — update one rule.
#[tauri::command]
pub async fn update_notification(
    server_url: String,
    id: String,
    payload: serde_json::Value,
) -> Result<NotificationSettings, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).update_notification(&id, payload).await
}

/// DELETE /api/notifications/:id — delete one rule.
#[tauri::command]
pub async fn delete_notification(
    server_url: String,
    id: String,
) -> Result<NotificationSettings, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).delete_notification(&id).await
}

/// GET /api/notifications/:id/test — send a real test to one rule's URLs.
#[tauri::command]
pub async fn test_notification(server_url: String, id: String) -> Result<(), String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).test_notification(&id).await
}

/// GET /api/notifications/test — fire a synthetic onTest event end-to-end.
#[tauri::command]
pub async fn fire_test_notification_event(server_url: String) -> Result<(), String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).fire_test_event().await
}

// ── Backups (admin only) ─────────────────────────────────────────────────────
// ABS restricts these endpoints to admins (403 otherwise).

/// GET /api/backups — list backups + the backup directory location.
#[tauri::command]
pub async fn get_backups(server_url: String) -> Result<BackupsResponse, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).get_backups().await
}

/// POST /api/backups — create a backup now.
#[tauri::command]
pub async fn create_backup(server_url: String) -> Result<BackupsResponse, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).create_backup().await
}

/// DELETE /api/backups/:id — delete a backup.
#[tauri::command]
pub async fn delete_backup(server_url: String, id: String) -> Result<BackupsResponse, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).delete_backup(&id).await
}

/// GET /api/backups/:id/apply — restore from a backup (destructive; restarts ABS).
#[tauri::command]
pub async fn apply_backup(server_url: String, id: String) -> Result<(), String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).apply_backup(&id).await
}

// ── Scheduled tasks ──────────────────────────────────────────────────────────
// GET /api/tasks and POST /api/validate-cron have no server-side admin check;
// the UI gates them to admins for consistency with the other server panels.

/// GET /api/tasks — current + recently-finished background tasks.
#[tauri::command]
pub async fn get_tasks(server_url: String) -> Result<TasksResponse, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).get_tasks().await
}

/// POST /api/validate-cron — true if the cron expression is valid.
#[tauri::command]
pub async fn validate_cron(server_url: String, expression: String) -> Result<bool, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).validate_cron(&expression).await
}

// ── Server logs (admin only) ─────────────────────────────────────────────────
// get_logger_data seeds the current day's recent entries; the live tail uses the
// socket (start/stop_log_stream emit set/remove_log_listener on the live-sync
// connection). Diagnostics retained until validated, then stripped per CLAUDE.md.

/// GET /api/logger-data — the current day's recent log entries.
#[tauri::command]
pub async fn get_logger_data(server_url: String) -> Result<LoggerData, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).get_logger_data().await
}

/// Register the live-sync socket as a log listener at `level` (TRACE=0…FATAL=5).
#[tauri::command]
pub async fn start_log_stream(
    level: i32,
    socket: tauri::State<'_, socket::SocketState>,
) -> Result<(), String> {
    socket::set_log_listener(socket.inner().clone(), level).await
}

/// Stop the live log stream.
#[tauri::command]
pub async fn stop_log_stream(
    socket: tauri::State<'_, socket::SocketState>,
) -> Result<(), String> {
    socket::remove_log_listener(socket.inner().clone()).await
}

// ── Library management commands (admin only) ─────────────────────────────────
// All five commands require an admin or root token. ABS enforces this server-side
// and returns HTTP 403 for unauthorized callers.

/// Lists subdirectories on the ABS server at `path` (admin only).
/// Returns the directory listing so the frontend can build a server-side folder picker.
#[tauri::command]
pub async fn browse_server_filesystem(
    server_url: String,
    path: String,
) -> Result<models::FsDirectory, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url).with_token(token).get_filesystem(&path).await
}

/// Returns all libraries with the full expanded shape (folders, settings, timestamps).
/// Functionally identical to fetch_libraries now that Library carries all fields,
/// but exposed under a distinct command name so the LibrariesSection can call it
/// without aliasing concerns in the frontend.
#[tauri::command]
pub async fn get_libraries_full(server_url: String) -> Result<Vec<models::Library>, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url).with_token(token).get_libraries().await
}

/// Creates a new library on the server and returns the created Library.
#[tauri::command]
pub async fn create_library(
    server_url: String,
    name: String,
    media_type: String,
    folders: Vec<models::FolderInput>,
    icon: Option<String>,
    provider: Option<String>,
    settings: Option<models::LibrarySettings>,
) -> Result<models::Library, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    let payload = models::CreateLibraryPayload { name, media_type, folders, icon, provider, settings };
    AbsClient::new(server_url).with_token(token).create_library(&payload).await
}

/// Partially updates a library. Only fields set in the payload are sent to the server.
#[tauri::command]
pub async fn update_library(
    server_url: String,
    library_id: String,
    payload: models::UpdateLibraryPayload,
) -> Result<models::Library, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url).with_token(token).update_library(&library_id, &payload).await
}

/// Permanently deletes a library and all its items.
#[tauri::command]
pub async fn delete_library(
    server_url: String,
    library_id: String,
) -> Result<(), String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url).with_token(token).delete_library(&library_id).await
}

/// Triggers a server-side library scan. `force=true` requests a full rescan;
/// `force=false` runs an incremental scan. The server runs asynchronously.
#[tauri::command]
pub async fn scan_library(
    server_url: String,
    library_id: String,
    force: bool,
) -> Result<(), String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url).with_token(token).scan_library(&library_id, force).await
}

// ── Custom metadata providers (admin) ────────────────────────────────────────

/// GET /api/custom-metadata-providers — list custom providers.
#[tauri::command]
pub async fn get_custom_metadata_providers(server_url: String) -> Result<Vec<CustomMetadataProvider>, String> {
    let token = auth::load_token()?.ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).get_custom_metadata_providers().await
}

/// POST /api/custom-metadata-providers — register a custom provider.
#[tauri::command]
pub async fn create_custom_metadata_provider(
    server_url: String,
    payload: serde_json::Value,
) -> Result<CustomMetadataProvider, String> {
    let token = auth::load_token()?.ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).create_custom_metadata_provider(payload).await
}

/// DELETE /api/custom-metadata-providers/:id — remove a custom provider.
#[tauri::command]
pub async fn delete_custom_metadata_provider(server_url: String, id: String) -> Result<(), String> {
    let token = auth::load_token()?.ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).delete_custom_metadata_provider(&id).await
}
