// Onyx — Settings screen.
// Account, server connection, playback preferences, audio, downloads, about.
// Two-column: nav rail on the left, content panel on the right.

function Settings({ st }) {
  const [section, setSection] = React.useState('account');
  const sections = [
    { id: 'account', label: 'Account', icon: 'home' },
    { id: 'server', label: 'Server', icon: 'monitor' },
    { id: 'playback', label: 'Playback', icon: 'play' },
    { id: 'audio', label: 'Audio', icon: 'headphones' },
    { id: 'library', label: 'Library', icon: 'grid' },
    { id: 'downloads', label: 'Downloads', icon: 'bookmark' },
    { id: 'appearance', label: 'Appearance', icon: 'speaker' },
    { id: 'keyboard', label: 'Keyboard', icon: 'kbd' },
    { id: 'about', label: 'About', icon: 'dot' },
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '12px 32px 24px', minHeight: 0 }}>
      {/* breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18, fontFamily: ONYX.mono, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: ONYX.textMute }}>
        <button onClick={() => st.setScreen('library')} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: ONYX.textDim, cursor: 'pointer', padding: 4, fontFamily: 'inherit', fontSize: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit' }}>
          <Icon name="chevron-left" size={12} /> Library
        </button>
        <span>·</span>
        <span style={{ color: ONYX.text }}>Settings</span>
      </div>

      <div style={{ flex: 1, display: 'flex', gap: 24, minHeight: 0 }}>
        {/* Left rail */}
        <Glass style={{ width: 260, padding: '20px 14px', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          {/* Profile header */}
          <div style={{ padding: '4px 10px 18px', borderBottom: `1px solid ${ONYX.line}`, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: '50%', background: ONYX.accent, color: ONYX.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15 }}>J</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 500, color: ONYX.text }}>Jordan</div>
              <div style={{ fontFamily: ONYX.mono, fontSize: 9.5, color: ONYX.textMute, letterSpacing: '0.06em' }}>jordan@home.lan</div>
            </div>
          </div>

          {sections.map(s => (
            <button key={s.id} onClick={() => setSection(s.id)} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '9px 12px', borderRadius: 8,
              background: section === s.id ? ONYX.accentDim : 'transparent',
              border: `1px solid ${section === s.id ? ONYX.accentEdge : 'transparent'}`,
              cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
              color: section === s.id ? ONYX.accent : ONYX.text,
              fontSize: 13, fontWeight: section === s.id ? 500 : 400,
              marginBottom: 2,
            }}>
              <Icon name={s.icon} size={14} style={{ color: section === s.id ? ONYX.accent : ONYX.textDim }} />
              {s.label}
            </button>
          ))}

          <div style={{ flex: 1 }} />

          <button style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
            background: 'transparent', border: `1px solid ${ONYX.glassEdge}`, borderRadius: 8,
            color: '#e8716a', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5,
            justifyContent: 'center', marginTop: 12,
          }}>
            Sign out
          </button>
        </Glass>

        {/* Content panel */}
        <Glass style={{ flex: 1, padding: '28px 36px', overflow: 'auto', minWidth: 0 }}>
          {section === 'account' && <AccountSection />}
          {section === 'server' && <ServerSection />}
          {section === 'playback' && <PlaybackSection st={st} />}
          {section === 'audio' && <AudioSection st={st} />}
          {section === 'library' && <LibrarySection st={st} />}
          {section === 'downloads' && <DownloadsSection />}
          {section === 'appearance' && <AppearanceSection st={st} />}
          {section === 'keyboard' && <KeyboardSection />}
          {section === 'about' && <AboutSection />}
        </Glass>
      </div>
    </div>
  );
}

// --- shared bits ---
function SectionHead({ title, subtitle }) {
  return (
    <div style={{ marginBottom: 28, paddingBottom: 18, borderBottom: `1px solid ${ONYX.line}` }}>
      <div style={{ fontFamily: ONYX.serif, fontSize: 26, fontWeight: 500, letterSpacing: '-0.01em' }}>{title}</div>
      {subtitle && <div style={{ marginTop: 6, fontSize: 13.5, color: ONYX.textDim, maxWidth: 540 }}>{subtitle}</div>}
    </div>
  );
}

