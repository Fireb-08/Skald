import { invoke } from '@tauri-apps/api/core';

// ── Interfaces (mirror src-tauri/src/models.rs, all camelCase via serde) ──

export interface User {
  id: string;
  username: string;
  token: string;
  email: string | null;
  isActive: boolean;
  type?: string;
}

export interface LibraryFolder {
  id: string | null;
  fullPath: string;
  libraryId: string | null;
  addedAt: number | null;
}

export interface LibrarySettings {
  coverAspectRatio: number | null;
  disableWatcher: boolean | null;
  autoScanCronExpression: string | null;
  audiobooksOnly: boolean | null;
  hideSingleBookSeries: boolean | null;
  onlyShowLaterBooksInContinueSeries: boolean | null;
  skipMatchingMediaWithAsin: boolean | null;
  skipMatchingMediaWithIsbn: boolean | null;
  metadataPrecedence: string[] | null;
  markAsFinishedPercentComplete: number | null;
  markAsFinishedTimeRemaining: number | null;
  podcastSearchRegion: string | null;
  epubsAllowScriptedContent: boolean | null;
}

export interface Library {
  id: string;
  name: string;
  mediaType: string;
  icon: string | null;
  provider: string | null;
  displayOrder: number | null;
  folders: LibraryFolder[];
  settings: LibrarySettings | null;
  lastScan: number | null;
  createdAt: number | null;
  lastUpdate: number | null;
  /** Local Library: "local" for catalog-backed libraries; undefined/"abs" for ABS. */
  source?: string;
  /** Local Library: staging/inbox folder watched for imports (Phase 3). */
  stagingPath?: string | null;
  /** Local Library: "copy" (default) or "move" — how ingest places files. */
  organizeMode?: string;
}

/** Minimal folder entry used in create/update request bodies — only fullPath is sent. */
export interface FolderInput {
  fullPath: string;
}

/** Request body for updateLibrary — all fields are optional (sparse patch). */
export interface UpdateLibraryPayload {
  name?: string;
  icon?: string;
  provider?: string;
  folders?: FolderInput[];
  settings?: LibrarySettings;
}

// Valid metadata providers for book libraries (confirmed against ABS SearchController.js).
export const LIBRARY_PROVIDERS_BOOK = [
  'google', 'audible', 'audible.uk', 'audible.ca', 'audible.au',
  'audible.fr', 'audible.de', 'audible.jp', 'audible.it', 'audible.in',
  'audible.es', 'openlibrary', 'itunes', 'fantlab', 'audiobookcovers',
] as const;
export type LibraryProviderBook = typeof LIBRARY_PROVIDERS_BOOK[number];

// Valid metadata providers for podcast libraries.
export const LIBRARY_PROVIDERS_PODCAST = ['itunes'] as const;
export type LibraryProviderPodcast = typeof LIBRARY_PROVIDERS_PODCAST[number];

// Valid icon slugs for libraries (ABS built-in icon set).
export const LIBRARY_ICONS = [
  'database', 'book', 'audiobook', 'podcast', 'music', 'comic', 'manga',
  'paper', 'magazine', 'pirate', 'crystal-ball', 'alien', 'astronaut',
  'cat', 'dog', 'heart', 'star', 'moon',
] as const;
export type LibraryIcon = typeof LIBRARY_ICONS[number];

export interface AuthorObject {
  id: string;
  name: string;
}

// Mirrors the AuthorField untagged enum: string | object | array of objects.
export type AuthorField = string | AuthorObject | AuthorObject[];

// ABS series object — present on full responses; may be a single object or an array.
export interface SeriesObject {
  id: string;
  name: string;
  // Volume/sequence — may be a number, a decimal string ("1.5"), or absent.
  sequence?: string | number | null;
}

export interface BookMetadata {
  title: string | null;
  subtitle: string | null;
  authorName: AuthorField | null;
  narratorName: string | null;
  seriesName: string | null;
  // Full series object(s) — present on expanded API responses (single item fetch, personalized shelf, etc.)
  // Use this in preference to seriesName for correct name extraction.
  series?: SeriesObject | SeriesObject[] | null;
  genres: string[];
  description?: string | null;
  publisher?: string | null;
  publishedYear?: string | null;
  language?: string | null;
  isbn?: string | null;
  isbn10?: string | null;
  isbn13?: string | null;
}

export interface Chapter {
  id: number;
  start: number;
  end: number;
  title: string;
}

export interface AudioFile {
  index: number;
  startOffset: number;
  duration: number;
  title: string;
  contentUrl: string;
}

// Keep AudioTrack as an alias — used by PlaySession.audioTracks.
export type AudioTrack = AudioFile;

export interface BookMedia {
  /** The Book record id (distinct from the LibraryItem id). Required as the
   *  `mediaItemId` when creating a share. Present in both minified and full item
   *  shapes, but optional here since some legacy paths may omit it. */
  id?: string;
  metadata: BookMetadata;
  chapters: Chapter[];
  audioFiles: AudioFile[];
  tags: string[];
  duration: number;
}

export interface FileMetadata {
  filename: string;
  size: number;
  path?: string | null;
}

export interface LibraryFile {
  ino: string;
  metadata: FileMetadata;
  fileType: string;
}

export interface LibraryItem {
  id: string;
  ino: string;
  libraryId: string;
  /** "book" | "podcast". Backend defaults to "book" when the server omits it. */
  mediaType: string;
  media: BookMedia;
  libraryFiles?: LibraryFile[];
  /** Local Library only: absolute on-disk path of the book unit (playback/ingest source). */
  localPath?: string;
  /** Local Library only: true when an embedded cover was detected during the scan. */
  hasLocalCover?: boolean;
}

// ── Local Library (scanner) ──────────────────────────────────────────────────
// A scanned book unit: an ABS-shaped LibraryItem the existing shelf/player can
// render verbatim, plus scanner-only context (disk path + identification quality).
export interface ScannedItem {
  item: LibraryItem;
  sourcePath: string;
  /** 0..=100 — how much of title/author/series came from real tags vs. folder guesses. */
  confidence: number;
  /** True when both a title and an author were resolved. */
  identified: boolean;
}

/** Scan a local folder into ABS-shaped items (Local Library roadmap, Phase 1). */
export async function scanFolder(path: string, libraryId?: string): Promise<ScannedItem[]> {
  return invoke<ScannedItem[]>('scan_folder', { path, libraryId });
}

// ── Local Library catalog (Phase 2) ──────────────────────────────────────────
// Local libraries are SQLite-backed and need no server. They return the same
// Library / LibraryItem shapes as the ABS commands; `Library.source === 'local'`
// is the routing tag the state layer branches on.

/** Create (or return existing) a local library rooted at `rootPath`. */
export async function createLocalLibrary(name: string, rootPath: string): Promise<Library> {
  return invoke<Library>('create_local_library', { name, rootPath });
}

/** List all local libraries from the catalog. */
export async function getLocalLibraries(): Promise<Library[]> {
  return invoke<Library[]>('get_local_libraries');
}

/** Delete a local library and its catalogued items (does not touch files on disk). */
export async function deleteLocalLibrary(id: string): Promise<void> {
  return invoke('delete_local_library', { id });
}

/** Re-scan a local library's root folder; returns the number of items catalogued. */
export async function scanLocalLibrary(libraryId: string): Promise<number> {
  return invoke<number>('scan_local_library', { libraryId });
}

/** Load a local library's catalogued items (ABS-shaped). */
export async function getLocalLibraryItems(libraryId: string): Promise<LibraryItem[]> {
  return invoke<LibraryItem[]>('get_local_library_items', { libraryId });
}

// ── Local Library ingest (Phase 3) ───────────────────────────────────────────

/** The outcome of ingesting one book unit. */
export interface IngestOutcome {
  title: string;
  /** "filed" | "quarantined" | "error". */
  outcome: string;
  /** Absolute destination directory (empty on error). */
  targetPath: string;
  /** Error detail when outcome === "error". */
  message: string;
}

/** Ingest folders/files into a local library's managed Author/Series/Title tree. */
export async function ingestLocalPaths(libraryId: string, sources: string[]): Promise<IngestOutcome[]> {
  return invoke<IngestOutcome[]>('ingest_local_paths', { libraryId, sources });
}

/** Update a local library's ingest config (staging folder, copy/move mode). */
export async function setLocalLibraryConfig(
  libraryId: string,
  stagingPath?: string | null,
  organizeMode?: string,
): Promise<Library> {
  return invoke<Library>('set_local_library_config', { libraryId, stagingPath, organizeMode });
}

