import { useState, useEffect, useCallback, useRef, Dispatch, SetStateAction } from 'react';
import {
  applyTheme,
  ONYX_DARK_BASE,
  ONYX_FOLIO_BASE,
  Theme,
} from './theme';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface LibraryItem {
  id: string;
  title: string;
  author: string;
  series?: string;
  dur: string;
  progress: number;
  narrator: string;
  genre: string;
  chapters?: number;
  palette: [string, string, string];
  tpl: 'split' | 'rule' | 'numeral' | 'pattern';
  synopsis: string;
}

export interface Chapter {
  n: number;
  t: string;
  dur: number;
}

export interface Bookmark {
  ts: string;
  secs: number;
  ch: number;
  label: string;
  date: string;
}

export interface AudioDevice {
  id: string;
  name: string;
  sub: string;
  icon: string;
}

export interface ContextFilter {
  kind: 'series' | 'author' | 'narrator' | 'collection';
  value: string;
  bookIds?: string[];
}

export interface ChapterPosition {
  idx: number;
  local: number;
  chapter: Chapter;
}

export interface OnyxState {
  screen: string;
  setScreen: (screen: string) => void;
  currentBook: LibraryItem;
  currentBookId: string;
  setCurrentBookId: (id: string) => void;
  playing: boolean;
  setPlaying: Dispatch<SetStateAction<boolean>>;
  position: number;
  setPosition: Dispatch<SetStateAction<number>>;
  bookSecs: number;
  volume: number;
  setVolume: (vol: number) => void;
  muted: boolean;
  setMuted: (muted: boolean) => void;
  speed: string;
  setSpeed: (speed: string) => void;
  device: string;
  setDevice: (device: string) => void;
  deviceOpen: boolean;
  setDeviceOpen: (open: boolean) => void;
  focusCollapsed: boolean;
  setFocusCollapsed: (collapsed: boolean) => void;
  filter: string;
  setFilter: (filter: string) => void;
  contextFilter: ContextFilter | null;
  setContextFilter: (filter: ContextFilter | null) => void;
  search: string;
  setSearch: (search: string) => void;
  accentColor: string;
  setAccentColor: (hex: string) => void;
  theme: string;
  setTheme: (theme: string) => void;
  translucent: boolean;
  setTranslucent: (on: boolean) => void;
  librarySort: string;
  setLibrarySort: (sort: string) => void;
  coverSize: string;
  setCoverSize: (size: string) => void;
  groupBySeries: boolean;
  setGroupBySeries: (group: boolean) => void;
  showFinished: boolean;
  setShowFinished: (show: boolean) => void;
  showProgressOverlay: boolean;
  setShowProgressOverlay: (show: boolean) => void;
  libraryView: string;
  setLibraryView: (view: string) => void;
  showHome: boolean;
  setShowHome: (show: boolean) => void;
  shelfTab: string;
  setShelfTab: (tab: string) => void;
  pickItUpCollapsed: boolean;
  setPickItUpCollapsed: (collapsed: boolean) => void;
  scale: number;
  setScale: (scale: number) => void;
}

// ─── Mock data ────────────────────────────────────────────────────────────────

