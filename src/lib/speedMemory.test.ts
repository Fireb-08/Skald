// Auto-Rewind & Per-Book Speed roadmap, Phase 4 (tests 6–9).
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearAllPerBookSpeeds,
  globalDefaultSpeed,
  hasRememberedSpeed,
  perBookSpeedEnabled,
  rememberedSpeedCount,
  rememberSpeed,
  speedForItem,
} from './speedMemory';

beforeEach(() => localStorage.clear());

const setGlobal = (rate: string) =>
  localStorage.setItem('onyx.playback.speed', JSON.stringify(rate));
const disablePerBook = () =>
  localStorage.setItem('onyx.playback.perBookSpeed', JSON.stringify(false));

describe('speedForItem — per-item rate with a global fallback', () => {
  it('falls back to the global default when the item has no remembered rate', () => {
    setGlobal('1.25');
    expect(speedForItem('book-a')).toBe(1.25);
    expect(hasRememberedSpeed('book-a')).toBe(false);
  });

  it('prefers a remembered rate over the global default', () => {
    setGlobal('1.0');
    rememberSpeed('book-a', 1.5);
    expect(speedForItem('book-a')).toBe(1.5);
    expect(hasRememberedSpeed('book-a')).toBe(true);
  });

  it('keeps books independent and leaves the global default alone', () => {
    // The whole point: one slow narrator must not re-rate the whole library.
    setGlobal('1.0');
    rememberSpeed('book-a', 1.5);

    expect(speedForItem('book-b')).toBe(1);
    expect(globalDefaultSpeed()).toBe(1);
    expect(JSON.parse(localStorage.getItem('onyx.playback.speed')!)).toBe('1.0');
  });

  it('defaults to 1× with no settings at all', () => {
    expect(speedForItem('book-a')).toBe(1);
    expect(globalDefaultSpeed()).toBe(1);
  });
});

describe('podcast episodes share their show speed', () => {
  it('resolves the show-level key, not a per-episode one', () => {
    // Episodes are keyed by library item — you adjust for the host's delivery,
    // not for one episode — so every episode of a show reads the same rate.
    rememberSpeed('podcast-show', 1.5);

    expect(speedForItem('podcast-show')).toBe(1.5);
    // The caller passes the item id for any episode of the show.
    expect(rememberedSpeedCount()).toBe(1);
  });
});

describe('perBookSpeed toggle off — legacy behaviour', () => {
  it('ignores remembered rates and reads only the global default', () => {
    setGlobal('1.25');
    rememberSpeed('book-a', 2);
    disablePerBook();

    expect(perBookSpeedEnabled()).toBe(false);
    expect(speedForItem('book-a')).toBe(1.25);
    expect(hasRememberedSpeed('book-a')).toBe(false);
  });

  it('does not record new rates while off, so nothing springs to life later', () => {
    disablePerBook();
    rememberSpeed('book-a', 2);
    expect(rememberedSpeedCount()).toBe(0);
  });

  it('is on by default and treats a corrupt flag as on', () => {
    expect(perBookSpeedEnabled()).toBe(true);
    localStorage.setItem('onyx.playback.perBookSpeed', 'not json');
    expect(perBookSpeedEnabled()).toBe(true);
  });
});

describe('reset-all — blast radius', () => {
  it('clears every remembered rate but preserves the global default', () => {
    setGlobal('1.25');
    rememberSpeed('book-a', 1.5);
    rememberSpeed('book-b', 2);
    expect(rememberedSpeedCount()).toBe(2);

    clearAllPerBookSpeeds();

    expect(rememberedSpeedCount()).toBe(0);
    expect(speedForItem('book-a')).toBe(1.25);
    expect(globalDefaultSpeed()).toBe(1.25);
  });
});

describe('storage robustness', () => {
  it('ignores a corrupt or wrongly-shaped map instead of throwing', () => {
    setGlobal('1.0');
    for (const junk of ['not json', JSON.stringify([1, 2]), JSON.stringify('nope')]) {
      localStorage.setItem('onyx.playback.speedByItem', junk);
      expect(speedForItem('book-a')).toBe(1);
    }
  });

  it('drops out-of-range entries rather than handing them to the audio engine', () => {
    localStorage.setItem(
      'onyx.playback.speedByItem',
      JSON.stringify({ ok: 1.5, zero: 0, negative: -1, huge: 99, text: '1.5' }),
    );
    expect(speedForItem('ok')).toBe(1.5);
    for (const bad of ['zero', 'negative', 'huge', 'text']) {
      expect(speedForItem(bad), bad).toBe(1);
    }
    expect(rememberedSpeedCount()).toBe(1);
  });

  it('ignores a missing item id', () => {
    setGlobal('1.5');
    expect(speedForItem(undefined)).toBe(1.5);
    expect(speedForItem(null)).toBe(1.5);
    rememberSpeed(null, 2);
    expect(rememberedSpeedCount()).toBe(0);
  });
});