function Row({ label, hint, children, align = 'center' }) {
  return (
    <div style={{ display: 'flex', alignItems: align === 'top' ? 'flex-start' : 'center', justifyContent: 'space-between', padding: '16px 0', borderBottom: `1px solid ${ONYX.line}`, gap: 24 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, color: ONYX.text, fontWeight: 500 }}>{label}</div>
        {hint && <div style={{ marginTop: 4, fontSize: 12, color: ONYX.textMute, maxWidth: 480, lineHeight: 1.45 }}>{hint}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function Toggle({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)} style={{
      width: 36, height: 20, borderRadius: 10, padding: 0,
      background: on ? ONYX.accent : 'rgba(255,255,255,0.12)',
      border: 'none', cursor: 'pointer', position: 'relative',
      transition: 'background 0.15s',
    }}>
      <div style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: 8, background: on ? ONYX.bg : '#ebe7df', transition: 'left 0.15s' }} />
    </button>
  );
}

function Pill({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: '6px 12px', borderRadius: 999, fontFamily: ONYX.mono, fontSize: 11,
      background: active ? ONYX.accentDim : 'transparent',
      border: `1px solid ${active ? ONYX.accentEdge : ONYX.glassEdge}`,
      color: active ? ONYX.accent : ONYX.textDim,
      fontWeight: active ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit',
    }}>{children}</button>
  );
}

function TextInput({ value, onChange, placeholder, type = 'text', mono = false }) {
  return (
    <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={{
      padding: '8px 12px', minWidth: 280, fontSize: 13,
      background: 'rgba(0,0,0,0.3)', borderRadius: 8,
      color: ONYX.text, border: `1px solid ${ONYX.glassEdge}`,
      outline: 'none', fontFamily: mono ? ONYX.mono : 'inherit',
    }} />
  );
}

// --- sections ---
function AccountSection() {
  const [name, setName] = React.useState('Jordan');
  const [email] = React.useState('jordan@home.lan');
  return (
    <div>
      <SectionHead title="Account" subtitle="Your local profile and identity on this device." />
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '0 0 24px', borderBottom: `1px solid ${ONYX.line}` }}>
        <div style={{ width: 72, height: 72, borderRadius: '50%', background: ONYX.accent, color: ONYX.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 28 }}>J</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: ONYX.serif, fontSize: 20, fontWeight: 500 }}>{name}</div>
          <div style={{ fontFamily: ONYX.mono, fontSize: 11, color: ONYX.textMute, marginTop: 2 }}>{email}</div>
          <button style={{ marginTop: 10, padding: '5px 12px', fontSize: 11, fontFamily: ONYX.mono, letterSpacing: '0.06em', textTransform: 'uppercase', background: ONYX.glass, border: `1px solid ${ONYX.glassEdge}`, borderRadius: 6, color: ONYX.textDim, cursor: 'pointer' }}>Change avatar</button>
        </div>
      </div>
      <Row label="Display name" hint="Shown in the titlebar and listening activity.">
        <TextInput value={name} onChange={setName} />
      </Row>
      <Row label="Email" hint="Used to identify your account on the Audiobookshelf server.">
        <TextInput value={email} onChange={() => {}} />
      </Row>
      <Row label="Listening stats" hint="Share anonymous listening time + streak with the server.">
        <Toggle on={true} onChange={() => {}} />
      </Row>
    </div>
  );
}

function ServerSection() {
  const [url, setUrl] = React.useState('https://abs.home.lan:8443');
  return (
    <div>
      <SectionHead title="Server" subtitle="Your Audiobookshelf server connection." />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 0 18px', borderBottom: `1px solid ${ONYX.line}`, marginBottom: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: '#5ac88a', boxShadow: '0 0 8px #5ac88a', flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: ONYX.serif, fontSize: 17, fontWeight: 500 }}>Connected</div>
          <div style={{ fontFamily: ONYX.mono, fontSize: 11, color: ONYX.textMute, marginTop: 2 }}>v2.18.3 · 247 titles · last sync 12s ago</div>
        </div>
        <button style={{ padding: '6px 14px', fontSize: 11, fontFamily: ONYX.mono, letterSpacing: '0.06em', textTransform: 'uppercase', background: ONYX.glass, border: `1px solid ${ONYX.glassEdge}`, borderRadius: 6, color: ONYX.textDim, cursor: 'pointer' }}>Reconnect</button>
      </div>
      <Row label="Server URL" hint="The address of your Audiobookshelf instance.">
        <TextInput value={url} onChange={setUrl} mono />
      </Row>
      <Row label="Auto-reconnect" hint="Try to re-establish a dropped connection in the background.">
        <Toggle on={true} onChange={() => {}} />
      </Row>
      <Row label="Sync interval" hint="How often to push playback state up to the server.">
        <div style={{ display: 'flex', gap: 6 }}>
          {['10s', '30s', '60s', '5m'].map((v, i) => <Pill key={v} active={i === 1} onClick={() => {}}>{v}</Pill>)}
        </div>
      </Row>
      <Row label="Verify TLS certificate" hint="Disable only for self-signed certs on your home network.">
        <Toggle on={false} onChange={() => {}} />
      </Row>
    </div>
  );
}

