// Canonical entry point for starting playback of any book. Every play button
// in the app routes through this so behaviour is identical everywhere:
// close any existing session, open a fresh session at the book's saved
// server position (or an explicit override), start audio, and sync the UI.
import type { OnyxState } from '../state/onyx';
import type { PodcastEpisode } from './abs';
import { closeActiveSession, openPlaybackSession, playAudio, pauseAudio, setVolume as setAudioVolume, playLocalFile, getOfflineProgress, getLocalProgress, seekAudio } from './abs';
import { log } from '../lib/log';
import { rewindSeconds } from '../lib/playbackPrefs';

// Shared boundary logger for fire-and-forget transport calls — routes through
// the structured framework (Skald log viewer) instead of the raw console.
const logErr = (e: unknown) => log.error('playback', 'transport command failed', { err: String(e) });

// Guard against concurrent playBook calls.
// openPlaybackSession is async and slow — a second click during the await
// would start a second session, clobbering the first call's setSessionReady(true)
// with a new setSessionReady(false) at line 78.
let playBookInFlight = false;

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
    if (localFilePath) {
      // Close any session left open from a previous ONLINE book first. play_local
      // (below) nulls the session id, after which closeActiveSession would no-op —
      // so without this, switching from a streamed book to a downloaded one would
      // orphan an open session on the ABS server.
      await closeActiveSession().catch(e =>
        log.error('playback', 'closeActiveSession (offline switch) failed', { err: String(e) }),
      );
      // Clear any stale online session state — there is no server session in the
      // offline path, so these flags must not mislead other components.
      st.setSessionReady(false);
      st.setSessionId('');

      // Resolve start position: explicit override > server progress > offline queue > 0.
      // When offline, st.mediaProgress may be empty since it requires a server fetch.
      // Fall back to the offline progress queue which persists locally between launches.
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
        } else {
          const saved = st.mediaProgress.find(p => p.libraryItemId === bookId);
          if (saved) {
            // Progress already in state (server cache). A finished record sits at
            // the media duration — restart from 0 instead of resuming at the end
            // (same replay rule as the local-library branch above).
            startTime = saved.isFinished ? 0 : saved.currentTime;
          } else {
            // Downloaded ABS book — query the local offline queue written by the tick task.
            try {
              const offlineProgress = await getOfflineProgress(bookId);
              startTime = offlineProgress && !offlineProgress.isFinished ? offlineProgress.currentTime : 0;
            } catch {
              startTime = 0;
            }
          }
        }
      }

      // Tell LibVLC to open the local file. The Rust command handles file:/// URI
      // construction and starts the 1-second tick loop so playback-tick events flow.
      // bookId is passed so the session layer can key offline progress queue entries
      // to the correct item.
      await playLocalFile(localFilePath, bookId, startTime, isLocalLibrary);

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
    await closeActiveSession().catch(e =>
      log.error('playback', 'closeActiveSession failed', { err: String(e) })
    );
    st.setSessionReady(false);
    st.setSessionId('');
    st.setPlaying(false);

    // 2. Determine start position: explicit override wins, otherwise the
    //    book's saved progress from the server, otherwise 0. A finished book
    //    restarts from the beginning — its record sits at the media duration,
    //    so resuming there would open the player at the end.
    let startTime = startTimeOverride;
    if (startTime === undefined) {
      const saved = st.mediaProgress.find(p => p.libraryItemId === bookId);
      startTime = saved && !saved.isFinished ? saved.currentTime : 0;
    }

    // 3. Open the session at the resolved position — server tells LibVLC
    //    to begin decoding from startTime so there is no seek glitch.
    let result;
    try {
      result = await openPlaybackSession(st.serverUrl, bookId, startTime);
    } catch (e) {
      log.error('playback', 'openPlaybackSession failed', { bookId, err: String(e) });
      throw e;
    }
    log.info('playback', 'session opened', { bookId, sessionId: result.sessionId });
    st.setSessionId(result.sessionId);
    st.setSessionReady(true);
    st.setCurrentBookId(bookId);
    // Keep focused book in sync so the Player view reflects the playing book.
    st.setFocusedBookId(bookId);

    // 4. Sync UI position to the server-confirmed currentTime before the
    //    first playback-tick event so waveform and chapter highlight are
    //    correct from the first render.
    st.setPosition(result.currentTime);

    // 5. Start playback and optimistically mark the UI as playing — the
    //    playback-tick event from Rust confirms within ~1 second.
    await playAudio().catch(logErr);
    st.setPlaying(true);
  } finally {
    // Always clear the flag, even if playBook throws
    playBookInFlight = false;
  }
}

