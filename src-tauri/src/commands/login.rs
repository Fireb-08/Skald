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
    // The "this server has no refresh route" flag describes whichever server was
    // signed in before; this may be a different one.
    crate::token_refresh::reset_for_new_session();

    let abs_client = AbsClient::new(server_url.clone());
    let outcome = abs_client.login(&username, &password).await?;
    let mut user = outcome.user;
    let tokens = outcome.tokens;

    let token = tokens
        .effective()
        .ok_or_else(|| "ABS server did not return a session token".to_string())?
        .to_string();

    // /login already carries serverSettings (ABS builds the body from
    // getUserLoginResponsePayload), so authorize is only a fallback for servers
    // that omit it. It is *not* a token source: MiscController.authorize returns
    // the same payload with no accessToken attached, so the old
    // `auth_json["accessToken"]` fallback here never once fired. The real access
    // JWT now comes from /login itself via x-return-tokens.
    // Note: /api/authorize is a POST route in ABS — a GET request returns 404.
    let resolved_settings = match outcome.server_settings {
        Some(settings) => Some(settings),
        None => {
            let server_root = server_url.trim_end_matches('/');
            let auth_json = crate::api::bounded_client()
                .post(format!("{server_root}/api/authorize"))
                .header("Authorization", format!("Bearer {token}"))
                .send()
                .await
                .map_err(|e| format!("Authorize failed: {e}"))?
                .json::<serde_json::Value>()
                .await
                .unwrap_or(serde_json::Value::Null);
            auth_json
                .get("serverSettings")
                .and_then(|raw| serde_json::from_value::<ServerSettings>(raw.clone()).ok())
        }
    };

    // Persist the whole set, not just the bearer token — dropping the refresh
    // token here would leave the session unable to survive its first hour.
    auth::save_tokens(&tokens)?;
    log::info!(
        target: "skald::auth",
        "password sign-in succeeded (credential kind: {}, refreshable: {})",
        tokens.kind(),
        tokens.can_refresh()
    );
    if tokens.is_legacy() {
        log::warn!(
            target: "skald::auth",
            "server issued no access token — falling back to the legacy non-expiring token; \
             refresh is unavailable until the server is upgraded to 2.26+"
        );
    }

    user.token = token;
    Ok(LoginResult { user, server_settings: resolved_settings })
}

#[tauri::command]
pub fn logout() -> Result<(), String> {
    crate::token_refresh::reset_for_new_session();
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
    AbsClient::authenticated(server_url).await?.get_me().await
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

    // Guard against an empty session token. Without this, an empty string would be
    // returned to the frontend, saved into the keyring and React auth state, and
    // leave the app in an authenticated-but-broken state (every API call 401s) that
    // only a manual token clear escapes. The password path filters empty tokens the
    // same way; mirror that here. (See bug B1 — missing empty-token guard.)
    if token.is_empty() {
        return Err("ABS server did not return a session token in /api/me".to_string());
    }

    // Deserialize User fields — extra fields (mediaProgress, bookmarks, etc.)
    // are silently ignored by serde.
    let user: models::User = serde_json::from_value(body_json)
        .map_err(|e| format!("Failed to parse user: {e}"))?;

    // API keys authenticate on their own path (TokenManager.validateApiKey) and
    // have no refresh route, so this session is legacy by construction — it never
    // expires and never rotates. Callers persist it via the save_token command,
    // which stores it as a legacy token.
    log::info!(
        target: "skald::auth",
        "api-key sign-in succeeded (credential kind: legacy, refreshable: false)"
    );

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