// Tiny localStorage-backed state hook. Used by Playback (and other settings panes)
// to make their pills/toggles actually persist across reloads.
function useLocal(key, def) {
  const [v, setV] = React.useState(() => {
    const raw = localStorage.getItem(key);
    if (raw === null) return def;
    try { return JSON.parse(raw); } catch { return raw; }
  });
  const set = React.useCallback((next) => {
    setV(next);
    localStorage.setItem(key, JSON.stringify(next));
  }, [key]);
  return [v, set];
}

function PlaybackSection({ st }) {
  const [skipDur, setSkipDur] = useLocal('onyx.playback.skip', '30s');
  const [rewindOnResume, setRewindOnResume] = useLocal('onyx.playback.rewind', '5s');
  const [autoPlayNext, setAutoPlayNext] = useLocal('onyx.playback.autoPlayNext', true);
  const [smartPause, setSmartPause] = useLocal('onyx.playback.smartPause', true);
  const [sleepDefault, setSleepDefault] = useLocal('onyx.playback.sleepDefault', 'End of chapter');

  const SKIP = ['10s', '15s', '30s', '60s'];
  const REWIND = ['Off', '2s', '5s', '10s'];
  const SLEEP = ['Off', '15m', '30m', '1h', 'End of chapter'];

  return (
    <div>
      <SectionHead title="Playback" subtitle="Defaults applied when starting a new book." />
      <Row label="Default playback speed" hint="Applied when you open a book for the first time. Per-book speed overrides this.">
        <div style={{ display: 'flex', gap: 6 }}>
          {SPEEDS.map(s => <Pill key={s} active={s === st.speed} onClick={() => st.setSpeed(s)}>{s}×</Pill>)}
        </div>
      </Row>
      <Row label="Skip duration" hint="Used by the −/+ skip buttons and ←/→ keys.">
        <div style={{ display: 'flex', gap: 6 }}>
          {SKIP.map(v => <Pill key={v} active={v === skipDur} onClick={() => setSkipDur(v)}>{v}</Pill>)}
        </div>
      </Row>
      <Row label="Auto-rewind on resume" hint="Step backwards a few seconds when you resume after a pause.">
        <div style={{ display: 'flex', gap: 6 }}>
          {REWIND.map(v => <Pill key={v} active={v === rewindOnResume} onClick={() => setRewindOnResume(v)}>{v}</Pill>)}
        </div>
      </Row>
      <Row label="Auto-play next chapter" hint="Continue without pausing when a chapter ends.">
        <Toggle on={autoPlayNext} onChange={setAutoPlayNext} />
      </Row>
      <Row label="Smart pause" hint="Pause when the audio device disconnects (e.g. headphones unplugged).">
        <Toggle on={smartPause} onChange={setSmartPause} />
      </Row>
      <Row label="Sleep timer default" hint="Pre-fill when you open the sleep timer.">
        <div style={{ display: 'flex', gap: 6 }}>
          {SLEEP.map(v => <Pill key={v} active={v === sleepDefault} onClick={() => setSleepDefault(v)}>{v}</Pill>)}
        </div>
      </Row>
    </div>
  );
}

