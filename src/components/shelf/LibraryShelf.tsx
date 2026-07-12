import React, { useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { log } from '../../lib/log';
import type { OnyxState, LibraryItem } from '../../state/onyx';
import { getSeriesItems } from '../../api/abs';
import {
  bookTitle, bookAuthor, bookSeries, bookNarrator, bookGenre,
  bookGenres, bookPublisher, bookDur, bookDurSecs, bookProgress,
} from '../../state/onyx';
import Glass from '../chrome/Glass';
import Cover from '../Cover';
import Icon from '../Icon';
import SortIndicator from './SortIndicator';
import ContextMenu from '../ContextMenu';
import { buildItemContextMenu } from './buildItemContextMenu';
import { advFilterActive, bookMatchesAdvFilter, naturalTitleCompare, searchScopeMatch } from '../../lib/shelfFilters';
import MatchModal, { makeLocalShelfAdapter } from '../MatchModal';
import MetadataEditor from '../MetadataEditor';
import CoverPicker from '../CoverPicker';
import CollectionPicker from '../CollectionPicker';
import PlaylistPicker from '../PlaylistPicker';
import FilesModal from './FilesModal';
import ShareModal from '../ShareModal';
import { shelfScrollDecision } from './scrollState';
import { recentlyAddedItems } from '../../lib/recentlyAdded';
// Shared series group key — the same normalization the client-derived Series
// views (local + combined) use to build their groups, so drill-ins match.
import { seriesGroupName } from './tabs/SeriesView';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const MONO = "'JetBrains Mono', ui-monospace, monospace";

export const COVER_SIZES: Record<string, number> = { S: 80, M: 96, L: 116, XL: 148, XXL: 180, XXXL: 220 };

// Virtualization layout constants.
const GRID_GAP = 14;     // px gap between grid tiles (matches the original auto-fill layout)
const GRID_PAD_X = 18;   // px horizontal padding on the scroll container in grid view
const LIST_ROW_H = 68;   // px fixed list-row height (also the virtualizer's estimateSize)
// Shared column template used by both the list header and every list row so the
// columns stay aligned even though they are now separate DOM subtrees (the header
// lives outside the virtualizer; rows are absolutely positioned inside it).
const LIST_GRID = '48px minmax(0,2.4fr) minmax(0,1.4fr) minmax(0,1.2fr) minmax(0,1.4fr) 84px';

function seriesNameOf(s: string | undefined) { return (s || '').split(' · ')[0]; }
// Volume number from the flat series string — legacy " · n" display form or
// ABS's "Name #n" seriesName form (the shape name-based drill-ins carry).
function seriesVolOf(s: string | undefined)  {
  const legacy = parseInt((s || '').split(' · ')[1] || '0', 10);
  if (legacy) return legacy;
  const m = (s || '').match(/#([\d.]+)/);
  return m ? parseFloat(m[1]) || 0 : 0;
}

// Diagnostic guard (Library Virtualization bug report, 2026-07-08): a
// non-empty dataset with an empty virtual window IS the sporadic blank-shelf
// failure — capture the geometry so the next field report is definitive.
function useEmptyWindowDiag(
  view: 'grid' | 'list',
  bookCount: number,
  windowCount: number,
  totalSize: number,
  // The virtualizer's OWN viewport height at the offending render (getSize()).
  // Captured during render — unlike the DOM clientHeight below, which is read in
  // this post-paint effect at a later instant — so the two are not simultaneous.
  // outerSize === 0 here is the definitive signature of the first-render/unmeasured
  // rect blank; a positive outerSize with 0 rows would point elsewhere.
  outerSize: number,
  scrollRef: React.RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    if (bookCount > 0 && windowCount === 0) {
      log.warn('library', 'virtualizer window empty for non-empty shelf', {
        view,
        books: bookCount,
        totalSize,
        outerSize,
        scrollTop: scrollRef.current?.scrollTop ?? -1,
        clientHeight: scrollRef.current?.clientHeight ?? -1,
      });
    }
  }, [view, bookCount, windowCount, totalSize, outerSize, scrollRef]);
}

type SortDir = 'asc' | 'desc';
interface SortState { col: string; dir: SortDir }

const COLS = [
  { id: 'title',    label: 'Title',    align: 'left'  as const },
  { id: 'author',   label: 'Author',   align: 'left'  as const },
  { id: 'genre',    label: 'Genre',    align: 'left'  as const },
  { id: 'narrator', label: 'Narrator', align: 'left'  as const },
  { id: 'duration', label: 'Duration', align: 'right' as const },
];

function getVal(b: LibraryItem, key: string): string | number {
  switch (key) {
    case 'title':    return bookTitle(b);
    case 'author':   return bookAuthor(b);
    case 'genre':    return bookGenre(b);
    case 'narrator': return bookNarrator(b);
    case 'duration': return bookDurSecs(b);
    default:         return '';
  }
}

