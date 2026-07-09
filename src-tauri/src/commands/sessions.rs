// Split from the original single-file commands.rs (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. Shared imports and state types
// come from the parent module (mod.rs) via the glob below.
use super::*;

#[tauri::command]
pub async fn fetch_listening_stats(
    server_url: String,
    user_id: String,
) -> Result<models::ListeningStats, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .get_listening_stats(&user_id)
        .await
}

/// Paginated listening sessions with optional server-side sorting.
/// user_id=None → all sessions (admin); "__me__" → own; id → specific user.
/// sort/desc are forwarded to ABS so it orders the full dataset, not just one page.
#[tauri::command]
pub async fn get_listening_sessions(
    server_url: String,
    user_id: Option<String>,
    page: u32,
    items_per_page: u32,
    sort: Option<String>,   // ABS sort field name — None omits the param
    desc: Option<bool>,     // true=descending, false=ascending, None=omit
) -> Result<models::ListeningSessionsResponse, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        // Convert Option<String> to Option<&str> for the AbsClient method.
        .get_listening_sessions(user_id.as_deref(), page, items_per_page, sort.as_deref(), desc)
        .await
}

/// DELETE /api/sessions/{id} — admin-only, permanently removes a session record.
/// The ABS server enforces admin access; Skald additionally hides this button
/// from non-admin users in the UI.
#[tauri::command]
pub async fn delete_session(
    server_url: String,
    session_id: String,
) -> Result<(), String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .delete_session(&session_id)
        .await
}

/// GET /api/users/online → openSessions — returns all currently active playback sessions.
/// The /api/users/online response contains both connected user records and an openSessions
/// array; this command extracts only the sessions, which is what the Settings panel needs.
#[tauri::command]
pub async fn get_open_sessions(server_url: String) -> Result<Vec<models::ListeningSession>, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .get_online_open_sessions() // distinct from get_open_sessions which returns IDs for cleanup
        .await
}

/// GET /api/me/listening-stats — returns listening stats for the authenticated user.
/// Used by GreetingPane for the "Your stats" page: total time, days listened,
/// books finished, 7-day sparkline data, and recent sessions.
#[tauri::command]
pub async fn get_user_stats(server_url: String) -> Result<models::UserStats, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url).with_token(token).get_user_stats().await
}

/// GET /api/libraries/{id}/stats — returns aggregate statistics for a library.
/// Used by GreetingPane for the "Library stats" page: duration, authors, tracks,
/// file size, and top genres.
#[tauri::command]
pub async fn get_library_stats(
    server_url: String,
    library_id: String,
) -> Result<models::LibraryStats, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .get_library_stats(&library_id)
        .await
}
