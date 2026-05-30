import React, { useState, useMemo } from 'react';
import type { OnyxState, LibraryItem } from '../../state/onyx';
import {
  bookTitle, bookAuthor, bookSeries, bookNarrator, bookGenre,
  bookDur, bookDurSecs, bookProgress, bookCurrentTime,
} from '../../state/onyx';
import Glass from '../chrome/Glass';
import Cover from '../Cover';
import Icon from '../Icon';
import SortIndicator from './SortIndicator';
import ContextMenu from '../ContextMenu';
import { buildItemContextMenu } from './buildItemContextMenu';
import MatchModal from '../MatchModal';
import CollectionPicker from '../CollectionPicker';
import FilesModal from './FilesModal';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const MONO = "'JetBrains Mono', ui-monospace, monospace";

const COVER_SIZES: Record<string, number> = { S: 80, M: 96, L: 116, XL: 148, XXL: 180, XXXL: 220 };

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

function ShelfList({ books, st, openBook, onContextMenu }: { books: LibraryItem[]; st: OnyxState; openBook: (id: string) => void; onContextMenu: (e: React.MouseEvent, item: LibraryItem) => void }) {
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

  const TRUNC: React.CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 0 };
  const DCELL: React.CSSProperties = { ...TRUNC, padding: '8px 8px', verticalAlign: 'middle' };

  if (sorted.length === 0) {
    return (
      <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--onyx-text-mute)', fontFamily: SERIF, fontSize: 16, fontStyle: 'italic' }}>
        No titles match &ldquo;{st.search}&rdquo;.
      </div>
    );
  }

  return (
    <div style={{ width: '100%', minWidth: 0, overflowX: 'auto' }}>
      <table style={{ width: '100%', tableLayout: 'auto', borderCollapse: 'collapse', fontFamily: 'inherit', color: 'inherit' }}>
        <thead>
          <tr>
            <th style={{ width: 48, padding: '8px 8px 10px 12px', borderBottom: '1px solid var(--onyx-line)' }} />
            {COLS.map(c => {
              const active = sort?.col === c.id;
              return (
                <th key={c.id} style={{
                  ...TRUNC,
                  ...(c.id === 'duration' ? { width: 80 } : {}),
                  padding: c.id === 'duration' ? '8px 12px 10px 8px' : '8px 8px 10px',
                  textAlign: c.align,
                  fontWeight: 'normal',
                  borderBottom: '1px solid var(--onyx-line)',
                }}>
                  <button onClick={() => onHeader(c.id)} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                    fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase',
                    color: active ? 'var(--onyx-accent)' : 'var(--onyx-text-mute)',
                    whiteSpace: 'nowrap',
                  }}>
                    {c.label}
                    <SortIndicator active={active} dir={sort?.dir ?? 'asc'} />
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((b, i) => {
            const active = b.id === st.currentBookId;
            const prog = bookProgress(b, st.mediaProgress);
            return (
              <tr
                key={b.id}
                onClick={() => openBook(b.id)}
                onContextMenu={e => onContextMenu(e, b)}
                className="onyx-row"
                style={{
                  background: active ? 'var(--onyx-accent-dim)' : (i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)'),
                  borderTop: i > 0 ? '1px solid var(--onyx-line)' : undefined,
                  cursor: 'pointer',
                }}
              >
                {/* Cover */}
                <td style={{ width: 48, padding: '8px 8px 8px 12px', verticalAlign: 'middle', borderLeft: active ? '2px solid var(--onyx-accent)' : '2px solid transparent' }}>
                  <div style={{ position: 'relative', display: 'inline-block' }}>
                    <Cover item={b} size={40} serverUrl={st.serverUrl} />
                    {st.showProgressOverlay && prog > 0 && (
                      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, background: 'rgba(0,0,0,0.4)' }}>
                        <div style={{ width: `${prog * 100}%`, height: '100%', background: 'var(--onyx-accent)' }} />
                      </div>
                    )}
                  </div>
                </td>
                {/* Title + series */}
                <td style={{ ...DCELL }}>
                  <div style={{ fontFamily: SERIF, fontSize: 14.5, fontWeight: 500, color: active ? 'var(--onyx-accent)' : 'var(--onyx-text)', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bookTitle(b)}</div>
                  {bookSeries(b) && (
                    <div style={{ marginTop: 2, fontFamily: MONO, fontSize: 9.5, color: 'var(--onyx-text-mute)', letterSpacing: '0.1em', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bookSeries(b)}</div>
                  )}
                </td>
                {/* Author */}
                <td style={{ ...DCELL, fontSize: 12.5, color: 'var(--onyx-text-dim)' }}>{bookAuthor(b)}</td>
                {/* Genre */}
                <td style={{ ...DCELL }}>
                  {bookGenre(b) ? (
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 999,
                      background: 'var(--onyx-glass)', border: '1px solid var(--onyx-glass-edge)',
                      fontFamily: MONO, fontSize: 9.5, color: 'var(--onyx-text-dim)', letterSpacing: '0.06em', textTransform: 'uppercase',
                      maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{bookGenre(b)}</span>
                  ) : <span style={{ color: 'var(--onyx-text-mute)' }}>—</span>}
                </td>
                {/* Narrator */}
                <td style={{ ...DCELL }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%', overflow: 'hidden' }}>
                    <span style={{ display: 'inline-flex', color: 'var(--onyx-text-mute)', flexShrink: 0 }}>
                      <Icon name="headphones" size={11} />
                    </span>
                    <span style={{ fontSize: 12.5, color: 'var(--onyx-text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bookNarrator(b)}</span>
                  </span>
                </td>
                {/* Duration */}
                <td style={{ width: 80, padding: '8px 12px 8px 8px', verticalAlign: 'middle', fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', textAlign: 'right', whiteSpace: 'nowrap' }}>{bookDur(b)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const onContextMenu = (e: React.MouseEvent, item: LibraryItem) => {
    e.preventDefault();
    setContextMenu({ x: e.pageX, y: e.pageY, item });
  };

  const filtered = st.library.filter(b => {
    if (st.contextFilter) {
      const { kind, value, bookIds } = st.contextFilter;
      if (kind === 'series'     && seriesNameOf(bookSeries(b)) !== value)   return false;
      if (kind === 'author'     && bookAuthor(b)   !== value)                return false;
      if (kind === 'narrator'   && bookNarrator(b) !== value)                return false;
      if (kind === 'collection' && !(bookIds ?? []).includes(b.id))          return false;
    }
    const prog = bookProgress(b, st.mediaProgress);
    if (!st.showFinished && prog >= 0.98 && st.filter !== 'finished') return false;
    if (st.filter === 'reading'  && !prog)      return false;
    if (st.filter === 'unread'   &&  prog)      return false;
    if (st.filter === 'finished' &&  prog < 0.98) return false;
    if (st.search) {
      const q = st.search.toLowerCase();
      if (
        !bookTitle(b).toLowerCase().includes(q) &&
        !bookAuthor(b).toLowerCase().includes(q) &&
        !(bookSeries(b) || '').toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  if (st.contextFilter?.kind === 'series') {
    filtered.sort((a, b) => seriesVolOf(bookSeries(a)) - seriesVolOf(bookSeries(b)));
  } else if (st.librarySort === 'title') {
    filtered.sort((a, b) => bookTitle(a).localeCompare(bookTitle(b)));
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

  const openBook = (id: string) => {
    if (selectedId === id) {
      st.setScreen('player');
    } else {
      setSelectedId(id);
      st.setCurrentBookId(id);
      if (id !== st.currentBookId) {
        const b = st.library.find(x => x.id === id);
        if (b) st.setPosition(bookCurrentTime(b, st.mediaProgress));
      }
    }
  };

  return (
    <Glass
      translucent={st.translucent}
      style={{ flex: 1, minWidth: 0, padding: st.libraryView === 'list' ? '12px 14px' : '20px 18px', overflow: 'auto' }}
    >
      {st.libraryView === 'list' ? (
        <ShelfList books={shelfBooks} st={st} openBook={openBook} onContextMenu={onContextMenu} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${coverW}px, 1fr))`, gap: 14 }}>
          {shelfBooks.map(b => {
            const prog = bookProgress(b, st.mediaProgress);
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
                </div>
                <div style={{ marginTop: 7, fontSize: 11.5, fontWeight: 500, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--onyx-text)' }}>{bookTitle(b)}</div>
                <div style={{ marginTop: 1, fontSize: 10.5, color: 'var(--onyx-text-mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bookAuthor(b)}</div>
              </button>
            );
          })}
          {shelfBooks.length === 0 && (
            <div style={{ gridColumn: '1 / -1', padding: '60px 0', textAlign: 'center', color: 'var(--onyx-text-mute)', fontFamily: SERIF, fontSize: 16, fontStyle: 'italic' }}>
              No titles match &ldquo;{st.search}&rdquo;.
            </div>
          )}
        </div>
      )}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildItemContextMenu(contextMenu.item, st, setMatchItem, setCollectionItem, setFilesItem)}
          onClose={() => setContextMenu(null)}
        />
      )}
      {matchItem && (
        <MatchModal
          item={matchItem}
          serverUrl={st.serverUrl}
          library={st.library}
          onClose={() => setMatchItem(null)}
          onComplete={updated => {
            st.updateLibraryItem(updated);
            setMatchItem(null);
          }}
          onRefresh={() => { st.refreshLibrary().catch(console.error); }}
        />
      )}
      {collectionItem && (
        <CollectionPicker
          item={collectionItem}
          serverUrl={st.serverUrl}
          onClose={() => setCollectionItem(null)}
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
