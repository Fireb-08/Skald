// Split from the original single-file commands.rs (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. Shared imports and state types
// come from the parent module (mod.rs) via the glob below.
use super::*;


/// Return type bundles the authenticated User with the ServerSettings that ABS
/// includes in the login response — capturing them here avoids a separate fetch.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginResult {
    pub user: models::User,
    pub server_settings: Option<ServerSettings>,
}

#[tauri::command]
pub async fn login(
    server_url: String,
    username: String,
    password: String,
) -> Result<LoginResult, String> {
    let abs_client = AbsClient::new(server_url.clone());
    let (mut user, server_settings) = abs_client.login(&username, &password).await?;
    let legacy_token = user.token.clone();

    // After /login, call POST /api/authorize with the legacy token to obtain a
    // proper JWT access token (with exp field) that the socket validator accepts.
    // The legacy token from /login works for HTTP Bearer auth but is rejected by
    // the ABS socket middleware which expects a signed JWT.
    // Note: /api/authorize is a POST route in ABS — a GET request returns 404.
    let http = crate::api::bounded_client();
    let server_root = server_url.trim_end_matches('/');
    let auth_resp = http
        .post(format!("{server_root}/api/authorize"))
        .header("Authorization", format!("Bearer {legacy_token}"))
        .send()
        .await
        .map_err(|e| format!("Authorize failed: {e}"))?;

    // Parse as generic JSON — avoid hard struct failures if the response shape
    // differs between ABS versions. Null signals a parse problem.
    let auth_json: serde_json::Value = auth_resp
        .json::<serde_json::Value>()
        .await
        .unwrap_or(serde_json::Value::Null);

    // Prefer the top-level accessToken (JWT with exp). Fall back to
    // user.token inside the authorize response, then the legacy token.
    let token = auth_json["accessToken"]
        .as_str()
        .filter(|t| !t.is_empty())
        .or_else(|| auth_json["user"]["token"].as_str().filter(|t| !t.is_empty()))
        .unwrap_or(&legacy_token)
        .to_string();

    // If /login didn't include serverSettings, try extracting it from the
    // authorize response (ABS may return it there instead).
    let resolved_settings = server_settings.or_else(|| {
        let raw = auth_json.get("serverSettings")?;
        serde_json::from_value::<ServerSettings>(raw.clone()).ok()
    });

    auth::save_token(&token)?;
    user.token = token;
    Ok(LoginResult { user, server_settings: resolved_settings })
}

#[tauri::command]
pub fn logout() -> Result<(), String> {
    auth::clear_token()
}

#[tauri::command]
pub fn has_token() -> Result<bool, String> {
    Ok(auth::load_token()?.is_some())
}

#[tauri::command]
pub fn save_token(token: String) -> Result<(), String> {
    auth::save_token(&token)
}

#[tauri::command]
pub async fn get_me(server_url: String) -> Result<models::MeResponse, String> {
    let token = auth::load_token()?
        .ok_or_else(|| "Not authenticated: no token stored".to_string())?;
    AbsClient::new(server_url).with_token(token).get_me().await
}

/// Return type for login_with_api_key — carries both the user profile and the
/// user session JWT extracted from the /api/me response. The frontend uses the
/// JWT for both HTTP Bearer auth and socket authentication; the raw API key is
/// not stored after login.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyLoginResult {
    pub user: models::User,
    pub token: String,
    pub server_settings: Option<ServerSettings>,
}

/// Validates an API key by calling GET /api/me with the key as Bearer token.
/// Returns both the user profile and the session JWT extracted from the response.
/// The API key is only used once to obtain the JWT; callers store the JWT.
#[tauri::command]
pub async fn login_with_api_key(
    server_url: String,
    api_key: String,
) -> Result<ApiKeyLoginResult, String> {
    let client = crate::api::bounded_client();
    let response = client
        .get(format!("{}/api/me", server_url.trim_end_matches('/')))
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| format!("Connection failed: {e}"))?;

    // Capture status before consuming the body — status() borrows the response
    // but text()/json() consume it, so we must copy the value first.
    let status = response.status();

    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Invalid API key — server returned {status}: {body}"));
    }

    // Parse as generic JSON so we can extract token and user fields separately.
    let body_text = response.text().await.unwrap_or_default();
    let body_json: serde_json::Value = serde_json::from_str(&body_text)
        .map_err(|e| format!("Failed to parse response: {e}"))?;

    // Extract the user session JWT from the token field — socket auth needs
    // this JWT, not the raw API key the user entered.
    let token = body_json["token"]
        .as_str()
        .unwrap_or("")
        .to_string();

    // Deserialize User fields — extra fields (mediaProgress, bookmarks, etc.)
    // are silently ignored by serde.
    let user: models::User = serde_json::from_value(body_json)
        .map_err(|e| format!("Failed to parse user: {e}"))?;

    // /api/me does not include serverSettings. Call POST /api/authorize with the
    // resolved token to retrieve them (same endpoint used by the password login path).
    let server_settings: Option<ServerSettings> = {
        let auth_resp = crate::api::bounded_client()
            .post(format!("{}/api/authorize", server_url.trim_end_matches('/')))
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .await;
        match auth_resp {
            Ok(r) if r.status().is_success() => {
                let auth_json: serde_json::Value = r.json().await.unwrap_or(serde_json::Value::Null);
                auth_json.get("serverSettings")
                    .and_then(|ss| serde_json::from_value::<ServerSettings>(ss.clone()).ok())
            }
            _ => None,
        }
    };

    Ok(ApiKeyLoginResult { user, token, server_settings })
}

/// Clears the stored keyring token so the next launch forces a fresh login.
/// Intended for one-time use from devtools when the stored token is stale.
#[tauri::command]
pub fn clear_stored_token() -> Result<(), String> {
    auth::clear_token()
}
