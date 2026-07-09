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

    fn root(&self) -> String {
        self.base_url.trim_end_matches('/').to_string()
    }

    fn auth_header(&self) -> Result<String, String> {
        self.token
            .as_ref()
            .map(|t| format!("Bearer {t}"))
            .ok_or_else(|| "No auth token configured".to_string())
    }

}

// AbsClient's endpoint methods live in one impl block per feature domain —
// inherent impls resolve crate-wide, so callers still just use crate::api::AbsClient.
mod admin;
mod auth;
mod collections;
mod library;
mod metadata;
mod playback;
mod podcasts;
mod sessions;
mod sharing;
mod upload;
mod users;
