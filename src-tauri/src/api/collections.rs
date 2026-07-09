// Split from the original single-file api.rs (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. AbsClient, its private root()/
// auth_header() helpers, and shared imports come from the parent (mod.rs).
use super::*;

impl AbsClient {
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

    /// PATCH /api/collections/{id} — update a collection. Pass `{ books: [ids] }`
    /// to reorder, or `{ name, description }` to edit. Returns the updated collection.
    pub async fn update_collection(
        &self,
        collection_id: &str,
        payload: serde_json::Value,
    ) -> Result<Collection, String> {
        let resp = self
            .http
            .patch(format!("{}/api/collections/{collection_id}", self.root()))
            .header("Authorization", self.auth_header()?)
            .json(&payload)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("update_collection failed: HTTP {}", resp.status()));
        }

        resp.json::<Collection>().await.map_err(|e| e.to_string())
    }

    /// DELETE /api/collections/{id}/book/{book_id} — remove a book from a
    /// collection. Returns the updated collection.
    pub async fn remove_book_from_collection(
        &self,
        collection_id: &str,
        book_id: &str,
    ) -> Result<Collection, String> {
        let resp = self
            .http
            .delete(format!("{}/api/collections/{collection_id}/book/{book_id}", self.root()))
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("remove_book_from_collection failed: HTTP {}", resp.status()));
        }

        resp.json::<Collection>().await.map_err(|e| e.to_string())
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
