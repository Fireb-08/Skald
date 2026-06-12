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

/// A named LibVLC built-in EQ preset.
#[derive(Debug, Serialize)]
pub struct EqPreset {
    pub index: u32,
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

/// A single series returned by GET /api/libraries/{id}/series.
/// The series endpoint returns each series with its books array already populated.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySeries {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub name_ignore_prefix: String,
    #[serde(default)]
    pub num_books: u32,
    /// Books belonging to this series — populated by the series endpoint directly.
    #[serde(default)]
    pub books: Vec<LibraryItem>,
}

/// Wrapper for GET /api/libraries/{id}/series response.
#[derive(Debug, Deserialize)]
pub struct LibrarySeriesResponse {
    pub results: Vec<LibrarySeries>,
}

/// A single directory entry returned by GET /api/filesystem.
/// ABS response shape: { path: "/audiobooks", dirname: "audiobooks", level: 0 }
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FsEntry {
    pub path: String,
    pub dirname: String,
    #[serde(default)]
    pub level: i32,
}

/// Response from GET /api/filesystem?path={path}.
/// Top-level has no path/fullPath — only `posix` and `directories`.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FsDirectory {
    #[serde(default)]
    pub posix: bool,
    #[serde(default)]
    pub directories: Vec<FsEntry>,
}

/// A single folder path attached to a library (response shape).
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFolder {
    #[serde(default)]
    pub id: Option<String>,
    pub full_path: String,
    #[serde(default)]
    pub library_id: Option<String>,
    #[serde(default)]
    pub added_at: Option<i64>,
}

/// Per-library settings block — used for both reading (GET) and writing (POST/PATCH).
/// All fields are Option so missing keys deserialize as None (reading).
/// skip_serializing_if ensures None fields are omitted from request bodies (writing)
/// so ABS never receives null for fields it validates as typed (e.g. coverAspectRatio).
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover_aspect_ratio: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disable_watcher: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_scan_cron_expression: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audiobooks_only: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hide_single_book_series: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub only_show_later_books_in_continue_series: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skip_matching_media_with_asin: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skip_matching_media_with_isbn: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata_precedence: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mark_as_finished_percent_complete: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mark_as_finished_time_remaining: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub podcast_search_region: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub epubs_allow_scripted_content: Option<bool>,
}

/// A single Audiobookshelf library — full shape from GET /api/libraries.
/// All fields beyond id/name/mediaType use #[serde(default)] so the struct
/// also deserialises correctly from minimal responses that omit them.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Library {
    pub id: String,
    pub name: String,
    pub media_type: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub display_order: Option<i32>,
    #[serde(default)]
    pub folders: Vec<LibraryFolder>,
    #[serde(default)]
    pub settings: Option<LibrarySettings>,
    #[serde(default)]
    pub last_scan: Option<i64>,
    #[serde(default)]
    pub created_at: Option<i64>,
    #[serde(default)]
    pub last_update: Option<i64>,
}

/// Minimal folder path entry used in create/update request bodies.
/// Only fullPath is required; the server assigns id and libraryId.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FolderInput {
    pub full_path: String,
}

/// Request body for POST /api/libraries.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CreateLibraryPayload {
    pub name: String,
    pub media_type: String,
    pub folders: Vec<FolderInput>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settings: Option<LibrarySettings>,
}

/// Request body for PATCH /api/libraries/:id — all fields optional.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLibraryPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folders: Option<Vec<FolderInput>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settings: Option<LibrarySettings>,
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

/// Nested user object returned inside sessions from GET /api/sessions (all-users endpoint).
/// Per-user endpoints omit this object; the flat `username` field covers those cases.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionUser {
    /// Username of the account that owns the session.
    #[serde(default)]
    pub username: Option<String>,
}

/// Device info block embedded in a ListeningSession — client name and a
/// human-readable device description string (browser + OS or app name).
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    #[serde(default)]
    pub client_name: Option<String>,
    /// ABS may not include this field on older versions — default to None.
    #[serde(default)]
    pub device_description: Option<String>,
}

