use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;

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

/// A registered custom metadata provider (ABS v2.8+). Slug is `custom-{id}` and
/// is the value used as a library's `provider` or in a match search.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CustomMetadataProvider {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub media_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_header_value: Option<String>,
    #[serde(default)]
    pub slug: String,
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

/// Default media type for a library item when the server omits the field
/// (older/minified payloads). Book is the historical default.
fn default_book_media_type() -> String {
    "book".to_string()
}

/// Top-level library item, covering both book and podcast media.
///
/// `media` is intentionally kept as raw JSON rather than a typed struct: the
/// Rust backend treats library items as pass-through and never destructures
/// `media`, while the frontend narrows it to a discriminated union on
/// `mediaType`. A typed `BookMedia` here would silently drop podcast-only
/// fields (notably `episodes[]`), and an `#[serde(untagged)]` enum can't
/// discriminate because every podcast payload also structurally matches the
/// all-optional book shape — the only reliable tag (`mediaType`) lives on the
/// item, not inside `media`. So we forward `media` verbatim and let TypeScript
/// own the shape. (Podcast cluster E — see the Podcasts roadmap.)
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LibraryItem {
    pub id: String,
    pub ino: String,
    pub library_id: String,
    /// ABS exposes its library-item `createdAt` database value as `addedAt`.
    /// Keep it so source-agnostic shelves can reproduce ABS's recent ordering.
    #[serde(default)]
    pub added_at: Option<i64>,
    /// "book" | "podcast". Defaulted to "book" for payloads that omit it.
    #[serde(default = "default_book_media_type")]
    pub media_type: String,
    pub media: Value,
    #[serde(default)]
    pub library_files: Option<Vec<LibraryFile>>,
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
    /// Full permissions object (User.toOldJSONForBrowser includes it) — lets the
    /// frontend gate the Upload affordance without an extra request.
    #[serde(default)]
    pub permissions: Option<UserPermissions>,
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
    /// Optional email address (admin user-management). Absent on older servers.
    #[serde(default)]
    pub email: Option<String>,
    /// Library-item ID the user is currently reading, if any.
    pub current_book_id: Option<String>,
    // ── Access control (cluster H) ───────────────────────────────────────────
    /// Full permissions object. Present on GET /api/users/:id; may be absent on
    /// the list endpoint depending on ABS version.
    #[serde(default)]
    pub permissions: Option<UserPermissions>,
    /// Libraries this user may access. ABS serializes this as a TOP-LEVEL user key
    /// (not inside `permissions`); honored only when `accessAllLibraries` is false.
    #[serde(default)]
    pub libraries_accessible: Vec<String>,
    /// Item tags selected for tag-based access. Also TOP-LEVEL in the user JSON;
    /// honored only when `accessAllTags` is false.
    #[serde(default)]
    pub item_tags_selected: Vec<String>,
}

/// A user's permissions object — server/models/User.js `getDefaultPermissionsForUserType`.
/// NOTE: in the API's user JSON, `librariesAccessible`/`itemTagsSelected` are split
/// out to TOP-LEVEL keys on the user (see `AdminUser`), so they normally arrive
/// empty here. They are kept on this struct so the same object can be sent back
/// nested on `PATCH /api/users/:id` — the update handler accepts them either way.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct UserPermissions {
    #[serde(default)] pub download: bool,
    #[serde(default)] pub update: bool,
    #[serde(default)] pub delete: bool,
    #[serde(default)] pub upload: bool,
    #[serde(default)] pub create_ereader: bool,
    #[serde(default)] pub access_all_libraries: bool,
    #[serde(default)] pub access_all_tags: bool,
    #[serde(default)] pub access_explicit_content: bool,
    /// false = inclusive (only the selected tags); true = exclusive (all but them).
    #[serde(default)] pub selected_tags_not_accessible: bool,
    #[serde(default)] pub libraries_accessible: Vec<String>,
    #[serde(default)] pub item_tags_selected: Vec<String>,
}

