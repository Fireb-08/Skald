use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Treat a JSON `null` the same as a missing key: use T::default().
fn null_as_default<'de, D, T>(d: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Default + Deserialize<'de>,
{
    Ok(Option::<T>::deserialize(d)?.unwrap_or_default())
}

/// An audio output device returned by LibVLC.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
}

/// Stored server connection — url and auth token.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    pub url: String,
    pub token: String,
}

/// User record from /api/me or /login.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    pub username: String,
    pub token: String,
    pub email: Option<String>,
    pub is_active: bool,
    /// "root" | "admin" | "user" | "guest"
    #[serde(rename = "type", default)]
    pub user_type: Option<String>,
}

/// Minimal book entry nested inside a collection response.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CollectionBook {
    pub id: String,
}

/// A single collection inside a library.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub books: Vec<CollectionBook>,
}

/// Wrapper for GET /api/libraries/{id}/collections response.
#[derive(Debug, Deserialize)]
pub struct CollectionsResponse {
    pub results: Vec<Collection>,
}

/// A single Audiobookshelf library.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Library {
    pub id: String,
    pub name: String,
    pub media_type: String,
}

/// Metadata block inside a LibraryFile entry.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileMetadata {
    pub filename: String,
    #[serde(default)]
    pub size: i64,
    #[serde(default)]
    pub path: Option<String>,
}

/// A single physical file attached to a library item.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFile {
    pub ino: String,
    pub metadata: FileMetadata,
    pub file_type: String,
}

/// Top-level library item (book file entry).
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LibraryItem {
    pub id: String,
    pub ino: String,
    pub library_id: String,
    pub media: BookMedia,
    #[serde(default)]
    pub library_files: Option<Vec<LibraryFile>>,
}

/// Book media payload — metadata + playback data.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BookMedia {
    pub metadata: BookMetadata,
    #[serde(default, deserialize_with = "null_as_default")]
    pub chapters: Vec<Chapter>,
    #[serde(default, deserialize_with = "null_as_default")]
    pub audio_files: Vec<Value>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub ebook_file: Option<Value>,
    #[serde(default)]
    pub duration: f64,
}

/// The `author` field varies across endpoints: plain string in minified
/// responses, a single object or array of objects in expanded responses.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(untagged)]
pub enum AuthorField {
    Name(String),
    Object(AuthorObject),
    Array(Vec<AuthorObject>),
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AuthorObject {
    pub id: String,
    pub name: String,
}

/// Book-level metadata. `author_name` uses AuthorField to handle the
/// string/object/array variance documented in CLAUDE.md critical lesson 5.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BookMetadata {
    pub title: Option<String>,
    pub subtitle: Option<String>,
    pub author_name: Option<AuthorField>,
    pub narrator_name: Option<String>,
    pub series_name: Option<String>,
    #[serde(default)]
    pub genres: Vec<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub publisher: Option<String>,
    #[serde(default)]
    pub published_year: Option<String>,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub isbn: Option<String>,
    #[serde(default)]
    pub isbn10: Option<String>,
    #[serde(default)]
    pub isbn13: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub id: i64,
    pub start: f64,
    pub end: f64,
    pub title: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AudioFile {
    pub index: i64,
    pub start_offset: f64,
    pub duration: f64,
    pub title: String,
    pub content_url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MediaProgress {
    pub id: String,
    pub library_item_id: String,
    pub episode_id: Option<String>,
    pub duration: f64,
    pub progress: f64,
    pub current_time: f64,
    pub is_finished: bool,
    pub last_update: i64,
}

/// Subset of the /api/me response that Skald needs.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MeResponse {
    pub id: String,
    pub username: String,
    pub token: String,
    #[serde(default)]
    pub media_progress: Vec<MediaProgress>,
    #[serde(default)]
    pub bookmarks: Vec<Bookmark>,
    /// "root" | "admin" | "user" | "guest"
    #[serde(rename = "type", default)]
    pub user_type: Option<String>,
}

/// Minimal per-book entry inside the listening-stats `items` map.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ListeningStatItem {
    pub id: String,
    pub time_listening: f64,
}

