// Next-in-series resolution. Shared by the "auto-download next in series"
// download behaviour (Settings → Downloads) and by auto-play-next (see
// `upNext.ts`). Pure functions over the already-loaded library; no network.
// Series metadata lives on `item.media.metadata.series` (a SeriesObject or
// array) with an optional `sequence` that may be a number, a decimal string
// ("1.5"), or absent.
//
// Ordering follows ABS, verified 2026-07-27 against
// `server/utils/queries/libraryItemsBookFilters.js`: series items are ordered by
// `CAST(series.bookSeries.sequence AS FLOAT) ASC NULLS LAST` — a numeric cast,
// NOT a natural/lexicographic sort. `parseFloat` reproduces SQLite's cast for
// the shapes that occur in practice ("1.5" → 1.5, "2a" → 2). It diverges only
// for strings with no leading digits ("a2"), which SQLite casts to 0.0 and we
// treat as sequence-less; advancing *into* an item whose position is ambiguous
// is worse than stopping, so unparseable sequences are never a "next".
import type { LibraryItem, SeriesObject } from '../api/abs';

/** Parse a series sequence to a comparable number, or null when absent/unparseable. */
export function parseSequence(v: SeriesObject['sequence']): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extract an item's primary series ({ name, sequence }), preferring the full
 * series object(s) over the flat seriesName. Returns null when the item is not
 * part of any series.
 */
export function primarySeries(item: LibraryItem): { name: string; sequence: number | null } | null {
  const s = item.media?.metadata?.series;
  const obj: SeriesObject | undefined = Array.isArray(s) ? s[0] : (s ?? undefined);
  if (obj?.name) return { name: obj.name, sequence: parseSequence(obj.sequence) };
  const name = item.media?.metadata?.seriesName;
  if (name) return { name, sequence: null };
  return null;
}

export interface NextInSeriesOptions {
  /** Items already listened to. Skipped, so a partly-read series advances to the
   *  first book the listener has *not* finished rather than replaying one. */
  isFinished?: (item: LibraryItem) => boolean;
  /** Candidate restriction — e.g. offline advance considers downloads only. */
  eligible?: (item: LibraryItem) => boolean;
}

/**
 * Find the next book after `finished` in the same series within `library` — the
 * item with the smallest sequence strictly greater than the finished item's.
 * Returns `undefined` when the finished item has no comparable series sequence,
 * or nothing follows it. (A series with gaps simply takes the next-higher
 * sequence; ties and the finished item itself are skipped.)
 *
 * With `isFinished`/`eligible`, rejected candidates are stepped over rather than
 * ending the search: the next *playable* book is what a listener means by "next".
 */
export function nextInSeries(
  finished: LibraryItem,
  library: LibraryItem[],
  opts: NextInSeriesOptions = {},
): LibraryItem | undefined {
  const cur = primarySeries(finished);
  if (!cur || cur.sequence === null) return undefined;
  let best: { item: LibraryItem; sequence: number } | undefined;
  for (const it of library) {
    if (it.id === finished.id) continue;
    const s = primarySeries(it);
    if (!s || s.name !== cur.name || s.sequence === null) continue;
    if (s.sequence <= cur.sequence) continue;
    if (opts.isFinished?.(it)) continue;
    if (opts.eligible && !opts.eligible(it)) continue;
    if (!best || s.sequence < best.sequence) best = { item: it, sequence: s.sequence };
  }
  return best?.item;
}