/// Minimal view of GET /api/auth-settings (admin-only). Only the fields the
/// read-only "SSO configured" indicator needs are modelled; OIDC is enabled iff
/// `auth_active_auth_methods` contains "openid".
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AuthSettings {
    #[serde(default)]
    pub auth_active_auth_methods: Vec<String>,
    #[serde(default)]
    pub auth_open_id_issuer_url: Option<String>,
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
    // ── Backups ──────────────────────────────────────────────────────────────
    // backupSchedule is a cron string when enabled, or boolean `false` when
    // disabled — hence Value rather than String. backupsToKeep is a count;
    // maxBackupSize is in GB (may be fractional, so f64).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backup_schedule: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backups_to_keep: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_backup_size: Option<f64>,
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

// ── Notification settings (Apprise) ──────────────────────────────────────────
// ABS fires event-driven notifications (podcast downloaded, backup completed,
// RSS feed failed, …) through an EXTERNAL Apprise API server — it does not embed
// Apprise. `appriseApiUrl` must point at a reachable apprise-api `/notify`
// endpoint or nothing fires. Shapes verified against the ABS GitHub source:
//   server/objects/settings/NotificationSettings.js
//   server/objects/Notification.js
//   server/utils/notifications.js   (the event catalog)
// All endpoints are admin-only (403 otherwise).

/// Global notification configuration (GET /api/notifications → `settings`).
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NotificationSettings {
    #[serde(default)]
    pub id: String,
    /// Transport type — currently always "api" (the Apprise API server mode).
    #[serde(default)]
    pub apprise_type: String,
    /// URL of the external Apprise API server's notify endpoint. None until set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub apprise_api_url: Option<String>,
    /// Configured notification rules.
    #[serde(default)]
    pub notifications: Vec<Notification>,
    /// How many consecutive failures before a notification is auto-disabled.
    #[serde(default)]
    pub max_failed_attempts: i32,
    /// Max queued notifications before new ones are dropped.
    #[serde(default)]
    pub max_notification_queue: i32,
    /// Minimum delay between dispatched notifications, in milliseconds.
    #[serde(default)]
    pub notification_delay: i32,
}

/// A single configured notification rule.
/// Read-only status fields (last_fired_at, …) use `skip_serializing_if` so the
/// create/update payloads we send back to ABS stay minimal.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// Required when the event's `requiresLibrary` is true; otherwise null.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub library_id: Option<String>,
    /// One of the event names from the catalog (e.g. "onBackupCompleted").
    #[serde(default)]
    pub event_name: String,
    /// Apprise target URLs (e.g. "discord://…", "tgram://…").
    #[serde(default)]
    pub urls: Vec<String>,
    #[serde(default)]
    pub title_template: String,
    #[serde(default)]
    pub body_template: String,
    #[serde(default)]
    pub enabled: bool,
    /// Apprise message type: "info" | "warning" | "success". `type` is a Rust
    /// keyword, so the field is `kind` with a serde rename.
    #[serde(rename = "type", default)]
    pub kind: String,
    // ── Read-only status (returned by ABS, never sent in create/update) ──────
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_fired_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_attempt_failed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub num_consecutive_failed_attempts: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub num_times_fired: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<i64>,
}

/// Read-only catalog entry describing an available notification event
/// (GET /api/notifications → `data.events`). Drives the event dropdown and the
/// template-variable hints in the UI.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NotificationEventData {
    pub name: String,
    #[serde(default)]
    pub requires_library: bool,
    #[serde(default)]
    pub description: String,
    /// Template variables available for this event (e.g. "podcastTitle").
    #[serde(default)]
    pub variables: Vec<String>,
    /// ABS nests the default templates under a `defaults` object.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub defaults: Option<NotificationEventDefaults>,
}

/// Default title/body templates suggested for an event.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NotificationEventDefaults {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub body: String,
}

/// Response shape of GET /api/notifications: the live settings plus the
/// read-only event catalog used to populate the editor.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NotificationsResponse {
    pub settings: NotificationSettings,
    /// ABS returns the catalog under `data` (with an `events` array inside).
    #[serde(default)]
    pub data: NotificationData,
}

/// The `data` portion of GET /api/notifications — the event catalog.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct NotificationData {
    #[serde(default)]
    pub events: Vec<NotificationEventData>,
}

// ── Backups ──────────────────────────────────────────────────────────────────
// ABS snapshots its database + metadata (NOT the audio files) into
// `.audiobookshelf` archives. Shapes verified against server/objects/Backup.js
// and BackupController.getAll. All backup endpoints are admin-only.

/// One backup archive on the server.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    pub id: String,
    /// "sqlite" for current backups, null for legacy ones.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(default)]
    pub date_pretty: String,
    #[serde(default)]
    pub backup_dir_path: String,
    #[serde(default)]
    pub filename: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub full_path: String,
    /// Archive size in bytes.
    #[serde(default)]
    pub file_size: i64,
    /// Creation time, ms since epoch.
    #[serde(default)]
    pub created_at: i64,
    /// ABS version that wrote the backup.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_version: Option<String>,
}

