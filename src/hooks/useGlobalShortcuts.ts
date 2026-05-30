import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  registerShortcuts,
  playAudio,
  pauseAudio,
  seekAudio,
  setVolume as setAudioVolume,
} from '../api/abs';
import type { OnyxState } from '../state/onyx';
import type { ShortcutBinding } from '../api/abs';

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

function readSkipSecs(): number {
  try {
    const raw = localStorage.getItem('onyx.playback.skip') ?? '"30s"';
    const str = JSON.parse(raw) as string;
    return parseInt(str.replace('s', ''), 10) || 30;
  } catch {
    return 30;
  }
}

export function useGlobalShortcuts(st: OnyxState): void {
  const stRef = useRef(st);

  useEffect(() => {
    stRef.current = st;
  });

  useEffect(() => {
    const bindings = loadBindings();
    registerShortcuts(bindings).catch(console.error);

    const unlisteners: Array<() => void> = [];

    function on(event: string, handler: () => void) {
      listen(event, handler)
        .then(fn => unlisteners.push(fn))
        .catch(console.error);
    }

    on('shortcut-play_pause', () => {
      if (stRef.current.playing) {
        pauseAudio().catch(console.error);
      } else {
        playAudio().catch(console.error);
      }
    });

    on('shortcut-skip_forward', () => {
      const secs = readSkipSecs();
      seekAudio(stRef.current.position + secs).catch(console.error);
    });

    on('shortcut-skip_back', () => {
      const secs = readSkipSecs();
      seekAudio(Math.max(0, stRef.current.position - secs)).catch(console.error);
    });

    on('shortcut-volume_up', () => {
      const vol = Math.min(1, stRef.current.volume + 0.1);
      stRef.current.setVolume(vol);
      setAudioVolume(Math.round(vol * 100)).catch(console.error);
    });

    on('shortcut-volume_down', () => {
      const vol = Math.max(0, stRef.current.volume - 0.1);
      stRef.current.setVolume(vol);
      setAudioVolume(Math.round(vol * 100)).catch(console.error);
    });

    on('shortcut-mute', () => {
      setAudioVolume(0).catch(console.error);
    });

    return () => unlisteners.forEach(fn => fn());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
