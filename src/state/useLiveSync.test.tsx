import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => {
  const listeners = new Map<string, Set<(event: { event: string; payload: unknown }) => void>>();
  return {
    listen: (event: string, cb: (event: { event: string; payload: unknown }) => void) => {
      let set = listeners.get(event);
      if (!set) { set = new Set(); listeners.set(event, set); }
      set.add(cb);
      return Promise.resolve(() => { set!.delete(cb); });
    },
    emit: (event: string, payload?: unknown) => listeners.get(event)?.forEach(cb => cb({ event, payload })),
    count: (event: string) => listeners.get(event)?.size ?? 0,
    reset: () => listeners.clear(),
  };
});

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: tauri.listen }));
vi.mock('@tauri-apps/plugin-log', () => ({
  info: vi.fn(async () => {}), warn: vi.fn(async () => {}), error: vi.fn(async () => {}),
  debug: vi.fn(async () => {}), attachConsole: vi.fn(async () => () => {}),
}));

import { useLiveSync, type LiveSyncDeps } from './useLiveSync';

function deps(): Omit<LiveSyncDeps, 'liveSyncEnabled'> {
  return {
    serverUrl: 'http://abs.local',
    authToken: '__keyring__',
    currentBookIdRef: { current: '' },
    currentEpisodeIdRef: { current: null },
    playingRef: { current: false },
    currentLibraryIdRef: { current: 'library' },
    librariesRef: { current: [] },
    isOfflineRef: { current: false },
    setMediaProgress: vi.fn(),
    setPosition: vi.fn(),
    setLibraryRaw: vi.fn(),
    setCurrentBookId: vi.fn(),
    setFocusedBookId: vi.fn(),
    setDownloads: vi.fn(),
    setTasks: vi.fn(),
    setToast: vi.fn(),
    recordActivity: vi.fn(),
    surfaceCorruptPersistenceNotices: vi.fn(async () => {}),
    setUploadPerm: vi.fn(),
    refreshLibrary: vi.fn(async () => {}),
    applyServerProgress: vi.fn(),
  };
}

beforeEach(() => tauri.reset());

describe('useLiveSync runtime preference lifecycle', () => {
  it('installs socket listeners on enable and removes them on disable', async () => {
    const stableDeps = deps();
    const { rerender } = renderHook(
      ({ enabled }) => useLiveSync({ ...stableDeps, liveSyncEnabled: enabled }),
      { initialProps: { enabled: false } },
    );
    await act(async () => {});

    expect(tauri.count('progress-updated')).toBe(0);
    expect(tauri.count('library-item-added')).toBe(0);
    expect(tauri.count('socket-reconnected')).toBe(0);
    expect(tauri.count('task-started')).toBe(0);
    // Playback-task failure reporting is intentionally independent of Socket.IO.
    expect(tauri.count('sync-failed')).toBe(1);

    rerender({ enabled: true });
    await act(async () => {});

    expect(tauri.count('progress-updated')).toBe(1);
    expect(tauri.count('library-item-added')).toBe(1);
    expect(tauri.count('socket-reconnected')).toBe(1);
    expect(tauri.count('task-started')).toBe(1);

    await act(async () => {
      tauri.emit('progress-updated', JSON.stringify({
        libraryItemId: 'book', currentTime: 45, duration: 100, progress: 0.45,
      }));
    });
    expect(stableDeps.setMediaProgress).toHaveBeenCalledTimes(1);

    rerender({ enabled: false });
    await act(async () => {});

    expect(tauri.count('progress-updated')).toBe(0);
    expect(tauri.count('library-item-added')).toBe(0);
    expect(tauri.count('socket-reconnected')).toBe(0);
    expect(tauri.count('task-started')).toBe(0);
    tauri.emit('progress-updated', JSON.stringify({ libraryItemId: 'book', currentTime: 90 }));
    expect(stableDeps.setMediaProgress).toHaveBeenCalledTimes(1);
  });

  it('does not leak async listener registrations when disabled immediately', async () => {
    const stableDeps = deps();
    const { rerender } = renderHook(
      ({ enabled }) => useLiveSync({ ...stableDeps, liveSyncEnabled: enabled }),
      { initialProps: { enabled: true } },
    );

    // Disable before the listen() promises hand their unlisten callbacks back.
    rerender({ enabled: false });
    await act(async () => {});

    expect(tauri.count('progress-updated')).toBe(0);
    expect(tauri.count('library-item-added')).toBe(0);
    expect(tauri.count('socket-reconnected')).toBe(0);
    expect(tauri.count('task-started')).toBe(0);
  });

  it('reports recoverable session-write failures separately from fatal task death', async () => {
    const stableDeps = deps();
    renderHook(() => useLiveSync({ ...stableDeps, liveSyncEnabled: false }));
    await act(async () => {});

    // These are local Rust lifecycle events and remain visible when Socket.IO
    // live sync is disabled.
    expect(tauri.count('session-sync-warning')).toBe(1);
    expect(tauri.count('session-sync-restored')).toBe(1);
    expect(tauri.count('sync-failed')).toBe(1);

    act(() => {
      tauri.emit('session-sync-warning', { currentTime: 125, queued: true });
    });
    expect(stableDeps.setToast).toHaveBeenLastCalledWith({
      message: 'Progress sync is temporarily offline — your position was saved locally.',
      type: 'info',
    });
    expect(stableDeps.recordActivity).toHaveBeenLastCalledWith({
      category: 'sync', outcome: 'error', message: 'Progress sync interrupted — position saved locally',
    });
    expect(stableDeps.surfaceCorruptPersistenceNotices).toHaveBeenCalledTimes(1);

    act(() => { tauri.emit('session-sync-warning', { currentTime: 130, queued: false }); });
    expect(stableDeps.setToast).toHaveBeenLastCalledWith({
      message: 'Progress sync failed and your position could not be saved locally.',
      type: 'error',
    });
    expect(stableDeps.recordActivity).toHaveBeenLastCalledWith({
      category: 'sync', outcome: 'error', message: 'Progress sync interrupted — local fallback failed',
    });

    act(() => { tauri.emit('session-sync-restored', { currentTime: 140 }); });
    expect(stableDeps.setToast).toHaveBeenLastCalledWith({ message: 'Progress sync restored', type: 'success' });
    expect(stableDeps.recordActivity).toHaveBeenLastCalledWith({
      category: 'sync', outcome: 'success', message: 'Progress sync restored',
    });
  });
});
