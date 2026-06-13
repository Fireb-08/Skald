import { useState, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { OnyxState, Chapter } from '../state/onyx';
import { seekAudio, createBookmark, getMe, setSpeed as setAudioSpeed } from '../api/abs';
// playBook: canonical entry point for starting a book from a stopped state.
// togglePlayback: pairs the LibVLC command with st.setPlaying for correct
// immediate state sync when resuming or pausing an already-open session.
import { playBook, togglePlayback } from '../api/playbook';
import {
  SPEEDS,
  chapterAt, chapterStart, fmtTime, // fmtRemaining removed — not used
  bookTitle, bookAuthor, bookSeries, bookNarrator, bookDur,
  bookProgress, bookCurrentTime, // bookSynopsis removed — not rendered
} from '../state/onyx';
import Glass from './chrome/Glass';
import Cover from './Cover';
import Icon from './Icon';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const MONO = "'JetBrains Mono', ui-monospace, monospace";

type CtxKind = 'series' | 'author' | 'narrator' | 'collection';

export interface FocusPanelProps {
  st: OnyxState;
}

function seriesNameOf(s: string | undefined): string {
  return (s || '').split(' · ')[0];
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: '4px 10px 6px' }}>
      <div style={{ fontFamily: MONO, fontSize: 9, color: 'var(--onyx-text-mute)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ marginTop: 3, fontSize: 16, fontWeight: 500 }}>{value}</div>
    </div>
  );
}

