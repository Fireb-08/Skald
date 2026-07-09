// Unit tests for the pure helpers extracted from onyx.ts (Test Breadth roadmap,
// Phase 4 — unlocked by the Large-File Split). No Tauri mocks needed: everything
// here is side-effect-free.
import { describe, it, expect } from 'vitest';
import {
  bookAuthor, bookTitle, bookPalette, bookTpl, bookChapters,
  fmtTime, fmtRemaining, chapterAt, chapterStart,
  mergeProgress, patchLibraryItems,
  type Chapter,
} from './bookHelpers';
import type { LibraryItem, MediaProgress } from '../api/abs';

// Minimal LibraryItem factory — only the fields the helpers read.
function item(metadata: Record<string, unknown>, extra: Record<string, unknown> = {}): LibraryItem {
  return {
    id: 'item-1',
    media: { metadata, duration: 3600, ...extra },
  } as unknown as LibraryItem;
}

describe('bookAuthor', () => {
  it('handles the three authorName shapes (critical lesson 5)', () => {
    expect(bookAuthor(item({ authorName: 'Miles Cameron' }))).toBe('Miles Cameron');
    expect(bookAuthor(item({ authorName: { name: 'One Author' } }))).toBe('One Author');
    expect(bookAuthor(item({ authorName: [{ name: 'A' }, { name: 'B' }] }))).toBe('A, B');
    expect(bookAuthor(item({}))).toBe('Unknown Author');
  });
});

describe('bookTitle', () => {
  it('falls back to the item id when the title is missing', () => {
    expect(bookTitle(item({ title: 'The Red Knight' }))).toBe('The Red Knight');
    expect(bookTitle(item({}))).toBe('item-1');
  });
});

describe('patchLibraryItems', () => {
  it('derives authorName/narratorName from the array fields when null', () => {
    const it1 = item({ authors: [{ name: 'X' }, { name: 'Y' }], narrators: ['N1', 'N2'] });
    const [patched] = patchLibraryItems([it1]);
    const m = patched.media.metadata as unknown as Record<string, unknown>;
    expect(m.authorName).toBe('X, Y');
    expect(m.narratorName).toBe('N1, N2');
  });

  it('never overwrites already-populated display fields', () => {
    const it1 = item({ authorName: 'Keep Me', authors: [{ name: 'Ignore' }] });
    const [patched] = patchLibraryItems([it1]);
    expect((patched.media.metadata as unknown as Record<string, unknown>).authorName).toBe('Keep Me');
  });
});

describe('mergeProgress', () => {
  const p = (itemId: string, episodeId: string | undefined, currentTime: number): MediaProgress =>
    ({ libraryItemId: itemId, episodeId, currentTime } as unknown as MediaProgress);

  it('keys by item + episode, newest write wins', () => {
    const merged = mergeProgress(
      [p('a', undefined, 10), p('a', 'ep1', 20)],
      [p('a', undefined, 99), p('b', undefined, 5)],
    );
    expect(merged).toHaveLength(3);
    expect(merged.find(m => m.libraryItemId === 'a' && !m.episodeId)?.currentTime).toBe(99);
    expect(merged.find(m => m.libraryItemId === 'a' && m.episodeId === 'ep1')?.currentTime).toBe(20);
  });
});

describe('time formatting', () => {
  it('fmtTime renders M:SS below an hour and H:MM:SS above', () => {
    expect(fmtTime(59)).toBe('0:59');
    expect(fmtTime(61)).toBe('1:01');
    expect(fmtTime(3723)).toBe('1:02:03');
    expect(fmtTime(-5)).toBe('0:00'); // clamped, never negative
  });

  it('fmtRemaining renders coarse H/M form', () => {
    expect(fmtRemaining(3660)).toBe('1h 1m');
    expect(fmtRemaining(120)).toBe('2m');
  });
});

describe('chapter math', () => {
  const chapters: Chapter[] = [
    { n: 1, t: 'One', dur: 100 },
    { n: 2, t: 'Two', dur: 200 },
    { n: 3, t: 'Three', dur: 300 },
  ];

  it('chapterAt locates the chapter and the local offset', () => {
    expect(chapterAt(chapters, 0)).toMatchObject({ idx: 0, local: 0 });
    expect(chapterAt(chapters, 150)).toMatchObject({ idx: 1, local: 50 });
    // Past the end clamps to the last chapter's end.
    expect(chapterAt(chapters, 10_000)).toMatchObject({ idx: 2, local: 300 });
  });

  it('chapterAt returns a stub for empty chapter lists', () => {
    expect(chapterAt([], 42).chapter.t).toBe('');
  });

  it('chapterStart accumulates prior durations', () => {
    expect(chapterStart(chapters, 0)).toBe(0);
    expect(chapterStart(chapters, 2)).toBe(300);
  });
});

describe('cover art derivation', () => {
  it('is deterministic per item id', () => {
    const b = item({});
    expect(bookPalette(b)).toEqual(bookPalette(b));
    expect(bookTpl(b)).toBe(bookTpl(b));
  });
});

describe('bookChapters', () => {
  it('maps ABS start/end chapters to numbered durations', () => {
    const b = item({}, { chapters: [{ title: 'Intro', start: 0, end: 90 }, { title: 'Ch 1', start: 90, end: 300 }] });
    expect(bookChapters(b)).toEqual([
      { n: 1, t: 'Intro', dur: 90 },
      { n: 2, t: 'Ch 1', dur: 210 },
    ]);
  });
});
