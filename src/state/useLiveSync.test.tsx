import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const invokeMock = vi.hoisted(() => vi.fn<(command: string) => Promise<unknown>>(async (command: string) => {
  if (command === 'get_offline_progress_count') return 0;
  return undefined;
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: tauri.listen }));
vi.mock('@tauri-apps/plugin-log', () => ({
  info: vi.fn(async () => {}), warn: vi.fn(async () => {}), error: vi.fn(async () => {}),
  debug: vi.fn(async () => {}), attachConsole: vi.fn(async () => () => {}),
}));

import { useLiveSync, type LiveSyncDeps } from './useLiveSync';
import { resetEntityListeners, useEntityChanges } from './liveEntities';
import type { ContextFilter } from './onyx';
import type { Library } from '../api/abs';

/** A loaded ABS library, which is also the access baseline `user_updated` is judged against. */
function absLibrary(id: string): Library {
  return {
    id, name: id, mediaType: 'book', icon: null, provider: null, displayOrder: null,
    folders: [], settings: null, lastScan: null, createdAt: null, lastUpdate: null,
  };
}

function deps(): Omit<LiveSyncDeps, 'liveSyncEnabled'> {
  return {
    serverUrl: 'http://abs.local',
    authToken: '__keyring__',
    currentBookIdRef: { current: '' },
    currentEpisodeIdRef: { current: null },
    playingRef: { current: false },
    sessionIdRef: { current: '' },
    sessionReadyRef: { current: false },
    currentLibraryIdRef: { current: 'library' },
    librariesRef: { current: [] },
    isOfflineRef: { current: false },
    setMediaProgress: vi.fn(),
    setPosition: vi.fn(),
    setSyncConflict: vi.fn(),
    setSyncHealth: vi.fn(),
    setLibraryRaw: vi.fn(),
    setCurrentBookId: vi.fn(),
    setFocusedBookId: vi.fn(),
    setDownloads: vi.fn(),
    setTasks: vi.fn(),
    setToast: vi.fn(),
    recordActivity: vi.fn(),
    surfaceCorruptPersistenceNotices: vi.fn(async () => {}),
    setUploadPerm: vi.fn(),
    contextFilterRef: { current: null } as { current: ContextFilter | null },
    setContextFilter: vi.fn(),
    refreshLibrary: vi.fn(async () => true),
    applyServerProgress: vi.fn(),
    applyUserRecord: vi.fn(),
  };
}

beforeEach(() => {
  tauri.reset();
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string) => {
    if (command === 'get_offline_progress_count') return 0;
    return undefined;
  });
});

