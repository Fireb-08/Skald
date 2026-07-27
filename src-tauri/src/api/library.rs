// Split from the original single-file api.rs (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. AbsClient, its private root()/
// auth_header() helpers, and shared imports come from the parent (mod.rs).
use super::*;

impl AbsClient {
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
            .send_refreshing(self)
            .await?;

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
            .send_refreshing(self)
            .await?;

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
            .send_refreshing(self)
            .await?;

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
            .get(format!("{}/api/libraries/{library_id}/items", self.root()))
            // Built with .query() rather than interpolated into the URL: standard
            // Base64 emits '+' and '/', and a '+' sitting raw in a query string
            // decodes server-side as a space — the filter then matches nothing and
            // an existing series reads as empty, which auto-play-next would take
            // for the end of the series.
            .query(&[("filter", format!("series.{encoded_id}"))])
            .header("Authorization", self.auth_header()?)
            .send_refreshing(self)
            .await?;

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
            .send_refreshing(self)
            .await?;

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
            .send_refreshing(self)
            .await?;

        if !resp.status().is_success() {
            return Err(format!("get_item failed: HTTP {}", resp.status()));
        }

        resp.json().await.map_err(|e| e.to_string())
    }

    /// DELETE /api/items/{item_id} — permanently removes the item from the library.
    pub async fn delete_item(&self, item_id: &str) -> Result<(), String> {
        let resp = self
            .http
            .delete(format!("{}/api/items/{item_id}", self.root()))
            .header("Authorization", self.auth_header()?)
            .send_refreshing(self)
            .await?;

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
            .send_refreshing(self)
            .await?;

        if !resp.status().is_success() {
            return Err(format!("rescan_item failed: HTTP {}", resp.status()));
        }

        Ok(())
    }
}

#[cfg(test)]
mod series_contract_tests {
    use super::*;
    use base64::Engine;
    use wiremock::matchers::{header, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    /// The series filter is the query auto-play-next depends on when the shelf
    /// cache lacks the rest of a series, and its encoding is the kind of detail
    /// that fails silently: ABS answers an unencoded id with an empty result
    /// set, which reads exactly like "the series is over". Pin the exact path,
    /// method, and Base64 form (standard alphabet, NOT url-safe).
    #[tokio::test]
    async fn series_items_query_sends_the_base64_encoded_filter() {
        let server = MockServer::start().await;
        // A series id with characters that differ between the two alphabets, so
        // a url-safe encoder would fail this test rather than pass by luck.
        let series_id = "ser_ff>?~1";
        let encoded = base64::engine::general_purpose::STANDARD.encode(series_id);
        assert!(encoded.contains('+') || encoded.contains('/'), "fixture must exercise the alphabet");

        Mock::given(method("GET"))
            .and(path("/api/libraries/lib1/items"))
            .and(query_param("filter", format!("series.{encoded}")))
            .and(header("Authorization", "Bearer tok"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "results": [{
                    "id": "b2",
                    "ino": "2",
                    "libraryId": "lib1",
                    "mediaType": "book",
                    "media": { "metadata": { "title": "Book 2" } },
                }],
            })))
            .mount(&server)
            .await;

        let client = AbsClient::new(server.uri()).with_token("tok".into());
        let items = client.get_series_items("lib1", series_id).await.unwrap();

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "b2");
    }

    /// An unreachable or erroring server must surface as an error, not as an
    /// empty series — the advance path treats "no items" as the end of a series
    /// and would quietly stop instead of falling back to the shelf cache.
    #[tokio::test]
    async fn a_server_error_is_not_an_empty_series() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/libraries/lib1/items"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;

        let client = AbsClient::new(server.uri()).with_token("tok".into());
        let err = client.get_series_items("lib1", "ser1").await.unwrap_err();
        assert!(err.contains("500"), "error should name the status: {err}");
    }
}
