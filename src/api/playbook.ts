// Canonical entry point for starting playback of any book. Every play button
// in the app routes through this so behaviour is identical everywhere:
// close any existing session, open a fresh session at the book's saved
// server position (or an explicit override), start audio, and sync the UI.
import type { OnyxState } from '../state/onyx';
import { chapterStartAt } from '../state/bookHelpers';
import { hasRememberedSpeed, rememberSpeed, speedForItem } from '../lib/speedMemory';
import type { LibraryItem, MediaProgress, PodcastEpisode } from './abs';
import { asPodcastItem } from './abs';
import { closeActiveSession, closeActiveSessionWithoutSync, openPlaybackSession, playAudio, pauseAudio, resumeAudio, setSpeed as setAudioSpeed, setVolume as setAudioVolume, playLocalFile, getOfflineProgress, getLocalProgress, getMe, seekAudio } from './abs';
import { log } from '../lib/log';

// Shared boundary logger for fire-and-forget transport calls — routes through
// the structured framework (Skald log viewer) instead of the raw console.
const logErr = (e: unknown) => log.error('playback', 'transport command failed', { err: String(e) });

// Guard against concurrent playBook calls.
// openPlaybackSession is async and slow — a second click during the await
// would start a second session, clobbering the first call's setSessionReady(true)
// with a new setSessionReady(false) at line 78.
let playBookInFlight = false;

interface ServerProgressCheck {
  checked: boolean;
  progress?: MediaProgress;
}

async function checkServerProgress(
  st: OnyxState,
  itemId: string,
  episodeId: string | null,
  transport: 'downloaded' | 'streamed',
): Promise<ServerProgressCheck> {
  if (st.isOffline || !st.serverUrl) return { checked: false };
  try {
    const me = await getMe(st.serverUrl);
    const progress = me.mediaProgress.find(candidate =>
      candidate.libraryItemId === itemId &&
      (candidate.episodeId ?? null) === episodeId);
    log.info('sync', 'checked ABS progress before playback teardown', {
      itemId,
      episodeId,
      transport,
      serverCurrentTime: progress?.currentTime ?? 0,
      serverLastUpdate: progress?.lastUpdate ?? null,
    });
    return { checked: true, progress };
  } catch (error) {
    log.warn('sync', 'ABS progress preflight failed; using playback fallback', {
      itemId,
      episodeId,
      transport,
      err: String(error),
    });
    return { checked: false };
  }
}

async function closePreviousSession(
  st: OnyxState,
  targetItemId: string,
  targetEpisodeId: string | null,
  serverCheck: ServerProgressCheck,
  hasExplicitStart: boolean,
): Promise<void> {
  const sameLoadedMedia =
    st.sessionReady &&
    st.currentBookId === targetItemId &&
    (st.currentEpisodeId ?? null) === targetEpisodeId;
  const serverTime = serverCheck.progress && !serverCheck.progress.isFinished
    ? serverCheck.progress.currentTime
    : 0;
  const serverIsAhead =
    !hasExplicitStart &&
    serverCheck.checked &&
    sameLoadedMedia &&
    serverTime > st.position + 0.5;

  if (serverIsAhead) {
    log.info('sync', 'closing stale session without replacing newer ABS progress', {
      itemId: targetItemId,
      episodeId: targetEpisodeId,
      localCurrentTime: st.position,
      serverCurrentTime: serverTime,
    });
    await closeActiveSessionWithoutSync();
    return;
  }
  await closeActiveSession();
}

