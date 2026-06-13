import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
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
import MatchModal from '../MatchModal';
import MetadataEditor from '../MetadataEditor';
import CoverPicker from '../CoverPicker';
import CollectionPicker from '../CollectionPicker';
import PlaylistPicker from '../PlaylistPicker';
import FilesModal from './FilesModal';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const MONO = "'JetBrains Mono', ui-monospace, monospace";

const COVER_SIZES: Record<string, number> = { S: 80, M: 96, L: 116, XL: 148, XXL: 180, XXXL: 220 };

// Virtualization layout constants.
const GRID_GAP = 14;     // px gap between grid tiles (matches the original auto-fill layout)
const GRID_PAD_X = 18;   // px horizontal padding on the scroll container in grid view
const LIST_ROW_H = 68;   // px fixed list-row height (also the virtualizer's estimateSize)
// Shared column template used by both the list header and every list row so the
// columns stay aligned even though they are now separate DOM subtrees (the header
// lives outside the virtualizer; rows are absolutely positioned inside it).
const LIST_GRID = '48px minmax(0,2.4fr) minmax(0,1.4fr) minmax(0,1.2fr) minmax(0,1.4fr) 84px';

function seriesNameOf(s: string | undefined) { return (s || '').split(' · ')[0]; }
function seriesVolOf(s: string | undefined)  { return parseInt((s || '').split(' · ')[1] || '0', 10); }

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

function ShelfList({ books, st, openBook, onContextMenu, scrollRef }: {
  books: LibraryItem[];
  st: OnyxState;
  openBook: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, item: LibraryItem) => void;
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
  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LIST_ROW_H,
    overscan: 5,
  });

  if (sorted.length === 0) {
    return (
      <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--onyx-text-mute)', fontFamily: SERIF, fontSize: 16, fontStyle: 'italic' }}>
        No titles match &ldquo;{st.search}&rdquo;.
      </div>
    );
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
                <div style={{ ...TRUNC, fontFamily: SERIF, fontSize: 14.5, fontWeight: 500, color: active ? 'var(--onyx-accent)' : 'var(--onyx-text)', lineHeight: 1.2 }}>{bookTitle(b)}</div>
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

