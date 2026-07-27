// Freezes the Settings → Playback preference parsing before the adaptive
// auto-rewind upgrade (Auto-Rewind & Per-Book Speed roadmap, Phase 1). These
// keys are written by PlaybackSection via `useLocal`, which JSON-stringifies,
// and read back by every transport surface — so the exact storage format, the
// defaults, and the malformed-input behaviour are all load-bearing.
import { beforeEach, describe, expect, it } from 'vitest';
import { rewindSeconds, skipSeconds } from './playbackPrefs';

beforeEach(() => localStorage.clear());

describe('rewindSeconds — legacy fixed auto-rewind', () => {
  it('reads the four values the settings segment offers', () => {
    const cases: Array<[string, number]> = [
      ['Off', 0],
      ['2s', 2],
      ['5s', 5],
      ['10s', 10],
    ];
    for (const [stored, expected] of cases) {
      localStorage.setItem('onyx.playback.rewind', JSON.stringify(stored));
      expect(rewindSeconds(), `stored ${stored}`).toBe(expected);
    }
  });

  it('defaults to 5s when the user has never touched the setting', () => {
    // Must match PlaybackSection's own default, or a fresh install would behave
    // differently from one where the user re-picked the same value.
    expect(rewindSeconds()).toBe(5);
  });

  it('treats unparseable storage as no rewind rather than throwing', () => {
    // A throw here would break the resume path itself, which is far worse than
    // silently not rewinding.
    localStorage.setItem('onyx.playback.rewind', 'not json');
    expect(rewindSeconds()).toBe(0);

    localStorage.setItem('onyx.playback.rewind', JSON.stringify('nonsense'));
    expect(rewindSeconds()).toBe(0);
  });
});

describe('skipSeconds', () => {
  it('parses the stored step and falls back to 30', () => {
    localStorage.setItem('onyx.playback.skip', JSON.stringify('15s'));
    expect(skipSeconds()).toBe(15);

    localStorage.clear();
    expect(skipSeconds()).toBe(30);

    localStorage.setItem('onyx.playback.skip', 'not json');
    expect(skipSeconds()).toBe(30);
  });
});
