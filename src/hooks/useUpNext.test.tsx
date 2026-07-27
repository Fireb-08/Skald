// The advance decision (Auto-Play Next roadmap, Phase 4). The resolution and the
// countdown are tested on their own; what this covers is the wiring between
// them — which is where "continues when it shouldn't" and "opens two sessions"
// actually live. Playback is mocked: the assertion is that advance routes
// through playBook/playEpisode at all, since bypassing them is what would
// orphan a session on the server.
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryItem } from '../api/abs';
import type { OnyxState } from '../state/onyx';
import { useUpNext } from './useUpNext';

const tauri = vi.hoisted(() => {
  const listeners = new Map<string, Set<(e: { event: string; payload: unknown }) => void>>();
  return {
    listeners,
    listen: (event: string, cb: (e: { event: string; payload: unknown }) => void) => {
      let set = listeners.get(event);
      if (!set) { set = new Set(); listeners.set(event, set); }
      set.add(cb);
      return Promise.resolve(() => { set!.delete(cb); });
    },
    emit: async (event: string, payload: unknown) => {
      const handlers = [...(listeners.get(event) ?? [])];
      for (const cb of handlers) await cb({ event, payload });
    },
    reset: () => listeners.clear(),
  };
});
vi.mock('@tauri-apps/api/event', () => ({ listen: tauri.listen }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => undefined }));

const playback = vi.hoisted(() => ({
  playBook: vi.fn(async (_st: unknown, _bookId: string) => {}),
  playEpisode: vi.fn(async (_st: unknown, _itemId: string, _episode: unknown) => {}),
}));
vi.mock('../api/playbook', () => playback);

function book(id: string, sequence: string): LibraryItem {
  return {
    id,
    ino: id,
    libraryId: 'lib1',
    mediaType: 'book',
    media: {
      metadata: {
        title: `Book ${sequence}`,
        seriesName: 'Mistborn',
        series: [{ id: 'ser1', name: 'Mistborn', sequence }],
        genres: [],
      },
    },
  } as unknown as LibraryItem;
}

const shelf = [book('b1', '1'), book('b2', '2')];
const setToast = vi.fn();

function state(): OnyxState {
  return {
    library: shelf,
    downloads: [],
    mediaProgress: [],
    playingItem: undefined,
    serverUrl: 'https://abs.example',
    isOffline: false,
    setToast,
  } as unknown as OnyxState;
}

/** Mount the hook and wait for its listener to be registered. */
async function mount() {
  const view = renderHook(() => useUpNext(state()));
  await waitFor(() => expect(tauri.listeners.get('playback-ended')?.size).toBeGreaterThan(0));
  return view;
}

beforeEach(() => {
  tauri.reset();
  localStorage.clear();
  playback.playBook.mockClear();
  playback.playEpisode.mockClear();
  setToast.mockClear();
});

describe('when an item ends', () => {
  it('does nothing at all when continuation is off', async () => {
    localStorage.setItem('onyx.playback.upNext.books', JSON.stringify('off'));
    const { result } = await mount();

    await act(async () => { await tauri.emit('playback-ended', { itemId: 'b1', episodeId: null }); });

    expect(result.current.prompt).toBeNull();
    expect(playback.playBook).not.toHaveBeenCalled();
  });

  it('plays immediately, and says so, when set to auto', async () => {
    localStorage.setItem('onyx.playback.upNext.books', JSON.stringify('auto'));
    await mount();

    await act(async () => { await tauri.emit('playback-ended', { itemId: 'b1', episodeId: null }); });

    expect(playback.playBook).toHaveBeenCalledTimes(1);
    expect(playback.playBook.mock.calls[0][1]).toBe('b2');
    // Audio changing with no explanation reads as a malfunction.
    expect(setToast).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Book 2') }));
  });

  it('asks first when set to prompt, and plays only once accepted', async () => {
    const { result } = await mount();

    await act(async () => { await tauri.emit('playback-ended', { itemId: 'b1', episodeId: null }); });

    expect(result.current.prompt?.target).toMatchObject({ kind: 'book', item: { id: 'b2' } });
    expect(playback.playBook).not.toHaveBeenCalled();

    act(() => result.current.accept());
    expect(playback.playBook).toHaveBeenCalledTimes(1);
    expect(result.current.prompt).toBeNull();
  });

  it('plays nothing when the prompt is declined', async () => {
    const { result } = await mount();
    await act(async () => { await tauri.emit('playback-ended', { itemId: 'b1', episodeId: null }); });

    act(() => result.current.decline());

    expect(result.current.prompt).toBeNull();
    expect(playback.playBook).not.toHaveBeenCalled();
  });

  it('accepts once even if the panel fires twice', async () => {
    // A double-click on "Play now" must not open two sessions for one book.
    const { result } = await mount();
    await act(async () => { await tauri.emit('playback-ended', { itemId: 'b1', episodeId: null }); });

    act(() => { result.current.accept(); result.current.accept(); });

    expect(playback.playBook).toHaveBeenCalledTimes(1);
  });

  it('tells the listener when a series is over instead of prompting', async () => {
    const { result } = await mount();

    await act(async () => { await tauri.emit('playback-ended', { itemId: 'b2', episodeId: null }); });

    expect(result.current.prompt).toBeNull();
    expect(setToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }));
  });

  it('detaches its listener on unmount', async () => {
    // A leaked listener would advance twice after a remount.
    const { unmount } = await mount();
    unmount();
    expect(tauri.listeners.get('playback-ended')?.size ?? 0).toBe(0);
  });
});