function ShelfGrid({ books, st, coverW, selectedId, openBook, onContextMenu, scrollRef }: {
  books: LibraryItem[];
  st: OnyxState;
  coverW: number;
  selectedId: string | null;
  openBook: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, item: LibraryItem) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  // Virtualization needs an explicit column count up front. CSS `auto-fill`
  // computes that internally and never exposes it, so we measure the scroll
  // container ourselves and reproduce the same packing math.
  const [columnCount, setColumnCount] = useState(1);

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // clientWidth includes the scroll container's horizontal padding; subtract it
    // to get the usable track width, then apply the auto-fill packing formula
    // `floor((W + gap) / (coverW + gap))`.
    const inner = el.clientWidth - GRID_PAD_X * 2;
    const cols = Math.max(1, Math.floor((inner + GRID_GAP) / (coverW + GRID_GAP)));
    setColumnCount(cols);
  }, [coverW, scrollRef]);

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
  });

  if (books.length === 0) {
    return (
      <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--onyx-text-mute)', fontFamily: SERIF, fontSize: 16, fontStyle: 'italic' }}>
        No titles match &ldquo;{st.search}&rdquo;.
      </div>
    );
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
                <button key={b.id} onClick={() => openBook(b.id)} onContextMenu={e => onContextMenu(e, b)} className="onyx-tile" style={{ position: 'relative', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', color: 'inherit' }}>
                  <div style={{
                    position: 'relative',
                    display: 'inline-block',
                    overflow: 'hidden',
                    borderRadius: 4,
                    transform: b.id === selectedId ? 'translateY(-4px)' : 'none',
                    filter: b.id === selectedId ? 'drop-shadow(0 12px 24px rgba(212,166,74,0.35))' : 'none',
                    transition: 'transform 0.15s, filter 0.15s',
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
                  <div style={{ marginTop: 1, fontSize: 10.5, color: 'var(--onyx-text-mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bookAuthor(b)}</div>
                </button>
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
}

interface CtxMenu { x: number; y: number; item: LibraryItem }

export default function LibraryShelf({ st }: LibraryShelfProps) {
  const coverW = COVER_SIZES[st.coverSize] ?? COVER_SIZES.L;
  const [contextMenu, setContextMenu] = useState<CtxMenu | null>(null);

  const [matchItem, setMatchItem] = useState<LibraryItem | null>(null);
  const [collectionItem, setCollectionItem] = useState<LibraryItem | null>(null);
  const [filesItem, setFilesItem] = useState<LibraryItem | null>(null);
  const [playlistItem, setPlaylistItem] = useState<LibraryItem | null>(null);
  const [editItem, setEditItem] = useState<LibraryItem | null>(null);
  const [coverItem, setCoverItem] = useState<LibraryItem | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Ref to the inner scroll container — required by the virtualizer, which must
  // attach to the real scrolling element (see the JSX comment below for why this
  // is a plain div inside Glass rather than Glass itself).
  const scrollRef = useRef<HTMLDivElement>(null);

  // Books for the active series filter, fetched server-side via get_series_items.
  // st.library books lack series IDs (minified shape), so client-side series matching is not possible.
  const [seriesBooks, setSeriesBooks] = useState<LibraryItem[] | null>(null);

  useEffect(() => {
    const f = st.contextFilter;
    if (f?.kind === 'series' && f.seriesId && st.serverUrl && st.currentLibraryId) {
      // Fetch this series' books directly from the server using the verified Base64 filter command.
      getSeriesItems(st.serverUrl, st.currentLibraryId, f.seriesId)
        .then(setSeriesBooks)
        .catch(console.error);
    } else {
      setSeriesBooks(null);
    }
  }, [st.contextFilter, st.serverUrl, st.currentLibraryId]); // eslint-disable-line react-hooks/exhaustive-deps

  const onContextMenu = (e: React.MouseEvent, item: LibraryItem) => {
    e.preventDefault();
    setSelectedId(item.id);
    st.setFocusedBookId(item.id);
    setContextMenu({ x: e.pageX, y: e.pageY, item });
  };

  // When a series filter is active, use the server-fetched list (empty array while loading).
  // st.library books carry only the flat seriesName string, not series IDs, so client-side
  // series matching always fails — the server-side filter endpoint is the only correct path.
  const sourceBooks = (st.contextFilter?.kind === 'series') ? (seriesBooks ?? []) : st.library;

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
    console.log('[PLAYLIST-DIAG] shelf sorted by playlist order:', filtered.map(b => bookTitle(b)));
  } else if (st.contextFilter?.kind === 'series') {
    filtered.sort((a, b) => seriesVolOf(bookSeries(a)) - seriesVolOf(bookSeries(b)));
  } else if (st.librarySort === 'title') {
    const prefixes = st.serverSettings?.sortingIgnorePrefix ? (st.serverSettings.sortingPrefixes ?? []) : [];
    filtered.sort((a, b) => naturalTitleCompare(bookTitle(a), bookTitle(b), prefixes));
  } else if (st.librarySort === 'author') {
    filtered.sort((a, b) => bookAuthor(a).localeCompare(bookAuthor(b)) || bookTitle(a).localeCompare(bookTitle(b)));
  } else if (st.librarySort === 'most-listened') {
    filtered.sort((a, b) => bookProgress(b, st.mediaProgress) - bookProgress(a, st.mediaProgress));
  }

  let shelfBooks = filtered;
  if (st.groupBySeries && st.contextFilter?.kind !== 'series') {
    const seen = new Set<string>();
    shelfBooks = filtered.filter(b => {
      const name = seriesNameOf(bookSeries(b));
      if (!name) return true;
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    });
  }

  // Identity of the current dataset. Changing it remounts the virtualized child
  // (list/grid prefix included so a view switch also forces a fresh virtualizer).
  const shelfKey = [
    st.libraryView,
    st.filter,
    st.showFinished,
    st.contextFilter?.kind ?? '',
    st.contextFilter?.value ?? '',
    st.search,
    // Advanced filters change the dataset — include them so the grid remounts.
    JSON.stringify(st.advFilter),
    // Include bookIds so a playlist reorder forces the virtualizer to remount
    // with the new sort order rather than serving the stale cached layout.
    (st.contextFilter?.bookIds ?? []).join(','),
  ].join('|');

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
        style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: st.libraryView === 'list' ? '12px 14px' : '20px 18px' }}
      >
        {/* Remount the virtualized child whenever the dataset identity changes
            (filter, context filter, search, hide-finished). The shared flex:1
            scroll container never changes its own size on a filter toggle, so the
            virtualizer's ResizeObserver never re-fires and can latch a stale
            viewport rect — leaving getVirtualItems() empty while getTotalSize()
            stays tall (empty body + scrollbar). A fresh virtualizer measures the
            settled layout; this is the same remount the grid/list toggle relies on. */}
        {st.libraryView === 'list' ? (
          <ShelfList key={shelfKey} books={shelfBooks} st={st} openBook={openBook} onContextMenu={onContextMenu} scrollRef={scrollRef} />
        ) : (
          <ShelfGrid key={shelfKey} books={shelfBooks} st={st} coverW={coverW} selectedId={selectedId} openBook={openBook} onContextMenu={onContextMenu} scrollRef={scrollRef} />
        )}
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildItemContextMenu(contextMenu.item, st, setMatchItem, setCollectionItem, setFilesItem, setPlaylistItem, setEditItem, setCoverItem)}
          onClose={() => setContextMenu(null)}
        />
      )}
      {matchItem && (
        <MatchModal
          item={matchItem}
          serverUrl={st.serverUrl}
          onClose={() => setMatchItem(null)}
          onComplete={updated => {
            st.updateLibraryItem(updated);
            setMatchItem(null);
          }}
          onRefresh={() => { st.refreshLibrary().catch(console.error); }}
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
          onRefresh={() => { st.refreshLibrary().catch(console.error); }}
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
    </Glass>
  );
}
