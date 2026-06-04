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

export interface Library {
  id: string;
  name: string;
  mediaType: string;
}

export interface AuthorObject {
  id: string;
  name: string;
}

// Mirrors the AuthorField untagged enum: string | object | array of objects.
export type AuthorField = string | AuthorObject | AuthorObject[];

export interface BookMetadata {
  title: string | null;
  subtitle: string | null;
  authorName: AuthorField | null;
  narratorName: string | null;
  seriesName: string | null;
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
  media: BookMedia;
  libraryFiles?: LibraryFile[];
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

export function login(serverUrl: string, username: string, password: string): Promise<User> {
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

export function openPlaybackSession(serverUrl: string, itemId: string, startTime?: number): Promise<OpenSessionResult> {
  return invoke('open_playback_session', { serverUrl, itemId, startTime: startTime ?? null });
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
): Promise<void> {
  return invoke('update_progress', { serverUrl, itemId, currentTime, duration, isFinished });
}

export function syncSession(
  serverUrl: string,
  sessionId: string,
  currentTime: number,
  timeListened: number,
): Promise<void> {
  return invoke('sync_session', { serverUrl, sessionId, currentTime, timeListened });
}

export function getCover(serverUrl: string, itemId: string): Promise<number[]> {
  return invoke('get_cover', { serverUrl, itemId });
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

export function updateMedia(
  serverUrl: string,
  itemId: string,
  metadata: Record<string, unknown>,
): Promise<unknown> {
  return invoke('update_media', { serverUrl, itemId, metadata });
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

// ── Admin user-management types ────────────────────────────────────────────
// Mirror of models::AdminUser in src-tauri/src/models.rs.
// Used by the AccountSection admin view; never used in the auth flow.

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

// Closes all open listening sessions on the server, returning the count closed.
// Called once on app startup to clear ghost sessions from previous runs.
export function closeAllOpenSessions(serverUrl: string): Promise<number> {
  return invoke('close_all_open_sessions', { serverUrl });
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

// ── Admin user-management wrappers ─────────────────────────────────────────
// These four functions call the Rust admin commands. They are only invoked
// from AccountSection when the logged-in user is admin or root.

/** Result of an API key login — user profile plus the session JWT from /api/me.
 *  The JWT (token) is used for HTTP and socket auth; the raw API key is not stored. */
export interface ApiKeyLoginResult {
  user: User;
  token: string;
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
 *  Pass `null` for any field that should remain unchanged on the server. */
export function updateUser(
  serverUrl: string,
  userId: string,
  username: string | null,
  password: string | null,
  userType: string | null,
): Promise<AdminUser> {
  return invoke('update_user', { serverUrl, userId, username, password, userType });
}

/** DELETE /api/users/{id} — permanently removes a user account. */
export function deleteUser(serverUrl: string, userId: string): Promise<void> {
  return invoke('delete_user', { serverUrl, userId });
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
 *  Does NOT open a server session — no network access is required. */
export function playLocalFile(filePath: string, startTime: number): Promise<void> {
  return invoke('play_local_file', { filePath, startTime });
}

/** GET /api/users/online → openSessions — returns all currently active playback sessions.
 *  Replaces the old 5-minute updatedAt proxy; this is the authoritative open-sessions list.
 *  Sessions include all users' active playback, not just the authenticated caller's. */
export function getOpenSessions(serverUrl: string): Promise<ListeningSession[]> {
  return invoke('get_open_sessions', { serverUrl }); // backed by GET /api/users/online
}