/// Response from /api/users/{id}/listening-stats.
/// Fields match the actual ABS 2.x response — no booksFinished/daysListened.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ListeningStats {
    pub total_time: f64,
    #[serde(default)]
    pub today: f64,
    /// Keys are library-item IDs; we only need the count on the frontend.
    #[serde(default)]
    pub items: HashMap<String, ListeningStatItem>,
    /// Keys are ISO date strings; count gives distinct listening days.
    #[serde(default)]
    pub days: HashMap<String, f64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    pub library_item_id: String,
    pub title: String,
    pub time: f64,
}

/// A user record returned by the admin-only GET /api/users, POST /api/users,
/// and PATCH /api/users/{id} endpoints. Kept separate from the auth `User`
/// struct because these responses do not include a token and add management-
/// specific timestamps that the login response omits.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AdminUser {
    pub id: String,
    pub username: String,
    /// "root" | "admin" | "user" | "guest"
    /// `rename` overrides camelCase so the JSON key stays "type", matching ABS.
    #[serde(rename = "type")]
    pub user_type: String,
    /// Unix ms of the user's last sign-in; null if they have never signed in.
    pub last_seen: Option<i64>,
    /// Unix ms when the account was created.
    pub created_at: Option<i64>,
    pub is_active: Option<bool>,
    /// Library-item ID the user is currently reading, if any.
    pub current_book_id: Option<String>,
}

/// Response from POST /api/items/{id}/play — the active playback session.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlaySession {
    pub id: String,
    pub current_time: f64,
    #[serde(default)]
    pub audio_tracks: Vec<AudioFile>,
}

/// A single session entry in the recentSessions array from GET /api/me/listening-stats.
/// Only the fields the GreetingPane needs are captured; extras are silently ignored.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UserStatsSession {
    pub id: String,
    /// Book title as formatted by the ABS server.
    #[serde(default)]
    pub display_title: Option<String>,
    /// Seconds listened in this session.
    #[serde(default)]
    pub time_listening: f64,
    /// Session date as "YYYY-MM-DD".
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub library_item_id: String,
}

/// Response from GET /api/me/listening-stats — richer than the per-user endpoint
/// and includes finished-book count, per-day totals, and recent sessions.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UserStats {
    /// Total listening time across all history, in seconds.
    #[serde(default)]
    pub total_time: f64,
    /// Number of distinct calendar days with any listening activity.
    #[serde(default)]
    pub num_days_listened: i64,
    /// Number of items marked finished.
    #[serde(default)]
    pub num_books_finished: i64,
    /// Number of distinct items ever listened to.
    #[serde(default)]
    pub num_books_listened: i64,
    /// Up to 3 most recent listening sessions for the Recent sessions list.
    #[serde(default)]
    pub recent_sessions: Vec<UserStatsSession>,
    /// Map of "YYYY-MM-DD" → seconds listened; drives the 7-day sparkline.
    #[serde(default)]
    pub days: HashMap<String, f64>,
}

/// A single genre entry from GET /api/libraries/{id}/stats.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GenreStat {
    pub genre: String,
    /// Number of items tagged with this genre.
    #[serde(default)]
    pub count: i64,
}

/// Response from GET /api/libraries/{id}/stats — used for the Library stats page.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStats {
    /// Total number of items in the library.
    #[serde(default)]
    pub total_items: i64,
    /// Number of distinct authors.
    #[serde(default)]
    pub total_authors: i64,
    /// Sum of all audio-track durations, in seconds.
    #[serde(default)]
    pub total_duration: f64,
    /// Total number of audio tracks across all items.
    #[serde(default)]
    pub num_audio_tracks: i64,
    /// Sum of all audio-file sizes, in bytes.
    #[serde(default)]
    pub total_audio_files_size: i64,
    /// Top genres by item count, ordered descending.
    #[serde(default)]
    pub genres: Vec<GenreStat>,
}
