// Split from the original single-file abs.ts (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. Import from '../abs' (the barrel),
// not from this file directly.
import { invoke } from '@tauri-apps/api/core';
import type { LibraryItem } from './types';

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
