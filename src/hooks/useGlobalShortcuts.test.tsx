// Regression test for the StrictMode shortcut lifecycle (Testing Suite plan #5,
// 2nd-pass review P3): the dev double-mount used to strand global shortcuts
// with zero listeners because the module guard never reset on cleanup.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { OnyxState } from '../state/onyx';

// Inlined mock state (same shape as src/test/tauriMocks.ts) — vi.mock
// factories are hoisted above imports, so the state must be hoisted too.
const tauri = vi.hoisted(() => {
  const handlers = new Map<string, (args?: Record<string, unknown>) => unknown>();
  const listeners = new Map<string, Set<(e: { event: string; payload: unknown }) => void>>();
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  return {
    calls,
    listeners,
    invoke: async (cmd: string, args?: Record<string, unknown>) => {
      calls.push({ cmd, args });
      return handlers.get(cmd)?.(args);
    },
    listen: (event: string, cb: (e: { event: string; payload: unknown }) => void) => {
      let set = listeners.get(event);
      if (!set) { set = new Set(); listeners.set(event, set); }
      set.add(cb);
      return Promise.resolve(() => { set!.delete(cb); });
    },
    emit: (event: string, payload?: unknown) => listeners.get(event)?.forEach(cb => cb({ event, payload })),
    count: (event: string) => listeners.get(event)?.size ?? 0,
  };
});

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: tauri.listen }));
vi.mock('@tauri-apps/plugin-log', () => ({
  info: vi.fn(async () => {}), warn: vi.fn(async () => {}), error: vi.fn(async () => {}),
  debug: vi.fn(async () => {}), attachConsole: vi.fn(async () => () => {}),
}));

import { useGlobalShortcuts } from './useGlobalShortcuts';

const SHORTCUT_EVENTS = [
  'shortcut-play_pause', 'shortcut-skip_forward', 'shortcut-skip_back',
  'shortcut-volume_up', 'shortcut-volume_down', 'shortcut-mute',
];

function fakeState(): OnyxState {
  return {
    position: 100,
    volume: 0.5,
    muted: false,
    playing: false,
    setVolume: vi.fn(),
    setMuted: vi.fn(),
    setPlaying: vi.fn(),
  } as unknown as OnyxState;
}

describe('useGlobalShortcuts under StrictMode', () => {
  it('keeps exactly one live listener per shortcut after the double-mount, and none after unmount', async () => {
    const st = fakeState();
    const { unmount } = renderHook(() => useGlobalShortcuts(st), {
      // StrictMode reproduces the dev mount → fake-unmount → mount cycle.
      wrapper: ({ children }) => <React.StrictMode>{children}</React.StrictMode>,
    });
    // Flush the listen() promises from both mounts (registration is async).
    await act(async () => {});

    for (const ev of SHORTCUT_EVENTS) {
      // 0 = the original bug (listeners stranded); 2 = double-registration.
      expect(tauri.count(ev), ev).toBe(1);
    }

    // A fired shortcut actually reaches its handler: volume_up must bump state
    // and push the new level to LibVLC.
    await act(async () => { tauri.emit('shortcut-volume_up'); });
    expect(st.setVolume).toHaveBeenCalledWith(0.6);
    expect(tauri.calls.some(c => c.cmd === 'set_volume')).toBe(true);

    unmount();
    for (const ev of SHORTCUT_EVENTS) {
      expect(tauri.count(ev), `${ev} after unmount`).toBe(0);
    }
  });

  it('re-registers cleanly on a later mount (guard resets)', async () => {
    const { unmount } = renderHook(() => useGlobalShortcuts(fakeState()), {
      wrapper: ({ children }) => <React.StrictMode>{children}</React.StrictMode>,
    });
    await act(async () => {});
    unmount();

    renderHook(() => useGlobalShortcuts(fakeState()), {
      wrapper: ({ children }) => <React.StrictMode>{children}</React.StrictMode>,
    });
    await act(async () => {});
    for (const ev of SHORTCUT_EVENTS) {
      expect(tauri.count(ev), ev).toBe(1);
    }
    // register_shortcuts must have been re-invoked for the new mount.
    expect(tauri.calls.filter(c => c.cmd === 'register_shortcuts').length).toBeGreaterThanOrEqual(2);
  });
});
