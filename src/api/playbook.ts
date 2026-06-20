// Canonical entry point for starting playback of any book. Every play button
// in the app routes through this so behaviour is identical everywhere:
// close any existing session, open a fresh session at the book's saved
// server position (or an explicit override), start audio, and sync the UI.
import type { OnyxState } from '../state/onyx';
import type { PodcastEpisode } from './abs';
import { closeActiveSession, openPlaybackSession, playAudio, pauseAudio, setVolume as setAudioVolume, playLocalFile, getOfflineProgress, getLocalProgress } from './abs';
import { log } from '../lib/log';

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
    console.log('[playBook] already in flight — ignoring duplicate call');
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
    log.info('playback', 'playBook', { bookId, offline: !!localFilePath, local: isLocalLibrary, override: startTimeOverride !== undefined });
    if (localFilePath) {
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
            // Progress already in state (server cache).
            startTime = saved.currentTime;
          } else {
            // Downloaded ABS book — query the local offline queue written by the tick task.
            try {
              const offlineProgress = await getOfflineProgress(bookId);
              startTime = offlineProgress?.currentTime ?? 0;
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
    //    book's saved progress from the server, otherwise 0.
    let startTime = startTimeOverride;
    if (startTime === undefined) {
      const saved = st.mediaProgress.find(p => p.libraryItemId === bookId);
      startTime = saved ? saved.currentTime : 0;
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
    await playAudio().catch(console.error);
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
    console.log('[playEpisode] already in flight — ignoring duplicate call');
    return;
  }
  playBookInFlight = true;
  try {
    st.setIsLocalPlayback(false);
    await closeActiveSession().catch(e =>
      console.error('[playbook] closeActiveSession failed:', e)
    );
    st.setSessionReady(false);
    st.setSessionId('');
    st.setPlaying(false);

    // Resolve start position: explicit override > saved episode progress > 0.
    // Episode progress records carry both libraryItemId and episodeId.
    let startTime = startTimeOverride;
    if (startTime === undefined) {
      const saved = st.mediaProgress.find(
        p => p.libraryItemId === podcastItemId && p.episodeId === episodeId,
      );
      startTime = saved ? saved.currentTime : 0;
    }

    const result = await openPlaybackSession(st.serverUrl, podcastItemId, startTime, episodeId);
    st.setSessionId(result.sessionId);
    st.setSessionReady(true);
    st.setCurrentEpisodeId(episodeId);
    st.setCurrentEpisode(episode);
    st.setCurrentBookId(podcastItemId);
    st.setFocusedBookId(podcastItemId);
    st.setPosition(result.currentTime);

    await playAudio().catch(console.error);
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
  await setAudioVolume(0).catch(console.error);
  // Reflect muted state in the UI
  st.setMuted(true);
}

export async function unmuteAudio(st: OnyxState): Promise<void> {
  // Restore LibVLC output to the user's last volume level.
  // st.volume is stored as a 0–1 fraction; setAudioVolume expects 0–100.
  await setAudioVolume(Math.round(st.volume * 100)).catch(console.error);
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
    await pauseAudio().catch(console.error);
    st.setPlaying(false);
  } else {
    // Currently paused → resume LibVLC and reflect it immediately
    await playAudio().catch(console.error);
    st.setPlaying(true);
  }
}
