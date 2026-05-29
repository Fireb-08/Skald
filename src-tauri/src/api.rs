use serde::Deserialize;

use crate::models::{Bookmark, Library, LibraryItem, ListeningStats, MeResponse, PlaySession, User};

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
    pub async fn open_session(&self, item_id: &str) -> Result<PlaySession, String> {
        let resp = self
            .http
            .post(format!("{}/api/items/{item_id}/play", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&serde_json::json!({
                "deviceInfo": { "clientName": "Skald", "clientVersion": "0.1.0" },
                "mediaPlayer": "vlc",
                "supportedMimeTypes": ["audio/mpeg", "audio/ogg", "audio/aac", "audio/flac", "audio/wav"],
                "forceDirectPlay": true,
                "forceTranscode": false,
            }))
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

    /// POST /api/items/{itemId}/match
    pub async fn match_item(
        &self,
        item_id: &str,
        provider: &str,
        title: &str,
        author: &str,
        asin: Option<&str>,
    ) -> Result<serde_json::Value, String> {
        let mut body = serde_json::json!({
            "provider": provider,
            "title": title,
            "author": author,
            "overrideDefaults": true,
        });
        if let Some(a) = asin {
            body["asin"] = serde_json::json!(a);
        }
        let resp = self
            .http
            .post(format!("{}/api/items/{item_id}/match", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("match_item failed: HTTP {}", resp.status()));
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
}
