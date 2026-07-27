// Split from the original single-file abs.ts (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. Import from '../abs' (the barrel),
// not from this file directly.
import { invoke } from '@tauri-apps/api/core';
import type { AudioDevice, Bookmark, OpenSessionResult } from './types';

export function openPlaybackSession(
  serverUrl: string,
  itemId: string,
  userId: string,
  startTime?: number,
  episodeId?: string,
): Promise<OpenSessionResult> {
  return invoke('open_playback_session', {
    serverUrl,
    itemId,
    userId,
    episodeId: episodeId ?? null,
    startTime: startTime ?? null,
  });
}

export function playAudio(): Promise<void> {
  return invoke('play_audio');
}

export function pauseAudio(): Promise<void> {
  return invoke('pause_audio');
}

/** What resumeAudio actually did — the caller uses it to bring the UI into line. */
export interface ResumeOutcome {
  /** Where playback resumed from, after any rewind. */
  position: number;
  /** Seconds stepped back; 0 when no rewind applied. */
  rewound: number;
}

/** Resume the current book, applying the auto-rewind the backend is configured
 *  for (fixed or adaptive). This is the ONLY paused→playing transition — the
 *  rewind must not be recomputed by callers, or the transport and the keyboard
 *  drift apart, which is what this replaced.
 *
 *  `chapterStart` is the start of the chapter the listener is in, needed only
 *  when the chapter barrier is enabled; the backend has no chapter list. */
export function resumeAudio(chapterStart?: number): Promise<ResumeOutcome> {
  return invoke('resume_audio', { chapterStart: chapterStart ?? null });
}

/** Push Settings → Playback's auto-rewind configuration down to the backend. */
export function setAutoRewindCfg(cfg: AutoRewindCfg): Promise<void> {
  return invoke('set_auto_rewind_cfg', { cfg });
}

/** Mirrors the Rust AutoRewindCfg. Describes both rewind modes, because one
 *  backend path decides every resume. */
export interface AutoRewindCfg {
  adaptive: boolean;
  fixedSecs: number;
  minSecs: number;
  maxSecs: number;
  activationDelaySecs: number;
  chapterBarrier: boolean;
}

export function seekAudio(secs: number): Promise<void> {
  return invoke('seek_audio', { secs });
}

/** Retry closing only sessions journaled by this Skald installation/user. */
export function cleanupOwnedPlaybackSessions(serverUrl: string, userId: string): Promise<number> {
  return invoke('cleanup_owned_playback_sessions', { serverUrl, userId });
}

/** Persist the backend player's current position before a lifecycle boundary. */
export function syncActiveSession(): Promise<void> {
  return invoke('sync_active_session');
}

export function setSpeed(rate: number): Promise<void> {
  return invoke('set_speed', { rate });
}

export function setVolume(vol: number): Promise<void> {
  return invoke('set_volume', { vol });
}

export function createBookmark(
  serverUrl: string,
  itemId: string,
  time: number,
  title: string,
): Promise<Bookmark> {
  return invoke('create_bookmark', { serverUrl, itemId, time, title });
}

export function deleteProgress(serverUrl: string, itemId: string): Promise<void> {
  return invoke('delete_progress', { serverUrl, itemId });
}

export function updateProgress(
  serverUrl: string,
  itemId: string,
  currentTime: number,
  duration: number,
  isFinished: boolean,
  episodeId?: string,
): Promise<void> {
  return invoke('update_progress', { serverUrl, itemId, episodeId: episodeId ?? null, currentTime, duration, isFinished });
}

export function syncSession(
  serverUrl: string,
  sessionId: string,
  currentTime: number,
  timeListened: number,
): Promise<void> {
  return invoke('sync_session', { serverUrl, sessionId, currentTime, timeListened });
}

export function getAudioDevices(): Promise<AudioDevice[]> {
  return invoke('get_audio_devices');
}

export function setAudioDevice(deviceId: string): Promise<void> {
  return invoke('set_audio_device', { deviceId });
}

export function closeSession(
  serverUrl: string,
  sessionId: string,
  currentTime: number,
  timeListened: number,
): Promise<void> {
  return invoke('close_session', { serverUrl, sessionId, currentTime, timeListened });
}

export function closeActiveSession(): Promise<void> {
  return invoke('close_active_session');
}

/** Close a stale loaded session without publishing its position over newer ABS progress. */
export function closeActiveSessionWithoutSync(): Promise<void> {
  return invoke('close_active_session_without_sync');
}

/** Phase D — opens a local audio file in LibVLC for offline playback.
 *  filePath may point to a single audio file or a directory (multi-file book);
 *  the Rust layer resolves the correct first file in the latter case.
 *  Starts the 1-second playback-tick loop so all transport controls remain live.
 *  itemId is the ABS library item ID — stored so progress can be queued offline.
 *  Does NOT open a server session — no network access is required.
 *  `speed` is the item's resolved rate: this command starts playback itself, so
 *  the rate must travel with it rather than arriving in a later setSpeed call
 *  that the first seconds of audio would already have outrun. */
export function playLocalFile(
  filePath: string,
  itemId: string,
  startTime: number,
  localLibrary = false,
  episodeId?: string,
  baselineCaptured = false,
  serverLastUpdate?: number,
  speed?: number,
  // Whose listening this is. A downloaded book accrues an offline session that
  // may not reach ABS for days, and ABS credits whoever is authenticated when it
  // arrives — so the account is captured at playback start and travels with the
  // session. Unused for local-library items (their listening never leaves).
  serverUrl?: string,
  userId?: string,
): Promise<void> {
  return invoke('play_local_file', {
    filePath, itemId, startTime, localLibrary,
    episodeId: episodeId ?? null,
    baselineCaptured,
    serverLastUpdate: serverLastUpdate ?? null,
    speed: speed ?? null,
    serverUrl: serverUrl ?? null,
    userId: userId ?? null,
  });
}
