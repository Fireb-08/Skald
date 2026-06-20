// Caches each podcast's live RSS feed (fetched once, de-duplicated) and exposes
// the cover art and the published episode list from it. Older subscriptions
// store no cover/imageUrl and the library item list omits unpublished episodes,
// so the feed is the source for both artwork and the "latest published" feed.
import { getPodcastFeed, getLocalPodcastFeed, type PodcastMedia, type RecentEpisode } from '../api/abs';

interface FeedData { image: string | null; episodes: RecentEpisode[] }

const cache = new Map<string, FeedData>();                 // itemId -> feed data
const inflight = new Map<string, Promise<FeedData | null>>();

/** Fetch (once) and cache a podcast's feed, tagging episodes with the parent
 *  item id + metadata so they can render and play like recent-episodes entries.
 *  `local` routes to the server-free feed parser (no serverUrl needed). */
export function resolvePodcastFeed(serverUrl: string, itemId: string, feedUrl: string, local = false): Promise<FeedData | null> {
  const hit = cache.get(itemId);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(itemId);
  if (pending) return pending;

  // Both paths resolve to the same PodcastMedia shape ({ metadata, episodes }).
  const fetchMedia: Promise<PodcastMedia> = local
    ? getLocalPodcastFeed(feedUrl)
    : getPodcastFeed(serverUrl, feedUrl).then(res => res.podcast);

  const p = fetchMedia
    .then(podcast => {
      const m = (podcast?.metadata ?? {}) as unknown as Record<string, unknown>;
      const image = (m.image as string) || (m.imageUrl as string) || null;
      const episodes: RecentEpisode[] = (podcast?.episodes ?? []).map(ep => ({
        ...ep,
        libraryItemId: itemId,
        podcast: { metadata: podcast?.metadata },
      }));
      const data: FeedData = { image, episodes };
      cache.set(itemId, data);
      inflight.delete(itemId);
      return data;
    })
    .catch(e => {
      console.warn('[podcastCover] feed fetch failed for', itemId, e);
      inflight.delete(itemId);
      return null;
    });
  inflight.set(itemId, p);
  return p;
}

/** Synchronously read an already-resolved feed image (if any). */
export function cachedPodcastImage(itemId: string): string | undefined {
  return cache.get(itemId)?.image ?? undefined;
}

/** Resolve just the cover image (kept for existing callers). */
export function resolvePodcastImage(serverUrl: string, itemId: string, feedUrl: string): Promise<string | null> {
  return resolvePodcastFeed(serverUrl, itemId, feedUrl).then(d => d?.image ?? null);
}

/** Synchronously read already-resolved feed episodes (if any). */
export function cachedFeedEpisodes(itemId: string): RecentEpisode[] | undefined {
  return cache.get(itemId)?.episodes;
}

/** A stable identity for matching the same episode across the feed and the
 *  downloaded library (enclosure URL is most reliable, then guid, then a
 *  title+date composite). */
export function episodeKey(ep: { enclosure?: { url?: string }; guid?: string; title?: string; pubDate?: string }): string {
  return ep.enclosure?.url || ep.guid || `${ep.title ?? ''}|${ep.pubDate ?? ''}`;
}
