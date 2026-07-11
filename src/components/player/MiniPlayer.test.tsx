import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ seekAudio: vi.fn(async () => {}) }));
vi.mock('../../api/abs', () => ({ seekAudio: api.seekAudio, asPodcastItem: (item: unknown) => item }));
vi.mock('../../api/playbook', () => ({ togglePlayback: vi.fn(async () => {}) }));
vi.mock('../Cover', () => ({ default: () => <div data-testid="cover" /> }));
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(async () => {}), warn: vi.fn(async () => {}), error: vi.fn(async () => {}), debug: vi.fn(async () => {}), attachConsole: vi.fn(async () => () => {}) }));

import MiniPlayer from './MiniPlayer';
import type { OnyxState } from '../../state/onyx';

afterEach(() => { cleanup(); api.seekAudio.mockClear(); });

function state(): OnyxState {
  const item = { id: 'book', libraryId: 'library', mediaType: 'book', media: { duration: 100, chapters: [], metadata: { title: 'Test Book', authorName: 'Author' } } };
  return { playing: true, playingItem: item, currentBook: item, currentBookId: 'book', focusedBookId: 'other', currentEpisode: null, position: 30, bookSecs: 100, serverUrl: '', currentLibraryId: 'library', setFocusedBookId: vi.fn(), setScreen: vi.fn(), setActiveLibrary: vi.fn(async () => {}) } as unknown as OnyxState;
}

describe('MiniPlayer accessibility', () => {
  it('names icon controls and exposes keyboard seeking', () => {
    render(<MiniPlayer st={state()} />);
    expect(screen.getByRole('button', { name: 'Return to now playing: Test Book' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
    const slider = screen.getByRole('slider', { name: 'Seek in Test Book' });
    expect(slider.getAttribute('aria-valuenow')).toBe('30');
    const bubbledKeydown = vi.fn();
    window.addEventListener('keydown', bubbledKeydown);
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(api.seekAudio).toHaveBeenCalledWith(40);
    fireEvent.keyDown(slider, { key: 'End' });
    expect(api.seekAudio).toHaveBeenCalledWith(100);
    // Slider-owned keys must never reach useOnyxState's window shortcut and
    // issue a second seek against the same playback position.
    expect(bubbledKeydown).not.toHaveBeenCalled();
    window.removeEventListener('keydown', bubbledKeydown);
  });
});
