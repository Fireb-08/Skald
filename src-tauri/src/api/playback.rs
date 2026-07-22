// Split from the original single-file api.rs (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. AbsClient, its private root()/
// auth_header() helpers, and shared imports come from the parent (mod.rs).
use super::*;

impl AbsClient {
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

    /// PATCH /api/me/progress/{libraryItemId}/{episodeId?}
    ///
    /// For a book, `episode_id` is `None` and the path is the plain item form.
    /// For a podcast episode it is `Some(id)` and the episode id is an extra
    /// path segment — ABS keys episode progress on the path, not the body
    /// (route `createUpdateMediaProgress`, verified against ApiRouter.js).
    pub async fn update_progress(
        &self,
        item_id: &str,
        episode_id: Option<&str>,
        current_time: f64,
        duration: f64,
        is_finished: bool,
    ) -> Result<(), String> {
        let path = match episode_id {
            Some(ep) => format!("{}/api/me/progress/{item_id}/{ep}", self.root()),
            None => format!("{}/api/me/progress/{item_id}", self.root()),
        };
        let resp = self
            .http
            .patch(path)
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
    /// Optional `start_time` is included for protocol compatibility, but current
    /// ABS chooses the session's resume point from its MediaProgress record. The
    /// SessionManager applies a genuine chapter/bookmark override client-side
    /// after the response; an ordinary cold start trusts the returned currentTime.
    ///
    /// When `episode_id` is `Some`, the request targets the episode-playback
    /// route `POST /api/items/{id}/play/{episodeId}` instead (podcast cluster E,
    /// handler `startEpisodePlaybackSession`). The server then tracks progress
    /// against that episode, so the periodic session sync (keyed on the session
    /// id) persists episode progress with no further changes.
    pub async fn open_session(
        &self,
        item_id: &str,
        episode_id: Option<&str>,
        start_time: Option<f64>,
        device_id: &str,
    ) -> Result<PlaySession, String> {
        let mut body = serde_json::json!({
            // ABS closes prior sessions only when both userId and deviceId
            // match. This persistent installation ID prevents crash-orphans
            // without touching sessions opened by phones or web clients.
            "deviceInfo": {
                "deviceId": device_id,
                "clientName": "Skald",
                "clientVersion": env!("CARGO_PKG_VERSION"),
            },
            "mediaPlayer": "vlc",
            "supportedMimeTypes": ["audio/mpeg", "audio/ogg", "audio/aac", "audio/flac", "audio/wav"],
            "forceDirectPlay": true,
            "forceTranscode": false,
        });
        if let Some(t) = start_time {
            body["startTime"] = serde_json::json!(t);
        }
        let url = match episode_id {
            Some(ep) => format!("{}/api/items/{item_id}/play/{ep}", self.root()),
            None => format!("{}/api/items/{item_id}/play", self.root()),
        };
        let resp = self
            .http
            .post(url)
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

    // ─────────────────────────────────────────────────────────────────────
    // Podcasts (gap-analysis cluster E). Routes verified against ApiRouter.js →
    // PodcastController / LibraryController. The backend forwards JSON verbatim
    // (feed/episode shapes vary by feed); the frontend owns the typed shapes.
    // ─────────────────────────────────────────────────────────────────────

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

        // Close is intentionally idempotent: the frontend safety net and Rust
        // ExitRequested handler may race, and ABS also closes same-device
        // sessions automatically when a replacement starts.
        if !resp.status().is_success() && resp.status() != reqwest::StatusCode::NOT_FOUND {
            return Err(format!("close_session failed: HTTP {}", resp.status()));
        }

        Ok(())
    }

    /// GET /api/me/progress/{libraryItemId}/{episodeId?}. ABS's PATCH route
    /// returns an empty 200 response, so downloaded playback reads this record
    /// back to obtain the authoritative revision assigned to its own write.
    pub async fn get_media_progress(
        &self,
        item_id: &str,
        episode_id: Option<&str>,
    ) -> Result<crate::models::MediaProgress, String> {
        let path = match episode_id {
            Some(ep) => format!("{}/api/me/progress/{item_id}/{ep}", self.root()),
            None => format!("{}/api/me/progress/{item_id}", self.root()),
        };
        let resp = self
            .http
            .get(path)
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("get_media_progress failed: HTTP {}", resp.status()));
        }
        resp.json().await.map_err(|e| e.to_string())
    }

    /// Close an installation-owned orphan without sending a potentially stale
    /// progress payload. ABS saves the session's last periodic sync before removal.
    pub async fn close_session_without_sync(&self, session_id: &str) -> Result<(), String> {
        let resp = self
            .http
            .post(format!("{}/api/session/{session_id}/close", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&serde_json::json!({}))
            .send()
            .await
            .map_err(|error| error.to_string())?;

        if !resp.status().is_success() && resp.status() != reqwest::StatusCode::NOT_FOUND {
            return Err(format!("owned session close failed: HTTP {}", resp.status()));
        }
        Ok(())
    }
}
