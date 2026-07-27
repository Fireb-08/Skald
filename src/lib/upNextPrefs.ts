// Auto-play-next preferences (Auto-Play Next roadmap, Phase 3).
//
// The migration this file exists to avoid: `onyx.playback.autoPlayNext` already
// exists and means "keep playing through the chapters/tracks *within* this
// item". Continuing into a *different* item is a different decision with
// different risk — it opens a new server session and starts unfamiliar audio —
// so it gets its own keys rather than a quietly widened meaning for the old
// boolean. An install that turned chapter continuity off must not thereby find
// itself opted out of (or into) cross-item continuation.
//
// Values are written by PlaybackSection via `useLocal`, which JSON-stringifies,
// so they are read back with JSON.parse (same contract as playbackPrefs.ts).
import type { EpisodeDirection, UpNextMode } from './upNext';

const BOOK_MODE_KEY = 'onyx.playback.upNext.books';
const PODCAST_MODE_KEY = 'onyx.playback.upNext.podcasts';
const COUNTDOWN_KEY = 'onyx.playback.upNext.countdown';
/** Per-show, because direction is a property of the show, not of the listener:
 *  a back catalogue is worked forwards, a news feed backwards. */
const DIRECTION_PREFIX = 'onyx.podcast.advanceDir.';

/** Default for both media kinds. `prompt` rather than `auto` because nothing
 *  should start playing unannounced, and rather than `off` because a
 *  continuation feature nobody discovers is not a feature. The countdown is
 *  cancellable, which is the whole point of the middle setting. */
const DEFAULT_MODE: UpNextMode = 'prompt';
const DEFAULT_COUNTDOWN_SECONDS = 10;
const MIN_COUNTDOWN_SECONDS = 3;
const MAX_COUNTDOWN_SECONDS = 60;

function readLocal<T>(key: string, parse: (value: unknown) => T | undefined, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return parse(JSON.parse(raw) as unknown) ?? fallback;
  } catch {
    return fallback;
  }
}

function asMode(value: unknown): UpNextMode | undefined {
  return value === 'off' || value === 'prompt' || value === 'auto' ? value : undefined;
}

/** How far continuation may go for this media kind. */
export function upNextMode(kind: 'book' | 'podcast'): UpNextMode {
  return readLocal(kind === 'book' ? BOOK_MODE_KEY : PODCAST_MODE_KEY, asMode, DEFAULT_MODE);
}

/** Seconds the "Up next" prompt counts down before playing. Clamped, because a
 *  0-second countdown would be `auto` wearing a prompt's clothes and an
 *  unbounded one would leave the panel on screen forever. */
export function upNextCountdownSeconds(): number {
  const parsed = readLocal(
    COUNTDOWN_KEY,
    value => (typeof value === 'number' && Number.isFinite(value) ? value : undefined),
    DEFAULT_COUNTDOWN_SECONDS,
  );
  return Math.min(MAX_COUNTDOWN_SECONDS, Math.max(MIN_COUNTDOWN_SECONDS, Math.round(parsed)));
}

/** Advance direction for one show. Defaults to oldest-first: subscribing to a
 *  show you have not heard means working forwards through it. */
export function episodeDirection(showId: string | undefined | null): EpisodeDirection {
  if (!showId) return 'oldest';
  return readLocal(
    DIRECTION_PREFIX + showId,
    value => (value === 'oldest' || value === 'newest' ? value : undefined),
    'oldest',
  );
}

/** Record a show's advance direction (podcast detail context menu). */
export function setEpisodeDirection(showId: string, direction: EpisodeDirection): void {
  try {
    localStorage.setItem(DIRECTION_PREFIX + showId, JSON.stringify(direction));
  } catch {
    // Storage full or unavailable — the show keeps the default direction, which
    // is not worth failing the menu action over.
  }
}

/** Whether playback continues through the chapters/tracks *inside* an item.
 *  The pre-existing key, unchanged in meaning and default (on) — cross-item
 *  continuation above never reads or writes it. */
export function chapterContinuityEnabled(): boolean {
  return localStorage.getItem('onyx.playback.autoPlayNext') !== 'false';
}
