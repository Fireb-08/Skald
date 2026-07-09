// Split from the original single-file abs.ts (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. Import from '../abs' (the barrel),
// not from this file directly.
import { invoke } from '@tauri-apps/api/core';

// ── Server upload (Server Upload roadmap) ────────────────────────────────────

/** One entry in the Upload modal's file list (mirrors commands::UploadFileEntry). */
export interface UploadFileEntry {
  path: string;
  name: string;
  size: number; // bytes
}

/** Expands picked paths into a flat file list with sizes. Directories contribute
 *  their direct child files filtered to the audio + supplemental extension sets;
 *  plain files pass through (the picker dialog's filter already scoped them). */
export function resolveUploadFiles(paths: string[]): Promise<UploadFileEntry[]> {
  return invoke('resolve_upload_files', { paths });
}

/** Uploads files to the ABS server as one new library item via POST /api/upload
 *  (multipart, streamed — flat memory even for multi-GB books). Requires the
 *  user's `upload` permission (403 otherwise). Emits upload-progress Tauri
 *  events (~500 ms) keyed by the caller-generated uploadId, then exactly one of
 *  upload-complete / upload-cancelled / upload-failed; the returned promise
 *  resolves/rejects in lockstep with those. The server files the item under
 *  folder/author/series/title (books) or folder/title (podcasts) and relies on
 *  the library watcher — no scan is triggered. */
export function uploadMedia(
  serverUrl: string,
  uploadId: string,
  libraryId: string,
  folderId: string,
  title: string,
  author: string,
  series: string,
  filePaths: string[],
): Promise<void> {
  return invoke('upload_media', { serverUrl, uploadId, libraryId, folderId, title, author, series, filePaths });
}

/** Signals an in-progress upload to abort on its next chunk boundary; the
 *  upload_media promise then rejects with "cancelled". Safe for unknown ids. */
export function cancelUpload(uploadId: string): Promise<void> {
  return invoke('cancel_upload', { uploadId });
}
