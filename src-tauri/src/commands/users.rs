// Split from the original single-file commands.rs (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. Shared imports and state types
// come from the parent module (mod.rs) via the glob below.
use super::*;

/// GET /api/users/online — returns the IDs of users currently connected via WebSocket.
/// Used to drive the presence dot on each user row in the admin account panel.
/// Any authenticated user can call this; the ABS server does not restrict it to admins.
#[tauri::command]
pub async fn get_online_users(server_url: String) -> Result<Vec<String>, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url).with_token(token).get_online_users().await
}

/// GET /api/users — returns every user account on the server.
/// Admin and root accounts only; the ABS server returns 403 for others.
#[tauri::command]
pub async fn get_all_users(server_url: String) -> Result<Vec<models::AdminUser>, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url).with_token(token).get_all_users().await
}

/// POST /api/users — creates a new user account on the server.
/// `user_type` must be "user" or "admin"; "root" cannot be created via API.
#[tauri::command]
pub async fn create_user(
    server_url: String,
    username: String,
    password: String,
    user_type: String,
    // Admin user-management extras: optional email, the enable flag, and a full
    // permissions blob (download/update/…, library + tag access). None/absent
    // permissions lets the server apply its defaults.
    email: Option<String>,
    is_active: Option<bool>,
    permissions: Option<serde_json::Value>,
) -> Result<models::AdminUser, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .create_user(
            &username,
            &password,
            &user_type,
            email.as_deref(),
            is_active.unwrap_or(true),
            permissions,
        )
        .await
}

/// PATCH /api/users/{id} — partially updates a user account.
/// Any `None` field is omitted from the request body so the server keeps the
/// existing value. An empty string `password` is converted to `None` here so
/// that leaving the password field blank in the UI does not overwrite it.
// Flat args are the frontend invoke() payload keys one-to-one — the IPC
// contract. Bundling them into a struct would nest the payload; not worth it.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn update_user(
    server_url: String,
    user_id: String,
    username: Option<String>,
    password: Option<String>,
    user_type: Option<String>,
    // Optional email + enable flag (admin user-management); None leaves each unchanged.
    email: Option<String>,
    is_active: Option<bool>,
    // cluster H: optional permissions blob (carries librariesAccessible /
    // itemTagsSelected nested); None leaves access control untouched.
    permissions: Option<serde_json::Value>,
) -> Result<models::AdminUser, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    // Treat an empty password string the same as None so the server keeps the
    // existing hash rather than overwriting it with an empty password.
    let pw = password.as_deref().filter(|s| !s.is_empty());
    AbsClient::new(server_url)
        .with_token(token)
        .update_user(
            &user_id,
            crate::api::UserPatch {
                username: username.as_deref(),
                password: pw,
                user_type: user_type.as_deref(),
                email: email.as_deref(),
                is_active,
                permissions,
            },
        )
        .await
}

/// DELETE /api/users/{id} — permanently removes a user account from the server.
/// The UI prevents deletion of the currently logged-in user's own row, but
/// the server would reject self-deletion anyway.
#[tauri::command]
pub async fn delete_user(server_url: String, user_id: String) -> Result<(), String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url)
        .with_token(token)
        .delete_user(&user_id)
        .await
}

// ── Auth & user access (cluster H) ───────────────────────────────────────────

/// GET /api/users/:id — fetch one user with the full permissions object.
#[tauri::command]
pub async fn get_user(server_url: String, user_id: String) -> Result<models::AdminUser, String> {
    let token = auth::load_token()?.ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).get_user(&user_id).await
}

/// PATCH /api/me/password — self-service password change ({ password, newPassword }).
#[tauri::command]
pub async fn change_password(server_url: String, current: String, new_password: String) -> Result<(), String> {
    let token = auth::load_token()?.ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).change_password(&current, &new_password).await
}

/// GET /api/auth-settings — admin-only; read-only check of whether OIDC is enabled.
#[tauri::command]
pub async fn get_auth_settings(server_url: String) -> Result<models::AuthSettings, String> {
    let token = auth::load_token()?.ok_or_else(|| "Not authenticated".to_string())?;
    AbsClient::new(server_url).with_token(token).get_auth_settings().await
}
