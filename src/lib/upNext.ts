// Auto-play-next resolution — "what plays after this?" as pure functions, so the
// decision can be unit-tested without a player, a session, or a server.
//
// Books resolve through `nextInSeries` (see `series.ts`, which also documents the
// ABS sequence-ordering semantics). Episodes resolve here, because podcast order
// is a per-show choice: catch-up listening wants the *oldest* unheard episode
// next, while a news show wants the *newest*. Verified 2026-07-27 against the ABS
// web client (`client/components/tables/podcast/LazyEpisodesTable.vue`), which
// sorts on `publishedAt` and defaults to newest-first for display; Skald keeps
// the same field precedence its own episode feeds already use (`publishedAt`,
// else the RSS `pubDate`, else undated → oldest).
import type { PodcastEpisode } from '../api/abs';
import { episodeKey } from './podcastCover';

/** Per-show advance direction. `oldest` = work forwards through the back
 *  catalogue (Absorb's default); `newest` = follow a news-style feed backwards. */
export type EpisodeDirection = 'oldest' | 'newest';

/** How far continuation is allowed to go on its own. */
export type UpNextMode = 'off' | 'prompt' | 'auto';

/** Sort key for an episode: milliseconds since epoch, 0 when the feed gives no
 *  date (such an episode sorts oldest, as it does in the episode feeds today). */
export function episodePubMs(ep: PodcastEpisode): number {
  if (ep.publishedAt) return ep.publishedAt;
  if (ep.pubDate) {
    const t = Date.parse(ep.pubDate);
    return Number.isNaN(t) ? 0 : t;
  }
  return 0;
}

/** Stable identity for an episode. Library episodes carry an id; feed-preview
 *  episodes do not, so fall back to the enclosure/guid key used elsewhere. */
function identity(ep: PodcastEpisode): string {
  return ep.id ?? episodeKey(ep);
}

/** Ascending publication order, with a deterministic tiebreak so episodes that
 *  share a timestamp (bulk-imported feeds do this) keep a stable sequence
 *  instead of depending on array order. */
function byPublication(a: PodcastEpisode, b: PodcastEpisode): number {
  const d = episodePubMs(a) - episodePubMs(b);
  if (d !== 0) return d;
  const ai = a.index ?? 0;
  const bi = b.index ?? 0;
  if (ai !== bi) return ai - bi;
  return (a.title ?? '').localeCompare(b.title ?? '');
}

export interface NextEpisodeOptions {
  /** Episodes already listened to — stepped over, not treated as the end. */
  isFinished?: (ep: PodcastEpisode) => boolean;
  /** Candidate restriction — e.g. offline advance considers downloads only. */
  eligible?: (ep: PodcastEpisode) => boolean;
}

/**
 * The episode that follows `current` in `episodes` for the given direction:
 * the next-newer one when working oldest-first, the next-older one when working
 * newest-first. Returns `undefined` at the end of the feed, or when `current`
 * isn't in the list (a stale episode — advancing off an unknown position would
 * be a guess).
 */
export function nextEpisode(
  current: PodcastEpisode,
  episodes: PodcastEpisode[],
  direction: EpisodeDirection,
  opts: NextEpisodeOptions = {},
): PodcastEpisode | undefined {
  const ordered = [...episodes].sort(byPublication);
  if (direction === 'newest') ordered.reverse();
  const curId = identity(current);
  const at = ordered.findIndex(ep => identity(ep) === curId);
  if (at < 0) return undefined;
  for (let i = at + 1; i < ordered.length; i++) {
    const ep = ordered[i];
    if (opts.isFinished?.(ep)) continue;
    if (opts.eligible && !opts.eligible(ep)) continue;
    return ep;
  }
  return undefined;
}