function AudioSection({ st }) {
  const cur = AUDIO_DEVICES.find(d => d.id === st.device);
  return (
    <div>
      <SectionHead title="Audio" subtitle="Output device and signal-chain preferences." />
      <Row label="Output device" hint="Active right now. Pick a different device any time from the toolbar." align="top">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          {AUDIO_DEVICES.map(d => (
            <button key={d.id} onClick={() => st.setDevice(d.id)} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', minWidth: 280,
              borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
              background: d.id === st.device ? ONYX.accentDim : ONYX.glass,
              border: `1px solid ${d.id === st.device ? ONYX.accentEdge : ONYX.glassEdge}`,
            }}>
              <Icon name={d.icon} size={14} style={{ color: d.id === st.device ? ONYX.accent : ONYX.textDim, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: d.id === st.device ? ONYX.accent : ONYX.text, fontWeight: d.id === st.device ? 500 : 400 }}>{d.name}</div>
                <div style={{ fontFamily: ONYX.mono, fontSize: 9.5, color: ONYX.textMute, marginTop: 1 }}>{d.sub}</div>
              </div>
              {d.id === st.device && <Icon name="dot" size={10} style={{ color: ONYX.accent, flexShrink: 0 }} />}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Exclusive mode" hint="Take exclusive control of the device for bit-perfect playback. Other apps can't play audio while Skald is using it.">
        <Toggle on={true} onChange={() => {}} />
      </Row>
      <Row label="Sample rate" hint="Match the source. Auto follows each book's native rate.">
        <div style={{ display: 'flex', gap: 6 }}>
          {['Auto', '44.1', '48', '96 kHz'].map((v, i) => <Pill key={v} active={i === 0} onClick={() => {}}>{v}</Pill>)}
        </div>
      </Row>
      <Row label="Voice boost" hint="Mild compression to keep dialogue audible at low volume.">
        <Toggle on={false} onChange={() => {}} />
      </Row>
      <Row label="Mono downmix" hint="Combine stereo channels for single-earbud listening.">
        <Toggle on={false} onChange={() => {}} />
      </Row>
    </div>
  );
}

function LibrarySection({ st }) {
  const SORTS = [
    { id: 'recently', label: 'Recently added' },
    { id: 'title', label: 'Title' },
    { id: 'author', label: 'Author' },
    { id: 'most-listened', label: 'Most listened' },
  ];
  const SIZES = ['S', 'M', 'L', 'XL'];
  return (
    <div>
      <SectionHead title="Library" subtitle="How your collection is presented in the shelf." />
      <Row label="Default sort">
        <div style={{ display: 'flex', gap: 6 }}>
          {SORTS.map(s => <Pill key={s.id} active={s.id === st.librarySort} onClick={() => st.setLibrarySort(s.id)}>{s.label}</Pill>)}
        </div>
      </Row>
      <Row label="Cover size">
        <div style={{ display: 'flex', gap: 6 }}>
          {SIZES.map(v => <Pill key={v} active={v === st.coverSize} onClick={() => st.setCoverSize(v)}>{v}</Pill>)}
        </div>
      </Row>
      <Row label="Group by series" hint="Stack series volumes under a single cover.">
        <Toggle on={st.groupBySeries} onChange={st.setGroupBySeries} />
      </Row>
      <Row label="Show finished titles" hint="Include books at 100% in the main grid.">
        <Toggle on={st.showFinished} onChange={st.setShowFinished} />
      </Row>
      <Row label="Show Home tab" hint="The dashboard-style landing view with continue listening, recent additions, and stats. Turn off to go straight to the Library.">
        <Toggle on={st.showHome} onChange={st.setShowHome} />
      </Row>
      <Row label="Show progress overlay" hint="The thin gold bar at the bottom of cover thumbnails.">
        <Toggle on={st.showProgressOverlay} onChange={st.setShowProgressOverlay} />
      </Row>
    </div>
  );
}

function DownloadsSection() {
  return (
    <div>
      <SectionHead title="Downloads" subtitle="Offline copies and cache." />
      <Row label="Cache location" hint="~/.local/share/skald/cache">
        <button style={{ padding: '6px 14px', fontSize: 11, fontFamily: ONYX.mono, letterSpacing: '0.06em', textTransform: 'uppercase', background: ONYX.glass, border: `1px solid ${ONYX.glassEdge}`, borderRadius: 6, color: ONYX.textDim, cursor: 'pointer' }}>Reveal</button>
      </Row>
      <Row label="Maximum cache size" hint="2.4 GB used of 10 GB.">
        <div style={{ display: 'flex', gap: 6 }}>
          {['1', '5', '10', '25', '∞ GB'].map((v, i) => <Pill key={v} active={i === 2} onClick={() => {}}>{v}</Pill>)}
        </div>
      </Row>
      <Row label="Auto-download next book in series" hint="Pre-fetch when you finish a volume.">
        <Toggle on={true} onChange={() => {}} />
      </Row>
      <Row label="Keep downloaded books after finishing" hint="Hold on to the audio in case you re-listen.">
        <Toggle on={false} onChange={() => {}} />
      </Row>
      <Row label="Download quality" hint="Audiobookshelf transcodes on the fly. Original is best for archival listening.">
        <div style={{ display: 'flex', gap: 6 }}>
          {['Low', 'Standard', 'High', 'Original'].map((v, i) => <Pill key={v} active={i === 3} onClick={() => {}}>{v}</Pill>)}
        </div>
      </Row>
      <Row label="Clear all cached audio">
        <button style={{ padding: '6px 14px', fontSize: 11, fontFamily: ONYX.mono, letterSpacing: '0.06em', textTransform: 'uppercase', background: 'transparent', border: `1px solid rgba(232,113,106,0.4)`, borderRadius: 6, color: '#e8716a', cursor: 'pointer' }}>Clear 2.4 GB</button>
      </Row>
    </div>
  );
}

function AppearanceSection({ st }) {
  const SWATCHES = ['#d4a64a', '#c96442', '#7aa86a', '#5a8fc4', '#a86a8e'];
  // Normalize comparison — match any swatch case-insensitively.
  const currentHex = (st.accentColor || '').toLowerCase();
  return (
    <div>
      <SectionHead title="Appearance" subtitle="The look and feel of Skald." />
      <Row label="Theme">
        <div style={{ display: 'flex', gap: 6 }}>
          {[
            { id: 'dark', label: 'Onyx (dark)' },
            { id: 'light', label: 'Folio (light)' },
            { id: 'system', label: 'System' },
          ].map(t => (
            <Pill key={t.id} active={st.theme === t.id} onClick={() => st.setTheme(t.id)}>{t.label}</Pill>
          ))}
        </div>
      </Row>
      <Row label="Accent color" hint="Used for active controls and progress. Applies live across the app.">
        <div style={{ display: 'flex', gap: 10 }}>
          {SWATCHES.map((c) => {
            const active = c.toLowerCase() === currentHex;
            return (
              <button
                key={c}
                onClick={() => st.setAccentColor(c)}
                title={c}
                aria-label={`Set accent color ${c}`}
                aria-pressed={active}
                style={{
                  width: 26, height: 26, borderRadius: 13, background: c, cursor: 'pointer',
                  border: active ? '2px solid #ebe7df' : '1px solid rgba(0,0,0,0.4)',
                  boxShadow: active ? `0 0 14px ${c}88` : 'none',
                  padding: 0, transition: 'transform 0.12s, box-shadow 0.15s',
                  transform: active ? 'scale(1.08)' : 'scale(1)',
                }}
              />
            );
          })}
        </div>
      </Row>
      <Row label="Reduce motion" hint="Disable the ambient backdrop animation and easing transitions.">
        <Toggle on={false} onChange={() => {}} />
      </Row>
      <Row label="Translucent surfaces" hint="The glass effect on cards. Turn off for performance on older hardware.">
        <Toggle on={st.translucent} onChange={st.setTranslucent} />
      </Row>
      <Row label="Interface scale" hint="Zooms the entire app. Useful on 4K displays or when reading from across the room.">
        <InterfaceScalePicker />
      </Row>
    </div>
  );
}

// Interface-scale segmented control. Persists to localStorage. Applies via
// transform: scale() on #root, with the root inverse-sized so that after scaling
// it lands at exactly the real viewport size — nothing overflows or clips.
function InterfaceScalePicker() {
  const OPTIONS = ['90%', '100%', '110%', '125%'];
  const [scale, setScale] = React.useState(() => {
    return localStorage.getItem('onyx.uiScale') || '100%';
  });
  React.useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;
    const z = parseInt(scale, 10) / 100;
    if (z === 1) {
      // Clean reset so we don't leave inline overrides on the default.
      root.style.transform = '';
      root.style.transformOrigin = '';
      root.style.width = '';
      root.style.height = '';
    } else {
      root.style.transform = `scale(${z})`;
      root.style.transformOrigin = 'top left';
      // Inverse-size so scaled output = viewport. Layout reflows into this size.
      root.style.width = `${100 / z}vw`;
      root.style.height = `${100 / z}vh`;
    }
    localStorage.setItem('onyx.uiScale', scale);
  }, [scale]);
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {OPTIONS.map(v => <Pill key={v} active={v === scale} onClick={() => setScale(v)}>{v}</Pill>)}
    </div>
  );
}