export async function playBook(
  st: OnyxState,
  bookId: string,
  startTimeOverride?: number, // only for chapter clicks / bookmark jumps
): Promise<void> {
  // Prevent concurrent calls — second call is dropped until first resolves
  if (playBookInFlight) {
    log.debug('playback', 'playBook already in flight — ignoring duplicate call', { bookId });
    return;
  }
  playBookInFlight = true;
  try {
    // A book is starting — clear any episode context from a prior podcast play
    // (covers both the offline and online paths below).
    st.setCurrentEpisodeId(null);
    st.setCurrentEpisode(null);

    // ── Offline path: play from local file when the book is downloaded ──────────
    // If the book is downloaded locally, play from disk rather than opening a
    // server session — this enables offline playback without network access.
    const localDownload = st.downloads.find(d => d.itemId === bookId);
    const libItem = st.library.find(b => b.id === bookId);
    // A book plays from a local file when it is a completed download OR a
    // local-library item (scanned from disk, carrying localPath). Either case
    // skips the server session entirely and uses the same LibVLC local path.
    const localFilePath = localDownload?.filePath ?? libItem?.localPath;
    // A local-library item (scanned from disk, not a downloaded ABS book) keeps
    // its progress in the catalog, never the server-bound offline queue.
    const isLocalLibrary = !localDownload && !!libItem?.localPath;
    // Snapshot the now-playing item so the cross-library MiniPlayer can render it
    // after the user switches to a different library (where it leaves st.library).
    if (libItem) st.setPlayingItem(libItem);
    log.info('playback', 'playBook', { bookId, offline: !!localFilePath, local: isLocalLibrary, override: startTimeOverride !== undefined });
    // Capture ABS before any existing session is closed. A normal close sends
    // its current position, so checking afterward can only observe the stale
    // value Skald just wrote over a phone's newer progress.
    const serverCheck = isLocalLibrary
      ? { checked: false } satisfies ServerProgressCheck
      : await checkServerProgress(st, bookId, null, localDownload ? 'downloaded' : 'streamed');
    if (localFilePath) {
      // Close any session left open from a previous ONLINE book first. play_local
      // (below) nulls the session id, after which closeActiveSession would no-op —
      // so without this, switching from a streamed book to a downloaded one would
      // orphan an open session on the ABS server.
      await closePreviousSession(st, bookId, null, serverCheck, startTimeOverride !== undefined).catch(e =>
        log.error('playback', 'closeActiveSession (offline switch) failed', { err: String(e) }),
      );
      // Clear any stale online session state — there is no server session in the
      // offline path, so these flags must not mislead other components.
      st.setSessionReady(false);
      st.setSessionId('');

      // Every downloaded ABS playback writes through this queue, even when an
      // explicit/server resume position means we do not need its value today.
      // Read it once up front so corruption is discovered and surfaced before
      // the tick task can silently replace the damaged file. Local-library
      // items use the SQLite catalog and never touch this queue.
      let offlineProgress: Awaited<ReturnType<typeof getOfflineProgress>> = null;
      if (!isLocalLibrary) {
        try {
          offlineProgress = await getOfflineProgress(bookId);
        } catch {
          // Resume still has the explicit/server/zero fallbacks below.
        } finally {
          await st.surfaceCorruptPersistenceNotices();
        }
      }

      // Resolve start position: explicit override > newest known ordinary
      // progress > 0. A pending offline stop point is legitimate progress that
      // ABS may not have accepted yet, so—as in streamed playback—the later of
      // the fresh server position and local position wins.
      let startTime = startTimeOverride;
      if (startTime === undefined) {
        if (isLocalLibrary) {
          // The catalog is the source of truth for local progress (the role the
          // server plays for ABS items), so read it directly rather than trusting
          // the in-memory mediaProgress cache — that cache is only refreshed at
          // library load and would resume from a stale position within a session.
          try {
            const lp = await getLocalProgress(bookId);
            // A finished book restarts from the beginning on replay (mirrors how
            // ABS treats a completed item); otherwise resume where we left off.
            startTime = lp && !lp.isFinished ? lp.currentTime : 0;
          } catch {
            startTime = 0;
          }
        } else if (serverCheck.checked) {
          const serverTime = serverCheck.progress && !serverCheck.progress.isFinished
            ? serverCheck.progress.currentTime
            : 0;
          const offlineTime = offlineProgress && !offlineProgress.isFinished
            ? offlineProgress.currentTime
            : 0;
          startTime = Math.max(serverTime, offlineTime);
        } else {
          const saved = st.mediaProgress.find(p => p.libraryItemId === bookId);
          if (saved) {
            // Progress already in state (server cache). A finished record sits at
            // the media duration — restart from 0 instead of resuming at the end
            // (same replay rule as the local-library branch above).
            startTime = saved.isFinished ? 0 : saved.currentTime;
          } else {
            // Downloaded ABS book — use the local offline queue written by the tick task.
            startTime = offlineProgress && !offlineProgress.isFinished ? offlineProgress.currentTime : 0;
          }
        }
      }

      // Tell LibVLC to open the local file. The Rust command handles file:/// URI
      // construction and starts the 1-second tick loop so playback-tick events flow.
      // bookId is passed so the session layer can key offline progress queue entries
      // to the correct item.
      const savedServerProgress = st.mediaProgress.find(p =>
        p.libraryItemId === bookId && (p.episodeId ?? null) === null);
      // Preserve the server revision observed when downloaded playback first
      // branched. Reopening an existing offline branch must not silently adopt
      // a newer server revision and later overwrite another device's progress.
      const baselineCaptured = !isLocalLibrary
        && (!!offlineProgress?.baselineCaptured || serverCheck.checked);
      const serverLastUpdate = offlineProgress?.baselineCaptured
        ? offlineProgress.serverLastUpdate
        : serverCheck.progress?.lastUpdate ?? savedServerProgress?.lastUpdate;
      // The rate travels with the command: play_local_file starts LibVLC itself,
      // so a separate setSpeed would only take hold after the book had begun
      // playing at whatever rate the previous item left behind.
      await playLocalFile(
        localFilePath, bookId, startTime, isLocalLibrary, undefined,
        baselineCaptured, serverLastUpdate ?? undefined, resolveItemSpeed(st, bookId),
      );

      // Signal to the frontend that we are in local playback mode so transport
      // controls bypass session management and call audio commands directly.
      st.setIsLocalPlayback(true);

      // Seed the UI position to the resolved start time immediately, before the
      // first playback-tick event (~1 second later). Without this the waveform
      // and timestamp display 0:00 for the first tick interval even though LibVLC
      // has already seeked to startTime — mirroring st.setPosition(result.currentTime)
      // in the online path.
      st.setPosition(startTime);

      // Sync UI state to match what LibVLC just started playing.
      st.setCurrentBookId(bookId);
      st.setFocusedBookId(bookId);
      st.setPlaying(true);
      return;
    }

    // ── Online path: existing session-based playback unchanged ──────────────────
    // Ensure local playback flag is cleared when starting an online session.
    st.setIsLocalPlayback(false);

    // 1. Tear down any existing session so the server commits its final state
    // Log session close failures so ghost sessions can be diagnosed.
    // We still proceed even on failure — a new session open will work regardless,
    // but the server may have a dangling open session.
    await closePreviousSession(st, bookId, null, serverCheck, startTimeOverride !== undefined).catch(e =>
      log.error('playback', 'closeActiveSession failed', { err: String(e) })
    );
    st.setSessionReady(false);
    st.setSessionId('');
    st.setPlaying(false);

    // 2. Let ABS choose an ordinary resume position from its authoritative
    // MediaProgress record. That record may have advanced on a phone, the web
    // client, or another Skald instance since our last socket event. Passing
    // st.mediaProgress here turned a cached value into an explicit seek and
    // overrode the fresher currentTime returned by the newly-opened session.
    // Only a real user action (chapter/bookmark jump) is an explicit override.
    const requestedStartTime = startTimeOverride;

    // 3. Open the session. Rust loads LibVLC at either the explicit override or
    //    the authoritative currentTime returned with the new ABS session.
    let result;
    try {
      result = await openPlaybackSession(st.serverUrl, bookId, st.userId, requestedStartTime);
    } catch (e) {
      log.error('playback', 'openPlaybackSession failed', { bookId, err: String(e) });
      throw e;
    }
    log.info('playback', 'session opened', {
      bookId,
      sessionId: result.sessionId,
      resumeSource: requestedStartTime === undefined ? 'server' : 'explicit',
      currentTime: result.currentTime,
    });
    st.setSessionId(result.sessionId);
    st.setSessionReady(true);
    st.setCurrentBookId(bookId);
    // Keep focused book in sync so the Player view reflects the playing book.
    st.setFocusedBookId(bookId);

    // 4. ABS is checked when the session opens, immediately before playback.
    // Do not move backwards when Skald already has a later local stop point:
    // the server can still be waiting for the next periodic push from this
    // device. An explicit chapter/bookmark jump remains authoritative even
    // when it intentionally moves backwards.
    const cached = st.mediaProgress.find(progress =>
      progress.libraryItemId === bookId && (progress.episodeId ?? null) === null);
    const localCurrentTime = st.currentBookId === bookId
      ? Math.max(st.position, cached?.currentTime ?? 0)
      : cached?.currentTime ?? 0;
    const preflightCurrentTime = serverCheck.progress && !serverCheck.progress.isFinished
      ? serverCheck.progress.currentTime
      : 0;
    const resumeTime = requestedStartTime === undefined
      ? Math.max(result.currentTime, preflightCurrentTime, localCurrentTime)
      : result.currentTime;
    if (resumeTime > result.currentTime) {
      await seekAudio(resumeTime);
      log.info('playback', 'preserved later local resume position', {
        bookId,
        localCurrentTime,
        preflightCurrentTime,
        serverCurrentTime: result.currentTime,
      });
    }
    st.setPosition(resumeTime);

    // 5. Start playback and optimistically mark the UI as playing — the
    //    playback-tick event from Rust confirms within ~1 second.
    try {
      await applyItemSpeed(st, bookId);
      await playAudio();
      st.setPlaying(true);
    } catch (error) {
      logErr(error);
      st.setPlaying(false);
    }
  } finally {
    // Always clear the flag, even if playBook throws
    playBookInFlight = false;
  }
}

