import { useState, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { OnyxState, Bookmark } from '../state/onyx';
import { CHAPTERS, BOOKMARKS, SPEEDS, chapterAt, chapterStart, fmtTime } from '../state/onyx';
import Glass from '../components/chrome/Glass';
import Cover from '../components/Cover';
import Icon from '../components/Icon';
import Waveform from '../components/Waveform';
import VolumeControl from '../components/chrome/VolumeControl';
import DeviceSelector from '../components/chrome/DeviceSelector';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const MONO = "'JetBrains Mono', ui-monospace, monospace";

type SleepMode = null | number | 'chapter';

interface SessionBookmark extends Bookmark { id: number; }

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
  const { idx: chIdx, local: chLocal, chapter: curCh } = chapterAt(CHAPTERS, st.position);

  // ── Bookmarks ──────────────────────────────────────────────────────────────
  const [userBookmarks, setUserBookmarks] = useState<SessionBookmark[]>([]);
  const addBookmarkHere = () => {
    setUserBookmarks(prev => [{
      id: Date.now(),
      ts: fmtTime(st.position),
      secs: chLocal,
      ch: curCh.n,
      label: `Bookmark in "${curCh.t}"`,
      date: 'Just now',
    }, ...prev]);
  };
  const allBookmarks: (SessionBookmark | Bookmark)[] = [...userBookmarks, ...BOOKMARKS];

  // ── Sleep timer ────────────────────────────────────────────────────────────
  const [sleepMode, setSleepMode] = useState<SleepMode>(null);
  const [sleepRemain, setSleepRemain] = useState(0);
  const [sleepOpen, setSleepOpen] = useState(false);
  const sleepRef = useRef<HTMLDivElement>(null);
  const chapterAtStart = useRef(chIdx);

  // Seed countdown when mode changes.
  useEffect(() => {
    if (typeof sleepMode === 'number') setSleepRemain(sleepMode * 60);
    if (sleepMode === 'chapter') chapterAtStart.current = chIdx;
  }, [sleepMode]); // chIdx intentionally excluded — captured only at mode-set time

  // Tick down fixed-minutes timer while playing.
  useEffect(() => {
    if (typeof sleepMode !== 'number' || !st.playing) return;
    const t = setInterval(() => {
      setSleepRemain(r => {
        if (r <= 1) { st.setPlaying(false); setSleepMode(null); return 0; }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [sleepMode, st.playing]); // st.setPlaying is stable; excluded intentionally

  // End-of-chapter mode — pause when chapter changes.
  useEffect(() => {
    if (sleepMode === 'chapter' && chIdx !== chapterAtStart.current) {
      st.setPlaying(false);
      setSleepMode(null);
    }
  }, [chIdx]); // sleepMode/setPlaying excluded intentionally

  // Close sleep popover on outside click.
  useEffect(() => {
    if (!sleepOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!sleepRef.current?.contains(e.target as Node)) setSleepOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [sleepOpen]);

  const sleepLabel: string | null = sleepMode == null
    ? null
    : sleepMode === 'chapter'
      ? 'End of chapter'
      : `${Math.floor(sleepRemain / 60)}:${String(sleepRemain % 60).padStart(2, '0')}`;

  // ── Waveform scrub ─────────────────────────────────────────────────────────
  const onScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const chStart = chapterStart(CHAPTERS, chIdx);
    st.setPosition(chStart + frac * curCh.dur);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '12px 32px 24px', minHeight: 0 }}>

      {/* Breadcrumb + volume + device */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18, fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--onyx-text-mute)' }}>
        <button onClick={() => st.setScreen('library')} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'var(--onyx-text-dim)', cursor: 'pointer', padding: 4, fontFamily: 'inherit', fontSize: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit' }}>
          <Icon name="chevron-left" size={12} /> Library
        </button>
        <span>·</span>
        <span>{b.series}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, textTransform: 'none', letterSpacing: 'normal' }}>
          <VolumeControl st={st} />
          <DeviceSelector st={st} />
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', gap: 32, alignItems: 'stretch', minHeight: 0 }}>

        {/* Cover stage */}
        <div style={{ width: 480, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', flexShrink: 0 }}>
          <div style={{ position: 'absolute', inset: '5% 5% 0 5%', borderRadius: 24, background: 'radial-gradient(50% 50% at 50% 50%, rgba(212,166,74,0.28), transparent 70%)', filter: 'blur(60px)', zIndex: 0 }} />
          <div style={{ position: 'relative', zIndex: 1 }}>
            <Cover item={b} size={420} />
          </div>
          <div style={{ marginTop: 32, textAlign: 'center', position: 'relative', zIndex: 1 }}>
            <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--onyx-accent)', marginBottom: 8 }}>{b.series}</div>
            <div style={{ fontFamily: SERIF, fontSize: 48, fontWeight: 500, lineHeight: 1, letterSpacing: '-0.02em' }}>{b.title}</div>
            <div style={{ marginTop: 10, fontSize: 16, color: 'var(--onyx-text-dim)' }}>by {b.author}</div>
            <div style={{ marginTop: 2, fontSize: 13, color: 'var(--onyx-text-mute)' }}>narrated by {b.narrator}</div>
          </div>
        </div>

        {/* Right column */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>

          {/* Transport card */}
          <Glass translucent={st.translucent} style={{ padding: 26 }}>
            {/* Now playing header */}
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

            {/* Waveform scrubber */}
            <div onClick={onScrub} style={{ cursor: 'pointer', position: 'relative' }}>
              <Waveform width={680} height={72} progress={chLocal / curCh.dur} color="var(--onyx-accent)" dim="rgba(255,255,255,0.15)" bars={140} flat />
            </div>

            {/* Controls row */}
            <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>

              {/* Speed pills */}
              <div style={{ display: 'flex', gap: 6 }}>
                {SPEEDS.map(s => (
                  <button key={s} onClick={() => st.setSpeed(s)} style={{
                    padding: '7px 12px', borderRadius: 6, fontFamily: MONO, fontSize: 11,
                    background: s === st.speed ? 'var(--onyx-accent-dim)' : 'transparent',
                    color: s === st.speed ? 'var(--onyx-accent)' : 'var(--onyx-text-dim)',
                    border: `1px solid ${s === st.speed ? 'var(--onyx-accent-edge)' : 'var(--onyx-glass-edge)'}`,
                    fontWeight: s === st.speed ? 600 : 400,
                    cursor: 'pointer',
                  }}>{s}×</button>
                ))}
              </div>

              {/* Transport */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <button onClick={() => st.setPosition(Math.max(0, st.position - 30))} title="Back 30s" style={transportBtn()}>
                  <Icon name="skip-back" size={20} />
                </button>
                <button
                  onClick={() => st.setPlaying(p => !p)}
                  title={st.playing ? 'Pause (space)' : 'Play (space)'}
                  style={{ width: 64, height: 64, borderRadius: 32, background: 'var(--onyx-accent)', color: 'var(--onyx-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: 'none', boxShadow: '0 12px 32px rgba(212,166,74,0.4)' }}
                >
                  <span style={{ display: 'inline-flex', marginLeft: st.playing ? 0 : 3 }}>
                    <Icon name={st.playing ? 'pause' : 'play'} size={26} />
                  </span>
                </button>
                <button onClick={() => st.setPosition(Math.min(st.bookSecs, st.position + 30))} title="Forward 30s" style={transportBtn()}>
                  <Icon name="skip-forward" size={20} />
                </button>
              </div>

              {/* Bookmark + sleep */}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={addBookmarkHere} style={transportBtnSmall()} title="Bookmark this moment">
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

          {/* Chapters + Bookmarks panels */}
          <div style={{ flex: 1, display: 'flex', gap: 18, minHeight: 0 }}>

            {/* Chapters */}
            <Glass translucent={st.translucent} style={{ flex: 1.2, padding: 20, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
                <div style={{ fontFamily: SERIF, fontSize: 16, fontWeight: 500 }}>Chapters</div>
                <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.08em' }}>{CHAPTERS.length} · {b.dur} total</div>
              </div>
              <div style={{ flex: 1, overflow: 'auto', marginRight: -8, paddingRight: 8 }}>
                {CHAPTERS.map((c, i) => {
                  const state = i < chIdx ? 'done' : i === chIdx ? 'playing' : 'next';
                  return (
                    <button key={c.n} onClick={() => st.setPosition(chapterStart(CHAPTERS, i))} style={{
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

            {/* Bookmarks */}
            <Glass translucent={st.translucent} style={{ flex: 1, padding: 20, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
                <div style={{ fontFamily: SERIF, fontSize: 16, fontWeight: 500 }}>Bookmarks</div>
                <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.08em' }}>{allBookmarks.length}</div>
                <button onClick={addBookmarkHere} style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 10, color: 'var(--onyx-accent)', letterSpacing: '0.06em', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }} title="Bookmark current moment">
                  <Icon name="plus" size={11} /> ADD HERE
                </button>
              </div>
              <div style={{ flex: 1, overflow: 'auto', marginRight: -8, paddingRight: 8 }}>
                {allBookmarks.map((bm, i) => (
                  <button key={'id' in bm ? bm.id : i} onClick={() => st.setPosition(chapterStart(CHAPTERS, bm.ch - 1) + bm.secs)} style={{ padding: '11px 0', background: 'none', border: 'none', borderBottom: i < allBookmarks.length - 1 ? '1px solid var(--onyx-line)' : 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', color: 'inherit', width: '100%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <div style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, color: 'var(--onyx-accent)' }}>{bm.ts}</div>
                      <div style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--onyx-text-mute)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Ch. {bm.ch} · {bm.date}</div>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--onyx-text)', lineHeight: 1.3 }}>{bm.label}</div>
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