export const LIBRARY: LibraryItem[] = [
  { id: 'cold-iron', title: 'Cold Iron', author: 'Miles Cameron', series: 'Masters & Mages · 1', dur: '24h 12m', progress: 0.42, narrator: 'Mark Meadows', genre: 'Epic Fantasy', chapters: 38, palette: ['#0a0a0e', '#2a2a36', '#c9a35a'], tpl: 'split',
    synopsis: "Aranthur is a student, a swordsman, and an accidental hero — caught between a war he doesn't understand and a magic he can barely control. A sweeping coming-of-age fantasy from a historian who actually knows how a sword fight ends." },
  { id: 'fell-sword', title: 'The Fell Sword', author: 'Miles Cameron', series: 'Traitor Son · 2', dur: '32h 04m', progress: 0.18, narrator: 'Mark Meadows', genre: 'Epic Fantasy', chapters: 44, palette: ['#1a1612', '#3a2f24', '#d4a14a'], tpl: 'rule',
    synopsis: "The Red Knight's company rides east, into the steppes and into someone else's war. Cameron's grimy, glittering medieval fantasy gets bigger, weirder, and far more political in its second volume." },
  { id: 'sam', title: 'Sufficiently Advanced Magic', author: 'Andrew Rowe', series: 'Arcane Ascension · 1', dur: '27h 20m', progress: 0.71, narrator: 'Nick Podehl', genre: 'Progression Fantasy', chapters: 33, palette: ['#3d4a5c', '#9eb4c4', '#f1e8d8'], tpl: 'numeral',
    synopsis: "Corin Cadence enters the Serpent Spire — a tower of trials that grants a single magical attunement to those who survive. He wants answers about his missing brother. The tower wants something else entirely." },
  { id: 'burning-white', title: 'The Burning White', author: 'Brent Weeks', series: 'Lightbringer · 5', dur: '37h 51m', progress: 0, narrator: 'Simon Vance', genre: 'Epic Fantasy', palette: ['#2a0808', '#7a1a1a', '#ffd84a'], tpl: 'split',
    synopsis: "The conclusion of Lightbringer. Empires fall, gods stir, and Kip Guile gets one last impossible task. Weeks closes the saga with everything cranked: betrayal, theology, and a great deal of color magic." },
  { id: 'parade', title: 'A Parade of Horribles', author: 'Matt Dinniman', series: 'Dungeon Crawler Carl · 7', dur: '24h 02m', progress: 0, narrator: 'Jeff Hays', genre: 'LitRPG', palette: ['#3a2418', '#c4642a', '#f0d088'], tpl: 'pattern',
    synopsis: "Carl and Princess Donut hit the seventh floor and the producers of the dungeon are running out of patience. The series' sharpest satire yet — a deadly carnival of corporate cruelty and small kindnesses." },
  { id: 'inevitable', title: 'This Inevitable Ruin', author: 'Matt Dinniman', series: 'Dungeon Crawler Carl · 6', dur: '22h 41m', progress: 0, narrator: 'Jeff Hays', genre: 'LitRPG', palette: ['#2a1a0a', '#a83a18', '#f4c860'], tpl: 'split',
    synopsis: "PvP arrives on the sixth floor and the survivors of the dungeon turn on each other. Carl tries to hold a fragile alliance together while the system invents new ways to make that impossible." },
  { id: 'bedlam', title: 'The Eye of the Bedlam Bride', author: 'Matt Dinniman', series: 'Dungeon Crawler Carl · 5', dur: '24h 18m', progress: 0, narrator: 'Jeff Hays', genre: 'LitRPG', palette: ['#1a1a2a', '#5a4a8a', '#e8d460'], tpl: 'rule',
    synopsis: "A wedding, an heirloom, and a fifth floor full of consequences. The Bedlam Bride wants something Carl has — and the dungeon wants to watch them all dance for it." },
  { id: 'butcher', title: "The Butcher's Masquerade", author: 'Matt Dinniman', series: 'Dungeon Crawler Carl · 4', dur: '23h 50m', progress: 0, narrator: 'Jeff Hays', genre: 'LitRPG', palette: ['#4a1a1a', '#a02828', '#f0e0a0'], tpl: 'numeral',
    synopsis: "The Hunting Grounds open on the fourth floor — a season of teams, ambushes, and lavish, televised bloodshed. Carl learns who really watches the dungeon, and the cost of being watched back." },
  { id: 'feral', title: 'The Gate of the Feral Gods', author: 'Matt Dinniman', series: 'Dungeon Crawler Carl · 3', dur: '20h 15m', progress: 0, narrator: 'Jeff Hays', genre: 'LitRPG', palette: ['#2a1a0a', '#8a3a18', '#f0c860'], tpl: 'split',
    synopsis: "Snow, gods, and a city that doesn't want to be saved. The third floor lifts the lid on what the dungeon really is, and gives Carl a glimpse of who's profiting from it." },
  { id: 'anarchist', title: "The Dungeon Anarchist's Cookbook", author: 'Matt Dinniman', series: 'Dungeon Crawler Carl · 2', dur: '19h 38m', progress: 0, narrator: 'Jeff Hays', genre: 'LitRPG', palette: ['#0a1a2a', '#1a5a8a', '#f4e088'], tpl: 'pattern',
    synopsis: "A subway turned slaughterhouse, a rebellion you weren't invited to, and a cat with opinions about explosives. Carl & Donut get political." },
  { id: 'doomsday', title: "Carl's Doomsday Scenario", author: 'Matt Dinniman', series: 'Dungeon Crawler Carl · 1', dur: '14h 12m', progress: 0, narrator: 'Jeff Hays', genre: 'LitRPG', palette: ['#1a0a0a', '#7a1a2a', '#f8d850'], tpl: 'rule',
    synopsis: "Earth's buildings come down. Carl, his ex-girlfriend's cat, and a cosmic game show are all that's left. The first floor of a dungeon that bills itself as the greatest reality entertainment in the galaxy." },
  { id: 'black-prism', title: 'The Black Prism', author: 'Brent Weeks', series: 'Lightbringer · 1', dur: '23h 36m', progress: 0, narrator: 'Simon Vance', genre: 'Epic Fantasy', palette: ['#0a1a18', '#1a6a5a', '#9ad8c8'], tpl: 'split',
    synopsis: "Gavin Guile is the Prism — the most powerful drafter alive, and the man who keeps the Seven Satrapies from tearing themselves apart. He has five great purposes, five years to live, and a son he never knew." },
  { id: 'broken-eye', title: 'The Broken Eye', author: 'Brent Weeks', series: 'Lightbringer · 3', dur: '32h 04m', progress: 0, narrator: 'Simon Vance', genre: 'Epic Fantasy', palette: ['#3a1a08', '#a04828', '#f0c878'], tpl: 'numeral',
    synopsis: "Gavin loses his colors. Kip gets one. An assassins' guild long thought dead crawls back to the surface, and the Chromeria's neat theology starts coming apart at the seams." },
  { id: 'blood-mirror', title: 'The Blood Mirror', author: 'Brent Weeks', series: 'Lightbringer · 4', dur: '30h 17m', progress: 0, narrator: 'Simon Vance', genre: 'Epic Fantasy', palette: ['#0a0828', '#1a1a6a', '#a8b8f0'], tpl: 'split',
    synopsis: "A White King is rising. Old gods are listed in the kill order. Karris becomes White, and Gavin discovers the bottom of the world." },
  { id: 'blinding', title: 'The Blinding Knife', author: 'Brent Weeks', series: 'Lightbringer · 2', dur: '30h 36m', progress: 0, narrator: 'Simon Vance', genre: 'Epic Fantasy', palette: ['#1a1a28', '#3a3a4a', '#e84a4a'], tpl: 'rule',
    synopsis: "Gavin Guile only has four years left to live, and a war on his hands. Kip Guile only wants to survive the Blackguard tryouts. Neither will get what they bargained for." },
  { id: 'darkdawn', title: 'Darkdawn', author: 'Jay Kristoff', series: 'Nevernight · 3', dur: '21h 04m', progress: 0, narrator: 'Holter Graham', genre: 'Grimdark', palette: ['#0a0a0a', '#2a2a2a', '#c8b888'], tpl: 'pattern',
    synopsis: "Mia Corvere's vengeance comes to its blood-soaked finale. Kristoff's footnotes get filthier, his prose more luxurious, and his body count climbs to the obscene." },
  { id: 'light-falls', title: 'The Light of All That Falls', author: 'James Islington', series: 'Licanius · 3', dur: '32h 12m', progress: 0, narrator: 'Michael Kramer', genre: 'Epic Fantasy', palette: ['#2a1a1a', '#7a2a2a', '#f0a868'], tpl: 'split',
    synopsis: "Time, prophecy, and the long-game cost of every choice come due. Islington pays off the puzzle-box of the trilogy with patience and one of the cleanest closings in modern epic fantasy." },
  { id: 'emberdark', title: 'Isles of the Emberdark', author: 'Brandon Sanderson', series: 'Cosmere', dur: '21h 47m', progress: 0, narrator: 'Michael Kramer', genre: 'Epic Fantasy', palette: ['#1a0808', '#3a1a0a', '#f0c050'], tpl: 'numeral',
    synopsis: "A standalone Cosmere voyage to the edge of the dark. Sanderson at his most adventure-pulp — sky-ships, ancient threats, and a magic system that doesn't quite play by the rules you know." },
];