/** Of the item a caller handed us and the one on the shelf, the one that
 *  actually carries `episodes[]` — preferring the caller's, since it is the
 *  expanded fetch when there is one. Falls back to whichever exists so a
 *  string-only call still snapshots something for the MiniPlayer. */
function expandedPodcast(
  provided: LibraryItem | undefined,
  shelf: LibraryItem | undefined,
): LibraryItem | undefined {
  const hasEpisodes = (it: LibraryItem | undefined) =>
    !!it && (asPodcastItem(it).media?.episodes?.length ?? 0) > 0;
  if (hasEpisodes(provided)) return provided;
  if (hasEpisodes(shelf)) return shelf;
  return provided ?? shelf;
}

// Canonical entry point for starting playback of a podcast episode (cluster E).
// Mirrors playBook's online path but opens the session on the episode so the
// server tracks per-episode progress. Podcast episodes are not part of the
// offline download registry, so there is no local-file branch here.
export async function playEpisode(
  st: OnyxState,
  podcast: string | LibraryItem,
  episode: PodcastEpisode,
  startTimeOverride?: number,
): Promise<void> {
  const podcastItemId = typeof podcast === 'string' ? podcast : podcast.id;
  const episodeId = episode.id;
  if (!episodeId) return;
  if (playBookInFlight) {
    log.debug('playback', 'playEpisode already in flight — ignoring duplicate call', { podcastItemId, episodeId });
    return;
  }
  playBookInFlight = true;
  try {
    // Snapshot the parent podcast so the cross-library MiniPlayer can render the
    // playing episode even after the user switches to a different library — and
    // so auto-play-next has an episode list when this one ends. Callers that
    // already hold the EXPANDED item pass it, because the shelf entry is the
    // minified ABS shape: numEpisodes, but no episodes[] to advance through.
    const podItem = expandedPodcast(
      typeof podcast === 'string' ? undefined : podcast,
      st.library.find(b => b.id === podcastItemId),
    );
    if (podItem) st.setPlayingItem(podItem);
    // ── Local podcast path: play a downloaded episode from disk (no server) ──────
    // A local podcast episode carries `localPath` (the downloaded audio file) and
    // its progress lives in the catalog keyed per (podcast, episode).
    const localPath = (episode as unknown as { localPath?: string }).localPath;
    const isLocalEpisode = st.activeLibrary?.source === 'local' && !!localPath;
    const serverCheck = isLocalEpisode
      ? { checked: false } satisfies ServerProgressCheck
      : await checkServerProgress(st, podcastItemId, episodeId, 'streamed');
    if (isLocalEpisode && localPath) {
      // Close any open online session first (see playBook) so switching to a
      // local episode doesn't orphan a server session.
      await closePreviousSession(
        st,
        podcastItemId,
        episodeId,
        serverCheck,
        startTimeOverride !== undefined,
      ).catch(e =>
        log.error('playback', 'closeActiveSession (local episode switch) failed', { err: String(e) }),
      );
      st.setSessionReady(false);
      st.setSessionId('');
      let startTime = startTimeOverride;
      if (startTime === undefined) {
        try {
          const lp = await getLocalProgress(podcastItemId, episodeId);
          startTime = lp && !lp.isFinished ? lp.currentTime : 0;
        } catch { startTime = 0; }
      }
      // Keyed by the show, not the episode — see speedMemory. As in playBook,
      // the rate rides along with the command that starts playback.
      await playLocalFile(
        localPath, podcastItemId, startTime, true, episodeId,
        false, undefined, resolveItemSpeed(st, podcastItemId),
      );
      st.setIsLocalPlayback(true);
      st.setPosition(startTime);
      st.setCurrentEpisodeId(episodeId);
      st.setCurrentEpisode(episode);
      st.setCurrentBookId(podcastItemId);
      st.setFocusedBookId(podcastItemId);
      st.setPlaying(true);
      return;
    }

    st.setIsLocalPlayback(false);
    await closePreviousSession(
      st,
      podcastItemId,
      episodeId,
      serverCheck,
      startTimeOverride !== undefined,
    ).catch(e =>
      log.error('playback', 'closeActiveSession failed', { err: String(e) })
    );
    st.setSessionReady(false);
    st.setSessionId('');
    st.setPlaying(false);

    // As with books, an ordinary resume must use the server session's currentTime
    // so playback on another device wins over Skald's cached mediaProgress. Only
    // an explicit episode/chapter jump should override the server position.
    const requestedStartTime = startTimeOverride;
    const result = await openPlaybackSession(st.serverUrl, podcastItemId, st.userId, requestedStartTime, episodeId);
    log.info('playback', 'episode session opened', {
      bookId: podcastItemId,
      episodeId,
      sessionId: result.sessionId,
      resumeSource: requestedStartTime === undefined ? 'server' : 'explicit',
      currentTime: result.currentTime,
    });
    st.setSessionId(result.sessionId);
    st.setSessionReady(true);
    st.setCurrentEpisodeId(episodeId);
    st.setCurrentEpisode(episode);
    st.setCurrentBookId(podcastItemId);
    st.setFocusedBookId(podcastItemId);
    const cached = st.mediaProgress.find(progress =>
      progress.libraryItemId === podcastItemId &&
      (progress.episodeId ?? null) === episodeId);
    const localCurrentTime =
      st.currentBookId === podcastItemId && st.currentEpisodeId === episodeId
        ? Math.max(st.position, cached?.currentTime ?? 0)
        : cached?.currentTime ?? 0;
    const preflightCurrentTime = serverCheck.progress && !serverCheck.progress.isFinished
      ? serverCheck.progress.currentTime
      : 0;
    const resumeTime = requestedStartTime === undefined
      ? Math.max(result.currentTime, preflightCurrentTime, localCurrentTime)
      : result.currentTime;
    if (resumeTime > result.currentTime) {
      await seekAudio(resumeTime);
      log.info('playback', 'preserved later local episode resume position', {
        podcastItemId,
        episodeId,
        localCurrentTime,
        preflightCurrentTime,
        serverCurrentTime: result.currentTime,
      });
    }
    st.setPosition(resumeTime);

    try {
      // Keyed by the show, not the episode — see speedMemory.
      await applyItemSpeed(st, podcastItemId);
      await playAudio();
      st.setPlaying(true);
    } catch (error) {
      logErr(error);
      st.setPlaying(false);
    }
  } finally {
    playBookInFlight = false;
  }
}

