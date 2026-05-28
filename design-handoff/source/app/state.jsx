// Onyx — runtime state hook for the working prototype.
// Mock playback: position advances by 1s of book time per real second when playing,
// scaled by speed. Volume/device/speed/filter all live here too.

function useOnyxState() {
  const [screen, setScreen] = React.useState('library'); // 'library' | 'player' | 'settings'
  const [currentBookId, setCurrentBookId] = React.useState('cold-iron');
  const [playing, setPlaying] = React.useState(false);

  // playback in seconds across the whole book
  const [position, setPosition] = React.useState(LIBRARY[0].progress * (24 * 3600 + 12 * 60)); // seconds
  const [volume, setVolume] = React.useState(0.68);
  const [muted, setMuted] = React.useState(false);
  const [speed, setSpeed] = React.useState('1.25');
  const [device, setDevice] = React.useState('sennheiser');
  const [deviceOpen, setDeviceOpen] = React.useState(false);

  const [focusCollapsed, setFocusCollapsed] = React.useState(false);
  const [filter, setFilter] = React.useState('all');
  // Context filter — one of: null | { kind: 'series'|'author'|'narrator', value }
  const [contextFilter, setContextFilter] = React.useState(null);
  const [search, setSearch] = React.useState('');
  // libraryView (declared below) controls grid/list across ALL shelf tabs —
  // selection carries over between Home / Series / Authors / Narrators.
  const [accentColor, setAccentColorRaw] = React.useState(ONYX.accent);
  const [theme, setThemeRaw] = React.useState(() => localStorage.getItem('onyx.theme') || 'dark');
  const [translucent, setTranslucentRaw] = React.useState(() => {
    const v = localStorage.getItem('onyx.translucent');
    return v === null ? true : v === 'true';
  });
  // Mirror into ONYX immediately so Glass picks it up on the very first render.
  ONYX.translucent = translucent;

  // Library preferences — persisted, consumed by the Library shelf renderer.
  const [librarySort, setLibrarySortRaw] = React.useState(() => localStorage.getItem('onyx.lib.sort') || 'recently');
  const [coverSize, setCoverSizeRaw] = React.useState(() => localStorage.getItem('onyx.lib.coverSize') || 'L');
  const [groupBySeries, setGroupBySeriesRaw] = React.useState(() => localStorage.getItem('onyx.lib.groupBySeries') === 'true');
  const [showFinished, setShowFinishedRaw] = React.useState(() => {
    const v = localStorage.getItem('onyx.lib.showFinished');
    return v === null ? true : v === 'true';
  });
  const [showProgressOverlay, setShowProgressOverlayRaw] = React.useState(() => {
    const v = localStorage.getItem('onyx.lib.progressOverlay');
    return v === null ? true : v === 'true';
  });
  const setLibrarySort = React.useCallback((v) => { localStorage.setItem('onyx.lib.sort', v); setLibrarySortRaw(v); }, []);
  const setCoverSize = React.useCallback((v) => { localStorage.setItem('onyx.lib.coverSize', v); setCoverSizeRaw(v); }, []);
  const setGroupBySeries = React.useCallback((v) => { localStorage.setItem('onyx.lib.groupBySeries', String(v)); setGroupBySeriesRaw(v); }, []);
  const setShowFinished = React.useCallback((v) => { localStorage.setItem('onyx.lib.showFinished', String(v)); setShowFinishedRaw(v); }, []);
  const setShowProgressOverlay = React.useCallback((v) => { localStorage.setItem('onyx.lib.progressOverlay', String(v)); setShowProgressOverlayRaw(v); }, []);

  // Library view mode — grid (cover wall) or list (wide rows with metadata columns).
  const [libraryView, setLibraryViewRaw] = React.useState(() => localStorage.getItem('onyx.lib.view') || 'grid');
  const setLibraryView = React.useCallback((v) => { localStorage.setItem('onyx.lib.view', v); setLibraryViewRaw(v); }, []);

  // Shelf tab — which pane is showing inside the Library screen.
  // 'library' | 'series' | 'authors' | 'narrators' | 'collections'
  const [shelfTab, setShelfTabRaw] = React.useState(() => localStorage.getItem('onyx.shelfTab') || 'library');
  const setShelfTab = React.useCallback((v) => { localStorage.setItem('onyx.shelfTab', v); setShelfTabRaw(v); }, []);

  // Home tab visibility — some users prefer to land straight in the Library.
  const [showHome, setShowHomeRaw] = React.useState(() => {
    const v = localStorage.getItem('onyx.lib.showHome');
    return v === null ? true : v === 'true';
  });
  const setShowHome = React.useCallback((v) => { localStorage.setItem('onyx.lib.showHome', String(v)); setShowHomeRaw(v); }, []);

  // Pick-it-up collapse state — user can fold the section from the shelf.
  const [pickItUpCollapsed, setPickItUpCollapsedRaw] = React.useState(() => localStorage.getItem('onyx.pickItUp.collapsed') === 'true');
  const setPickItUpCollapsed = React.useCallback((v) => { localStorage.setItem('onyx.pickItUp.collapsed', String(v)); setPickItUpCollapsedRaw(v); }, []);
  // Ref so setters can read current accent/theme without stale closures across quick toggles.
  const accentRef = React.useRef(accentColor);
  const themeRef = React.useRef(theme);

  // Apply once on mount + attach a system-pref listener when in 'system' mode.
  React.useEffect(() => {
    applyTheme(themeRef.current, accentRef.current);
    if (themeRef.current !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => { applyTheme(themeRef.current, accentRef.current); setThemeRaw(t => t + ''); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  // Sync palette + persist on theme/accent change.
  const setTheme = React.useCallback((t) => {
    themeRef.current = t;
    applyTheme(t, accentRef.current);          // mutate ONYX BEFORE re-render so inline styles pick it up
    localStorage.setItem('onyx.theme', t);
    setThemeRaw(t);
  }, []);

  const setTranslucent = React.useCallback((on) => {
    ONYX.translucent = on;                     // mutate first so Glass repaints with the new value
    localStorage.setItem('onyx.translucent', String(on));
    setTranslucentRaw(on);
  }, []);

  // Mutate the shared ONYX palette so every inline style picks up the new accent on next render.
  const setAccentColor = React.useCallback((hex) => {
    accentRef.current = hex;
    // Re-derive accent shades through applyTheme so light/dark mode keep their tuned alphas.
    applyTheme(themeRef.current, hex);
    // CSS variables used by static stylesheet rules (focus rings, hovers, scrollbar).
    document.documentElement.style.setProperty('--onyx-accent', hex);
    document.documentElement.style.setProperty('--onyx-accent-r', String(parseInt(hex.slice(1, 3), 16)));
    document.documentElement.style.setProperty('--onyx-accent-g', String(parseInt(hex.slice(3, 5), 16)));
    document.documentElement.style.setProperty('--onyx-accent-b', String(parseInt(hex.slice(5, 7), 16)));
    setAccentColorRaw(hex);
  }, []);

  const currentBook = LIBRARY.find(b => b.id === currentBookId) || LIBRARY[0];
  const bookSecs = parseDur(currentBook.dur);

  // playback tick
  React.useEffect(() => {
    if (!playing) return;
    const sp = parseFloat(speed);
    const t = setInterval(() => {
      setPosition(p => {
        const n = p + sp;
        if (n >= bookSecs) { setPlaying(false); return bookSecs; }
        return n;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [playing, speed, bookSecs]);

  // keyboard: space=play/pause, ←/→=skip ±30s, ⌘/Ctrl+K focus search
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); setPlaying(p => !p); }
      if (e.code === 'ArrowLeft' && !e.metaKey && !e.ctrlKey) { setPosition(p => Math.max(0, p - 30)); }
      if (e.code === 'ArrowRight' && !e.metaKey && !e.ctrlKey) { setPosition(p => Math.min(bookSecs, p + 30)); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); const el = document.getElementById('onyx-search'); el?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bookSecs]);

  return {
    screen, setScreen,
    currentBook, currentBookId, setCurrentBookId,
    playing, setPlaying,
    position, setPosition, bookSecs,
    volume, setVolume, muted, setMuted,
    speed, setSpeed,
    device, setDevice, deviceOpen, setDeviceOpen,
    focusCollapsed, setFocusCollapsed,
    filter, setFilter,
    contextFilter, setContextFilter,
    search, setSearch,
    accentColor, setAccentColor,
    theme, setTheme,
    translucent, setTranslucent,
    librarySort, setLibrarySort,
    coverSize, setCoverSize,
    groupBySeries, setGroupBySeries,
    showFinished, setShowFinished,
    showProgressOverlay, setShowProgressOverlay,
    libraryView, setLibraryView,
    showHome, setShowHome,
    shelfTab, setShelfTab,
    pickItUpCollapsed, setPickItUpCollapsed,
  };
}

// --- color helpers (used by setAccentColor) ---
function hexToRgba(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
function lightenHex(hex, amt) {
  const h = hex.replace('#', '');
  const lift = (c) => Math.min(255, parseInt(c, 16) + Math.round(255 * amt));
  const r = lift(h.slice(0, 2)).toString(16).padStart(2, '0');
  const g = lift(h.slice(2, 4)).toString(16).padStart(2, '0');
  const b = lift(h.slice(4, 6)).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

// --- helpers ---
function parseDur(s) {
  // "24h 12m" -> seconds
  const m = s.match(/(\d+)h\s*(\d+)?m?/);
  if (!m) return 86400;
  return (parseInt(m[1] || '0') * 3600) + (parseInt(m[2] || '0') * 60);
}

function fmtTime(secs) {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

function fmtRemaining(secs) {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// Onyx palette (shared by all screens). Values get LIVE-MUTATED by applyTheme /
// setAccentColor so every inline-styled component picks up changes on next render.
const ONYX = {
  bg: '#0b0b0e',
  bgDeep: '#08080b',
  panel: '#131319',
  panel2: '#1a1a22',
  line: 'rgba(255,255,255,0.06)',
  text: '#ebe7df',
  textDim: 'rgba(235,231,223,0.62)',
  textMute: 'rgba(235,231,223,0.38)',
  accent: '#d4a64a',
  accentBright: '#e9bb5e',
  accentDim: 'rgba(212,166,74,0.18)',
  accentEdge: 'rgba(212,166,74,0.35)',
  glass: 'rgba(255,255,255,0.04)',
  glassStrong: 'rgba(255,255,255,0.07)',
  glassEdge: 'rgba(255,255,255,0.09)',
  sans: '"Inter", "Söhne", -apple-system, system-ui, sans-serif',
  serif: '"Source Serif Pro", Georgia, serif',
  mono: '"JetBrains Mono", ui-monospace, Menlo, monospace',
  isDark: true, // OnyxWash and a couple of other components branch on this.
};

// --- Theme palettes ---
const ONYX_DARK_BASE = {
  bg: '#0b0b0e', bgDeep: '#08080b', panel: '#131319', panel2: '#1a1a22',
  line: 'rgba(255,255,255,0.06)',
  text: '#ebe7df', textDim: 'rgba(235,231,223,0.62)', textMute: 'rgba(235,231,223,0.38)',
  glass: 'rgba(255,255,255,0.04)', glassStrong: 'rgba(255,255,255,0.07)', glassEdge: 'rgba(255,255,255,0.09)',
  isDark: true,
};
// "Folio" — warm paper light theme. Off-white background, deep warm-ink text.
const ONYX_FOLIO_BASE = {
  bg: '#f4efe6', bgDeep: '#ebe5d8', panel: '#fbf8f2', panel2: '#f1ebde',
  line: 'rgba(38,30,18,0.10)',
  text: '#26211a', textDim: 'rgba(38,33,26,0.65)', textMute: 'rgba(38,33,26,0.42)',
  glass: 'rgba(255,253,247,0.55)', glassStrong: 'rgba(255,253,247,0.75)', glassEdge: 'rgba(38,30,18,0.10)',
  isDark: false,
};

function resolveTheme(t) {
  if (t === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return t;
}

function applyTheme(theme, accentHex) {
  const resolved = resolveTheme(theme);
  const base = resolved === 'dark' ? ONYX_DARK_BASE : ONYX_FOLIO_BASE;
  Object.assign(ONYX, base);
  const hex = accentHex || ONYX.accent;
  ONYX.accent = hex;
  ONYX.accentBright = lightenHex(hex, 0.08);
  ONYX.accentDim = hexToRgba(hex, resolved === 'dark' ? 0.18 : 0.16);
  ONYX.accentEdge = hexToRgba(hex, resolved === 'dark' ? 0.35 : 0.45);
  document.documentElement.style.background = ONYX.bg;
  document.body.style.background = ONYX.bg;
  document.body.style.color = ONYX.text;
}

const AUDIO_DEVICES = [
  { id: 'sennheiser', name: 'Sennheiser HD 660S', sub: 'USB · 48 kHz · 24-bit', icon: 'headphones' },
  { id: 'system', name: 'System default', sub: 'Realtek Audio', icon: 'speaker' },
  { id: 'sonos', name: 'Living Room — Sonos', sub: 'AirPlay · 192.168.1.42', icon: 'airplay' },
  { id: 'airpods', name: 'AirPods Pro', sub: 'Bluetooth · AAC', icon: 'bluetooth' },
  { id: 'monitors', name: 'Studio Monitors', sub: 'Focusrite Scarlett 2i2', icon: 'monitor' },
];

const SPEEDS = ['0.8', '1.0', '1.25', '1.5', '2.0'];

// Mock bookmarks for the current book
const BOOKMARKS = [
  { ts: '0:38:17', secs: 38 * 60 + 17, ch: 14, label: 'Cairn imagery again', date: 'Today' },
  { ts: '1:12:04', secs: 60 * 60 + 12 * 60 + 4, ch: 13, label: '"half a salute, half a question"', date: 'Yesterday' },
  { ts: '0:21:47', secs: 21 * 60 + 47, ch: 11, label: 'First mention of the wolves', date: 'Mon' },
];

// Mock chapter list for the current book
const CHAPTERS = [
  { n: 1, t: 'A Letter from the South', dur: 2810 },
  { n: 2, t: 'The Inn at Harndon', dur: 3014 },
  { n: 3, t: 'On the Road', dur: 2780 },
  { n: 4, t: 'The First Skirmish', dur: 3340 },
  { n: 5, t: 'Captain and Squire', dur: 2950 },
  { n: 6, t: 'Pilgrims and Saints', dur: 3120 },
  { n: 7, t: 'A Council of Knights', dur: 2890 },
  { n: 8, t: 'Through the Forest', dur: 3210 },
  { n: 9, t: 'The River Crossing', dur: 2670 },
  { n: 10, t: 'An Unexpected Embassy', dur: 3450 },
  { n: 11, t: 'The Wolves of Adrian', dur: 3080 },
  { n: 12, t: 'A Question of Honor', dur: 3134 },
  { n: 13, t: 'Through the Mist', dur: 4462 },
  { n: 14, t: 'The Long March Begins', dur: 5887 },
  { n: 15, t: 'Banners over Liviapolis', dur: 3768 },
  { n: 16, t: 'A Council of Wolves', dur: 2853 },
  { n: 17, t: "The Emperor's Gambit", dur: 4869 },
  { n: 18, t: 'Cold Iron', dur: 3527 },
];

// Given a global position in seconds, find which chapter we're in + local position
function chapterAt(pos) {
  let acc = 0;
  for (let i = 0; i < CHAPTERS.length; i++) {
    if (pos < acc + CHAPTERS[i].dur) return { idx: i, local: pos - acc, chapter: CHAPTERS[i] };
    acc += CHAPTERS[i].dur;
  }
  return { idx: CHAPTERS.length - 1, local: CHAPTERS.at(-1).dur, chapter: CHAPTERS.at(-1) };
}

function chapterStart(idx) {
  let acc = 0;
  for (let i = 0; i < idx; i++) acc += CHAPTERS[i].dur;
  return acc;
}

Object.assign(window, { useOnyxState, ONYX, AUDIO_DEVICES, SPEEDS, CHAPTERS, BOOKMARKS, fmtTime, fmtRemaining, parseDur, chapterAt, chapterStart });