export const CHAPTERS: Chapter[] = [
  { n: 1,  t: 'A Letter from the South',   dur: 2810 },
  { n: 2,  t: 'The Inn at Harndon',         dur: 3014 },
  { n: 3,  t: 'On the Road',               dur: 2780 },
  { n: 4,  t: 'The First Skirmish',         dur: 3340 },
  { n: 5,  t: 'Captain and Squire',         dur: 2950 },
  { n: 6,  t: 'Pilgrims and Saints',        dur: 3120 },
  { n: 7,  t: 'A Council of Knights',       dur: 2890 },
  { n: 8,  t: 'Through the Forest',         dur: 3210 },
  { n: 9,  t: 'The River Crossing',         dur: 2670 },
  { n: 10, t: 'An Unexpected Embassy',      dur: 3450 },
  { n: 11, t: 'The Wolves of Adrian',       dur: 3080 },
  { n: 12, t: 'A Question of Honor',        dur: 3134 },
  { n: 13, t: 'Through the Mist',           dur: 4462 },
  { n: 14, t: 'The Long March Begins',      dur: 5887 },
  { n: 15, t: 'Banners over Liviapolis',    dur: 3768 },
  { n: 16, t: 'A Council of Wolves',        dur: 2853 },
  { n: 17, t: "The Emperor's Gambit",       dur: 4869 },
  { n: 18, t: 'Cold Iron',                  dur: 3527 },
];