// ── Podcasts (cluster E) ─────────────────────────────────────────────────────
// The Rust LibraryItem.media is pass-through JSON, so a podcast item arrives as
// a LibraryItem whose `media` is really PodcastMedia. Rather than force a
// discriminated union (which would demand mediaType guards across all existing
// book code that reads media.chapters/duration/tags), book code keeps the
// BookMedia view and podcast code uses PodcastLibraryItem via asPodcastItem().

/** Per-episode enclosure (the audio file reference from the RSS feed). */
export interface EpisodeEnclosure {
  url?: string;
  type?: string;
  length?: string;
}

/** A podcast episode. Feed-preview episodes (not yet downloaded) carry no id;
 *  library episodes do. `audioFile`/`audioTrack`/`chapters` shapes vary, so
 *  they stay loosely typed. */
export interface PodcastEpisode {
  id?: string;
  podcastId?: string;
  index?: number;
  season?: string;
  episode?: string;
  episodeType?: string;
  title: string;
  subtitle?: string;
  description?: string;
  pubDate?: string;
  publishedAt?: number;
  enclosure?: EpisodeEnclosure;
  duration?: number;
  size?: number;
  // Present on downloaded library episodes only.
  audioFile?: unknown;
  audioTrack?: unknown;
  chapters?: Chapter[];
  // Feed episodes carry a guid used to dedupe against downloaded episodes.
  guid?: string;
}

/** An episode as returned by the recent-episodes feed: the expanded episode
 *  plus a reference back to its parent podcast (id + metadata) for display. */
export interface RecentEpisode extends PodcastEpisode {
  libraryItemId?: string;
  libraryId?: string;
  podcast?: { metadata?: PodcastMetadata };
}

/** Podcast-level metadata (parallels BookMetadata). */
export interface PodcastMetadata {
  title: string | null;
  author?: string | null;
  description?: string | null;
  releaseDate?: string | null;
  genres?: string[];
  feedUrl?: string | null;
  imageUrl?: string | null;
  itunesPageUrl?: string | null;
  itunesId?: string | number | null;
  itunesArtistId?: string | number | null;
  language?: string | null;
  explicit?: boolean;
  type?: string | null;
}

/** Podcast media payload. Auto-download settings live here. */
export interface PodcastMedia {
  metadata: PodcastMetadata;
  episodes: PodcastEpisode[];
  tags?: string[];
  autoDownloadEpisodes?: boolean;
  autoDownloadSchedule?: string | null;
  lastEpisodeCheck?: number;
  maxEpisodesToKeep?: number;
  maxNewEpisodesToDownload?: number;
  numEpisodes?: number;
  size?: number;
}

/** A library item known to be a podcast — same shape as LibraryItem but with
 *  the podcast media view. Obtain via asPodcastItem(). */
export interface PodcastLibraryItem extends Omit<LibraryItem, 'media'> {
  media: PodcastMedia;
}

/** Narrow a LibraryItem to its podcast view. The runtime shape already matches
 *  (media is pass-through JSON); this is a typed reinterpretation, not a copy. */
export function asPodcastItem(item: LibraryItem): PodcastLibraryItem {
  return item as unknown as PodcastLibraryItem;
}

export interface MediaProgress {
  id: string;
  libraryItemId: string;
  episodeId: string | null;
  duration: number;
  progress: number;
  currentTime: number;
  isFinished: boolean;
  lastUpdate: number;
}

export interface MeResponse {
  id: string;
  username: string;
  token: string;
  mediaProgress: MediaProgress[];
  bookmarks: Bookmark[];
  type?: string;
}

export interface ListeningStatItem {
  id: string;
  timeListening: number;
}

export interface ListeningStats {
  totalTime: number;
  today: number;
  items: Record<string, ListeningStatItem>;
  days: Record<string, number>;
}

export interface Bookmark {
  libraryItemId: string;
  title: string;
  time: number;
  /** Local Library bookmarks carry a catalog id used for deletion; ABS omits it. */
  id?: string;
}

// Mirrors downloads::LocalStopPoint — a position snapshot recorded locally
// at pause, book-switch, and app-close, independent of the server.
export interface LocalStopPoint {
  itemId: string;
  position: number;    // playback position in seconds
  recordedAt: number;  // Unix timestamp ms — displayed as date/time in the UI
}

export interface AudioDevice {
  id: string;
  name: string;
}

export interface PlaySession {
  id: string;
  currentTime: number;
  audioTracks: AudioTrack[];
}

export interface OpenSessionResult {
  sessionId: string;
  currentTime: number;
}

// ── Greeting pane stats types (GreetingPane.tsx) ───────────────────────────

// Mirrors models::UserStatsSession — one entry in the recent-sessions list.
export interface UserStatsSession {
  id: string;
  displayTitle: string | null;
  timeListening: number; // seconds
  date: string | null;   // "YYYY-MM-DD"
  libraryItemId: string;
}

// Mirrors models::UserStats — GET /api/me/listening-stats response.
export interface UserStats {
  totalTime: number;        // seconds
  numDaysListened: number;
  numBooksFinished: number;
  numBooksListened: number;
  recentSessions: UserStatsSession[];
  days: Record<string, number>; // { "YYYY-MM-DD": seconds }
}

// Mirrors models::GenreStat — one row in the genres array.
export interface GenreStat {
  genre: string;
  count: number;
}

// Mirrors models::LibraryStats — GET /api/libraries/{id}/stats response.
export interface LibraryStats {
  totalItems: number;
  totalAuthors: number;
  totalDuration: number;         // seconds
  numAudioTracks: number;
  totalAudioFilesSize: number;   // bytes
  genres: GenreStat[];
}

// ── Command wrappers ───────────────────────────────────────────────────────
// Command names match the Rust #[tauri::command] function names (snake_case).
// Argument keys are camelCase; Tauri converts them to Rust snake_case params.

export interface LoginResult {
  user: User;
  serverSettings: ServerSettings | null;
}

export function login(serverUrl: string, username: string, password: string): Promise<LoginResult> {
  return invoke('login', { serverUrl, username, password });
}

export function logout(): Promise<void> {
  return invoke('logout');
}

export function saveToken(token: string): Promise<void> {
  return invoke('save_token', { token });
}

export function hasToken(): Promise<boolean> {
  return invoke('has_token');
}

export function openPlaybackSession(
  serverUrl: string,
  itemId: string,
  startTime?: number,
  episodeId?: string,
): Promise<OpenSessionResult> {
  return invoke('open_playback_session', {
    serverUrl,
    itemId,
    episodeId: episodeId ?? null,
    startTime: startTime ?? null,
  });
}

export function playAudio(): Promise<void> {
  return invoke('play_audio');
}

export function pauseAudio(): Promise<void> {
  return invoke('pause_audio');
}

export function seekAudio(secs: number): Promise<void> {
  return invoke('seek_audio', { secs });
}

export function setSpeed(rate: number): Promise<void> {
  return invoke('set_speed', { rate });
}

export function setVolume(vol: number): Promise<void> {
  return invoke('set_volume', { vol });
}

export function fetchLibraries(serverUrl: string): Promise<Library[]> {
  return invoke('fetch_libraries', { serverUrl });
}

export function fetchLibraryItems(serverUrl: string, libraryId: string): Promise<LibraryItem[]> {
  return invoke('fetch_library_items', { serverUrl, libraryId });
}

export function fetchItem(serverUrl: string, itemId: string): Promise<LibraryItem> {
  return invoke('fetch_item', { serverUrl, itemId });
}

export function fetchListeningStats(serverUrl: string, userId: string): Promise<ListeningStats> {
  return invoke('fetch_listening_stats', { serverUrl, userId });
}

export function getMe(serverUrl: string): Promise<MeResponse> {
  return invoke('get_me', { serverUrl });
}

export function createBookmark(
  serverUrl: string,
  itemId: string,
  time: number,
  title: string,
): Promise<Bookmark> {
  return invoke('create_bookmark', { serverUrl, itemId, time, title });
}

export function deleteProgress(serverUrl: string, itemId: string): Promise<void> {
  return invoke('delete_progress', { serverUrl, itemId });
}

export function updateProgress(
  serverUrl: string,
  itemId: string,
  currentTime: number,
  duration: number,
  isFinished: boolean,
  episodeId?: string,
): Promise<void> {
  return invoke('update_progress', { serverUrl, itemId, episodeId: episodeId ?? null, currentTime, duration, isFinished });
}

export function syncSession(
  serverUrl: string,
  sessionId: string,
  currentTime: number,
  timeListened: number,
): Promise<void> {
  return invoke('sync_session', { serverUrl, sessionId, currentTime, timeListened });
}