// Shared mute control. Pairs the LibVLC volume command with the React
// muted-state flag so the toolbar mute button and the keyboard shortcut
// behave identically and LibVLC is actually silenced (not just the UI).
export async function muteAudio(st: OnyxState): Promise<void> {
  // Silence LibVLC output by setting volume to 0
  await setAudioVolume(0).catch(logErr);
  // Reflect muted state in the UI
  st.setMuted(true);
}

export async function unmuteAudio(st: OnyxState): Promise<void> {
  // Restore LibVLC output to the user's last volume level.
  // st.volume is stored as a 0–1 fraction; setAudioVolume expects 0–100.
  await setAudioVolume(Math.round(st.volume * 100)).catch(logErr);
  // Clear muted state in the UI
  st.setMuted(false);
}

// ── Playback speed ───────────────────────────────────────────────────────────
// Both helpers live here rather than in the components so there is exactly one
// place that decides a rate and one that records it. The auto-rewind logic used
// to be duplicated across two call sites, and that is precisely how the keyboard
// and the transport ended up able to disagree.

/** The rate this item should play at — its remembered one, or the global
 *  default — with the UI brought into line. Returns it so a caller that starts
 *  audio through a command of its own (local playback) can hand the rate to
 *  that command instead of racing it with a separate setSpeed. */