function KeyboardSection() {
  const shortcuts = [
    { keys: 'Space', desc: 'Play / pause' },
    { keys: '←  /  →', desc: 'Skip backward / forward' },
    { keys: '⌘ ←  /  ⌘ →', desc: 'Previous / next chapter' },
    { keys: '⌘ K', desc: 'Focus search' },
    { keys: '⌘ B', desc: 'Bookmark current moment' },
    { keys: '⌘ ,', desc: 'Open settings' },
    { keys: 'Esc', desc: 'Back to library' },
    { keys: '+  /  −', desc: 'Volume up / down' },
    { keys: 'M', desc: 'Mute' },
    { keys: '1 – 5', desc: 'Set playback speed preset' },
  ];
  return (
    <div>
      <SectionHead title="Keyboard" subtitle="Shortcuts." />
      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', rowGap: 4 }}>
        {shortcuts.map(s => (
          <React.Fragment key={s.keys}>
            <div style={{ padding: '10px 0', fontFamily: ONYX.mono, fontSize: 12, color: ONYX.accent, letterSpacing: '0.04em' }}>{s.keys}</div>
            <div style={{ padding: '10px 0', fontSize: 13, color: ONYX.text, borderBottom: `1px solid ${ONYX.line}` }}>{s.desc}</div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function AboutSection() {
  return (
    <div>
      <SectionHead title="About" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '0 0 24px', borderBottom: `1px solid ${ONYX.line}` }}>
        <div style={{ width: 56, height: 56, borderRadius: 12, background: ONYX.glassStrong, border: `1px solid ${ONYX.glassEdge}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: ONYX.accent, fontFamily: ONYX.serif, fontSize: 30, fontWeight: 600 }}>S</div>
        <div>
          <div style={{ fontFamily: ONYX.serif, fontSize: 26, fontWeight: 500 }}>Skald<span style={{ color: ONYX.accent }}>.</span></div>
          <div style={{ fontFamily: ONYX.mono, fontSize: 11, color: ONYX.textMute, marginTop: 2 }}>v0.1.0 · Onyx · alpha</div>
          <div style={{ fontSize: 12, color: ONYX.textDim, marginTop: 6, maxWidth: 480 }}>A native desktop client for Audiobookshelf.</div>
        </div>
      </div>
      <Row label="Check for updates" hint="Automatic checks run every 24h.">
        <button style={{ padding: '6px 14px', fontSize: 11, fontFamily: ONYX.mono, letterSpacing: '0.06em', textTransform: 'uppercase', background: ONYX.glass, border: `1px solid ${ONYX.glassEdge}`, borderRadius: 6, color: ONYX.textDim, cursor: 'pointer' }}>Check now</button>
      </Row>
      <Row label="Release channel">
        <div style={{ display: 'flex', gap: 6 }}>
          {['Stable', 'Beta', 'Nightly'].map((v, i) => <Pill key={v} active={i === 1} onClick={() => {}}>{v}</Pill>)}
        </div>
      </Row>
      <Row label="Open source licenses">
        <button style={{ padding: '6px 14px', fontSize: 11, fontFamily: ONYX.mono, letterSpacing: '0.06em', textTransform: 'uppercase', background: ONYX.glass, border: `1px solid ${ONYX.glassEdge}`, borderRadius: 6, color: ONYX.textDim, cursor: 'pointer' }}>View</button>
      </Row>
      <Row label="Diagnostic report" hint="Bundle logs + config for sharing with support.">
        <button style={{ padding: '6px 14px', fontSize: 11, fontFamily: ONYX.mono, letterSpacing: '0.06em', textTransform: 'uppercase', background: ONYX.glass, border: `1px solid ${ONYX.glassEdge}`, borderRadius: 6, color: ONYX.textDim, cursor: 'pointer' }}>Generate</button>
      </Row>
    </div>
  );
}

window.Settings = Settings;
