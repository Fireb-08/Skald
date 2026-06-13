import { useState, useEffect, useCallback, useRef, Dispatch, SetStateAction } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { LibraryItem, MediaProgress, ListeningStats, Bookmark as AbsBookmark, User, DownloadRecord, ServerSettings, Task, Library, PodcastEpisode } from '../api/abs';
import { type AdvFilter, type SearchScope, EMPTY_ADV_FILTER } from '../lib/shelfFilters';
import { login, fetchLibraries, fetchLibraryItems, fetchItem, saveToken, fetchListeningStats, getMe, closeAllOpenSessions, getDownloads, saveLibraryCache, loadLibraryCache, flushOfflineProgress, saveChapterCache, loadChapterCache, markServerDeleted, playAudio, pauseAudio, fetchServerSettings } from '../api/abs';

export type { ServerSettings };

export type { User };
import {
  applyTheme,
  ONYX_DARK_BASE,
  ONYX_FOLIO_BASE,
  Theme,
} from './theme';

// ─── Re-exported API types ────────────────────────────────────────────────────

export type { LibraryItem, MediaProgress, ListeningStats, Library, PodcastEpisode };
export type { AbsBookmark };
export type { DownloadRecord };

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
  kind: 'series' | 'author' | 'narrator' | 'collection' | 'playlist' | 'genre' | 'publisher';
  value: string;
  bookIds?: string[];
  // For series filters: the ABS series ID used for exact book matching.
  seriesId?: string;
  // For playlist filters: the ABS playlist ID.
  playlistId?: string;
}

export interface ChapterPosition {
  idx: number;
  local: number;
  chapter: Chapter;
}

// ─── Author/narrator normalisation ────────────────────────────────────────────
// ABS endpoints sometimes return authorName as null with an `authors` array.
// This guard ensures the display fields are always populated when the array data is present.