// Resolves to the absolute path of the cached cover file on disk (NOT a data
// URI or raw bytes). Pass the result through convertFileSrc() before using it
// as an <img src> so WebView2 loads it via Tauri's asset protocol.
// `width` (when provided) asks ABS to resize the cover server-side and is
// folded into the cache key so different widths don't collide.
export function getCover(serverUrl: string, itemId: string, width?: number, bust?: number): Promise<string> {
  return invoke('get_cover', { serverUrl, itemId, width: width ?? null, bust: bust ?? null });
}

export function getAudioDevices(): Promise<AudioDevice[]> {
  return invoke('get_audio_devices');
}

export function setAudioDevice(deviceId: string): Promise<void> {
  return invoke('set_audio_device', { deviceId });
}

export function closeSession(
  serverUrl: string,
  sessionId: string,
  currentTime: number,
  timeListened: number,
): Promise<void> {
  return invoke('close_session', { serverUrl, sessionId, currentTime, timeListened });
}

/** PATCH /api/items/:id/media — writes the full media payload. Pass the whole
 *  `{ metadata: {…}, tags?: [...] }` object (ABS reads tags at the top level,
 *  not inside metadata). */
export function updateMedia(
  serverUrl: string,
  itemId: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  return invoke('update_media', { serverUrl, itemId, payload });
}

/** PATCH /api/items/:id/chapters — replace the chapter markers. Each chapter is
 *  { start, end, title }. Requires the canUpdate permission (admin by default). */
export function updateChapters(
  serverUrl: string,
  itemId: string,
  chapters: { start: number; end: number; title: string }[],
): Promise<unknown> {
  return invoke('update_chapters', { serverUrl, itemId, chapters });
}

// ── Cover management (admin / canUpload) ────────────────────────────────────────

/** GET /api/search/covers — find candidate cover image URLs for a book. */
export function findCovers(serverUrl: string, title: string, author: string, provider: string): Promise<string[]> {
  return invoke('find_covers', { serverUrl, title, author, provider });
}

/** POST /api/items/:id/cover { url } — set the cover from a remote URL. */
export function setCoverUrl(serverUrl: string, itemId: string, url: string): Promise<void> {
  return invoke('set_cover_url', { serverUrl, itemId, url });
}

/** POST /api/items/:id/cover (multipart) — upload a local image file as the cover. */
export function uploadCover(serverUrl: string, itemId: string, filePath: string): Promise<void> {
  return invoke('upload_cover', { serverUrl, itemId, filePath });
}

/** DELETE /api/items/:id/cover — remove the item's cover. */
export function removeCover(serverUrl: string, itemId: string): Promise<void> {
  return invoke('remove_cover', { serverUrl, itemId });
}

export interface ShortcutBinding {
  action: string;
  shortcut: string;
}

export function registerShortcuts(bindings: ShortcutBinding[]): Promise<void> {
  return invoke('register_shortcuts', { bindings });
}

export interface Collection {
  id: string;
  name: string;
  description?: string | null;
  books?: Array<{ id: string }>;
}

// ── Playlist types ─────────────────────────────────────────────────────────
// Playlists are per-user and private, unlike collections which are library-wide.
// Content may be books or podcast episodes (not mixed within one playlist).

/** Minimal item reference passed in create/update/batch request bodies. */
export interface PlaylistItemInput {
  libraryItemId: string;
  episodeId?: string;   // omit for book playlists; required for podcast episode playlists
}

/** A single item in a playlist response — may include the expanded library item. */
export interface PlaylistItem {
  libraryItemId: string;
  episodeId?: string | null;
  libraryItem?: LibraryItem | null;  // populated by the server on full playlist fetches
}

/** A user playlist returned by the ABS server. */
export interface Playlist {
  id: string;
  name: string;
  description?: string | null;
  libraryId: string;
  userId: string;
  items: PlaylistItem[];
  lastUpdate: number;   // Unix ms
  createdAt: number;    // Unix ms
}

// ── Admin user-management types ────────────────────────────────────────────
// Mirror of models::AdminUser in src-tauri/src/models.rs.
// Used by the AccountSection admin view; never used in the auth flow.

/** A user's permissions object (cluster H). ABS splits librariesAccessible /
 *  itemTagsSelected out to top-level user keys in its JSON, so they normally
 *  arrive empty here; they may be sent back nested on update. */
export interface UserPermissions {
  download: boolean;
  update: boolean;
  delete: boolean;
  upload: boolean;
  createEreader: boolean;
  accessAllLibraries: boolean;
  accessAllTags: boolean;
  accessExplicitContent: boolean;
  /** false = inclusive (only selected tags); true = exclusive (all but them). */
  selectedTagsNotAccessible: boolean;
  librariesAccessible: string[];
  itemTagsSelected: string[];
}

export interface AdminUser {
  id: string;
  username: string;
  // JSON key is "type" (Rust field is user_type with #[serde(rename="type")]).
  type: string;
  // Unix ms of last sign-in; null when the account was never used.
  lastSeen: number | null;
  // Unix ms when the account was created.
  createdAt: number | null;
  isActive: boolean | null;
  currentBookId: string | null;
  // ── Access control (cluster H); present on getUser, may be absent in the list.
  permissions?: UserPermissions | null;
  librariesAccessible?: string[];
  itemTagsSelected?: string[];
}

/** Minimal GET /api/auth-settings view (admin-only). OIDC is enabled iff
 *  authActiveAuthMethods includes "openid". */
export interface AuthSettings {
  authActiveAuthMethods: string[];
  authOpenIDIssuerURL?: string | null;
}

export function deleteItem(serverUrl: string, itemId: string): Promise<void> {
  return invoke('delete_item', { serverUrl, itemId });
}

export function rescanItem(serverUrl: string, itemId: string): Promise<void> {
  return invoke('rescan_item', { serverUrl, itemId });
}

export function createCollection(serverUrl: string, libraryId: string, name: string, bookId: string): Promise<Collection> {
  return invoke('create_collection', { serverUrl, libraryId, name, bookId });
}

export function getCollections(serverUrl: string, libraryId: string): Promise<Collection[]> {
  return invoke('get_collections', { serverUrl, libraryId });
}

export function addBookToCollection(serverUrl: string, collectionId: string, bookId: string): Promise<void> {
  return invoke('add_book_to_collection', { serverUrl, collectionId, bookId });
}

/** PATCH /api/collections/:id — update a collection. Pass { books: [ids] } to
 *  reorder, or { name, description } to edit. Returns the updated collection. */
export function updateCollection(serverUrl: string, collectionId: string, payload: { books?: string[]; name?: string; description?: string }): Promise<Collection> {
  return invoke('update_collection', { serverUrl, collectionId, payload });
}

/** DELETE /api/collections/:id/book/:bookId — remove a book; returns the collection. */
export function removeBookFromCollection(serverUrl: string, collectionId: string, bookId: string): Promise<Collection> {
  return invoke('remove_book_from_collection', { serverUrl, collectionId, bookId });
}

// Closes all open listening sessions on the server, returning the count closed.
// Called once on app startup to clear ghost sessions from previous runs.
export function closeAllOpenSessions(serverUrl: string): Promise<number> {
  return invoke('close_all_open_sessions', { serverUrl });
}

export function getContinueListening(serverUrl: string, libraryId: string): Promise<LibraryItem[]> {
  return invoke('get_continue_listening', { serverUrl, libraryId });
}

// Series as returned by GET /api/libraries/{id}/series.
// Note: numBooks is unreliable (returns 0) — use books.length for counts.
export interface Series {
  id: string;
  name: string;
  nameIgnorePrefix: string;
  books: LibraryItem[];
}

// Fetch all series in a library, each with its books array populated.
export function getLibrarySeries(serverUrl: string, libraryId: string): Promise<Series[]> {
  return invoke('get_library_series', { serverUrl, libraryId });
}

// Fetch books for a single series via server-side filter (Base64-encoded server-side).
export function getSeriesItems(serverUrl: string, libraryId: string, seriesId: string): Promise<LibraryItem[]> {
  return invoke('get_series_items', { serverUrl, libraryId, seriesId });
}

export function closeActiveSession(): Promise<void> {
  return invoke('close_active_session');
}

export function getCacheDir(): Promise<string> {
  return invoke('get_cache_dir');
}

export function revealCacheDir(): Promise<void> {
  return invoke('reveal_cache_dir');
}

export function searchBooks(
  serverUrl: string,
  title: string,
  author: string,
  provider: string,
): Promise<unknown> {
  return invoke('search_books', { serverUrl, title, author, provider });
}

