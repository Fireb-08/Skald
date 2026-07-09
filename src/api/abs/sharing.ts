// Split from the original single-file abs.ts (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. Import from '../abs' (the barrel),
// not from this file directly.
import { invoke } from '@tauri-apps/api/core';

// ── Sharing & RSS feeds (cluster G) ──────────────────────────────────────────
// All admin-gated on the server. Shapes mirror the cluster-G Rust models.

/** A public media-item share link (MediaItemShare.toJSONForClient). Date fields
 *  arrive as ISO strings; `expiresAt` is null for a share that never expires. */
export interface MediaItemShare {
  id: string;
  slug: string;
  mediaItemId: string;
  /** "book" | "podcastEpisode" */
  mediaItemType: string;
  isDownloadable: boolean;
  expiresAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

/** An open RSS feed (Feed.toOldJSON). `entityType` is
 *  "libraryItem" | "collection" | "series"; `feedUrl` is the public URL. */
export interface RssFeed {
  id: string;
  slug: string;
  entityType: string;
  entityId: string;
  feedUrl: string;
  serverAddress?: string | null;
  meta?: {
    title: string;
    description?: string | null;
    author?: string | null;
    imageUrl?: string | null;
    explicit: boolean;
    language?: string | null;
    preventIndexing: boolean;
    ownerName?: string | null;
    ownerEmail?: string | null;
  } | null;
}

/** POST /api/share/mediaitem — create a public share link. `expiresAt` is Unix
 *  ms; pass 0 for never-expires (ABS rejects null). Admin-only. */
export function createShare(
  serverUrl: string,
  slug: string,
  mediaItemType: string,
  mediaItemId: string,
  expiresAt: number | null,
  isDownloadable: boolean,
): Promise<MediaItemShare> {
  return invoke('create_share', { serverUrl, slug, mediaItemType, mediaItemId, expiresAt, isDownloadable });
}

/** DELETE /api/share/mediaitem/:id — revoke a share. */
export function deleteShare(serverUrl: string, shareId: string): Promise<void> {
  return invoke('delete_share', { serverUrl, shareId });
}

/** GET /public/share/:slug — public re-validation of a tracked share (rejects 404
 *  when the share no longer exists). */
export function getShareBySlug(serverUrl: string, slug: string): Promise<MediaItemShare> {
  return invoke('get_share_by_slug', { serverUrl, slug });
}

/** GET /api/items/:id?expanded=1&include=share — the item's existing public share
 *  (admin + book only), or null. The only way to recover a share by item; lets the
 *  modal show a link that already exists, including one created on the web client. */
export function getItemShare(serverUrl: string, itemId: string): Promise<MediaItemShare | null> {
  return invoke('get_item_share', { serverUrl, itemId });
}

/** GET /api/feeds — list all open RSS feeds. */
export function getFeeds(serverUrl: string): Promise<RssFeed[]> {
  return invoke('get_feeds', { serverUrl });
}

/** POST /api/feeds/:kind/:id/open — open a feed. `entityKind` is
 *  "item" | "collection" | "series"; `serverAddress` is the public ABS origin. */
export function openFeed(
  serverUrl: string,
  entityKind: 'item' | 'collection' | 'series',
  entityId: string,
  serverAddress: string,
  slug: string,
): Promise<RssFeed> {
  return invoke('open_feed', { serverUrl, entityKind, entityId, serverAddress, slug });
}

/** POST /api/feeds/:id/close — close/revoke an open feed. */
export function closeFeed(serverUrl: string, feedId: string): Promise<void> {
  return invoke('close_feed', { serverUrl, feedId });
}
