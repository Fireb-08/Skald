use serde::Deserialize;

use crate::models::{AdminUser, Bookmark, Collection, CollectionsResponse, Library, LibraryItem, LibraryStats, ListeningStats, MeResponse, PlaySession, User, UserStats};

#[derive(Clone)]
pub struct AbsClient {
    pub base_url: String,
    pub token: Option<String>,
    pub http: reqwest::Client,
}

impl AbsClient {
    pub fn new(base_url: String) -> Self {
        Self {
            base_url,
            token: None,
            http: reqwest::Client::new(),
        }
    }

    pub fn with_token(mut self, token: String) -> Self {
        self.token = Some(token);
        self
    }

    fn root(&self) -> String {
        self.base_url.trim_end_matches('/').to_string()
    }

    fn auth_header(&self) -> Result<String, String> {
        self.token
            .as_ref()
            .map(|t| format!("Bearer {t}"))
            .ok_or_else(|| "No auth token configured".to_string())
    }

    /// POST /login — at the server root, not under /api/ (see CLAUDE.md critical lesson 1).
    pub async fn login(&self, username: &str, password: &str) -> Result<User, String> {
        #[derive(Deserialize)]
        struct LoginResponse {
            user: User,
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
        Ok(body.user)
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

    /// GET /api/libraries
    pub async fn get_libraries(&self) -> Result<Vec<Library>, String> {
        #[derive(Deserialize)]
        struct Wrapper {
            libraries: Vec<Library>,
        }

        let resp = self
            .http
            .get(format!("{}/api/libraries", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("get_libraries failed: HTTP {}", resp.status()));
        }

        let body: Wrapper = resp.json().await.map_err(|e| e.to_string())?;
        Ok(body.libraries)
    }

    /// GET /api/libraries/{id}/items
    pub async fn get_library_items(&self, library_id: &str) -> Result<Vec<LibraryItem>, String> {
        #[derive(Deserialize)]
        struct Wrapper {
            results: Vec<LibraryItem>,
        }

        let resp = self
            .http
            .get(format!("{}/api/libraries/{library_id}/items", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("get_library_items failed: HTTP {}", resp.status()));
        }

        let body: Wrapper = resp.json().await.map_err(|e| e.to_string())?;
        Ok(body.results)
    }

    /// GET /api/items/{id}
    pub async fn get_item(&self, item_id: &str) -> Result<LibraryItem, String> {
        let resp = self
            .http
            .get(format!("{}/api/items/{item_id}", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("get_item failed: HTTP {}", resp.status()));
        }

        resp.json().await.map_err(|e| e.to_string())
    }

    /// GET /api/users/{id}/listening-stats
    pub async fn get_listening_stats(&self, user_id: &str) -> Result<ListeningStats, String> {
        let resp = self
            .http
            .get(format!("{}/api/users/{user_id}/listening-stats", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("get_listening_stats failed: HTTP {}", resp.status()));
        }

        resp.json().await.map_err(|e| e.to_string())
    }

    /// GET /api/me/listening-stats — richer per-user endpoint used by GreetingPane.
    /// Returns total time, days listened, books finished, recent sessions, and a
    /// per-day map for the 7-day sparkline. Distinct from /api/users/{id}/listening-stats.
    pub async fn get_user_stats(&self) -> Result<UserStats, String> {
        let resp = self
            .http
            .get(format!("{}/api/me/listening-stats", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("get_user_stats failed: HTTP {}", resp.status()));
        }

        resp.json().await.map_err(|e| e.to_string())
    }

    /// GET /api/libraries/{id}/stats — library-level aggregate statistics.
    /// Returns item count, author count, total duration, track count, size, and top genres.
    pub async fn get_library_stats(&self, library_id: &str) -> Result<LibraryStats, String> {
        let resp = self
            .http
            .get(format!("{}/api/libraries/{library_id}/stats", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("get_library_stats failed: HTTP {}", resp.status()));
        }

        resp.json().await.map_err(|e| e.to_string())
    }

    /// POST /api/me/item/{id}/bookmark
    /// Body: { time, title }  — item_id is in the URL path (confirmed against ApiRouter.js).
    pub async fn create_bookmark(
        &self,
        item_id: &str,
        time: f64,
        title: &str,
    ) -> Result<Bookmark, String> {
        let resp = self
            .http
            .post(format!("{}/api/me/item/{item_id}/bookmark", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&serde_json::json!({ "time": time, "title": title }))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("create_bookmark failed: HTTP {}", resp.status()));
        }

        resp.json().await.map_err(|e| e.to_string())
    }

    /// PATCH /api/me/progress/{id}
    pub async fn update_progress(
        &self,
        item_id: &str,
        current_time: f64,
        duration: f64,
        is_finished: bool,
    ) -> Result<(), String> {
        let resp = self
            .http
            .patch(format!("{}/api/me/progress/{item_id}", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&serde_json::json!({
                "currentTime": current_time,
                "duration": duration,
                "isFinished": is_finished,
            }))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("update_progress failed: HTTP {}", resp.status()));
        }

        Ok(())
    }