function ChaptersStat({ st, chIdx, chapterCount, chapters }: { st: OnyxState; chIdx: number; chapterCount: number; chapters: Chapter[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector('[data-current="true"]') as HTMLElement | null;
    el?.scrollIntoView({ block: 'center' });
  }, [open]);

  const jump = (i: number) => {
    const pos = chapterStart(chapters, i);
    seekAudio(pos).catch(console.error);
    st.setPosition(pos);
    setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Jump to chapter"
        style={{
          background: open ? 'var(--onyx-accent-dim)' : 'transparent',
          border: `1px solid ${open ? 'var(--onyx-accent-edge)' : 'transparent'}`,
          borderRadius: 8, padding: '4px 10px 6px', cursor: 'pointer',
          textAlign: 'left', fontFamily: 'inherit', color: 'inherit',
          display: 'flex', alignItems: 'baseline', gap: 6,
        }}
      >
        <div>
          <div style={{ fontFamily: MONO, fontSize: 9, color: 'var(--onyx-text-mute)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Chapters</div>
          <div style={{ marginTop: 3, fontSize: 16, fontWeight: 500, color: open ? 'var(--onyx-accent)' : 'var(--onyx-text)' }}>
            {chapterCount}
          </div>
        </div>
        <span style={{ color: 'var(--onyx-text-mute)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', alignSelf: 'center', marginTop: 8, display: 'inline-flex' }}>
          <Icon name="chevron-down" size={10} />
        </span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 8px)', left: 0,
          width: 280, maxWidth: '100%', maxHeight: 320,
          background: 'var(--onyx-panel2)', border: '1px solid var(--onyx-line)', borderRadius: 10,
          boxShadow: '0 16px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.08)',
          padding: 6, zIndex: 100, display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ padding: '6px 8px 4px', fontFamily: MONO, fontSize: 9, color: 'var(--onyx-text-mute)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            Jump to chapter
          </div>
          <div ref={listRef} style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
            {chapters.map((c, i) => {
              const chState = i < chIdx ? 'done' : i === chIdx ? 'playing' : 'next';
              return (
                <button
                  key={c.n}
                  data-current={chState === 'playing' ? 'true' : 'false'}
                  onClick={() => jump(i)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 6,
                    background: chState === 'playing' ? 'var(--onyx-accent-dim)' : 'transparent',
                    border: 'none', width: '100%', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                    marginBottom: 1,
                  }}
                >
                  <div style={{ fontFamily: MONO, fontSize: 10, color: chState === 'playing' ? 'var(--onyx-accent)' : 'var(--onyx-text-mute)', width: 22, flexShrink: 0 }}>
                    {String(c.n).padStart(2, '0')}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: chState === 'playing' ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: chState === 'done' ? 'var(--onyx-text-mute)' : chState === 'playing' ? 'var(--onyx-accent)' : 'var(--onyx-text)' }}>
                    {c.t || `Chapter ${c.n}`}
                  </div>
                  {chState === 'done' && (
                    <span style={{ color: 'var(--onyx-text-mute)', flexShrink: 0, display: 'inline-flex' }}>
                      <Icon name="check" size={10} />
                    </span>
                  )}
                  {chState === 'playing' && (
                    <div style={{ width: 5, height: 5, borderRadius: 3, background: 'var(--onyx-accent)', boxShadow: '0 0 10px var(--onyx-accent)', flexShrink: 0 }} />
                  )}
                  {chState === 'next' && <div style={{ width: 10, flexShrink: 0 }} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function SpeedStat({ st }: { st: OnyxState }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Change playback speed"
        style={{
          background: open ? 'var(--onyx-accent-dim)' : 'transparent',
          border: `1px solid ${open ? 'var(--onyx-accent-edge)' : 'transparent'}`,
          borderRadius: 8, padding: '4px 10px 6px', cursor: 'pointer',
          textAlign: 'left', fontFamily: 'inherit', color: 'inherit',
          display: 'flex', alignItems: 'baseline', gap: 6,
        }}
      >
        <div>
          <div style={{ fontFamily: MONO, fontSize: 9, color: 'var(--onyx-text-mute)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Speed</div>
          <div style={{ marginTop: 3, fontSize: 16, fontWeight: 500, color: open ? 'var(--onyx-accent)' : 'var(--onyx-text)' }}>
            {st.speed}×
          </div>
        </div>
        <span style={{ color: 'var(--onyx-text-mute)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', alignSelf: 'center', marginTop: 8, display: 'inline-flex' }}>
          <Icon name="chevron-down" size={10} />
        </span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 8px)', left: -4,
          background: 'var(--onyx-panel2)', border: '1px solid var(--onyx-line)', borderRadius: 10,
          boxShadow: '0 16px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.08)',
          padding: 6, zIndex: 100, minWidth: 130,
        }}>
          <div style={{ fontFamily: MONO, fontSize: 9, color: 'var(--onyx-text-mute)', letterSpacing: '0.12em', padding: '6px 8px 4px', textTransform: 'uppercase' }}>
            Playback Speed
          </div>
          {SPEEDS.map(s => (
            <button
              key={s}
              onClick={() => {
                st.setSpeed(s);
                setOpen(false);
                setAudioSpeed(parseFloat(s)).catch(err => console.error('[speed] failed:', err));
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 6,
                background: s === st.speed ? 'var(--onyx-accent-dim)' : 'transparent',
                border: 'none', width: '100%', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
              }}
            >
              <span style={{ fontFamily: MONO, fontSize: 13, color: s === st.speed ? 'var(--onyx-accent)' : 'var(--onyx-text)', fontWeight: s === st.speed ? 600 : 400, flex: 1 }}>
                {s}×
              </span>
              {s === st.speed && (
                <span style={{ color: 'var(--onyx-accent)', display: 'inline-flex' }}>
                  <Icon name="check" size={11} />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CollapseHandle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      title={collapsed ? 'Expand panel' : 'Collapse panel'}
      style={{
        position: 'absolute', top: 12, bottom: 12, right: -1, width: 18,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', zIndex: 5,
      }}
    >
      <div style={{
        width: 4, height: '100%', borderRadius: 2,
        background: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.22) 30%, rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.22) 70%, rgba(255,255,255,0.04))',
        border: '1px solid var(--onyx-glass-edge)',
        position: 'relative',
      }}>
        <div style={{
          position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
          width: 22, height: 44, borderRadius: 11,
          background: 'var(--onyx-panel2)', border: '1px solid var(--onyx-glass-edge)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--onyx-accent)',
        }}>
          <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} size={12} />
        </div>
      </div>
    </button>
  );
}

export default function FocusPanel({ st }: FocusPanelProps) {
  const [drawerTab, setDrawerTab] = useState<'bookmarks' | 'synopsis'>('synopsis');

  const focus = st.currentBook;
  if (!focus) return null;

  const focusBookmarks = st.bookmarks.filter(b => b.libraryItemId === st.currentBookId);

  const totalSecs = st.bookSecs;
  const focusProgress = st.currentBookId === focus.id
    ? st.position / (totalSecs || 1)
    : bookProgress(focus, st.mediaProgress);
  const chapters = st.currentBookChapters;
  const { idx: chIdx } = chapterAt(chapters, st.position);
  const chapterCount = chapters.length;
  const seriesLabel = seriesNameOf(bookSeries(focus));

  const toggleContext = (kind: CtxKind, value: string) => {
    if (st.contextFilter?.kind === kind && st.contextFilter?.value === value) {
      st.setContextFilter(null);
    } else {
      st.setContextFilter({ kind, value });
    }
  };

  const ctxIs = (kind: CtxKind, value: string): boolean =>
    !!st.contextFilter && st.contextFilter.kind === kind && st.contextFilter.value === value;

  const openBook = (id: string) => {
    st.setCurrentBookId(id);
    // Align focusedBookId with the book the panel displays. The Player renders
    // `focusedBook ?? currentBook`, so without this the player would show a
    // stale focused book (e.g. one selected in the shelf) rather than the book
    // shown in this panel.
    st.setFocusedBookId(id);
    if (id !== st.currentBookId) {
      const b = st.library.find(x => x.id === id);
      if (b) st.setPosition(bookCurrentTime(b, st.mediaProgress));
    }
    st.setScreen('player');
  };

  const handleContinue = async () => {
    // Mirrors the Player view's handlePlayPause: decide using the same props the
    // icon reads (st.playing / st.currentBookId) so the icon and the action can
    // never disagree. Only cold-start for a different book or a missing session.
    try {
      if (st.isLocalPlayback) {
        // Local playback has no server session — toggle audio directly.
        await togglePlayback(st);
      } else if (st.playing && st.currentBookId === focus.id) {
        // This book is playing (icon shows pause) → pause.
        await togglePlayback(st);
      } else if (st.sessionReady && st.currentBookId === focus.id) {
        // Session open for this book but paused → resume from current position.
        await togglePlayback(st);
      } else {
        // Different book or no open session → cold start from saved position.
        await playBook(st, focus.id);
      }
    } catch (err) {
      console.error('[handleContinue] failed:', err);
    }
  };

  if (st.focusCollapsed) {
    return (
      <Glass
        translucent={st.translucent}
        style={{ width: 76, padding: '20px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, position: 'relative', gap: 18 }}
      >
        <CollapseHandle collapsed onToggle={() => st.setFocusCollapsed(false)} />
        <div onClick={() => openBook(focus.id)} style={{ cursor: 'pointer' }}>
          <Cover item={focus} size={48} serverUrl={st.serverUrl} />
        </div>
        <button
          // Use handleContinue — same as the main play button.
          // Direct setPlaying() does not invoke LibVLC; it only flips the icon
          // while audio keeps running, causing an immediate re-open on pause.
          onClick={() => handleContinue()}
          style={{ width: 32, height: 32, borderRadius: 16, border: 'none', background: 'var(--onyx-accent)', color: 'var(--onyx-bg)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name={st.playing && st.currentBookId === focus.id ? 'pause' : 'play'} size={12} />
        </button>
        <div style={{ width: 2, flex: 1, background: 'rgba(255,255,255,0.08)', borderRadius: 1, overflow: 'hidden', position: 'relative' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: `${focusProgress * 100}%`, background: 'var(--onyx-accent)' }} />
        </div>
        <div style={{ fontFamily: MONO, fontSize: 9, color: 'var(--onyx-text-mute)', writingMode: 'vertical-rl', transform: 'rotate(180deg)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          {bookTitle(focus)}
        </div>
      </Glass>
    );
  }

  const focusSeries = bookSeries(focus);
  const focusAuthor = bookAuthor(focus);
  const focusNarrator = bookNarrator(focus);
  return (
    <Glass
      translucent={st.translucent}
      style={{ width: 360, padding: 28, display: 'flex', flexDirection: 'column', flexShrink: 0, position: 'relative', overflow: 'visible' }}
    >
      <CollapseHandle collapsed={false} onToggle={() => st.setFocusCollapsed(true)} />

      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.18em', color: 'var(--onyx-text-mute)', textTransform: 'uppercase', marginBottom: 16 }}>
        In focus
      </div>

      <div onClick={() => openBook(focus.id)} style={{ cursor: 'pointer' }}>
        <Cover item={focus} size={300} serverUrl={st.serverUrl} />
      </div>

      {focusSeries && (
        <button
          onClick={() => toggleContext('series', seriesLabel)}
          title={ctxIs('series', seriesLabel) ? 'Clear series filter' : `Show all books in ${seriesLabel}`}
          style={{ marginTop: 22, alignSelf: 'flex-start', fontFamily: MONO, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--onyx-accent)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          {focusSeries}
          <span style={{ opacity: 0.7, display: 'inline-flex' }}>
            <Icon name={ctxIs('series', seriesLabel) ? 'chevron-down' : 'chevron-right'} size={10} />
          </span>
        </button>
      )}

      <div style={{ marginTop: focusSeries ? 6 : 22, fontFamily: SERIF, fontSize: 30, fontWeight: 500, lineHeight: 1.05, letterSpacing: '-0.01em' }}>
        {bookTitle(focus)}
      </div>

      <div style={{ marginTop: 8, fontSize: 14, color: 'var(--onyx-text-dim)', display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '0 4px' }}>
        <span>by</span>
        <button
          onClick={() => toggleContext('author', focusAuthor)}
          title={ctxIs('author', focusAuthor) ? 'Clear author filter' : `Show all books by ${focusAuthor}`}
          style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 'inherit',
            color: ctxIs('author', focusAuthor) ? 'var(--onyx-accent)' : 'var(--onyx-text)',
            borderBottom: `1px dashed ${ctxIs('author', focusAuthor) ? 'var(--onyx-accent)' : 'rgba(235,231,223,0.25)'}`,
          }}
        >
          {focusAuthor}
        </button>
        {focusNarrator && (
          <>
            <span style={{ color: 'var(--onyx-text-mute)' }}>·</span>
            <button
              onClick={() => toggleContext('narrator', focusNarrator)}
              title={ctxIs('narrator', focusNarrator) ? 'Clear narrator filter' : `Show all books narrated by ${focusNarrator}`}
              style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 'inherit',
                color: ctxIs('narrator', focusNarrator) ? 'var(--onyx-accent)' : 'var(--onyx-text-dim)',
                borderBottom: `1px dashed ${ctxIs('narrator', focusNarrator) ? 'var(--onyx-accent)' : 'rgba(235,231,223,0.15)'}`,
              }}
            >
              {focusNarrator}
            </button>
          </>
        )}
      </div>

      <div style={{ marginTop: 18, display: 'flex', gap: 10 }}>
        <button
          onClick={() => handleContinue()}
          style={{ flex: 1, height: 44, background: 'var(--onyx-accent)', color: 'var(--onyx-bg)', border: 'none', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}
        >
          <Icon name={st.playing && st.currentBookId === focus.id ? 'pause' : 'play'} size={14} />
          {st.playing && st.currentBookId === focus.id ? 'Pause' : 'Play'}
        </button>
        <button
          title="Bookmark this moment"
          onClick={async () => {
            try {
              const { chapter } = chapterAt(st.currentBookChapters, st.position);
              const title = chapter?.t
                ? `${chapter.t} — ${fmtTime(st.position)}`
                : fmtTime(st.position);
              await createBookmark(st.serverUrl, st.currentBookId, st.position, title);
              const me = await getMe(st.serverUrl);
              st.setBookmarks(me.bookmarks);
            } catch (err) {
              console.error('[bookmark] failed:', err);
            }
          }}
          style={{ width: 44, height: 44, background: 'var(--onyx-glass-strong)', border: '1px solid var(--onyx-glass-edge)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--onyx-text-dim)', cursor: 'pointer' }}
        >
          <Icon name="bookmark" size={16} />
        </button>
      </div>

      <div style={{ marginTop: 14, height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${focusProgress * 100}%`, height: '100%', background: 'var(--onyx-accent)', transition: 'width 0.2s' }} />
      </div>

      <div style={{ marginTop: 6, fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em' }}>
        {Math.round(focusProgress * 100)}% · Ch. {chIdx + 1} / {chapterCount}
      </div>

      <div style={{ marginTop: 14, display: 'flex', gap: 4 }}>
        <button
          onClick={() => setDrawerTab('synopsis')}
          style={{
            fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase',
            padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
            background: drawerTab === 'synopsis' ? 'var(--onyx-accent-dim)' : 'transparent',
            border: `1px solid ${drawerTab === 'synopsis' ? 'var(--onyx-accent-edge)' : 'var(--onyx-glass-edge)'}`,
            color: drawerTab === 'synopsis' ? 'var(--onyx-accent)' : 'var(--onyx-text-mute)',
          }}
        >
          Synopsis
        </button>
        <button
          onClick={() => setDrawerTab('bookmarks')}
          style={{
            fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase',
            padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
            background: drawerTab === 'bookmarks' ? 'var(--onyx-accent-dim)' : 'transparent',
            border: `1px solid ${drawerTab === 'bookmarks' ? 'var(--onyx-accent-edge)' : 'var(--onyx-glass-edge)'}`,
            color: drawerTab === 'bookmarks' ? 'var(--onyx-accent)' : 'var(--onyx-text-mute)',
            display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          <Icon name="bookmark" size={9} />
          Bookmarks{focusBookmarks.length > 0 ? ` (${focusBookmarks.length})` : ''}
        </button>
      </div>

      <div style={{ marginTop: 10, flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {drawerTab === 'bookmarks' ? (
          focusBookmarks.length > 0 ? (
            <div>
              {focusBookmarks.map((bm, i) => (
                <button
                  key={i}
                  onClick={() => { st.setPosition(bm.time); st.setScreen('player'); }}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', background: 'none', border: 'none', borderTop: i > 0 ? '1px solid var(--onyx-line)' : 'none', width: '100%', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', color: 'inherit' }}
                >
                  <div style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 600, color: 'var(--onyx-accent)', paddingTop: 1, flexShrink: 0 }}>{fmtTime(bm.time)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--onyx-text)', lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' } as CSSProperties}>
                      {bm.title}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', padding: '12px 0' }}>No bookmarks yet.</div>
          )
        ) : focus.media.metadata.description ? (
          <div
            style={{ fontFamily: SERIF, fontSize: 13.5, lineHeight: 1.55, color: 'var(--onyx-text-dim)', paddingTop: 4 }}
            dangerouslySetInnerHTML={{ __html: focus.media.metadata.description }}
          />
        ) : (
          <div style={{ fontFamily: SERIF, fontSize: 13.5, lineHeight: 1.55, color: 'var(--onyx-text-dim)', paddingTop: 4 }}>
            No synopsis available.
          </div>
        )}
      </div>

      <div style={{ marginTop: 0, paddingTop: 20, borderTop: '1px solid var(--onyx-line)', display: 'flex', gap: 24, overflow: 'visible' }}>
        <Stat label="Duration" value={bookDur(focus)} />
        <ChaptersStat st={st} chIdx={chIdx} chapterCount={chapterCount} chapters={chapters} />
        <SpeedStat st={st} />
      </div>
    </Glass>
  );
}