function ShelfEmptyState({ st }: { st: OnyxState }) {
  const libraryEmpty = st.library.length === 0;
  const isLocal = st.activeLibrary?.source === 'local';
  const isCombined = st.activeLibrary?.source === 'all';

  if (libraryEmpty) {
    return (
      <div style={{ padding: '58px 24px', textAlign: 'center' }}>
        <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--onyx-accent)', marginBottom: 9 }}>
          {isCombined ? 'All libraries' : isLocal ? 'This PC library' : 'Server library'}
        </div>
        <div style={{ fontFamily: SERIF, fontSize: 17, color: 'var(--onyx-text-dim)' }}>
          {isCombined ? 'No books were found across your libraries.' : isLocal ? 'No books on this PC shelf yet.' : 'No books in this Audiobookshelf library yet.'}
        </div>
        <div style={{ marginTop: 7, fontSize: 11.5, lineHeight: 1.5, color: 'var(--onyx-text-mute)' }}>
          {isCombined
            ? 'Add books to a source library, then return here to search everything together.'
            : isLocal
            ? 'Use Add books above to choose files or a folder, or open the watched Staging folder.'
            : st.canUpload
              ? 'Use Upload above to add books to the server, or scan the library from Audiobookshelf.'
              : 'Add or scan books on the Audiobookshelf server, then refresh this library.'}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--onyx-text-mute)', fontFamily: SERIF, fontSize: 16, fontStyle: 'italic' }}>
      {st.search ? <>No titles match &ldquo;{st.search}&rdquo;.</> : 'No titles match the current filters.'}
    </div>
  );
}

