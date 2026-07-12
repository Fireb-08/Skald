import { invoke } from '@tauri-apps/api/core';
import type { LibraryItem, TrackUpdateInput } from './types';

/** Fresh expanded item payload for the player file/track inspector. */
export function fetchItemExpanded(serverUrl: string, itemId: string): Promise<LibraryItem> {
  return invoke('fetch_item_expanded', { serverUrl, itemId });
}

/** Admin-only live FFprobe result. Kept as unknown JSON by design. */
export function getAudioFileProbe(serverUrl: string, itemId: string, fileId: string): Promise<unknown> {
  return invoke('get_audio_file_probe', { serverUrl, itemId, fileId });
}

/** Streams one server-owned file to a destination selected by the user. */
export function downloadLibraryFile(
  serverUrl: string,
  itemId: string,
  fileId: string,
  destination: string,
): Promise<number> {
  return invoke('download_library_file', { serverUrl, itemId, fileId, destination });
}

/** Permanently deletes one physical file on the ABS host. */
export function deleteLibraryFile(serverUrl: string, itemId: string, fileId: string): Promise<void> {
  return invoke('delete_library_file', { serverUrl, itemId, fileId });
}

/** Reorders and includes/excludes all audio files for one ABS book. */
export function updateItemTracks(
  serverUrl: string,
  itemId: string,
  orderedFileData: TrackUpdateInput[],
): Promise<LibraryItem> {
  return invoke('update_item_tracks', { serverUrl, itemId, orderedFileData });
}
