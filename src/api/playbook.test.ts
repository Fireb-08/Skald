import { beforeEach, describe, expect, it, vi } from 'vitest';

const abs = vi.hoisted(() => ({
  closeActiveSession: vi.fn(async () => {}),
  openPlaybackSession: vi.fn(),
  playAudio: vi.fn(async () => {}),
  pauseAudio: vi.fn(async () => {}),
  setVolume: vi.fn(async () => {}),
  playLocalFile: vi.fn(async () => {}),
  getOfflineProgress: vi.fn(async () => null),
  getLocalProgress: vi.fn(async () => null),
  seekAudio: vi.fn(async () => {}),
}));

vi.mock('./abs', () => abs);
vi.mock('../lib/log', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import type { PodcastEpisode } from './abs';
import type { OnyxState } from '../state/onyx';
import { playBook, playEpisode } from './playbook';

function state(overrides: Partial<OnyxState> = {}): OnyxState {
  return {
    serverUrl: 'http://abs.local',
    userId: 'user-123',
    downloads: [],
    library: [],
    mediaProgress: [],
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
});
