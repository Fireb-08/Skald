// Local tracking of media-item shares (cluster G).
//
// ABS exposes no route to list shares (verified against ShareController.js —
// only create / delete / public-by-slug accessors exist), so Skald persists the
// shares it creates to localStorage. The Share Manager lists these and
// re-validates each against GET /api/share/:slug (a 404 means the share is gone
// and is purged). Known limitation: shares created on the ABS web client or
// another device are not tracked here.

const KEY = 'onyx.shares';
const PUBLIC_BASE_KEY = 'onyx.publicShareBaseUrl';

/** The user-configured public base URL for building share/feed links, or '' if
 *  unset. Stored as a raw string (not JSON) so `publicBase` can read it cheaply. */
export function getPublicBaseUrl(): string {
  return localStorage.getItem(PUBLIC_BASE_KEY) ?? '';
}

/** Persist the public base URL; an empty/blank value clears it (falls back to
 *  the live server URL). */
export function setPublicBaseUrl(url: string): void {
  const trimmed = url.trim();
  if (trimmed) localStorage.setItem(PUBLIC_BASE_KEY, trimmed);
  else localStorage.removeItem(PUBLIC_BASE_KEY);
}

/** The origin to build public share/feed URLs from: the configured public base
 *  when set, otherwise the live server URL. Trailing slashes trimmed. */
export function publicBase(serverUrl: string): string {
  return (getPublicBaseUrl() || serverUrl).replace(/\/+$/, '');
}

/** Compose an absolute feed URL. ABS stores `feedUrl` as a relative path
 *  (`/feed/:slug`); the absolute URL is the feed's stored `serverAddress` + that
 *  path. Falls back to the configured public base if serverAddress is absent. */
export function absoluteFeedUrl(serverAddress: string | null | undefined, feedUrl: string, serverUrl: string): string {
  const base = (serverAddress || publicBase(serverUrl)).replace(/\/+$/, '');
  return `${base}${feedUrl}`;
}

/** A locally-tracked share record. Mirrors the fields the Share Manager needs.
 *  Keyed for lookup by `libraryItemId` (what the UI has on hand); the share's
 *  actual ABS target is the media/book id, captured in `mediaItemId`. */
export interface TrackedShare {
  id: string;
  slug: string;
  /** The LibraryItem id this share was created from (lookup key). */
  libraryItemId: string;
  /** The Book/PodcastEpisode record id the share points at (ABS share target). */
  mediaItemId: string;
  /** "book" | "podcastEpisode" */
  mediaItemType: string;
  /** Item title at creation time — for display without an extra fetch. */
  title: string;
  isDownloadable: boolean;
  /** Unix ms, or null for never-expires. */
  expiresAt: number | null;
  /** Unix ms when Skald created the tracking record. */
  createdAt: number;
}

/** Read all tracked shares (newest first). Tolerates a corrupt/empty store. */
export function getTrackedShares(): TrackedShare[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as TrackedShare[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(list: TrackedShare[]): void {
  localStorage.setItem(KEY, JSON.stringify(list));
}

/** Add (or replace by id) a tracked share, keeping newest first. */
export function addTrackedShare(share: TrackedShare): void {
  const list = getTrackedShares().filter(s => s.id !== share.id);
  write([share, ...list]);
}

/** Remove a tracked share by its server id. */
export function removeTrackedShare(id: string): void {
  write(getTrackedShares().filter(s => s.id !== id));
}

/** The tracked share for a given library item, if any. */
export function findTrackedShareForItem(libraryItemId: string): TrackedShare | undefined {
  return getTrackedShares().find(s => s.libraryItemId === libraryItemId);
}

/** A URL-safe slug derived from a title plus a short random suffix. The suffix
 *  keeps slugs unique (ABS rejects a duplicate slug) without prompting the user. */
export function suggestSlug(title: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40)
    .replace(/-+$/g, '');
  const suffix = Math.random().toString(36).slice(2, 8);
  return base ? `${base}-${suffix}` : suffix;
}
