// Journey-level tests (review H2): exercise the promises the helper tests
// can't see — the combined All Libraries shelf handing an item to playback and
// returning to its source library, and partial-coverage signalling end to end
// through useOnyxState. Interaction-focused assertions, not snapshots.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const tauri = vi.hoisted(() => {
  const handlers = new Map<string, (args?: Record<string, unknown>) => unknown>();
  const listeners = new Map<string, Set<(e: { event: string; payload: unknown }) => void>>();
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  return {
    calls,
    handlers,
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
  };
});

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke, convertFileSrc: (p: string) => `asset://${p}` }));
vi.mock('@tauri-apps/api/event', () => ({ listen: tauri.listen }));
vi.mock('@tauri-apps/plugin-log', () => ({
  info: vi.fn(async () => {}), warn: vi.fn(async () => {}), error: vi.fn(async () => {}),
  debug: vi.fn(async () => {}), attachConsole: vi.fn(async () => () => {}),
}));

import { useOnyxState } from './onyx';
import { playBook } from '../api/playbook';
import { ALL_LIBRARIES_ID } from '../lib/allLibraries';
import type { Library, LibraryItem } from '../api/abs';

const SERVER = 'http://abs.local';

const library = (id: string, name: string, source?: string): Library => ({
  id, name, mediaType: 'book', source, icon: null, provider: null, displayOrder: null,
  folders: [], settings: null, lastScan: null, createdAt: null, lastUpdate: null,
});

const book = (id: string, title: string, localPath?: string): LibraryItem => ({
  id, media: { metadata: { title } }, ...(localPath ? { localPath } : {}),
} as LibraryItem);

// Seed a two-source world: one ABS library and one local library, with the
// combined shelf persisted as the last selection so the mount effect loads it.
function stubTwoSourceWorld() {
  localStorage.setItem('skald.serverUrl', SERVER);
  localStorage.setItem('skald.hasAuth', 'true');
  localStorage.setItem('skald.activeLibraryId', ALL_LIBRARIES_ID);

  tauri.handlers.set('fetch_libraries', () => [library('abs-lib', 'Server Shelf')]);
  tauri.handlers.set('get_local_libraries', () => [library('local-lib', 'On this PC', 'local')]);
  tauri.handlers.set('fetch_library_items', () => [book('abs-book', 'Server Book')]);
  tauri.handlers.set('scan_local_library', () => 0);
  tauri.handlers.set('get_local_library_items', () => [book('local-book', 'Local Book', 'C:/Books/Local Book')]);
  tauri.handlers.set('get_local_library_progress', () => []);
  tauri.handlers.set('get_downloads', () => []);
  tauri.handlers.set('take_corrupt_persistence_notices', () => []);
  tauri.handlers.set('flush_offline_progress', () => 0);
  tauri.handlers.set('load_library_cache', () => []);
}

beforeEach(() => {
  localStorage.clear();
  tauri.calls.length = 0;
  tauri.handlers.clear();
  stubTwoSourceWorld();
});

describe('journey: combined shelf → local item → playback → source library', () => {
  it('merges sources, routes playback locally, and restores source scoping', async () => {
    const { result } = renderHook(() => useOnyxState());

    // ── 1. The combined shelf loads items from both sources ──────────────────
    await waitFor(() => {
      expect(result.current.libraryLoading).toBe(false);
      expect(result.current.library.map(b => b.id).sort()).toEqual(['abs-book', 'local-book']);
    });
    expect(result.current.activeLibrary?.source).toBe('all');
    expect(result.current.allLibrariesPartial).toBeNull();

    // ── 2. Playing the local item routes through LibVLC's local path ─────────
    tauri.handlers.set('close_active_session', () => undefined);
    tauri.handlers.set('get_local_progress', () => ({
      id: 'lp-1', libraryItemId: 'local-book', currentTime: 42, duration: 3600,
      progress: 42 / 3600, isFinished: false,
    }));
    tauri.handlers.set('play_local_file', () => undefined);

    await act(async () => { await playBook(result.current, 'local-book'); });

    const play = tauri.calls.find(c => c.cmd === 'play_local_file');
    expect(play?.args).toMatchObject({
      filePath: 'C:/Books/Local Book',
      itemId: 'local-book',
      startTime: 42,        // catalog resume position, not 0
      localLibrary: true,   // progress goes to the catalog, not the offline queue
    });
    expect(tauri.calls.some(c => c.cmd === 'open_playback_session')).toBe(false);
    expect(result.current.isLocalPlayback).toBe(true);
    expect(result.current.currentBookId).toBe('local-book');
    expect(result.current.playingItem?.id).toBe('local-book');

    // ── 3. Returning to the source library re-scopes the shelf ───────────────
    await act(async () => { await result.current.setActiveLibrary('local-lib'); });

    expect(result.current.activeLibrary?.id).toBe('local-lib');
    expect(result.current.library.map(b => b.id)).toEqual(['local-book']);
    // The now-playing snapshot survives the switch (cross-library MiniPlayer).
    expect(result.current.playingItem?.id).toBe('local-book');
    expect(result.current.currentBookId).toBe('local-book');
  });
});

