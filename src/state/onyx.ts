import { useState, useEffect, useCallback, useRef, Dispatch, SetStateAction } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { LibraryItem, MediaProgress, ListeningStats, Bookmark as AbsBookmark, User } from '../api/abs';
import { login, fetchLibraries, fetchLibraryItems, fetchItem, saveToken, fetchListeningStats, getMe } from '../api/abs';

export type { User };
import {
  applyTheme,
  ONYX_DARK_BASE,
  ONYX_FOLIO_BASE,
  Theme,
} from './theme';

// ─── Re-exported API types ────────────────────────────────────────────────────

export type { LibraryItem, MediaProgress, ListeningStats };
export type { AbsBookmark };

// ─── Local-only interfaces ────────────────────────────────────────────────────

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

// ─── Display helpers for real LibraryItem ─────────────────────────────────────

export function bookTitle(b: LibraryItem): string {
  return b.media.metadata.title ?? b.id;
}

export function bookAuthor(b: LibraryItem): string {
  const a = b.media.metadata.authorName;
  if (!a) return 'Unknown Author';
  if (typeof a === 'string') return a;
  if (Array.isArray(a)) return a.map(x => x.name).join(', ');
  return a.name;
}

export function bookSeries(b: LibraryItem): string | undefined {
  return b.media.metadata.seriesName ?? undefined;
}

export function bookNarrator(b: LibraryItem): string {
  return b.media.metadata.narratorName ?? '';
}

export function bookGenre(b: LibraryItem): string {
  return b.media.metadata.genres[0] ?? '';
}

export function bookDurSecs(b: LibraryItem): number {
  return b.media.duration;
}

export function bookDur(b: LibraryItem): string {
  return fmtRemaining(b.media.duration);
}

export function bookProgress(b: LibraryItem, mediaProgress: MediaProgress[]): number {
  const mp = mediaProgress.find(p => p.libraryItemId === b.id);
  return mp?.progress ?? 0;
}

export function bookCurrentTime(b: LibraryItem, mediaProgress: MediaProgress[]): number {
  const mp = mediaProgress.find(p => p.libraryItemId === b.id);
  return mp?.currentTime ?? 0;
}

export function bookSynopsis(_b: LibraryItem): string | undefined {
  return undefined;
}

export function bookChapters(b: LibraryItem): Chapter[] {
  return (b.media.chapters || []).map((c, i) => ({
    n: i + 1,
    t: c.title,
    dur: c.end - c.start,
  }));
}

const PALETTES: [string, string, string][] = [
  ['#0a0a0e', '#2a2a36', '#c9a35a'],
  ['#1a1612', '#3a2f24', '#d4a14a'],
  ['#3d4a5c', '#9eb4c4', '#f1e8d8'],
  ['#2a0808', '#7a1a1a', '#ffd84a'],
  ['#3a2418', '#c4642a', '#f0d088'],
  ['#1a0a0a', '#7a1a2a', '#f8d850'],
  ['#0a1a18', '#1a6a5a', '#9ad8c8'],
  ['#2a1a1a', '#7a2a2a', '#f0a868'],
];
const TPLS: ('split' | 'rule' | 'numeral' | 'pattern')[] = ['split', 'rule', 'numeral', 'pattern'];

