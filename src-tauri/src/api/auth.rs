// Split from the original single-file api.rs (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. AbsClient, its private root()/
// auth_header() helpers, and shared imports come from the parent (mod.rs).
use super::*;

/// Why a `/auth/refresh` call did not yield a new token pair.
///
/// Typed rather than a formatted string because the caller's response differs
/// sharply by case — a 401 signs the user out, a 404 latches legacy mode, and
/// anything else must be treated as transient. Matching on `HTTP 401` inside a
/// message would let a server's *error text* trigger a sign-out.
#[derive(Debug)]
pub enum RefreshError {
    /// The server answered, with a non-success status and (usually) a reason.
    Status {
        status: reqwest::StatusCode,
        detail: String,
    },
    /// The request never completed — DNS, TLS, timeout, connection refused.
    Transport(String),
    /// The server answered 200 but the body was not a login payload.
    Decode(String),
}

impl RefreshError {
    /// The route does not exist: the server predates ABS 2.26.
    pub fn is_route_missing(&self) -> bool {
        matches!(self, Self::Status { status, .. } if *status == reqwest::StatusCode::NOT_FOUND)
    }

    /// The refresh token itself was rejected — spent, expired, revoked, or the
    /// user was deactivated. The session cannot be recovered without a re-login.
    pub fn is_credential_rejected(&self) -> bool {
        matches!(
            self,
            Self::Status { status, .. }
                if *status == reqwest::StatusCode::UNAUTHORIZED
                    || *status == reqwest::StatusCode::FORBIDDEN
        )
    }
}

impl std::fmt::Display for RefreshError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Status { status, detail } if detail.is_empty() => write!(f, "HTTP {status}"),
            Self::Status { status, detail } => write!(f, "HTTP {status} — {detail}"),
            Self::Transport(e) => write!(f, "request failed: {e}"),
            Self::Decode(e) => write!(f, "unreadable refresh response: {e}"),
        }
    }
}

/// Everything a successful `/login` (or `/auth/refresh`) hands back. The two
/// endpoints return the identical payload shape — ABS builds both from
/// `getUserLoginResponsePayload` — so one parser and one outcome type serve both.
pub struct LoginOutcome {
    pub user: User,
    pub server_settings: Option<ServerSettings>,
    pub tokens: crate::auth::AuthTokens,
}

/// The `user` object of a login/refresh payload: the profile fields Skald models
/// plus the two token fields ABS attaches to it after authentication. Both tokens
/// live *under* `user`, not at the top level (verified against `Auth.js`
/// `handleLoginSuccess`).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthedUser {
    #[serde(flatten)]
    profile: User,
    #[serde(default)]
    access_token: Option<String>,
    #[serde(default)]
    refresh_token: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthPayload {
    user: AuthedUser,
    #[serde(default)]
    server_settings: Option<ServerSettings>,
}

impl AuthPayload {
    fn into_outcome(self) -> LoginOutcome {
        let nonempty = |t: Option<String>| t.filter(|s| !s.is_empty());
        let tokens = crate::auth::AuthTokens {
            access: nonempty(self.user.access_token),
            refresh: nonempty(self.user.refresh_token),
            legacy: nonempty(Some(self.user.profile.token.clone())),
        };
        LoginOutcome {
            user: self.user.profile,
            server_settings: self.server_settings,
            tokens,
        }
    }
}