describe('journey: partial combined load is visible and recoverable (H1)', () => {
  it('records the failed source, then clears the notice after a successful retry', async () => {
    // The ABS source is down for the initial combined load.
    tauri.handlers.set('fetch_library_items', () => { throw new Error('server unreachable'); });

    const { result } = renderHook(() => useOnyxState());
    await waitFor(() => {
      expect(result.current.libraryLoading).toBe(false);
      expect(result.current.library.map(b => b.id)).toEqual(['local-book']);
    });

    // Partial coverage is recorded — the shelf is NOT presented as complete.
    expect(result.current.allLibrariesPartial).toEqual({
      failedNames: ['Server Shelf'], loaded: 1, total: 2,
    });

    // Retry (the notice button re-runs the combined load) after the server recovers.
    tauri.handlers.set('fetch_library_items', () => [book('abs-book', 'Server Book')]);
    await act(async () => { await result.current.setActiveLibrary(ALL_LIBRARIES_ID); });

    expect(result.current.allLibrariesPartial).toBeNull();
    expect(result.current.library.map(b => b.id).sort()).toEqual(['abs-book', 'local-book']);
  });

  it('dismissal hides the notice without discarding the loaded items', async () => {
    tauri.handlers.set('fetch_library_items', () => { throw new Error('server unreachable'); });

    const { result } = renderHook(() => useOnyxState());
    await waitFor(() => expect(result.current.allLibrariesPartial).not.toBeNull());

    act(() => result.current.dismissAllLibrariesPartial());
    expect(result.current.allLibrariesPartial).toBeNull();
    expect(result.current.library.map(b => b.id)).toEqual(['local-book']);
  });
});

describe('playback-state regression guards', () => {
  it('does not run the global arrow seek for a key already owned by a component', async () => {
    const { result } = renderHook(() => useOnyxState());
    await waitFor(() => expect(result.current.libraryLoading).toBe(false));

    act(() => { result.current.setCurrentBookId('abs-book'); });
    const before = tauri.calls.filter(call => call.cmd === 'seek_audio').length;

    const handled = new KeyboardEvent('keydown', {
      key: 'ArrowRight', code: 'ArrowRight', bubbles: true, cancelable: true,
    });
    handled.preventDefault();
    act(() => { window.dispatchEvent(handled); });
    expect(tauri.calls.filter(call => call.cmd === 'seek_audio')).toHaveLength(before);

    // Prove the shortcut itself is active: only the prevented event is ignored.
    const unhandled = new KeyboardEvent('keydown', {
      key: 'ArrowRight', code: 'ArrowRight', bubbles: true, cancelable: true,
    });
    act(() => { window.dispatchEvent(unhandled); });
    expect(tauri.calls.filter(call => call.cmd === 'seek_audio').length).toBeGreaterThan(before);
  });

  it('surfaces offline-progress corruption discovered after the registry poll', async () => {
    let resolveFlush: ((value: number) => void) | undefined;
    const pendingFlush = new Promise<number>(resolve => { resolveFlush = resolve; });
    tauri.handlers.set('flush_offline_progress', () => pendingFlush);

    let noticePolls = 0;
    tauri.handlers.set('take_corrupt_persistence_notices', () => {
      noticePolls += 1;
      return noticePolls === 1 ? [] : ['offline progress queue'];
    });

    const { result } = renderHook(() => useOnyxState());
    await waitFor(() => expect(noticePolls).toBe(1));
    await waitFor(() => expect(tauri.calls.some(call => call.cmd === 'flush_offline_progress')).toBe(true));
    expect(result.current.toast).toBeNull();

    await act(async () => {
      resolveFlush?.(0);
      await pendingFlush;
    });
    await waitFor(() => {
      expect(result.current.toast?.message).toContain('Damaged offline progress queue reset');
    });
  });
});
