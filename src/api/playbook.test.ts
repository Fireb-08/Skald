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
}));

vi.mock('./abs', () => abs);
vi.mock('../lib/log', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import type { PodcastEpisode } from './abs';
import type { OnyxState } from '../state/onyx';
import { playBook, playEpisode, resumePlayback, togglePlayback } from './playbook';

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

// ── Auto-rewind on resume (Auto-Rewind & Per-Book Speed roadmap, Phase 1) ─────
// Freezes the shipped fixed-rewind behaviour before the adaptive upgrade.
// resumePlayback is the canonical paused→playing transition for the CURRENT
// book; playBook resolves its own resume position and must never be rewound on
// top of it.
describe('resumePlayback — fixed auto-rewind', () => {
  beforeEach(() => localStorage.clear());

  it('steps back by the configured amount and keeps the UI in step', async () => {
    localStorage.setItem('onyx.playback.rewind', JSON.stringify('10s'));
    const st = state({ position: 300, playing: false });

    await resumePlayback(st);

    expect(abs.seekAudio).toHaveBeenCalledWith(290);
    expect(st.setPosition).toHaveBeenCalledWith(290);
    expect(abs.playAudio).toHaveBeenCalled();
    expect(st.setPlaying).toHaveBeenCalledWith(true);
  });

  it('clamps at the start of the book rather than seeking negative', async () => {
    localStorage.setItem('onyx.playback.rewind', JSON.stringify('10s'));
    const st = state({ position: 4, playing: false });

    await resumePlayback(st);

    expect(abs.seekAudio).toHaveBeenCalledWith(0);
    expect(st.setPosition).toHaveBeenCalledWith(0);
  });

  it('does not seek when the preference is Off', async () => {
    localStorage.setItem('onyx.playback.rewind', JSON.stringify('Off'));
    const st = state({ position: 300, playing: false });

    await resumePlayback(st);

    expect(abs.seekAudio).not.toHaveBeenCalled();
    expect(st.setPosition).not.toHaveBeenCalled();
    expect(abs.playAudio).toHaveBeenCalled();
  });

  it('does not seek at position zero — there is nothing to re-hear', async () => {
    localStorage.setItem('onyx.playback.rewind', JSON.stringify('5s'));
    const st = state({ position: 0, playing: false });

    await resumePlayback(st);

    expect(abs.seekAudio).not.toHaveBeenCalled();
  });

  it('leaves playing false when the engine refuses to resume', async () => {
    abs.playAudio.mockRejectedValueOnce(new Error('LibVLC is unhappy'));
    const st = state({ position: 300, playing: false });

    await resumePlayback(st);

    expect(st.setPlaying).toHaveBeenCalledWith(false);
    expect(st.setPlaying).not.toHaveBeenCalledWith(true);
  });
});

describe('togglePlayback', () => {
  beforeEach(() => localStorage.clear());

  it('pauses without rewinding when currently playing', async () => {
    const st = state({ position: 300, playing: true });

    await togglePlayback(st);

    expect(abs.pauseAudio).toHaveBeenCalled();
    expect(st.setPlaying).toHaveBeenCalledWith(false);
    expect(abs.seekAudio).not.toHaveBeenCalled();
  });

  it('routes the resume half through the rewind path', async () => {
    localStorage.setItem('onyx.playback.rewind', JSON.stringify('5s'));
    const st = state({ position: 300, playing: false });

    await togglePlayback(st);

    expect(abs.seekAudio).toHaveBeenCalledWith(295);
  });
});
