use serde::Deserialize;

use crate::models::{AdminUser, AuthSettings, BackupsResponse, Bookmark, Collection, CollectionsResponse, CreateLibraryPayload, CustomMetadataProvider, FsDirectory, Library, LibraryItem, LibrarySeries, LibraryStats, ListeningSession, ListeningSessionsResponse, ListeningStats, LoggerData, MediaItemShare, MeResponse, NotificationSettings, NotificationsResponse, PlaySession, Playlist, PlaylistItemInput, PlaylistsResponse, RssFeed, RssFeedsResponse, ServerSettings, TasksResponse, UpdateLibraryPayload, User, UserStats};

#[derive(Clone)]
pub struct AbsClient {
    pub base_url: String,
    pub token: Option<String>,
    pub http: reqwest::Client,
}

/// Shared HTTP client with bounded connect + read-stall timeouts, so a dead or
/// wedged endpoint fails a command predictably instead of pending forever.
/// read_timeout is per-read (stall detection), not a total-request cap, so
/// large library fetches and long streaming downloads stay unaffected as long
/// as bytes keep flowing. Used by AbsClient and by the one-off clients in
/// commands.rs (authorize, API-key login, remote images, item downloads).
pub fn bounded_client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .read_timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap_or_default()
}

/// MIME type for an upload part, by file extension. Covers the audio formats the
/// upload picker offers plus common extras (cover art, pdf/epub); anything else
/// falls back to application/octet-stream. The ABS server doesn't validate MIME
/// on /api/upload, but sending a truthful type is cheap and future-proof.
fn mime_for_upload(name: &str) -> &'static str {
    match name.rsplit('.').next().map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("mp3") => "audio/mpeg",
        Some("m4b") | Some("m4a") => "audio/mp4",
        Some("aac") => "audio/aac",
        Some("ogg") | Some("opus") => "audio/ogg",
        Some("flac") => "audio/flac",
        Some("wav") => "audio/wav",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("pdf") => "application/pdf",
        Some("epub") => "application/epub+zip",
        _ => "application/octet-stream",
    }
}

/// Text fields of the /api/upload multipart form (upload_media). The server
/// files the item under folder.path/author/series/title; author/series may be
/// empty (books only — podcasts never send them) and are then omitted.
pub struct UploadForm<'a> {
    pub library_id: &'a str,
    pub folder_id: &'a str,
    pub title: &'a str,
    pub author: &'a str,
    pub series: &'a str,
}

/// Sparse field set for PATCH /api/users/{id} (update_user). `None` omits the
/// field from the body entirely, so the server keeps its existing value.
pub struct UserPatch<'a> {
    pub username: Option<&'a str>,
    pub password: Option<&'a str>,
    pub user_type: Option<&'a str>,
    pub email: Option<&'a str>,
    pub is_active: Option<bool>,
    pub permissions: Option<serde_json::Value>,
}

impl AbsClient {
    pub fn new(base_url: String) -> Self {
        Self {
            base_url,
            token: None,
            http: bounded_client(),
        }
    }

    pub fn with_token(mut self, token: String) -> Self {
        self.token = Some(token);
        self
    }

    /// A client for the current signed-in session, holding a token that is not
    /// about to expire.
    ///
    /// This is the constructor authenticated commands should use. It replaces the
    /// former `load_token()` + `with_token()` pair everywhere, which means every
    /// API call now implicitly keeps the ABS 2.26 access token current — the
    /// refresh is single-flight and shared, so a burst of commands still causes
    /// at most one `/auth/refresh`.
    ///
    /// Errors only when there is no usable session at all (signed out, or a
    /// refresh token the server has rejected outright).
    pub async fn authenticated(base_url: String) -> Result<Self, String> {
        let tokens = crate::token_refresh::fresh_tokens(&base_url).await?;
        let token = tokens
            .effective()
            .ok_or_else(|| "Not authenticated: no token stored".to_string())?
            .to_string();
        Ok(Self::new(base_url).with_token(token))
    }