/// Response shape of GET /api/backups.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupsResponse {
    #[serde(default)]
    pub backups: Vec<Backup>,
    /// Directory on the server where backups are written.
    #[serde(default)]
    pub backup_location: String,
    /// True when the backup path is fixed by an env var (not editable in-app).
    #[serde(default)]
    pub backup_path_env_set: bool,
}

// ── Tasks ────────────────────────────────────────────────────────────────────
// GET /api/tasks returns all current + recently-finished background operations
// (library scans, metadata embeds, m4b encodes, backups, …). Shapes verified
// against server/objects/Task.js. Newer ABS uses i18n keys (titleKey/…); we keep
// both the plain string and the key so the UI can fall back to whichever is set.

/// One background task reported by the server.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    #[serde(default)]
    pub action: String,
    #[serde(default)]
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title_key: Option<String>,
    #[serde(default)]
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_key: Option<String>,
    /// running = !is_finished.
    #[serde(default)]
    pub is_finished: bool,
    #[serde(default)]
    pub is_failed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<i64>,
}

/// Response shape of GET /api/tasks.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TasksResponse {
    #[serde(default)]
    pub tasks: Vec<Task>,
}

// ── Server logs ──────────────────────────────────────────────────────────────
// GET /api/logger-data returns the current day's recent log entries; the same
// LogEntry shape is also pushed live over the socket as 'log' events. Verified
// against server/Logger.js. Admin-only. LogLevel numerics (utils/constants.js):
// TRACE=0, DEBUG=1, INFO=2, WARN=3, ERROR=4, FATAL=5, NOTE=6.

/// One server log line.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    #[serde(default)]
    pub timestamp: String,
    /// File:line that emitted the log.
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub message: String,
    /// TRACE / DEBUG / INFO / WARN / ERROR / FATAL / NOTE.
    #[serde(default)]
    pub level_name: String,
    /// Numeric level (matches the LogLevel constants).
    #[serde(default)]
    pub level: i32,
}

/// Response shape of GET /api/logger-data — the current day's recent entries.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LoggerData {
    #[serde(default)]
    pub current_daily_logs: Vec<LogEntry>,
}

// ── Sharing & RSS feeds (cluster G) ──────────────────────────────────────────
// Admin-only public surfaces. Routes verified against server/routers/ApiRouter.js
// → ShareController / RSSFeedController; response shapes against
// server/models/MediaItemShare.js (toJSONForClient) and server/models/Feed.js
// (toOldJSON). Request bodies are built inline in api.rs (matching the
// create_collection convention); these structs cover only the response shapes.

/// A media-item share link — the object returned by POST /api/share/mediaitem
/// (MediaItemShare.toJSONForClient). `userId`/`pash`/`extraData` are server-only
/// and omitted by ABS. The date fields arrive as ISO strings (Sequelize DATE →
/// JSON.stringify), so they are kept as raw strings; `expiresAt` is null for a
/// share that never expires.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MediaItemShare {
    pub id: String,
    pub slug: String,
    pub media_item_id: String,
    /// "book" | "podcastEpisode".
    pub media_item_type: String,
    #[serde(default)]
    pub is_downloadable: bool,
    #[serde(default)]
    pub expires_at: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

/// The `meta` block of an RSS feed (Feed.toOldJSON().meta). Only the fields the
/// Feed Manager surfaces are modelled; unknown keys are ignored by serde.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RssFeedMeta {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub image_url: Option<String>,
    #[serde(default)]
    pub explicit: bool,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub prevent_indexing: bool,
    #[serde(default)]
    pub owner_name: Option<String>,
    #[serde(default)]
    pub owner_email: Option<String>,
}

/// An open RSS feed — Feed.toOldJSON(). `entityType` is "libraryItem" |
/// "collection" | "series"; `feedUrl` is the public, unauthenticated URL. The
/// per-episode array is not modelled (the Feed Manager only lists/closes feeds).
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RssFeed {
    pub id: String,
    #[serde(default)]
    pub slug: String,
    /// "libraryItem" | "collection" | "series".
    #[serde(default)]
    pub entity_type: String,
    #[serde(default)]
    pub entity_id: String,
    #[serde(default)]
    pub feed_url: String,
    #[serde(default)]
    pub server_address: Option<String>,
    #[serde(default)]
    pub meta: Option<RssFeedMeta>,
    #[serde(default)]
    pub created_at: Option<Value>,
    #[serde(default)]
    pub updated_at: Option<Value>,
}

/// Response shape of GET /api/feeds — `{ feeds: [...], minified: [...] }`. Only
/// the full `feeds` array is consumed.
#[derive(Debug, Deserialize)]
pub struct RssFeedsResponse {
    #[serde(default)]
    pub feeds: Vec<RssFeed>,
}
