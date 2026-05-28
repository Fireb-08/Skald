// Onyx — Player screen (working). Scrub waveform, ±30s, play/pause, speed,
// volume, audio device, chapter list with click-to-jump, bookmark stub.

function Player({ st }) {
  const b = st.currentBook;
  const { idx: chIdx, local: chLocal, chapter: curCh } = chapterAt(st.position);

  // --- Bookmarks (user-added in this session, merged with the seed list for display) ---
  const [userBookmarks, setUserBookmarks] = React.useState([]);
  const addBookmarkHere = () => {
    setUserBookmarks(prev => [{
      id: Date.now(),
      ts: fmtTime(st.position),
      secs: chLocal,
      ch: curCh.n,
      label: `Bookmark in “${curCh.t}”`,
      date: 'Just now',
    }, ...prev]);
  };
  const allBookmarks = [...userBookmarks, ...BOOKMARKS];

  // --- Sleep timer ---
  // sleepMode: null = off | number (mins) | 'chapter' = end of current chapter.
  const [sleepMode, setSleepMode] = React.useState(null);
  const [sleepRemain, setSleepRemain] = React.useState(0);
  const [sleepOpen, setSleepOpen] = React.useState(false);
  const sleepRef = React.useRef(null);
  const chapterAtStart = React.useRef(chIdx);

  // When picking a fixed-minutes timer, seed the countdown.
  React.useEffect(() => {
    if (typeof sleepMode === 'number') setSleepRemain(sleepMode * 60);
    if (sleepMode === 'chapter') chapterAtStart.current = chIdx;
  }, [sleepMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tick down fixed-minutes timer while playing; pause + clear when it hits 0.
  React.useEffect(() => {
    if (typeof sleepMode !== 'number' || !st.playing) return;
    const t = setInterval(() => {
      setSleepRemain(r => {
        if (r <= 1) { st.setPlaying(false); setSleepMode(null); return 0; }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [sleepMode, st.playing]); // eslint-disable-line react-hooks/exhaustive-deps

  // "End of chapter" mode — pause when the chapter index changes.
  React.useEffect(() => {
    if (sleepMode === 'chapter' && chIdx !== chapterAtStart.current) {
      st.setPlaying(false);
      setSleepMode(null);
    }
  }, [chIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close sleep popover on outside click.
  React.useEffect(() => {
    if (!sleepOpen) return;
    const onDown = (e) => { if (!sleepRef.current?.contains(e.target)) setSleepOpen(false); };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [sleepOpen]);

  const sleepLabel = sleepMode == null
    ? null
    : sleepMode === 'chapter'
      ? 'End of chapter'
      : `${Math.floor(sleepRemain / 60)}:${String(sleepRemain % 60).padStart(2, '0')}`;

  // Scrub: click on waveform jumps the position within the current chapter
  const onScrub = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const chStart = chapterStart(chIdx);
    st.setPosition(chStart + frac * curCh.dur);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '12px 32px 24px', minHeight: 0 }}>
      {/* top crumb + volume + device */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18, fontFamily: ONYX.mono, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: ONYX.textMute }}>
        <button onClick={() => st.setScreen('library')} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: ONYX.textDim, cursor: 'pointer', padding: 4, fontFamily: 'inherit', fontSize: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit' }}>
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
            <Cover book={b} w={420} />
          </div>
          <div style={{ marginTop: 32, textAlign: 'center', position: 'relative', zIndex: 1 }}>
            <div style={{ fontFamily: ONYX.mono, fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: ONYX.accent, marginBottom: 8 }}>{b.series}</div>
            <div style={{ fontFamily: ONYX.serif, fontSize: 48, fontWeight: 500, lineHeight: 1, letterSpacing: '-0.02em' }}>{b.title}</div>
            <div style={{ marginTop: 10, fontSize: 16, color: ONYX.textDim }}>by {b.author}</div>
            <div style={{ marginTop: 2, fontSize: 13, color: ONYX.textMute }}>narrated by {b.narrator}</div>
          </div>
        </div>

        {/* Right side */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
          <Glass style={{ padding: 26 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 22 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: ONYX.mono, fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: ONYX.textMute }}>Now playing · Ch. {curCh.n}</div>
                <div style={{ fontFamily: ONYX.serif, fontSize: 22, fontWeight: 500, marginTop: 4, letterSpacing: '-0.005em' }}>{curCh.t}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontFamily: ONYX.mono, fontSize: 11, color: ONYX.textDim }}>
                <span style={{ fontSize: 14, color: ONYX.text, fontWeight: 500 }}>{fmtTime(chLocal)}</span>
                <span style={{ color: ONYX.textMute }}>/</span>
                <span>{fmtTime(curCh.dur)}</span>
              </div>
            </div>

            <div onClick={onScrub} style={{ cursor: 'pointer', position: 'relative' }}>
              <Waveform width={680} height={72} progress={chLocal / curCh.dur} color={ONYX.accent} dim="rgba(255,255,255,0.15)" bars={140} flat={true} />
            </div>

            <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: 6 }}>
                {SPEEDS.map(s => (
                  <button key={s} onClick={() => st.setSpeed(s)} style={{
                    padding: '7px 12px', borderRadius: 6, fontFamily: ONYX.mono, fontSize: 11,
                    background: s === st.speed ? ONYX.accentDim : 'transparent',
                    color: s === st.speed ? ONYX.accent : ONYX.textDim,
                    border: `1px solid ${s === st.speed ? ONYX.accentEdge : ONYX.glassEdge}`,
                    fontWeight: s === st.speed ? 600 : 400,
                    cursor: 'pointer',
                  }}>{s}×</button>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <button onClick={() => st.setPosition(Math.max(0, st.position - 30))} title="Back 30s" style={transportBtn()}>
                  <Icon name="skip-back" size={20} />
                </button>
                <button onClick={() => st.setPlaying(p => !p)} style={{
                  width: 64, height: 64, borderRadius: 32, background: ONYX.accent, color: ONYX.bg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                  border: 'none', boxShadow: '0 12px 32px rgba(212,166,74,0.4)',
                }} title={st.playing ? 'Pause (space)' : 'Play (space)'}>
                  <Icon name={st.playing ? 'pause' : 'play'} size={26} style={{ marginLeft: st.playing ? 0 : 3 }} />
                </button>
                <button onClick={() => st.setPosition(Math.min(st.bookSecs, st.position + 30))} title="Forward 30s" style={transportBtn()}>
                  <Icon name="skip-forward" size={20} />
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={addBookmarkHere} style={transportBtnSmall()} title="Bookmark this moment">
                  <Icon name="bookmark" size={15} />
                </button>
                <div ref={sleepRef} style={{ position: 'relative' }}>
                  <button
                    onClick={() => setSleepOpen(o => !o)}
                    style={{
                      ...transportBtnSmall(),
                      background: sleepMode != null ? ONYX.accentDim : ONYX.glass,
                      border: `1px solid ${sleepMode != null ? ONYX.accentEdge : ONYX.glassEdge}`,
                      color: sleepMode != null ? ONYX.accent : ONYX.textDim,
                      width: sleepMode != null ? 'auto' : 40,
                      padding: sleepMode != null ? '0 10px' : 0,
                      gap: 6,
                    }}
                    title={sleepLabel ? `Sleep timer: ${sleepLabel}` : 'Sleep timer'}
                  >
                    <Icon name="sleep" size={15} />
                    {sleepMode != null && (
                      <span style={{ fontFamily: ONYX.mono, fontSize: 11, fontWeight: 600, letterSpacing: '0.02em' }}>{sleepLabel}</span>
                    )}
                  </button>
                  {sleepOpen && (
                    <div style={{
                      position: 'absolute', bottom: 'calc(100% + 8px)', right: 0,
                      background: ONYX.panel2, border: `1px solid ${ONYX.line}`, borderRadius: 10,
                      boxShadow: '0 16px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(212,166,74,0.08)',
                      padding: 6, zIndex: 100, minWidth: 170,
                    }}>
                      <div style={{ fontFamily: ONYX.mono, fontSize: 9, color: ONYX.textMute, letterSpacing: '0.12em', padding: '6px 8px 4px', textTransform: 'uppercase' }}>Sleep Timer</div>
                      {[
                        { id: null, label: 'Off' },
                        { id: 5, label: '5 minutes' },
                        { id: 15, label: '15 minutes' },
                        { id: 30, label: '30 minutes' },
                        { id: 60, label: '1 hour' },
                        { id: 'chapter', label: 'End of chapter' },
                      ].map(opt => {
                        const active = sleepMode === opt.id;
                        return (
                          <button key={String(opt.id)} onClick={() => { setSleepMode(opt.id); setSleepOpen(false); }} style={{
                            display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 6,
                            background: active ? ONYX.accentDim : 'transparent',
                            border: 'none', width: '100%', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                          }}>
                            <span style={{ flex: 1, fontSize: 12.5, color: active ? ONYX.accent : ONYX.text, fontWeight: active ? 600 : 400 }}>{opt.label}</span>
                            {active && <Icon name="check" size={11} style={{ color: ONYX.accent }} />}
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
            {/* Chapters */}
            <Glass style={{ flex: 1.2, padding: 20, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
                <div style={{ fontFamily: ONYX.serif, fontSize: 16, fontWeight: 500 }}>Chapters</div>
                <div style={{ fontFamily: ONYX.mono, fontSize: 10, color: ONYX.textMute, letterSpacing: '0.08em' }}>{CHAPTERS.length} · {b.dur} total</div>
              </div>
              <div style={{ flex: 1, overflow: 'auto', marginRight: -8, paddingRight: 8 }}>
                {CHAPTERS.map((c, i) => {
                  const state = i < chIdx ? 'done' : i === chIdx ? 'playing' : 'next';
                  return (
                    <button key={c.n} onClick={() => st.setPosition(chapterStart(i))} style={{
                      display: 'flex', alignItems: 'center', padding: '8px 12px', borderRadius: 8, gap: 12,
                      background: state === 'playing' ? ONYX.accentDim : 'transparent',
                      border: state === 'playing' ? `1px solid ${ONYX.accentEdge}` : '1px solid transparent',
                      marginBottom: 2, width: '100%', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                    }}>
                      <div style={{ fontFamily: ONYX.mono, fontSize: 11, color: state === 'playing' ? ONYX.accent : ONYX.textMute, width: 22 }}>{String(c.n).padStart(2, '0')}</div>
                      <div style={{ flex: 1, fontSize: 13, fontWeight: state === 'playing' ? 600 : 400, color: state === 'done' ? ONYX.textMute : ONYX.text }}>{c.t}</div>
                      <div style={{ fontFamily: ONYX.mono, fontSize: 10, color: ONYX.textMute }}>{fmtTime(c.dur)}</div>
                      {state === 'done' && <Icon name="check" size={11} style={{ color: ONYX.textMute }} />}
                      {state === 'playing' && <div style={{ width: 6, height: 6, borderRadius: 3, background: ONYX.accent, boxShadow: `0 0 12px ${ONYX.accent}` }} />}
                      {state === 'next' && <div style={{ width: 6, height: 6 }} />}
                    </button>
                  );
                })}
              </div>
            </Glass>

            {/* Bookmarks */}
            <Glass style={{ flex: 1, padding: 20, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
                <div style={{ fontFamily: ONYX.serif, fontSize: 16, fontWeight: 500 }}>Bookmarks</div>
                <div style={{ fontFamily: ONYX.mono, fontSize: 10, color: ONYX.textMute, letterSpacing: '0.08em' }}>{allBookmarks.length}</div>
                <button onClick={addBookmarkHere} style={{ marginLeft: 'auto', fontFamily: ONYX.mono, fontSize: 10, color: ONYX.accent, letterSpacing: '0.06em', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }} title="Bookmark current moment">
                  <Icon name="plus" size={11} /> ADD HERE
                </button>
              </div>
              <div style={{ flex: 1, overflow: 'auto', marginRight: -8, paddingRight: 8 }}>
                {allBookmarks.map((bm, i) => (
                  <button key={bm.id || i} onClick={() => st.setPosition(chapterStart(bm.ch - 1) + bm.secs)} style={{
                    padding: '11px 0',
                    background: 'none', border: 'none',
                    borderBottom: i < allBookmarks.length - 1 ? `1px solid ${ONYX.line}` : 'none',
                    cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', color: 'inherit', width: '100%',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <div style={{ fontFamily: ONYX.mono, fontSize: 11, fontWeight: 600, color: ONYX.accent }}>{bm.ts}</div>
                      <div style={{ fontFamily: ONYX.mono, fontSize: 9.5, color: ONYX.textMute, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Ch. {bm.ch} · {bm.date}</div>
                    </div>
                    <div style={{ fontSize: 13, color: ONYX.text, lineHeight: 1.3 }}>{bm.label}</div>
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

function transportBtn() {
  return {
    width: 44, height: 44, borderRadius: 10,
    background: ONYX.glass, border: `1px solid ${ONYX.glassEdge}`,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: ONYX.text, cursor: 'pointer', padding: 0,
  };
}
function transportBtnSmall() {
  return {
    width: 40, height: 40, borderRadius: 10,
    background: ONYX.glass, border: `1px solid ${ONYX.glassEdge}`,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: ONYX.textDim, cursor: 'pointer', padding: 0,
  };
}

window.Player = Player;
