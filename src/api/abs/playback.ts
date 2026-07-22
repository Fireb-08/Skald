// Split from the original single-file abs.ts (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. Import from '../abs' (the barrel),
// not from this file directly.
import { invoke } from '@tauri-apps/api/core';
import type { AudioDevice, Bookmark, OpenSessionResult } from './types';

export function openPlaybackSession(
  serverUrl: string,
  itemId: string,
  startTime?: number,
  episodeId?: string,
): Promise<OpenSessionResult> {
  return invoke('open_playback_session', {
    serverUrl,
    itemId,
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

export function seekAudio(secs: number): Promise<void> {
  return invoke('seek_audio', { secs });
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

/** Phase D — opens a local audio file in LibVLC for offline playback.
 *  filePath may point to a single audio file or a directory (multi-file book);
 *  the Rust layer resolves the correct first file in the latter case.
 *  Starts the 1-second playback-tick loop so all transport controls remain live.
 *  itemId is the ABS library item ID — stored so progress can be queued offline.
 *  Does NOT open a server session — no network access is required. */
export function playLocalFile(
  filePath: string,
  itemId: string,
  startTime: number,
  localLibrary = false,
  episodeId?: string,
  baselineCaptured = false,
  serverLastUpdate?: number,
): Promise<void> {
  return invoke('play_local_file', {
    filePath, itemId, startTime, localLibrary,
    episodeId: episodeId ?? null,
    baselineCaptured,
    serverLastUpdate: serverLastUpdate ?? null,
  });
}
