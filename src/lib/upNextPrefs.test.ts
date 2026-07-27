// Auto-play-next preferences (Auto-Play Next roadmap, Phase 3). The load-bearing
// property here is the separation: `onyx.playback.autoPlayNext` predates this
// feature and means chapter continuity *within* an item, so it must keep that
// meaning no matter what the new cross-item settings say — and vice versa.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  chapterContinuityEnabled,
  episodeDirection,
  setEpisodeDirection,
  upNextCountdownSeconds,
  upNextMode,
} from './upNextPrefs';

beforeEach(() => localStorage.clear());

describe('the legacy autoPlayNext key stays chapter scoped', () => {
  it('does not decide cross-item continuation either way', () => {
    // Written by PlaybackSection's Toggle via useLocal (JSON booleans).
    localStorage.setItem('onyx.playback.autoPlayNext', JSON.stringify(false));
    expect(chapterContinuityEnabled()).toBe(false);
    // Turning chapter continuity off must not silently opt the listener out of
    // series continuation, which they have never been asked about.
    expect(upNextMode('book')).toBe('prompt');
    expect(upNextMode('podcast')).toBe('prompt');
  });

  it('is not touched by the new cross-item settings', () => {
    localStorage.setItem('onyx.playback.upNext.books', JSON.stringify('off'));
    localStorage.setItem('onyx.playback.upNext.podcasts', JSON.stringify('auto'));
    expect(chapterContinuityEnabled()).toBe(true);
    expect(localStorage.getItem('onyx.playback.autoPlayNext')).toBeNull();
  });

  it('reads the legacy key the way it has always been written', () => {
    expect(chapterContinuityEnabled()).toBe(true); // absent → on
    localStorage.setItem('onyx.playback.autoPlayNext', JSON.stringify(true));
    expect(chapterContinuityEnabled()).toBe(true);
  });
});

describe('upNextMode', () => {
  it('defaults both kinds to prompt', () => {
    expect(upNextMode('book')).toBe('prompt');
    expect(upNextMode('podcast')).toBe('prompt');
  });

  it('reads each kind from its own key', () => {
    localStorage.setItem('onyx.playback.upNext.books', JSON.stringify('auto'));
    localStorage.setItem('onyx.playback.upNext.podcasts', JSON.stringify('off'));
    expect(upNextMode('book')).toBe('auto');
    expect(upNextMode('podcast')).toBe('off');
  });

  it('falls back to the default on junk rather than throwing at end of book', () => {
    localStorage.setItem('onyx.playback.upNext.books', 'not json');
    expect(upNextMode('book')).toBe('prompt');
    localStorage.setItem('onyx.playback.upNext.books', JSON.stringify('sometimes'));
    expect(upNextMode('book')).toBe('prompt');
  });
});

describe('upNextCountdownSeconds', () => {
  it('defaults to 10 and reads a stored value', () => {
    expect(upNextCountdownSeconds()).toBe(10);
    localStorage.setItem('onyx.playback.upNext.countdown', JSON.stringify(20));
    expect(upNextCountdownSeconds()).toBe(20);
  });

  it('clamps values that would turn the prompt into something else', () => {
    // 0 would make "ask" indistinguishable from "play"…
    localStorage.setItem('onyx.playback.upNext.countdown', JSON.stringify(0));
    expect(upNextCountdownSeconds()).toBe(3);
    // …and a huge one would leave the panel up indefinitely.
    localStorage.setItem('onyx.playback.upNext.countdown', JSON.stringify(9999));
    expect(upNextCountdownSeconds()).toBe(60);
  });

  it('ignores non-numeric storage', () => {
    localStorage.setItem('onyx.playback.upNext.countdown', JSON.stringify('ten'));
    expect(upNextCountdownSeconds()).toBe(10);
  });
});

describe('episodeDirection', () => {
  it('defaults to oldest-first, per show', () => {
    expect(episodeDirection('show1')).toBe('oldest');
    setEpisodeDirection('show1', 'newest');
    expect(episodeDirection('show1')).toBe('newest');
    // A second show keeps its own default — the whole point of per-show storage.
    expect(episodeDirection('show2')).toBe('oldest');
  });

  it('handles a missing show id and junk storage', () => {
    expect(episodeDirection(undefined)).toBe('oldest');
    localStorage.setItem('onyx.podcast.advanceDir.show3', JSON.stringify('sideways'));
    expect(episodeDirection('show3')).toBe('oldest');
  });
});
