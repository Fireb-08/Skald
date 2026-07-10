// Pure helpers over LibraryItem / progress / chapters — split from onyx.ts
// (Large-File Split roadmap, 2026-07-09; pure move, no logic changes).
// Everything here is side-effect-free and directly unit-testable; onyx.ts
// re-exports the lot, so consumers keep importing from '../state/onyx'.
import type { LibraryItem, LibraryStats, MediaProgress, UserStats } from '../api/abs';

export interface Chapter {
  n: number;
  t: string;
  dur: number;
}

export interface ChapterPosition {
  idx: number;
  local: number;
  chapter: Chapter;
}

// ─── Author/narrator normalisation ────────────────────────────────────────────
// ABS endpoints sometimes return authorName as null with an `authors` array.
// This guard ensures the display fields are always populated when the array data is present.

export function patchLibraryItems(items: LibraryItem[]): LibraryItem[] {
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

// Merge progress records by item (+episode), newest write wins. Used to fold
// local-library progress into the same mediaProgress the ABS path populates.
export function mergeProgress(prev: MediaProgress[], next: MediaProgress[]): MediaProgress[] {
  const key = (p: MediaProgress) => p.libraryItemId + '|' + (p.episodeId ?? '');
  const byId = new Map(prev.map(p => [key(p), p]));
  for (const n of next) byId.set(key(n), n);
  return Array.from(byId.values());
}

// Merge two UserStats payloads (server + local listening stats) into one view
// for GreetingPane's combine mode (Local Listening Stats roadmap). Both sides
// use SECONDS throughout, so values sum directly: day totals add per key,
// numDaysListened counts the day-key UNION (both sources listening on one day
// is still one day), book counts sum (disjoint item sets — server counts ABS
// items, local counts catalog items), and recent sessions interleave
// newest-first capped at 10 (the pane shows 3).
export function mergeUserStats(a: UserStats, b: UserStats): UserStats {
  const days: Record<string, number> = { ...a.days };
  for (const [day, secs] of Object.entries(b.days ?? {})) {
    days[day] = (days[day] ?? 0) + secs;
  }
  const recentSessions = [...(a.recentSessions ?? []), ...(b.recentSessions ?? [])]
    .sort((x, y) => (y.date ?? '').localeCompare(x.date ?? ''))
    .slice(0, 10);
  return {
    totalTime: (a.totalTime ?? 0) + (b.totalTime ?? 0),
    numDaysListened: Object.keys(days).length,
    numBooksFinished: (a.numBooksFinished ?? 0) + (b.numBooksFinished ?? 0),
    numBooksListened: (a.numBooksListened ?? 0) + (b.numBooksListened ?? 0),
    recentSessions,
    days,
  };
}

// Compute a LibraryStats payload for a LOCAL library from its loaded items —
// local libraries have no /stats endpoint, but everything the pane shows
// (durations, sizes, genres, authors) is already on the items (Local Listening
// Stats roadmap). Durations are seconds, matching the ABS payload.
export function computeLocalLibraryStats(items: LibraryItem[]): LibraryStats {
  const authors = new Set<string>();
  const genreCounts: Record<string, number> = {};
  let totalDuration = 0;
  let numAudioTracks = 0;
  let totalSize = 0;
  for (const it of items) {
    const a = bookAuthor(it);
    if (a && a !== 'Unknown Author') authors.add(a);
    for (const g of bookGenres(it)) genreCounts[g] = (genreCounts[g] ?? 0) + 1;
    // media is pass-through JSON — books carry audioFiles/duration/size,
    // podcasts carry episodes; read both shapes loosely.
    const m = it.media as unknown as Record<string, unknown>;
    totalDuration += typeof m.duration === 'number' ? m.duration : 0;
    totalSize += typeof m.size === 'number' ? m.size : 0;
    const audioFiles = m.audioFiles as unknown[] | undefined;
    const episodes = m.episodes as unknown[] | undefined;
    numAudioTracks += audioFiles?.length ?? episodes?.length ?? (m.numEpisodes as number | undefined) ?? 1;
  }
  return {
    totalItems: items.length,
    totalAuthors: authors.size,
    totalDuration,
    numAudioTracks,
    totalAudioFilesSize: totalSize,
    genres: Object.entries(genreCounts)
      .sort((x, y) => y[1] - x[1])
      .map(([genre, count]) => ({ genre, count })),
  };
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

// ─── Time / chapter helpers ───────────────────────────────────────────────────

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
