import React, { useState, useEffect, useRef } from 'react';
import {
  openPlaybackSession, playAudio, pauseAudio,
  seekAudio, setSpeed as setAudioSpeed, setVolume as setAudioVolume,
  createBookmark, getMe,
} from '../api/abs';
import type { CSSProperties } from 'react';
import type { OnyxState } from '../state/onyx';
import {
  SPEEDS, chapterAt, chapterStart, fmtTime, fmtRemaining,
  bookTitle, bookAuthor, bookSeries, bookNarrator, bookDur,
} from '../state/onyx';
import Glass from '../components/chrome/Glass';
import Cover from '../components/Cover';
import Icon from '../components/Icon';
import Waveform from '../components/Waveform';
import VolumeControl from '../components/chrome/VolumeControl';
import DeviceSelector from '../components/chrome/DeviceSelector';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const MONO = "'JetBrains Mono', ui-monospace, monospace";

interface GBooksInfo {
  averageRating?: number;
  ratingsCount?: number;
  infoLink?: string;
}

type SleepMode = null | number | 'chapter';

const SLEEP_OPTIONS: { id: SleepMode; label: string }[] = [
  { id: null,      label: 'Off'            },
  { id: 5,         label: '5 minutes'      },
  { id: 15,        label: '15 minutes'     },
  { id: 30,        label: '30 minutes'     },
  { id: 60,        label: '1 hour'         },
  { id: 'chapter', label: 'End of chapter' },
];

const transportBtn = (): CSSProperties => ({
  width: 44, height: 44, borderRadius: 10,
  background: 'var(--onyx-glass)', border: '1px solid var(--onyx-glass-edge)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: 'var(--onyx-text)', cursor: 'pointer', padding: 0,
});

const transportBtnSmall = (): CSSProperties => ({
  width: 40, height: 40, borderRadius: 10,
  background: 'var(--onyx-glass)', border: '1px solid var(--onyx-glass-edge)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: 'var(--onyx-text-dim)', cursor: 'pointer', padding: 0,
});

export interface PlayerProps {
  st: OnyxState;
}

