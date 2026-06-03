// Onyx — shared chrome: window frame, wash, glass card, audio device + volume controls.
// Used by both the Library and Player screens.

function OnyxWash() {
  // Light mode: gentle warm-paper wash. Dark mode: the warm-onyx jewel wash.
  if (!ONYX.isDark) {
    return (
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: ONYX.bg, pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', left: '-15%', top: '-25%', width: '70%', height: '120%', background: 'radial-gradient(50% 50% at 50% 50%, rgba(212,166,74,0.10), transparent 65%)', filter: 'blur(90px)' }} />
        <div style={{ position: 'absolute', right: '-10%', top: '20%', width: '60%', height: '80%', background: 'radial-gradient(50% 50% at 50% 50%, rgba(180,130,60,0.06), transparent 60%)', filter: 'blur(110px)' }} />
        <div style={{ position: 'absolute', left: '20%', bottom: '-30%', width: '70%', height: '90%', background: 'radial-gradient(50% 50% at 50% 50%, rgba(220,200,160,0.35), transparent 65%)', filter: 'blur(120px)' }} />
        <div style={{ position: 'absolute', inset: 0, opacity: 0.04, mixBlendMode: 'multiply',
          backgroundImage: 'repeating-radial-gradient(circle at 13% 27%, rgba(60,40,20,0.5) 0 0.5px, transparent 0.5px 3px), repeating-radial-gradient(circle at 73% 67%, rgba(60,40,20,0.45) 0 0.5px, transparent 0.5px 3px)',
        }} />
      </div>
    );
  }
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: ONYX.bg, pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: '-15%', top: '-25%', width: '70%', height: '120%', background: 'radial-gradient(50% 50% at 50% 50%, rgba(212,166,74,0.14), transparent 65%)', filter: 'blur(90px)' }} />
      <div style={{ position: 'absolute', right: '-10%', top: '20%', width: '60%', height: '80%', background: 'radial-gradient(50% 50% at 50% 50%, rgba(212,166,74,0.08), transparent 60%)', filter: 'blur(110px)' }} />
      <div style={{ position: 'absolute', left: '20%', bottom: '-30%', width: '70%', height: '90%', background: 'radial-gradient(50% 50% at 50% 50%, rgba(60,40,20,0.6), transparent 65%)', filter: 'blur(120px)' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.15), rgba(0,0,0,0.55))' }} />
      <div style={{ position: 'absolute', inset: 0, opacity: 0.05, mixBlendMode: 'overlay',
        backgroundImage: 'repeating-radial-gradient(circle at 13% 27%, rgba(255,255,255,0.6) 0 0.5px, transparent 0.5px 3px), repeating-radial-gradient(circle at 73% 67%, rgba(255,255,255,0.5) 0 0.5px, transparent 0.5px 3px)',
      }} />
    </div>
  );
}

