// Split from the original single-file api.rs (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. AbsClient, its private root()/
// auth_header() helpers, and shared imports come from the parent (mod.rs).
use super::*;

impl AbsClient {
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
            // Retained failure boundary — the ABS error body explains rejected
            // folder-list edits, which a bare HTTP status hides.
            log::warn!(target: "skald::library", "update_library HTTP {status} — ABS said: {body}");
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
}