// GET /api/search/providers — { providers: { books: [{value, text}], booksCovers, podcasts } }
export function searchProviders(serverUrl: string): Promise<unknown> {
  return invoke('search_providers', { serverUrl });
}

// ── Admin user-management wrappers ─────────────────────────────────────────
// These four functions call the Rust admin commands. They are only invoked
// from AccountSection when the logged-in user is admin or root.

/** Result of an API key login — user profile plus the session JWT from /api/me.
 *  The JWT (token) is used for HTTP and socket auth; the raw API key is not stored. */
export interface ApiKeyLoginResult {
  user: User;
  token: string;
  serverSettings: ServerSettings | null;
}

/** Validates an API key via GET /api/me and returns the user profile + session JWT.
 *  Callers should store result.token (the JWT), not the raw API key. */
export function loginWithApiKey(serverUrl: string, apiKey: string): Promise<ApiKeyLoginResult> {
  return invoke('login_with_api_key', { serverUrl, apiKey });
}

/** Clears the stored keyring token, forcing a fresh login on next launch.
 *  Call from devtools: invoke('clear_stored_token') */
export function clearStoredToken(): Promise<void> {
  return invoke('clear_stored_token');
}

// ── Phase B: Socket.IO transport wrappers ─────────────────────────────────

/** Opens an authenticated Socket.IO connection to the ABS server.
 *  Stores the client in Rust managed state; call disconnectSocket() to close it.
 *  Emits 'socket-connected' / 'socket-disconnected' Tauri events on lifecycle changes. */
export function connectSocket(serverUrl: string, token: string): Promise<void> {
  return invoke('connect_socket', { serverUrl, token });
}

/** Tears down the active Socket.IO connection cleanly.
 *  Safe to call when no connection is open. */
export function disconnectSocket(): Promise<void> {
  return invoke('disconnect_socket');
}

/** GET /api/users/online — returns the IDs of users currently connected via WebSocket.
 *  Used to drive the presence dot in the admin user list. */
export function getOnlineUsers(serverUrl: string): Promise<string[]> {
  return invoke('get_online_users', { serverUrl });
}

/** GET /api/users — returns all accounts on the server. */
export function getAllUsers(serverUrl: string): Promise<AdminUser[]> {
  return invoke('get_all_users', { serverUrl });
}

/** POST /api/users — creates a new user account. */
export function createUser(
  serverUrl: string,
  username: string,
  password: string,
  userType: string,
): Promise<AdminUser> {
  return invoke('create_user', { serverUrl, username, password, userType });
}

/** PATCH /api/users/{id} — partially updates a user account.
 *  Pass `null` for any field that should remain unchanged on the server.
 *  `permissions` (cluster H) carries librariesAccessible/itemTagsSelected nested. */
export function updateUser(
  serverUrl: string,
  userId: string,
  username: string | null,
  password: string | null,
  userType: string | null,
  permissions: UserPermissions | null = null,
): Promise<AdminUser> {
  return invoke('update_user', { serverUrl, userId, username, password, userType, permissions });
}

/** DELETE /api/users/{id} — permanently removes a user account. */
export function deleteUser(serverUrl: string, userId: string): Promise<void> {
  return invoke('delete_user', { serverUrl, userId });
}

/** GET /api/users/{id} — fetch one user with the full permissions object. */
export function getUser(serverUrl: string, userId: string): Promise<AdminUser> {
  return invoke('get_user', { serverUrl, userId });
}

/** PATCH /api/me/password — self-service password change. Guests are rejected
 *  server-side (403). */
export function changePassword(serverUrl: string, current: string, newPassword: string): Promise<void> {
  return invoke('change_password', { serverUrl, current, newPassword });
}

/** GET /api/auth-settings — admin-only auth config (read-only SSO indicator). */
export function getAuthSettings(serverUrl: string): Promise<AuthSettings> {
  return invoke('get_auth_settings', { serverUrl });
}

// ── Listening sessions types (Settings → Playback → Sessions) ─────────────

// Mirrors models::DeviceInfo.
export interface DeviceInfo {
  clientName: string | null;
  deviceDescription: string | null;
}

// Nested user object present in GET /api/sessions (all-users endpoint) responses.
// Per-user endpoints omit this; use the flat username field for those cases.
export interface SessionUser {
  username: string | null;
}

// Mirrors models::ListeningSession — one row in the sessions table.
// bookId is deserialized from ABS's "libraryItemId" field via Rust serde rename.
// author is deserialized from ABS's "displayAuthor" field via Rust serde rename.
export interface ListeningSession {
  id: string;
  bookId: string | null;
  displayTitle: string | null;
  author: string | null;
  userId: string;
  username: string | null;       // flat username — present in per-user endpoint responses
  playMethod: number | null;     // 0=DirectPlay 1=DirectStream 2=Transcode 3=Local
  deviceInfo: DeviceInfo | null;
  timeListening: number | null;  // seconds
  currentTime: number | null;    // seconds — playback position
  updatedAt: number | null;      // Unix ms — used to detect open sessions
  user?: SessionUser | null;     // nested user object — present in GET /api/sessions responses
}

// Mirrors models::ListeningSessionsResponse.
export interface ListeningSessionsResponse {
  sessions: ListeningSession[];
  total: number;
  numPages: number;
  itemsPerPage: number;
}

// ── GreetingPane stats wrappers ────────────────────────────────────────────

/** GET /api/me/listening-stats — returns the authenticated user's listening stats.
 *  Provides totalTime, numDaysListened, numBooksFinished, recentSessions, and a
 *  per-day map for the 7-day sparkline. */
export function getUserStats(serverUrl: string): Promise<UserStats> {
  return invoke('get_user_stats', { serverUrl });
}

/** GET /api/libraries/{id}/stats — returns aggregate statistics for a library.
 *  Provides item count, author count, total duration, track count, size, and genres. */
export function getLibraryStats(serverUrl: string, libraryId: string): Promise<LibraryStats> {
  return invoke('get_library_stats', { serverUrl, libraryId });
}

// ── Listening sessions wrappers ────────────────────────────────────────────

/** Paginated listening sessions with optional server-side sorting.
 *  userId=null|undefined → GET /api/sessions          (all users, admin only)
 *  userId='__me__'       → GET /api/me/listening-sessions (own sessions)
 *  userId='<id>'         → GET /api/users/{id}/listening-sessions (specific user, admin)
 *  sort/desc are forwarded to ABS so it orders the full dataset server-side. */
export function getListeningSessions(
  serverUrl: string,
  userId?: string | null,  // null/undefined → all users; '__me__' → own; id → specific user
  page?: number,
  itemsPerPage?: number,
  sort?: string,           // ABS sort field name, e.g. 'updatedAt', 'timeListening'
  desc?: boolean,          // true = descending; undefined = omit the param
): Promise<ListeningSessionsResponse> {
  return invoke('get_listening_sessions', {
    serverUrl,
    userId: userId ?? null,       // null maps to Rust None → GET /api/sessions
    page: page ?? 0,
    itemsPerPage: itemsPerPage ?? 10,
    sort: sort ?? null,           // null maps to Rust None → param omitted from query
    desc: desc ?? null,           // null maps to Rust None → param omitted from query
  });
}

/** DELETE /api/sessions/{id} — admin-only, permanently removes a session record. */
export function deleteSession(serverUrl: string, sessionId: string): Promise<void> {
  return invoke('delete_session', { serverUrl, sessionId });
}

// ── Downloads ──────────────────────────────────────────────────────────────

// Mirrors src-tauri/src/downloads.rs DownloadRecord (camelCase via serde rename_all).
export interface DownloadRecord {
  itemId: string;
  title: string;
  author: string;
  filePath: string;    // absolute path to the audio file on disk
  fileSize: number;    // bytes — used for storage totals
  downloadedAt: number; // Unix ms — used to show relative time
  // True when the book was removed from the ABS server after download.
  // Local file is still playable; badge changes from brass ↓ to amber !.
  // Optional for backwards-compat with registry entries written before Phase G.
  serverDeleted?: boolean;
}

/** Streams GET /api/items/{id}/download to a local file in the app's downloads directory.
 *  Emits download-progress Tauri events per chunk and download-complete on finish.
 *  Returns the absolute path of the written file once streaming is complete. */
export function downloadItem(
  serverUrl: string,
  itemId: string,
  fileName: string,
  title: string,   // passed through to progress events and the registry
  author: string,  // stored in the registry for the Downloads settings list
): Promise<string> {
  return invoke('download_item', { serverUrl, itemId, fileName, title, author });
}

/** Returns all records in the downloads registry.
 *  Used by Settings → Downloads on mount to populate the list. */