    /// DELETE /api/me/progress/{id} — removes a progress record entirely.
    pub async fn delete_progress(&self, item_id: &str) -> Result<(), String> {
        let resp = self
            .http
            .delete(format!("{}/api/me/progress/{item_id}", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("delete_progress failed: HTTP {}", resp.status()));
        }

        Ok(())
    }

    /// POST /api/session/{id}/sync  (confirmed against ApiRouter.js)
    pub async fn sync_session(
        &self,
        session_id: &str,
        current_time: f64,
        time_listened: f64,
    ) -> Result<(), String> {
        let resp = self
            .http
            .post(format!("{}/api/session/{session_id}/sync", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&serde_json::json!({
                "currentTime": current_time,
                "timeListened": time_listened,
            }))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("sync_session failed: HTTP {}", resp.status()));
        }

        Ok(())
    }

    /// POST /api/items/{id}/play — opens a playback session; request body asks
    /// for direct play so LibVLC receives plain file URLs (no HLS transcode).
    /// Optional `start_time` is passed as `startTime` so the server begins the
    /// session at a specific position, eliminating a separate seek after open.
    pub async fn open_session(&self, item_id: &str, start_time: Option<f64>) -> Result<PlaySession, String> {
        let mut body = serde_json::json!({
            "deviceInfo": { "clientName": "Skald", "clientVersion": "0.1.0" },
            "mediaPlayer": "vlc",
            "supportedMimeTypes": ["audio/mpeg", "audio/ogg", "audio/aac", "audio/flac", "audio/wav"],
            "forceDirectPlay": true,
            "forceTranscode": false,
        });
        if let Some(t) = start_time {
            body["startTime"] = serde_json::json!(t);
        }
        let resp = self
            .http
            .post(format!("{}/api/items/{item_id}/play", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("open_session failed: HTTP {}", resp.status()));
        }

        resp.json().await.map_err(|e| e.to_string())
    }

    /// GET /api/items/{id}/cover — returns raw image bytes.
    pub async fn fetch_cover(&self, item_id: &str) -> Result<Vec<u8>, String> {
        let resp = self
            .http
            .get(format!("{}/api/items/{item_id}/cover", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("fetch_cover failed: HTTP {}", resp.status()));
        }

        resp.bytes()
            .await
            .map(|b| b.to_vec())
            .map_err(|e| e.to_string())
    }

    /// PATCH /api/items/{item_id}/media — writes metadata via the object-array structures
    /// the server reads from (authors, narrators, series), not the computed flat strings.
    pub async fn update_media(
        &self,
        item_id: &str,
        metadata: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let resp = self
            .http
            .patch(format!("{}/api/items/{item_id}/media", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&serde_json::json!({ "metadata": metadata }))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("update_media failed: HTTP {}", resp.status()));
        }

        resp.json().await.map_err(|e| e.to_string())
    }

    /// GET /api/search/books?title=…&author=…&provider=…
    pub async fn search_books(
        &self,
        title: &str,
        author: &str,
        provider: &str,
    ) -> Result<serde_json::Value, String> {
        let resp = self
            .http
            .get(format!("{}/api/search/books", self.root()))
            .header("Authorization", self.auth_header()?)
            .query(&[("title", title), ("author", author), ("provider", provider)])
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("search_books failed: HTTP {}", resp.status()));
        }

        resp.json().await.map_err(|e| e.to_string())
    }

    /// POST /api/session/{id}/close  (confirmed against ApiRouter.js)
    pub async fn close_session(
        &self,
        session_id: &str,
        current_time: f64,
        time_listened: f64,
    ) -> Result<(), String> {
        let resp = self
            .http
            .post(format!("{}/api/session/{session_id}/close", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&serde_json::json!({
                "currentTime": current_time,
                "timeListened": time_listened,
            }))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("close_session failed: HTTP {}", resp.status()));
        }

        Ok(())
    }

    /// GET /api/users/me/listening-sessions — returns all open sessions for
    /// the authenticated user so stale sessions from previous runs can be closed.
    pub async fn get_open_sessions(&self) -> Result<Vec<String>, String> {
        let resp = self
            .http
            .get(format!("{}/api/users/me/listening-sessions", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("get_open_sessions failed: HTTP {}", resp.status()));
        }

        // Extract session IDs from the response array or wrapper object.
        let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        let sessions = body
            .as_array()
            .or_else(|| body.get("sessions").and_then(|v| v.as_array()))
            .cloned()
            .unwrap_or_default();

        Ok(sessions
            .into_iter()
            .filter_map(|s| s.get("id")?.as_str().map(str::to_owned))
            .collect())
    }

    /// POST /api/session/{id}/close — closes a single session by ID.
    /// Used to clean up ghost sessions left from previous app runs.
    pub async fn close_session_by_id(&self, session_id: &str) -> Result<(), String> {
        let resp = self
            .http
            .post(format!("{}/api/session/{session_id}/close", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&serde_json::json!({ "currentTime": 0, "timeListened": 0 }))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("close_session_by_id failed: HTTP {}", resp.status()));
        }

        Ok(())
    }

    /// GET /api/libraries/{library_id}/collections
    pub async fn get_collections(&self, library_id: &str) -> Result<Vec<Collection>, String> {
        let resp = self
            .http
            .get(format!("{}/api/libraries/{library_id}/collections", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("get_collections failed: HTTP {}", resp.status()));
        }

        let wrapper: CollectionsResponse = resp.json().await.map_err(|e| e.to_string())?;
        Ok(wrapper.results)
    }

    /// DELETE /api/items/{item_id} — permanently removes the item from the library.
    pub async fn delete_item(&self, item_id: &str) -> Result<(), String> {
        let resp = self
            .http
            .delete(format!("{}/api/items/{item_id}", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("delete_item failed: HTTP {}", resp.status()));
        }

        Ok(())
    }

    /// POST /api/items/{item_id}/scan — server-side library rescan for one item.
    pub async fn rescan_item(&self, item_id: &str) -> Result<(), String> {
        let resp = self
            .http
            .post(format!("{}/api/items/{item_id}/scan", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("rescan_item failed: HTTP {}", resp.status()));
        }

        Ok(())
    }

    /// POST /api/collections  body: {"libraryId", "name", "books": [book_id]}
    pub async fn create_collection(
        &self,
        library_id: &str,
        name: &str,
        book_id: &str,
    ) -> Result<Collection, String> {
        let resp = self
            .http
            .post(format!("{}/api/collections", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&serde_json::json!({
                "libraryId": library_id,
                "name": name,
                "books": [book_id],
            }))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("create_collection failed: HTTP {}", resp.status()));
        }

        resp.json().await.map_err(|e| e.to_string())
    }

    /// POST /api/collections/{collection_id}/book  body: {"id": book_id}
    pub async fn add_book_to_collection(
        &self,
        collection_id: &str,
        book_id: &str,
    ) -> Result<(), String> {
        let resp = self
            .http
            .post(format!("{}/api/collections/{collection_id}/book", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&serde_json::json!({ "id": book_id }))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("add_book_to_collection failed: HTTP {}", resp.status()));
        }

        Ok(())
    }

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
    ) -> Result<AdminUser, String> {
        // Wrapper to match the ABS response envelope: { "user": { ... } }
        #[derive(serde::Deserialize)]
        struct CreateUserResponse { user: AdminUser }

        let resp = self
            .http
            .post(format!("{}/api/users", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&serde_json::json!({
                "username": username,
                "password": password,
                // The ABS field name is "type"; do not rename.
                "type": user_type,
            }))
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
        username: Option<&str>,
        password: Option<&str>,
        user_type: Option<&str>,
    ) -> Result<AdminUser, String> {
        // Build a sparse JSON body with only the fields that were provided.
        let mut body = serde_json::Map::new();
        if let Some(u) = username  { body.insert("username".into(), u.into()); }
        if let Some(p) = password  { body.insert("password".into(), p.into()); }
        if let Some(t) = user_type { body.insert("type".into(), t.into()); }

        let resp = self
            .http
            .patch(format!("{}/api/users/{user_id}", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("update_user failed: HTTP {}", resp.status()));
        }

        resp.json().await.map_err(|e| e.to_string())
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
}
