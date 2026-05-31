import React, { useState, useEffect, useRef } from 'react';
import {
  openPlaybackSession, playAudio, pauseAudio, closeActiveSession,
  seekAudio, setSpeed as setAudioSpeed, setVolume as setAudioVolume,
  createBookmark, getMe, fetchItem,
} from '../api/abs';
import type { CSSProperties } from 'react';
import type { OnyxState } from '../state/onyx';
import {
  SPEEDS, chapterAt, chapterStart, fmtTime, fmtRemaining,
  bookTitle, bookAuthor, bookSeries, bookNarrator, bookDur, bookChapters,
} from '../state/onyx';
import Glass from '../components/chrome/Glass';
import Cover from '../components/Cover';
import Icon from '../components/Icon';
import Waveform from '../components/Waveform';
import VolumeControl from '../components/chrome/VolumeControl';
import DeviceSelector from '../components/chrome/DeviceSelector';
import { getCachedReview, setCachedReview } from '../api/reviewCache';
import type { OLRatings, OLShelves } from '../api/reviewCache';
import MiniPlayer from '../components/player/MiniPlayer';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const MONO = "'JetBrains Mono', ui-monospace, monospace";

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
  // Metadata derives from the focused book; playback position/state stays on currentBook.
  const b = st.focusedBook ?? st.currentBook;
  if (!b) return null;

  const isFocusedDifferent = st.focusedBookId !== null && st.focusedBookId !== st.currentBookId;

  // Fetched chapters for the focused book when it differs from the playing book.
  // Library-list items don't include chapter data, so we fetch the full item.
  const [fetchedFocusedChapters, setFetchedFocusedChapters] = useState(bookChapters(b));

  useEffect(() => {
    const fid = st.focusedBookId;
    if (!fid) return;
    if (fid === st.currentBookId && st.currentBookChapters.length > 0) {
      setFetchedFocusedChapters(st.currentBookChapters);
      return;
    }
    let cancelled = false;
    fetchItem(st.serverUrl, fid)
      .then(item => { if (!cancelled) setFetchedFocusedChapters(bookChapters(item)); })
      .catch(console.error);
    return () => { cancelled = true; };
  }, [st.focusedBookId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Chapters for the chapter list come from the focused book (fetched on demand).
  // For the waveform scrubber we still use currentBookChapters so position maps correctly.
  const displayChapters = isFocusedDifferent
    ? fetchedFocusedChapters
    : st.currentBookChapters;
  const chapters = st.currentBookChapters; // waveform/position only
  const { idx: chIdx, local: chLocal, chapter: curCh } = chapterAt(chapters, st.position);

  const autoPlayNext = localStorage.getItem('onyx.playback.autoPlayNext') !== 'false';
  const raw = localStorage.getItem('onyx.playback.sleepDefault') ?? '"Off"';
  const sleepDefault = JSON.parse(raw) as string;

  const playerBookmarks = st.bookmarks.filter(bm => bm.libraryItemId === (st.focusedBookId ?? st.currentBookId));

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

  // undefined = not fetched yet, null = fetched but not found, string = OL work key
  const [olWorkKey, setOlWorkKey] = useState<string | null | undefined>(undefined);
  const [olRatings, setOlRatings] = useState<OLRatings | null>(null);
  const [olShelves, setOlShelves] = useState<OLShelves | null>(null);

  useEffect(() => {
    setOlWorkKey(undefined);
    setOlRatings(null);
    setOlShelves(null);
    if (!b) return;

    // Serve from cache immediately if fresh — no network request.
    const cached = getCachedReview(b.id);
    if (cached) {
      if (st.enableOpenLibrary) {
        setOlWorkKey(cached.olWorkKey);
        setOlRatings(cached.olRatings);
        setOlShelves(cached.olShelves);
      }
      return;
    }

    // Cache miss — fetch Open Library.
    let cancelled = false;

    (async () => {
      try {
        const meta = b.media?.metadata;
        const isbn = meta?.isbn13 || meta?.isbn10 || meta?.isbn;

        let olKey: string | null = null;
        let olRat: OLRatings | null = null;
        let olSh: OLShelves | null = null;

        if (st.enableOpenLibrary) {
          let rawWorkId: string | null = null;
          if (isbn) {
            const res = await fetch(
              `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`,
            );
            const data = await res.json();
            rawWorkId = data[`ISBN:${isbn}`]?.works?.[0]?.key ?? null;
          }
          if (!rawWorkId) {
            const res = await fetch(
              `https://openlibrary.org/search.json?title=${encodeURIComponent(bookTitle(b))}&author=${encodeURIComponent(bookAuthor(b))}&limit=1`,
            );
            const data = await res.json();
            rawWorkId = data.docs?.[0]?.key ?? null;
          }
          if (rawWorkId) {
            olKey = rawWorkId.replace(/^\/works\//, '');
            const [ratRes, shRes] = await Promise.all([
              fetch(`https://openlibrary.org/works/${olKey}/ratings.json`),
              fetch(`https://openlibrary.org/works/${olKey}/bookshelves.json`),
            ]);
            const [ratData, shData] = await Promise.all([ratRes.json(), shRes.json()]);
            olRat = { average: ratData.summary?.average ?? null, count: ratData.summary?.count ?? null };
            olSh  = { wantToRead: shData.counts?.want_to_read ?? null, reading: shData.counts?.currently_reading ?? null, alreadyRead: shData.counts?.already_read ?? null };
          }
        }

        if (cancelled) return;

        if (st.enableOpenLibrary) {
          setOlWorkKey(olKey);
          setOlRatings(olRat);
          setOlShelves(olSh);
        }

        setCachedReview(b.id, { olWorkKey: olKey, olRatings: olRat, olShelves: olSh });
      } catch (e) {
        console.error('[review] fetch failed:', e);
        if (!cancelled) setOlWorkKey(null);
      }
    })();
    return () => { cancelled = true; };
  }, [st.currentBookId, st.enableOpenLibrary]); // eslint-disable-line react-hooks/exhaustive-deps

  function parseSleepDefault(raw: string): SleepMode {
    if (raw === '15m') return 15;
    if (raw === '30m') return 30;
    if (raw === '1h') return 60;
    if (raw === 'End of chapter') return 'chapter';
    return null;
  }
  const [sleepMode, setSleepMode] = useState<SleepMode>(parseSleepDefault(sleepDefault));
  const [sleepRemain, setSleepRemain] = useState(0);
  const [sleepOpen, setSleepOpen] = useState(false);

  // Preview card animation state
  const [showTransport, setShowTransport] = useState(false);
  const [btnOut, setBtnOut] = useState(false);
  const [btnMounted, setBtnMounted] = useState(true);
  const [contentVisible, setContentVisible] = useState(false);
  const sleepRef = useRef<HTMLDivElement>(null);
  const chapterAtStart = useRef(chIdx);
  const prevChIdxRef = useRef(chIdx);

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(900);

  const leftColRef = useRef<HTMLDivElement>(null);
  const [leftColumnWidth, setLeftColumnWidth] = useState(480);

  const isMiniPlayerVisible = isFocusedDifferent && !!st.currentBookId;
  const maxCoverRatio = isMiniPlayerVisible ? 0.35 : 0.40;
  const maxByHeight = Math.max(120, Math.round(containerHeight * maxCoverRatio));
  const maxByWidth  = Math.max(120, Math.round(leftColumnWidth * 0.85));
  const coverSize   = Math.min(maxByHeight, maxByWidth, leftColumnWidth);

  const waveformRef = useRef<HTMLDivElement>(null);
  const [waveWidth, setWaveWidth] = useState(600);

  const transportRef = useRef<HTMLDivElement>(null);
  const [transportWidth, setTransportWidth] = useState(700);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      setContainerHeight(entries[0].contentRect.height);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!leftColRef.current) return;
    const ro = new ResizeObserver(entries => {
      setLeftColumnWidth(entries[0].contentRect.width);
    });
    ro.observe(leftColRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!waveformRef.current) return;
    const ro = new ResizeObserver(entries => {
      setWaveWidth(entries[0].contentRect.width);
    });
    ro.observe(waveformRef.current);
    return () => ro.disconnect();
  }, []);

  // When the waveform container mounts after preview card expansion,
  // the empty-deps effect above has already run and won't re-fire.
  // This effect takes a fresh measurement when showTransport becomes true.
  useEffect(() => {
    if (!showTransport || !waveformRef.current) return;
    setWaveWidth(waveformRef.current.getBoundingClientRect().width || 600);
  }, [showTransport]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!transportRef.current) return;
    const ro = new ResizeObserver(entries => {
      setTransportWidth(entries[0].contentRect.width);
    });
    ro.observe(transportRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (typeof sleepMode === 'number') setSleepRemain(sleepMode * 60);
    if (sleepMode === 'chapter') chapterAtStart.current = chIdx;
  }, [sleepMode]); // chIdx intentionally excluded

  useEffect(() => {
    if (typeof sleepMode !== 'number' || !st.playing) return;
    const t = setInterval(() => {
      setSleepRemain(r => {
        if (r <= 1) {
          pauseAudio().catch(console.error);
          st.setPlaying(false);
          setSleepMode(null);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [sleepMode, st.playing]);

  useEffect(() => {
    if (sleepMode === 'chapter' && chIdx !== chapterAtStart.current) {
      pauseAudio().catch(console.error);
      st.setPlaying(false);
      setSleepMode(null);
    }
  }, [chIdx]); // sleepMode/setPlaying excluded intentionally

  useEffect(() => {
    if (chIdx > prevChIdxRef.current && st.playing && !autoPlayNext) {
      pauseAudio().catch(console.error);
      st.setPlaying(false);
    }
    prevChIdxRef.current = chIdx;
  }, [chIdx]); // st.playing/autoPlayNext read at effect fire time; chIdx is the trigger

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

  // Reset preview animation when the user focuses a new book.
  useEffect(() => {
    setShowTransport(false);
    setBtnOut(false);
    setBtnMounted(true);
    setContentVisible(false);
  }, [st.focusedBookId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fade transport contents in 300ms after the card starts expanding.
  useEffect(() => {
    if (!showTransport) { setContentVisible(false); return; }
    const t = setTimeout(() => setContentVisible(true), 300);
    return () => clearTimeout(t);
  }, [showTransport]);

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
      if (isFocusedDifferent && !st.playing) {
        // User wants to start the focused (different) book.
        const focusedId = st.focusedBookId!;
        const { sessionId } = await openPlaybackSession(st.serverUrl, focusedId);
        st.setSessionId(sessionId);
        st.setSessionReady(true);
        st.setCurrentBookId(focusedId);
        await playAudio();
      } else if (!st.sessionReady) {
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

  const handlePlayFocused = () => {
    const fid = st.focusedBookId!;
    setBtnOut(true);
    setTimeout(() => setShowTransport(true), 50);
    setTimeout(() => setBtnMounted(false), 300);
    void (async () => {
      try {
        await closeActiveSession().catch(() => {});
        st.setSessionReady(false);
        st.setSessionId('');
        st.setPlaying(false);
        const { sessionId } = await openPlaybackSession(st.serverUrl, fid);
        st.setSessionId(sessionId);
        st.setSessionReady(true);
        st.setCurrentBookId(fid);
        await playAudio().catch(console.error);
        // Optimistically mark as playing immediately — the playback-tick event
        // from Rust confirms this within ~1s, but setting it here prevents the
        // UI from showing a paused state during that delay window.
        st.setPlaying(true);
      } catch (err) {
        console.error('[Player] play focused book failed:', err);
      }
    })();
  };

  return (
    <div ref={containerRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '12px 32px 24px', minHeight: 0, width: '100%', maxWidth: '100%', overflow: 'hidden', position: 'relative' }}>

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

      <div style={{ flex: 1, display: 'flex', gap: 32, alignItems: 'stretch', minHeight: 0, overflow: 'hidden' }}>

        <div ref={leftColRef} style={{ minWidth: 0, maxWidth: 360, flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', minHeight: 0, paddingBottom: isFocusedDifferent ? 72 : 0 }}>
          <div style={{ position: 'absolute', inset: '5% 5% 0 5%', borderRadius: 24, background: 'radial-gradient(50% 50% at 50% 50%, rgba(212,166,74,0.28), transparent 70%)', filter: 'blur(60px)', zIndex: 0 }} />
          <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: coverSize, aspectRatio: '1 / 1', overflow: 'hidden' }}>
            <Cover item={b} size={coverSize} fill serverUrl={st.serverUrl} style={{ transition: 'width 0.3s ease, height 0.3s ease' }} />
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

          <Glass translucent={st.translucent} style={{
            padding: (isFocusedDifferent && !showTransport) ? '14px 26px' : 26,
            maxHeight: (isFocusedDifferent && !showTransport) ? 68 : 700,
            overflow: 'hidden',
            transition: 'max-height 350ms ease-out, padding 300ms ease-out',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: (isFocusedDifferent && !showTransport) ? 'center' : 'flex-start',
          }}>
            {/* Preview: Play this book button */}
            {isFocusedDifferent && btnMounted && (
              <div style={{
                display: 'flex', justifyContent: 'center', alignItems: 'center',
                transform: btnOut ? 'translateY(40px)' : 'translateY(0)',
                opacity: btnOut ? 0 : 1,
                transition: 'transform 300ms ease-in, opacity 300ms ease-in',
              }}>
                <button
                  onClick={handlePlayFocused}
                  style={{
                    width: 280, padding: '11px 0',
                    background: 'var(--onyx-accent)', border: 'none', borderRadius: 8,
                    color: 'var(--onyx-bg)', cursor: 'pointer',
                    fontFamily: MONO, fontSize: 12, fontWeight: 600,
                    letterSpacing: '0.08em', textTransform: 'uppercase' as const,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  }}
                >
                  <Icon name="play" size={13} /> Play this book
                </button>
              </div>
            )}
            {/* Full transport: live or post-expansion */}
            {(!isFocusedDifferent || showTransport) && (
              <div style={{
                opacity: (isFocusedDifferent && showTransport) ? (contentVisible ? 1 : 0) : 1,
                transition: 'opacity 250ms ease-in',
              }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 22 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--onyx-text-mute)' }}>Now playing · {bookTitle(st.currentBook ?? b)}</div>
                  <div style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 500, marginTop: 4, letterSpacing: '-0.005em' }}>{curCh.t}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-dim)' }}>
                  <span style={{ fontSize: 14, color: 'var(--onyx-text)', fontWeight: 500 }}>{fmtTime(chLocal)}</span>
                  <span style={{ color: 'var(--onyx-text-mute)' }}>/</span>
                  <span>{fmtTime(curCh.dur)}</span>
                </div>
              </div>

              <div ref={waveformRef} onClick={onScrub} style={{ cursor: 'pointer', position: 'relative', width: '100%', flex: 1, minWidth: 0 }}>
                <Waveform width={waveWidth} height={72} progress={chLocal / curCh.dur} color="var(--onyx-accent)" dim="rgba(255,255,255,0.15)" bars={140} flat />
              </div>

              <div ref={transportRef} style={{ marginTop: 22, display: 'flex', alignItems: 'center', justifyContent: 'space-between', minWidth: 0, overflow: 'visible' }}>

              {/* Left group — speed pills; fixed width to balance the right group */}
              <div style={{ flex: '0 0 auto', minWidth: 160, display: 'flex', gap: 6 }}>
                {transportWidth >= 620 ? (
                  SPEEDS.map(s => (
                    <button key={s} onClick={() => { st.setSpeed(s); setAudioSpeed(parseFloat(s)).catch(console.error); }} style={{
                      padding: '7px 12px', borderRadius: 6, fontFamily: MONO, fontSize: 11,
                      background: s === st.speed ? 'var(--onyx-accent-dim)' : 'transparent',
                      color: s === st.speed ? 'var(--onyx-accent)' : 'var(--onyx-text-dim)',
                      border: `1px solid ${s === st.speed ? 'var(--onyx-accent-edge)' : 'var(--onyx-glass-edge)'}`,
                      fontWeight: s === st.speed ? 600 : 400,
                      cursor: 'pointer',
                    }}>{s}×</button>
                  ))
                ) : (
                  <select
                    value={st.speed}
                    onChange={e => { st.setSpeed(e.target.value); setAudioSpeed(parseFloat(e.target.value)).catch(console.error); }}
                    style={{
                      height: 44,
                      borderRadius: 10,
                      background: 'var(--onyx-glass)',
                      border: '1px solid var(--onyx-glass-edge)',
                      color: 'var(--onyx-text)',
                      fontFamily: 'inherit',
                      fontSize: 12,
                      flexShrink: 1,
                      minWidth: 48,
                      paddingLeft: 8,
                      paddingRight: 8,
                      cursor: 'pointer',
                      outline: 'none',
                    }}
                  >
                    {SPEEDS.map(s => <option key={s} value={s}>{s}×</option>)}
                  </select>
                )}
              </div>

              {/* Center group — primary transport controls; flex: 1 with centered content
                  ensures play/pause/skip always sit at the geometric center of the row */}
              <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 14 }}>
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

              {/* Right group — secondary controls (bookmark, sleep timer); matches left group
                  width so the center group remains geometrically centered regardless of content */}
              <div style={{ flex: '0 0 auto', minWidth: 160, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button onClick={addBookmark} style={transportBtnSmall()} title="Bookmark this moment">
                  <Icon name="bookmark" size={15} />
                </button>
                <div ref={sleepRef} style={{ position: 'relative', zIndex: 200 }}>
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
                      <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>{sleepLabel}</span>
                    )}
                  </button>
                  {sleepOpen && (
                    <div style={{ position: 'absolute', bottom: 'calc(100% + 8px)', right: 0, background: 'var(--onyx-panel2)', border: '1px solid var(--onyx-line)', borderRadius: 10, boxShadow: '0 16px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(212,166,74,0.08)', padding: 6, zIndex: 300, minWidth: 170 }}>
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
            </div>
            )}
          </Glass>

          <div style={{ flex: 1, display: 'flex', gap: 18, minHeight: 0, overflow: 'hidden' }}>

            {/* ── Details panel ─────────────────────────────────────── */}
            <Glass translucent={st.translucent} style={{ flex: 1, minWidth: 0, padding: 20, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
              <div style={{ fontFamily: SERIF, fontSize: 16, fontWeight: 500, marginBottom: 14 }}>Details</div>
              <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 0, marginRight: -8, paddingRight: 8 }}>
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
                          {detailRow('Last played', new Date(prog.lastUpdate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }))}
                        </>
                      ) : (
                        <div style={{ padding: '12px 0', fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em' }}>Not started</div>
                      )}

                      {/* Open Library */}
                      {olWorkKey !== undefined && (
                        <>
                          <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--onyx-text-mute)', marginTop: 16, marginBottom: 4, paddingBottom: 4 }}>Open Library</div>
                          {olWorkKey === null ? (
                            <div style={{ padding: '8px 0', fontSize: 12, color: 'var(--onyx-text-mute)', fontStyle: 'italic' }}>No data found</div>
                          ) : (
                            <>
                              <div style={{ padding: '8px 0', borderBottom: '1px solid var(--onyx-line)', fontSize: 12.5, color: 'var(--onyx-text-dim)' }}>
                                {olRatings?.average != null
                                  ? `${olRatings.average.toFixed(1)} / 5`
                                  : '—'}
                                {olRatings?.count != null
                                  ? <span style={{ color: 'var(--onyx-text-mute)', fontFamily: MONO, fontSize: 10 }}>{' '}· {olRatings.count.toLocaleString()} ratings</span>
                                  : null}
                              </div>
                              {olShelves && (
                                <div style={{ padding: '8px 0', borderBottom: '1px solid var(--onyx-line)', fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.04em', lineHeight: 1.8 }}>
                                  <div>Want to read: <span style={{ color: 'var(--onyx-text-dim)' }}>{olShelves.wantToRead?.toLocaleString() ?? '—'}</span></div>
                                  <div>Reading: <span style={{ color: 'var(--onyx-text-dim)' }}>{olShelves.reading?.toLocaleString() ?? '—'}</span></div>
                                  <div>Read: <span style={{ color: 'var(--onyx-text-dim)' }}>{olShelves.alreadyRead?.toLocaleString() ?? '—'}</span></div>
                                </div>
                              )}
                              <a
                                href={`https://openlibrary.org/works/${olWorkKey}`}
                                target="_blank"
                                rel="noreferrer"
                                style={{ display: 'inline-block', marginTop: 10, fontFamily: MONO, fontSize: 10, color: 'var(--onyx-accent)', letterSpacing: '0.06em', textTransform: 'uppercase', textDecoration: 'none' }}
                              >
                                View on Open Library ↗
                              </a>
                            </>
                          )}
                        </>
                      )}

                    </>
                  );
                })()}
              </div>
            </Glass>

            {/* ── Chapters panel ────────────────────────────────────── */}
            <Glass translucent={st.translucent} style={{ flex: 1, minWidth: 0, padding: 20, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
                <div style={{ fontFamily: SERIF, fontSize: 16, fontWeight: 500 }}>Chapters</div>
                <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.08em' }}>{displayChapters.length} · {bookDur(b)} total</div>
              </div>
              {/* Hint shown when browsing a book that is not currently playing —
                  chapter navigation is disabled in this state until playback starts */}
              {isFocusedDifferent && (
                <div style={{
                  fontFamily: MONO, fontSize: 10,
                  color: 'var(--onyx-text-mute)', letterSpacing: '0.06em',
                  marginBottom: 8,
                }}>
                  Press Play to enable chapter navigation
                </div>
              )}
              <div style={{ flex: 1, overflow: 'auto', marginRight: -8, paddingRight: 8 }}>
                {displayChapters.map((c, i) => {
                  const state = i < chIdx ? 'done' : i === chIdx ? 'playing' : 'next';
                  return (
                    <button key={c.n} onClick={async () => {
                      const pos = chapterStart(displayChapters, i);
                      if (!st.focusedBookId || st.focusedBookId === st.currentBookId) {
                        // Seek to the selected chapter's start position
                        await seekAudio(pos).catch(console.error);
                        st.setPosition(pos);

                        // If the book was paused, start playback from the selected chapter.
                        // playAudio() tells LibVLC to begin streaming; setPlaying(true) updates
                        // the UI optimistically before the playback-tick event confirms it.
                        if (!st.playing) {
                          await playAudio().catch(console.error);
                          st.setPlaying(true);
                        }
                      } else {
                        await closeActiveSession().catch(() => {});
                        st.setSessionReady(false);
                        st.setSessionId('');
                        st.setPlaying(false);
                        try {
                          const { sessionId } = await openPlaybackSession(st.serverUrl, st.focusedBookId, pos);
                          st.setSessionId(sessionId);
                          st.setSessionReady(true);
                          st.setCurrentBookId(st.focusedBookId);
                          await playAudio().catch(console.error);
                          // Optimistically mark as playing — playback-tick will confirm within 1s
                          st.setPlaying(true);
                          st.setPosition(pos);
                        } catch (err) {
                          console.error('[Player] chapter-click playback failed:', err);
                        }
                      }
                    }} style={{
                      display: 'flex', alignItems: 'center', padding: '8px 12px', borderRadius: 8, gap: 12,
                      background: state === 'playing' ? 'var(--onyx-accent-dim)' : 'transparent',
                      border: `1px solid ${state === 'playing' ? 'var(--onyx-accent-edge)' : 'transparent'}`,
                      marginBottom: 2, width: '100%', fontFamily: 'inherit', textAlign: 'left',
                      // Dim and block interaction when browsing a non-playing book —
                      // chapter navigation only makes sense once that book is playing.
                      cursor: isFocusedDifferent ? 'default' : 'pointer',
                      opacity: isFocusedDifferent ? 0.45 : 1,
                      pointerEvents: isFocusedDifferent ? 'none' : 'auto',
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

            <Glass translucent={st.translucent} style={{ flex: 1, minWidth: 0, padding: 20, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
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
      <MiniPlayer st={st} />
    </div>
  );
}
