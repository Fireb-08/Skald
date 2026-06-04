// Canonical entry point for starting playback of any book. Every play button
// in the app routes through this so behaviour is identical everywhere:
// close any existing session, open a fresh session at the book's saved
// server position (or an explicit override), start audio, and sync the UI.
import type { OnyxState } from '../state/onyx';
import { closeActiveSession, openPlaybackSession, playAudio, pauseAudio, setVolume as setAudioVolume, playLocalFile } from './abs';

export async function playBook(
  st: OnyxState,
  bookId: string,
  startTimeOverride?: number, // only for chapter clicks / bookmark jumps
): Promise<void> {
  // ── Offline path: play from local file when the book is downloaded ──────────
  // If the book is downloaded locally, play from disk rather than opening a
  // server session — this enables offline playback without network access.
  const localDownload = st.downloads.find(d => d.itemId === bookId);
  if (localDownload) {
    // Clear any stale online session state — there is no server session in the
    // offline path, so these flags must not mislead other components.
    st.setSessionReady(false);
    st.setSessionId('');

    // Resolve start position: explicit override wins, then saved server progress,
    // then 0. The saved position may be from a prior online session; using it
    // means the user resumes where they left off even when offline.
    const savedProgress = st.mediaProgress.find(p => p.libraryItemId === bookId);
    const offlineStart = startTimeOverride ?? savedProgress?.currentTime ?? 0;

    // Tell LibVLC to open the local file. The Rust command handles file:/// URI
    // construction and starts the 1-second tick loop so playback-tick events flow.
    await playLocalFile(localDownload.filePath, offlineStart);

    // Signal to the frontend that we are in local playback mode so transport
    // controls bypass session management and call audio commands directly.
    st.setIsLocalPlayback(true);

    // Seed the UI position to the resolved start time immediately, before the
    // first playback-tick event (~1 second later). Without this the waveform
    // and timestamp display 0:00 for the first tick interval even though LibVLC
    // has already seeked to offlineStart — mirroring st.setPosition(result.currentTime)
    // in the online path.
    st.setPosition(offlineStart);

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
    console.error('[playbook] closeActiveSession failed:', e)
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
  const result = await openPlaybackSession(st.serverUrl, bookId, startTime);
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
