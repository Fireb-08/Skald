// Resolves the *actual* next thing to play when an item ends: the pure
// resolution in `lib/upNext.ts` and `lib/series.ts` answers "which item comes
// after this one", and this module supplies it with the right candidates —
// which is where the real conditions live. The shelf may not hold the rest of
// the series; the listener may be offline, in which case only downloads can
// play; a book already finished on another device should be stepped over.
import type { OnyxState } from './onyx';
import type { DownloadRecord, LibraryItem, PodcastEpisode } from '../api/abs';
import { asPodcastItem, getSeriesItems } from '../api/abs';
import { nextInSeries, primarySeries } from '../lib/series';
import { nextEpisode } from '../lib/upNext';
import { episodeDirection } from '../lib/upNextPrefs';
import { log } from '../lib/log';

/** Everything resolution reads, and nothing else. `OnyxState` satisfies it
 *  structurally, so callers pass `st` — but the narrow shape is what lets the
 *  resolution be exercised without standing up the whole app state. */
export interface UpNextContext {
  library: LibraryItem[];
  downloads: DownloadRecord[];
  mediaProgress: OnyxState['mediaProgress'];
  playingItem: LibraryItem | null | undefined;
  serverUrl: string;
  isOffline: boolean;
}

export type UpNextTarget =
  | { kind: 'book'; item: LibraryItem }
  | { kind: 'episode'; item: LibraryItem; episode: PodcastEpisode };

/** Why nothing is up next — logged, and (for `series-end`) worth telling the
 *  listener, since "the series is over" is information, not a failure. */
export type UpNextMiss = 'unknown-item' | 'not-in-series' | 'series-end' | 'feed-end' | 'no-episodes';

export type UpNextResolution =
  | { target: UpNextTarget; miss?: undefined }
  | { target?: undefined; miss: UpNextMiss };

/** An item playable without the network: a completed download, or a
 *  local-library item that lives on disk in the first place. */
function isPlayableOffline(st: UpNextContext, item: LibraryItem): boolean {
  return !!item.localPath || st.downloads.some(d => d.itemId === item.id);
}

/** Progress-backed "already heard this" test. Keyed by (item, episode) so a
 *  podcast's episodes never mask each other. */
function finishedTest(st: UpNextContext): (itemId: string, episodeId: string | null) => boolean {
  return (itemId, episodeId) =>
    st.mediaProgress.some(p =>
      p.libraryItemId === itemId && (p.episodeId ?? null) === episodeId && p.isFinished);
}

/**
 * Candidate books for the ended item's series. The shelf cache is used when it
 * already holds the series (the common case — the whole library is loaded), and
 * the ABS series filter is queried when it does not: a series read from a
 * different library, or a shelf that was filtered down, would otherwise look
 * like the end of the series.
 */
async function seriesCandidates(st: UpNextContext, ended: LibraryItem): Promise<LibraryItem[]> {
  const series = primarySeries(ended);
  if (!series) return st.library;
  const cached = st.library.filter(it => primarySeries(it)?.name === series.name);
  // Two entries means the shelf can at least express "what comes next"; one is
  // just the finished book itself.
  if (cached.length > 1) return cached;

  const meta = ended.media?.metadata?.series;
  const seriesId = (Array.isArray(meta) ? meta[0] : meta)?.id;
  // Local-library items have no server series to query, and an offline client
  // cannot ask. Both fall back to whatever the shelf holds.
  if (!seriesId || !st.serverUrl || st.isOffline || ended.localPath) return cached;

  try {
    const fetched = await getSeriesItems(st.serverUrl, ended.libraryId, seriesId);
    log.info('playback', 'fetched series for advance on cache miss', {
      itemId: ended.id,
      seriesId,
      count: fetched.length,
    });
    return fetched;
  } catch (error) {
    log.warn('playback', 'series fetch for advance failed', { itemId: ended.id, err: String(error) });
    return cached;
  }
}

/**
 * What should play after `endedItemId` (and `endedEpisodeId`, for a podcast).
 * Returns the target, or the reason there isn't one. Never starts playback —
 * the caller decides whether to prompt, play, or do nothing.
 */
export async function resolveUpNext(
  st: UpNextContext,
  endedItemId: string,
  endedEpisodeId: string | null,
): Promise<UpNextResolution> {
  // The finished item can have left the shelf (library switch), so fall back to
  // the now-playing snapshot the MiniPlayer already relies on.
  const ended = st.library.find(it => it.id === endedItemId)
    ?? (st.playingItem?.id === endedItemId ? st.playingItem : undefined);
  if (!ended) return { miss: 'unknown-item' };
  const isFinished = finishedTest(st);

  if (endedEpisodeId) {
    const episodes = asPodcastItem(ended).media?.episodes ?? [];
    if (episodes.length === 0) return { miss: 'no-episodes' };
    const current = episodes.find(ep => ep.id === endedEpisodeId);
    if (!current) return { miss: 'no-episodes' };
    const episode = nextEpisode(current, episodes, episodeDirection(ended.id), {
      isFinished: ep => !!ep.id && isFinished(ended.id, ep.id),
      // Offline, only a downloaded episode can actually play. ABS podcast
      // episodes are not in the download registry, so this is local-library
      // episodes carrying their own file path.
      eligible: st.isOffline
        ? ep => !!(ep as { localPath?: string }).localPath
        : undefined,
    });
    return episode ? { target: { kind: 'episode', item: ended, episode } } : { miss: 'feed-end' };
  }

  if (!primarySeries(ended)) return { miss: 'not-in-series' };
  const candidates = await seriesCandidates(st, ended);
  const item = nextInSeries(ended, candidates, {
    isFinished: it => isFinished(it.id, null),
    eligible: st.isOffline ? it => isPlayableOffline(st, it) : undefined,
  });
  return item ? { target: { kind: 'book', item } } : { miss: 'series-end' };
}
