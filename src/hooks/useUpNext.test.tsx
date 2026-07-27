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

// The series lookup runs over this, so a test can hold the answer back and act
// as the listener does: start something else while it is still in flight.
const core = vi.hoisted(() => {
  const handlers = new Map<string, (args?: Record<string, unknown>) => unknown>();
  return {
    handlers,
    invoke: async (cmd: string, args?: Record<string, unknown>) => handlers.get(cmd)?.(args),
    onCommand: (cmd: string, fn: (args?: Record<string, unknown>) => unknown) => { handlers.set(cmd, fn); },
    reset: () => handlers.clear(),
  };
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: core.invoke }));

const playback = vi.hoisted(() => ({
  playBook: vi.fn(async (_st: unknown, _bookId: string) => {}),
  playEpisode: vi.fn(async (_st: unknown, _podcast: unknown, _episode: unknown) => {}),
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

const DAY = 86_400_000;

/** A server podcast as the shelf holds it: numEpisodes, no episodes[]. */
function minifiedShow(id: string, numEpisodes: number): LibraryItem {
  return {
    id, ino: id, libraryId: 'lib1', mediaType: 'podcast',
    media: { metadata: { title: 'A Show' }, numEpisodes },
  } as unknown as LibraryItem;
}

/** The same show as PodcastDetail fetched it — the expanded item playback
 *  snapshots, and the only place the episode list exists. */
function expandedShow(id: string): LibraryItem {
  return {
    id, ino: id, libraryId: 'lib1', mediaType: 'podcast',
    media: {
      metadata: { title: 'A Show' },
      numEpisodes: 2,
      episodes: [
        { id: 'e1', title: 'One', publishedAt: DAY },
        { id: 'e2', title: 'Two', publishedAt: 2 * DAY },
      ],
    },
  } as unknown as LibraryItem;
}

const setToast = vi.fn();

/** What the app has loaded and what it is playing. Tests move these to act as
 *  the listener: the advance may only speak while the ended item is still the
 *  one loaded. */
let shelf: LibraryItem[] = [];
let playingItem: LibraryItem | undefined;
let playing: { bookId: string | null; episodeId: string | null } = { bookId: null, episodeId: null };

function state(): OnyxState {
  return {
    library: shelf,
    downloads: [],
    mediaProgress: [],
    playingItem,
    serverUrl: 'https://abs.example',
    isOffline: false,
    currentBookId: playing.bookId,
    currentEpisodeId: playing.episodeId,
    setToast,
  } as unknown as OnyxState;
}

/** Mount the hook on a given now-playing item and wait for its listener. */
async function mount(bookId = 'b1', episodeId: string | null = null) {
  playing = { bookId, episodeId };
  const view = renderHook(() => useUpNext(state()));
  await waitFor(() => expect(tauri.listeners.get('playback-ended')?.size).toBeGreaterThan(0));
  return view;
}

/** The listener starts something else — a manual play from the shelf. */
function startsAnotherItem(rerender: () => void, bookId = 'other') {
  playing = { bookId, episodeId: null };
  rerender();
}

beforeEach(() => {
  tauri.reset();
  core.reset();
  localStorage.clear();
  playback.playBook.mockClear();
  playback.playEpisode.mockClear();
  setToast.mockClear();
  shelf = [book('b1', '1'), book('b2', '2')];
  playingItem = undefined;
  playing = { bookId: null, episodeId: null };
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
    const { result } = await mount('b2');

    await act(async () => { await tauri.emit('playback-ended', { itemId: 'b2', episodeId: null }); });

    expect(result.current.prompt).toBeNull();
    expect(setToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }));
  });

  it('advances a server podcast from the expanded playing snapshot', async () => {
    // The shelf entry is minified (no episodes[]); the snapshot is the expanded
    // item the episode was started from. Reading only the shelf here is what
    // made every ABS podcast stop instead of continuing.
    shelf = [minifiedShow('p1', 2)];
    playingItem = expandedShow('p1');
    const { result } = await mount('p1', 'e1');

    await act(async () => { await tauri.emit('playback-ended', { itemId: 'p1', episodeId: 'e1' }); });

    expect(result.current.prompt?.target).toMatchObject({ kind: 'episode', episode: { id: 'e2' } });

    act(() => result.current.accept());

    // The expanded show is handed to playback, not just its id — that snapshot
    // is what the *next* end of an episode resolves against.
    const [, parent, episode] = playback.playEpisode.mock.calls[0];
    expect((parent as LibraryItem).id).toBe('p1');
    expect((parent as unknown as { media: { episodes: unknown[] } }).media.episodes).toHaveLength(2);
    expect(episode).toMatchObject({ id: 'e2' });
  });

  it('detaches its listener on unmount', async () => {
    // A leaked listener would advance twice after a remount.
    const { unmount } = await mount();
    unmount();
    expect(tauri.listeners.get('playback-ended')?.size ?? 0).toBe(0);
  });
});

describe('when the listener moves on first', () => {
  it('drops a resolution that returns after another item has started', async () => {
    // The series is not on the shelf, so resolution goes to the server. While
    // that request is in flight the listener starts a different book — the late
    // answer must not take the audio away from the choice they just made.
    localStorage.setItem('onyx.playback.upNext.books', JSON.stringify('auto'));
    shelf = [book('b1', '1')];
    let release: (items: LibraryItem[]) => void = () => {};
    core.onCommand('get_series_items', () => new Promise(resolve => { release = resolve as typeof release; }));
    const { result, rerender } = await mount('b1');

    let ended!: Promise<void>;
    await act(async () => { ended = tauri.emit('playback-ended', { itemId: 'b1', episodeId: null }); });
    startsAnotherItem(() => rerender());
    await act(async () => { release([book('b1', '1'), book('b2', '2')]); await ended; });

    expect(playback.playBook).not.toHaveBeenCalled();
    expect(result.current.prompt).toBeNull();
  });

  it('takes down a prompt that is still counting down', async () => {
    // The panel owns the countdown, so a prompt left on screen would start the
    // old series' next book over whatever the listener chose instead.
    const { result, rerender } = await mount('b1');
    await act(async () => { await tauri.emit('playback-ended', { itemId: 'b1', episodeId: null }); });
    expect(result.current.prompt).not.toBeNull();

    startsAnotherItem(() => rerender());

    expect(result.current.prompt).toBeNull();
    expect(playback.playBook).not.toHaveBeenCalled();
  });

  it('keeps the prompt it just produced', async () => {
    // The guard must not eat the ordinary case: nothing else started here.
    const { result, rerender } = await mount('b1');
    await act(async () => { await tauri.emit('playback-ended', { itemId: 'b1', episodeId: null }); });

    rerender();

    expect(result.current.prompt?.target).toMatchObject({ item: { id: 'b2' } });
  });
});
