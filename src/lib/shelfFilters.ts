// Shared filter predicate for shelf grouping tabs (Series, Authors,
// Narrators, Collections). Determines whether a group of books matches
// the active status filter (all / reading / unread / finished) based on
// each book's saved media progress. Extracted from four verbatim copies
// that previously lived inline in each tab component.
import type { LibraryItem, MediaProgress } from '../state/onyx';

export function groupMatchesFilter(
  books: LibraryItem[],
  filter: string,
  mediaProgress: MediaProgress[],
): boolean {
  // 'all' always matches — show every group regardless of progress
  if (filter === 'all') return true;

  // 'reading' — at least one book in the group is in progress (started but not finished)
  if (filter === 'reading') return books.some(b => {
    const p = mediaProgress.find(x => x.libraryItemId === b.id);
    return Boolean(p && p.progress > 0 && !p.isFinished);
  });

  // 'unread' — at least one book has no progress entry or progress is exactly 0
  if (filter === 'unread') return books.some(b => {
    const p = mediaProgress.find(x => x.libraryItemId === b.id);
    return !p || p.progress === 0;
  });

  // 'finished' — every book in the group must be marked finished
  // (uses .every so a mixed group with unfinished books is excluded)
  if (filter === 'finished') return books.every(b => {
    const p = mediaProgress.find(x => x.libraryItemId === b.id);
    return p?.isFinished === true;
  });

  // Unknown filter value — default to showing the group
  return true;
}

// ── Advanced filters (tags / language / explicit) ───────────────────────────────

export interface AdvFilter {
  tags: string[];
  tagMode: 'include' | 'exclude';
  language: string;                       // '' = any
  explicit: 'all' | 'explicit' | 'clean';
}

export const EMPTY_ADV_FILTER: AdvFilter = { tags: [], tagMode: 'include', language: '', explicit: 'all' };

/** True when any advanced filter is set (so the shelf knows to apply it). */
export function advFilterActive(f: AdvFilter): boolean {
  return f.tags.length > 0 || f.language !== '' || f.explicit !== 'all';
}

/** Whether a single book passes the advanced filters. */
export function bookMatchesAdvFilter(b: LibraryItem, f: AdvFilter): boolean {
  if (f.tags.length > 0) {
    const bookTags = b.media.tags ?? [];
    const hasAny = f.tags.some(t => bookTags.includes(t));
    if (f.tagMode === 'include' && !hasAny) return false;
    if (f.tagMode === 'exclude' && hasAny) return false;
  }
  if (f.language && (b.media.metadata.language ?? '') !== f.language) return false;
  if (f.explicit !== 'all') {
    const isExplicit = !!(b.media.metadata as unknown as { explicit?: boolean }).explicit;
    if (f.explicit === 'explicit' && !isExplicit) return false;
    if (f.explicit === 'clean' && isExplicit) return false;
  }
  return true;
}

// ── Natural title sorting ───────────────────────────────────────────────────────

/** Strip a leading sort-ignore prefix (e.g. "The ", "A ") from a title. */
function stripSortPrefix(title: string, prefixes: string[]): string {
  const lower = title.toLowerCase();
  for (const p of prefixes) {
    const pref = `${p.toLowerCase()} `;
    if (lower.startsWith(pref)) return title.slice(pref.length);
  }
  return title;
}

/** Numeric-aware ("Book 2" < "Book 10") title comparison that honors the server's
 *  sort-ignore prefixes. Pass an empty `prefixes` array to disable prefix stripping. */
export function naturalTitleCompare(a: string, b: string, prefixes: string[]): number {
  return stripSortPrefix(a, prefixes).localeCompare(
    stripSortPrefix(b, prefixes), undefined, { numeric: true, sensitivity: 'base' },
  );
}

// ── Scoped search ───────────────────────────────────────────────────────────────

export type SearchScope = 'all' | 'title' | 'author' | 'series';

/** Whether a book matches `query` within the chosen field scope. Pure (takes the
 *  already-resolved field strings) to avoid a circular import on the book helpers. */
export function searchScopeMatch(query: string, scope: SearchScope, title: string, author: string, series: string): boolean {
  const q = query.toLowerCase();
  const t = title.toLowerCase().includes(q);
  const a = author.toLowerCase().includes(q);
  const s = series.toLowerCase().includes(q);
  return scope === 'title' ? t : scope === 'author' ? a : scope === 'series' ? s : (t || a || s);
}