export function resolveItemSpeed(st: OnyxState, itemId: string): number {
  const rate = speedForItem(itemId);
  const source = hasRememberedSpeed(itemId) ? 'per-book' : 'global';
  log.debug('playback', 'applying speed', { itemId, rate, source });
  st.setSpeed(String(rate));
  return rate;
}

/** Apply the rate this item should play at to the engine. Called at every
 *  playback start that starts audio with a separate play command; without it the
 *  Settings "Default playback speed" control persists a value nothing ever
 *  reads, and the previous book's rate carries into this one. */
export async function applyItemSpeed(st: OnyxState, itemId: string): Promise<void> {
  await setAudioSpeed(resolveItemSpeed(st, itemId)).catch(logErr);
}

/** Record and apply a rate the listener just chose. Writes to the per-book map,
 *  never to the global default — that belongs to the Settings control alone. */
export async function changeSpeed(st: OnyxState, itemId: string | undefined, rate: string): Promise<void> {
  st.setSpeed(rate);
  const parsed = parseFloat(rate);
  rememberSpeed(itemId, parsed);
  await setAudioSpeed(parsed).catch(logErr);
}

// Shared playback toggle for an already-open session. Pairs the LibVLC
// command with the React state update so the UI never lags behind the
// actual audio state. Use this anywhere that pauses/resumes the CURRENT
// book without switching books (MiniPlayer, FocusPanel resume, shortcuts).
// Do NOT use this for cold-starting a different book — that is playBook's job.
export async function togglePlayback(st: OnyxState): Promise<void> {
  if (st.playing) {
    // Currently playing → pause LibVLC and reflect it immediately
    await pauseAudio().catch(logErr);
    st.setPlaying(false);
  } else {
    // Currently paused → resume (applies the auto-rewind-on-resume preference)
    await resumePlayback(st);
  }
}

