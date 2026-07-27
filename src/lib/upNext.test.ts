// Episode advance order (Auto-Play Next roadmap, Phase 1). Direction is the
// per-show choice that makes podcast continuation useful: catch-up listening
// walks forwards through the back catalogue, a news feed walks backwards from
// the newest. Both directions run off the same publication key, so it is pinned
// here along with the undated/tied-timestamp behaviour.
import { describe, expect, it } from 'vitest';
import type { PodcastEpisode } from '../api/abs';
import { episodePubMs, nextEpisode } from './upNext';

function ep(id: string, published: string | number | null, index?: number): PodcastEpisode {
  const base: PodcastEpisode = { id, title: `Episode ${id}`, index };
  if (typeof published === 'number') return { ...base, publishedAt: published };
  if (typeof published === 'string') return { ...base, pubDate: published };
  return base;
}

const DAY = 86_400_000;
// Deliberately out of order in the array — resolution must not depend on it.
const feed = [
  ep('e3', 3 * DAY),
  ep('e1', 1 * DAY),
  ep('e4', 4 * DAY),
  ep('e2', 2 * DAY),
];

describe('episodePubMs', () => {
  it('prefers publishedAt, then the RSS pubDate', () => {
    expect(episodePubMs(ep('a', 1_700_000_000_000))).toBe(1_700_000_000_000);
    expect(episodePubMs(ep('b', 'Tue, 01 Oct 2024 00:00:00 GMT')))
      .toBe(Date.parse('Tue, 01 Oct 2024 00:00:00 GMT'));
  });

  it('sorts undated and unparseable episodes oldest rather than throwing', () => {
    expect(episodePubMs(ep('c', null))).toBe(0);
    expect(episodePubMs(ep('d', 'not a date'))).toBe(0);
  });
});

describe('nextEpisode — direction', () => {
  it('oldest-first advances to the next-newer episode', () => {
    expect(nextEpisode(ep('e2', 2 * DAY), feed, 'oldest')?.id).toBe('e3');
  });

  it('newest-first advances to the next-older episode', () => {
    expect(nextEpisode(ep('e2', 2 * DAY), feed, 'newest')?.id).toBe('e1');
  });

  it('stops at the boundary each direction runs into', () => {
    // Newest episode has nothing newer; oldest has nothing older.
    expect(nextEpisode(ep('e4', 4 * DAY), feed, 'oldest')).toBeUndefined();
    expect(nextEpisode(ep('e1', 1 * DAY), feed, 'newest')).toBeUndefined();
  });

  it('returns undefined when the current episode is not in the feed', () => {
    // A stale episode gives no position to advance from — guessing one could
    // restart a show from an arbitrary point.
    expect(nextEpisode(ep('gone', 9 * DAY), feed, 'oldest')).toBeUndefined();
  });

  it('handles a single-episode feed', () => {
    const only = [ep('solo', DAY)];
    expect(nextEpisode(only[0], only, 'oldest')).toBeUndefined();
  });
});

describe('nextEpisode — ordering details', () => {
  it('orders by date, not by array position', () => {
    const shuffled = [feed[2], feed[0], feed[3], feed[1]];
    expect(nextEpisode(ep('e1', DAY), shuffled, 'oldest')?.id).toBe('e2');
  });

  it('breaks a timestamp tie on index so bulk-imported feeds stay stable', () => {
    const sameDay = [ep('b', DAY, 2), ep('a', DAY, 1), ep('c', DAY, 3)];
    expect(nextEpisode(sameDay[1], sameDay, 'oldest')?.id).toBe('b');
    expect(nextEpisode(sameDay[0], sameDay, 'newest')?.id).toBe('a');
  });

  it('places undated episodes at the oldest end', () => {
    const withUndated = [ep('dated', 2 * DAY), ep('undated', null)];
    expect(nextEpisode(withUndated[1], withUndated, 'oldest')?.id).toBe('dated');
  });

  it('identifies feed-preview episodes without ids by enclosure', () => {
    const a: PodcastEpisode = { title: 'A', publishedAt: DAY, enclosure: { url: 'https://x/a.mp3' } };
    const b: PodcastEpisode = { title: 'B', publishedAt: 2 * DAY, enclosure: { url: 'https://x/b.mp3' } };
    expect(nextEpisode({ ...a }, [a, b], 'oldest')?.title).toBe('B');
  });
});

describe('nextEpisode — filtered candidates', () => {
  it('steps over finished episodes instead of ending the feed', () => {
    const next = nextEpisode(ep('e1', DAY), feed, 'oldest', { isFinished: e => e.id === 'e2' });
    expect(next?.id).toBe('e3');
  });

  it('returns undefined when every later episode is finished', () => {
    expect(nextEpisode(ep('e1', DAY), feed, 'oldest', { isFinished: () => true })).toBeUndefined();
  });

  it('honours an eligibility filter (offline: downloaded episodes only)', () => {
    const downloaded = new Set(['e4']);
    const next = nextEpisode(ep('e1', DAY), feed, 'oldest', { eligible: e => downloaded.has(e.id!) });
    expect(next?.id).toBe('e4');
  });
});
