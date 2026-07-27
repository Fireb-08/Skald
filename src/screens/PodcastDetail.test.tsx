// The per-show "Up next" direction control (Auto-Play Next roadmap, Phase 4).
// Direction is stored per show, so the control has to follow navigation between
// shows — and PodcastDetail is rendered by a screen switch, not by a route with
// a key, so React reuses the instance and a state initializer runs only once.
// That is the whole of what is tested here: what the control shows after the
// show changes, and which key its next click writes.
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/playbook', () => ({
  playEpisode: vi.fn(async () => {}),
  togglePlayback: vi.fn(async () => {}),
}));
vi.mock('../components/Cover', () => ({ default: () => <div data-testid="cover" /> }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => undefined }));
vi.mock('@tauri-apps/plugin-log', () => ({
  info: vi.fn(async () => {}), warn: vi.fn(async () => {}),
  error: vi.fn(async () => {}), debug: vi.fn(async () => {}),
  attachConsole: vi.fn(async () => () => {}),
}));

import PodcastDetail from './PodcastDetail';
import type { OnyxState } from '../state/onyx';

const DIRECTION = (showId: string) => `onyx.podcast.advanceDir.${showId}`;

function show(id: string, title: string) {
  return {
    id, ino: id, libraryId: 'lib1', mediaType: 'podcast',
    media: { metadata: { title }, numEpisodes: 0, episodes: [] },
  };
}

/** No serverUrl, so the expanded-item fetch is skipped and the screen renders
 *  straight from the shelf entry — the direction control is what matters here. */
function state(podcastDetailId: string): OnyxState {
  return {
    library: [show('p1', 'Show One'), show('p2', 'Show Two')],
    podcastDetailId,
    serverUrl: '',
    mediaProgress: [],
    activeLibrary: undefined,
    currentBookId: null,
    currentEpisodeId: null,
    playing: false,
    refreshLibrary: async () => {},
    setScreen: vi.fn(),
    setPodcastDetailId: vi.fn(),
    setCurrentEpisode: vi.fn(),
    setCurrentEpisodeId: vi.fn(),
    setCurrentBookId: vi.fn(),
    setFocusedBookId: vi.fn(),
    setToast: vi.fn(),
  } as unknown as OnyxState;
}

const directionButton = () => screen.getByRole('button', { name: /^Up next · / });

beforeEach(() => { localStorage.clear(); });

describe('the per-show advance direction', () => {
  it('follows navigation to another show without a remount', () => {
    localStorage.setItem(DIRECTION('p1'), JSON.stringify('newest'));
    // p2 has no stored direction, so it is the default: oldest first.
    const { rerender } = render(<PodcastDetail st={state('p1')} />);
    expect(directionButton().textContent).toBe('Up next · newest first');

    rerender(<PodcastDetail st={state('p2')} />);

    expect(directionButton().textContent).toBe('Up next · oldest first');
  });

  it('toggles from the new show’s value, and writes under its key', () => {
    localStorage.setItem(DIRECTION('p1'), JSON.stringify('newest'));
    const { rerender } = render(<PodcastDetail st={state('p1')} />);
    rerender(<PodcastDetail st={state('p2')} />);

    fireEvent.click(directionButton());

    // Toggling a stale "newest" would have written oldest-first and appeared to
    // do nothing, while the control claimed an order resolution never used.
    expect(localStorage.getItem(DIRECTION('p2'))).toBe(JSON.stringify('newest'));
    expect(directionButton().textContent).toBe('Up next · newest first');
    expect(localStorage.getItem(DIRECTION('p1'))).toBe(JSON.stringify('newest'));
  });
});
