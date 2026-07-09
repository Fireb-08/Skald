// Split from the original single-file api.rs (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. AbsClient, its private root()/
// auth_header() helpers, and shared imports come from the parent (mod.rs).
use super::*;

impl AbsClient {
    /// POST /login — at the server root, not under /api/ (see CLAUDE.md critical lesson 1).
    /// Returns (User, Option<ServerSettings>) — serverSettings may be absent on older ABS versions.
    pub async fn login(&self, username: &str, password: &str) -> Result<(User, Option<ServerSettings>), String> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct LoginResponse {
            user: User,
            #[serde(default)]
            server_settings: Option<ServerSettings>,
        }

        let resp = self
            .http
            .post(format!("{}/login", self.root()))
            .json(&serde_json::json!({ "username": username, "password": password }))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("login failed: HTTP {}", resp.status()));
        }

        let body: LoginResponse = resp.json().await.map_err(|e| e.to_string())?;
        Ok((body.user, body.server_settings))
    }

    /// GET /api/me
    pub async fn get_me(&self) -> Result<MeResponse, String> {
        let resp = self
            .http
            .get(format!("{}/api/me", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

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
            .send()
            .await
            .map_err(|e| e.to_string())?;

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
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("get_auth_settings failed: HTTP {}", resp.status()));
        }

        resp.json().await.map_err(|e| e.to_string())
    }
}