describe('useLiveSync runtime preference lifecycle', () => {
  it('never moves a loaded transport during background offline reconciliation', async () => {
    const stableDeps = deps();
    stableDeps.currentBookIdRef.current = 'book';
    renderHook(() => useLiveSync({ ...stableDeps, liveSyncEnabled: false }));
    await act(async () => {});

    act(() => {
      tauri.emit('offline-sync-conflict', {
        itemId: 'book',
        episodeId: null,
        localCurrentTime: 30,
        serverCurrentTime: 420,
      });
    });

    expect(stableDeps.setPosition).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalledWith('seek_audio', expect.anything());
  });

  it('uses session identity to ignore own transport echoes and surface other devices', async () => {
    const stableDeps = deps();
    stableDeps.currentBookIdRef.current = 'book';
    stableDeps.sessionIdRef.current = 'skald-session';
    stableDeps.sessionReadyRef.current = true;
    stableDeps.playingRef.current = true;
    renderHook(() => useLiveSync({ ...stableDeps, liveSyncEnabled: true }));
    await act(async () => {});

    act(() => {
      tauri.emit('progress-updated', JSON.stringify({
        sessionId: 'skald-session',
        deviceDescription: 'Skald',
        data: { libraryItemId: 'book', currentTime: 45, duration: 100, progress: 0.45 },
      }));
    });
    expect(stableDeps.setMediaProgress).toHaveBeenCalledTimes(1);
    expect(stableDeps.setPosition).not.toHaveBeenCalled();
    expect(stableDeps.setSyncConflict).not.toHaveBeenCalled();

    act(() => {
      tauri.emit('progress-updated', JSON.stringify({
        sessionId: 'phone-session',
        deviceDescription: 'Phone',
        data: { libraryItemId: 'book', currentTime: 90, duration: 100, progress: 0.9 },
      }));
    });
    expect(stableDeps.setMediaProgress).toHaveBeenCalledTimes(2);
    expect(stableDeps.setPosition).not.toHaveBeenCalled();
    expect(stableDeps.setSyncConflict).toHaveBeenLastCalledWith(expect.objectContaining({
      libraryItemId: 'book',
      currentTime: 90,
      deviceDescription: 'Phone',
      sessionId: 'phone-session',
    }));
  });

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

  it('appends a newly added item once even if item_added is delivered twice', async () => {
    const stableDeps = deps();
    renderHook(() => useLiveSync({ ...stableDeps, liveSyncEnabled: true }));
    await act(async () => {});

    // ABS can emit item_added more than once for a single new upload (folder
    // watcher scan + a subsequent scan pass, or a socket redelivery). The shelf
    // must stay idempotent by id — a relaunch used to be the only thing that
    // cleared the duplicate.
    const added = JSON.stringify({ id: 'newbook', libraryId: 'library', media: { metadata: {} } });
    await act(async () => {
      tauri.emit('library-item-added', added);
      tauri.emit('library-item-added', added);
    });

    // The handler passes functional updaters; replay them over an empty shelf.
    let shelf: { id: string }[] = [];
    for (const call of (stableDeps.setLibraryRaw as ReturnType<typeof vi.fn>).mock.calls) {
      shelf = call[0](shelf);
    }
    expect(shelf.filter(b => b.id === 'newbook')).toHaveLength(1);
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

  it('does not poll ABS or alter playback when the window regains focus', async () => {
    const stableDeps = deps();
    stableDeps.currentBookIdRef.current = 'book';
    stableDeps.sessionIdRef.current = 'skald-session';
    stableDeps.sessionReadyRef.current = true;

    renderHook(() => useLiveSync({ ...stableDeps, liveSyncEnabled: false }));
    await act(async () => {});
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });

    expect(invokeMock).not.toHaveBeenCalledWith('get_me');
    expect(stableDeps.applyServerProgress).not.toHaveBeenCalled();
    expect(stableDeps.setSyncConflict).not.toHaveBeenCalled();
    expect(stableDeps.setPosition).not.toHaveBeenCalled();
  });
});