impl AbsClient {
    /// POST /login — at the server root, not under /api/ (see CLAUDE.md critical lesson 1).
    ///
    /// Sends `x-return-tokens: true`, which is what makes ABS 2.26+ put the
    /// refresh token in the response body instead of an httpOnly cookie we can
    /// never read. The header must be exactly the string "true" — the server
    /// compares it literally. Older servers ignore it and return only the legacy
    /// `user.token`, which is how `AuthTokens::is_legacy` detects them.
    pub async fn login(&self, username: &str, password: &str) -> Result<LoginOutcome, String> {
        let resp = self
            .http
            .post(format!("{}/login", self.root()))
            .header("x-return-tokens", "true")
            .json(&serde_json::json!({ "username": username, "password": password }))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("login failed: HTTP {}", resp.status()));
        }

        let body: AuthPayload = resp.json().await.map_err(|e| e.to_string())?;
        Ok(body.into_outcome())
    }

    /// POST /auth/refresh — exchanges a refresh token for a fresh pair.
    ///
    /// Lives at the server root next to `/login`, not under `/api/`, and takes no
    /// `Authorization` header: the refresh token *is* the credential. Passing it
    /// via `x-refresh-token` (rather than the `refresh_token` cookie) is also what
    /// makes ABS return the **rotated** refresh token in the body — with the
    /// cookie form it would only be re-set as a cookie.
    ///
    /// A 404 means the server predates 2.26 and has no refresh route; callers use
    /// that to stop trying. A 401 means the refresh token is spent, expired, or
    /// revoked, and the session is over.
    pub async fn refresh_tokens(&self, refresh_token: &str) -> Result<LoginOutcome, RefreshError> {
        let resp = self
            .http
            .post(format!("{}/auth/refresh", self.root()))
            .header("x-refresh-token", refresh_token)
            .send()
            .await
            .map_err(|e| RefreshError::Transport(e.to_string()))?;

        let status = resp.status();
        if !status.is_success() {
            // The server puts a reason in `{ "error": "..." }`; surfacing it makes
            // "spent token" distinguishable from "user deactivated" in the log.
            let detail = resp
                .json::<serde_json::Value>()
                .await
                .ok()
                .and_then(|b| b.get("error")?.as_str().map(str::to_string))
                .unwrap_or_default();
            return Err(RefreshError::Status { status, detail });
        }

        let body: AuthPayload = resp
            .json()
            .await
            .map_err(|e| RefreshError::Decode(e.to_string()))?;
        Ok(body.into_outcome())
    }

    /// GET /api/me
    pub async fn get_me(&self) -> Result<MeResponse, String> {
        let resp = self
            .http
            .get(format!("{}/api/me", self.root()))
            .header("Authorization", self.auth_header()?)
            .send_refreshing(self)
            .await?;

        if !resp.status().is_success() {
            return Err(format!("get_me failed: HTTP {}", resp.status()));
        }

        resp.json().await.map_err(|e| e.to_string())
    }

    /// PATCH /api/me/password — self-service password change. Body verified against
    /// MeController.updatePassword: `{ password, newPassword }`. Returns 200 with no
    /// body; guests get 403, bad input 400 (with the server's message surfaced).
    pub async fn change_password(&self, current: &str, new_password: &str) -> Result<(), String> {
        let resp = self
            .http
            .patch(format!("{}/api/me/password", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&serde_json::json!({ "password": current, "newPassword": new_password }))
            .send_refreshing(self)
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("change_password failed: HTTP {status} — {body}"));
        }
        Ok(())
    }

    /// GET /api/auth-settings — admin-only auth configuration. Used read-only to
    /// tell whether OIDC/SSO is enabled (`auth_active_auth_methods` contains "openid").
    pub async fn get_auth_settings(&self) -> Result<AuthSettings, String> {
        let resp = self
            .http
            .get(format!("{}/api/auth-settings", self.root()))
            .header("Authorization", self.auth_header()?)
            .send_refreshing(self)
            .await?;

        if !resp.status().is_success() {
            return Err(format!("get_auth_settings failed: HTTP {}", resp.status()));
        }

        resp.json().await.map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The `user` object as ABS builds it, minus the fields Skald ignores.
    fn user_json(extra: serde_json::Value) -> serde_json::Value {
        let mut base = serde_json::json!({
            "id": "u1",
            "username": "listener",
            "type": "user",
            "isActive": true,
            "email": null,
        });
        let (base_map, extra_map) = (base.as_object_mut().unwrap(), extra.as_object().unwrap());
        for (k, v) in extra_map {
            base_map.insert(k.clone(), v.clone());
        }
        base
    }

    fn parse(user: serde_json::Value) -> LoginOutcome {
        serde_json::from_value::<AuthPayload>(serde_json::json!({ "user": user }))
            .expect("payload should parse")
            .into_outcome()
    }

    #[test]
    fn auth_payload_captures_the_token_pair_from_the_user_object() {
        // ABS 2.26+ with x-return-tokens: both new tokens hang off `user`, and
        // the legacy `token` field is still emitted alongside them.
        let outcome = parse(user_json(serde_json::json!({
            "token": "legacy-tok",
            "accessToken": "access-tok",
            "refreshToken": "refresh-tok",
        })));

        assert_eq!(outcome.tokens.access.as_deref(), Some("access-tok"));
        assert_eq!(outcome.tokens.refresh.as_deref(), Some("refresh-tok"));
        assert_eq!(outcome.tokens.legacy.as_deref(), Some("legacy-tok"));
        assert_eq!(outcome.tokens.effective(), Some("access-tok"));
        assert!(!outcome.tokens.is_legacy());
        assert_eq!(outcome.user.id, "u1");
    }

    #[test]
    fn auth_payload_without_access_token_is_a_legacy_session() {
        // A pre-2.26 server ignores x-return-tokens and sends only the old token.
        let outcome = parse(user_json(serde_json::json!({ "token": "legacy-tok" })));

        assert!(outcome.tokens.is_legacy());
        assert!(!outcome.tokens.can_refresh());
        assert_eq!(outcome.tokens.effective(), Some("legacy-tok"));
    }

    #[test]
    fn auth_payload_tolerates_a_null_legacy_token() {
        // Accounts created after the migration have no old token. A bare String
        // field would fail the whole parse and lock those users out entirely.
        let outcome = parse(user_json(serde_json::json!({
            "token": null,
            "accessToken": "access-tok",
            "refreshToken": "refresh-tok",
        })));

        assert_eq!(outcome.user.token, "");
        assert_eq!(outcome.tokens.legacy, None);
        assert_eq!(outcome.tokens.effective(), Some("access-tok"));
    }

    #[test]
    fn refresh_only_payload_omits_the_refresh_token_when_the_cookie_form_was_used() {
        // Without x-refresh-token the server nulls refreshToken in the body and
        // sets a cookie instead. Capture that as "no refresh token" rather than
        // an empty string that would later be sent as a credential.
        let outcome = parse(user_json(serde_json::json!({
            "token": "legacy-tok",
            "accessToken": "access-tok",
            "refreshToken": null,
        })));

        assert_eq!(outcome.tokens.refresh, None);
        assert!(!outcome.tokens.can_refresh());
        assert_eq!(outcome.tokens.kind(), "access-only");
    }
}
