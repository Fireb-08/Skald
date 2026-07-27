// Split from the original single-file api.rs (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. AbsClient, its private root()/
// auth_header() helpers, and shared imports come from the parent (mod.rs).
use super::*;

impl AbsClient {
    /// GET /api/users/{id}/listening-stats
    pub async fn get_listening_stats(&self, user_id: &str) -> Result<ListeningStats, String> {
        let resp = self
            .http
            .get(format!("{}/api/users/{user_id}/listening-stats", self.root()))
            .header("Authorization", self.auth_header()?)
            .send_refreshing(self)
            .await?;

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
            .send_refreshing(self)
            .await?;

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
            .send_refreshing(self)
            .await?;

        if !resp.status().is_success() {
            return Err(format!("get_library_stats failed: HTTP {}", resp.status()));
        }

        resp.json().await.map_err(|e| e.to_string())
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
            .send_refreshing(self)
            .await?;

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
            .send_refreshing(self)
            .await?;

        if !resp.status().is_success() {
            return Err(format!("delete_session failed: HTTP {}", resp.status()));
        }

        Ok(())
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
            .send_refreshing(self)
            .await?;

        if !resp.status().is_success() {
            return Err(format!("get_online_open_sessions failed: HTTP {}", resp.status()));
        }

        // Deserialize only the openSessions field; remaining fields are ignored by serde.
        let body: Wrapper = resp.json().await.map_err(|e| e.to_string())?;
        Ok(body.open_sessions) // return the session list directly
    }

    /// POST /api/session/local-all — batch-sync client-built offline sessions
    /// (`SessionController.syncLocalSessions` → `syncLocalSessionsRequest`,
    /// verified against ApiRouter.js).
    ///
    /// Body: `{ deviceInfo, sessions: [...] }`. The response is always 200 with
    /// a per-session result array — a session ABS could not place (deleted item,
    /// missing library) fails *individually* without failing the batch, which is
    /// why the caller removes only what came back `success: true`.
    pub async fn sync_local_sessions(
        &self,
        sessions: &[crate::offline_sessions::LocalSession],
        device_info: &serde_json::Value,
    ) -> Result<Vec<LocalSessionAck>, LocalSessionError> {
        #[derive(serde::Deserialize)]
        struct Results {
            #[serde(default)]
            results: Vec<LocalSessionAck>,
        }

        let resp = self
            .http
            .post(format!("{}/api/session/local-all", self.root()))
            .header("Authorization", self.auth_header().map_err(LocalSessionError::Transport)?)
            .json(&serde_json::json!({ "deviceInfo": device_info, "sessions": sessions }))
            .send_refreshing(self)
            .await
            .map_err(LocalSessionError::Transport)?;

        if let Some(unsupported) = LocalSessionError::route_missing(resp.status()) {
            return Err(unsupported);
        }
        if !resp.status().is_success() {
            return Err(LocalSessionError::Transport(format!(
                "sync_local_sessions failed: HTTP {}",
                resp.status()
            )));
        }

        let body: Results = resp.json().await.map_err(|e| LocalSessionError::Transport(e.to_string()))?;
        Ok(body.results)
    }

    /// POST /api/session/local — sync one session (`SessionController.syncLocal`).
    /// The body *is* the session, with `deviceInfo` alongside its fields. Unlike
    /// the batch route this answers 500 with the error text when ABS cannot
    /// place the session, so a failure here is per-session, not per-server.
    pub async fn sync_local_session(
        &self,
        session: &crate::offline_sessions::LocalSession,
        device_info: &serde_json::Value,
    ) -> Result<(), LocalSessionError> {
        let mut body = serde_json::to_value(session)
            .map_err(|e| LocalSessionError::Transport(format!("Serialize error: {e}")))?;
        body["deviceInfo"] = device_info.clone();

        let resp = self
            .http
            .post(format!("{}/api/session/local", self.root()))
            .header("Authorization", self.auth_header().map_err(LocalSessionError::Transport)?)
            .json(&body)
            .send_refreshing(self)
            .await
            .map_err(LocalSessionError::Transport)?;

        if let Some(unsupported) = LocalSessionError::route_missing(resp.status()) {
            return Err(unsupported);
        }
        if !resp.status().is_success() {
            return Err(LocalSessionError::Transport(format!(
                "sync_local_session failed: HTTP {}",
                resp.status()
            )));
        }
        Ok(())
    }
}

/// One entry of the `/api/session/local-all` result array. ABS returns
/// `{ id, success: true, progressSynced }` on success and
/// `{ id, success: false, error }` when it could not place the session.
#[derive(serde::Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalSessionAck {
    pub id: String,
    #[serde(default)]
    pub success: bool,
    #[serde(default)]
    pub error: Option<String>,
}

/// Why a local-session flush could not be delivered.
#[derive(Debug, Clone, PartialEq)]
pub enum LocalSessionError {
    /// The server has no such route — an ABS predating local sessions, or a
    /// reverse proxy that does not forward it. Permanent for that server, so the
    /// caller records it instead of retrying on every reconnect.
    Unsupported,
    /// Anything else — offline, 5xx, auth. The sessions stay queued.
    Transport(String),
}

impl LocalSessionError {
    /// 404/501 is how a server without the route answers. Every other status is
    /// the server *having* the route and disagreeing about the request.
    fn route_missing(status: reqwest::StatusCode) -> Option<Self> {
        (status == reqwest::StatusCode::NOT_FOUND
            || status == reqwest::StatusCode::NOT_IMPLEMENTED)
            .then_some(Self::Unsupported)
    }
}