export function getDownloads(): Promise<DownloadRecord[]> {
  return invoke('get_downloads');
}

/** Deletes the audio file from disk and removes its registry entry.
 *  Returns an error if the file was already gone (registry still cleaned up).
 *  Used by the delete button in Settings → Downloads. */
export function removeDownload(itemId: string): Promise<void> {
  return invoke('remove_download', { itemId });
}

/** Marks a downloaded book as server-deleted — the item was removed from ABS
 *  but the local audio file is retained for offline playback. The shelf badge
 *  changes from brass ↓ to amber ! to indicate the orphaned state. */
export function markServerDeleted(itemId: string): Promise<void> {
  return invoke('mark_server_deleted', { itemId });
}

/** Signals an in-progress download to abort on its next chunk boundary.
 *  Safe to call when the itemId is not actively downloading — returns normally.
 *  The Rust streaming loop emits a 'download-cancelled' event and deletes the
 *  partial file; callers listen for that event rather than awaiting this call. */
export function cancelDownload(itemId: string): Promise<void> {
  return invoke('cancel_download', { itemId });
}

/** Phase D — opens a local audio file in LibVLC for offline playback.
 *  filePath may point to a single audio file or a directory (multi-file book);
 *  the Rust layer resolves the correct first file in the latter case.
 *  Starts the 1-second playback-tick loop so all transport controls remain live.
 *  itemId is the ABS library item ID — stored so progress can be queued offline.
 *  Does NOT open a server session — no network access is required. */
export function playLocalFile(filePath: string, itemId: string, startTime: number, localLibrary = false): Promise<void> {
  return invoke('play_local_file', { filePath, itemId, startTime, localLibrary });
}

// ── Local Library progress & bookmarks (Phase 4) ─────────────────────────────

/** Local playback progress for one item (MediaProgress-shaped), or null. */
export async function getLocalProgress(itemId: string): Promise<MediaProgress | null> {
  return invoke<MediaProgress | null>('get_local_progress', { itemId });
}

/** All local progress for a library — merges into the shelf's mediaProgress. */
export async function getLocalLibraryProgress(libraryId: string): Promise<MediaProgress[]> {
  return invoke<MediaProgress[]>('get_local_library_progress', { libraryId });
}

/** Add a local bookmark; returns the stored bookmark (with its catalog id). */
export async function addLocalBookmark(itemId: string, title: string, time: number): Promise<Bookmark> {
  return invoke<Bookmark>('add_local_bookmark', { itemId, title, time });
}

/** List a local item's bookmarks. */
export async function getLocalBookmarks(itemId: string): Promise<Bookmark[]> {
  return invoke<Bookmark[]>('get_local_bookmarks', { itemId });
}

/** Delete a local bookmark by its catalog id. */
export async function deleteLocalBookmark(id: string): Promise<void> {
  return invoke('delete_local_bookmark', { id });
}

// ── Local Library match flow (Phase 5) ───────────────────────────────────────

/** A metadata-provider candidate (server-free search). */
export interface MetadataResult {
  title?: string;
  subtitle?: string;
  author?: string;
  narrator?: string;
  publisher?: string;
  publishedYear?: string;
  description?: string;
  cover?: string;
  series?: string | null;
  genres?: string[];
  language?: string;
  provider?: string;
}

/** Search a metadata provider directly (no server). provider: google|itunes|openlibrary. */
export async function searchMetadata(query: string, provider: string, region?: string): Promise<MetadataResult[]> {
  return invoke<MetadataResult[]>('search_metadata', { query, provider, region });
}

/** List a local library's _Unidentified books awaiting a match. */
export async function getUnidentifiedItems(libraryId: string): Promise<ScannedItem[]> {
  return invoke<ScannedItem[]>('get_unidentified_items', { libraryId });
}

/** (Re)start watching local staging folders; emits `staging-changed` events. Empty list stops it. */
export async function startStagingWatch(paths: string[]): Promise<void> {
  return invoke('start_staging_watch', { paths });
}

/** Apply a match: file the quarantined book into Author/Series/Title, fetch cover, re-scan. */
export async function applyLocalMatch(
  libraryId: string,
  sourcePath: string,
  title: string,
  author: string,
  series?: string | null,
  coverUrl?: string | null,
): Promise<void> {
  return invoke('apply_local_match', { libraryId, sourcePath, title, author, series, coverUrl });
}

/** GET /api/users/online → openSessions — returns all currently active playback sessions.
 *  Replaces the old 5-minute updatedAt proxy; this is the authoritative open-sessions list.
 *  Sessions include all users' active playback, not just the authenticated caller's. */
export function getOpenSessions(serverUrl: string): Promise<ListeningSession[]> {
  return invoke('get_open_sessions', { serverUrl }); // backed by GET /api/users/online
}

// ── Offline progress queue ─────────────────────────────────────────────────

// Mirrors downloads::OfflineProgressEntry in src-tauri/src/downloads.rs.
export interface OfflineProgressEntry {
  itemId: string;
  currentTime: number;
  duration: number;
  progress: number;    // 0.0–1.0
  isFinished: boolean;
  recordedAt: number;  // Unix ms timestamp
}

// Flushes locally queued offline progress entries to the server.
// Called on socket reconnect and on startup after a successful library fetch.
// Returns the number of entries that were successfully synced.
export function flushOfflineProgress(serverUrl: string): Promise<number> {
  return invoke('flush_offline_progress', { serverUrl });
}

// ── Diagnostic logging (Diagnostic Logging roadmap) ──────────────────────────
/** Reads the on-disk Skald log file (skald.log) for the Skald log viewer + report. */
export function readSkaldLog(): Promise<string> {
  return invoke('read_skald_log');
}

/** Reveals the Skald log folder (app_log_dir) in the OS file explorer. */
export function openLogDir(): Promise<void> {
  return invoke('open_log_dir');
}

/** Writes text to an absolute path (used to save the diagnostic report). */
export function writeTextFile(path: string, contents: string): Promise<void> {
  return invoke('write_text_file', { path, contents });
}

// Returns the offline progress queue entry for a book, or null if none exists.
// Called by the offline playback path to restore the last saved position when
// the server is unreachable and st.mediaProgress has no entry for the book.
export function getOfflineProgress(itemId: string): Promise<OfflineProgressEntry | null> {
  return invoke('get_offline_progress', { itemId });
}

// ── Library disk cache ─────────────────────────────────────────────────────

// Saves the library items to a local JSON cache file for offline fallback on next launch.
export function saveLibraryCache(items: unknown[]): Promise<void> {
  return invoke('save_library_cache', { items });
}

// Loads the cached library from disk. Returns an empty array if no cache exists yet.
export function loadLibraryCache(): Promise<unknown[]> {
  return invoke('load_library_cache');
}

// Saves chapter data for a specific item to a per-item cache file.
// chapters should be the raw ABS Chapter array from item.media.chapters.
// Called after every successful fetchItem so the data is available offline.
export function saveChapterCache(itemId: string, chapters: unknown): Promise<void> {
  return invoke('save_chapter_cache', { itemId, chapters });
}

// Loads cached chapter data for a specific item. Returns null if no cache exists
// (i.e. the book was never opened while online after the cache was introduced).
export function loadChapterCache(itemId: string): Promise<unknown[] | null> {
  return invoke('load_chapter_cache', { itemId });
}

// Appends a stop point for the given book, keeping the 10 most recent.
// Called at pause, book-switch, and app-close as a position safety net.
export function recordStopPoint(itemId: string, position: number): Promise<void> {
  return invoke('record_stop_point', { itemId, position });
}

// Returns the stop-point log for a book, most recent first.
// Returns an empty array when no local history exists.
export function getStopPoints(itemId: string): Promise<LocalStopPoint[]> {
  return invoke('get_stop_points', { itemId });
}

// ── Playlist wrappers ──────────────────────────────────────────────────────

/** GET /api/libraries/{id}/playlists — all playlists owned by the current user in this library. */
export function getPlaylists(serverUrl: string, libraryId: string): Promise<Playlist[]> {
  return invoke('get_playlists', { serverUrl, libraryId });
}

/** GET /api/playlists/{id} — single playlist with full item list. */
export function getPlaylist(serverUrl: string, playlistId: string): Promise<Playlist> {
  return invoke('get_playlist', { serverUrl, playlistId });
}

/** POST /api/playlists — creates a new playlist. Items are optional on create. */
export function createPlaylist(
  serverUrl: string,
  libraryId: string,
  name: string,
  description?: string | null,
  items?: PlaylistItemInput[] | null,
): Promise<Playlist> {
  return invoke('create_playlist', {
    serverUrl,
    libraryId,
    name,
    description: description ?? null,
    items: items ?? null,
  });
}

