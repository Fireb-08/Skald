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

export interface LibraryItem {
  id: string;
  ino: string;
  libraryId: string;
  media: BookMedia;
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

export function openPlaybackSession(serverUrl: string, itemId: string): Promise<OpenSessionResult> {
  return invoke('open_playback_session', { serverUrl, itemId });
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


