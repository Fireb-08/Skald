use super::*;
use crate::models::TrackUpdateInput;
use futures_util::StreamExt;
use std::path::Path;
use tokio::io::AsyncWriteExt;

impl AbsClient {
    /// Build an item route while encoding both opaque IDs as URL path segments.
    /// Inode values are platform-dependent strings and must not be interpolated
    /// into a URL without encoding.
    fn item_route(&self, item_id: &str, tail: &[&str]) -> Result<reqwest::Url, String> {
        let mut url = reqwest::Url::parse(&format!("{}/api/items", self.root()))
            .map_err(|e| format!("invalid server URL: {e}"))?;
        {
            let mut segments = url
                .path_segments_mut()
                .map_err(|_| "server URL cannot hold path segments".to_string())?;
            segments.push(item_id);
            for segment in tail {
                segments.push(segment);
            }
        }
        Ok(url)
    }

    /// GET /api/items/{id}?expanded=1 — the detailed item/file payload used by
    /// the inspector. Kept separate from get_item so ordinary playback caching
    /// does not become heavier.
    pub async fn get_item_expanded(&self, item_id: &str) -> Result<LibraryItem, String> {
        let mut url = self.item_route(item_id, &[])?;
        url.query_pairs_mut().append_pair("expanded", "1");
        let resp = self
            .http
            .get(url)
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("get_item_expanded failed: HTTP {}", resp.status()));
        }
        resp.json().await.map_err(|e| e.to_string())
    }

    /// GET /api/items/{id}/ffprobe/{fileid} — admin-only fresh probe data.
    pub async fn get_audio_file_probe(
        &self,
        item_id: &str,
        file_id: &str,
    ) -> Result<serde_json::Value, String> {
        let resp = self
            .http
            .get(self.item_route(item_id, &["ffprobe", file_id])?)
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("get_audio_file_probe failed: HTTP {}", resp.status()));
        }
        resp.json().await.map_err(|e| e.to_string())
    }

    /// DELETE /api/items/{id}/file/{fileid}. ABS removes the physical file and
    /// updates the item before returning 200 and emitting item_updated.
    pub async fn delete_library_file(&self, item_id: &str, file_id: &str) -> Result<(), String> {
        let resp = self
            .http
            .delete(self.item_route(item_id, &["file", file_id])?)
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("delete_library_file failed: HTTP {}", resp.status()));
        }
        Ok(())
    }

    /// PATCH /api/items/{id}/tracks. Array order is the new playback order;
    /// excluded entries remain in the payload and receive index -1 server-side.
    pub async fn update_item_tracks(
        &self,
        item_id: &str,
        ordered_file_data: &[TrackUpdateInput],
    ) -> Result<LibraryItem, String> {
        let resp = self
            .http
            .patch(self.item_route(item_id, &["tracks"])?)
            .header("Authorization", self.auth_header()?)
            .json(&serde_json::json!({ "orderedFileData": ordered_file_data }))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("update_item_tracks failed: HTTP {}", resp.status()));
        }
        resp.json().await.map_err(|e| e.to_string())
    }

    /// Stream one item-owned file through ABS's permission-enforcing download
    /// route. A sibling partial file keeps failed downloads from masquerading as
    /// complete files at the user-selected destination.
    pub async fn download_library_file(
        &self,
        item_id: &str,
        file_id: &str,
        destination: &Path,
    ) -> Result<u64, String> {
        let resp = self
            .http
            .get(self.item_route(item_id, &["file", file_id, "download"])?)
            .header("Authorization", self.auth_header()?)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("download_library_file failed: HTTP {}", resp.status()));
        }

        let parent = destination
            .parent()
            .ok_or_else(|| "download destination has no parent directory".to_string())?;
        if !parent.is_dir() {
            return Err("download destination directory does not exist".to_string());
        }
        let partial = destination.with_file_name(format!(
            ".{}.skald-part",
            destination.file_name().and_then(|n| n.to_str()).unwrap_or("download")
        ));
        let _ = tokio::fs::remove_file(&partial).await;
        let mut output = tokio::fs::File::create(&partial)
            .await
            .map_err(|e| format!("create download file failed: {e}"))?;
        let mut stream = resp.bytes_stream();
        let mut written = 0u64;
        while let Some(chunk) = stream.next().await {
            let chunk = match chunk {
                Ok(chunk) => chunk,
                Err(e) => {
                    drop(output);
                    let _ = tokio::fs::remove_file(&partial).await;
                    return Err(format!("download stream failed: {e}"));
                }
            };
            if let Err(e) = output.write_all(&chunk).await {
                drop(output);
                let _ = tokio::fs::remove_file(&partial).await;
                return Err(format!("download write failed: {e}"));
            }
            written += chunk.len() as u64;
        }
        output.flush().await.map_err(|e| format!("download flush failed: {e}"))?;
        drop(output);
        if destination.exists() {
            tokio::fs::remove_file(destination)
                .await
                .map_err(|e| format!("replace existing download failed: {e}"))?;
        }
        tokio::fs::rename(&partial, destination)
            .await
            .map_err(|e| format!("finalize download failed: {e}"))?;
        Ok(written)
    }
}
