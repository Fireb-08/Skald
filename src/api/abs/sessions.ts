// Split from the original single-file abs.ts (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. Import from '../abs' (the barrel),
// not from this file directly.
import { invoke } from '@tauri-apps/api/core';
import type { ListeningStats } from './types';

// ── Greeting pane stats types (GreetingPane.tsx) ───────────────────────────

// Mirrors models::UserStatsSession — one entry in the recent-sessions list.
export interface UserStatsSession {
  id: string;
  displayTitle: string | null;
  timeListening: number; // seconds
  date: string | null;   // "YYYY-MM-DD"
  libraryItemId: string;
}

// Mirrors models::UserStats — GET /api/me/listening-stats response.
export interface UserStats {
  totalTime: number;        // seconds
  numDaysListened: number;
  numBooksFinished: number;
  numBooksListened: number;
  recentSessions: UserStatsSession[];
  days: Record<string, number>; // { "YYYY-MM-DD": seconds }
}

// Mirrors models::GenreStat — one row in the genres array.
export interface GenreStat {
  genre: string;
  count: number;
}

// Mirrors models::LibraryStats — GET /api/libraries/{id}/stats response.
export interface LibraryStats {
  totalItems: number;
  totalAuthors: number;
  totalDuration: number;         // seconds
  numAudioTracks: number;
  totalAudioFilesSize: number;   // bytes
  genres: GenreStat[];
}

export function fetchListeningStats(serverUrl: string, userId: string): Promise<ListeningStats> {
  return invoke('fetch_listening_stats', { serverUrl, userId });
}

// ── Listening sessions types (Settings → Playback → Sessions) ─────────────

// Mirrors models::DeviceInfo.
export interface DeviceInfo {
  clientName: string | null;
  deviceDescription: string | null;
}

// Nested user object present in GET /api/sessions (all-users endpoint) responses.
// Per-user endpoints omit this; use the flat username field for those cases.
export interface SessionUser {
  username: string | null;
}

// Mirrors models::ListeningSession — one row in the sessions table.
// bookId is deserialized from ABS's "libraryItemId" field via Rust serde rename.
// author is deserialized from ABS's "displayAuthor" field via Rust serde rename.
export interface ListeningSession {
  id: string;
  bookId: string | null;
  displayTitle: string | null;
  author: string | null;
  userId: string;
  username: string | null;       // flat username — present in per-user endpoint responses
  playMethod: number | null;     // 0=DirectPlay 1=DirectStream 2=Transcode 3=Local
  deviceInfo: DeviceInfo | null;
  timeListening: number | null;  // seconds
  currentTime: number | null;    // seconds — playback position
  updatedAt: number | null;      // Unix ms — used to detect open sessions
  user?: SessionUser | null;     // nested user object — present in GET /api/sessions responses
}

// Mirrors models::ListeningSessionsResponse.
export interface ListeningSessionsResponse {
  sessions: ListeningSession[];
  total: number;
  numPages: number;
  itemsPerPage: number;
}

// ── GreetingPane stats wrappers ────────────────────────────────────────────

/** GET /api/me/listening-stats — returns the authenticated user's listening stats.
 *  Provides totalTime, numDaysListened, numBooksFinished, recentSessions, and a
 *  per-day map for the 7-day sparkline. */
export function getUserStats(serverUrl: string): Promise<UserStats> {
  return invoke('get_user_stats', { serverUrl });
}

/** GET /api/libraries/{id}/stats — returns aggregate statistics for a library.
 *  Provides item count, author count, total duration, track count, size, and genres. */
export function getLibraryStats(serverUrl: string, libraryId: string): Promise<LibraryStats> {
  return invoke('get_library_stats', { serverUrl, libraryId });
}

// ── Listening sessions wrappers ────────────────────────────────────────────

/** Paginated listening sessions with optional server-side sorting.
 *  userId=null|undefined → GET /api/sessions          (all users, admin only)
 *  userId='__me__'       → GET /api/me/listening-sessions (own sessions)
 *  userId='<id>'         → GET /api/users/{id}/listening-sessions (specific user, admin)
 *  sort/desc are forwarded to ABS so it orders the full dataset server-side. */
export function getListeningSessions(
  serverUrl: string,
  userId?: string | null,  // null/undefined → all users; '__me__' → own; id → specific user
  page?: number,
  itemsPerPage?: number,
  sort?: string,           // ABS sort field name, e.g. 'updatedAt', 'timeListening'
  desc?: boolean,          // true = descending; undefined = omit the param
): Promise<ListeningSessionsResponse> {
  return invoke('get_listening_sessions', {
    serverUrl,
    userId: userId ?? null,       // null maps to Rust None → GET /api/sessions
    page: page ?? 0,
    itemsPerPage: itemsPerPage ?? 10,
    sort: sort ?? null,           // null maps to Rust None → param omitted from query
    desc: desc ?? null,           // null maps to Rust None → param omitted from query
  });
}

/** DELETE /api/sessions/{id} — admin-only, permanently removes a session record. */
export function deleteSession(serverUrl: string, sessionId: string): Promise<void> {
  return invoke('delete_session', { serverUrl, sessionId });
}

/** GET /api/users/online → openSessions — returns all currently active playback sessions.
 *  Replaces the old 5-minute updatedAt proxy; this is the authoritative open-sessions list.
 *  Sessions include all users' active playback, not just the authenticated caller's. */
export function getOpenSessions(serverUrl: string): Promise<ListeningSession[]> {
  return invoke('get_open_sessions', { serverUrl }); // backed by GET /api/users/online
}