function Titlebar({ subtitle }) {
  // Brand suffix tracks the active theme (Onyx / Folio). Updates live when the user
  // switches themes via Settings → Appearance.
  const themeName = ONYX.isDark === false ? 'Folio' : 'Onyx';
  return (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 44, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 18px', zIndex: 50, WebkitAppRegion: 'drag' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 18, height: 18, borderRadius: 5, background: ONYX.glassStrong, backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: `1px solid ${ONYX.glassEdge}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: ONYX.accent }}>S</div>
        <div style={{ fontFamily: ONYX.mono, fontSize: 10, color: ONYX.textMute, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Skald · {themeName}{subtitle ? ` · ${subtitle}` : ''}</div>
      </div>
      <div style={{ display: 'flex', gap: 0, WebkitAppRegion: 'no-drag', marginRight: -18, height: 44 }}>
        {[
          { g: '\u2013', label: 'Minimize', kind: 'min' },
          { g: '\u25A1', label: 'Maximize', kind: 'max' },
          { g: '\u2715', label: 'Close', kind: 'close' },
        ].map((b, i) => (
          <button
            key={i}
            className={`onyx-winbtn onyx-winbtn-${b.kind}`}
            title={b.label}
            style={{
              width: 46, height: 44,
              borderRadius: 0,
              background: 'transparent',
              border: 'none',
              color: ONYX.textDim,
              fontSize: b.kind === 'max' ? 11 : 13,
              lineHeight: 1,
              cursor: 'pointer',
              padding: 0,
              fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >{b.g}</button>
        ))}
      </div>
    </div>
  );
}

function Glass({ children, style, onClick }) {
  // Translucent surfaces toggle (Settings → Appearance) — when off, use a solid panel
  // background so cards stay readable without the backdrop blur.
  const translucent = ONYX.translucent !== false;
  return (
    <div onClick={onClick} style={{
      background: translucent ? ONYX.glass : ONYX.panel,
      backdropFilter: translucent ? 'blur(40px) saturate(120%)' : 'none',
      WebkitBackdropFilter: translucent ? 'blur(40px) saturate(120%)' : 'none',
      border: `1px solid ${ONYX.glassEdge}`,
      borderRadius: 16,
      boxShadow: '0 24px 60px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
      ...style,
    }}>{children}</div>
  );
}

function VolumeControl({ st }) {
  const v = st.muted ? 0 : st.volume;
  const onChange = (e) => {
    st.setMuted(false);
    st.setVolume(parseFloat(e.target.value) / 100);
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', border: `1px solid ${ONYX.glassEdge}`, borderRadius: 8, background: ONYX.glass, backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}>
      <button onClick={() => st.setMuted(m => !m)} style={{ background: 'none', border: 'none', color: ONYX.textDim, cursor: 'pointer', padding: 2, display: 'flex' }} title="Mute">
        <Icon name={st.muted || st.volume < 0.01 ? 'volume-mute' : 'volume'} size={15} />
      </button>
      <div style={{ position: 'relative', width: 100, height: 18, display: 'flex', alignItems: 'center' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, height: 2, background: 'rgba(255,255,255,0.12)', borderRadius: 1 }}>
          <div style={{ width: `${v * 100}%`, height: '100%', background: ONYX.accent, borderRadius: 1 }} />
        </div>
        <div style={{ position: 'absolute', left: `calc(${v * 100}% - 5px)`, width: 10, height: 10, borderRadius: 5, background: ONYX.text, boxShadow: '0 0 0 1px rgba(0,0,0,0.4), 0 2px 4px rgba(0,0,0,0.4)', pointerEvents: 'none' }} />
        <input type="range" min={0} max={100} value={Math.round(v * 100)} onChange={onChange} style={{ position: 'absolute', inset: 0, width: '100%', opacity: 0, cursor: 'pointer' }} />
      </div>
      <span style={{ fontFamily: ONYX.mono, fontSize: 10, color: ONYX.textMute, minWidth: 22, textAlign: 'right' }}>{Math.round(v * 100)}</span>
    </div>
  );
}

function DeviceSelector({ st }) {
  const current = AUDIO_DEVICES.find(d => d.id === st.device) || AUDIO_DEVICES[0];
  // close on outside click
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!st.deviceOpen) return;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) st.setDeviceOpen(false); };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [st.deviceOpen]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => st.setDeviceOpen(o => !o)} style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px 6px 12px',
        border: `1px solid ${st.deviceOpen ? ONYX.accentEdge : ONYX.glassEdge}`,
        borderRadius: 8, background: st.deviceOpen ? ONYX.accentDim : ONYX.glass,
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        color: ONYX.text, cursor: 'pointer', fontFamily: 'inherit',
      }}>
        <span style={{ width: 6, height: 6, borderRadius: 3, background: '#5ac88a', boxShadow: '0 0 6px #5ac88a' }} />
        <Icon name={current.icon} size={14} style={{ color: ONYX.textDim }} />
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1, textAlign: 'left' }}>
          <span style={{ fontSize: 11.5, color: ONYX.text }}>{current.name}</span>
          <span style={{ fontFamily: ONYX.mono, fontSize: 9, color: ONYX.textMute, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{current.sub.split(' · ').slice(0, 2).join(' · ')}</span>
        </div>
        <Icon name="chevron-down" size={11} style={{ color: ONYX.textDim, marginLeft: 4, transform: st.deviceOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>

      {st.deviceOpen && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, width: 300,
          background: ONYX.panel2, border: `1px solid ${ONYX.line}`, borderRadius: 10,
          boxShadow: '0 16px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(212,166,74,0.08)',
          padding: 6, zIndex: 100,
        }}>
          <div style={{ fontFamily: ONYX.mono, fontSize: 9, color: ONYX.textMute, letterSpacing: '0.12em', padding: '6px 8px 4px' }}>OUTPUT DEVICE</div>
          {AUDIO_DEVICES.map(d => (
            <button key={d.id} onClick={() => { st.setDevice(d.id); st.setDeviceOpen(false); }} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px', borderRadius: 6,
              background: d.id === st.device ? ONYX.accentDim : 'transparent',
              border: 'none', width: '100%', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
            }}>
              <Icon name={d.icon} size={15} style={{ color: d.id === st.device ? ONYX.accent : ONYX.textDim, width: 18 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: d.id === st.device ? ONYX.accent : ONYX.text, fontWeight: d.id === st.device ? 500 : 400 }}>{d.name}</div>
                <div style={{ fontFamily: ONYX.mono, fontSize: 9.5, color: ONYX.textMute, letterSpacing: '0.04em', marginTop: 1 }}>{d.sub}</div>
              </div>
              {d.id === st.device && <Icon name="dot" size={10} style={{ color: ONYX.accent }} />}
            </button>
          ))}
          <div style={{ borderTop: `1px solid ${ONYX.line}`, marginTop: 4, padding: '8px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontFamily: ONYX.mono, fontSize: 10, color: ONYX.textMute, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Exclusive Mode</span>
            <div style={{ width: 26, height: 14, borderRadius: 7, background: ONYX.accent, position: 'relative' }}>
              <div style={{ position: 'absolute', right: 2, top: 2, width: 10, height: 10, borderRadius: 5, background: ONYX.bg }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Top navigation bar — top-level destinations only. Library is the catch-all
// for the catalog views; the Series/Authors/Narrators/Collections tabs live
// inside the Library shelf pane (see ShelfTabs in library.jsx).
function TopNav({ st }) {
  const items = [
    st.showHome && { id: 'home', label: 'Home' },
    { id: 'library', label: 'Library' },
  ].filter(Boolean);

  // If the user is currently on Home and toggles it off, route them to Library.
  React.useEffect(() => {
    if (!st.showHome && st.screen === 'home') st.setScreen('library');
  }, [st.showHome, st.screen]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Glass style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 18 }}>
      {items.map(n => {
        const active = st.screen === n.id;
        return (
          <button key={n.id} onClick={() => st.setScreen(n.id)} style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 13, fontWeight: active ? 600 : 400,
            color: active ? ONYX.text : ONYX.textDim, position: 'relative',
          }}>
            {n.label}
            {active && <div style={{ position: 'absolute', left: 0, right: 0, bottom: -14, height: 2, background: ONYX.accent, borderRadius: 1 }} />}
          </button>
        );
      })}
      <div style={{ flex: 1, marginLeft: 24, position: 'relative' }}>
        <div style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: ONYX.textMute, display: 'flex', pointerEvents: 'none' }}>
          <Icon name="search" size={13} />
        </div>
        <input
          id="onyx-search"
          type="text"
          placeholder={`Search ${LIBRARY.length} titles…`}
          value={st.search}
          onChange={(e) => st.setSearch(e.target.value)}
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '8px 38px 8px 34px',
            background: 'rgba(0,0,0,0.3)', borderRadius: 8,
            fontSize: 12, color: ONYX.text,
            border: `1px solid ${ONYX.line}`, outline: 'none', fontFamily: 'inherit',
          }}
        />
        <div style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontFamily: ONYX.mono, fontSize: 10, padding: '1px 5px', border: `1px solid ${ONYX.glassEdge}`, borderRadius: 4, color: ONYX.textMute, pointerEvents: 'none' }}>Ctrl+K</div>
      </div>
      <button onClick={() => st.setScreen('settings')} title="Account & settings" style={{
        width: 28, height: 28, borderRadius: '50%',
        background: ONYX.accent, color: ONYX.bg,
        border: 'none', cursor: 'pointer', fontFamily: 'inherit',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700,
      }}>J</button>
    </Glass>
  );
}

Object.assign(window, { OnyxWash, Titlebar, Glass, VolumeControl, DeviceSelector, TopNav });
