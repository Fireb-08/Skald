// Split from the original single-file api.rs (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. AbsClient, its private root()/
// auth_header() helpers, and shared imports come from the parent (mod.rs).
use super::*;

impl AbsClient {
    /// GET /api/items/{id}?expanded=1&include=share — recover an item's existing
    /// public share. ABS attaches `mediaItemShare = ShareManager.findByMediaItemId`
    /// here (admin + book only); this is the ONLY way to look a share up by item
    /// (there is no share-by-item route, and a 409 on create carries no id/slug).
    /// Returns None when the item has no share.
    pub async fn get_item_share(&self, item_id: &str) -> Result<Option<MediaItemShare>, String> {
        let resp = self
            .http
            .get(format!("{}/api/items/{item_id}?expanded=1&include=share", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("get_item_share failed: HTTP {}", resp.status()));
        }

        let value: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        let sv = match value.get("mediaItemShare") {
            Some(v) if !v.is_null() => v.clone(),
            _ => {
                log::info!(target: "skald::sharing", "get_item_share: item {item_id} has no share");
                return Ok(None);
            }
        };
        // ShareManager.findByMediaItemId returns a *sanitized* share object (not the
        // toJSONForClient shape create uses), so it may omit fields the strict model
        // requires. Extract leniently — only id + slug are needed to show the link.
        log::debug!(target: "skald::sharing", "get_item_share raw mediaItemShare: {sv}");
        let s = |k: &str| sv.get(k).and_then(|x| x.as_str()).map(str::to_string);
        let id = s("id").unwrap_or_default();
        let slug = s("slug").unwrap_or_default();
        if id.is_empty() || slug.is_empty() {
            log::warn!(target: "skald::sharing", "get_item_share: share missing id/slug");
            return Ok(None);
        }
        let expires_at = sv.get("expiresAt").and_then(|x| match x {
            serde_json::Value::Null => None,
            serde_json::Value::String(s) => Some(s.clone()),
            other => Some(other.to_string()),
        });
        Ok(Some(MediaItemShare {
            id,
            slug,
            media_item_id: s("mediaItemId").unwrap_or_default(),
            media_item_type: s("mediaItemType").unwrap_or_else(|| "book".to_string()),
            is_downloadable: sv.get("isDownloadable").and_then(|x| x.as_bool()).unwrap_or(false),
            expires_at,
            created_at: s("createdAt"),
            updated_at: s("updatedAt"),
        }))
    }

    // ── Sharing & RSS feeds (cluster G) ──────────────────────────────────────
    // All admin-only on the server (isAdminOrUp → 403). Routes/bodies verified
    // against ShareController.js / RSSFeedController.js. Request bodies built
    // inline (create_collection convention); responses use the cluster-G models.

    /// POST /api/share/mediaitem — create a public share link for a book or
    /// podcast episode. Body verified against ShareController.createMediaItemShare:
    /// `{ slug, mediaItemType, mediaItemId, expiresAt, isDownloadable }`.
    /// `expires_at` is Unix ms; ABS validates `expiresAt === null` as an error, so
    /// pass `0` for never-expires (ABS stores `expiresAt || null`). Returns the
    /// created MediaItemShare. ABS rejects a slug or mediaItemId already shared.
    pub async fn create_share(
        &self,
        slug: &str,
        media_item_type: &str,
        media_item_id: &str,
        expires_at: Option<i64>,
        is_downloadable: bool,
    ) -> Result<MediaItemShare, String> {
        let resp = self
            .http
            .post(format!("{}/api/share/mediaitem", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&serde_json::json!({
                "slug": slug,
                "mediaItemType": media_item_type,
                "mediaItemId": media_item_id,
                // ABS rejects null here; 0 means never-expires (stored as null).
                "expiresAt": expires_at,
                "isDownloadable": is_downloadable,
            }))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("create_share failed: HTTP {status} — {body}"));
        }

        resp.json().await.map_err(|e| e.to_string())
    }

    /// DELETE /api/share/mediaitem/{id} — revoke a share. Returns 200 with no body.
    pub async fn delete_share(&self, share_id: &str) -> Result<(), String> {
        let resp = self
            .http
            .delete(format!("{}/api/share/mediaitem/{share_id}", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("delete_share failed: HTTP {}", resp.status()));
        }
        Ok(())
    }

    /// GET /public/share/{slug} — public, unauthenticated fetch of a share by slug.
    /// NOTE: this lives on the ABS PublicRouter (mounted at /public), NOT under
    /// /api — the only /api share routes are POST /api/share/mediaitem (create) and
    /// DELETE /api/share/mediaitem/:id (revoke). Used by the local Share Manager to
    /// re-validate tracked shares (a 404 means the share is gone). No auth header.
    pub async fn get_share_by_slug(&self, slug: &str) -> Result<MediaItemShare, String> {
        let resp = self
            .http
            .get(format!("{}/public/share/{slug}", self.root()))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("get_share_by_slug failed: HTTP {}", resp.status()));
        }

        resp.json().await.map_err(|e| e.to_string())
    }

    /// GET /api/feeds — list all open RSS feeds. ABS returns
    /// `{ feeds: [...], minified: [...] }`; we take the full `feeds` array.
    pub async fn get_feeds(&self) -> Result<Vec<RssFeed>, String> {
        let resp = self
            .http
            .get(format!("{}/api/feeds", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("get_feeds failed: HTTP {}", resp.status()));
        }

        let body: RssFeedsResponse = resp.json().await.map_err(|e| e.to_string())?;
        Ok(body.feeds)
    }

    /// Open an RSS feed for an item / collection / series. The three ABS routes
    /// share the same body (`{ serverAddress, slug }`, both required) and differ
    /// only in path, so they collapse to one helper. `entity_kind` is one of
    /// "item" | "collection" | "series" (mapping to the route segment). Returns
    /// the created feed. `server_address` is the public ABS origin the feedUrl is
    /// built from — pass the configured server URL.
    pub async fn open_feed(
        &self,
        entity_kind: &str,
        entity_id: &str,
        server_address: &str,
        slug: &str,
    ) -> Result<RssFeed, String> {
        let resp = self
            .http
            .post(format!("{}/api/feeds/{entity_kind}/{entity_id}/open", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&serde_json::json!({
                "serverAddress": server_address,
                "slug": slug,
            }))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("open_feed failed: HTTP {status} — {body}"));
        }

        resp.json().await.map_err(|e| e.to_string())
    }

    /// POST /api/feeds/{id}/close — close/revoke an open feed. No body; the route
    /// takes the feed id. Returns 200.
    pub async fn close_feed(&self, feed_id: &str) -> Result<(), String> {
        let resp = self
            .http
            .post(format!("{}/api/feeds/{feed_id}/close", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("close_feed failed: HTTP {}", resp.status()));
        }
        Ok(())
    }
}
