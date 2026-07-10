import React, { useRef, useState, useEffect } from 'react';
import type { OnyxState, LibraryItem } from '../state/onyx';
import {
  bookTitle, bookAuthor, bookSeries, bookDur,
  bookProgress,
} from '../state/onyx';
import Glass from './chrome/Glass';
import Cover from './Cover';
import Icon from './Icon';
import ContextMenu from './ContextMenu';
import { buildItemContextMenu } from './shelf/buildItemContextMenu';
import { pauseAudio, getContinueListening } from '../api/abs';
import { log } from '../lib/log';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const MONO = "'JetBrains Mono', ui-monospace, monospace";

export interface PickItUpProps {
  st: OnyxState;
}

export default function PickItUp({ st }: PickItUpProps) {
  const [continueItems, setContinueItems] = useState<LibraryItem[]>([]);

  useEffect(() => {
    // Local libraries have no server continue-listening endpoint — derive the
    // in-progress list from loaded items + local progress (newest first).
    if (st.activeLibrary?.source === 'local' || st.activeLibrary?.source === 'all') {
      const prog = (id: string) => st.mediaProgress.find(p => p.libraryItemId === id);
      const inProgress = st.library
        .filter(b => { const mp = prog(b.id); return !!mp && mp.currentTime > 0 && !mp.isFinished; })
        .sort((a, b) => (prog(b.id)?.lastUpdate ?? 0) - (prog(a.id)?.lastUpdate ?? 0));
      setContinueItems(inProgress);
      return;
    }
    if (!st.serverUrl || !st.currentLibraryId) return;
    getContinueListening(st.serverUrl, st.currentLibraryId)
      .then(setContinueItems)
      .catch(e => log.error('library', 'getContinueListening failed', { err: String(e) }));
  }, [st.serverUrl, st.currentLibraryId, st.mediaProgress, st.activeLibrary, st.library]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startScrollLeft: number; didDrag: boolean } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: LibraryItem } | null>(null);

  const onContextMenu = (e: React.MouseEvent, item: LibraryItem) => {
    e.preventDefault();
    // clientX/Y, not pageX/Y — the menu is position:fixed (see LibraryShelf).
    setContextMenu({ x: e.clientX, y: e.clientY, item });
  };

  useEffect(() => {
    const onWindowMouseUp = () => {
      if (dragRef.current) {
        setIsDragging(false);
      }
    };
    window.addEventListener('mouseup', onWindowMouseUp);
    return () => window.removeEventListener('mouseup', onWindowMouseUp);
  }, []);

  if (continueItems.length === 0 || st.search || st.contextFilter) {
    return null;
  }

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    dragRef.current = { startX: e.clientX, startScrollLeft: el.scrollLeft, didDrag: false };
    setIsDragging(true);

    const onMove = (me: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = me.clientX - dragRef.current.startX;
      if (Math.abs(delta) > 5) dragRef.current.didDrag = true;
      el.scrollLeft = dragRef.current.startScrollLeft - delta;
    };

    const onUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const onClickCapture = (e: React.MouseEvent) => {
    if (dragRef.current?.didDrag) {
      e.stopPropagation();
      dragRef.current.didDrag = false;
    }
  };

  const handlePickItUpClick = async (book: LibraryItem) => {
    // If this book is already the current book, do nothing — the sidebar
    // play button will handle play/pause as normal.
    if (book.id === st.currentBookId) return;

    // If a book is actively playing, pause it before switching.
    // This prevents audio from continuing over the transition.
    if (st.playing) {
      await pauseAudio().catch(e => log.error('playback', 'pause before book switch failed', { err: String(e) }));
      st.setPlaying(false);
    }

    // Update currentBookId to the selected book so the Focus panel
    // and sidebar play button now target this book.
    st.setCurrentBookId(book.id);
    st.setFocusedBookId(book.id);

    // Reset session state so the sidebar knows no session is open
    // for the new book — the play button will open a fresh one.
    st.setSessionId('');
    st.setSessionReady(false);
    st.setPosition(0);
  };

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '0 4px 12px' }}>
        <button
          onClick={() => st.setPickItUpCollapsed(!st.pickItUpCollapsed)}
          title={st.pickItUpCollapsed ? 'Expand Pick it up' : 'Collapse Pick it up'}
          style={{ display: 'flex', alignItems: 'baseline', gap: 12, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', color: 'inherit' }}
        >
          <div style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 500, letterSpacing: '-0.01em', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              display: 'inline-flex',
              color: 'var(--onyx-text-mute)',
              transform: st.pickItUpCollapsed ? 'rotate(-90deg)' : 'none',
              transition: 'transform 0.18s',
            }}>
              <Icon name="chevron-down" size={13} />
            </span>
            Pick it up
          </div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            {continueItems.length} in progress
          </div>
        </button>
      </div>
      {!st.pickItUpCollapsed && (
        <div
          ref={scrollRef}
          onMouseDown={onMouseDown}
          onMouseLeave={() => { if (dragRef.current) { setIsDragging(false); dragRef.current = null; } }}
          onDragStart={e => e.preventDefault()}
          onClickCapture={onClickCapture}
          className="pickitup-scroll"
          style={{ display: 'flex', flexDirection: 'row', width: '100%', minWidth: 0, gap: 14, overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch', paddingBottom: 8, cursor: isDragging ? 'grabbing' : 'grab', userSelect: isDragging ? 'none' : undefined }}
        >
          {continueItems.map(b => {
            const prog = bookProgress(b, st.mediaProgress);
            // Cached once per card — used for badge presence and server-deleted variant.
            const dlRecord = st.downloads.find(d => d.itemId === b.id);
            return (
              <Glass key={b.id} translucent={st.translucent} onClick={() => handlePickItUpClick(b)} onContextMenu={e => onContextMenu(e, b)} style={{ flexGrow: 0, flexShrink: 0, flexBasis: 260, padding: 14, display: 'flex', gap: 14, minHeight: 110, cursor: 'pointer' }}>
                {/* Cover wrapped in relative container so the badge can be absolutely positioned */}
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <Cover item={b} size={80} serverUrl={st.serverUrl} />
                  {/* Downloaded badge — matches LibraryShelf: brass ↓ or amber ! */}
                  {dlRecord && (
                    <div
                      title={dlRecord.serverDeleted ? 'No longer on server — local copy only' : 'Available offline'}
                      style={{
                        position: 'absolute', bottom: 2, right: 2,
                        zIndex: 3,
                        background: 'rgba(0,0,0,0.72)', borderRadius: 3,
                        padding: '1px 4px',
                        display: 'inline-flex', alignItems: 'center',
                        // Amber when server-deleted; brass when still on the server.
                        color: dlRecord.serverDeleted ? '#d4834a' : 'var(--onyx-accent)',
                        fontSize: 9, fontFamily: MONO,
                        lineHeight: 1, userSelect: 'none',
                      }}>
                      {dlRecord.serverDeleted ? '!' : '↓'}
                    </div>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ fontFamily: MONO, fontSize: 9, color: 'var(--onyx-text-mute)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>{bookSeries(b)}</div>
                  <div style={{ marginTop: 4, fontFamily: SERIF, fontSize: 17, fontWeight: 500, lineHeight: 1.1 }}>{bookTitle(b)}</div>
                  <div style={{ marginTop: 2, fontSize: 12, color: 'var(--onyx-text-dim)' }}>{bookAuthor(b)}</div>
                  <div style={{ flex: 1 }} />
                  <div style={{ height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${prog * 100}%`, height: '100%', background: 'var(--onyx-accent)' }} />
                  </div>
                  <div style={{ marginTop: 4, fontFamily: MONO, fontSize: 9.5, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em', display: 'flex', justifyContent: 'space-between' }}>
                    <span>{Math.round(prog * 100)}%</span><span>{bookDur(b)}</span>
                  </div>
                </div>
              </Glass>
            );
          })}
        </div>
      )}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          sections={buildItemContextMenu(contextMenu.item, st, { fromPickItUp: true })}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