/** PATCH /api/playlists/{id} — updates name, description, or the full ordered items array.
 *  Passing `items` replaces the entire list, which is how reordering is done. */
export function updatePlaylist(
  serverUrl: string,
  playlistId: string,
  name?: string | null,
  description?: string | null,
  items?: PlaylistItemInput[] | null,
): Promise<Playlist> {
  return invoke('update_playlist', {
    serverUrl,
    playlistId,
    name: name ?? null,
    description: description ?? null,
    items: items ?? null,
  });
}

/** DELETE /api/playlists/{id} — permanently removes a playlist. */
export function deletePlaylist(serverUrl: string, playlistId: string): Promise<void> {
  return invoke('delete_playlist', { serverUrl, playlistId });
}

/** POST /api/playlists/{id}/batch/add — adds multiple items to a playlist in one request.
 *  Returns the updated playlist with the new items appended. */
export function batchAddToPlaylist(
  serverUrl: string,
  playlistId: string,
  items: PlaylistItemInput[],
): Promise<Playlist> {
  return invoke('batch_add_to_playlist', { serverUrl, playlistId, items });
}

/** POST /api/playlists/{id}/batch/remove — removes multiple items from a playlist.
 *  ABS auto-deletes the playlist if it becomes empty after removal. */
export function batchRemoveFromPlaylist(
  serverUrl: string,
  playlistId: string,
  items: PlaylistItemInput[],
): Promise<Playlist> {
  return invoke('batch_remove_from_playlist', { serverUrl, playlistId, items });
}

/** POST /api/playlists/collection/{id} — creates a playlist pre-populated with all
 *  books from the given collection. Returns the newly created playlist. */
export function createPlaylistFromCollection(
  serverUrl: string,
  collectionId: string,
): Promise<Playlist> {
  return invoke('create_playlist_from_collection', { serverUrl, collectionId });
}

// ── Server filesystem browser ──────────────────────────────────────────────────

/** A single directory entry from the server's filesystem. */
export interface FsEntry {
  /** Full path on the server, e.g. "/audiobooks" */
  path: string;
  dirname: string;
  level: number;
}

/** Response from GET /api/filesystem — subdirectories at a given server path. */
export interface FsDirectory {
  posix: boolean;
  directories: FsEntry[];
}

/** Lists subdirectories on the ABS server at `path`. Pass "/" for the root.
 *  Admin-only — ABS returns 403 for non-admin callers. */
export function browseServerFilesystem(serverUrl: string, path: string): Promise<FsDirectory> {
  return invoke('browse_server_filesystem', { serverUrl, path });
}

// ── Library management wrappers (admin/root only) ─────────────────────────────
// ABS enforces admin/root access server-side; calling these as a regular user
// returns HTTP 403. The frontend admin guard (Phase 7) prevents the UI from
// rendering these controls at all, but the server check is the authoritative gate.

/** GET /api/libraries — all libraries with the full expanded shape (folders, settings, timestamps). */
export function getLibrariesFull(serverUrl: string): Promise<Library[]> {
  return invoke('get_libraries_full', { serverUrl });
}

/** POST /api/libraries — creates a new library and returns the created Library. */
export function createLibrary(
  serverUrl: string,
  name: string,
  mediaType: string,
  folders: FolderInput[],
  icon?: string | null,
  provider?: string | null,
  settings?: LibrarySettings | null,
): Promise<Library> {
  return invoke('create_library', {
    serverUrl,
    name,
    mediaType,
    folders,
    icon: icon ?? null,
    provider: provider ?? null,
    settings: settings ?? null,
  });
}

/** PATCH /api/libraries/{id} — partially updates a library; only set fields are sent. */
export function updateLibrary(
  serverUrl: string,
  libraryId: string,
  payload: UpdateLibraryPayload,
): Promise<Library> {
  return invoke('update_library', { serverUrl, libraryId, payload });
}

/** DELETE /api/libraries/{id} — permanently removes the library and all its items.
 *  Returns the deleted Library so callers can confirm what was removed. */
export function deleteLibrary(serverUrl: string, libraryId: string): Promise<void> {
  return invoke('delete_library', { serverUrl, libraryId });
}

/** POST /api/libraries/{id}/scan — triggers a server-side scan.
 *  force=true requests a full rescan; force=false runs incremental. Fire-and-forget. */
export function scanLibrary(serverUrl: string, libraryId: string, force: boolean): Promise<void> {
  return invoke('scan_library', { serverUrl, libraryId, force });
}

// ── Custom metadata providers (admin) ───────────────────────────────────────────

/** A registered custom metadata provider. `slug` (custom-{id}) is the value used
 *  as a library's provider or in a match search. */
export interface CustomMetadataProvider {
  id: string;
  name: string;
  url: string;
  mediaType: string;
  authHeaderValue?: string | null;
  slug: string;
}

/** GET /api/custom-metadata-providers — list custom providers. Admin only. */
export function getCustomMetadataProviders(serverUrl: string): Promise<CustomMetadataProvider[]> {
  return invoke('get_custom_metadata_providers', { serverUrl });
}

/** POST /api/custom-metadata-providers — register one (name/url/mediaType + optional
 *  authHeaderValue). Returns the created provider. Admin only. */
export function createCustomMetadataProvider(
  serverUrl: string,
  payload: { name: string; url: string; mediaType: string; authHeaderValue?: string },
): Promise<CustomMetadataProvider> {
  return invoke('create_custom_metadata_provider', { serverUrl, payload });
}

/** DELETE /api/custom-metadata-providers/:id — remove one. Admin only. */
export function deleteCustomMetadataProvider(serverUrl: string, id: string): Promise<void> {
  return invoke('delete_custom_metadata_provider', { serverUrl, id });
}

// ── Server settings ───────────────────────────────────────────────────────────
// Mirrors models::ServerSettings in src-tauri/src/models.rs.
// All fields are optional — older ABS versions may omit some.

export interface ServerSettings {
  // Scanner
  scannerFindCovers?: boolean | null;
  scannerCoverProvider?: string | null;
  scannerParseSubtitle?: boolean | null;
  scannerPreferMatchedMetadata?: boolean | null;
  scannerDisableWatcher?: boolean | null;
  // Metadata storage
  storeCoverWithItem?: boolean | null;
  storeMetadataWithItem?: boolean | null;
  // Sorting
  sortingIgnorePrefix?: boolean | null;
  sortingPrefixes?: string[] | null;
  // Podcasts
  podcastEpisodeSchedule?: string | null;
  // Chromecast
  chromecastEnabled?: boolean | null;
  // Logging
  logLevel?: number | null;
  loggerDailyLogsToKeep?: number | null;
  loggerScannerLogsToKeep?: number | null;
  // Backups — backupSchedule is a cron string when enabled, or `false` when off.
  backupSchedule?: string | boolean | null;
  backupsToKeep?: number | null;
  maxBackupSize?: number | null;
}

// Valid cover providers for the scanner cover-finder feature.
export const COVER_PROVIDERS = ['google', 'audible', 'apple', 'openlibrary', 'audiobookcovers'] as const;
export type CoverProvider = typeof COVER_PROVIDERS[number];

// ABS log levels: 0 = Debug, 1 = Info, 2 = Warn.
export const LOG_LEVELS = [
  { value: 0, label: 'Debug' },
  { value: 1, label: 'Info' },
  { value: 2, label: 'Warn' },
] as const;

/** POST /api/authorize — refreshes serverSettings using the stored token.
 *  Used on an already-logged-in app launch, when the login-time payload is gone. */
export function fetchServerSettings(serverUrl: string): Promise<ServerSettings> {
  return invoke('fetch_server_settings', { serverUrl });
}

/** PATCH /api/settings — updates one or more server settings fields. Admin only.
 *  `payload` is a sparse object; ABS merges it with the current values server-side. */
export function updateServerSettings(serverUrl: string, payload: Partial<ServerSettings>): Promise<ServerSettings> {
  return invoke('update_server_settings', { serverUrl, payload });
}

/** PATCH /api/sorting-prefixes — replaces the sorting prefix list. Admin only.
 *  Triggers a full title re-index on the server; use sparingly. */
export function updateSortingPrefixes(serverUrl: string, prefixes: string[]): Promise<ServerSettings> {
  return invoke('update_sorting_prefixes', { serverUrl, prefixes });
}

