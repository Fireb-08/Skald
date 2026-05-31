// Canonical entry point for starting playback of any book. Every play button
// in the app routes through this so behaviour is identical everywhere:
// close any existing session, open a fresh session at the book's saved
// server position (or an explicit override), start audio, and sync the UI.
import type { OnyxState } from '../state/onyx';
import { closeActiveSession, openPlaybackSession, playAudio } from './abs';

export async function playBook(
  st: OnyxState,
  bookId: string,
  startTimeOverride?: number, // only for chapter clicks / bookmark jumps
): Promise<void> {
  // 1. Tear down any existing session so the server commits its final state
  await closeActiveSession().catch(() => {});
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
