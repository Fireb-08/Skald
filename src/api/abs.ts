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

