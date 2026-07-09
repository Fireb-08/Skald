// Split from the original single-file abs.ts (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. Import from '../abs' (the barrel),
// not from this file directly.
import { invoke } from '@tauri-apps/api/core';

// Resolves to the absolute path of the cached cover file on disk (NOT a data
// URI or raw bytes). Pass the result through convertFileSrc() before using it
// as an <img src> so WebView2 loads it via Tauri's asset protocol.
// `width` (when provided) asks ABS to resize the cover server-side and is
// folded into the cache key so different widths don't collide.
export function getCover(serverUrl: string, itemId: string, width?: number, bust?: number): Promise<string> {
  return invoke('get_cover', { serverUrl, itemId, width: width ?? null, bust: bust ?? null });
}

// Download+cache a remote image URL once (podcast feed art the ABS server doesn't
// store), returning a disk path to convert via convertFileSrc. Turns repeated
// remote <img> loads into a one-time fetch + asset:// reads.
export function cacheRemoteImage(url: string): Promise<string> {
  return invoke('cache_remote_image', { url });
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

/** POST /api/items/:id/chapters — replace the chapter markers (matches the Rust
 *  client and the ABS router; this is a POST, not PATCH). Each chapter is
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