function ItemSourceBadge({ item }: { item: LibraryItem }) {
  return (
    <span style={{ flexShrink: 0, fontFamily: MONO, fontSize: 8, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--onyx-accent)', opacity: 0.82 }}>
      {item.localPath ? 'This PC' : 'Server'}
    </span>
  );
}

function ShelfList({ books, st, openBook, onContextMenu, onActionMenu, scrollRef }: {
  books: LibraryItem[];
  st: OnyxState;
  openBook: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, item: LibraryItem) => void;
  onActionMenu: (trigger: HTMLElement, item: LibraryItem) => void;
  // The shared scroll container, provided by the parent. The virtualizer must
  // observe the real scrolling element rather than a wrapper of its own.
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [sort, setSort] = useState<SortState | null>(null);

  const onHeader = (col: string) => {
    if (sort?.col === col) setSort({ col, dir: sort.dir === 'asc' ? 'desc' : 'asc' });
    else setSort({ col, dir: 'asc' });
  };

  const sorted = useMemo(() => {
    if (!sort) return books;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return books.slice().sort((a, b) => {
      const av = getVal(a, sort.col);
      const bv = getVal(b, sort.col);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [books, sort]);

  // One virtual item per book. Fixed-height rows, so estimateSize is exact.
  //
  // initialRect.height carries a POSITIVE FLOOR (|| 800), and this is the crux of
  // the blank-shelf fix. A freshly-constructed virtualizer computes its visible
  // range from options.initialRect DURING the first render body — BEFORE its
  // layout-effect measures the real element — and the virtual-core default rect is
  // {0,0}. With height 0, outerSize is 0 and calculateRange() returns [] over the
  // fully-measured list: getVirtualItems() is empty for one frame. Formerly the
  // child was remounted per pill flip (key={shelfKey}), so that one-frame blank
  // recurred continuously under rapid flipping and read as a persistent blank
  // (diagnosed via useEmptyWindowDiag: books 198, totalSize 13464, scrollTop 0,
  // yet 0 rows — outerSize was 0). `scrollRef.current` is also null during the
  // first render (the ref attaches at commit), so reading clientHeight there gives
  // 0 too — hence a hardcoded floor, not just the live read. Any over-estimate is
  // corrected to the true height by the ResizeObserver on the next frame; the
  // guarantee is only that a non-empty list can NEVER yield an empty window.
  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LIST_ROW_H,
    overscan: 5,
    initialRect: { width: scrollRef.current?.clientWidth || 0, height: scrollRef.current?.clientHeight || 800 },
    initialOffset: scrollRef.current?.scrollTop ?? 0,
  });

  // getSize() (the virtualizer's own measured viewport) is typed private but exists
  // at runtime; read via a narrow cast so the diagnostic can log it (see the note in
  // useEmptyWindowDiag). Read during render, on purpose.
  useEmptyWindowDiag('list', sorted.length, virtualizer.getVirtualItems().length, virtualizer.getTotalSize(), (virtualizer as unknown as { getSize(): number }).getSize(), scrollRef);

  if (sorted.length === 0) {
    return <ShelfEmptyState st={st} />;
  }

  const TRUNC: React.CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

  return (
    <div style={{ width: '100%', minWidth: 0 }}>
      {/* Header row — deliberately kept OUTSIDE the virtualizer so the column
          labels and sort controls stay mounted while the body scrolls. Uses the
          same grid template as the rows for column alignment. */}
      <div style={{
        display: 'grid', gridTemplateColumns: LIST_GRID, columnGap: 14, alignItems: 'end',
        padding: '4px 12px 10px', borderBottom: '1px solid var(--onyx-line)',
        borderLeft: '2px solid transparent', boxSizing: 'border-box',
      }}>
        <div />{/* cover column spacer */}
        {COLS.map(c => {
          const active = sort?.col === c.id;
          return (
            <button key={c.id} onClick={() => onHeader(c.id)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              justifySelf: c.align === 'right' ? 'end' : 'start',
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase',
              color: active ? 'var(--onyx-accent)' : 'var(--onyx-text-mute)',
              whiteSpace: 'nowrap',
            }}>
              {c.label}
              <SortIndicator active={active} dir={sort?.dir ?? 'asc'} />
            </button>
          );
        })}
      </div>

      {/* Virtualized body: position:relative with an explicit height equal to the
          virtualizer's total size; each visible row is absolutely positioned at
          its computed offset. Only getVirtualItems() rows are rendered. */}
      <div style={{ position: 'relative', width: '100%', height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map(vi => {
          const b = sorted[vi.index];
          const i = vi.index;
          const active = b.id === (st.focusedBookId ?? st.currentBookId);
          const prog = bookProgress(b, st.mediaProgress);
          // Cached once per row — used for both badge presence and server-deleted variant.
          const dlRecord = st.downloads.find(d => d.itemId === b.id);
          return (
            <div
              key={b.id}
              onClick={() => openBook(b.id)}
              onContextMenu={e => onContextMenu(e, b)}
              className="onyx-row"
              style={{
                position: 'absolute', top: vi.start, left: 0, width: '100%', height: LIST_ROW_H,
                display: 'grid', gridTemplateColumns: LIST_GRID, columnGap: 14, alignItems: 'center',
                padding: '0 12px', boxSizing: 'border-box',
                background: active ? 'var(--onyx-accent-dim)' : (i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)'),
                borderTop: i > 0 ? '1px solid var(--onyx-line)' : undefined,
                borderLeft: active ? '2px solid var(--onyx-accent)' : '2px solid transparent',
                cursor: 'pointer',
              }}
            >
              <button
                type="button"
                className="onyx-item-actions"
                aria-label={`Actions for ${bookTitle(b)}`}
                aria-haspopup="menu"
                title={`Actions for ${bookTitle(b)}`}
                onClick={(event) => { event.stopPropagation(); onActionMenu(event.currentTarget, b); }}
                style={{ position: 'absolute', top: '50%', right: 8, transform: 'translateY(-50%)', zIndex: 4, width: 28, height: 28, borderRadius: 6, border: '1px solid var(--onyx-glass-edge)', background: 'var(--onyx-panel2)', color: 'var(--onyx-text)', cursor: 'pointer', fontFamily: MONO, lineHeight: 1 }}
              >•••</button>
              {/* Cover */}
              <div style={{ position: 'relative', display: 'inline-block', justifySelf: 'start' }}>
                <Cover item={b} size={40} serverUrl={st.serverUrl} />
                {st.showProgressOverlay && prog > 0 && (
                  <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, background: 'rgba(0,0,0,0.4)' }}>
                    <div style={{ width: `${prog * 100}%`, height: '100%', background: 'var(--onyx-accent)' }} />
                  </div>
                )}
                {/* Downloaded badge — brass ↓ when available; amber ! when server-deleted */}
                {dlRecord && (
                  <div
                    title={dlRecord.serverDeleted ? 'No longer on server — local copy only' : 'Available offline'}
                    style={{
                      position: 'absolute', bottom: st.showProgressOverlay && prog > 0 ? 4 : 2, right: 1,
                      zIndex: 3,
                      background: 'rgba(0,0,0,0.72)', borderRadius: 2,
                      padding: '1px 3px',
                      display: 'inline-flex', alignItems: 'center',
                      // Amber when the server has removed the book; brass when still on server.
                      color: dlRecord.serverDeleted ? '#d4834a' : 'var(--onyx-accent)',
                      fontSize: 8, fontFamily: MONO,
                      lineHeight: 1, userSelect: 'none',
                    }}>
                    {dlRecord.serverDeleted ? '!' : '↓'}
                  </div>
                )}
              </div>
              {/* Title + series */}
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, minWidth: 0 }}>
                  <div style={{ ...TRUNC, minWidth: 0, fontFamily: SERIF, fontSize: 14.5, fontWeight: 500, color: active ? 'var(--onyx-accent)' : 'var(--onyx-text)', lineHeight: 1.2 }}>{bookTitle(b)}</div>
                  {st.activeLibrary?.source === 'all' && <ItemSourceBadge item={b} />}
                </div>
                {bookSeries(b) && (
                  <div style={{ ...TRUNC, marginTop: 2, fontFamily: MONO, fontSize: 9.5, color: 'var(--onyx-text-mute)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{bookSeries(b)}</div>
                )}
              </div>
              {/* Author */}
              <div style={{ ...TRUNC, minWidth: 0, fontSize: 12.5, color: 'var(--onyx-text-dim)' }}>{bookAuthor(b)}</div>
              {/* Genre */}
              <div style={{ minWidth: 0 }}>
                {bookGenre(b) ? (
                  <span style={{
                    display: 'inline-block', padding: '2px 8px', borderRadius: 999,
                    background: 'var(--onyx-glass)', border: '1px solid var(--onyx-glass-edge)',
                    fontFamily: MONO, fontSize: 9.5, color: 'var(--onyx-text-dim)', letterSpacing: '0.06em', textTransform: 'uppercase',
                    maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'middle',
                  }}>{bookGenre(b)}</span>
                ) : <span style={{ color: 'var(--onyx-text-mute)' }}>—</span>}
              </div>
              {/* Narrator */}
              <div style={{ minWidth: 0 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%', overflow: 'hidden' }}>
                  <span style={{ display: 'inline-flex', color: 'var(--onyx-text-mute)', flexShrink: 0 }}>
                    <Icon name="headphones" size={11} />
                  </span>
                  <span style={{ ...TRUNC, fontSize: 12.5, color: 'var(--onyx-text-dim)' }}>{bookNarrator(b)}</span>
                </span>
              </div>
              {/* Duration */}
              <div style={{ justifySelf: 'end', fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', textAlign: 'right', whiteSpace: 'nowrap' }}>{bookDur(b)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ShelfGrid({ books, st, coverW, selectedId, openBook, onContextMenu, onActionMenu, scrollRef }: {
  books: LibraryItem[];
  st: OnyxState;
  coverW: number;
  selectedId: string | null;
  openBook: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, item: LibraryItem) => void;
  onActionMenu: (trigger: HTMLElement, item: LibraryItem) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  // Virtualization needs an explicit column count up front. CSS `auto-fill`
  // computes that internally and never exposes it, so we measure the scroll
  // container ourselves and reproduce the same packing math.
  const colsFor = useCallback((el: HTMLDivElement | null) => {
    if (!el) return 1;
    // clientWidth includes the scroll container's horizontal padding; subtract it
    // to get the usable track width, then apply the auto-fill packing formula
    // `floor((W + gap) / (coverW + gap))`.
    const inner = el.clientWidth - GRID_PAD_X * 2;
    return Math.max(1, Math.floor((inner + GRID_GAP) / (coverW + GRID_GAP)));
  }, [coverW]);

  // Seed the column count synchronously from the already-mounted scroll container
  // on (re)mount. Starting at a hardcoded 1 made a fresh grid lay out as one tall
  // column until the measure effect ran — a visible flash on every pill flip, and
  // part of the same remount race that blanked the shelf. On the first-ever mount
  // scrollRef is null → 1, then measure() corrects it.
  const [columnCount, setColumnCount] = useState(() => colsFor(scrollRef.current));

  const measure = useCallback(() => {
    setColumnCount(colsFor(scrollRef.current));
  }, [colsFor, scrollRef]);

  // Recompute on mount, on cover-size change, and whenever the container resizes.
  useEffect(() => {
    measure();
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  // Row-grouping strategy: the grid is virtualized by ROW, not by tile. We chunk
  // the flat, already-sorted/filtered book list into rows of `columnCount`. The
  // virtualizer then counts rows, and each rendered row paints its own slice of
  // books — keeping the live DOM node count proportional to the visible rows
  // rather than to the entire library.
  const rows = useMemo(() => {
    const out: LibraryItem[][] = [];
    for (let i = 0; i < books.length; i += columnCount) {
      out.push(books.slice(i, i + columnCount));
    }
    return out;
  }, [books, columnCount]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    // Square cover (coverW tall) plus ~35px of title/author text and the row gap.
    estimateSize: () => coverW + 50,
    overscan: 3,
    // Positive height floor (|| 800) so an unmeasured/first-render virtualizer can
    // never compute outerSize 0 and blank a non-empty grid. See the full note in
    // ShelfList. (Blank-shelf bug, useEmptyWindowDiag.)
    initialRect: { width: scrollRef.current?.clientWidth || 0, height: scrollRef.current?.clientHeight || 800 },
    initialOffset: scrollRef.current?.scrollTop ?? 0,
  });

  useEmptyWindowDiag('grid', books.length, virtualizer.getVirtualItems().length, virtualizer.getTotalSize(), (virtualizer as unknown as { getSize(): number }).getSize(), scrollRef);

  if (books.length === 0) {
    return <ShelfEmptyState st={st} />;
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map(vi => {
        const rowBooks = rows[vi.index];
        return (
          <div
            key={vi.index}
            style={{
              position: 'absolute', top: vi.start, left: 0, width: '100%',
              // Same template as the original `repeat(auto-fill, minmax(coverW, 1fr))`
              // grid, pinned to the measured column count. Partial last rows leave
              // empty tracks, so every row's columns line up identically.
              display: 'grid', gridTemplateColumns: `repeat(${columnCount}, minmax(${coverW}px, 1fr))`, gap: GRID_GAP,
            }}
          >
            {rowBooks.map(b => {
              const prog = bookProgress(b, st.mediaProgress);
              // Cached once per tile — used for both badge presence and server-deleted variant.
              const dlRecord = st.downloads.find(d => d.itemId === b.id);
              return (
                <div key={b.id} className="onyx-item-wrap" style={{ position: 'relative', minWidth: 0 }}>
                <button onClick={() => openBook(b.id)} onContextMenu={e => onContextMenu(e, b)} className="onyx-tile" style={{ width: '100%', position: 'relative', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', color: 'inherit' }}>
                  <div style={{
                    position: 'relative',
                    display: 'inline-block',
                    overflow: 'hidden',
                    borderRadius: 4,
                    transform: b.id === selectedId ? 'translateY(-4px)' : 'none',
                    // box-shadow (not filter: drop-shadow) for the selected lift: a
                    // child `filter` spawns its own compositing layer and forces the
                    // enclosing backdrop-filter panel to re-sample a narrow sub-rect on
                    // click — the source of the vertical banding. box-shadow is a plain
                    // paint with the same visual and no backdrop re-sample.
                    boxShadow: b.id === selectedId ? '0 12px 24px rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.35)' : 'none',
                    transition: 'transform 0.15s, box-shadow 0.15s',
                  }}>
                    <Cover item={b} size={coverW} serverUrl={st.serverUrl} />
                    {b.id === selectedId && (
                      <div style={{ position: 'absolute', inset: 0, border: '2px solid var(--onyx-accent)', borderRadius: 4, pointerEvents: 'none', zIndex: 2 }} />
                    )}
                    {st.showProgressOverlay && prog > 0 && (
                      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, background: 'rgba(0,0,0,0.4)' }}>
                        <div style={{ width: `${prog * 100}%`, height: '100%', background: 'var(--onyx-accent)' }} />
                      </div>
                    )}
                    {/* Downloaded badge — brass ↓ when available; amber ! when server-deleted */}
                    {dlRecord && (
                      <div
                        title={dlRecord.serverDeleted ? 'No longer on server — local copy only' : 'Available offline'}
                        style={{
                          position: 'absolute', bottom: st.showProgressOverlay && prog > 0 ? 6 : 4, right: 4,
                          zIndex: 3,
                          background: 'rgba(0,0,0,0.72)', borderRadius: 3,
                          padding: '1px 4px',
                          display: 'inline-flex', alignItems: 'center',
                          // Amber when the server has removed the book; brass when still on server.
                          color: dlRecord.serverDeleted ? '#d4834a' : 'var(--onyx-accent)',
                          fontSize: 9, fontFamily: MONO,
                          lineHeight: 1, userSelect: 'none',
                        }}>
                        {dlRecord.serverDeleted ? '!' : '↓'}
                      </div>
                    )}
                  </div>
                  <div style={{ marginTop: 7, fontSize: 11.5, fontWeight: 500, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--onyx-text)' }}>{bookTitle(b)}</div>
                  <div style={{ marginTop: 1, display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
                    <span style={{ minWidth: 0, fontSize: 10.5, color: 'var(--onyx-text-mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bookAuthor(b)}</span>
                    {st.activeLibrary?.source === 'all' && <ItemSourceBadge item={b} />}
                  </div>
                </button>
                <button
                  type="button"
                  className="onyx-item-actions"
                  aria-label={`Actions for ${bookTitle(b)}`}
                  aria-haspopup="menu"
                  title={`Actions for ${bookTitle(b)}`}
                  onClick={(event) => onActionMenu(event.currentTarget, b)}
                  style={{ position: 'absolute', top: 6, right: 6, zIndex: 4, width: 28, height: 28, borderRadius: 6, border: '1px solid var(--onyx-glass-edge)', background: 'rgba(12,12,15,0.9)', color: 'var(--onyx-text)', cursor: 'pointer', fontFamily: MONO, lineHeight: 1 }}
                >•••</button>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export interface LibraryShelfProps {
  st: OnyxState;
  /** Optional source subset used by derived shelves such as Recently Added. */
  items?: LibraryItem[];
  /** Override Home's saved sort without changing the user's preference. */
  sortMode?: string;
  /** Derived shelves can opt out of Home's series collapsing. */
  groupBySeries?: boolean;
}

interface CtxMenu { x: number; y: number; item: LibraryItem }

export default function LibraryShelf({ st, items, sortMode, groupBySeries }: LibraryShelfProps) {
  const coverW = COVER_SIZES[st.coverSize] ?? COVER_SIZES.L;
  const [contextMenu, setContextMenu] = useState<CtxMenu | null>(null);

  const [matchItem, setMatchItem] = useState<LibraryItem | null>(null);
  const [collectionItem, setCollectionItem] = useState<LibraryItem | null>(null);
  const [filesItem, setFilesItem] = useState<LibraryItem | null>(null);
  const [playlistItem, setPlaylistItem] = useState<LibraryItem | null>(null);
  const [editItem, setEditItem] = useState<LibraryItem | null>(null);
  const [coverItem, setCoverItem] = useState<LibraryItem | null>(null);
  const [shareItem, setShareItem] = useState<LibraryItem | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Ref to the inner scroll container — required by the virtualizer, which must
  // attach to the real scrolling element (see the JSX comment below for why this
  // is a plain div inside Glass rather than Glass itself).
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollWriteRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Books for the active series filter, fetched server-side via get_series_items.
  // st.library books lack series IDs (minified shape), so client-side series matching is not possible.
  const [seriesBooks, setSeriesBooks] = useState<LibraryItem[] | null>(null);

  useEffect(() => {
    const f = st.contextFilter;
    if (f?.kind === 'series' && f.seriesId && st.serverUrl && st.currentLibraryId) {
      // Fetch this series' books directly from the server using the verified Base64 filter command.
      getSeriesItems(st.serverUrl, st.currentLibraryId, f.seriesId)
        .then(setSeriesBooks)
        // Resolve to an empty list on failure so the shelf shows "no titles"
        // rather than sitting on the loading placeholder forever.
        .catch(e => { log.warn('library', 'series items fetch failed', { err: String(e) }); setSeriesBooks([]); });
    } else {
      setSeriesBooks(null);
    }
  }, [st.contextFilter, st.serverUrl, st.currentLibraryId]); // eslint-disable-line react-hooks/exhaustive-deps

  const onContextMenu = (e: React.MouseEvent, item: LibraryItem) => {
    e.preventDefault();
    setSelectedId(item.id);
    st.setFocusedBookId(item.id);
    // clientX/Y, not pageX/Y: the menu is position:fixed (viewport-anchored),
    // and its edge-flip math compares against window.innerWidth/Height.
    setContextMenu({ x: e.clientX, y: e.clientY, item });
  };

  // When a series filter carries a server series ID, use the server-fetched
  // list (empty array while loading) — st.library's minified ABS items lack
  // series IDs, so ID matching must go through the filter endpoint. A filter
  // WITHOUT an ID comes from the client-derived series views (local libraries
  // and the combined All Libraries shelf), where the normalized seriesName IS
  // the group key — match it directly over the loaded items.
  const baseBooks = items ?? st.library;
  const effectiveSort = sortMode ?? st.librarySort;
  const effectiveGroupBySeries = groupBySeries ?? st.groupBySeries;
  const sourceBooks = (st.contextFilter?.kind === 'series')
    ? (st.contextFilter.seriesId
        ? (seriesBooks ?? [])
        : baseBooks.filter(b => seriesGroupName(bookSeries(b)) === st.contextFilter?.value))
    : baseBooks;
  // In-flight series drill-in: the body source is deliberately empty while the
  // server fetch resolves, so show a loading placeholder instead of the
  // misleading "No titles match" empty state (UI Bugs Follow-up, 2026-07-08).
  // Name-based drill-ins resolve synchronously and never show it.
  const seriesLoading = st.contextFilter?.kind === 'series' && !!st.contextFilter.seriesId && seriesBooks === null;

  const filtered = sourceBooks.filter(b => {
    if (st.contextFilter) {
      const { kind, value, bookIds } = st.contextFilter;
      // Series filtering is handled by sourceBooks selection above — do not re-filter here.
      if (kind === 'author'     && bookAuthor(b)   !== value)                return false;
      if (kind === 'narrator'   && bookNarrator(b) !== value)                return false;
      if (kind === 'genre'      && !bookGenres(b).includes(value))           return false;
      if (kind === 'publisher'  && bookPublisher(b) !== value)               return false;
      if ((kind === 'collection' || kind === 'playlist') && !(bookIds ?? []).includes(b.id)) return false;
    }
    if (advFilterActive(st.advFilter) && !bookMatchesAdvFilter(b, st.advFilter)) return false;
    const prog = bookProgress(b, st.mediaProgress);
    if (!st.showFinished && prog >= 0.98 && st.filter !== 'finished') return false;
    if (st.filter === 'reading'  && !prog)      return false;
    if (st.filter === 'unread'   &&  prog)      return false;
    if (st.filter === 'finished' &&  prog < 0.98) return false;
    if (st.search && !searchScopeMatch(st.search, st.searchScope, bookTitle(b), bookAuthor(b), bookSeries(b) || '')) return false;
    return true;
  });

  if (st.contextFilter?.kind === 'playlist') {
    // Sort by the playlist's item order, not the library's default sort.
    const order = st.contextFilter.bookIds ?? [];
    filtered.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  } else if (st.contextFilter?.kind === 'series') {
    filtered.sort((a, b) => seriesVolOf(bookSeries(a)) - seriesVolOf(bookSeries(b)));
  } else if (effectiveSort === 'recently') {
    filtered.splice(0, filtered.length, ...recentlyAddedItems(filtered, filtered.length));
  } else if (effectiveSort === 'title') {
    const prefixes = st.serverSettings?.sortingIgnorePrefix ? (st.serverSettings.sortingPrefixes ?? []) : [];
    filtered.sort((a, b) => naturalTitleCompare(bookTitle(a), bookTitle(b), prefixes));
  } else if (effectiveSort === 'author') {
    filtered.sort((a, b) => bookAuthor(a).localeCompare(bookAuthor(b)) || bookTitle(a).localeCompare(bookTitle(b)));
  } else if (effectiveSort === 'most-listened') {
    filtered.sort((a, b) => bookProgress(b, st.mediaProgress) - bookProgress(a, st.mediaProgress));
  }

  let shelfBooks = filtered;
  if (effectiveGroupBySeries && st.contextFilter?.kind !== 'series') {
    const seen = new Set<string>();
    shelfBooks = filtered.filter(b => {
      const name = seriesNameOf(bookSeries(b));
      if (!name) return true;
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    });
  }

  // Identity of the current dataset (Library Virtualization bug report,
  // 2026-07-08). Beyond the filter controls, it carries a cheap result-set
  // signature (count + first/last ids) so changes the controls can't see —
  // a series fetch landing, a library switch/reload, sort or grouping — still
  // register as a new dataset.
  const datasetKey = [
    st.currentLibraryId,
    st.shelfTab,
    st.filter,
    st.showFinished,
    effectiveSort,
    effectiveGroupBySeries,
    st.contextFilter?.kind ?? '',
    st.contextFilter?.value ?? '',
    st.search,
    // Advanced filters change the dataset — include them so a scroll reset fires.
    JSON.stringify(st.advFilter),
    // Include bookIds so a playlist reorder is seen as a new result set.
    (st.contextFilter?.bookIds ?? []).join(','),
    shelfBooks.length,
    shelfBooks[0]?.id ?? '',
    shelfBooks[shelfBooks.length - 1]?.id ?? '',
  ].join('|');
  // shelfKey is the scroll-reset trigger (view mode + cover size + dataset
  // identity). It no longer remounts the virtualized child — see the JSX note.
  const shelfKey = `${st.libraryView}|${coverW}|${datasetKey}`;

  // Scroll handling for the persistent scroll container (which now survives every
  // dataset change, since the virtualizer is no longer remounted). Two cases:
  //  • View identity changed (library / grid|list / filter / context / search):
  //    restore the remembered scroll position for that view.
  //  • Same view, different result set (sort / group / hide-finished / advanced
  //    filter, or an async series fetch landing): scroll to the top so the new
  //    ordering shows from its start and an inherited scrollTop can't strand the
  //    viewport mid-list. Layout effect so it lands before paint.
  const scrollStorageKey = `onyx.shelf.scroll.${st.currentLibraryId}.${st.shelfTab}.${st.libraryView}.${st.filter}.${st.contextFilter?.kind ?? ''}.${st.contextFilter?.value ?? ''}.${st.search}`;
  const prevViewScrollKey = useRef<string | null>(null);
  const pendingScrollRestoreKey = useRef<string | null>(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const decision = shelfScrollDecision(
      prevViewScrollKey.current,
      scrollStorageKey,
      pendingScrollRestoreKey.current,
      st.libraryLoading,
      localStorage.getItem(scrollStorageKey),
    );
    prevViewScrollKey.current = scrollStorageKey;
    pendingScrollRestoreKey.current = decision.pendingRestoreKey;
    if (decision.top !== null) el.scrollTo({ top: decision.top });
  }, [shelfKey, scrollStorageKey, st.libraryLoading]);
  useEffect(() => () => {
    if (scrollWriteRef.current) clearTimeout(scrollWriteRef.current);
  }, []);
  const persistScroll = () => {
    if (scrollWriteRef.current) clearTimeout(scrollWriteRef.current);
    scrollWriteRef.current = setTimeout(() => {
      if (scrollRef.current) localStorage.setItem(scrollStorageKey, String(scrollRef.current.scrollTop));
    }, 150);
  };

  const onActionMenu = (trigger: HTMLElement, item: LibraryItem) => {
    const rect = trigger.getBoundingClientRect();
    setSelectedId(item.id);
    st.setFocusedBookId(item.id);
    setContextMenu({ x: rect.right, y: rect.bottom + 4, item });
  };

  const openBook = (id: string) => {
    if (selectedId === id) {
      st.setScreen('player');
    } else {
      setSelectedId(id);
      st.setFocusedBookId(id);
    }
  };

  return (
    <Glass
      translucent={st.translucent}
      style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
    >
      {/* Inner scroll container. The TanStack virtualizer must attach a ref to the
          actual scrolling element, and Glass exposes no forwardRef. Rather than
          alter Glass, the scrolling happens on this plain div: overflow:auto +
          flex:1 fill the (now overflow:hidden) Glass card, and scrollRef points
          here. Padding moved off Glass and onto this element. */}
      <div
        ref={scrollRef}
        onScroll={persistScroll}
        style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: st.libraryView === 'list' ? '12px 14px' : '20px 18px' }}
      >
        {/* The virtualized child is NOT remounted per dataset change (no key). An
            earlier design keyed it on the dataset to force a "fresh" virtualizer,
            reasoning that the stable-size scroll container's ResizeObserver would
            latch a stale rect. That was backwards: a stable container keeps a
            correct once-measured rect, and the remount is what actually broke it —
            each fresh virtualizer re-initialises to a 0×0 viewport and depends on
            an async RO callback to recover; flipping pills fast orphans that
            callback, leaving getVirtualItems() empty over a valid list (the
            blank-shelf bug, confirmed via useEmptyWindowDiag). Updating count/data
            in place keeps the virtualizer's RO-synced rect and never blanks. Scroll
            is reset imperatively above instead of via the remount. (The grid/list
            toggle still swaps component TYPE, an intentional one-time remount.) */}
        {seriesLoading ? (
          <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--onyx-text-mute)', fontFamily: SERIF, fontSize: 16, fontStyle: 'italic' }}>
            Loading series…
          </div>
        ) : st.libraryView === 'list' ? (
          <ShelfList books={shelfBooks} st={st} openBook={openBook} onContextMenu={onContextMenu} onActionMenu={onActionMenu} scrollRef={scrollRef} />
        ) : (
          <ShelfGrid books={shelfBooks} st={st} coverW={coverW} selectedId={selectedId} openBook={openBook} onContextMenu={onContextMenu} onActionMenu={onActionMenu} scrollRef={scrollRef} />
        )}
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          sections={buildItemContextMenu(contextMenu.item, st, { setMatchItem, setCollectionItem, setFilesItem, setPlaylistItem, setEditItem, setCoverItem, setShareItem })}
          onClose={() => setContextMenu(null)}
        />
      )}
      {/* The same MatchModal drives both flows; the adapter routes by the active
          library's source. Local items write the catalog + re-file on disk; ABS
          items use the server-backed default adapter. */}
      {matchItem && (
        <MatchModal
          item={matchItem}
          serverUrl={st.serverUrl}
          adapter={matchItem.localPath ? makeLocalShelfAdapter(matchItem) : undefined}
          onClose={() => setMatchItem(null)}
          onComplete={updated => {
            st.updateLibraryItem(updated);
            setMatchItem(null);
          }}
          onRefresh={() => { st.refreshLibrary().catch(e => log.error('library', 'refresh after match failed', { err: String(e) })); }}
        />
      )}
      {editItem && (
        <MetadataEditor
          item={editItem}
          serverUrl={st.serverUrl}
          onClose={() => setEditItem(null)}
          onComplete={updated => {
            st.updateLibraryItem(updated);
            setEditItem(null);
          }}
          onRefresh={() => { st.refreshLibrary().catch(e => log.error('library', 'refresh after metadata edit failed', { err: String(e) })); }}
          onNotice={(message, type) => st.setToast({ message, type })}
        />
      )}
      {coverItem && (
        <CoverPicker
          item={coverItem}
          st={st}
          onClose={() => setCoverItem(null)}
        />
      )}
      {collectionItem && (
        <CollectionPicker
          item={collectionItem}
          serverUrl={st.serverUrl}
          onClose={() => setCollectionItem(null)}
        />
      )}
      {playlistItem && (
        <PlaylistPicker
          item={playlistItem}
          serverUrl={st.serverUrl}
          onClose={() => setPlaylistItem(null)}
        />
      )}
      {filesItem && (
        <FilesModal
          bookId={filesItem.id}
          serverUrl={st.serverUrl}
          onClose={() => setFilesItem(null)}
        />
      )}
      {shareItem && (
        <ShareModal
          item={shareItem}
          st={st}
          onClose={() => setShareItem(null)}
        />
      )}
    </Glass>
  );
}