    fn root(&self) -> String {
        self.base_url.trim_end_matches('/').to_string()
    }

    fn auth_header(&self) -> Result<String, String> {
        self.token
            .as_ref()
            .map(|t| format!("Bearer {t}"))
            .ok_or_else(|| "No auth token configured".to_string())
    }

    /// Send a request, refreshing and retrying **once** if the server rejects the
    /// token.
    ///
    /// The retry is a safety net, not the main mechanism — `authenticated()`
    /// normally refreshes before a token can go stale. It exists for the cases
    /// expiry maths cannot predict: a session revoked server-side, a password
    /// changed on another device, or a clock that disagrees with the server's.
    /// Its real value is that a 401 those produce now ends in `auth-expired` and
    /// a trip to Login, instead of a generic error on a screen that looks signed
    /// in but no longer works.
    ///
    /// It never loops: one refresh, one retry, then the caller sees the 401.
    async fn execute_refreshing(
        &self,
        builder: reqwest::RequestBuilder,
    ) -> Result<reqwest::Response, String> {
        // Snapshot for the retry before the body is consumed. `try_clone` returns
        // None for streaming bodies (the multipart uploads), which simply means
        // those do not get retried — re-reading a consumed stream is not possible.
        let retry = builder.try_clone();

        let resp = builder.send().await.map_err(|e| e.to_string())?;
        if resp.status() != reqwest::StatusCode::UNAUTHORIZED {
            return Ok(resp);
        }

        let Some(retry) = retry else { return Ok(resp) };

        let sent_with = self.token.clone().unwrap_or_default();
        // A terminal rejection propagates: force_refresh has already emitted
        // auth-expired, and surfacing its message beats a bare 401.
        let refreshed = crate::token_refresh::force_refresh(&self.base_url).await?;
        let new_token = match refreshed.effective() {
            // An unchanged token means there was nothing to refresh (legacy
            // session, old server). Retrying would reproduce the same 401.
            Some(t) if t != sent_with => t.to_string(),
            _ => return Ok(resp),
        };

        // Rebuild rather than re-running the caller's chain: `insert` replaces the
        // stale Authorization header, where RequestBuilder::header would append a
        // second one and send both.
        let mut request = retry.build().map_err(|e| e.to_string())?;
        request.headers_mut().insert(
            reqwest::header::AUTHORIZATION,
            reqwest::header::HeaderValue::from_str(&format!("Bearer {new_token}"))
                .map_err(|e| e.to_string())?,
        );

        log::info!(target: "skald::auth", "retrying request after 401 with a refreshed token");
        self.http.execute(request).await.map_err(|e| e.to_string())
    }
}

/// Lets an endpoint method end its builder chain with `.send_refreshing(self)`
/// in place of `.send().await.map_err(...)`.
///
/// A free-standing adapter rather than an inherent method so the 105 endpoint
/// methods keep reading as one uninterrupted builder chain. That matters: the
/// retry is only useful if it is the path of least resistance, and a form that
/// required rewriting each method to wrap its chain in a call is a form that
/// would get skipped.
pub trait SendRefreshing {
    fn send_refreshing(
        self,
        client: &AbsClient,
    ) -> impl std::future::Future<Output = Result<reqwest::Response, String>> + Send + '_;
}

impl SendRefreshing for reqwest::RequestBuilder {
    async fn send_refreshing(self, client: &AbsClient) -> Result<reqwest::Response, String> {
        client.execute_refreshing(self).await
    }
}

// AbsClient's endpoint methods live in one impl block per feature domain —
// inherent impls resolve crate-wide, so callers still just use crate::api::AbsClient.
mod admin;
mod auth;
pub use auth::RefreshError;
mod collections;
mod files;
mod library;
mod metadata;
mod playback;
mod podcasts;
mod sessions;
mod sharing;
mod upload;
mod users;
