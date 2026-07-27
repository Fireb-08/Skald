// Freezes the Settings → Playback preference parsing before the adaptive
// auto-rewind upgrade (Auto-Rewind & Per-Book Speed roadmap, Phase 1). These
// keys are written by PlaybackSection via `useLocal`, which JSON-stringifies,
// and read back by every transport surface — so the exact storage format, the
// defaults, and the malformed-input behaviour are all load-bearing.
import { beforeEach, describe, expect, it } from 'vitest';
import { autoRewindCfg, rewindSeconds, skipSeconds } from './playbackPrefs';

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

describe('autoRewindCfg — the picture handed to the backend', () => {
  it('defaults to today behaviour: fixed 5s, no scaling', () => {
    // The migration contract. A user who never opens the new controls must get
    // exactly the resume they had before the adaptive feature existed.
    expect(autoRewindCfg()).toEqual({
      adaptive: false,
      fixedSecs: 5,
      minSecs: 1,
      maxSecs: 30,
      activationDelaySecs: 0,
      chapterBarrier: false,
    });
  });

  it('carries the legacy fixed step through unchanged', () => {
    // onyx.playback.rewind keeps its meaning; it is not reinterpreted as a
    // minimum or folded into a new key.
    localStorage.setItem('onyx.playback.rewind', JSON.stringify('10s'));
    expect(autoRewindCfg().fixedSecs).toBe(10);

    localStorage.setItem('onyx.playback.rewind', JSON.stringify('Off'));
    expect(autoRewindCfg().fixedSecs).toBe(0);
  });

  it('reads the advanced keys when the user has set them', () => {
    localStorage.setItem('onyx.playback.autoRewind.adaptive', JSON.stringify(true));
    localStorage.setItem('onyx.playback.autoRewind.min', JSON.stringify(2));
    localStorage.setItem('onyx.playback.autoRewind.max', JSON.stringify(60));
    localStorage.setItem('onyx.playback.autoRewind.delay', JSON.stringify(15));
    localStorage.setItem('onyx.playback.autoRewind.chapterBarrier', JSON.stringify(true));

    expect(autoRewindCfg()).toMatchObject({
      adaptive: true, minSecs: 2, maxSecs: 60, activationDelaySecs: 15, chapterBarrier: true,
    });
  });

  it('falls back to defaults rather than propagating junk across the bridge', () => {
    // A corrupt value reaching Rust as NaN would make every resume behave
    // unpredictably; a default is always recoverable.
    localStorage.setItem('onyx.playback.autoRewind.min', 'not json');
    localStorage.setItem('onyx.playback.autoRewind.max', JSON.stringify('sixty'));
    localStorage.setItem('onyx.playback.autoRewind.adaptive', JSON.stringify('yes'));

    expect(autoRewindCfg()).toMatchObject({ minSecs: 1, maxSecs: 30, adaptive: false });
  });

  it('turning scaling back off restores the previous fixed behaviour exactly', () => {
    localStorage.setItem('onyx.playback.rewind', JSON.stringify('2s'));
    localStorage.setItem('onyx.playback.autoRewind.adaptive', JSON.stringify(true));
    localStorage.setItem('onyx.playback.autoRewind.min', JSON.stringify(10));
    expect(autoRewindCfg().adaptive).toBe(true);

    // The advanced values persist but stop applying — the fixed step is intact.
    localStorage.setItem('onyx.playback.autoRewind.adaptive', JSON.stringify(false));
    expect(autoRewindCfg()).toMatchObject({ adaptive: false, fixedSecs: 2 });
  });
});
