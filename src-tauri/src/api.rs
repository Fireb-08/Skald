use serde::Deserialize;

use crate::models::{AdminUser, BackupsResponse, Bookmark, Collection, CollectionsResponse, CreateLibraryPayload, CustomMetadataProvider, FsDirectory, Library, LibraryItem, LibrarySeries, LibraryStats, ListeningSession, ListeningSessionsResponse, ListeningStats, LoggerData, MeResponse, NotificationSettings, NotificationsResponse, PlaySession, Playlist, PlaylistItemInput, PlaylistsResponse, ServerSettings, TasksResponse, UpdateLibraryPayload, User, UserStats};

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

    /// POST /api/authorize — re-validates the stored token and returns the login
    /// payload, which includes serverSettings. ABS has no standalone GET endpoint
    /// for server settings, so this is how we refresh them on an already-logged-in
    /// app launch (the original login response is long gone by then).
    pub async fn fetch_server_settings(&self) -> Result<ServerSettings, String> {
        let resp = self
            .http
            .post(format!("{}/api/authorize", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("fetch_server_settings failed: HTTP {}", resp.status()));
        }

        let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        let raw = json
            .get("serverSettings")
            .ok_or_else(|| "authorize response missing serverSettings".to_string())?;
        serde_json::from_value::<ServerSettings>(raw.clone()).map_err(|e| e.to_string())
    }

    /// PATCH /api/settings — update one or more server settings fields (admin only).
    /// Accepts a partial JSON object; ABS merges with current values server-side.
    pub async fn update_server_settings(&self, payload: serde_json::Value) -> Result<ServerSettings, String> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Wrapper {
            server_settings: ServerSettings,
        }

        let resp = self
            .http
            .patch(format!("{}/api/settings", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&payload)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("update_server_settings failed: HTTP {}", resp.status()));
        }

        let body: Wrapper = resp.json().await.map_err(|e| e.to_string())?;
        Ok(body.server_settings)
    }

    /// PATCH /api/sorting-prefixes — update the list of ignored sort prefixes (admin only).
    /// Uses a dedicated endpoint separate from /api/settings because ABS triggers
    /// a full title re-index across all library items when prefixes change.
    pub async fn update_sorting_prefixes(&self, prefixes: Vec<String>) -> Result<ServerSettings, String> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Wrapper {
            server_settings: ServerSettings,
        }

        let resp = self
            .http
            .patch(format!("{}/api/sorting-prefixes", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&serde_json::json!({ "sortingPrefixes": prefixes }))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("update_sorting_prefixes failed: HTTP {}", resp.status()));
        }

        let body: Wrapper = resp.json().await.map_err(|e| e.to_string())?;
        Ok(body.server_settings)
    }

    // ── Notifications (Apprise) — all admin-only (ABS returns 403 otherwise) ──

    /// GET /api/notifications — returns both the current settings and the
    /// read-only event catalog (`{ settings, data: { events } }`). Unlike server
    /// settings, notifications have a real GET endpoint, so we fetch on demand.
    pub async fn get_notifications(&self) -> Result<NotificationsResponse, String> {
        let resp = self
            .http
            .get(format!("{}/api/notifications", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("get_notifications failed: HTTP {}", resp.status()));
        }

        resp.json::<NotificationsResponse>().await.map_err(|e| e.to_string())
    }

    /// PATCH /api/notifications — update the global notification settings
    /// (appriseApiUrl, queue limits, …). Accepts a sparse JSON object. ABS
    /// returns 200 with no useful body, so we re-fetch to get the merged state.
    pub async fn update_notification_settings(
        &self,
        payload: serde_json::Value,
    ) -> Result<NotificationSettings, String> {
        let resp = self
            .http
            .patch(format!("{}/api/notifications", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&payload)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("update_notification_settings failed: HTTP {}", resp.status()));
        }

        // The PATCH response body is just a 200; re-read the settings so the
        // caller gets the authoritative merged result.
        Ok(self.get_notifications().await?.settings)
    }

    /// POST /api/notifications — create a notification rule. Returns the updated
    /// NotificationSettings (with the new rule, including its server-assigned id).
    pub async fn create_notification(
        &self,
        payload: serde_json::Value,
    ) -> Result<NotificationSettings, String> {
        let resp = self
            .http
            .post(format!("{}/api/notifications", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&payload)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("create_notification failed: HTTP {}", resp.status()));
        }

        resp.json::<NotificationSettings>().await.map_err(|e| e.to_string())
    }

    /// PATCH /api/notifications/:id — update one rule. Returns updated settings.
    pub async fn update_notification(
        &self,
        id: &str,
        payload: serde_json::Value,
    ) -> Result<NotificationSettings, String> {
        let resp = self
            .http
            .patch(format!("{}/api/notifications/{}", self.root(), id))
            .header("Authorization", self.auth_header()?)
            .json(&payload)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("update_notification failed: HTTP {}", resp.status()));
        }

        resp.json::<NotificationSettings>().await.map_err(|e| e.to_string())
    }

    /// DELETE /api/notifications/:id — remove one rule. Returns updated settings.
    pub async fn delete_notification(&self, id: &str) -> Result<NotificationSettings, String> {
        let resp = self
            .http
            .delete(format!("{}/api/notifications/{}", self.root(), id))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("delete_notification failed: HTTP {}", resp.status()));
        }

        resp.json::<NotificationSettings>().await.map_err(|e| e.to_string())
    }

    /// GET /api/notifications/:id/test — send a real test notification to one
    /// rule's Apprise URLs. ABS returns 400 if Apprise is unconfigured, 500 on
    /// send failure. We surface the status to the caller.
    pub async fn test_notification(&self, id: &str) -> Result<(), String> {
        let resp = self
            .http
            .get(format!("{}/api/notifications/{}/test", self.root(), id))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("test_notification failed: HTTP {}", resp.status()));
        }
        Ok(())
    }

    /// GET /api/notifications/test — fire a synthetic `onTest` event through the
    /// whole pipeline, verifying the Apprise connection end-to-end.
    pub async fn fire_test_event(&self) -> Result<(), String> {
        let resp = self
            .http
            .get(format!("{}/api/notifications/test", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("fire_test_event failed: HTTP {}", resp.status()));
        }
        Ok(())
    }

    // ── Backups — all admin-only (ABS returns 403 otherwise) ─────────────────

    /// GET /api/backups — list backups plus the backup directory location.
    pub async fn get_backups(&self) -> Result<BackupsResponse, String> {
        let resp = self
            .http
            .get(format!("{}/api/backups", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("get_backups failed: HTTP {}", resp.status()));
        }

        resp.json::<BackupsResponse>().await.map_err(|e| e.to_string())
    }

    /// POST /api/backups — create a backup now. ABS writes the archive before
    /// responding, so we re-fetch the list to return the updated state including
    /// the new backup.
    pub async fn create_backup(&self) -> Result<BackupsResponse, String> {
        let resp = self
            .http
            .post(format!("{}/api/backups", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("create_backup failed: HTTP {}", resp.status()));
        }

        self.get_backups().await
    }

    /// DELETE /api/backups/:id — delete a backup. Re-fetch to return the updated list.
    pub async fn delete_backup(&self, id: &str) -> Result<BackupsResponse, String> {
        let resp = self
            .http
            .delete(format!("{}/api/backups/{}", self.root(), id))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("delete_backup failed: HTTP {}", resp.status()));
        }

        self.get_backups().await
    }

    /// GET /api/backups/:id/apply — restore from a backup. DESTRUCTIVE: ABS
    /// overwrites its database with the backup's contents and restarts, so the
    /// HTTP connection may drop before/without a clean response. Treat any
    /// transport error after a sent request as "restore started" — the caller
    /// warns the user the server is restarting.
    pub async fn apply_backup(&self, id: &str) -> Result<(), String> {
        let resp = self
            .http
            .get(format!("{}/api/backups/{}/apply", self.root(), id))
            .header("Authorization", self.auth_header()?)
            .send()
            .await;

        match resp {
            // A normal success response.
            Ok(r) if r.status().is_success() => Ok(()),
            Ok(r) => Err(format!("apply_backup failed: HTTP {}", r.status())),
            // The server commonly restarts mid-request; a dropped connection here
            // means the restore was accepted and ABS is restarting, not a failure.
            Err(_) => Ok(()),
        }
    }

    // ── Tasks / scheduling ───────────────────────────────────────────────────

    /// GET /api/tasks — current + recently-finished background tasks. ABS does
    /// not require admin here, but Skald gates the UI to admins.
    pub async fn get_tasks(&self) -> Result<TasksResponse, String> {
        let resp = self
            .http
            .get(format!("{}/api/tasks", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("get_tasks failed: HTTP {}", resp.status()));
        }

        resp.json::<TasksResponse>().await.map_err(|e| e.to_string())
    }

    /// GET /api/logger-data — the current day's recent log entries (admin only).
    pub async fn get_logger_data(&self) -> Result<LoggerData, String> {
        let resp = self
            .http
            .get(format!("{}/api/logger-data", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("get_logger_data failed: HTTP {}", resp.status()));
        }

        resp.json::<LoggerData>().await.map_err(|e| e.to_string())
    }

    /// POST /api/validate-cron — validate a cron expression. ABS responds 200 for
    /// a valid expression and 400 for an invalid one, so map those to Ok(true) /
    /// Ok(false); any other status is a real error.
    pub async fn validate_cron(&self, expression: &str) -> Result<bool, String> {
        let resp = self
            .http
            .post(format!("{}/api/validate-cron", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&serde_json::json!({ "expression": expression }))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        match resp.status().as_u16() {
            200 => Ok(true),
            400 => Ok(false),
            other => Err(format!("validate_cron failed: HTTP {other}")),
        }
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

    /// GET /api/libraries/{id}/series?limit=0 — returns all series in a library.
    /// limit=0 disables pagination and returns all results in a single response.
    pub async fn get_library_series(&self, library_id: &str) -> Result<Vec<LibrarySeries>, String> {
        #[derive(serde::Deserialize)]
        struct Wrapper {
            results: Vec<LibrarySeries>,
        }

        // Do NOT use limit=0 — this server interprets it as "zero results"
        // (total is reported but results array is empty). Use a high limit instead.
        // limit=1000 safely covers any realistic library; for libraries with >1000
        // series, pagination via &page=N would be needed but is omitted here.
        let resp = self
            .http
            .get(format!("{}/api/libraries/{library_id}/series?limit=1000", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("get_library_series failed: HTTP {}", resp.status()));
        }

        let body: Wrapper = resp.json().await.map_err(|e| e.to_string())?;
        Ok(body.results)
    }

    /// GET /api/libraries/{id}/items?filter=series.{base64_id} — returns books for one series.
    ///
    /// ABS server-side filter format: "group.value" where value is the Base64-encoded ID.
    /// Base64 encoding is REQUIRED — the server rejects unencoded IDs silently (returns empty).
    pub async fn get_series_items(&self, library_id: &str, series_id: &str) -> Result<Vec<LibraryItem>, String> {
        use base64::Engine;
        // Standard Base64 encoding (not URL-safe) is what ABS expects.
        let encoded_id = base64::engine::general_purpose::STANDARD.encode(series_id);

        #[derive(serde::Deserialize)]
        struct Wrapper {
            results: Vec<LibraryItem>,
        }

        let resp = self
            .http
            .get(format!(
                "{}/api/libraries/{library_id}/items?filter=series.{encoded_id}",
                self.root()
            ))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("get_series_items failed: HTTP {}", resp.status()));
        }

        let body: Wrapper = resp.json().await.map_err(|e| e.to_string())?;
        Ok(body.results)
    }

    /// GET /api/libraries/{id}/personalized — returns the continue-listening shelf entities.
    /// The endpoint returns multiple named shelves; we extract only "continue-listening".
    pub async fn get_continue_listening(&self, library_id: &str) -> Result<Vec<LibraryItem>, String> {
        let resp = self
            .http
            .get(format!("{}/api/libraries/{library_id}/personalized", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("get_continue_listening failed: HTTP {}", resp.status()));
        }

        let shelves: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        let entities = shelves
            .as_array()
            .and_then(|arr| arr.iter().find(|s| s["id"] == "continue-listening"))
            .and_then(|shelf| shelf["entities"].as_array())
            .cloned()
            .unwrap_or_default();

        Ok(entities
            .into_iter()
            .filter_map(|v| serde_json::from_value(v).ok())
            .collect())
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
    /// When `width` is `Some(w)`, appends `?width={w}` so ABS resizes the cover
    /// server-side (see the ABS API `width` query parameter on the cover route).
    /// When `None`, the original full-size cover is requested unchanged.
    pub async fn fetch_cover(&self, item_id: &str, width: Option<u32>) -> Result<Vec<u8>, String> {
        let url = match width {
            Some(w) => format!("{}/api/items/{item_id}/cover?width={w}", self.root()),
            None => format!("{}/api/items/{item_id}/cover", self.root()),
        };
        let resp = self
            .http
            .get(url)
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

    // ── Cover management ─────────────────────────────────────────────────────

    /// GET /api/search/covers?title=&author=&provider= — find cover candidates.
    /// For books ABS returns `{ results: [<url>, …] }` (an array of image URLs).
    pub async fn find_covers(
        &self,
        title: &str,
        author: &str,
        provider: &str,
    ) -> Result<Vec<String>, String> {
        #[derive(Deserialize)]
        struct Wrapper { #[serde(default)] results: Vec<String> }

        let resp = self
            .http
            .get(format!("{}/api/search/covers", self.root()))
            .query(&[("title", title), ("author", author), ("provider", provider)])
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("find_covers failed: HTTP {}", resp.status()));
        }

        Ok(resp.json::<Wrapper>().await.map_err(|e| e.to_string())?.results)
    }

    /// POST /api/items/{id}/cover with `{ url }` — ABS downloads the remote cover
    /// and sets it on the item (uploadCover's URL mode). Requires canUpload.
    pub async fn set_cover_url(&self, item_id: &str, url: &str) -> Result<(), String> {
        let resp = self
            .http
            .post(format!("{}/api/items/{item_id}/cover", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&serde_json::json!({ "url": url }))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("set_cover_url failed: HTTP {}", resp.status()));
        }
        Ok(())
    }

    /// POST /api/items/{id}/cover (multipart, field "cover") — upload a local
    /// image as the item's cover. Requires canUpload.
    pub async fn upload_cover(&self, item_id: &str, file_path: &str) -> Result<(), String> {
        let bytes = std::fs::read(file_path).map_err(|e| format!("read file failed: {e}"))?;
        let name = std::path::Path::new(file_path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "cover.jpg".to_string());
        let mime = match name.rsplit('.').next().map(|e| e.to_ascii_lowercase()).as_deref() {
            Some("png") => "image/png",
            Some("webp") => "image/webp",
            Some("gif") => "image/gif",
            _ => "image/jpeg",
        };
        let part = reqwest::multipart::Part::bytes(bytes)
            .file_name(name)
            .mime_str(mime)
            .map_err(|e| e.to_string())?;
        let form = reqwest::multipart::Form::new().part("cover", part);

        let resp = self
            .http
            .post(format!("{}/api/items/{item_id}/cover", self.root()))
            .header("Authorization", self.auth_header()?)
            .multipart(form)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("upload_cover failed: HTTP {}", resp.status()));
        }
        Ok(())
    }

    /// DELETE /api/items/{id}/cover — remove the item's cover.
    pub async fn remove_cover(&self, item_id: &str) -> Result<(), String> {
        let resp = self
            .http
            .delete(format!("{}/api/items/{item_id}/cover", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("remove_cover failed: HTTP {}", resp.status()));
        }
        Ok(())
    }

    /// PATCH /api/items/{item_id}/media — writes the full media payload. ABS reads
    /// `metadata` (with object-array authors/narrators/series, not flat strings) and
    /// top-level siblings like `tags`, so callers pass the whole `{ metadata, tags }`
    /// object rather than a bare metadata object.
    pub async fn update_media(
        &self,
        item_id: &str,
        payload: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let resp = self
            .http
            .patch(format!("{}/api/items/{item_id}/media", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&payload)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("update_media failed: HTTP {}", resp.status()));
        }

        resp.json().await.map_err(|e| e.to_string())
    }

    /// POST /api/items/{item_id}/chapters — replace the chapter markers.
    /// `chapters` is a JSON array of { start, end, title }. Requires canUpdate.
    /// Note: this route is POST in ABS (the media route is PATCH) — a PATCH 404s.
    pub async fn update_chapters(
        &self,
        item_id: &str,
        chapters: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let resp = self
            .http
            .post(format!("{}/api/items/{item_id}/chapters", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&serde_json::json!({ "chapters": chapters }))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("update_chapters failed: HTTP {}", resp.status()));
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

    /// GET /api/search/providers — no query params; returns
    /// `{ providers: { books: [{value, text}], booksCovers: [...], podcasts: [...] } }`
    /// (confirmed against SearchController.js getAllProviders)
    pub async fn search_providers(&self) -> Result<serde_json::Value, String> {
        let resp = self
            .http
            .get(format!("{}/api/search/providers", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("search_providers failed: HTTP {}", resp.status()));
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

    /// Paginated listening-session fetch — three routing cases:
    ///   None           → GET /api/sessions             (all users, admin only)
    ///   Some("__me__") → GET /api/me/listening-sessions (own sessions)
    ///   Some(id)       → GET /api/users/{id}/listening-sessions (specific user, admin only)
    /// page is 0-indexed; ABS uses the same convention.
    /// sort/desc are forwarded as query params so ABS sorts the full dataset server-side.
    pub async fn get_listening_sessions(
        &self,
        user_id: Option<&str>,
        page: u32,
        items_per_page: u32,
        sort: Option<&str>,   // ABS sort field name, e.g. "updatedAt", "timeListening"
        desc: Option<bool>,   // true = descending; None = omit the param entirely
    ) -> Result<ListeningSessionsResponse, String> {
        // Build the base path for each routing case — pagination is included here;
        // sort/desc are appended below so the logic stays symmetric across all three cases.
        let base = match user_id {
            None           => format!("{}/api/sessions", self.root()),                       // all users — admin only
            Some("__me__") => format!("{}/api/me/listening-sessions", self.root()),          // own sessions
            Some(id)       => format!("{}/api/users/{}/listening-sessions", self.root(), id), // specific user
        };

        // Build query string with pagination and optional sorting.
        // ABS sorts the full dataset server-side, so the returned page is
        // already correctly ordered across all results, not just the visible page.
        let mut url = format!("{}?page={}&itemsPerPage={}", base, page, items_per_page);
        if let Some(s) = sort {
            url.push_str(&format!("&sort={}", s)); // forward the sort field name verbatim
        }
        if let Some(d) = desc {
            // ABS expects desc=1 for descending, desc=0 for ascending.
            url.push_str(&format!("&desc={}", if d { 1 } else { 0 }));
        }

        let resp = self
            .http
            .get(url)
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("get_listening_sessions failed: HTTP {}", resp.status()));
        }

        // The response is a paginated wrapper; unknown extra fields are silently ignored.
        resp.json::<ListeningSessionsResponse>().await.map_err(|e| e.to_string())
    }

    /// DELETE /api/sessions/{id} — permanently removes a session record.
    /// ABS enforces admin-only access; non-admin callers receive 403.
    pub async fn delete_session(&self, session_id: &str) -> Result<(), String> {
        let resp = self
            .http
            .delete(format!("{}/api/sessions/{session_id}", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("delete_session failed: HTTP {}", resp.status()));
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

    /// GET /api/users/online → openSessions — extracts currently active playback sessions.
    /// ABS returns { usersOnline: [...], openSessions: [...] }; this method pulls out the
    /// openSessions array, which is the authoritative list of all active sessions on the server.
    pub async fn get_online_open_sessions(&self) -> Result<Vec<ListeningSession>, String> {
        // Minimal wrapper that captures only the openSessions field we need from the response.
        // usersOnline is present but unused here; it's consumed by get_online_users separately.
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Wrapper {
            #[serde(default)] // default to empty vec if the field is absent
            open_sessions: Vec<ListeningSession>, // JSON key: openSessions (camelCase rename)
        }

        let resp = self
            .http
            .get(format!("{}/api/users/online", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("get_online_open_sessions failed: HTTP {}", resp.status()));
        }

        // Deserialize only the openSessions field; remaining fields are ignored by serde.
        let body: Wrapper = resp.json().await.map_err(|e| e.to_string())?;
        Ok(body.open_sessions) // return the session list directly
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

    // ── Playlist endpoints ───────────────────────────────────────────────────
    // Playlists are per-user and private, unlike collections which are library-wide.
    // All mutating endpoints return the full updated Playlist so callers get the
    // server-assigned id, timestamps, and resolved item list in one round-trip.

    /// GET /api/libraries/{id}/playlists — lists all playlists owned by the
    /// authenticated user within the given library.
    pub async fn get_playlists(&self, library_id: &str) -> Result<Vec<Playlist>, String> {
        let resp = self
            .http
            .get(format!("{}/api/libraries/{library_id}/playlists", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("get_playlists failed: HTTP {}", resp.status()));
        }

        let wrapper: PlaylistsResponse = resp.json().await.map_err(|e| e.to_string())?;
        Ok(wrapper.results)
    }

    /// GET /api/playlists/{id} — returns a single playlist with its full item list.
    pub async fn get_playlist(&self, playlist_id: &str) -> Result<Playlist, String> {
        let resp = self
            .http
            .get(format!("{}/api/playlists/{playlist_id}", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("get_playlist failed: HTTP {}", resp.status()));
        }

        resp.json().await.map_err(|e| e.to_string())
    }

    /// POST /api/playlists — creates a new playlist.
    /// `items` is optional on create; ABS auto-deletes playlists when emptied but
    /// allows creation with zero items.
    pub async fn create_playlist(
        &self,
        library_id: &str,
        name: &str,
        description: Option<&str>,
        items: Option<Vec<PlaylistItemInput>>,
    ) -> Result<Playlist, String> {
        let mut body = serde_json::Map::new();
        body.insert("libraryId".into(), library_id.into());
        body.insert("name".into(), name.into());
        if let Some(d) = description {
            body.insert("description".into(), d.into());
        }
        if let Some(ref its) = items {
            let val = serde_json::to_value(its).map_err(|e| e.to_string())?;
            body.insert("items".into(), val);
        }

        let resp = self
            .http
            .post(format!("{}/api/playlists", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("create_playlist failed: HTTP {}", resp.status()));
        }

        resp.json().await.map_err(|e| e.to_string())
    }

    /// PATCH /api/playlists/{id} — updates name, description, or the full ordered
    /// items array. Sending `items` replaces the entire list (used for reordering).
    pub async fn update_playlist(
        &self,
        playlist_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        items: Option<Vec<PlaylistItemInput>>,
    ) -> Result<Playlist, String> {
        let mut body = serde_json::Map::new();
        if let Some(n) = name {
            body.insert("name".into(), n.into());
        }
        if let Some(d) = description {
            body.insert("description".into(), d.into());
        }
        if let Some(ref its) = items {
            let val = serde_json::to_value(its).map_err(|e| e.to_string())?;
            body.insert("items".into(), val);
        }

        let resp = self
            .http
            .patch(format!("{}/api/playlists/{playlist_id}", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("update_playlist failed: HTTP {}", resp.status()));
        }

        resp.json().await.map_err(|e| e.to_string())
    }

    /// DELETE /api/playlists/{id} — permanently removes a playlist.
    pub async fn delete_playlist(&self, playlist_id: &str) -> Result<(), String> {
        let resp = self
            .http
            .delete(format!("{}/api/playlists/{playlist_id}", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("delete_playlist failed: HTTP {}", resp.status()));
        }

        Ok(())
    }

    /// POST /api/playlists/{id}/batch/add — adds multiple items to a playlist in
    /// one request. Returns the updated playlist with the new items appended.
    pub async fn batch_add_to_playlist(
        &self,
        playlist_id: &str,
        items: Vec<PlaylistItemInput>,
    ) -> Result<Playlist, String> {
        let items_val = serde_json::to_value(&items).map_err(|e| e.to_string())?;

        let resp = self
            .http
            .post(format!("{}/api/playlists/{playlist_id}/batch/add", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&serde_json::json!({ "items": items_val }))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("batch_add_to_playlist failed: HTTP {}", resp.status()));
        }

        resp.json().await.map_err(|e| e.to_string())
    }

    /// POST /api/playlists/{id}/batch/remove — removes multiple items from a playlist.
    /// Returns the updated playlist; callers should check for auto-deletion (empty playlist).
    pub async fn batch_remove_from_playlist(
        &self,
        playlist_id: &str,
        items: Vec<PlaylistItemInput>,
    ) -> Result<Playlist, String> {
        let items_val = serde_json::to_value(&items).map_err(|e| e.to_string())?;

        let resp = self
            .http
            .post(format!("{}/api/playlists/{playlist_id}/batch/remove", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&serde_json::json!({ "items": items_val }))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("batch_remove_from_playlist failed: HTTP {}", resp.status()));
        }

        resp.json().await.map_err(|e| e.to_string())
    }

    /// GET /api/filesystem?path={path} — lists subdirectories on the ABS server at `path`.
    /// Admin-only; the server returns 403 for non-admin callers.
    /// Pass "/" to start at the server root.
    pub async fn get_filesystem(&self, path: &str) -> Result<FsDirectory, String> {
        let resp = self
            .http
            .get(format!("{}/api/filesystem", self.root()))
            .header("Authorization", self.auth_header()?)
            .query(&[("path", path)])
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("get_filesystem failed: HTTP {}", resp.status()));
        }

        resp.json().await.map_err(|e| e.to_string())
    }

    // ── Library management endpoints (admin only) ────────────────────────────
    // All four endpoints require an admin or root token. Ordinary users will
    // receive HTTP 403 from the ABS server.

    /// POST /api/libraries — creates a new library and returns the full Library object.
    pub async fn create_library(&self, payload: &CreateLibraryPayload) -> Result<Library, String> {
        let resp = self
            .http
            .post(format!("{}/api/libraries", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(payload)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("create_library failed: HTTP {status} — {body}"));
        }

        resp.json().await.map_err(|e| e.to_string())
    }

    /// PATCH /api/libraries/{id} — partially updates a library and returns the updated Library.
    /// Folder list in the payload replaces the existing folder list on the server.
    pub async fn update_library(
        &self,
        library_id: &str,
        payload: &UpdateLibraryPayload,
    ) -> Result<Library, String> {
        let resp = self
            .http
            .patch(format!("{}/api/libraries/{library_id}", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(payload)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            eprintln!("[update_library] HTTP {status} — ABS said: {body}");
            return Err(format!("update_library failed: HTTP {status} — {body}"));
        }

        resp.json().await.map_err(|e| e.to_string())
    }

    /// DELETE /api/libraries/{id} — permanently deletes a library and all its items.
    /// ABS response shape varies by version; we only need the success status.
    pub async fn delete_library(&self, library_id: &str) -> Result<(), String> {
        let resp = self
            .http
            .delete(format!("{}/api/libraries/{library_id}", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("delete_library failed: HTTP {status} — {body}"));
        }

        Ok(())
    }

    /// POST /api/libraries/{id}/scan — triggers a server-side scan.
    /// `force=true` appends `?force=1` to request a full rescan rather than
    /// an incremental one. The server runs the scan asynchronously and returns
    /// immediately; there is no completion callback.
    pub async fn scan_library(&self, library_id: &str, force: bool) -> Result<(), String> {
        let url = if force {
            format!("{}/api/libraries/{library_id}/scan?force=1", self.root())
        } else {
            format!("{}/api/libraries/{library_id}/scan", self.root())
        };

        let resp = self
            .http
            .post(url)
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("scan_library failed: HTTP {}", resp.status()));
        }

        Ok(())
    }

    // ── Custom metadata providers (admin) ────────────────────────────────────

    /// GET /api/custom-metadata-providers — list registered custom providers.
    pub async fn get_custom_metadata_providers(&self) -> Result<Vec<CustomMetadataProvider>, String> {
        #[derive(Deserialize)]
        struct Wrapper { #[serde(default)] providers: Vec<CustomMetadataProvider> }

        let resp = self
            .http
            .get(format!("{}/api/custom-metadata-providers", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("get_custom_metadata_providers failed: HTTP {}", resp.status()));
        }

        Ok(resp.json::<Wrapper>().await.map_err(|e| e.to_string())?.providers)
    }

    /// POST /api/custom-metadata-providers — register one. Body needs name, url,
    /// mediaType; optional authHeaderValue. Returns the created provider.
    pub async fn create_custom_metadata_provider(
        &self,
        payload: serde_json::Value,
    ) -> Result<CustomMetadataProvider, String> {
        #[derive(Deserialize)]
        struct Wrapper { provider: CustomMetadataProvider }

        let resp = self
            .http
            .post(format!("{}/api/custom-metadata-providers", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&payload)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("create_custom_metadata_provider failed: HTTP {}", resp.status()));
        }

        Ok(resp.json::<Wrapper>().await.map_err(|e| e.to_string())?.provider)
    }

    /// DELETE /api/custom-metadata-providers/{id} — remove a custom provider.
    pub async fn delete_custom_metadata_provider(&self, id: &str) -> Result<(), String> {
        let resp = self
            .http
            .delete(format!("{}/api/custom-metadata-providers/{id}", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("delete_custom_metadata_provider failed: HTTP {}", resp.status()));
        }
        Ok(())
    }

    /// POST /api/playlists/collection/{id} — creates a playlist pre-populated with
    /// all books from the given collection. Returns the newly created playlist.
    pub async fn create_playlist_from_collection(
        &self,
        collection_id: &str,
    ) -> Result<Playlist, String> {
        let resp = self
            .http
            .post(format!("{}/api/playlists/collection/{collection_id}", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("create_playlist_from_collection failed: HTTP {}", resp.status()));
        }

        resp.json().await.map_err(|e| e.to_string())
    }
}