export default function Player({ st }: PlayerProps) {
  const b = st.currentBook;
  if (!b) return null;

  const chapters = st.currentBookChapters;
  const { idx: chIdx, local: chLocal, chapter: curCh } = chapterAt(chapters, st.position);

  const playerBookmarks = st.bookmarks.filter(bm => bm.libraryItemId === st.currentBookId);

  const addBookmark = async () => {
    try {
      const title = curCh.t
        ? `${curCh.t} — ${fmtTime(st.position)}`
        : fmtTime(st.position);
      await createBookmark(st.serverUrl, st.currentBookId, st.position, title);
      const me = await getMe(st.serverUrl);
      st.setBookmarks(me.bookmarks);
    } catch (err) {
      console.error('[bookmark] create failed:', err);
    }
  };

  const [gBooksInfo, setGBooksInfo] = useState<GBooksInfo | null>(null);

  useEffect(() => {
    const apiKey = st.googleBooksApiKey;
    if (!apiKey || !b) { setGBooksInfo(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const meta = b.media?.metadata;
        const isbn = meta?.isbn13 || meta?.isbn10 || meta?.isbn;
        const q = isbn
          ? `isbn:${isbn}`
          : `intitle:${encodeURIComponent(bookTitle(b))}+inauthor:${encodeURIComponent(bookAuthor(b))}`;
        const res = await fetch(
          `https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=1&key=${apiKey}`,
        );
        const data = await res.json();
        if (cancelled) return;
        const info = data.items?.[0]?.volumeInfo ?? null;
        setGBooksInfo(info ? {
          averageRating: info.averageRating,
          ratingsCount: info.ratingsCount,
          infoLink: info.canonicalVolumeLink ?? info.infoLink,
        } : null);
      } catch (e) {
        console.error('[gbooks] fetch failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [st.currentBookId, st.googleBooksApiKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const [sleepMode, setSleepMode] = useState<SleepMode>(null);
  const [sleepRemain, setSleepRemain] = useState(0);
  const [sleepOpen, setSleepOpen] = useState(false);
  const sleepRef = useRef<HTMLDivElement>(null);
  const chapterAtStart = useRef(chIdx);

  useEffect(() => {
    if (typeof sleepMode === 'number') setSleepRemain(sleepMode * 60);
    if (sleepMode === 'chapter') chapterAtStart.current = chIdx;
  }, [sleepMode]); // chIdx intentionally excluded

  useEffect(() => {
    if (typeof sleepMode !== 'number' || !st.playing) return;
    const t = setInterval(() => {
      setSleepRemain(r => {
        if (r <= 1) { st.setPlaying(false); setSleepMode(null); return 0; }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [sleepMode, st.playing]);

  useEffect(() => {
    if (sleepMode === 'chapter' && chIdx !== chapterAtStart.current) {
      st.setPlaying(false);
      setSleepMode(null);
    }
  }, [chIdx]); // sleepMode/setPlaying excluded intentionally

  useEffect(() => {
    if (!sleepOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!sleepRef.current?.contains(e.target as Node)) setSleepOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [sleepOpen]);

  // Keep backend volume in sync with the UI slider.
  useEffect(() => {
    setAudioVolume(Math.round(st.volume * 100)).catch(() => {});
  }, [st.volume]);

  const sleepLabel: string | null = sleepMode == null
    ? null
    : sleepMode === 'chapter'
      ? 'End of chapter'
      : `${Math.floor(sleepRemain / 60)}:${String(sleepRemain % 60).padStart(2, '0')}`;

  const onScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const chStart = chapterStart(chapters, chIdx);
    seekAudio(chStart + frac * curCh.dur).catch(console.error);
  };

  const bSeries = bookSeries(b);

  const handlePlayPause = async () => {
    try {
      if (!st.sessionReady) {
        const { sessionId } = await openPlaybackSession(st.serverUrl, st.currentBookId);
        st.setSessionId(sessionId);
        st.setSessionReady(true);
        await playAudio();
      } else if (st.playing) {
        await pauseAudio();
      } else {
        await playAudio();
      }
    } catch (err) {
      console.error('[Player] play/pause failed:', err);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '12px 32px 24px', minHeight: 0 }}>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18, fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--onyx-text-mute)' }}>
        <button onClick={() => st.setScreen('library')} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'var(--onyx-text-dim)', cursor: 'pointer', padding: 4, fontFamily: 'inherit', fontSize: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit' }}>
          <Icon name="chevron-left" size={12} /> Library
        </button>
        <span>·</span>
        <span>{bSeries}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, textTransform: 'none', letterSpacing: 'normal' }}>
          <VolumeControl st={st} />
          <DeviceSelector st={st} />
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', gap: 32, alignItems: 'stretch', minHeight: 0 }}>

        <div style={{ width: 480, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', flexShrink: 0, minHeight: 0 }}>
          <div style={{ position: 'absolute', inset: '5% 5% 0 5%', borderRadius: 24, background: 'radial-gradient(50% 50% at 50% 50%, rgba(212,166,74,0.28), transparent 70%)', filter: 'blur(60px)', zIndex: 0 }} />
          <div style={{ position: 'relative', zIndex: 1 }}>
            <Cover item={b} size={420} serverUrl={st.serverUrl} />
          </div>
          <div style={{ marginTop: 32, textAlign: 'center', position: 'relative', zIndex: 1, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, width: '100%' }}>
            <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--onyx-accent)', marginBottom: 8 }}>{bSeries}</div>
            <div style={{ fontFamily: SERIF, fontSize: 48, fontWeight: 500, lineHeight: 1, letterSpacing: '-0.02em' }}>{bookTitle(b)}</div>
            <div style={{ marginTop: 10, fontSize: 16, color: 'var(--onyx-text-dim)' }}>by {bookAuthor(b)}</div>
            <div style={{ marginTop: 2, fontSize: 13, color: 'var(--onyx-text-mute)' }}>narrated by {bookNarrator(b)}</div>

            {/* Synopsis */}
            <div style={{ marginTop: 24, width: '100%', textAlign: 'left', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--onyx-text-mute)', marginBottom: 8 }}>
                Synopsis
              </div>
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {b.media?.metadata?.description ? (
                  <div
                    style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--onyx-text-dim)' }}
                    dangerouslySetInnerHTML={{ __html: b.media.metadata.description }}
                  />
                ) : (
                  <div style={{ fontSize: 13, color: 'var(--onyx-text-mute)', fontStyle: 'italic' }}>
                    No synopsis available.
                  </div>
                )}

              </div>
            </div>
          </div>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>

          <Glass translucent={st.translucent} style={{ padding: 26 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 22 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--onyx-text-mute)' }}>Now playing · Ch. {curCh.n}</div>
                <div style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 500, marginTop: 4, letterSpacing: '-0.005em' }}>{curCh.t}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-dim)' }}>
                <span style={{ fontSize: 14, color: 'var(--onyx-text)', fontWeight: 500 }}>{fmtTime(chLocal)}</span>
                <span style={{ color: 'var(--onyx-text-mute)' }}>/</span>
                <span>{fmtTime(curCh.dur)}</span>
              </div>
            </div>

            <div onClick={onScrub} style={{ cursor: 'pointer', position: 'relative' }}>
              <Waveform width={680} height={72} progress={chLocal / curCh.dur} color="var(--onyx-accent)" dim="rgba(255,255,255,0.15)" bars={140} flat />
            </div>

            <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>

              <div style={{ display: 'flex', gap: 6 }}>
                {SPEEDS.map(s => (
                  <button key={s} onClick={() => { st.setSpeed(s); setAudioSpeed(parseFloat(s)).catch(console.error); }} style={{
                    padding: '7px 12px', borderRadius: 6, fontFamily: MONO, fontSize: 11,
                    background: s === st.speed ? 'var(--onyx-accent-dim)' : 'transparent',
                    color: s === st.speed ? 'var(--onyx-accent)' : 'var(--onyx-text-dim)',
                    border: `1px solid ${s === st.speed ? 'var(--onyx-accent-edge)' : 'var(--onyx-glass-edge)'}`,
                    fontWeight: s === st.speed ? 600 : 400,
                    cursor: 'pointer',
                  }}>{s}×</button>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <button onClick={() => seekAudio(Math.max(0, st.position - 30)).catch(console.error)} title="Back 30s" style={transportBtn()}>
                  <Icon name="skip-back" size={20} />
                </button>
                <button
                  onClick={handlePlayPause}
                  title={st.playing ? 'Pause (space)' : 'Play (space)'}
                  style={{ width: 64, height: 64, borderRadius: 32, background: 'var(--onyx-accent)', color: 'var(--onyx-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: 'none', boxShadow: '0 12px 32px rgba(212,166,74,0.4)' }}
                >
                  <span style={{ display: 'inline-flex', marginLeft: st.playing ? 0 : 3 }}>
                    <Icon name={st.playing ? 'pause' : 'play'} size={26} />
                  </span>
                </button>
                <button onClick={() => seekAudio(Math.min(st.bookSecs, st.position + 30)).catch(console.error)} title="Forward 30s" style={transportBtn()}>
                  <Icon name="skip-forward" size={20} />
                </button>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={addBookmark} style={transportBtnSmall()} title="Bookmark this moment">
                  <Icon name="bookmark" size={15} />
                </button>
                <div ref={sleepRef} style={{ position: 'relative' }}>
                  <button
                    onClick={() => setSleepOpen(o => !o)}
                    title={sleepLabel ? `Sleep timer: ${sleepLabel}` : 'Sleep timer'}
                    style={{
                      ...transportBtnSmall(),
                      background: sleepMode != null ? 'var(--onyx-accent-dim)' : 'var(--onyx-glass)',
                      border: `1px solid ${sleepMode != null ? 'var(--onyx-accent-edge)' : 'var(--onyx-glass-edge)'}`,
                      color: sleepMode != null ? 'var(--onyx-accent)' : 'var(--onyx-text-dim)',
                      width: sleepMode != null ? 'auto' : 40,
                      padding: sleepMode != null ? '0 10px' : 0,
                      gap: 6,
                    }}
                  >
                    <Icon name="sleep" size={15} />
                    {sleepMode != null && (
                      <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, letterSpacing: '0.02em' }}>{sleepLabel}</span>
                    )}
                  </button>
                  {sleepOpen && (
                    <div style={{ position: 'absolute', bottom: 'calc(100% + 8px)', right: 0, background: 'var(--onyx-panel2)', border: '1px solid var(--onyx-line)', borderRadius: 10, boxShadow: '0 16px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(212,166,74,0.08)', padding: 6, zIndex: 100, minWidth: 170 }}>
                      <div style={{ fontFamily: MONO, fontSize: 9, color: 'var(--onyx-text-mute)', letterSpacing: '0.12em', padding: '6px 8px 4px', textTransform: 'uppercase' }}>Sleep Timer</div>
                      {SLEEP_OPTIONS.map(opt => {
                        const active = sleepMode === opt.id;
                        return (
                          <button key={String(opt.id)} onClick={() => { setSleepMode(opt.id); setSleepOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 6, background: active ? 'var(--onyx-accent-dim)' : 'transparent', border: 'none', width: '100%', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                            <span style={{ flex: 1, fontSize: 12.5, color: active ? 'var(--onyx-accent)' : 'var(--onyx-text)', fontWeight: active ? 600 : 400 }}>{opt.label}</span>
                            {active && <span style={{ display: 'inline-flex', color: 'var(--onyx-accent)' }}><Icon name="check" size={11} /></span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Glass>

          <div style={{ flex: 1, display: 'flex', gap: 18, minHeight: 0 }}>

            {/* ── Details panel ─────────────────────────────────────── */}
            <Glass translucent={st.translucent} style={{ flex: 1, padding: 20, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ fontFamily: SERIF, fontSize: 16, fontWeight: 500, marginBottom: 14 }}>Details</div>
              <div style={{ flex: 1, overflow: 'auto', marginRight: -8, paddingRight: 8 }}>
                {(() => {
                  const meta = b.media?.metadata;
                  const prog = st.mediaProgress.find(p => p.libraryItemId === st.currentBookId);
                  const dash = '—';
                  const detailRow = (label: string, value: React.ReactNode) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '7px 0', borderBottom: '1px solid var(--onyx-line)', gap: 12 }}>
                      <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--onyx-text-mute)', flexShrink: 0, paddingTop: 1 }}>{label}</div>
                      <div style={{ fontSize: 12.5, color: 'var(--onyx-text-dim)', textAlign: 'right', minWidth: 0 }}>{value ?? dash}</div>
                    </div>
                  );
                  const tags = b.media?.tags ?? [];
                  const genres = meta?.genres?.filter(Boolean) ?? [];
                  return (
                    <>
                      {/* Book details */}
                      <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--onyx-text-mute)', marginBottom: 4, paddingBottom: 4 }}>Book</div>
                      {detailRow('Publisher',  meta?.publisher    || dash)}
                      {detailRow('Genre',      genres.join(', ')  || dash)}
                      {detailRow('Year',       meta?.publishedYear || dash)}
                      {detailRow('Language',   meta?.language      || dash)}
                      {detailRow('Duration',   bookDur(b))}
                      {tags.length > 0 && detailRow('Tags',
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'flex-end' }}>
                          {tags.map(t => (
                            <span key={t} style={{ padding: '1px 7px', borderRadius: 999, background: 'var(--onyx-glass)', border: '1px solid var(--onyx-glass-edge)', fontFamily: MONO, fontSize: 9, color: 'var(--onyx-text-dim)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{t}</span>
                          ))}
                        </div>
                      )}

                      {/* Listening stats */}
                      <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--onyx-text-mute)', marginTop: 16, marginBottom: 4, paddingBottom: 4 }}>Listening</div>
                      {prog ? (
                        <>
                          {detailRow('Progress',
                            <span style={{ color: prog.isFinished ? 'var(--onyx-accent)' : 'var(--onyx-text-dim)' }}>
                              {Math.round(prog.progress * 100)}%{prog.isFinished && ' ✓'}
                            </span>
                          )}
                          {detailRow('Listened',   fmtTime(prog.currentTime))}
                          {detailRow('Remaining',  fmtRemaining(Math.max(0, prog.duration - prog.currentTime)))}
                          {detailRow('Last played', new Date(prog.lastUpdate * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }))}
                        </>
                      ) : (
                        <div style={{ padding: '12px 0', fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em' }}>Not started</div>
                      )}

                      {/* Ratings */}
                      {gBooksInfo && (gBooksInfo.averageRating != null || gBooksInfo.ratingsCount != null) && (
                        <>
                          <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--onyx-text-mute)', marginTop: 16, marginBottom: 4, paddingBottom: 4 }}>Ratings</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--onyx-line)' }}>
                            {gBooksInfo.averageRating != null && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontSize: 20, fontWeight: 600, color: 'var(--onyx-accent)' }}>{gBooksInfo.averageRating.toFixed(1)}</span>
                                <span style={{ fontSize: 13, color: 'var(--onyx-text-mute)' }}>/ 5</span>
                              </div>
                            )}
                            {gBooksInfo.ratingsCount != null && (
                              <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.04em' }}>
                                {gBooksInfo.ratingsCount.toLocaleString()} ratings
                              </span>
                            )}
                          </div>
                          {gBooksInfo.infoLink && (
                            <a href={gBooksInfo.infoLink} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 10, fontFamily: MONO, fontSize: 10, color: 'var(--onyx-accent)', letterSpacing: '0.06em', textTransform: 'uppercase', textDecoration: 'none' }}>
                              View on Google Books ↗
                            </a>
                          )}
                        </>
                      )}
                    </>
                  );
                })()}
              </div>
            </Glass>

            {/* ── Chapters panel ────────────────────────────────────── */}
            <Glass translucent={st.translucent} style={{ flex: 1, padding: 20, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
                <div style={{ fontFamily: SERIF, fontSize: 16, fontWeight: 500 }}>Chapters</div>
                <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.08em' }}>{chapters.length} · {bookDur(b)} total</div>
              </div>
              <div style={{ flex: 1, overflow: 'auto', marginRight: -8, paddingRight: 8 }}>
                {chapters.map((c, i) => {
                  const state = i < chIdx ? 'done' : i === chIdx ? 'playing' : 'next';
                  return (
                    <button key={c.n} onClick={() => { const pos = chapterStart(chapters, i); seekAudio(pos).catch(console.error); st.setPosition(pos); }} style={{
                      display: 'flex', alignItems: 'center', padding: '8px 12px', borderRadius: 8, gap: 12,
                      background: state === 'playing' ? 'var(--onyx-accent-dim)' : 'transparent',
                      border: `1px solid ${state === 'playing' ? 'var(--onyx-accent-edge)' : 'transparent'}`,
                      marginBottom: 2, width: '100%', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                    }}>
                      <div style={{ fontFamily: MONO, fontSize: 11, color: state === 'playing' ? 'var(--onyx-accent)' : 'var(--onyx-text-mute)', width: 22 }}>{String(c.n).padStart(2, '0')}</div>
                      <div style={{ flex: 1, fontSize: 13, fontWeight: state === 'playing' ? 600 : 400, color: state === 'done' ? 'var(--onyx-text-mute)' : 'var(--onyx-text)' }}>{c.t}</div>
                      <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)' }}>{fmtTime(c.dur)}</div>
                      {state === 'done' && <span style={{ display: 'inline-flex', color: 'var(--onyx-text-mute)' }}><Icon name="check" size={11} /></span>}
                      {state === 'playing' && <div style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--onyx-accent)', boxShadow: '0 0 12px var(--onyx-accent)' }} />}
                      {state === 'next' && <div style={{ width: 6, height: 6 }} />}
                    </button>
                  );
                })}
              </div>
            </Glass>

            <Glass translucent={st.translucent} style={{ flex: 1, padding: 20, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
                <div style={{ fontFamily: SERIF, fontSize: 16, fontWeight: 500 }}>Bookmarks</div>
                <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.08em' }}>{playerBookmarks.length}</div>
                <button onClick={addBookmark} style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 10, color: 'var(--onyx-accent)', letterSpacing: '0.06em', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }} title="Bookmark current moment">
                  <Icon name="plus" size={11} /> ADD HERE
                </button>
              </div>
              <div style={{ flex: 1, overflow: 'auto', marginRight: -8, paddingRight: 8 }}>
                {playerBookmarks.length === 0 ? (
                  <div style={{ padding: '24px 0', textAlign: 'center', fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.08em' }}>
                    No bookmarks yet
                  </div>
                ) : playerBookmarks.map((bm, i) => (
                  <button key={`${bm.time}-${i}`} onClick={() => seekAudio(bm.time).catch(console.error)} style={{ padding: '11px 0', background: 'none', border: 'none', borderBottom: i < playerBookmarks.length - 1 ? '1px solid var(--onyx-line)' : 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', color: 'inherit', width: '100%' }}>
                    <div style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, color: 'var(--onyx-accent)', marginBottom: 4 }}>{fmtTime(bm.time)}</div>
                    <div style={{ fontSize: 13, color: 'var(--onyx-text)', lineHeight: 1.3 }}>{bm.title}</div>
                  </button>
                ))}
              </div>
            </Glass>

          </div>
        </div>
      </div>
    </div>
  );
}
