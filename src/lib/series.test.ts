// Next-in-series resolution (Auto-Play Next roadmap, Phase 1). This is the whole
// of "which book plays after this one", so the sequence semantics are pinned
// here: ABS orders series items by a numeric CAST of `sequence` (verified
// against libraryItemsBookFilters.js), which is why "10" follows "9" and a
// natural/lexicographic sort would be wrong.
import { describe, expect, it } from 'vitest';
import type { LibraryItem, SeriesObject } from '../api/abs';
import { nextInSeries, parseSequence, primarySeries } from './series';

/** Minimal item carrying just the series metadata the resolver reads. */
function book(id: string, series: string, sequence?: SeriesObject['sequence']): LibraryItem {
  return {
    id,
    ino: id,
    libraryId: 'lib1',
    mediaType: 'book',
    media: {
      metadata: {
        title: `Book ${sequence ?? id}`,
        subtitle: null,
        authorName: 'A. Author',
        narratorName: null,
        seriesName: series,
        series: [{ id: `s-${series}`, name: series, sequence }],
        genres: [],
      },
    },
  } as unknown as LibraryItem;
}

describe('parseSequence — ABS CAST(sequence AS FLOAT) semantics', () => {
  it('accepts numbers, decimal strings, and numeric prefixes', () => {
    expect(parseSequence(3)).toBe(3);
    expect(parseSequence('1.5')).toBe(1.5);
    // SQLite's cast takes the leading numeric prefix: "2a" → 2.
    expect(parseSequence('2a')).toBe(2);
  });

  it('treats absent and non-numeric sequences as unpositioned', () => {
    expect(parseSequence(undefined)).toBeNull();
    expect(parseSequence(null)).toBeNull();
    // SQLite would cast this to 0.0; we refuse to place it rather than advance
    // into an item whose position in the series is a guess.
    expect(parseSequence('a2')).toBeNull();
  });
});

describe('primarySeries', () => {
  it('prefers the series object over the flat seriesName', () => {
    expect(primarySeries(book('b1', 'Mistborn', '2'))).toEqual({ name: 'Mistborn', sequence: 2 });
  });

  it('falls back to seriesName with no sequence when only the flat name exists', () => {
    const item = book('b1', 'Mistborn', '2');
    item.media.metadata.series = null;
    expect(primarySeries(item)).toEqual({ name: 'Mistborn', sequence: null });
  });

  it('returns null for a standalone book', () => {
    const item = book('b1', 'Mistborn', '1');
    item.media.metadata.series = null;
    item.media.metadata.seriesName = null;
    expect(primarySeries(item)).toBeNull();
  });
});

describe('nextInSeries — numeric and string sequences', () => {
  const library = [
    book('b1', 'Mistborn', '1'),
    book('b15', 'Mistborn', '1.5'),
    book('b2', 'Mistborn', 2),
    book('b2a', 'Mistborn', '2a'),
    book('b9', 'Mistborn', '9'),
    book('b10', 'Mistborn', '10'),
  ];

  it('advances to the next-higher sequence, including decimals', () => {
    expect(nextInSeries(library[0], library)?.id).toBe('b15'); // 1 → 1.5
    expect(nextInSeries(library[1], library)?.id).toBe('b2');  // 1.5 → 2
  });

  it('orders numerically, not lexicographically', () => {
    // A string sort would put "10" before "9" and stall the series at book 1.
    expect(nextInSeries(library[4], library)?.id).toBe('b10');
  });

  it('breaks a sequence tie by picking one of the tied items, never itself', () => {
    // "2a" casts to 2, colliding with book 2. Whichever wins, advancing must
    // move past the finished item rather than replay it.
    const next = nextInSeries(library[1], library);
    expect(next?.id).not.toBe('b15');
    expect(['b2', 'b2a']).toContain(next?.id);
  });

  it('skips gaps rather than stopping at a missing volume', () => {
    const sparse = [book('b1', 'Mistborn', '1'), book('b4', 'Mistborn', '4')];
    expect(nextInSeries(sparse[0], sparse)?.id).toBe('b4');
  });

  it('ignores other series and unpositioned items', () => {
    const mixed = [
      book('b1', 'Mistborn', '1'),
      book('other', 'Stormlight', '2'),
      book('noseq', 'Mistborn', undefined),
      book('b2', 'Mistborn', '2'),
    ];
    expect(nextInSeries(mixed[0], mixed)?.id).toBe('b2');
  });
});

describe('nextInSeries — end of series and filtered candidates', () => {
  const library = [
    book('b1', 'Mistborn', '1'),
    book('b2', 'Mistborn', '2'),
    book('b3', 'Mistborn', '3'),
  ];

  it('returns undefined at the last book', () => {
    expect(nextInSeries(library[2], library)).toBeUndefined();
  });

  it('returns undefined when the finished book has no sequence to advance from', () => {
    expect(nextInSeries(book('solo', 'Mistborn', undefined), library)).toBeUndefined();
  });

  it('steps over finished books instead of ending the search', () => {
    const next = nextInSeries(library[0], library, { isFinished: it => it.id === 'b2' });
    expect(next?.id).toBe('b3');
  });

  it('returns undefined when every later book is finished', () => {
    expect(nextInSeries(library[0], library, { isFinished: () => true })).toBeUndefined();
  });

  it('honours an eligibility filter (offline: downloaded items only)', () => {
    const downloaded = new Set(['b3']);
    const next = nextInSeries(library[0], library, { eligible: it => downloaded.has(it.id) });
    expect(next?.id).toBe('b3');
    expect(nextInSeries(library[0], library, { eligible: () => false })).toBeUndefined();
  });
});