// Payload shapes below are the ones verified against the ABS server source at
// v2.36.0 — the point of pinning them here is that a server release which
// reshapes one fails a test rather than quietly leaving a pane stale.
describe('useLiveSync socket event coverage', () => {
  afterEach(() => resetEntityListeners());

  /** Replay the functional updaters a mock setter collected, over a starting value. */
  function replay<T>(setter: unknown, initial: T): T {
    let value = initial;
    for (const call of (setter as ReturnType<typeof vi.fn>).mock.calls) {
      value = (call[0] as (prev: T) => T)(value);
    }
    return value;
  }

  it('routes a batch item event through the single-item handler, per element', async () => {
    const stableDeps = deps();
    renderHook(() => useLiveSync({ ...stableDeps, liveSyncEnabled: true }));
    await act(async () => {});

    // `items_updated` is an ARRAY of exactly the `item_updated` shape, so the
    // batch must land as N single-item applications and nothing else — this is
    // what keeps an author rename (which arrives as one batch) from needing a
    // parallel code path that could drift from the single-item one.
    await act(async () => {
      tauri.emit('library-items-updated', JSON.stringify([
        { id: 'a', libraryId: 'library', media: { metadata: { title: 'Renamed A' } } },
        { id: 'b', libraryId: 'library', media: { metadata: { title: 'Renamed B' } } },
      ]));
    });

    const shelf = replay<Array<{ id: string; libraryId: string; media: { metadata: { title: string } } }>>(
      stableDeps.setLibraryRaw,
      [
        { id: 'a', libraryId: 'library', media: { metadata: { title: 'Old A' } } },
        { id: 'b', libraryId: 'library', media: { metadata: { title: 'Old B' } } },
      ],
    );
    expect(shelf.map(b => b.media.metadata.title)).toEqual(['Renamed A', 'Renamed B']);
  });

  it('ignores batch items belonging to a library the shelf is not showing', async () => {
    const stableDeps = deps();
    renderHook(() => useLiveSync({ ...stableDeps, liveSyncEnabled: true }));
    await act(async () => {});

    // Batch events are access-filtered by ABS but not library-filtered, so a scan
    // of another library reaches us too. Applying those would append books the
    // shelf must not show.
    await act(async () => {
      tauri.emit('library-items-added', JSON.stringify([
        { id: 'other', libraryId: 'some-other-library', media: { metadata: {} } },
      ]));
    });

    expect(replay(stableDeps.setLibraryRaw, [] as Array<{ id: string }>)).toEqual([]);
  });

  it('publishes collection, playlist, series and author changes to the entity feed', async () => {
    const stableDeps = deps();
    const onCollection = vi.fn();
    const onSeries = vi.fn();
    renderHook(() => {
      useLiveSync({ ...stableDeps, liveSyncEnabled: true });
      useEntityChanges('collection', onCollection);
      useEntityChanges('series', onSeries);
    });
    await act(async () => {});

    // All twelve kind/op pairs are registered, so a view for any of the four can
    // subscribe without touching the transport again.
    for (const event of ['collection', 'playlist', 'series', 'author']) {
      for (const op of ['added', 'updated', 'removed']) {
        expect(tauri.count(`${event}-${op}`)).toBe(1);
      }
    }

    await act(async () => {
      // A full collection: patchable in place.
      tauri.emit('collection-updated', JSON.stringify({
        id: 'col_1', libraryId: 'library', name: 'Winter Reading', books: [{ id: 'a' }],
      }));
      // A thin series removal: nothing to patch from, so `object` must be null
      // and the subscriber re-fetches instead.
      tauri.emit('series-removed', JSON.stringify({ id: 'ser_1', libraryId: 'library' }));
    });

    expect(onCollection).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'collection', op: 'updated', id: 'col_1',
      object: expect.objectContaining({ name: 'Winter Reading' }),
    }));
    expect(onSeries).toHaveBeenCalledWith({
      kind: 'series', op: 'removed', id: 'ser_1', object: null,
    });
  });

  it('drops an entity event it cannot key rather than publishing a guess', async () => {
    const stableDeps = deps();
    const onCollection = vi.fn();
    renderHook(() => {
      useLiveSync({ ...stableDeps, liveSyncEnabled: true });
      useEntityChanges('collection', onCollection);
    });
    await act(async () => {});

    await act(async () => {
      tauri.emit('collection-updated', 'not json');
      tauri.emit('collection-updated', JSON.stringify({ name: 'no id here' }));
    });

    expect(onCollection).not.toHaveBeenCalled();
  });

  it('merges task_progress into the running task it belongs to', async () => {
    const stableDeps = deps();
    renderHook(() => useLiveSync({ ...stableDeps, liveSyncEnabled: true }));
    await act(async () => {});

    // task_progress carries `{ libraryItemId, progress }` and no task id, so the
    // join is on `data.libraryItemId` — and it must reach only the task that is
    // actually encoding that item.
    await act(async () => {
      tauri.emit('task-progress', JSON.stringify({ libraryItemId: 'li_1', progress: 42.4 }));
    });

    const tasks = replay(stableDeps.setTasks, [
      { id: 'task_1', isFinished: false, data: { libraryItemId: 'li_1' } },
      { id: 'task_2', isFinished: false, data: { libraryItemId: 'li_2' } },
      { id: 'task_3', isFinished: true, data: { libraryItemId: 'li_1' } },
    ] as Array<{ id: string; isFinished: boolean; progress?: number; data: { libraryItemId: string } }>);

    expect(tasks.find(t => t.id === 'task_1')?.progress).toBeCloseTo(42.4);
    expect(tasks.find(t => t.id === 'task_2')?.progress).toBeUndefined();
    // A finished task is history; a late progress event must not reopen it.
    expect(tasks.find(t => t.id === 'task_3')?.progress).toBeUndefined();
  });

  it('never hands the progress bar a width outside 0–100', async () => {
    const stableDeps = deps();
    renderHook(() => useLiveSync({ ...stableDeps, liveSyncEnabled: true }));
    await act(async () => {});

    // The encode/embed emitters scale raw ffmpeg progress by a fraction of the
    // whole job, so a rounding overshoot is possible.
    await act(async () => {
      tauri.emit('task-progress', JSON.stringify({ libraryItemId: 'li_1', progress: 103 }));
    });

    const tasks = replay(stableDeps.setTasks, [
      { id: 'task_1', isFinished: false, data: { libraryItemId: 'li_1' } },
    ] as Array<{ id: string; isFinished: boolean; progress?: number; data: { libraryItemId: string } }>);
    expect(tasks[0].progress).toBe(100);
  });

  it('ignores a progress payload with nothing usable in it', async () => {
    const stableDeps = deps();
    renderHook(() => useLiveSync({ ...stableDeps, liveSyncEnabled: true }));
    await act(async () => {});

    await act(async () => {
      tauri.emit('task-progress', 'not json');
      tauri.emit('task-progress', JSON.stringify({ progress: 50 }));
      tauri.emit('task-progress', JSON.stringify({ libraryItemId: 'li_1' }));
      tauri.emit('task-progress', JSON.stringify({ libraryItemId: 'li_1', progress: null }));
    });

    expect(stableDeps.setTasks).not.toHaveBeenCalled();
  });

  it('applies a pushed account record without a /api/me round-trip', async () => {
    const stableDeps = deps();
    renderHook(() => useLiveSync({ ...stableDeps, liveSyncEnabled: true }));
    await act(async () => {});

    await act(async () => {
      tauri.emit('user-updated', JSON.stringify({
        id: 'usr_1',
        username: 'po',
        type: 'admin',
        token: 'pre-2.26-token',
        permissions: { upload: true, download: true },
        librariesAccessible: ['library'],
        mediaProgress: [{ id: 'mp_1' }],
      }));
    });

    expect(stableDeps.applyUserRecord).toHaveBeenCalledWith({
      id: 'usr_1',
      username: 'po',
      type: 'admin',
      permissions: { upload: true, download: true },
      librariesAccessible: ['library'],
    });
    // The payload's `token` is the pre-2.26 non-expiring credential and its
    // progress/bookmark arrays have their own event — neither may ride along.
    const record = (stableDeps.applyUserRecord as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(record).not.toHaveProperty('token');
    expect(record).not.toHaveProperty('mediaProgress');
    expect(invokeMock).not.toHaveBeenCalledWith('get_me');
  });

  // ABS emits `user_updated` on every media-progress write and every bookmark
  // change, not only on account changes, so these two properties have to hold at
  // once: a genuine access change must refresh on the *first* payload that reports
  // it, and the routine payloads must not refresh at all.
  describe('library access', () => {
    const push = (librariesAccessible?: string[]) => act(async () => {
      tauri.emit('user-updated', JSON.stringify({
        id: 'usr_1', type: 'user',
        ...(librariesAccessible ? { librariesAccessible } : {}),
      }));
    });

    it('refreshes on the first payload that reports a grant', async () => {
      // The baseline is the loaded library list, not an earlier event: GET
      // /api/libraries returns only accessible libraries, so the ids on hand are
      // the accessible set. An idle session receives no earlier `user_updated`,
      // and treating this one as a baseline would swallow the change entirely.
      const stableDeps = deps();
      stableDeps.librariesRef.current = [absLibrary('lib_a'), absLibrary('lib_b')];
      renderHook(() => useLiveSync({ ...stableDeps, liveSyncEnabled: true }));
      await act(async () => {});

      await push(['lib_a', 'lib_b', 'lib_c']);

      expect(stableDeps.refreshLibrary).toHaveBeenCalledTimes(1);
    });

    it('refreshes on the first payload that reports a revocation', async () => {
      const stableDeps = deps();
      stableDeps.librariesRef.current = [absLibrary('lib_a'), absLibrary('lib_b')];
      renderHook(() => useLiveSync({ ...stableDeps, liveSyncEnabled: true }));
      await act(async () => {});

      await push(['lib_a']);

      expect(stableDeps.refreshLibrary).toHaveBeenCalledTimes(1);
    });

    it('does not refresh for the routine payloads a progress sync emits', async () => {
      // This is the storm guard. During playback ABS pushes `user_updated` every
      // time progress is written; each carries the unchanged access set, and
      // refetching the library on each would reload the shelf every 30 seconds.
      const stableDeps = deps();
      stableDeps.librariesRef.current = [absLibrary('lib_a'), absLibrary('lib_b')];
      renderHook(() => useLiveSync({ ...stableDeps, liveSyncEnabled: true }));
      await act(async () => {});

      await push(['lib_a', 'lib_b']);
      await push(['lib_b', 'lib_a']); // same set, different order
      await push();                   // no librariesAccessible field at all

      expect(stableDeps.refreshLibrary).not.toHaveBeenCalled();
    });

    it('refreshes once, not once per payload, while the refresh is in flight', async () => {
      const stableDeps = deps();
      stableDeps.librariesRef.current = [absLibrary('lib_a')];
      // Never settles: the point is what happens while the request is outstanding.
      stableDeps.refreshLibrary = vi.fn(() => new Promise<boolean>(() => {}));
      renderHook(() => useLiveSync({ ...stableDeps, liveSyncEnabled: true }));
      await act(async () => {});

      // The loaded list does not update until the refresh lands, so without a
      // guard every payload in between would queue another one.
      await push(['lib_a', 'lib_b']);
      await push(['lib_a', 'lib_b']);
      await push(['lib_a', 'lib_b']);

      expect(stableDeps.refreshLibrary).toHaveBeenCalledTimes(1);
    });

    it('retries the same access set after a refresh that could not reach the server', async () => {
      // The failure is reachable: refreshLibrary degrades an unreachable ABS list
      // to an empty one so local libraries still load. If the set were marked
      // handled up front, every later payload would carry it and be dismissed as
      // already done — suppressing the retry for the whole session and leaving the
      // switcher stale until a reconnect or relaunch.
      const stableDeps = deps();
      stableDeps.librariesRef.current = [absLibrary('lib_a')];
      let settle: ((reachable: boolean) => void) | undefined;
      stableDeps.refreshLibrary = vi.fn(() => new Promise<boolean>(resolve => { settle = resolve; }));
      renderHook(() => useLiveSync({ ...stableDeps, liveSyncEnabled: true }));
      await act(async () => {});

      await push(['lib_a', 'lib_b']);
      expect(stableDeps.refreshLibrary).toHaveBeenCalledTimes(1);

      // The server could not be reached, so nothing was reconciled.
      await act(async () => { settle?.(false); });

      await push(['lib_a', 'lib_b']);
      expect(stableDeps.refreshLibrary).toHaveBeenCalledTimes(2);
    });

    it('stops retrying once a refresh has actually reconciled the set', async () => {
      const stableDeps = deps();
      stableDeps.librariesRef.current = [absLibrary('lib_a')];
      let settle: ((reachable: boolean) => void) | undefined;
      stableDeps.refreshLibrary = vi.fn(() => new Promise<boolean>(resolve => { settle = resolve; }));
      renderHook(() => useLiveSync({ ...stableDeps, liveSyncEnabled: true }));
      await act(async () => {});

      await push(['lib_a', 'lib_b']);
      await act(async () => { settle?.(true); });
      // What a real refresh does: the loaded list now holds the granted library.
      stableDeps.librariesRef.current = [absLibrary('lib_a'), absLibrary('lib_b')];

      // Routine progress-driven payloads from here on carry the reconciled set.
      await push(['lib_a', 'lib_b']);
      await push(['lib_a', 'lib_b']);

      expect(stableDeps.refreshLibrary).toHaveBeenCalledTimes(1);
    });

    /** A refreshLibrary mock whose calls are settled by hand, in the order chosen. */
    function controllableRefresh() {
      const settlers: Array<(reachable: boolean) => void> = [];
      const fn = vi.fn(() => new Promise<boolean>(resolve => { settlers.push(resolve); }));
      return { fn, settlers };
    }

    it('runs overlapping access changes one at a time, newest last', async () => {
      // An admin editing access twice inside one round-trip. The second set is a
      // real change and must not be swallowed — but it must not run *concurrently*
      // either: both calls write the library list and its items, so whichever
      // happened to finish last would become authoritative, which need not be the
      // newer set.
      const stableDeps = deps();
      stableDeps.librariesRef.current = [absLibrary('lib_a')];
      const refresh = controllableRefresh();
      stableDeps.refreshLibrary = refresh.fn;
      renderHook(() => useLiveSync({ ...stableDeps, liveSyncEnabled: true }));
      await act(async () => {});

      await push(['lib_a', 'lib_b']);
      await push(['lib_a', 'lib_b', 'lib_c']);
      // The second set is queued, not started alongside the first.
      expect(refresh.fn).toHaveBeenCalledTimes(1);

      await act(async () => { refresh.settlers[0]?.(true); });
      // Now its turn comes, so the newer set is fetched last and wins.
      expect(refresh.fn).toHaveBeenCalledTimes(2);

      await act(async () => { refresh.settlers[1]?.(true); });
      // And once it has landed, routine payloads carrying it are quiet again.
      await push(['lib_a', 'lib_b', 'lib_c']);
      expect(refresh.fn).toHaveBeenCalledTimes(2);
    });

    it('does not start a second request for a set already being fetched', async () => {
      // The B → C → B interleaving: a routine payload redelivers the set that is
      // still in flight while a newer one waits behind it. Tracking only the set
      // currently being fetched would let that B through as unaccounted-for.
      const stableDeps = deps();
      stableDeps.librariesRef.current = [absLibrary('lib_a')];
      const refresh = controllableRefresh();
      stableDeps.refreshLibrary = refresh.fn;
      renderHook(() => useLiveSync({ ...stableDeps, liveSyncEnabled: true }));
      await act(async () => {});

      await push(['lib_a', 'lib_b']);            // B — starts
      await push(['lib_a', 'lib_b', 'lib_c']);   // C — queued
      await push(['lib_a', 'lib_b']);            // B again — in flight already

      expect(refresh.fn).toHaveBeenCalledTimes(1);

      // Draining the queue runs C, and only C.
      await act(async () => { refresh.settlers[0]?.(true); });
      expect(refresh.fn).toHaveBeenCalledTimes(2);
      await act(async () => { refresh.settlers[1]?.(true); });
      expect(refresh.fn).toHaveBeenCalledTimes(2);
    });

    it('keeps only the newest set when several queue up behind one refresh', async () => {
      // Every intermediate set is superseded by the time the queue drains, so the
      // queue holds one slot rather than a backlog of stale refreshes to replay.
      const stableDeps = deps();
      stableDeps.librariesRef.current = [absLibrary('lib_a')];
      const refresh = controllableRefresh();
      stableDeps.refreshLibrary = refresh.fn;
      renderHook(() => useLiveSync({ ...stableDeps, liveSyncEnabled: true }));
      await act(async () => {});

      await push(['lib_a', 'lib_b']);
      await push(['lib_a', 'lib_b', 'lib_c']);
      await push(['lib_a', 'lib_b', 'lib_c', 'lib_d']);
      await push(['lib_a', 'lib_b', 'lib_c', 'lib_d', 'lib_e']);

      await act(async () => { refresh.settlers[0]?.(true); });
      await act(async () => { refresh.settlers[1]?.(true); });

      // Two refreshes in total: the one that was running, then the newest set.
      expect(refresh.fn).toHaveBeenCalledTimes(2);
      await push(['lib_a', 'lib_b', 'lib_c', 'lib_d', 'lib_e']);
      expect(refresh.fn).toHaveBeenCalledTimes(2);
    });

    it('treats an empty list as unrestricted rather than as a change', async () => {
      // `librariesAccessible: []` means "all libraries" in ABS. There is no id set
      // to compare it against, and refreshing on spec would reload the shelf on
      // the first progress tick of every admin's session.
      const stableDeps = deps();
      stableDeps.librariesRef.current = [absLibrary('lib_a'), absLibrary('lib_b')];
      renderHook(() => useLiveSync({ ...stableDeps, liveSyncEnabled: true }));
      await act(async () => {});

      await push([]);
      expect(stableDeps.refreshLibrary).not.toHaveBeenCalled();

      // A restricted set becoming unrestricted *is* detectable, and is a grant.
      await push(['lib_a']);
      expect(stableDeps.refreshLibrary).toHaveBeenCalledTimes(1);
      await push([]);
      expect(stableDeps.refreshLibrary).toHaveBeenCalledTimes(2);
    });

    it('waits for the initial library load rather than comparing against nothing', async () => {
      const stableDeps = deps();
      stableDeps.librariesRef.current = [];
      renderHook(() => useLiveSync({ ...stableDeps, liveSyncEnabled: true }));
      await act(async () => {});

      await push(['lib_a']);

      expect(stableDeps.refreshLibrary).not.toHaveBeenCalled();
    });

    it('ignores local libraries when comparing, since ABS never names them', async () => {
      const stableDeps = deps();
      stableDeps.librariesRef.current = [
        absLibrary('lib_a'),
        { ...absLibrary('local_1'), source: 'local' },
      ];
      renderHook(() => useLiveSync({ ...stableDeps, liveSyncEnabled: true }));
      await act(async () => {});

      await push(['lib_a']);

      expect(stableDeps.refreshLibrary).not.toHaveBeenCalled();
    });
  });

  // The state these exist for: opening a collection or playlist switches the
  // shelf to the library tab, which unmounts the view that fetched it — so the
  // filtered shelf a user is looking at has no view-level subscriber at all.
  // Nothing below mounts CollectionsView or PlaylistsView, which is exactly the
  // lifecycle the earlier feed-level tests could not reach.
  describe('active shelf filter', () => {
    it('applies a remote membership change to the open collection', async () => {
      const stableDeps = deps();
      stableDeps.contextFilterRef.current = {
        kind: 'collection', value: 'Winter Reading', collectionId: 'col_1', bookIds: ['a'],
      };
      renderHook(() => useLiveSync({ ...stableDeps, liveSyncEnabled: true }));
      await act(async () => {});

      await act(async () => {
        tauri.emit('collection-updated', JSON.stringify({
          id: 'col_1', libraryId: 'library', name: 'Deep Winter', books: [{ id: 'a' }, { id: 'b' }],
        }));
      });

      // The rename lands too — the shelf header shows `value`.
      expect(stableDeps.setContextFilter).toHaveBeenLastCalledWith({
        kind: 'collection', value: 'Deep Winter', collectionId: 'col_1', bookIds: ['a', 'b'],
      });
    });

    it('clears the filter, and says so, when the open collection is deleted', async () => {
      const stableDeps = deps();
      stableDeps.contextFilterRef.current = {
        kind: 'collection', value: 'Winter Reading', collectionId: 'col_1', bookIds: ['a'],
      };
      renderHook(() => useLiveSync({ ...stableDeps, liveSyncEnabled: true }));
      await act(async () => {});

      await act(async () => {
        tauri.emit('collection-removed', JSON.stringify({
          id: 'col_1', libraryId: 'library', name: 'Winter Reading', books: [{ id: 'a' }],
        }));
      });

      // Leaving the user on a filtered shelf whose source no longer exists is the
      // worse failure; the toast is why the view changed under them.
      expect(stableDeps.setContextFilter).toHaveBeenCalledWith(null);
      expect(stableDeps.setToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }));
    });

    it('applies a remote reorder to the open playlist, order included', async () => {
      const stableDeps = deps();
      stableDeps.contextFilterRef.current = {
        kind: 'playlist', value: 'Bedtime', playlistId: 'pl_1', bookIds: ['a', 'b'],
      };
      renderHook(() => useLiveSync({ ...stableDeps, liveSyncEnabled: true }));
      await act(async () => {});

      await act(async () => {
        tauri.emit('playlist-updated', JSON.stringify({
          id: 'pl_1', libraryId: 'library', name: 'Bedtime',
          items: [{ libraryItemId: 'b' }, { libraryItemId: 'a' }],
        }));
      });

      // bookIds is the play order for a playlist shelf, not just a membership set.
      expect(stableDeps.setContextFilter).toHaveBeenLastCalledWith({
        kind: 'playlist', value: 'Bedtime', playlistId: 'pl_1', bookIds: ['b', 'a'],
      });
    });

    it('leaves a filter alone when the change is for something else', async () => {
      const stableDeps = deps();
      stableDeps.contextFilterRef.current = {
        kind: 'collection', value: 'Winter Reading', collectionId: 'col_1', bookIds: ['a'],
      };
      renderHook(() => useLiveSync({ ...stableDeps, liveSyncEnabled: true }));
      await act(async () => {});

      await act(async () => {
        // A different collection, and a playlist while a collection is open.
        tauri.emit('collection-updated', JSON.stringify({
          id: 'col_2', libraryId: 'library', name: 'Other', books: [{ id: 'z' }],
        }));
        tauri.emit('playlist-updated', JSON.stringify({
          id: 'pl_1', libraryId: 'library', name: 'Bedtime', items: [{ libraryItemId: 'z' }],
        }));
        tauri.emit('collection-removed', JSON.stringify({ id: 'col_2', libraryId: 'library' }));
      });

      expect(stableDeps.setContextFilter).not.toHaveBeenCalled();
    });

    it('does nothing when no filter is open', async () => {
      const stableDeps = deps();
      renderHook(() => useLiveSync({ ...stableDeps, liveSyncEnabled: true }));
      await act(async () => {});

      await act(async () => {
        tauri.emit('collection-updated', JSON.stringify({
          id: 'col_1', libraryId: 'library', name: 'Winter Reading', books: [],
        }));
      });

      expect(stableDeps.setContextFilter).not.toHaveBeenCalled();
    });
  });

  it('ignores a user_updated payload with no id', async () => {
    const stableDeps = deps();
    renderHook(() => useLiveSync({ ...stableDeps, liveSyncEnabled: true }));
    await act(async () => {});

    await act(async () => {
      tauri.emit('user-updated', JSON.stringify({ username: 'po', type: 'admin' }));
      tauri.emit('user-updated', 'not json');
    });

    expect(stableDeps.applyUserRecord).not.toHaveBeenCalled();
  });
});