// ── Notification settings (Apprise) ─────────────────────────────────────────────
// Mirrors the notification models in src-tauri/src/models.rs. All endpoints are
// admin-only. ABS fires notifications through an EXTERNAL Apprise API server
// (see appriseApiUrl) — without one configured, nothing is delivered.

/** One configured notification rule. Read-only status fields are populated by ABS. */
export interface Notification {
  id?: string | null;
  /** Required when the event's requiresLibrary is true. */
  libraryId?: string | null;
  eventName: string;
  /** Apprise target URLs (e.g. "discord://…"). */
  urls: string[];
  titleTemplate: string;
  bodyTemplate: string;
  enabled: boolean;
  /** Apprise message type: "info" | "warning" | "success" (serialized as `type`). */
  type: string;
  // Read-only status
  lastFiredAt?: number | null;
  lastAttemptFailed?: boolean | null;
  numConsecutiveFailedAttempts?: number | null;
  numTimesFired?: number | null;
  createdAt?: number | null;
}

/** Global notification configuration. */
export interface NotificationSettings {
  id?: string;
  appriseType?: string;
  appriseApiUrl?: string | null;
  notifications: Notification[];
  maxFailedAttempts?: number;
  maxNotificationQueue?: number;
  notificationDelay?: number;
}

/** Read-only catalog entry describing an available event (drives the editor). */
export interface NotificationEventData {
  name: string;
  requiresLibrary: boolean;
  description: string;
  variables: string[];
  defaults?: { title: string; body: string } | null;
}

/** Response of GET /api/notifications: live settings + the event catalog. */
export interface NotificationsResponse {
  settings: NotificationSettings;
  data: { events: NotificationEventData[] };
}

/** Apprise message types, used by the rule editor's type selector. */
export const NOTIFICATION_TYPES = ['info', 'success', 'warning'] as const;
export type NotificationType = typeof NOTIFICATION_TYPES[number];

/** Static fallback labels for the six ABS notification events. Used only if the
 *  server's live event catalog (data.events) comes back empty — normally the UI
 *  drives off the live catalog, which also carries the template variables. */
export const NOTIFICATION_EVENTS: { name: string; label: string; requiresLibrary: boolean }[] = [
  { name: 'onPodcastEpisodeDownloaded', label: 'Podcast episode downloaded', requiresLibrary: true },
  { name: 'onBackupCompleted', label: 'Backup completed', requiresLibrary: false },
  { name: 'onBackupFailed', label: 'Backup failed', requiresLibrary: false },
  { name: 'onRSSFeedFailed', label: 'RSS feed request failed', requiresLibrary: true },
  { name: 'onRSSFeedDisabled', label: 'RSS feed auto-download disabled', requiresLibrary: true },
  { name: 'onTest', label: 'Test event', requiresLibrary: false },
];

/** GET /api/notifications — current settings + event catalog. Admin only. */
export function getNotifications(serverUrl: string): Promise<NotificationsResponse> {
  return invoke('get_notifications', { serverUrl });
}

/** PATCH /api/notifications — update global settings (appriseApiUrl, limits). Admin only. */
export function updateNotificationSettings(serverUrl: string, payload: Partial<NotificationSettings>): Promise<NotificationSettings> {
  return invoke('update_notification_settings', { serverUrl, payload });
}

/** POST /api/notifications — create a rule. Returns updated settings. Admin only. */
export function createNotification(serverUrl: string, payload: Partial<Notification>): Promise<NotificationSettings> {
  return invoke('create_notification', { serverUrl, payload });
}

/** PATCH /api/notifications/:id — update a rule. Returns updated settings. Admin only. */
export function updateNotification(serverUrl: string, id: string, payload: Partial<Notification>): Promise<NotificationSettings> {
  return invoke('update_notification', { serverUrl, id, payload });
}

/** DELETE /api/notifications/:id — delete a rule. Returns updated settings. Admin only. */
export function deleteNotification(serverUrl: string, id: string): Promise<NotificationSettings> {
  return invoke('delete_notification', { serverUrl, id });
}

/** GET /api/notifications/:id/test — send a real test to one rule's URLs. Admin only. */
export function testNotification(serverUrl: string, id: string): Promise<void> {
  return invoke('test_notification', { serverUrl, id });
}

/** GET /api/notifications/test — fire a synthetic onTest event end-to-end. Admin only. */
export function fireTestNotificationEvent(serverUrl: string): Promise<void> {
  return invoke('fire_test_notification_event', { serverUrl });
}

// ── Backups ─────────────────────────────────────────────────────────────────────
// Mirrors the backup models in src-tauri/src/models.rs. All endpoints are
// admin-only. ABS backs up its database + metadata (not the audio files).

/** One backup archive on the server. */
export interface Backup {
  id: string;
  key?: string | null;
  datePretty: string;
  backupDirPath: string;
  filename: string;
  path: string;
  fullPath: string;
  /** Archive size in bytes. */
  fileSize: number;
  /** Creation time, ms since epoch. */
  createdAt: number;
  serverVersion?: string | null;
}

/** Response of GET /api/backups. */
export interface BackupsResponse {
  backups: Backup[];
  backupLocation: string;
  backupPathEnvSet: boolean;
}

/** GET /api/backups — list backups + location. Admin only. */
export function getBackups(serverUrl: string): Promise<BackupsResponse> {
  return invoke('get_backups', { serverUrl });
}

/** POST /api/backups — create a backup now; returns the updated list. Admin only. */
export function createBackup(serverUrl: string): Promise<BackupsResponse> {
  return invoke('create_backup', { serverUrl });
}

/** DELETE /api/backups/:id — delete a backup; returns the updated list. Admin only. */
export function deleteBackup(serverUrl: string, id: string): Promise<BackupsResponse> {
  return invoke('delete_backup', { serverUrl, id });
}

/** GET /api/backups/:id/apply — restore from a backup. DESTRUCTIVE: overwrites the
 *  server database and restarts ABS, so the connection will drop. Admin only. */
export function applyBackup(serverUrl: string, id: string): Promise<void> {
  return invoke('apply_backup', { serverUrl, id });
}

// ── Scheduled tasks ─────────────────────────────────────────────────────────────
// Mirrors the Task models in src-tauri/src/models.rs. GET /api/tasks lists current
// and recently-finished background operations; POST /api/validate-cron validates a
// cron expression. Gated to admins in the UI for consistency with the server panels.

/** One background task. Newer ABS populates the *Key fields (i18n); fall back to
 *  the plain string when the key is what's set. Running = !isFinished. */
export interface Task {
  id: string;
  action: string;
  title: string;
  titleKey?: string | null;
  description: string;
  descriptionKey?: string | null;
  error?: string | null;
  errorKey?: string | null;
  isFinished: boolean;
  isFailed: boolean;
  startedAt?: number | null;
  finishedAt?: number | null;
}

/** Response of GET /api/tasks. */
export interface TasksResponse {
  tasks: Task[];
}

/** GET /api/tasks — current + recently-finished background tasks. */
export function getTasks(serverUrl: string): Promise<TasksResponse> {
  return invoke('get_tasks', { serverUrl });
}

/** POST /api/validate-cron — resolves true if the cron expression is valid. */
export function validateCron(serverUrl: string, expression: string): Promise<boolean> {
  return invoke('validate_cron', { serverUrl, expression });
}

// ── Server logs ─────────────────────────────────────────────────────────────────
// Mirrors the log models in src-tauri/src/models.rs. GET /api/logger-data seeds the
// current day's recent entries; the live tail arrives via the 'server-log' Tauri
// event after start_log_stream registers the socket as a log listener. Admin-only.

/** One server log line. */
export interface LogEntry {
  timestamp: string;
  source: string;
  message: string;
  /** TRACE / DEBUG / INFO / WARN / ERROR / FATAL / NOTE. */
  levelName: string;
  /** Numeric level (LogLevel constants). */
  level: number;
}

/** Response of GET /api/logger-data. */
export interface LoggerData {
  currentDailyLogs: LogEntry[];
}

/** ABS LogLevel constants (server/utils/constants.js) + display colors. Used for
 *  the level filter and row coloring. */
export const LOGGER_LEVELS = [
  { value: 0, label: 'Trace', color: 'var(--onyx-text-mute)' },
  { value: 1, label: 'Debug', color: 'var(--onyx-text-dim)' },
  { value: 2, label: 'Info',  color: 'var(--onyx-text)' },
  { value: 3, label: 'Warn',  color: '#f59e0b' },
  { value: 4, label: 'Error', color: '#e08a8a' },
  { value: 5, label: 'Fatal', color: '#e05a5a' },
] as const;

/** GET /api/logger-data — current day's recent log entries. Admin only. */
export function getLoggerData(serverUrl: string): Promise<LoggerData> {
  return invoke('get_logger_data', { serverUrl });
}

