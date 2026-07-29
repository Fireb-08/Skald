// Synthetic 'podcast' library items built from the offline downloads registry.
//
// When the Audiobookshelf server is unreachable, a podcast's real library item
// and RSS feed can't be fetched, so a podcast with downloaded episodes would
// otherwise have no entry point on the shelf (see the offline gap in the
// Offline Podcast Episodes work). These stand-ins put one tile per podcast on
// the offline shelf and give PodcastDetail an item whose media.episodes ARE the
// downloaded episodes — rendered straight from disk, with no server call.
//
// The podcast title comes from DownloadRecord.author, which download_episode
// populates with the parent podcast's title.
import type { DownloadRecord, LibraryItem, PodcastEpisode } from '../api/abs';

// The episode records for one podcast (grouped by itemId) → a podcast LibraryItem.
function buildItem(itemId: string, eps: DownloadRecord[]): LibraryItem {
  const podcastTitle = eps.find(e => e.author)?.author || 'Podcast';
  // The parent podcast's author, captured at download (absent for episodes
  // downloaded before that was stored). Shown as the shelf byline via bookAuthor.
  const podcastAuthor = eps.find(e => e.podcastAuthor)?.podcastAuthor ?? undefined;
  // Effective date for ordering: the episode's real publish date when captured,
  // else the download time (older records). The detail screen re-sorts by the
  // chosen mode, but ordering here keeps any non-re-sorting consumer sensible.
  const dateOf = (d: DownloadRecord) => d.publishedAt ?? d.downloadedAt;
  const episodes: PodcastEpisode[] = eps
    .slice()
    .sort((a, b) => dateOf(b) - dateOf(a)) // newest publish date first
    .map(d => ({
      id: d.episodeId ?? undefined,
      // guid makes episodeKey() stable without an enclosure URL or pubDate.
      guid: d.episodeId ?? undefined,
      title: d.title,
      size: d.fileSize,
      // The episode's real publish date, captured at download, so ordering and the
      // row date reflect it. Falls back to the download time for episodes
      // downloaded before that field was stored.
      publishedAt: d.publishedAt ?? d.downloadedAt,
    }));
  return {
    id: itemId,
    mediaType: 'podcast',
    media: {
      // genres/duration carry safe defaults so the book-centric shelf helpers
      // (bookGenre, bookDur, …) render these items without hitting missing fields.
      // author is the podcast's byline (metadata.author) for bookAuthor to show.
      metadata: { title: podcastTitle, author: podcastAuthor, genres: [] },
      episodes,
      numEpisodes: episodes.length,
      duration: 0,
    },
  } as unknown as LibraryItem;
}

// One synthetic podcast item per distinct podcast that has downloaded episodes.
// Books (no episodeId) are excluded — they use the normal shelf/offline cache.
export function offlinePodcastItems(downloads: DownloadRecord[] | undefined): LibraryItem[] {
  const byPodcast = new Map<string, DownloadRecord[]>();
  for (const d of downloads ?? []) {
    if (!d.episodeId) continue;
    const list = byPodcast.get(d.itemId);
    if (list) list.push(d); else byPodcast.set(d.itemId, [d]);
  }
  return Array.from(byPodcast, ([itemId, eps]) => buildItem(itemId, eps));
}

// The single synthetic item for one podcast id, or null if it has no downloaded
// episodes. PodcastDetail uses this as a fallback so a downloaded podcast opens
// offline even when it isn't present in st.library.
export function offlinePodcastItem(itemId: string, downloads: DownloadRecord[] | undefined): LibraryItem | null {
  const eps = (downloads ?? []).filter(d => d.episodeId && d.itemId === itemId);
  return eps.length ? buildItem(itemId, eps) : null;
}
