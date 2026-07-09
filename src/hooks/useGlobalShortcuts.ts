import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  registerShortcuts,
  seekAudio,
  setVolume as setAudioVolume,
} from '../api/abs';
// muteAudio/unmuteAudio share identical logic with the VolumeControl button
// so both input paths behave the same and LibVLC is always in sync with the UI.
// togglePlayback is the canonical pause/resume (applies auto-rewind-on-resume).
import { muteAudio, unmuteAudio, togglePlayback } from '../api/playbook';
import { skipSeconds } from '../lib/playbackPrefs';
import { log } from '../lib/log';
import type { OnyxState } from '../state/onyx';
import type { ShortcutBinding } from '../api/abs';

// Module-level flag prevents React StrictMode's double-mount from registering
// duplicate Tauri event listeners, which would cause each shortcut to fire twice.
let registered = false;

export const DEFAULT_SHORTCUTS: ShortcutBinding[] = [
  { action: 'play_pause',   shortcut: 'Ctrl+Alt+Space' },
  { action: 'skip_forward', shortcut: 'Ctrl+Alt+Right' },
  { action: 'skip_back',    shortcut: 'Ctrl+Alt+Left'  },
  { action: 'volume_up',    shortcut: 'Ctrl+Alt+Up'    },
  { action: 'volume_down',  shortcut: 'Ctrl+Alt+Down'  },
  { action: 'mute',         shortcut: 'Ctrl+Alt+M'     },
];

function loadBindings(): ShortcutBinding[] {
  try {
    const raw = localStorage.getItem('onyx.shortcuts');
    if (raw) return JSON.parse(raw) as ShortcutBinding[];
  } catch { /* fall through */ }
  return DEFAULT_SHORTCUTS;
}

export function useGlobalShortcuts(st: OnyxState): void {
  const stRef = useRef(st);

  useEffect(() => {
    stRef.current = st;
  });

  useEffect(() => {
    if (registered) return;
    registered = true;

    const shortcutErr = (e: unknown) =>
      log.error('playback', 'global shortcut command failed', { err: String(e) });

    const bindings = loadBindings();
    // Safe to re-run on a later mount: the Rust command unregister_alls first.
    registerShortcuts(bindings).catch(shortcutErr);

    const unlisteners: Array<() => void> = [];
    // Cleanup can run BEFORE the listen() promises resolve (StrictMode's fake
    // unmount is immediate) — a late-resolving listener must tear itself down
    // instead of surviving into the next mount and double-firing shortcuts.
    let disposed = false;

    function on(event: string, handler: () => void) {
      listen(event, handler)
        .then(fn => { if (disposed) fn(); else unlisteners.push(fn); })
        .catch(shortcutErr);
    }

    on('shortcut-play_pause', () => {
      // Canonical toggle — pauses, or resumes with auto-rewind-on-resume applied.
      togglePlayback(stRef.current).catch(shortcutErr);
    });

    on('shortcut-skip_forward', () => {
      seekAudio(stRef.current.position + skipSeconds()).catch(shortcutErr);
    });

    on('shortcut-skip_back', () => {
      seekAudio(Math.max(0, stRef.current.position - skipSeconds())).catch(shortcutErr);
    });

    on('shortcut-volume_up', () => {
      const vol = Math.min(1, stRef.current.volume + 0.1);
      stRef.current.setVolume(vol);
      setAudioVolume(Math.round(vol * 100)).catch(shortcutErr);
    });

    on('shortcut-volume_down', () => {
      const vol = Math.max(0, stRef.current.volume - 0.1);
      stRef.current.setVolume(vol);
      setAudioVolume(Math.round(vol * 100)).catch(shortcutErr);
    });

    on('shortcut-mute', () => {
      // Use stRef.current to avoid stale closures — the helpers receive the
      // live OnyxState snapshot and handle both LibVLC and UI state in sync.
      if (stRef.current.muted) {
        unmuteAudio(stRef.current);
      } else {
        muteAudio(stRef.current);
      }
    });

    return () => {
      disposed = true;
      unlisteners.forEach(fn => fn());
      // Reset the StrictMode guard: the fake dev unmount just removed every
      // listener, so the second mount MUST be allowed to re-register — leaving
      // this true made shortcuts fire into a void for the whole dev session.
      registered = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
