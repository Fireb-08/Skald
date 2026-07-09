// Split from the original single-file abs.ts (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. Import from '../abs' (the barrel),
// not from this file directly.
import { invoke } from '@tauri-apps/api/core';
import type { Library, LibraryItem } from './types';

export function fetchLibraries(serverUrl: string): Promise<Library[]> {
  return invoke('fetch_libraries', { serverUrl });
}

export function fetchLibraryItems(serverUrl: string, libraryId: string): Promise<LibraryItem[]> {
  return invoke('fetch_library_items', { serverUrl, libraryId });
}

export function fetchItem(serverUrl: string, itemId: string): Promise<LibraryItem> {
  return invoke('fetch_item', { serverUrl, itemId });
}

export function deleteItem(serverUrl: string, itemId: string): Promise<void> {
  return invoke('delete_item', { serverUrl, itemId });
}

export function rescanItem(serverUrl: string, itemId: string): Promise<void> {
  return invoke('rescan_item', { serverUrl, itemId });
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