// Canonical entry point for starting playback of a podcast episode (cluster E).
// Mirrors playBook's online path but opens the session on the episode so the
// server tracks per-episode progress. Podcast episodes are not part of the
// offline download registry, so there is no local-file branch here.
export async function playEpisode(
  st: OnyxState,
  podcastItemId: string,
  episode: PodcastEpisode,
  startTimeOverride?: number,
): Promise<void> {
  const episodeId = episode.id;
  if (!episodeId) return;
  if (playBookInFlight) {
    log.debug('playback', 'playEpisode already in flight — ignoring duplicate call', { podcastItemId, episodeId });
    return;
  }
  playBookInFlight = true;
  try {
    // Snapshot the parent podcast so the cross-library MiniPlayer can render the
    // playing episode even after the user switches to a different library.
    const podItem = st.library.find(b => b.id === podcastItemId);
    if (podItem) st.setPlayingItem(podItem);
    // ── Local podcast path: play a downloaded episode from disk (no server) ──────
    // A local podcast episode carries `localPath` (the downloaded audio file) and
    // its progress lives in the catalog keyed per (podcast, episode).
    const localPath = (episode as unknown as { localPath?: string }).localPath;
    if (st.activeLibrary?.source === 'local' && localPath) {
      // Close any open online session first (see playBook) so switching to a
      // local episode doesn't orphan a server session.
      await closeActiveSession().catch(e =>
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
      await playLocalFile(localPath, podcastItemId, startTime, true, episodeId);
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
    await closeActiveSession().catch(e =>
      log.error('playback', 'closeActiveSession failed', { err: String(e) })
    );
    st.setSessionReady(false);
    st.setSessionId('');
    st.setPlaying(false);

    // Resolve start position: explicit override > saved episode progress > 0.
    // Episode progress records carry both libraryItemId and episodeId. A
    // finished episode restarts from the beginning (same rule as books).
    let startTime = startTimeOverride;
    if (startTime === undefined) {
      const saved = st.mediaProgress.find(
        p => p.libraryItemId === podcastItemId && p.episodeId === episodeId,
      );
      startTime = saved && !saved.isFinished ? saved.currentTime : 0;
    }

    const result = await openPlaybackSession(st.serverUrl, podcastItemId, startTime, episodeId);
    st.setSessionId(result.sessionId);
    st.setSessionReady(true);
    st.setCurrentEpisodeId(episodeId);
    st.setCurrentEpisode(episode);
    st.setCurrentBookId(podcastItemId);
    st.setFocusedBookId(podcastItemId);
    st.setPosition(result.currentTime);

    await playAudio().catch(logErr);
    st.setPlaying(true);
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
  const rewind = rewindSeconds();
  if (rewind > 0 && st.position > 0) {
    // Step back a few seconds so the listener re-hears the lead-up to where they
    // paused. Clamp at 0; seekAudio moves LibVLC, setPosition keeps the UI in sync.
    const target = Math.max(0, st.position - rewind);
    await seekAudio(target).catch(logErr);
    st.setPosition(target);
  }
  await playAudio().catch(logErr);
  st.setPlaying(true);
}