function patchLibraryItems(items: LibraryItem[]): LibraryItem[] {
  return items.map(it => {
    const m = it.media?.metadata as unknown as Record<string, unknown>;
    if (!m) return it;
    if (!m.authorName && Array.isArray(m.authors)) {
      m.authorName = (m.authors as { name: string }[]).map(a => a.name).join(', ');
    }
    if (!m.narratorName && Array.isArray(m.narrators)) {
      m.narratorName = (m.narrators as string[]).join(', ');
    }
    return it;
  });
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

export function bookGenres(b: LibraryItem): string[] {
  return b.media.metadata.genres ?? [];
}

export function bookPublisher(b: LibraryItem): string {
  return b.media.metadata.publisher ?? '';
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
  // True when the logged-in user is admin or root. Derived from user.type.
  isAdmin: boolean;
  // Library
  library: LibraryItem[];
  // All libraries on the server (book + podcast), for the switcher. Populated
  // alongside the first item fetch and kept fresh by refreshLibrary().
  libraries: Library[];
  // The currently-active library object (derived from libraries + currentLibraryId).
  // Components read activeLibrary.mediaType to branch book vs podcast rendering.
  activeLibrary: Library | undefined;
  // Switch the active library and load its items. Resets the shelf view context.
  setActiveLibrary: (id: string) => Promise<void>;
  libraryLoading: boolean;
  // True when the library was loaded from the disk cache because the server was unreachable.
  // Used by the titlebar to display a persistent OFFLINE indicator.
  isOffline: boolean;
  updateLibraryItem: (item: LibraryItem) => void;
  refreshLibrary: () => Promise<void>;
  mediaProgress: MediaProgress[];
  setMediaProgress: (progress: MediaProgress[]) => void;
  listeningStats: ListeningStats | null;
  bookmarks: AbsBookmark[];
  setBookmarks: (bookmarks: AbsBookmark[]) => void;
  // Playback
  screen: string;
  setScreen: (screen: string) => void;
  // Podcast detail navigation: the podcast item shown on the 'podcast' screen.
  podcastDetailId: string | null;
  setPodcastDetailId: (id: string | null) => void;
  // The episode currently loaded for playback (null when a book is playing).
  // Lets the player/detail reflect what is playing; progress itself is tracked
  // server-side via the episode-scoped session, so this is presentation-only.
  currentEpisodeId: string | null;
  setCurrentEpisodeId: (id: string | null) => void;
  // The full episode object for the playing episode, so the Player can show
  // episode title/description/date/duration without re-fetching the item.
  currentEpisode: PodcastEpisode | null;
  setCurrentEpisode: (e: PodcastEpisode | null) => void;
  currentBook: LibraryItem | undefined;
  focusedBook: LibraryItem | undefined;
  focusedBookId: string | null;
  setFocusedBookId: (id: string | null) => void;
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
  // Advanced shelf filters (tags / language / explicit). Session-only.
  advFilter: AdvFilter;
  setAdvFilter: (f: AdvFilter) => void;
  search: string;
  setSearch: (search: string) => void;
  searchScope: SearchScope;
  setSearchScope: (s: SearchScope) => void;
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
  // Visibility of the optional shelf tabs (narrators/genres/publishers/playlists).
  // Core tabs (Home/Series/Authors/Collections) are always shown.
  optionalTabs: Record<string, boolean>;
  setOptionalTab: (id: string, on: boolean) => void;
  libraryView: string;
  setLibraryView: (view: string) => void;
  shelfTab: string;
  setShelfTab: (tab: string) => void;
  pickItUpCollapsed: boolean;
  setPickItUpCollapsed: (collapsed: boolean) => void;
  scale: number;
  setScale: (scale: number) => void;
  enableOpenLibrary: boolean;
  setEnableOpenLibrary: (on: boolean) => void;
  toast: { message: string; type: 'success' | 'error' | 'info' } | null;
  setToast: (t: { message: string; type: 'success' | 'error' | 'info' } | null) => void;
  confirmDialog: { title: string; message: string; confirmLabel: string; onConfirm: () => void } | null;
  setConfirmDialog: (d: { title: string; message: string; confirmLabel: string; onConfirm: () => void } | null) => void;
  removeLibraryItem: (id: string) => void;
  // ID of the currently loaded library — set when the library is first fetched
  // and kept up-to-date by refreshLibrary(). Used by GreetingPane to call
  // getLibraryStats() without needing to drill the ID through every call site.
  currentLibraryId: string;
  // Track which books are downloaded locally so the playback path can
  // route LibVLC to the local file instead of the HTTP stream.
  downloads: DownloadRecord[];
  setDownloads: Dispatch<SetStateAction<DownloadRecord[]>>;
  // Tracks whether the current playback source is a local file rather than
  // a server stream. When true, transport controls bypass session logic.
  isLocalPlayback: boolean;
  setIsLocalPlayback: (on: boolean) => void;
  // Global server settings — captured from the login response and refreshable
  // via Settings → Server Settings. Null until the first successful login.
  serverSettings: ServerSettings | null;
  setServerSettings: (s: ServerSettings) => void;
  // Background-task list, fed live by ABS task_started/task_finished socket
  // events so the Scheduled Tasks monitor stays current regardless of which pane
  // is open. Seeded from GET /api/tasks when the monitor mounts.
  tasks: Task[];
  setTasks: (t: Task[]) => void;
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
  // Full library list for the switcher (book + podcast).
  const [libraries, setLibraries] = useState<Library[]>([]);
  // Tracks the active library's ID so live sync handlers can filter events
  // that belong to a different library (e.g., a podcast library vs. books).
  // Declared here (above refreshLibrary) because refreshLibrary now reads it.
  const [currentLibraryId, setCurrentLibraryId] = useState('');
  const updateLibraryItem = useCallback((item: LibraryItem) => {
    setLibraryRaw(prev => prev.map(x => x.id === item.id ? item : x));
  }, []);
  const removeLibraryItem = useCallback((id: string) => {
    setLibraryRaw(prev => prev.filter(x => x.id !== id));
  }, []);

  // Choose which library to make active from a freshly-fetched list. Preference
  // order: the user's last explicit selection (persisted) if it still exists,
  // then the previously-active id, then the first book library, then anything.
  // Keeping book-first preserves the original single-book-library behavior for
  // users who never touch the switcher.
  const pickActiveLibrary = useCallback((libs: Library[]): Library | undefined => {
    const saved = localStorage.getItem('skald.activeLibraryId');
    return libs.find(l => l.id === saved)
      ?? libs.find(l => l.mediaType === 'book')
      ?? libs[0];
  }, []);

  const refreshLibrary = useCallback(async () => {
    if (!serverUrl) return;
    try {
      const libs = await fetchLibraries(serverUrl);
      setLibraries(libs);
      // Reload whichever library is currently active; fall back to the picker if
      // the active one vanished (deleted) or was never set.
      const target = libs.find(l => l.id === currentLibraryId) ?? pickActiveLibrary(libs);
      if (!target) return;
      setCurrentLibraryId(target.id);
      const items = await fetchLibraryItems(serverUrl, target.id);
      setLibraryRaw(patchLibraryItems(items));
    } catch (e) {
      console.error('[refreshLibrary] failed:', e);
    }
  }, [serverUrl, currentLibraryId, pickActiveLibrary]);

  // Switch the active library and load its items. View-context resets (search,
  // contextFilter, shelfTab, focus) are done by the caller (TopNav) since those
  // setters live further down the hook.
  const setActiveLibrary = useCallback(async (id: string) => {
    if (!serverUrl) return;
    console.log('[library] switching active library →', id);
    localStorage.setItem('skald.activeLibraryId', id);
    setCurrentLibraryId(id);
    setLibraryLoadingRaw(true);
    try {
      const items = await fetchLibraryItems(serverUrl, id);
      setLibraryRaw(patchLibraryItems(items));
      setIsOffline(false);
      saveLibraryCache(items).catch(e => console.error('[library] cache save failed:', e));
    } catch (e) {
      console.error('[setActiveLibrary] failed:', e);
    } finally {
      setLibraryLoadingRaw(false);
    }
  }, [serverUrl]);
  const [libraryLoading, setLibraryLoadingRaw] = useState(
    () => Boolean(localStorage.getItem('skald.serverUrl') && localStorage.getItem('skald.authToken')),
  );
  // True when the library loaded from the disk cache (server unreachable).
  // Reset to false on every successful server fetch.
  const [isOffline, setIsOffline] = useState(false);
  const [mediaProgress, setMediaProgress] = useState<MediaProgress[]>([]);
  const [listeningStats, setListeningStats] = useState<ListeningStats | null>(null);
  const [bookmarks, setBookmarks] = useState<AbsBookmark[]>([]);

  // ── Downloads registry ──────────────────────────────────────────────────────
  // Which books are stored on disk for offline playback. Loaded from the
  // persistent JSON registry once on mount and refreshed after each completed
  // download so playBook can immediately route to the local file.
  const [downloads, setDownloads] = useState<DownloadRecord[]>([]);

  // True while LibVLC is playing a local file (no server session open).
  // Cleared whenever an online session is started so transport controls
  // revert to session-aware behaviour automatically.
  const [isLocalPlayback, setIsLocalPlayback] = useState<boolean>(false);
  const [serverSettings, setServerSettings] = useState<ServerSettings | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    // Initial load — reads the registry from disk; works before any server connection.
    getDownloads()
      .then(setDownloads)
      .catch(e => console.error('[downloads] initial load failed:', e));

    // Re-load whenever a download completes. The download-complete event fires
    // after ZIP extraction and registry write, so getDownloads() returns the
    // updated record immediately.
    let unlisten: (() => void) | undefined;
    listen('download-complete', () => {
      getDownloads()
        .then(setDownloads)
        .catch(e => console.error('[downloads] refresh after complete failed:', e));
    }).then(fn => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, []); // runs once on mount; callers use setDownloads for immediate optimistic updates

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
          const result = await login(serverUrl, username, password);
          const loggedInUser = result.user;
          // Capture server settings returned with the login response
          if (result.serverSettings) setServerSettings(result.serverSettings);
          token = loggedInUser.token;
          setAuthToken(loggedInUser.token);
          setUserId(loggedInUser.id);
          setUser(loggedInUser);
        } else {
          await saveToken(token);
        }
        const libs = await fetchLibraries(serverUrl);
        if (cancelled) return;
        setLibraries(libs);
        // Pick the active library (last selection → first book → first of any).
        const activeLib = pickActiveLibrary(libs);
        if (!activeLib) { setLibraryLoadingRaw(false); return; }
        // Record the library ID so live sync event handlers can filter by it.
        setCurrentLibraryId(activeLib.id);
        const items = await fetchLibraryItems(serverUrl, activeLib.id);
        if (cancelled) return;
        setLibraryRaw(patchLibraryItems(items));
        // Server responded successfully — we are online; clear any offline indicator.
        setIsOffline(false);
        // Persist the library to disk after every successful fetch so it is
        // available offline on next launch.
        saveLibraryCache(items).catch(e => console.error('[library] cache save failed:', e));
        // Flush any offline progress that was queued while the server was unreachable.
        // Fire-and-forget; no toast here — the reconnect handler shows one if needed.
        flushOfflineProgress(serverUrl).catch(e => console.error('[offline] startup flush failed:', e));
      } catch (e) {
        console.warn('[library] fetch failed, attempting cache fallback:', e);
        try {
          const cached = await loadLibraryCache();
          // If there is no cache and no auth token, this is a fresh install —
          // do not show any error, just wait for the user to log in.
          if (cached.length === 0) return;
          setLibraryRaw(cached as LibraryItem[]);
          // Server unreachable — library came from disk; activate the offline indicator.
          setIsOffline(true);
          // Only show the offline warning if the user has already logged in and
          // is actively using the app — not during the initial login flow where
          // the library has not been fetched yet and a cache miss is expected.
          if (authToken && screen !== 'login') {
            setToast({ message: 'Server unreachable — showing cached library', type: 'info' });
          }
        } catch (ce) {
          console.error('[library] cache load also failed:', ce);
        }
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
    const t = setTimeout(async () => {
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
        // Refresh server settings on launch. On an already-logged-in start the
        // login-time serverSettings payload is gone, so re-fetch via /api/authorize
        // to keep the Server Settings panel populated and current.
        try {
          const ss = await fetchServerSettings(serverUrl);
          if (!cancelled) setServerSettings(ss);
        } catch (e) {
          console.error('Server settings refresh failed', e);
        }
      } catch (e) {
        console.error('Post-library fetch failed', e);
      }
    }, 2000);
    return () => { cancelled = true; clearTimeout(t); };
  }, [library, serverUrl, authToken]);

  // ── Playback ─────────────────────────────────────────────────────────────────
  const [screen, setScreen] = useState('library');
  const [currentBookId, setCurrentBookId] = useState('');
  // Podcast detail navigation + currently-playing episode (cluster E).
  const [podcastDetailId, setPodcastDetailId] = useState<string | null>(null);
  const [currentEpisodeId, setCurrentEpisodeId] = useState<string | null>(null);
  const [currentEpisode, setCurrentEpisode] = useState<PodcastEpisode | null>(null);
  // focusedBookId intentionally starts null — seeded from library on load by the
  // effect below. No localStorage read: we want a clean state each session so
  // the GreetingPane is the true default until the user starts playback.
  const [focusedBookId, setFocusedBookId] = useState<string | null>(null);
  const [currentBookChapters, setCurrentBookChapters] = useState<Chapter[]>([]);

  useEffect(() => {
    if (!serverUrl || !authToken || !currentBookId) { setCurrentBookChapters([]); return; }
    let cancelled = false;
    fetchItem(serverUrl, currentBookId)
      .then(item => {
        if (cancelled) return;
        // fetchItem returns the full item including detailed chapter data.
        const chapters = bookChapters(item);
        if (chapters.length > 0) {
          // Server returned chapter data — use it (most accurate source).
          setCurrentBookChapters(chapters);
          // Persist chapters to disk after every successful online fetch so they
          // are available for offline playback. The bulk library endpoint returns
          // chapters: [] — only the single-item fetchItem endpoint has real data.
          saveChapterCache(currentBookId, item.media.chapters)
            .catch(e => console.error('[chapters] cache save failed:', e));
        } else {
          // Server returned the item but with no chapters — unusual but possible
          // on some ABS versions. The per-item cache may still have real data
          // from a prior fetch, so attempt to load it before giving up.
          loadChapterCache(currentBookId)
            .then(cached => {
              if (!cancelled && cached && Array.isArray(cached) && cached.length > 0) {
                // Map raw ABS chapter objects to the onyx Chapter shape.
                setCurrentBookChapters(bookChapters({ media: { chapters: cached } } as LibraryItem));
              }
            })
            .catch(e => console.error('[chapters] cache load (empty-response path) failed:', e));
        }
      })
      .catch(async e => {
        console.error('[chapters] fetchItem failed:', e);
        if (cancelled) return;
        // The bulk library endpoint sends chapters: [] — the per-item cache written
        // by the online path above is the only source with real chapter data.
        try {
          const cached = await loadChapterCache(currentBookId);
          if (cached && Array.isArray(cached) && cached.length > 0) {
            // Map raw ABS chapter objects to the onyx Chapter shape.
            setCurrentBookChapters(bookChapters({ media: { chapters: cached } } as LibraryItem));
          }
        } catch (ce) {
          console.error('[chapters] cache load failed:', ce);
        }
      });
    return () => { cancelled = true; };
  }, [currentBookId, serverUrl, authToken]);

  const [sessionReady, setSessionReady] = useState(false);

  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  // Duration last reported by LibVLC via playback-tick. Used only as the total
  // for media that lacks an authoritative media.duration (podcast episodes).
  const [tickDuration, setTickDuration] = useState(0);
  const [volume, setVolume] = useState(0.68);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState('1.0');
  const [device, setDevice] = useState('sennheiser');
  const [deviceOpen, setDeviceOpen] = useState(false);

  const [focusCollapsed, setFocusCollapsed] = useState(false);
  const [filter, setFilter] = useState('all');
  const [contextFilter, setContextFilter] = useState<ContextFilter | null>(null);
  const [advFilter, setAdvFilter] = useState<AdvFilter>(EMPTY_ADV_FILTER);
  const [search, setSearch] = useState('');
  const [searchScope, setSearchScopeRaw] = useState<SearchScope>(
    () => (localStorage.getItem('onyx.searchScope') as SearchScope) || 'all',
  );
  const setSearchScope = useCallback((s: SearchScope) => {
    localStorage.setItem('onyx.searchScope', s); setSearchScopeRaw(s);
  }, []);

  const [accentColor, setAccentColorRaw] = useState(
    () => localStorage.getItem('onyx.accent') ?? DEFAULT_ACCENT,
  );
  const [theme, setThemeRaw] = useState(() => localStorage.getItem('onyx.theme') ?? 'dark');
  const [translucent, setTranslucentRaw] = useState(() => {
    const v = localStorage.getItem('onyx.translucent');
    return v === null ? true : v === 'true';
  });

  const [librarySort, setLibrarySortRaw] = useState(
    // Default to title ascending (A→Z) on first launch.
    // Returning users keep their saved preference via the localStorage value.
    () => localStorage.getItem('onyx.lib.sort') ?? 'title',
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
  const [optionalTabs, setOptionalTabsRaw] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('onyx.lib.optionalTabs') || '{}'); } catch { return {}; }
  });
  const setOptionalTab = useCallback((id: string, on: boolean) => {
    setOptionalTabsRaw(prev => {
      const next = { ...prev, [id]: on };
      localStorage.setItem('onyx.lib.optionalTabs', JSON.stringify(next));
      return next;
    });
  }, []);

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

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; confirmLabel: string; onConfirm: () => void } | null>(null);

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
  }, [theme, accentColor]);

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

  // When library first loads, seed focusedBookId so the shelf highlights a book
  // on startup. currentBookId is intentionally NOT seeded here — it remains ''
  // until the user explicitly starts playback via playBook(), which causes the
  // GreetingPane to give way to FocusPanel.
  useEffect(() => {
    if (library.length > 0 && !currentBookId) {
      setFocusedBookId(prev => prev ?? library[0].id);
    } else if (library.length > 0 && !focusedBookId) {
      setFocusedBookId(currentBookId || library[0].id);
    }
  }, [library, currentBookId]); // focusedBookId intentionally excluded

  // On first authenticated load, close any ghost sessions left from the
  // previous run so the server's session list stays consistent. Runs once
  // when the server URL and library become available (same guards as preload).
  useEffect(() => {
    if (!serverUrl || library.length === 0) return;
    closeAllOpenSessions(serverUrl)
      .then(n => { if (n > 0) console.log(`[startup] closed ${n} ghost session(s)`); })
      .catch(console.error); // non-fatal — stale sessions are a cosmetic issue
  }, [serverUrl, library.length]); // eslint-disable-line react-hooks/exhaustive-deps


  const currentBook  = library.find(b => b.id === currentBookId)  ?? library[0];
  const focusedBook  = library.find(b => b.id === (focusedBookId ?? currentBookId)) ?? currentBook;
  // Total duration for the transport. Books carry an authoritative media.duration;
  // podcast items do not (duration is per-episode), so fall back to the duration
  // LibVLC reports via playback-tick once an episode is loaded. Books never hit
  // the fallback because their media.duration is always > 0.
  const bookSecs = (currentBook?.media.duration && currentBook.media.duration > 0)
    ? currentBook.media.duration
    : tickDuration;
  // The active library object, derived from the list + the active id.
  const activeLibrary = libraries.find(l => l.id === currentLibraryId);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ currentTime: number; duration: number; isPlaying: boolean }>(
      'playback-tick',
      ({ payload }) => {
        setPosition(payload.currentTime);
        setPlaying(payload.isPlaying);
        if (payload.duration > 0) setTickDuration(payload.duration);
      },
    ).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  // ── Live progress sync ──────────────────────────────────────────────────────
  // Refs that let the event handlers read the current playback and library
  // state without stale-closure issues. The sync effect runs after every
  // render (no dep array) so handlers always see the latest values.
  const currentBookIdRef    = useRef(currentBookId);
  const playingRef          = useRef(playing);
  const currentLibraryIdRef = useRef(currentLibraryId);
  useEffect(() => {
    currentBookIdRef.current    = currentBookId;
    playingRef.current          = playing;
    currentLibraryIdRef.current = currentLibraryId;
  });

  // Subscribe to progress-updated events forwarded from the Rust socket layer.
  // Re-arms when serverUrl/authToken change so reconnects after logout/login
  // pick up the correct context. Gated on onyx.sync.live so the listener is
  // dormant when live sync is disabled.
  useEffect(() => {
    // Only subscribe when the socket is expected to be connected.
    const syncLive = localStorage.getItem('onyx.sync.live') === 'true';
    if (!syncLive || !serverUrl || !authToken) return;

    let unlisten: (() => void) | undefined;

    listen<string>('progress-updated', event => {
      try {
        // ABS may send the progress record directly or wrapped in { data: {...} }.
        const raw = JSON.parse(event.payload) as Record<string, unknown>;
        const update = ((raw.data ?? raw) as Partial<MediaProgress> & {
          libraryItemId: string;
          currentTime: number;
        });

        // ── Self-echo guard ───────────────────────────────────────────────────
        // Skald syncs its own playback position to the server every 30 seconds.
        // Those writes echo back here as progress-updated events. If we applied
        // the echo to the live transport position, it would yank the playhead
        // backwards on every sync cycle. The guard detects this case by checking
        // whether the update is for the book we are actively playing right now.
        const isActivelyPlayingThisBook =
          update.libraryItemId === currentBookIdRef.current && playingRef.current;

        // ── Stored progress reconciliation (always runs) ──────────────────────
        // Pick it up, library cover overlays, and the progress bar for
        // non-playing books all read from mediaProgress. Keep it accurate
        // even for the actively-playing book so the UI is correct on pause.
        setMediaProgress((prev: MediaProgress[]) => {
          const idx = prev.findIndex(p => p.libraryItemId === update.libraryItemId);
          if (idx >= 0) {
            // Update existing record without mutating the original array.
            const copy = [...prev];
            copy[idx] = { ...copy[idx], ...update };
            return copy;
          }
          // New record — append so newly-started books show in Pick it up.
          return [...prev, update as MediaProgress];
        });

        // ── Live transport position (only when safe to update) ────────────────
        // If this update is for the focused book but we are NOT actively playing
        // it, advance the position so the player UI reflects the remote device's
        // current position. If we ARE playing, leave the transport alone.
        if (!isActivelyPlayingThisBook && update.libraryItemId === currentBookIdRef.current) {
          setPosition(update.currentTime);
        }
      } catch (e) {
        console.error('[live progress] parse failed', e);
      }
    }).then(fn => { unlisten = fn; });

    // Tear down the listener on unmount or when auth context changes so stale
    // subscriptions do not accumulate across login/logout cycles.
    return () => { unlisten?.(); };
  // serverUrl and authToken are the meaningful lifecycle triggers — the
  // localStorage flag is read once at setup time per the Phase A pattern.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverUrl, authToken]);

  // ── Live library sync ──────────────────────────────────────────────────────
  // Subscribe to library item events forwarded from the Rust socket layer.
  // Active only when live sync is enabled. Uses the same setup/teardown
  // lifecycle as the progress listener above.
  useEffect(() => {
    const syncLive = localStorage.getItem('onyx.sync.live') === 'true';
    if (!syncLive || !serverUrl || !authToken) return;

    // Three separate unlisten handles — each listener is torn down individually.
    let unlistenAdded:   (() => void) | undefined;
    let unlistenUpdated: (() => void) | undefined;
    let unlistenRemoved: (() => void) | undefined;

    // item_added — a new book arrived; append it to the shelf after normalising
    // author/narrator fields with patchLibraryItems so it matches the rest.
    listen<string>('library-item-added', event => {
      try {
        const raw  = JSON.parse(event.payload) as LibraryItem;
        // Only process items that belong to the currently loaded library.
        if (raw.libraryId !== currentLibraryIdRef.current) return;
        const item = patchLibraryItems([raw])[0];
        setLibraryRaw(prev => [...prev, item]);
      } catch (e) { console.error('library-item-added parse failed', e); }
    }).then(fn => { unlistenAdded = fn; });

    // item_updated — metadata, cover, or chapters changed; merge the new
    // data over the existing record so the shelf reflects it immediately.
    listen<string>('library-item-updated', event => {
      try {
        const raw  = JSON.parse(event.payload) as LibraryItem;
        if (raw.libraryId !== currentLibraryIdRef.current) return;
        const item = patchLibraryItems([raw])[0];
        setLibraryRaw(prev => prev.map(b => b.id === item.id ? { ...b, ...item } : b));
      } catch (e) { console.error('library-item-updated parse failed', e); }
    }).then(fn => { unlistenUpdated = fn; });

    // item_removed — book deleted from the server; remove it from the shelf and
    // clear any focused/current references so the player doesn't try to play a ghost.
    // If the book has a local download, flag it as server-deleted rather than
    // deleting the file — the user retains offline playback, badge changes to amber !.
    listen<string>('library-item-removed', event => {
      try {
        const payload = JSON.parse(event.payload) as { id: string; libraryId: string };
        if (payload.libraryId !== currentLibraryIdRef.current) return;
        setLibraryRaw(prev => prev.filter(b => b.id !== payload.id));
        // Clear currentBookId if the removed item was the one queued to play.
        setCurrentBookId(prev => prev === payload.id ? '' : prev);
        // Clear focusedBookId if the removed item was focused in the shelf.
        setFocusedBookId(prev => prev === payload.id ? null : prev);
        // If the book has a local download, mark it server-deleted rather than removing.
        // Using a functional update reads the latest state without a stale-closure risk.
        setDownloads(prev => {
          if (!prev.some(d => d.itemId === payload.id)) return prev; // not downloaded — no change
          // Persist the flag to disk so it survives a reload.
          markServerDeleted(payload.id).catch(e =>
            console.error('[downloads] mark server-deleted failed:', e)
          );
          // Update local state immediately so the badge updates without a disk round-trip.
          return prev.map(d =>
            d.itemId === payload.id ? { ...d, serverDeleted: true } : d
          );
        });
      } catch (e) { console.error('library-item-removed parse failed', e); }
    }).then(fn => { unlistenRemoved = fn; });

    // Tear down all three listeners together on unmount or auth context change.
    return () => {
      unlistenAdded?.();
      unlistenUpdated?.();
      unlistenRemoved?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverUrl, authToken]);

  // ── Reconnect resync ───────────────────────────────────────────────────────
  // When the socket reconnects after a drop, events that fired during the
  // disconnection window are lost — the ABS server does not replay them.
  // Perform a full refresh of library and media progress so the UI reflects
  // the current server state rather than a potentially stale snapshot.
  useEffect(() => {
    const syncLive = localStorage.getItem('onyx.sync.live') === 'true';
    if (!syncLive || !serverUrl || !authToken) return;

    let unlisten: (() => void) | undefined;

    listen('socket-reconnected', async () => {
      try {
        console.log('[sync] socket reconnected — performing full resync');
        // Refresh the library — re-fetches all items so additions, edits, and
        // deletions that occurred during the outage are reflected immediately.
        await refreshLibrary();
        // Re-fetch /api/me to get the latest mediaProgress array so Pick it up
        // and cover progress overlays are correct without waiting for events.
        const me = await getMe(serverUrl);
        setMediaProgress(me.mediaProgress);
      } catch (e) {
        console.error('[sync] resync after reconnect failed:', e);
      }
    }).then(fn => { unlisten = fn; });

    return () => { unlisten?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverUrl, authToken]);

  // ── Background-task stream ──────────────────────────────────────────────────
  // Maintain the task list from ABS task_started / task_finished socket events.
  // Lives here (always mounted) rather than in the Scheduled Tasks panel so the
  // list stays current even when that pane is closed. Requires live sync to be
  // connected; the panel still seeds via GET /api/tasks on mount as a fallback.
  useEffect(() => {
    if (!serverUrl || !authToken) return;
    let unStart: (() => void) | undefined;
    let unFinish: (() => void) | undefined;

    // Upsert a task by id and cap growth: keep all running tasks plus the 25
    // most-recently-finished so the list cannot grow without bound.
    const upsert = (t: Task) => setTasks(prev => {
      const others = prev.filter(x => x.id !== t.id);
      const merged = [t, ...others];
      const running = merged.filter(x => !x.isFinished);
      const finished = merged
        .filter(x => x.isFinished)
        .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
        .slice(0, 25);
      return [...running, ...finished];
    });

    const handle = (raw: string) => {
      try { upsert(JSON.parse(raw) as Task); } catch { /* ignore malformed task payload */ }
    };

    listen<string>('task-started',  e => handle(e.payload)).then(fn => { unStart = fn; });
    listen<string>('task-finished', e => handle(e.payload)).then(fn => { unFinish = fn; });

    return () => { unStart?.(); unFinish?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverUrl, authToken]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      // Call the LibVLC pause/resume command directly.
      // setPlaying alone only updates the React icon — LibVLC keeps running.
      if (e.code === 'Space') {
        e.preventDefault();
        if (playingRef.current) { pauseAudio().catch(console.error); setPlaying(false); }
        else { playAudio().catch(console.error); setPlaying(true); }
      }
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
    isAdmin: user?.type === 'admin' || user?.type === 'root',
    library, libraries, activeLibrary, setActiveLibrary, libraryLoading, isOffline, updateLibraryItem, removeLibraryItem, refreshLibrary, mediaProgress, setMediaProgress, listeningStats, bookmarks, setBookmarks, currentLibraryId,
    downloads, setDownloads,
    isLocalPlayback, setIsLocalPlayback,
    serverSettings, setServerSettings,
    tasks, setTasks,
    screen, setScreen,
    podcastDetailId, setPodcastDetailId,
    currentEpisodeId, setCurrentEpisodeId,
    currentEpisode, setCurrentEpisode,
    currentBook, currentBookId, setCurrentBookId, currentBookChapters,
    focusedBook, focusedBookId, setFocusedBookId,
    playing, setPlaying,
    position, setPosition, bookSecs,
    volume, setVolume, muted, setMuted,
    speed, setSpeed,
    device, setDevice, deviceOpen, setDeviceOpen,
    focusCollapsed, setFocusCollapsed,
    filter, setFilter,
    contextFilter, setContextFilter,
    advFilter, setAdvFilter,
    search, setSearch,
    searchScope, setSearchScope,
    accentColor, setAccentColor,
    theme, setTheme,
    translucent, setTranslucent,
    librarySort, setLibrarySort,
    coverSize, setCoverSize,
    groupBySeries, setGroupBySeries,
    showFinished, setShowFinished,
    showProgressOverlay, setShowProgressOverlay,
    optionalTabs, setOptionalTab,
    libraryView, setLibraryView,
    shelfTab, setShelfTab,
    pickItUpCollapsed, setPickItUpCollapsed,
    scale, setScale,
    enableOpenLibrary, setEnableOpenLibrary,
    toast, setToast,
    confirmDialog, setConfirmDialog,
  };
}
