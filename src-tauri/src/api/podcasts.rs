// Split from the original single-file api.rs (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. AbsClient, its private root()/
// auth_header() helpers, and shared imports come from the parent (mod.rs).
use super::*;

impl AbsClient {
    /// POST /api/podcasts/feed — fetch and preview an RSS feed without
    /// subscribing. Body `{ rssFeed }`; returns `{ podcast: { metadata,
    /// episodes, ... } }` (404 if the feed can't be reached/parsed).
    pub async fn get_podcast_feed(&self, rss_feed: &str) -> Result<serde_json::Value, String> {
        let resp = self
            .http
            .post(format!("{}/api/podcasts/feed", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&serde_json::json!({ "rssFeed": rss_feed }))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("get_podcast_feed failed: HTTP {}", resp.status()));
        }
        resp.json().await.map_err(|e| e.to_string())
    }

    /// POST /api/podcasts — create a podcast library item from a previewed feed.
    /// `payload` is the full body the frontend assembles: `{ libraryId,
    /// folderId, path, media: { metadata, autoDownloadEpisodes?,
    /// autoDownloadSchedule? } }`. Returns the expanded library item.
    pub async fn create_podcast(&self, payload: serde_json::Value) -> Result<LibraryItem, String> {
        let resp = self
            .http
            .post(format!("{}/api/podcasts", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&payload)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("create_podcast failed: HTTP {}", resp.status()));
        }
        resp.json().await.map_err(|e| e.to_string())
    }

    /// POST /api/podcasts/opml/parse — parse OPML text into a feed list.
    /// Body `{ opmlText }`; returns `{ feeds: [{ title, feedUrl, ... }] }`.
    pub async fn parse_opml(&self, opml_text: &str) -> Result<serde_json::Value, String> {
        let resp = self
            .http
            .post(format!("{}/api/podcasts/opml/parse", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&serde_json::json!({ "opmlText": opml_text }))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("parse_opml failed: HTTP {}", resp.status()));
        }
        resp.json().await.map_err(|e| e.to_string())
    }

    /// POST /api/podcasts/opml/create — bulk-subscribe from feed URLs. Body
    /// `{ feeds: [url...], libraryId, folderId, autoDownloadEpisodes? }`.
    /// Server kicks off the subscriptions asynchronously and returns 200.
    pub async fn create_from_opml(&self, payload: serde_json::Value) -> Result<(), String> {
        let resp = self
            .http
            .post(format!("{}/api/podcasts/opml/create", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&payload)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("create_from_opml failed: HTTP {}", resp.status()));
        }
        Ok(())
    }

    /// GET /api/podcasts/{id}/checknew?limit= — poll the live feed for episodes
    /// not yet present locally. `limit` defaults server-side to 3 when omitted.
    /// Returns `{ episodes: [...] }`.
    pub async fn check_new_episodes(
        &self,
        item_id: &str,
        limit: Option<u32>,
    ) -> Result<serde_json::Value, String> {
        let mut req = self
            .http
            .get(format!("{}/api/podcasts/{item_id}/checknew", self.root()))
            .header("Authorization", self.auth_header()?);
        if let Some(l) = limit {
            req = req.query(&[("limit", l.to_string())]);
        }
        let resp = req.send().await.map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("check_new_episodes failed: HTTP {}", resp.status()));
        }
        resp.json().await.map_err(|e| e.to_string())
    }

    /// GET /api/podcasts/{id}/downloads — the current episode download queue.
    /// Returns `{ downloads: [...], currentDownload? }`.
    pub async fn get_episode_downloads(&self, item_id: &str) -> Result<serde_json::Value, String> {
        let resp = self
            .http
            .get(format!("{}/api/podcasts/{item_id}/downloads", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("get_episode_downloads failed: HTTP {}", resp.status()));
        }
        resp.json().await.map_err(|e| e.to_string())
    }

    /// GET /api/podcasts/{id}/clear-queue — clear queued (not in-progress)
    /// downloads. Returns 200.
    pub async fn clear_download_queue(&self, item_id: &str) -> Result<(), String> {
        let resp = self
            .http
            .get(format!("{}/api/podcasts/{item_id}/clear-queue", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("clear_download_queue failed: HTTP {}", resp.status()));
        }
        Ok(())
    }

    /// POST /api/podcasts/{id}/download-episodes — queue episodes for download.
    /// Body is a bare JSON array of feed-episode objects (as returned by the
    /// feed preview / checknew). Server returns 200.
    pub async fn download_episodes(
        &self,
        item_id: &str,
        episodes: serde_json::Value,
    ) -> Result<(), String> {
        let resp = self
            .http
            .post(format!("{}/api/podcasts/{item_id}/download-episodes", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&episodes)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("download_episodes failed: HTTP {}", resp.status()));
        }
        Ok(())
    }

    /// GET /api/podcasts/{id}/search-episode?title= — find one episode in the
    /// live feed by title. Returns `{ episodes: [...] }`.
    pub async fn find_episode(&self, item_id: &str, title: &str) -> Result<serde_json::Value, String> {
        let resp = self
            .http
            .get(format!("{}/api/podcasts/{item_id}/search-episode", self.root()))
            .header("Authorization", self.auth_header()?)
            .query(&[("title", title)])
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("find_episode failed: HTTP {}", resp.status()));
        }
        resp.json().await.map_err(|e| e.to_string())
    }

    /// POST /api/podcasts/{id}/match-episodes?override=1 — quick-match episode
    /// metadata against the configured provider. `override_existing` controls
    /// whether already-populated fields are overwritten. Returns
    /// `{ numEpisodesUpdated }`.
    pub async fn match_episodes(
        &self,
        item_id: &str,
        override_existing: bool,
    ) -> Result<serde_json::Value, String> {
        let mut req = self
            .http
            .post(format!("{}/api/podcasts/{item_id}/match-episodes", self.root()))
            .header("Authorization", self.auth_header()?);
        if override_existing {
            req = req.query(&[("override", "1")]);
        }
        let resp = req.send().await.map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("match_episodes failed: HTTP {}", resp.status()));
        }
        resp.json().await.map_err(|e| e.to_string())
    }

    /// GET /api/podcasts/{id}/episode/{episodeId} — fetch one episode.
    pub async fn get_episode(&self, item_id: &str, episode_id: &str) -> Result<serde_json::Value, String> {
        let resp = self
            .http
            .get(format!("{}/api/podcasts/{item_id}/episode/{episode_id}", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("get_episode failed: HTTP {}", resp.status()));
        }
        resp.json().await.map_err(|e| e.to_string())
    }

    /// PATCH /api/podcasts/{id}/episode/{episodeId} — edit episode metadata.
    /// `payload` carries any of title/subtitle/description/pubDate/episode/
    /// season/episodeType/chapters/publishedAt. Returns the expanded item.
    pub async fn update_episode(
        &self,
        item_id: &str,
        episode_id: &str,
        payload: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let resp = self
            .http
            .patch(format!("{}/api/podcasts/{item_id}/episode/{episode_id}", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&payload)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("update_episode failed: HTTP {}", resp.status()));
        }
        resp.json().await.map_err(|e| e.to_string())
    }

    /// DELETE /api/podcasts/{id}/episode/{episodeId}?hard=1 — remove an episode.
    /// `hard` also deletes the audio file from disk. Returns the shortened item.
    pub async fn delete_episode(
        &self,
        item_id: &str,
        episode_id: &str,
        hard: bool,
    ) -> Result<serde_json::Value, String> {
        let mut req = self
            .http
            .delete(format!("{}/api/podcasts/{item_id}/episode/{episode_id}", self.root()))
            .header("Authorization", self.auth_header()?);
        if hard {
            req = req.query(&[("hard", "1")]);
        }
        let resp = req.send().await.map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("delete_episode failed: HTTP {}", resp.status()));
        }
        resp.json().await.map_err(|e| e.to_string())
    }

    /// GET /api/libraries/{id}/recent-episodes?limit=&page= — the recent-episodes
    /// shelf for a podcast library. Returns `{ episodes: [...], total, ... }`.
    pub async fn get_recent_episodes(
        &self,
        library_id: &str,
        limit: Option<u32>,
        page: Option<u32>,
    ) -> Result<serde_json::Value, String> {
        let mut query: Vec<(&str, String)> = Vec::new();
        if let Some(l) = limit {
            query.push(("limit", l.to_string()));
        }
        if let Some(p) = page {
            query.push(("page", p.to_string()));
        }
        let resp = self
            .http
            .get(format!("{}/api/libraries/{library_id}/recent-episodes", self.root()))
            .header("Authorization", self.auth_header()?)
            .query(&query)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("get_recent_episodes failed: HTTP {}", resp.status()));
        }
        resp.json().await.map_err(|e| e.to_string())
    }

    /// GET /api/libraries/{id}/opml — export the podcast library as OPML XML
    /// (returned as text, not JSON).
    pub async fn export_opml(&self, library_id: &str) -> Result<String, String> {
        let resp = self
            .http
            .get(format!("{}/api/libraries/{library_id}/opml", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("export_opml failed: HTTP {}", resp.status()));
        }
        resp.text().await.map_err(|e| e.to_string())
    }
}
