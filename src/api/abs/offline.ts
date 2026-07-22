// Split from the original single-file abs.ts (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. Import from '../abs' (the barrel),
// not from this file directly.
import { invoke } from '@tauri-apps/api/core';
import type { LocalStopPoint } from './types';

export function getCacheDir(): Promise<string> {
  return invoke('get_cache_dir');
}

export function revealCacheDir(): Promise<void> {
  return invoke('reveal_cache_dir');
}

// Downloads directory — where offline audio files actually live (distinct from the
// cache dir). Used by Settings → Downloads for the "Location" path + open button.
export function getDownloadsDir(): Promise<string> {
  return invoke('get_downloads_dir');
}

export function revealDownloadsDir(): Promise<void> {
  return invoke('reveal_downloads_dir');
}

/** Reveal a completed download resolved from the backend registry. Single-file
 *  books are selected in Explorer; multi-file books open their directory. */
export function revealDownloadLocation(itemId: string): Promise<void> {
  return invoke('reveal_download_location', { itemId });
}

/** Relocate the downloads root: moves existing files, repoints the registry, and
 *  persists the override so all future resolutions use the new path. */
export function setDownloadsDir(path: string): Promise<void> {
  return invoke('set_downloads_dir', { path });
}

/** Relocate the cover/library cache root: moves existing files + persists the
 *  override. Exposed in Settings only (not onboarding) per Resolved decisions #2. */
export function setCacheDir(path: string): Promise<void> {
  return invoke('set_cache_dir', { path });
}

/** Open an arbitrary local folder in the OS file explorer. */
export function revealPath(path: string): Promise<void> {
  return invoke('reveal_path', { path });
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

/** Returns and clears the corrupt-persistence notices recorded since launch —
 *  names of files the backend preserved as *.corrupt before resetting to empty.
 *  Polled once after the mount registry load so the user learns visible data
 *  was reset rather than finding it mysteriously empty. */
export function takeCorruptPersistenceNotices(): Promise<string[]> {
  return invoke('take_corrupt_persistence_notices');
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

// ── Offline progress queue ─────────────────────────────────────────────────

// Mirrors downloads::OfflineProgressEntry in src-tauri/src/downloads.rs.
export interface OfflineProgressEntry {
  itemId: string;
  episodeId?: string | null;
  currentTime: number;
  duration: number;
  progress: number;    // 0.0–1.0
  isFinished: boolean;
  recordedAt: number;  // Unix ms timestamp
  baselineCaptured: boolean;
  serverLastUpdate?: number | null;
  pendingConfirmationCurrentTime?: number | null;
}

// Flushes locally queued offline progress entries to the server.
// Called on socket reconnect and on startup after a successful library fetch.
// Returns the number of entries that were successfully synced.
export function flushOfflineProgress(serverUrl: string): Promise<number> {
  return invoke('flush_offline_progress', { serverUrl });
}

// Returns the offline progress queue entry for a book, or null if none exists.
// Called by the offline playback path to restore the last saved position when
// the server is unreachable and st.mediaProgress has no entry for the book.
export function getOfflineProgress(itemId: string): Promise<OfflineProgressEntry | null> {
  return invoke('get_offline_progress', { itemId });
}

/** Number of locally retained progress writes awaiting safe ABS reconciliation. */
export function getOfflineProgressCount(): Promise<number> {
  return invoke('get_offline_progress_count');
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
