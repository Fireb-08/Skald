// Split from the original single-file api.rs (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. AbsClient, its private root()/
// auth_header() helpers, and shared imports come from the parent (mod.rs).
use super::*;

impl AbsClient {
    // ── Admin user-management endpoints ─────────────────────────────────────
    // All four endpoints require an admin or root token; calling them as a
    // regular user will return HTTP 403 from the ABS server.

    /// GET /api/users — returns every account on the server.
    /// Response shape: { "users": [...] }  (confirmed in UserController.js).
    pub async fn get_all_users(&self) -> Result<Vec<AdminUser>, String> {
        // Local wrapper so we don't need to export this intermediary shape.
        #[derive(serde::Deserialize)]
        struct Wrapper { users: Vec<AdminUser> }

        let resp = self
            .http
            .get(format!("{}/api/users", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("get_all_users failed: HTTP {}", resp.status()));
        }

        let body: Wrapper = resp.json().await.map_err(|e| e.to_string())?;
        Ok(body.users)
    }

    /// POST /api/users — creates a new user account.
    /// Body: { "username", "password", "type" }
    /// ABS wraps the created user in an envelope: { "user": { ... } }
    pub async fn create_user(
        &self,
        username: &str,
        password: &str,
        user_type: &str,
        email: Option<&str>,
        is_active: bool,
        // Full permissions blob (carries librariesAccessible/itemTagsSelected
        // nested); None lets the server apply its defaults.
        permissions: Option<serde_json::Value>,
    ) -> Result<AdminUser, String> {
        // Wrapper to match the ABS response envelope: { "user": { ... } }
        #[derive(serde::Deserialize)]
        struct CreateUserResponse { user: AdminUser }

        // Build the body so optional fields are only sent when provided.
        let mut body = serde_json::Map::new();
        body.insert("username".into(), username.into());
        body.insert("password".into(), password.into());
        // The ABS field name is "type"; do not rename.
        body.insert("type".into(), user_type.into());
        body.insert("isActive".into(), is_active.into());
        if let Some(e) = email.filter(|s| !s.is_empty()) {
            body.insert("email".into(), e.into());
        }
        if let Some(p) = permissions {
            // ABS stores librariesAccessible/itemTagsSelected as TOP-LEVEL user
            // keys (not inside permissions); mirror update_user by lifting them out
            // so access control applies on create regardless of how the server
            // reads the body. They stay in `permissions` too for completeness.
            if let Some(libs) = p.get("librariesAccessible").cloned() {
                body.insert("librariesAccessible".into(), libs);
            }
            if let Some(tags) = p.get("itemTagsSelected").cloned() {
                body.insert("itemTagsSelected".into(), tags);
            }
            body.insert("permissions".into(), p);
        }

        let resp = self
            .http
            .post(format!("{}/api/users", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("create_user failed: HTTP {}", resp.status()));
        }

        let envelope: CreateUserResponse = resp.json().await.map_err(|e| e.to_string())?;
        Ok(envelope.user)
    }

    /// PATCH /api/users/{id} — partially updates a user account.
    /// Only fields that are `Some` are included in the request body, so callers
    /// can change a single field without overwriting the others.
    /// ABS returns the updated user object directly (not wrapped).
    pub async fn update_user(
        &self,
        user_id: &str,
        patch: UserPatch<'_>,
    ) -> Result<AdminUser, String> {
        let UserPatch { username, password, user_type, email, is_active, permissions } = patch;
        // Build a sparse JSON body with only the fields that were provided.
        let mut body = serde_json::Map::new();
        if let Some(u) = username  { body.insert("username".into(), u.into()); }
        if let Some(p) = password  { body.insert("password".into(), p.into()); }
        if let Some(t) = user_type { body.insert("type".into(), t.into()); }
        if let Some(e) = email     { body.insert("email".into(), e.into()); }
        if let Some(a) = is_active { body.insert("isActive".into(), a.into()); }
        // The permissions blob carries librariesAccessible/itemTagsSelected nested;
        // the ABS PATCH handler extracts them either nested or top-level.
        if let Some(p) = permissions { body.insert("permissions".into(), p); }

        let resp = self
            .http
            .patch(format!("{}/api/users/{user_id}", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("update_user failed: HTTP {status} — {body}"));
        }

        // PATCH /api/users/:id responds with an envelope `{ success, user }` —
        // unlike findOne, which returns the user directly. Unwrap it.
        #[derive(serde::Deserialize)]
        struct UpdateUserResponse { user: AdminUser }
        let body: UpdateUserResponse = resp.json().await.map_err(|e| e.to_string())?;
        Ok(body.user)
    }

    /// GET /api/users/online — returns the IDs of users currently connected via WebSocket.
    /// ABS wraps the list in { "usersOnline": [{ "id": "...", ... }] }.
    /// Only the IDs are extracted; the caller decides what to do with them.
    pub async fn get_online_users(&self) -> Result<Vec<String>, String> {
        // Minimal shape — only `id` is needed from each online-user object.
        #[derive(serde::Deserialize)]
        struct OnlineUser { id: String }
        // `usersOnline` in JSON → `users_online` in Rust via camelCase rename.
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Wrapper { users_online: Vec<OnlineUser> }

        let resp = self
            .http
            .get(format!("{}/api/users/online", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("get_online_users failed: HTTP {}", resp.status()));
        }

        let body: Wrapper = resp.json().await.map_err(|e| e.to_string())?;
        Ok(body.users_online.into_iter().map(|u| u.id).collect())
    }

    /// DELETE /api/users/{id} — permanently removes a user account from the server.
    /// ABS returns HTTP 200 with no body on success.
    pub async fn delete_user(&self, user_id: &str) -> Result<(), String> {
        let resp = self
            .http
            .delete(format!("{}/api/users/{user_id}", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("delete_user failed: HTTP {}", resp.status()));
        }

        Ok(())
    }

    // ── Auth & user access (cluster H) ───────────────────────────────────────

    /// GET /api/users/:id — fetch one user with the full `permissions` object plus
    /// the top-level `librariesAccessible`/`itemTagsSelected`. Admin-gated. The
    /// list endpoint may omit permissions, so the editor fetches the full user.
    pub async fn get_user(&self, user_id: &str) -> Result<AdminUser, String> {
        let resp = self
            .http
            .get(format!("{}/api/users/{user_id}", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("get_user failed: HTTP {}", resp.status()));
        }

        resp.json().await.map_err(|e| e.to_string())
    }
}