function hashId(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

export function bookPalette(b: LibraryItem): [string, string, string] {
  return PALETTES[hashId(b.id) % PALETTES.length];
}

export function bookTpl(b: LibraryItem): 'split' | 'rule' | 'numeral' | 'pattern' {
  return TPLS[(hashId(b.id) >> 2) % TPLS.length];
}

// ─── Static mock data (chapters, bookmarks, devices) ─────────────────────────

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

// ─── OnyxState interface ──────────────────────────────────────────────────────

export interface OnyxState {
  // Server connection
  serverUrl: string;
  setServerUrl: (url: string) => void;
  sessionId: string;
  setSessionId: (id: string) => void;
  sessionReady: boolean;
  setSessionReady: (ready: boolean) => void;
  username: string;
  setUsername: (u: string) => void;
  password: string;
  setPassword: (p: string) => void;
  userId: string;
  setUserId: (id: string) => void;
  authToken: string;
  setAuthToken: (token: string) => void;
  // Auth
  user: User | null;
  setUser: (user: User | null) => void;
  // Library
  library: LibraryItem[];
  libraryLoading: boolean;
  mediaProgress: MediaProgress[];
  setMediaProgress: (progress: MediaProgress[]) => void;
  listeningStats: ListeningStats | null;
  bookmarks: AbsBookmark[];
  setBookmarks: (bookmarks: AbsBookmark[]) => void;
  // Playback
  screen: string;
  setScreen: (screen: string) => void;
  currentBook: LibraryItem | undefined;
  currentBookId: string;
  setCurrentBookId: (id: string) => void;
  currentBookChapters: Chapter[];
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
  enableOpenLibrary: boolean;
  setEnableOpenLibrary: (on: boolean) => void;
}

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

export function chapterAt(chapters: Chapter[], pos: number): ChapterPosition {
  if (chapters.length === 0) {
    const stub: Chapter = { n: 1, t: '', dur: 0 };
    return { idx: 0, local: 0, chapter: stub };
  }
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
  // ── Server connection (localStorage-persisted) ──────────────────────────────
  const [serverUrl, setServerUrlRaw] = useState(
    () => localStorage.getItem('skald.serverUrl') ?? '',
  );
  const [sessionId, setSessionIdRaw] = useState(
    () => localStorage.getItem('skald.sessionId') ?? '',
  );
  const [username, setUsernameRaw] = useState(
    () => localStorage.getItem('skald.username') ?? '',
  );
  const [password, setPasswordRaw] = useState(
    () => localStorage.getItem('skald.password') ?? '',
  );
  const [userId, setUserIdRaw] = useState(
    () => localStorage.getItem('skald.userId') ?? '',
  );
  const [authToken, setAuthTokenRaw] = useState(
    () => localStorage.getItem('skald.authToken') ?? '',
  );

  const setServerUrl = useCallback((v: string) => {
    localStorage.setItem('skald.serverUrl', v); setServerUrlRaw(v);
  }, []);
  const setSessionId = useCallback((v: string) => {
    localStorage.setItem('skald.sessionId', v); setSessionIdRaw(v);
  }, []);
  const setUsername = useCallback((v: string) => {
    localStorage.setItem('skald.username', v); setUsernameRaw(v);
  }, []);
  const setPassword = useCallback((v: string) => {
    localStorage.setItem('skald.password', v); setPasswordRaw(v);
  }, []);
  const setUserId = useCallback((v: string) => {
    localStorage.setItem('skald.userId', v); setUserIdRaw(v);
  }, []);
  const setAuthToken = useCallback((v: string) => {
    localStorage.setItem('skald.authToken', v); setAuthTokenRaw(v);
  }, []);

  const [user, setUserRaw] = useState<User | null>(() => {
    const stored = localStorage.getItem('skald.user');
    if (!stored) return null;
    try { return JSON.parse(stored) as User; } catch { return null; }
  });
  const setUser = useCallback((v: User | null) => {
    localStorage.setItem('skald.user', v ? JSON.stringify(v) : '');
    setUserRaw(v);
  }, []);

  // ── Library ─────────────────────────────────────────────────────────────────
  const [library, setLibraryRaw] = useState<LibraryItem[]>([]);
  const [libraryLoading, setLibraryLoadingRaw] = useState(
    () => Boolean(localStorage.getItem('skald.serverUrl') && localStorage.getItem('skald.authToken')),
  );
  const [mediaProgress, setMediaProgress] = useState<MediaProgress[]>([]);
  const [listeningStats, setListeningStats] = useState<ListeningStats | null>(null);
  const [bookmarks, setBookmarks] = useState<AbsBookmark[]>([]);

  useEffect(() => {
    if (!serverUrl || (!authToken && !(username && password))) {
      setLibraryLoadingRaw(false);
      return;
    }
    let cancelled = false;
    setLibraryLoadingRaw(true);
    (async () => {
      try {
        let token = authToken;
        if (!token && username && password) {
          const loggedInUser = await login(serverUrl, username, password);
          token = loggedInUser.token;
          setAuthToken(loggedInUser.token);
          setUserId(loggedInUser.id);
          setUser(loggedInUser);
        } else {
          await saveToken(token);
        }
        const libs = await fetchLibraries(serverUrl);
        if (cancelled) return;
        const audiobookLib = libs.find(l => l.mediaType === 'book') ?? libs[0];
        if (!audiobookLib) { setLibraryLoadingRaw(false); return; }
        const items = await fetchLibraryItems(serverUrl, audiobookLib.id);
        if (cancelled) return;
        setLibraryRaw(items);
      } catch (e) {
        console.error('Library fetch failed', e);
      } finally {
        if (!cancelled) setLibraryLoadingRaw(false);
      }
    })();
    return () => { cancelled = true; };
  }, [serverUrl, authToken, username, password]);

  // Fetch listeningStats + mediaProgress/bookmarks via /api/me once the library
  // has loaded and we have valid credentials.
  // getMe doesn't need userId; we derive it from the response so this works
  // even when userId was never stored in localStorage from a prior session.
  useEffect(() => {
    if (!serverUrl || !authToken || library.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const me = await getMe(serverUrl);
        if (cancelled) return;
        setMediaProgress(me.mediaProgress);
        setBookmarks(me.bookmarks);
        // Refresh user type from server — merge into stored user record and persist.
        if (me.type !== undefined) {
          const storedRaw = localStorage.getItem('skald.user');
          const base = storedRaw ? (JSON.parse(storedRaw) as User) : {} as User;
          setUser({ ...base, id: me.id, username: me.username, token: me.token, type: me.type });
        }
        const resolvedId = userId || me.id;
        if (!userId && me.id) setUserId(me.id);
        const stats = await fetchListeningStats(serverUrl, resolvedId);
        if (cancelled) return;
        setListeningStats(stats);
      } catch (e) {
        console.error('Post-library fetch failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, [library, serverUrl, authToken]);

  // ── Playback ─────────────────────────────────────────────────────────────────
  const [screen, setScreen] = useState('library');
  const [currentBookId, setCurrentBookId] = useState('');
  const [currentBookChapters, setCurrentBookChapters] = useState<Chapter[]>([]);

  useEffect(() => {
    if (!serverUrl || !authToken || !currentBookId) { setCurrentBookChapters([]); return; }
    let cancelled = false;
    fetchItem(serverUrl, currentBookId)
      .then(item => { if (!cancelled) setCurrentBookChapters(bookChapters(item)); })
      .catch(e => console.error('[chapters] fetchItem failed:', e));
    return () => { cancelled = true; };
  }, [currentBookId, serverUrl, authToken]);

  const [sessionReady, setSessionReady] = useState(false);

  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [volume, setVolume] = useState(0.68);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState('1.0');
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

  const [enableOpenLibrary, setEnableOpenLibraryRaw] = useState(() => {
    const v = localStorage.getItem('skald.enableOpenLibrary');
    return v === null ? true : v === 'true';
  });
  const setEnableOpenLibrary = useCallback((v: boolean) => {
    localStorage.setItem('skald.enableOpenLibrary', String(v)); setEnableOpenLibraryRaw(v);
  }, []);

  const accentRef = useRef(accentColor);
  const themeRef  = useRef(theme);

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

  // When library first loads, seed currentBookId to the first item.
  useEffect(() => {
    if (library.length > 0 && !currentBookId) {
      setCurrentBookId(library[0].id);
    }
  }, [library, currentBookId]);

  const currentBook = library.find(b => b.id === currentBookId) ?? library[0];
  const bookSecs = currentBook?.media.duration ?? 0;

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ currentTime: number; duration: number; isPlaying: boolean }>(
      'playback-tick',
      ({ payload }) => {
        setPosition(payload.currentTime);
        setPlaying(payload.isPlaying);
      },
    ).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

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
    serverUrl, setServerUrl,
    sessionId, setSessionId,
    sessionReady, setSessionReady,
    username, setUsername,
    password, setPassword,
    userId, setUserId,
    authToken, setAuthToken,
    user, setUser,
    library, libraryLoading, mediaProgress, setMediaProgress, listeningStats, bookmarks, setBookmarks,
    screen, setScreen,
    currentBook, currentBookId, setCurrentBookId, currentBookChapters,
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
    enableOpenLibrary, setEnableOpenLibrary,
  };
}
