// Split from the original single-file api.rs (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. AbsClient, its private root()/
// auth_header() helpers, and shared imports come from the parent (mod.rs).
use super::*;

impl AbsClient {
    /// POST /api/upload (multipart) — upload media files into a library folder as
    /// a new item (MiscController.handleUpload). Requires canUpload (403 otherwise).
    /// The server files them under folder.path/author/series/title (books) or
    /// folder.path/title (podcasts) and relies on the library watcher to scan the
    /// new directory in — no scan is triggered by the endpoint itself.
    ///
    /// File bodies are STREAMED (never read whole audiobooks into memory): each
    /// part wraps a ReaderStream over the file, with a byte-counting map that
    /// reports cumulative bytes sent via `on_progress` and aborts the request by
    /// erroring the stream once `cancel` fires. express-fileupload on the server
    /// side uses temp files, so multi-GB uploads are fine end to end.
    ///
    /// Part names are the file index ("0", "1", …) — the server reads
    /// Object.values(req.files) and ignores the names.
    pub async fn upload_media(
        &self,
        form_fields: UploadForm<'_>,
        file_paths: &[String],
        cancel: tokio_util::sync::CancellationToken,
        on_progress: impl Fn(u64) + Clone + Send + Sync + 'static,
    ) -> Result<(), String> {
        let UploadForm { library_id, folder_id, title, author, series } = form_fields;
        use futures_util::StreamExt;
        use std::sync::atomic::{AtomicU64, Ordering};
        use std::sync::Arc;
        use tokio_util::io::ReaderStream;

        let mut form = reqwest::multipart::Form::new()
            .text("title", title.to_string())
            .text("library", library_id.to_string())
            .text("folder", folder_id.to_string());
        // Falsy parts are dropped from the destination path server-side; omit
        // empties so the intent is explicit (books only — podcasts never send them).
        if !author.is_empty() {
            form = form.text("author", author.to_string());
        }
        if !series.is_empty() {
            form = form.text("series", series.to_string());
        }

        // Cumulative bytes sent across ALL file parts — reqwest sends parts in
        // order, so one shared counter yields a single monotonic progress value.
        let sent = Arc::new(AtomicU64::new(0));

        for (i, path) in file_paths.iter().enumerate() {
            let file = tokio::fs::File::open(path)
                .await
                .map_err(|e| format!("open {path} failed: {e}"))?;
            let len = file
                .metadata()
                .await
                .map_err(|e| format!("stat {path} failed: {e}"))?
                .len();
            let name = std::path::Path::new(path)
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| format!("file{i}"));
            let mime = mime_for_upload(&name);

            let sent = Arc::clone(&sent);
            let cancel = cancel.clone();
            let on_progress = on_progress.clone();
            let stream = ReaderStream::new(file).map(move |chunk| {
                // Erroring the stream is the only way to abort a request mid-body:
                // reqwest surfaces it as a send() error, which the command layer
                // reclassifies as a cancel (it holds the same token).
                if cancel.is_cancelled() {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::Interrupted,
                        "upload cancelled",
                    ));
                }
                if let Ok(c) = &chunk {
                    let total = sent.fetch_add(c.len() as u64, Ordering::Relaxed) + c.len() as u64;
                    on_progress(total);
                }
                chunk
            });

            // stream_with_length (not stream) so the request carries a correct
            // Content-Length — required for the server to pre-size temp files and
            // for our totalBytes-based progress bar to be truthful.
            let part = reqwest::multipart::Part::stream_with_length(
                reqwest::Body::wrap_stream(stream),
                len,
            )
            .file_name(name)
            .mime_str(mime)
            .map_err(|e| e.to_string())?;
            form = form.part(i.to_string(), part);
        }

        // bounded_client's 30 s read_timeout is a response-read stall cap; it does
        // not bound the (arbitrarily long) body send, so multi-GB uploads are safe.
        let resp = self
            .http
            .post(format!("{}/api/upload", self.root()))
            .header("Authorization", self.auth_header()?)
            .multipart(form)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            // Include the response body — ABS returns plain-text reasons here
            // (e.g. "Invalid request body", folder/library mismatch).
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("upload failed: HTTP {status} {body}").trim_end().to_string());
        }
        Ok(())
    }
}