/** Register the live-sync socket as a log listener at `level` (0=Trace … 5=Fatal).
 *  New entries then arrive via the 'server-log' Tauri event. Admin only. */
export function startLogStream(level: number): Promise<void> {
  return invoke('start_log_stream', { level });
}

/** Stop the live log stream. */
export function stopLogStream(): Promise<void> {
  return invoke('stop_log_stream', {});
}

// ── Podcasts (cluster E) ─────────────────────────────────────────────────────
// Wrappers over the podcast Tauri commands. Backend forwards JSON verbatim, so
// several of these are typed loosely (the feed/episode/queue shapes vary).

/** A feed entry parsed from OPML (parseOpml result). */
export interface OpmlFeed {
  title?: string;
  feedUrl: string;
  [k: string]: unknown;
}

/** POST /api/podcasts/feed — preview an RSS feed. Returns `{ podcast }` whose
 *  shape is PodcastMedia plus the episode list pulled from the live feed. */
export function getPodcastFeed(serverUrl: string, rssFeed: string): Promise<{ podcast: PodcastMedia }> {
  return invoke('get_podcast_feed', { serverUrl, rssFeed });
}

/** POST /api/podcasts — create a podcast item from a previewed feed.
 *  `payload` is the full create body the caller assembles. */
export function createPodcast(serverUrl: string, payload: unknown): Promise<LibraryItem> {
  return invoke('create_podcast', { serverUrl, payload });
}

/** POST /api/podcasts/opml/parse — parse OPML text into a feed list. */
export function parseOpml(serverUrl: string, opmlText: string): Promise<{ feeds: OpmlFeed[] }> {
  return invoke('parse_opml', { serverUrl, opmlText });
}

/** POST /api/podcasts/opml/create — bulk-subscribe from feed URLs. */
export function createPodcastsFromOpml(serverUrl: string, payload: unknown): Promise<void> {
  return invoke('create_podcasts_from_opml', { serverUrl, payload });
}

/** GET /api/podcasts/:id/checknew — poll the feed for new episodes now. */
export function checkNewEpisodes(serverUrl: string, itemId: string, limit?: number): Promise<{ episodes: PodcastEpisode[] }> {
  return invoke('check_new_episodes', { serverUrl, itemId, limit: limit ?? null });
}

/** GET /api/podcasts/:id/downloads — the current episode download queue. */
export function getEpisodeDownloads(serverUrl: string, itemId: string): Promise<{ downloads: unknown[]; currentDownload?: unknown }> {
  return invoke('get_episode_downloads', { serverUrl, itemId });
}

/** GET /api/podcasts/:id/clear-queue — clear queued episode downloads. */
export function clearEpisodeDownloadQueue(serverUrl: string, itemId: string): Promise<void> {
  return invoke('clear_episode_download_queue', { serverUrl, itemId });
}

/** POST /api/podcasts/:id/download-episodes — queue episodes for download.
 *  `episodes` is the array of feed-episode objects to fetch. */
export function downloadEpisodes(serverUrl: string, itemId: string, episodes: PodcastEpisode[]): Promise<void> {
  return invoke('download_episodes', { serverUrl, itemId, episodes });
}

/** GET /api/podcasts/:id/search-episode — find one episode in the live feed. */
export function findEpisode(serverUrl: string, itemId: string, title: string): Promise<{ episodes: PodcastEpisode[] }> {
  return invoke('find_episode', { serverUrl, itemId, title });
}

/** POST /api/podcasts/:id/match-episodes — quick-match episode metadata. */
export function matchEpisodes(serverUrl: string, itemId: string, overrideExisting: boolean): Promise<{ numEpisodesUpdated: number }> {
  return invoke('match_episodes', { serverUrl, itemId, overrideExisting });
}

/** GET /api/podcasts/:id/episode/:episodeId — fetch one episode. */
export function getEpisode(serverUrl: string, itemId: string, episodeId: string): Promise<PodcastEpisode> {
  return invoke('get_episode', { serverUrl, itemId, episodeId });
}

/** PATCH /api/podcasts/:id/episode/:episodeId — edit episode metadata. */
export function updateEpisode(serverUrl: string, itemId: string, episodeId: string, payload: unknown): Promise<LibraryItem> {
  return invoke('update_episode', { serverUrl, itemId, episodeId, payload });
}

/** DELETE /api/podcasts/:id/episode/:episodeId — remove an episode (hard=disk). */
export function deleteEpisode(serverUrl: string, itemId: string, episodeId: string, hard: boolean): Promise<LibraryItem> {
  return invoke('delete_episode', { serverUrl, itemId, episodeId, hard });
}

/** GET /api/libraries/:id/recent-episodes — episodes across all podcasts in the
 *  library, newest first (publishedAt DESC). Each carries its parent podcast. */
export function getRecentEpisodes(serverUrl: string, libraryId: string, limit?: number, page?: number): Promise<{ episodes: RecentEpisode[] }> {
  return invoke('get_recent_episodes', { serverUrl, libraryId, limit: limit ?? null, page: page ?? null });
}

/** GET /api/libraries/:id/opml — export the podcast library as OPML XML text. */
export function exportOpml(serverUrl: string, libraryId: string): Promise<string> {
  return invoke('export_opml', { serverUrl, libraryId });
}

// ── Sharing & RSS feeds (cluster G) ──────────────────────────────────────────
// All admin-gated on the server. Shapes mirror the cluster-G Rust models.

/** A public media-item share link (MediaItemShare.toJSONForClient). Date fields
 *  arrive as ISO strings; `expiresAt` is null for a share that never expires. */
export interface MediaItemShare {
  id: string;
  slug: string;
  mediaItemId: string;
  /** "book" | "podcastEpisode" */
  mediaItemType: string;
  isDownloadable: boolean;
  expiresAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

/** An open RSS feed (Feed.toOldJSON). `entityType` is
 *  "libraryItem" | "collection" | "series"; `feedUrl` is the public URL. */
export interface RssFeed {
  id: string;
  slug: string;
  entityType: string;
  entityId: string;
  feedUrl: string;
  serverAddress?: string | null;
  meta?: {
    title: string;
    description?: string | null;
    author?: string | null;
    imageUrl?: string | null;
    explicit: boolean;
    language?: string | null;
    preventIndexing: boolean;
    ownerName?: string | null;
    ownerEmail?: string | null;
  } | null;
}

/** POST /api/share/mediaitem — create a public share link. `expiresAt` is Unix
 *  ms; pass 0 for never-expires (ABS rejects null). Admin-only. */
export function createShare(
  serverUrl: string,
  slug: string,
  mediaItemType: string,
  mediaItemId: string,
  expiresAt: number | null,
  isDownloadable: boolean,
): Promise<MediaItemShare> {
  return invoke('create_share', { serverUrl, slug, mediaItemType, mediaItemId, expiresAt, isDownloadable });
}

/** DELETE /api/share/mediaitem/:id — revoke a share. */
export function deleteShare(serverUrl: string, shareId: string): Promise<void> {
  return invoke('delete_share', { serverUrl, shareId });
}

/** GET /public/share/:slug — public re-validation of a tracked share (rejects 404
 *  when the share no longer exists). */
export function getShareBySlug(serverUrl: string, slug: string): Promise<MediaItemShare> {
  return invoke('get_share_by_slug', { serverUrl, slug });
}

/** GET /api/items/:id?expanded=1&include=share — the item's existing public share
 *  (admin + book only), or null. The only way to recover a share by item; lets the
 *  modal show a link that already exists, including one created on the web client. */
export function getItemShare(serverUrl: string, itemId: string): Promise<MediaItemShare | null> {
  return invoke('get_item_share', { serverUrl, itemId });
}

/** GET /api/feeds — list all open RSS feeds. */
export function getFeeds(serverUrl: string): Promise<RssFeed[]> {
  return invoke('get_feeds', { serverUrl });
}

/** POST /api/feeds/:kind/:id/open — open a feed. `entityKind` is
 *  "item" | "collection" | "series"; `serverAddress` is the public ABS origin. */
export function openFeed(
  serverUrl: string,
  entityKind: 'item' | 'collection' | 'series',
  entityId: string,
  serverAddress: string,
  slug: string,
): Promise<RssFeed> {
  return invoke('open_feed', { serverUrl, entityKind, entityId, serverAddress, slug });
}

/** POST /api/feeds/:id/close — close/revoke an open feed. */
export function closeFeed(serverUrl: string, feedId: string): Promise<void> {
  return invoke('close_feed', { serverUrl, feedId });
}