/// A single listening session row from GET /api/me/listening-sessions or
/// GET /api/users/{id}/listening-sessions.
/// Field names use serde renames where ABS's JSON keys differ from the
/// snake_case Rust names that camelCase would produce.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ListeningSession {
    pub id: String,
    /// ABS uses "libraryItemId"; rename so the Rust field stays descriptive.
    #[serde(rename = "libraryItemId", default)]
    pub book_id: Option<String>,
    #[serde(default)]
    pub display_title: Option<String>,
    /// ABS uses "displayAuthor"; rename so the struct field stays generic.
    #[serde(rename = "displayAuthor", default)]
    pub author: Option<String>,
    #[serde(default)]
    pub user_id: String,
    /// Not present in every endpoint response — optional for forward compatibility.
    #[serde(default)]
    pub username: Option<String>,
    /// 0=DirectPlay, 1=DirectStream, 2=Transcode, 3=Local.
    #[serde(default)]
    pub play_method: Option<i32>,
    #[serde(default)]
    pub device_info: Option<DeviceInfo>,
    /// Total seconds listened in this session.
    #[serde(default)]
    pub time_listening: Option<f64>,
    /// Current playback position in seconds.
    #[serde(default)]
    pub current_time: Option<f64>,
    /// Unix millisecond timestamp of last update — used to detect open sessions.
    #[serde(default)]
    pub updated_at: Option<i64>,
    /// Nested user object — present only in GET /api/sessions (all-users) responses.
    /// Per-user endpoints omit it; use the flat `username` field for those.
    #[serde(default)]
    pub user: Option<SessionUser>,
}

/// Paginated response from GET /api/me/listening-sessions or
/// GET /api/users/{id}/listening-sessions.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ListeningSessionsResponse {
    #[serde(default)]
    pub sessions: Vec<ListeningSession>,
    /// Total number of sessions across all pages.
    #[serde(default)]
    pub total: u32,
    /// Total number of pages at the requested itemsPerPage.
    #[serde(default)]
    pub num_pages: u32,
    #[serde(default)]
    pub items_per_page: u32,
}

/// Global server settings — returned inside the login response under `serverSettings`
/// and fetchable via GET /api/settings. All fields are Option so missing keys
/// (e.g. on older ABS versions) deserialise as None without failing.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ServerSettings {
    // ── Scanner ──────────────────────────────────────────────────────────────
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scanner_find_covers: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scanner_cover_provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scanner_parse_subtitle: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scanner_prefer_matched_metadata: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scanner_disable_watcher: Option<bool>,
    // ── Metadata storage ─────────────────────────────────────────────────────
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub store_cover_with_item: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub store_metadata_with_item: Option<bool>,
    // ── Sorting ──────────────────────────────────────────────────────────────
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sorting_ignore_prefix: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sorting_prefixes: Option<Vec<String>>,
    // ── Podcasts ─────────────────────────────────────────────────────────────
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub podcast_episode_schedule: Option<String>,
    // ── Chromecast ───────────────────────────────────────────────────────────
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chromecast_enabled: Option<bool>,
    // ── Logging ──────────────────────────────────────────────────────────────
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub log_level: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub logger_daily_logs_to_keep: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub logger_scanner_logs_to_keep: Option<i32>,
}

/// Minimal item reference used in create/update/batch playlist request bodies.
/// `episode_id` is omitted from the JSON when None (book playlists have no episode).
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistItemInput {
    pub library_item_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub episode_id: Option<String>,
}

/// A single item inside a playlist response — book or podcast episode.
/// `library_item` is populated when the server returns expanded item data.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistItem {
    pub library_item_id: String,
    #[serde(default)]
    pub episode_id: Option<String>,
    #[serde(default)]
    pub library_item: Option<LibraryItem>,
}

/// A user playlist — private to the owning user, unlike collections which are library-wide.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub library_id: String,
    pub user_id: String,
    #[serde(default)]
    pub items: Vec<PlaylistItem>,
    pub last_update: i64,
    pub created_at: i64,
}

/// Wrapper for GET /api/libraries/{id}/playlists response.
#[derive(Debug, Deserialize)]
pub struct PlaylistsResponse {
    pub results: Vec<Playlist>,
    #[serde(default)]
    pub total: u32,
}
