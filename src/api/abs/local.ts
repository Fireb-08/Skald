// Split from the original single-file abs.ts (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. Import from '../abs' (the barrel),
// not from this file directly.
import { invoke } from '@tauri-apps/api/core';
import type { Bookmark, Library, LibraryItem, MediaProgress } from './types';

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

/** Create a managed local library: makes `<parentPath>/<name>/` plus its staging/
 *  and _Unidentified/ subfolders, with staging pre-configured. */
export async function createLocalLibrary(name: string, parentPath: string, mediaType: 'book' | 'podcast' = 'book'): Promise<Library> {
  return invoke<Library>('create_local_library', { name, parentPath, mediaType });
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

/** Auto-distribute a local library's staging folder (always moves; staging empties). */
export async function autoIngestStaging(libraryId: string): Promise<IngestOutcome[]> {
  return invoke<IngestOutcome[]>('auto_ingest_staging', { libraryId });
}

/** Update a local library's ingest config (staging folder, copy/move mode). */
export async function setLocalLibraryConfig(
  libraryId: string,
  stagingPath?: string | null,
  organizeMode?: string,
): Promise<Library> {
  return invoke<Library>('set_local_library_config', { libraryId, stagingPath, organizeMode });
}

// ── Local Library progress & bookmarks (Phase 4) ─────────────────────────────

/** Local playback progress for one item (MediaProgress-shaped), or null. */
export async function getLocalProgress(itemId: string, episodeId?: string): Promise<MediaProgress | null> {
  return invoke<MediaProgress | null>('get_local_progress', { itemId, episodeId: episodeId ?? null });
}

/** All local progress for a library — merges into the shelf's mediaProgress. */
export async function getLocalLibraryProgress(libraryId: string): Promise<MediaProgress[]> {
  return invoke<MediaProgress[]>('get_local_library_progress', { libraryId });
}

/** Write local-library progress to the catalog (e.g. Mark as Finished). */
export async function setLocalProgress(itemId: string, currentTime: number, duration: number, isFinished: boolean, episodeId?: string): Promise<void> {
  return invoke('set_local_progress', { itemId, episodeId: episodeId ?? null, currentTime, duration, isFinished });
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
  tags?: string[];
  asin?: string;
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

/** Resolve a local item's cover (sidecar/embedded, resized); returns a cached disk path. */
export async function getLocalCover(itemId: string, bust?: number): Promise<string> {
  return invoke<string>('get_local_cover', { itemId, bust });
}

/** (Re)start watching local staging folders; emits `staging-changed` events. Empty list stops it. */
export async function startStagingWatch(paths: string[]): Promise<void> {
  return invoke('start_staging_watch', { paths });
}

/** Editable local metadata — the field set the Match/Edit review screens expose.
 *  All keys optional; only the present, non-null ones are written. The catalog is
 *  the source of truth, so these persist across rescans. */
export interface LocalMetadataFields {
  title?: string;
  subtitle?: string;
  authorName?: string;
  narratorName?: string;
  seriesName?: string;
  seriesSequence?: string;
  publisher?: string;
  publishedYear?: string;
  genres?: string[];
  tags?: string[];
  language?: string;
  isbn?: string;
  asin?: string;
  description?: string;
}

/** Write user-edited metadata to an existing catalogued local item (Match review
 *  or Edit Metadata). Re-files the folder when title/author/series change, swaps
 *  the cover if given, and returns the updated item to patch in place. */
export async function applyLocalMetadata(
  libraryId: string,
  itemId: string,
  fields: LocalMetadataFields,
  coverUrl?: string | null,
): Promise<LibraryItem> {
  return invoke<LibraryItem>('apply_local_metadata', { libraryId, itemId, fields, coverUrl });
}

/** Replace the chapter markers on a catalogued local item (Local Chapter
 *  Write-Back). The catalog is authoritative (immediate); `writeToFile` also
 *  embeds the chapters into the single audio file via `tone` so they survive a
 *  re-scan (best-effort). Returns the updated item plus an optional `fileWarning`
 *  — a soft message when the file write couldn't complete (catalog edit still
 *  applied). Scoped to single-file local books by the caller. */
export async function setLocalChapters(
  itemId: string,
  chapters: { start: number; end: number; title: string }[],
  writeToFile: boolean,
): Promise<{ item: LibraryItem; fileWarning: string | null }> {
  return invoke('set_local_chapters', { itemId, chapters, writeToFile });
}

/** Apply a chosen match to a quarantined (Unidentified) book: file it into
 *  Author/Series/Title, insert a catalogued item with the chosen metadata, fetch
 *  the cover, and return the new item. `sourcePath` is the quarantine folder. */
export async function fileAndInsertLocalMatch(
  libraryId: string,
  sourcePath: string,
  fields: LocalMetadataFields,
  coverUrl?: string | null,
): Promise<LibraryItem> {
  return invoke<LibraryItem>('file_and_insert_local_match', { libraryId, sourcePath, fields, coverUrl });
}

/** Permanently delete a local item: removes its book folder from disk, the catalog
 *  row, and its progress/bookmarks, then prunes the vacated parent dirs. */
export async function deleteLocalItem(itemId: string): Promise<void> {
  return invoke('delete_local_item', { itemId });
}
