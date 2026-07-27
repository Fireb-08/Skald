// Candidate selection for auto-play-next (Auto-Play Next roadmap, Phase 3).
// The pure ordering is pinned in lib/series.test.ts and lib/upNext.test.ts;
// what is tested here is which candidates the resolver hands them — the part
// that decides whether the advance is playable at all (offline), already heard
// (progress), or even known to the client (series cache miss).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryItem, MediaProgress, PodcastEpisode, SeriesObject } from '../api/abs';
import type { OnyxState } from './onyx';
import { resolveUpNext } from './upNextTarget';

// Inline rather than imported (the hoisted factory runs before imports resolve)
// — same shape the other state-level tests use.
const tauri = vi.hoisted(() => {
  const handlers = new Map<string, (args?: Record<string, unknown>) => unknown>();
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  return {
    calls,
    handlers,
    invoke: async (cmd: string, args?: Record<string, unknown>) => {
      calls.push({ cmd, args });
      return handlers.get(cmd)?.(args);
    },
    onCommand: (cmd: string, fn: (args?: Record<string, unknown>) => unknown) => { handlers.set(cmd, fn); },
    reset: () => { handlers.clear(); calls.length = 0; },
  };
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

function book(id: string, sequence: SeriesObject['sequence'], extra: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id,
    ino: id,
    libraryId: 'lib1',
    mediaType: 'book',
    media: {
      metadata: {
        title: `Book ${sequence}`,
        subtitle: null,
        authorName: 'A. Author',
        narratorName: null,
        seriesName: 'Mistborn',
        series: [{ id: 'ser1', name: 'Mistborn', sequence }],
        genres: [],
      },
    },
    ...extra,
  } as unknown as LibraryItem;
}

function podcast(id: string, episodes: PodcastEpisode[]): LibraryItem {
  return {
    id,
    ino: id,
    libraryId: 'lib1',
    mediaType: 'podcast',
    media: { metadata: { title: 'A Show' }, episodes },
  } as unknown as LibraryItem;
}

function progress(itemId: string, episodeId: string | null, isFinished: boolean): MediaProgress {
  return {
    id: `${itemId}-${episodeId ?? ''}`,
    libraryItemId: itemId,
    episodeId,
    duration: 100,
    progress: isFinished ? 1 : 0.5,
    currentTime: isFinished ? 100 : 50,
    isFinished,
    lastUpdate: 0,
  };
}

/** Just the slice of OnyxState the resolver reads. */
function state(overrides: Partial<OnyxState> = {}): OnyxState {
  return {
    library: [],
    downloads: [],
    mediaProgress: [],
    playingItem: null,
    serverUrl: 'https://abs.example',
    isOffline: false,
    ...overrides,
  } as unknown as OnyxState;
}

beforeEach(() => {
  tauri.reset();
  localStorage.clear();
});

describe('books', () => {
  const shelf = [book('b1', '1'), book('b2', '2'), book('b3', '3')];

  it('advances to the next book in the series', async () => {
    const res = await resolveUpNext(state({ library: shelf }), 'b1', null);
    expect(res.target).toEqual({ kind: 'book', item: shelf[1] });
  });

  it('skips a book already finished elsewhere', async () => {
    // Finished on a phone: replaying it would be the opposite of continuing.
    const st = state({ library: shelf, mediaProgress: [progress('b2', null, true)] });
    expect((await resolveUpNext(st, 'b1', null)).target).toMatchObject({ item: { id: 'b3' } });
  });

  it('reports the end of the series rather than a failure', async () => {
    expect(await resolveUpNext(state({ library: shelf }), 'b3', null)).toEqual({ miss: 'series-end' });
  });

  it('reports a standalone book as not in a series', async () => {
    const solo = book('solo', undefined);
    solo.media.metadata.series = null;
    solo.media.metadata.seriesName = null;
    const res = await resolveUpNext(state({ library: [solo] }), 'solo', null);
    expect(res).toEqual({ miss: 'not-in-series' });
  });

  it('resolves from the now-playing snapshot when the shelf has moved on', async () => {
    // Switching libraries takes the finished book off st.library; the MiniPlayer
    // keeps rendering it from this snapshot, and advance must survive the same way.
    const st = state({ library: shelf, playingItem: book('b1', '1') });
    st.library = shelf.slice(1);
    expect((await resolveUpNext(st, 'b1', null)).target).toMatchObject({ item: { id: 'b2' } });
  });
});

describe('books — offline', () => {
  const shelf = [book('b1', '1'), book('b2', '2'), book('b3', '3')];

  it('offers only a downloaded next book', async () => {
    // b2 is next but not downloaded; offering it would fail the moment it played.
    const st = state({
      library: shelf,
      isOffline: true,
      downloads: [{ itemId: 'b3', filePath: '/x/b3.m4b' }] as OnyxState['downloads'],
    });
    expect((await resolveUpNext(st, 'b1', null)).target).toMatchObject({ item: { id: 'b3' } });
  });

  it('offers nothing when nothing ahead is downloaded', async () => {
    const st = state({ library: shelf, isOffline: true });
    expect(await resolveUpNext(st, 'b1', null)).toEqual({ miss: 'series-end' });
  });

  it('counts local-library items, which are already on disk', async () => {
    const local = [book('l1', '1', { localPath: '/books/1' }), book('l2', '2', { localPath: '/books/2' })];
    const st = state({ library: local, isOffline: true });
    expect((await resolveUpNext(st, 'l1', null)).target).toMatchObject({ item: { id: 'l2' } });
  });
});

describe('books — series cache miss', () => {
  it('queries ABS for the series when the shelf holds only the finished book', async () => {
    const fetched = [book('b1', '1'), book('b2', '2')];
    tauri.onCommand('get_series_items', () => fetched);
    const st = state({ library: [book('b1', '1')] });

    const res = await resolveUpNext(st, 'b1', null);

    expect(res.target).toMatchObject({ item: { id: 'b2' } });
    expect(tauri.calls).toContainEqual({
      cmd: 'get_series_items',
      args: { serverUrl: 'https://abs.example', libraryId: 'lib1', seriesId: 'ser1' },
    });
  });

  it('does not query when the shelf already holds the series', async () => {
    const st = state({ library: [book('b1', '1'), book('b2', '2')] });
    await resolveUpNext(st, 'b1', null);
    expect(tauri.calls.filter(c => c.cmd === 'get_series_items')).toHaveLength(0);
  });

  it('does not query while offline, and falls back to the shelf', async () => {
    const st = state({ library: [book('b1', '1')], isOffline: true });
    expect(await resolveUpNext(st, 'b1', null)).toEqual({ miss: 'series-end' });
    expect(tauri.calls.filter(c => c.cmd === 'get_series_items')).toHaveLength(0);
  });

  it('falls back to the shelf when the query fails', async () => {
    // A dead server at the end of a book must not throw into the tick handler.
    tauri.onCommand('get_series_items', () => { throw new Error('HTTP 500'); });
    const st = state({ library: [book('b1', '1')] });
    expect(await resolveUpNext(st, 'b1', null)).toEqual({ miss: 'series-end' });
  });
});

describe('podcasts', () => {
  const DAY = 86_400_000;
  const episodes: PodcastEpisode[] = [
    { id: 'e1', title: 'One',   publishedAt: 1 * DAY },
    { id: 'e2', title: 'Two',   publishedAt: 2 * DAY },
    { id: 'e3', title: 'Three', publishedAt: 3 * DAY },
  ];
  const show = podcast('p1', episodes);

  it('advances oldest-first by default', async () => {
    const res = await resolveUpNext(state({ library: [show] }), 'p1', 'e1');
    expect(res.target).toMatchObject({ kind: 'episode', episode: { id: 'e2' } });
  });

  it('follows the show’s stored direction', async () => {
    localStorage.setItem('onyx.podcast.advanceDir.p1', JSON.stringify('newest'));
    const res = await resolveUpNext(state({ library: [show] }), 'p1', 'e3');
    expect(res.target).toMatchObject({ episode: { id: 'e2' } });
  });

  it('skips finished episodes and reports the end of the feed', async () => {
    const st = state({ library: [show], mediaProgress: [progress('p1', 'e2', true)] });
    expect((await resolveUpNext(st, 'p1', 'e1')).target).toMatchObject({ episode: { id: 'e3' } });
    expect(await resolveUpNext(state({ library: [show] }), 'p1', 'e3')).toEqual({ miss: 'feed-end' });
  });

  it('offers only downloaded episodes while offline', async () => {
    const localShow = podcast('p2', [
      { id: 'e1', title: 'One', publishedAt: DAY, localPath: '/pod/1.mp3' } as PodcastEpisode,
      { id: 'e2', title: 'Two', publishedAt: 2 * DAY },
      { id: 'e3', title: 'Three', publishedAt: 3 * DAY, localPath: '/pod/3.mp3' } as PodcastEpisode,
    ]);
    const st = state({ library: [localShow], isOffline: true });
    expect((await resolveUpNext(st, 'p2', 'e1')).target).toMatchObject({ episode: { id: 'e3' } });
  });
});

describe('unknown media', () => {
  it('resolves nothing for an item the client no longer knows', async () => {
    expect(await resolveUpNext(state(), 'ghost', null)).toEqual({ miss: 'unknown-item' });
  });

  it('resolves nothing for an episode missing from its show', async () => {
    const st = state({ library: [podcast('p1', [{ id: 'e1', title: 'One', publishedAt: 1 }])] });
    expect(await resolveUpNext(st, 'p1', 'gone')).toEqual({ miss: 'no-episodes' });
  });
});