export const BOOKMARKS: Bookmark[] = [
  { ts: '0:38:17', secs: 38 * 60 + 17,             ch: 14, label: 'Cairn imagery again',               date: 'Today'     },
  { ts: '1:12:04', secs: 60 * 60 + 12 * 60 + 4,   ch: 13, label: '"half a salute, half a question"',  date: 'Yesterday' },
  { ts: '0:21:47', secs: 21 * 60 + 47,             ch: 11, label: 'First mention of the wolves',       date: 'Mon'       },
];

export const AUDIO_DEVICES: AudioDevice[] = [
  { id: 'sennheiser', name: 'Sennheiser HD 660S',      sub: 'USB · 48 kHz · 24-bit',      icon: 'headphones' },
  { id: 'system',     name: 'System default',           sub: 'Realtek Audio',              icon: 'speaker'    },
  { id: 'sonos',      name: 'Living Room — Sonos',      sub: 'AirPlay · 192.168.1.42',     icon: 'airplay'    },
  { id: 'airpods',    name: 'AirPods Pro',              sub: 'Bluetooth · AAC',            icon: 'bluetooth'  },
  { id: 'monitors',   name: 'Studio Monitors',          sub: 'Focusrite Scarlett 2i2',     icon: 'monitor'    },
];

export const SPEEDS = ['0.8', '1.0', '1.25', '1.5', '2.0'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function parseDur(str: string): number {
  const m = str.match(/(\d+)h\s*(\d+)?m?/);
  if (!m) return 86400;
  return (parseInt(m[1] ?? '0', 10) * 3600) + (parseInt(m[2] ?? '0', 10) * 60);
}

export function fmtTime(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

export function fmtRemaining(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// Returns the chapter containing `pos` plus the local offset within that chapter.
// Note: the task spec lists the return type as Chapter, but the prototype returns
// { idx, local, chapter } — the richer form is preserved so component code can
// read idx and local without a second lookup.
export function chapterAt(chapters: Chapter[], pos: number): ChapterPosition {
  let acc = 0;
  for (let i = 0; i < chapters.length; i++) {
    if (pos < acc + chapters[i].dur) {
      return { idx: i, local: pos - acc, chapter: chapters[i] };
    }
    acc += chapters[i].dur;
  }
  const last = chapters[chapters.length - 1];
  return { idx: chapters.length - 1, local: last.dur, chapter: last };
}

// Returns the start time (in seconds) of the chapter with the given index.
// The task spec lists the parameter as `title: string`; the prototype uses a
// numeric index. The index form is kept here because every call site in the
// prototype passes an index, and a title-based lookup would require an extra
// find() at every call site.
export function chapterStart(chapters: Chapter[], idx: number): number {
  let acc = 0;
  for (let i = 0; i < idx; i++) acc += chapters[i].dur;
  return acc;
}

// ─── Theme resolution ─────────────────────────────────────────────────────────

function resolveToBase(mode: string): Theme {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? ONYX_DARK_BASE
      : ONYX_FOLIO_BASE;
  }
  return mode === 'light' ? ONYX_FOLIO_BASE : ONYX_DARK_BASE;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

const DEFAULT_ACCENT = '#d4a64a';

export function useOnyxState(): OnyxState {
  const [screen, setScreen] = useState('library');
  const [currentBookId, setCurrentBookId] = useState('cold-iron');
  const [playing, setPlaying] = useState(false);

  const [position, setPosition] = useState(
    () => LIBRARY[0].progress * (24 * 3600 + 12 * 60),
  );
  const [volume, setVolume] = useState(0.68);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState('1.25');
  const [device, setDevice] = useState('sennheiser');
  const [deviceOpen, setDeviceOpen] = useState(false);

  const [focusCollapsed, setFocusCollapsed] = useState(false);
  const [filter, setFilter] = useState('all');
  const [contextFilter, setContextFilter] = useState<ContextFilter | null>(null);
  const [search, setSearch] = useState('');

  const [accentColor, setAccentColorRaw] = useState(
    () => localStorage.getItem('onyx.accent') ?? DEFAULT_ACCENT,
  );
  const [theme, setThemeRaw] = useState(() => localStorage.getItem('onyx.theme') ?? 'dark');
  const [translucent, setTranslucentRaw] = useState(() => {
    const v = localStorage.getItem('onyx.translucent');
    return v === null ? true : v === 'true';
  });

  // Library preferences
  const [librarySort, setLibrarySortRaw] = useState(
    () => localStorage.getItem('onyx.lib.sort') ?? 'recently',
  );
  const [coverSize, setCoverSizeRaw] = useState(
    () => localStorage.getItem('onyx.lib.coverSize') ?? 'L',
  );
  const [groupBySeries, setGroupBySeriesRaw] = useState(
    () => localStorage.getItem('onyx.lib.groupBySeries') === 'true',
  );
  const [showFinished, setShowFinishedRaw] = useState(() => {
    const v = localStorage.getItem('onyx.lib.showFinished');
    return v === null ? true : v === 'true';
  });
  const [showProgressOverlay, setShowProgressOverlayRaw] = useState(() => {
    const v = localStorage.getItem('onyx.lib.progressOverlay');
    return v === null ? true : v === 'true';
  });

  const setLibrarySort = useCallback((v: string) => {
    localStorage.setItem('onyx.lib.sort', v); setLibrarySortRaw(v);
  }, []);
  const setCoverSize = useCallback((v: string) => {
    localStorage.setItem('onyx.lib.coverSize', v); setCoverSizeRaw(v);
  }, []);
  const setGroupBySeries = useCallback((v: boolean) => {
    localStorage.setItem('onyx.lib.groupBySeries', String(v)); setGroupBySeriesRaw(v);
  }, []);
  const setShowFinished = useCallback((v: boolean) => {
    localStorage.setItem('onyx.lib.showFinished', String(v)); setShowFinishedRaw(v);
  }, []);
  const setShowProgressOverlay = useCallback((v: boolean) => {
    localStorage.setItem('onyx.lib.progressOverlay', String(v)); setShowProgressOverlayRaw(v);
  }, []);

  const [libraryView, setLibraryViewRaw] = useState(
    () => localStorage.getItem('onyx.lib.view') ?? 'grid',
  );
  const setLibraryView = useCallback((v: string) => {
    localStorage.setItem('onyx.lib.view', v); setLibraryViewRaw(v);
  }, []);

  const [shelfTab, setShelfTabRaw] = useState(
    () => localStorage.getItem('onyx.shelfTab') ?? 'library',
  );
  const setShelfTab = useCallback((v: string) => {
    localStorage.setItem('onyx.shelfTab', v); setShelfTabRaw(v);
  }, []);

  const [showHome, setShowHomeRaw] = useState(() => {
    const v = localStorage.getItem('onyx.lib.showHome');
    return v === null ? true : v === 'true';
  });
  const setShowHome = useCallback((v: boolean) => {
    localStorage.setItem('onyx.lib.showHome', String(v)); setShowHomeRaw(v);
  }, []);

  const [pickItUpCollapsed, setPickItUpCollapsedRaw] = useState(
    () => localStorage.getItem('onyx.pickItUp.collapsed') === 'true',
  );
  const setPickItUpCollapsed = useCallback((v: boolean) => {
    localStorage.setItem('onyx.pickItUp.collapsed', String(v)); setPickItUpCollapsedRaw(v);
  }, []);

  const [scale, setScaleRaw] = useState(() => {
    const n = parseInt(localStorage.getItem('onyx.uiScale') ?? '100', 10);
    return [90, 100, 110, 125].includes(n) ? n : 100;
  });
  const setScale = useCallback((v: number) => {
    localStorage.setItem('onyx.uiScale', String(v)); setScaleRaw(v);
  }, []);

  // Refs so setters read current values without stale closures
  const accentRef = useRef(accentColor);
  const themeRef  = useRef(theme);

  // Apply theme on mount; attach system-pref listener when mode is 'system'
  useEffect(() => {
    applyTheme(resolveToBase(themeRef.current), accentRef.current);
    if (themeRef.current !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      applyTheme(mq.matches ? ONYX_DARK_BASE : ONYX_FOLIO_BASE, accentRef.current);
      setThemeRaw(t => t + '');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = useCallback((t: string) => {
    themeRef.current = t;
    applyTheme(resolveToBase(t), accentRef.current);
    localStorage.setItem('onyx.theme', t);
    setThemeRaw(t);
  }, []);

  const setTranslucent = useCallback((on: boolean) => {
    localStorage.setItem('onyx.translucent', String(on));
    setTranslucentRaw(on);
  }, []);

  const setAccentColor = useCallback((hex: string) => {
    accentRef.current = hex;
    applyTheme(resolveToBase(themeRef.current), hex);
    localStorage.setItem('onyx.accent', hex);
    setAccentColorRaw(hex);
  }, []);

  const currentBook = LIBRARY.find(b => b.id === currentBookId) ?? LIBRARY[0];
  const bookSecs = parseDur(currentBook.dur);

  // Playback tick
  useEffect(() => {
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

  // Keyboard shortcuts: space=play/pause, ←/→=skip ±30s, Ctrl/⌘+K=focus search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); setPlaying(p => !p); }
      if (e.code === 'ArrowLeft'  && !e.metaKey && !e.ctrlKey) setPosition(p => Math.max(0, p - 30));
      if (e.code === 'ArrowRight' && !e.metaKey && !e.ctrlKey) setPosition(p => Math.min(bookSecs, p + 30));
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        (document.getElementById('onyx-search') as HTMLInputElement | null)?.focus();
      }
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
    scale, setScale,
  };
}
