import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OfflineProgressEntry } from './abs';

const abs = vi.hoisted(() => ({
  closeActiveSession: vi.fn(async () => {}),
  closeActiveSessionWithoutSync: vi.fn(async () => {}),
  openPlaybackSession: vi.fn(),
  playAudio: vi.fn(async () => {}),
  pauseAudio: vi.fn(async () => {}),
  setVolume: vi.fn(async () => {}),
  playLocalFile: vi.fn(async () => {}),
  getOfflineProgress: vi.fn<(itemId: string) => Promise<OfflineProgressEntry | null>>(async () => null),
  getLocalProgress: vi.fn(async () => null),
  getMe: vi.fn(),
  seekAudio: vi.fn(async () => {}),
  setSpeed: vi.fn(async () => {}),
  resumeAudio: vi.fn(async () => ({ position: 0, rewound: 0 })),
}));

vi.mock('./abs', () => abs);
vi.mock('../lib/log', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import type { PodcastEpisode } from './abs';
import type { OnyxState } from '../state/onyx';
import { playBook, playEpisode, resumePlayback, togglePlayback, changeSpeed } from './playbook';

function state(overrides: Partial<OnyxState> = {}): OnyxState {
  return {
    serverUrl: 'http://abs.local',
    userId: 'user-123',
    downloads: [],
    library: [],
    mediaProgress: [],
    isOffline: false,
    activeLibrary: undefined,
    setPlayingItem: vi.fn(),
    setCurrentEpisodeId: vi.fn(),
    setCurrentEpisode: vi.fn(),
    setIsLocalPlayback: vi.fn(),
    setSessionReady: vi.fn(),
    setSessionId: vi.fn(),
    setPlaying: vi.fn(),
    setCurrentBookId: vi.fn(),
    setFocusedBookId: vi.fn(),
    setPosition: vi.fn(),
    setSpeed: vi.fn(),
    surfaceCorruptPersistenceNotices: vi.fn(async () => {}),
    ...overrides,
  } as unknown as OnyxState;
}

beforeEach(() => {
  vi.clearAllMocks();
  abs.getMe.mockResolvedValue({
    id: 'user-123',
    username: 'listener',
    token: '',
    mediaProgress: [],
    bookmarks: [],
  });
});

describe('server-backed playback resume', () => {
  it('uses the book session position instead of cached progress from before another device played', async () => {
    const st = state({
      mediaProgress: [{ libraryItemId: 'book', currentTime: 30, isFinished: false } as OnyxState['mediaProgress'][number]],
    });
    abs.openPlaybackSession.mockResolvedValue({ sessionId: 'session-book', currentTime: 420 });

    await playBook(st, 'book');

    expect(abs.openPlaybackSession).toHaveBeenCalledWith('http://abs.local', 'book', 'user-123', undefined);
    expect(st.setPosition).toHaveBeenCalledWith(420);
  });

  it('keeps a later local book position when ABS has not received it yet', async () => {
    const st = state({
      currentBookId: 'book',
      position: 480,
      mediaProgress: [{ libraryItemId: 'book', currentTime: 470, isFinished: false } as OnyxState['mediaProgress'][number]],
    });
    abs.openPlaybackSession.mockResolvedValue({ sessionId: 'session-book', currentTime: 420 });

    await playBook(st, 'book');

    expect(abs.seekAudio).toHaveBeenCalledWith(480);
    expect(st.setPosition).toHaveBeenCalledWith(480);
  });

  it('captures phone-ahead progress before closing the stale loaded session', async () => {
    const st = state({
      sessionReady: true,
      currentBookId: 'book',
      currentEpisodeId: null,
      position: 120,
      mediaProgress: [{
        libraryItemId: 'book',
        currentTime: 120,
        isFinished: false,
        lastUpdate: 100,
      } as OnyxState['mediaProgress'][number]],
    });
    abs.getMe.mockResolvedValue({
      id: 'user-123',
      username: 'listener',
      token: '',
      mediaProgress: [{
        libraryItemId: 'book',
        episodeId: null,
        currentTime: 420,
        isFinished: false,
        lastUpdate: 900,
      }],
      bookmarks: [],
    });
    // The session-open response models the regression: a stale close would
    // have replaced ABS immediately before POST /play.
    abs.openPlaybackSession.mockResolvedValue({ sessionId: 'session-book', currentTime: 120 });

    await playBook(st, 'book');

    expect(abs.closeActiveSessionWithoutSync).toHaveBeenCalledOnce();
    expect(abs.closeActiveSession).not.toHaveBeenCalled();
    expect(abs.getMe.mock.invocationCallOrder[0])
      .toBeLessThan(abs.closeActiveSessionWithoutSync.mock.invocationCallOrder[0]);
    expect(abs.seekAudio).toHaveBeenCalledWith(420);
    expect(st.setPosition).toHaveBeenCalledWith(420);
  });

  it('preserves an explicit chapter or bookmark jump for a book', async () => {
    const st = state();
    abs.openPlaybackSession.mockResolvedValue({ sessionId: 'session-book', currentTime: 90 });

    await playBook(st, 'book', 90);

    expect(abs.openPlaybackSession).toHaveBeenCalledWith('http://abs.local', 'book', 'user-123', 90);
    expect(st.setPosition).toHaveBeenCalledWith(90);
  });

  it('uses the episode session position instead of stale cached episode progress', async () => {
    const st = state({
      mediaProgress: [{ libraryItemId: 'podcast', episodeId: 'episode', currentTime: 15, isFinished: false } as OnyxState['mediaProgress'][number]],
    });
    const episode = { id: 'episode', title: 'Episode' } as PodcastEpisode;
    abs.openPlaybackSession.mockResolvedValue({ sessionId: 'session-episode', currentTime: 300 });

    await playEpisode(st, 'podcast', episode);

    expect(abs.openPlaybackSession).toHaveBeenCalledWith('http://abs.local', 'podcast', 'user-123', undefined, 'episode');
    expect(st.setPosition).toHaveBeenCalledWith(300);
  });

  it('does not report a book as playing when LibVLC rejects startup', async () => {
    const st = state();
    abs.openPlaybackSession.mockResolvedValue({ sessionId: 'session-book', currentTime: 30 });
    abs.playAudio.mockRejectedValueOnce(new Error('decoder unavailable'));

    await playBook(st, 'book');

    expect(st.setPlaying).toHaveBeenLastCalledWith(false);
  });

  it('does not report an episode as playing when LibVLC rejects startup', async () => {
    const st = state();
    const episode = { id: 'episode', title: 'Episode' } as PodcastEpisode;
    abs.openPlaybackSession.mockResolvedValue({ sessionId: 'session-episode', currentTime: 30 });
    abs.playAudio.mockRejectedValueOnce(new Error('decoder unavailable'));

    await playEpisode(st, 'podcast', episode);

    expect(st.setPlaying).toHaveBeenLastCalledWith(false);
  });
});

describe('downloaded ABS playback resume', () => {
  it('uses fresh ABS progress while keeping the local file transport', async () => {
    const st = state({
      downloads: [{ itemId: 'book', filePath: 'C:\\Books\\book.m4b' }] as OnyxState['downloads'],
      mediaProgress: [{
        libraryItemId: 'book',
        currentTime: 30,
        isFinished: false,
        lastUpdate: 100,
      } as OnyxState['mediaProgress'][number]],
    });
    abs.getOfflineProgress.mockResolvedValue({
      itemId: 'book',
      currentTime: 60,
      duration: 1_000,
      progress: 0.06,
      isFinished: false,
      recordedAt: 200,
      baselineCaptured: false,
    });
    abs.getMe.mockResolvedValue({
      id: 'user-123',
      username: 'listener',
      token: '',
      mediaProgress: [{
        libraryItemId: 'book',
        episodeId: null,
        currentTime: 420,
        isFinished: false,
        lastUpdate: 900,
      }],
      bookmarks: [],
    });

    await playBook(st, 'book');

    expect(abs.getMe).toHaveBeenCalledWith('http://abs.local');
    expect(abs.getMe.mock.invocationCallOrder[0])
      .toBeLessThan(abs.closeActiveSession.mock.invocationCallOrder[0]);
    expect(abs.openPlaybackSession).not.toHaveBeenCalled();
    expect(abs.playLocalFile).toHaveBeenCalledWith(
      'C:\\Books\\book.m4b',
      'book',
      420,
      false,
      undefined,
      true,
      900,
    );
    expect(st.setPosition).toHaveBeenCalledWith(420);
  });

  it('preserves a later unsynced stop point than the fresh ABS position', async () => {
    const st = state({
      downloads: [{ itemId: 'book', filePath: '/books/book.m4b' }] as OnyxState['downloads'],
    });
    abs.getOfflineProgress.mockResolvedValue({
      itemId: 'book',
      currentTime: 480,
      duration: 1_000,
      progress: 0.48,
      isFinished: false,
      recordedAt: 950,
      baselineCaptured: true,
      serverLastUpdate: 800,
    });
    abs.getMe.mockResolvedValue({
      id: 'user-123',
      username: 'listener',
      token: '',
      mediaProgress: [{
        libraryItemId: 'book',
        episodeId: null,
        currentTime: 420,
        isFinished: false,
        lastUpdate: 900,
      }],
      bookmarks: [],
    });

    await playBook(st, 'book');

    expect(abs.playLocalFile).toHaveBeenCalledWith(
      '/books/book.m4b',
      'book',
      480,
      false,
      undefined,
      true,
      800,
    );
  });

  it('falls back to durable offline progress when ABS is unreachable', async () => {
    const st = state({
      downloads: [{ itemId: 'book', filePath: '/books/book.m4b' }] as OnyxState['downloads'],
    });
    abs.getOfflineProgress.mockResolvedValue({
      itemId: 'book',
      currentTime: 75,
      duration: 1_000,
      progress: 0.075,
      isFinished: false,
      recordedAt: 300,
      baselineCaptured: false,
    });
    abs.getMe.mockRejectedValue(new Error('network unavailable'));

    await playBook(st, 'book');

    expect(abs.getMe).toHaveBeenCalledWith('http://abs.local');
    expect(abs.playLocalFile).toHaveBeenCalledWith(
      '/books/book.m4b',
      'book',
      75,
      false,
      undefined,
      false,
      undefined,
    );
    expect(st.setPosition).toHaveBeenCalledWith(75);
  });

  it('does not contact ABS when Skald is already offline', async () => {
    const st = state({
      isOffline: true,
      downloads: [{ itemId: 'book', filePath: '/books/book.m4b' }] as OnyxState['downloads'],
    });
    abs.getOfflineProgress.mockResolvedValue({
      itemId: 'book',
      currentTime: 90,
      duration: 1_000,
      progress: 0.09,
      isFinished: false,
      recordedAt: 800,
      baselineCaptured: true,
      serverLastUpdate: 700,
    });

    await playBook(st, 'book');

    expect(abs.getMe).not.toHaveBeenCalled();
    expect(st.setPosition).toHaveBeenCalledWith(90);
  });
});

// ── Auto-rewind on resume (Auto-Rewind & Per-Book Speed roadmap) ─────────────
// The rewind amount itself now lives in Rust (auto_rewind.rs, table-tested
// there). What matters on this side is that resumePlayback delegates the whole
// decision to one backend call, hands it the chapter barrier, and reflects
// whatever came back — no second copy of the maths.
describe('resumePlayback — delegates the rewind decision to the backend', () => {
  beforeEach(() => localStorage.clear());

  it('applies the position the backend rewound to', async () => {
    abs.resumeAudio.mockResolvedValueOnce({ position: 290, rewound: 10 });
    const st = state({ position: 300, playing: false });

    await resumePlayback(st);

    expect(abs.resumeAudio).toHaveBeenCalledTimes(1);
    expect(st.setPosition).toHaveBeenCalledWith(290);
    expect(st.setPlaying).toHaveBeenCalledWith(true);
    // The frontend must not compute or apply a rewind of its own.
    expect(abs.seekAudio).not.toHaveBeenCalled();
    expect(abs.playAudio).not.toHaveBeenCalled();
  });

  it('leaves the position alone when nothing was rewound', async () => {
    abs.resumeAudio.mockResolvedValueOnce({ position: 300, rewound: 0 });
    const st = state({ position: 300, playing: false });

    await resumePlayback(st);

    expect(st.setPosition).not.toHaveBeenCalled();
    expect(st.setPlaying).toHaveBeenCalledWith(true);
  });

  it('passes the current chapter start so the barrier has something to clamp to', async () => {
    const st = state({
      position: 100,
      playing: false,
      currentBookId: 'book',
      library: [{
        id: 'book',
        media: { chapters: [
          { id: 0, start: 0, end: 90, title: 'One' },
          { id: 1, start: 90, end: 200, title: 'Two' },
        ] },
      }] as unknown as OnyxState['library'],
    });

    await resumePlayback(st);

    expect(abs.resumeAudio).toHaveBeenCalledWith(90);
  });

  it('passes undefined when the book has no chapters to clamp against', async () => {
    const st = state({
      position: 100,
      playing: false,
      currentBookId: 'book',
      library: [{ id: 'book', media: { chapters: [] } }] as unknown as OnyxState['library'],
    });

    await resumePlayback(st);

    expect(abs.resumeAudio).toHaveBeenCalledWith(undefined);
  });

  it('leaves playing false when the engine refuses to resume', async () => {
    abs.resumeAudio.mockRejectedValueOnce(new Error('LibVLC is unhappy'));
    const st = state({ position: 300, playing: false });

    await resumePlayback(st);

    expect(st.setPlaying).toHaveBeenCalledWith(false);
    expect(st.setPlaying).not.toHaveBeenCalledWith(true);
  });
});

describe('togglePlayback', () => {
  beforeEach(() => localStorage.clear());

  it('pauses without resuming when currently playing', async () => {
    const st = state({ position: 300, playing: true });

    await togglePlayback(st);

    expect(abs.pauseAudio).toHaveBeenCalled();
    expect(st.setPlaying).toHaveBeenCalledWith(false);
    expect(abs.resumeAudio).not.toHaveBeenCalled();
  });

  it('routes the resume half through the backend resume path', async () => {
    abs.resumeAudio.mockResolvedValueOnce({ position: 295, rewound: 5 });
    const st = state({ position: 300, playing: false });

    await togglePlayback(st);

    expect(abs.resumeAudio).toHaveBeenCalledTimes(1);
    expect(st.setPosition).toHaveBeenCalledWith(295);
  });
});

// ── Per-book speed (Auto-Rewind & Per-Book Speed roadmap, Phase 4) ───────────
// speedMemory owns the resolution rules and is unit-tested separately. What
// matters here is that playback start actually applies the result — before
// this, the Settings "Default playback speed" control persisted a value that
// nothing ever read.
describe('playback start applies the resolved speed', () => {
  beforeEach(() => localStorage.clear());

  it('sends the global default to the engine when the book has no saved speed', async () => {
    localStorage.setItem('onyx.playback.speed', JSON.stringify('1.25'));
    const st = state();

    await playBook(st, 'book');

    expect(abs.setSpeed).toHaveBeenCalledWith(1.25);
    expect(st.setSpeed).toHaveBeenCalledWith('1.25');
  });

  it('prefers the speed saved for that specific book', async () => {
    localStorage.setItem('onyx.playback.speed', JSON.stringify('1.0'));
    localStorage.setItem('onyx.playback.speedByItem', JSON.stringify({ book: 1.5 }));
    const st = state();

    await playBook(st, 'book');

    expect(abs.setSpeed).toHaveBeenCalledWith(1.5);
  });

  it('applies the speed before starting audio, not after', async () => {
    // Ordering matters: applying afterwards makes the first moment of playback
    // audibly run at the wrong rate.
    localStorage.setItem('onyx.playback.speedByItem', JSON.stringify({ book: 2 }));
    const order: string[] = [];
    abs.setSpeed.mockImplementationOnce(async () => { order.push('speed'); });
    abs.playAudio.mockImplementationOnce(async () => { order.push('play'); });

    await playBook(state(), 'book');

    expect(order).toEqual(['speed', 'play']);
  });
});

describe('changeSpeed', () => {
  beforeEach(() => localStorage.clear());

  it('records the rate against the book and applies it', async () => {
    const st = state();

    await changeSpeed(st, 'book', '1.5');

    expect(abs.setSpeed).toHaveBeenCalledWith(1.5);
    expect(st.setSpeed).toHaveBeenCalledWith('1.5');
    expect(JSON.parse(localStorage.getItem('onyx.playback.speedByItem')!)).toEqual({ book: 1.5 });
  });

  it('never writes the global default', async () => {
    localStorage.setItem('onyx.playback.speed', JSON.stringify('1.0'));

    await changeSpeed(state(), 'book', '2.0');

    // The Settings control owns that key exclusively.
    expect(JSON.parse(localStorage.getItem('onyx.playback.speed')!)).toBe('1.0');
  });
});