// Resume the CURRENT (already-loaded) book, applying the user's
// "auto-rewind on resume" preference (Settings → Playback). Route every
// paused→playing transition of the current book through this so the rewind is
// applied uniformly and exactly once. Do NOT use this to cold-start a different
// book — playBook resolves its own resume position and must not be rewound.
export async function resumePlayback(st: OnyxState): Promise<void> {
  await resumeWithRewind(currentChapterStart(st), st.setPosition, st.setPlaying);
}

/** The paused→playing transition itself, over plain setters so the window
 *  Space-key handler — which lives inside useOnyxState and has no assembled
 *  OnyxState to hand around — runs the *same* code as the transport buttons
 *  rather than a copy that can drift. The failure branch is the reason this is
 *  shared: a resume that rejects must leave the UI paused, which is exactly what
 *  the Space handler's own version got wrong. */
export async function resumeWithRewind(
  chapterStart: number | undefined,
  setPosition: (secs: number) => void,
  setPlaying: (playing: boolean) => void,
): Promise<void> {
  try {
    // The backend owns the rewind decision — it is the only side that knows how
    // long the pause actually lasted, and keeping the choice in one place is what
    // stops the transport controls and the Space key from diverging.
    const { position, rewound } = await resumeAudio(chapterStart);
    if (rewound > 0) setPosition(position);
    setPlaying(true);
  } catch (error) {
    logErr(error);
    setPlaying(false);
  }
}

/** Start of the chapter the listener is currently in, for the chapter barrier.
 *  The playing book is resolved the same way the rest of the app resolves it —
 *  shelf first, then the now-playing snapshot — because it leaves `st.library`
 *  the moment the user switches libraries, and a barrier that quietly vanishes
 *  there would let auto-rewind cross into the previous chapter. */
function currentChapterStart(st: OnyxState): number | undefined {
  const book = st.library.find(b => b.id === st.currentBookId) ?? st.playingItem;
  return chapterStartAt(book, st.position);
}
