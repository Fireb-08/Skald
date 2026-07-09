// Split from the original single-file api.rs (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. AbsClient, its private root()/
// auth_header() helpers, and shared imports come from the parent (mod.rs).
use super::*;

impl AbsClient {
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
}
