// Split from the original single-file abs.ts (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. Import from '../abs' (the barrel),
// not from this file directly.
import type { UserPermissions } from './users';

// ── Interfaces (mirror src-tauri/src/models.rs, all camelCase via serde) ──

export interface User {
  id: string;
  username: string;
  token: string;
  email: string | null;
  isActive: boolean;
  type?: string;
}

export interface LibraryFolder {
  id: string | null;
  fullPath: string;
  libraryId: string | null;
  addedAt: number | null;
}

export interface LibrarySettings {
  coverAspectRatio: number | null;
  disableWatcher: boolean | null;
  autoScanCronExpression: string | null;
  audiobooksOnly: boolean | null;
  hideSingleBookSeries: boolean | null;
  onlyShowLaterBooksInContinueSeries: boolean | null;
  skipMatchingMediaWithAsin: boolean | null;
  skipMatchingMediaWithIsbn: boolean | null;
  metadataPrecedence: string[] | null;
  markAsFinishedPercentComplete: number | null;
  markAsFinishedTimeRemaining: number | null;
  podcastSearchRegion: string | null;
  epubsAllowScriptedContent: boolean | null;
}

export interface Library {
  id: string;
  name: string;
  mediaType: string;
  icon: string | null;
  provider: string | null;
  displayOrder: number | null;
  folders: LibraryFolder[];
  settings: LibrarySettings | null;
  lastScan: number | null;
  createdAt: number | null;
  lastUpdate: number | null;
  /** Local Library: "local" for catalog-backed libraries; undefined/"abs" for ABS. */
  source?: string;
  /** Local Library: staging/inbox folder watched for imports (Phase 3). */
  stagingPath?: string | null;
  /** Local Library: "copy" (default) or "move" — how ingest places files. */
  organizeMode?: string;
}

/** Minimal folder entry used in create/update request bodies — only fullPath is sent. */
export interface FolderInput {
  fullPath: string;
}

/** Request body for updateLibrary — all fields are optional (sparse patch). */
export interface UpdateLibraryPayload {
  name?: string;
  icon?: string;
  provider?: string;
  folders?: FolderInput[];
  settings?: LibrarySettings;
}

// Valid metadata providers for book libraries (confirmed against ABS SearchController.js).
export const LIBRARY_PROVIDERS_BOOK = [
  'google', 'audible', 'audible.uk', 'audible.ca', 'audible.au',
  'audible.fr', 'audible.de', 'audible.jp', 'audible.it', 'audible.in',
  'audible.es', 'openlibrary', 'itunes', 'fantlab', 'audiobookcovers',
] as const;
export type LibraryProviderBook = typeof LIBRARY_PROVIDERS_BOOK[number];

// Valid metadata providers for podcast libraries.
export const LIBRARY_PROVIDERS_PODCAST = ['itunes'] as const;
export type LibraryProviderPodcast = typeof LIBRARY_PROVIDERS_PODCAST[number];

// Valid icon slugs for libraries (ABS built-in icon set).
export const LIBRARY_ICONS = [
  'database', 'book', 'audiobook', 'podcast', 'music', 'comic', 'manga',
  'paper', 'magazine', 'pirate', 'crystal-ball', 'alien', 'astronaut',
  'cat', 'dog', 'heart', 'star', 'moon',
] as const;
export type LibraryIcon = typeof LIBRARY_ICONS[number];

export interface AuthorObject {
  id: string;
  name: string;
}

// Mirrors the AuthorField untagged enum: string | object | array of objects.
export type AuthorField = string | AuthorObject | AuthorObject[];

// ABS series object — present on full responses; may be a single object or an array.
export interface SeriesObject {
  id: string;
  name: string;
  // Volume/sequence — may be a number, a decimal string ("1.5"), or absent.
  sequence?: string | number | null;
}

export interface BookMetadata {
  title: string | null;
  subtitle: string | null;
  authorName: AuthorField | null;
  narratorName: string | null;
  seriesName: string | null;
  // Full series object(s) — present on expanded API responses (single item fetch, personalized shelf, etc.)
  // Use this in preference to seriesName for correct name extraction.
  series?: SeriesObject | SeriesObject[] | null;
  genres: string[];
  description?: string | null;
  publisher?: string | null;
  publishedYear?: string | null;
  language?: string | null;
  isbn?: string | null;
  isbn10?: string | null;
  isbn13?: string | null;
}

export interface Chapter {
  id: number;
  start: number;
  end: number;
  title: string;
}

/** A playback-session track. This is deliberately separate from the detailed
 * audio-file record returned inside an expanded library item. */
export interface AudioTrack {
  index: number;
  startOffset: number;
  duration: number;
  title: string;
  contentUrl: string;
}

export interface LibraryAudioFile {
  index: number;
  ino: string;
  metadata: FileMetadata;
  addedAt?: number | null;
  updatedAt?: number | null;
  trackNumFromMeta?: number | null;
  discNumFromMeta?: number | null;
  trackNumFromFilename?: number | null;
  discNumFromFilename?: number | null;
  manuallyVerified: boolean;
  exclude: boolean;
  error?: string | null;
  format?: string | null;
  duration?: number | null;
  bitRate?: number | null;
  language?: string | null;
  codec?: string | null;
  timeBase?: string | null;
  channels?: number | null;
  channelLayout?: string | null;
  chapters?: Chapter[];
  embeddedCoverArt?: string | boolean | null;
  metaTags?: Record<string, unknown>;
  mimeType?: string | null;
}

export interface TrackUpdateInput {
  ino: string;
  exclude: boolean;
}

export interface BookMedia {
  /** The Book record id (distinct from the LibraryItem id). Required as the
   *  `mediaItemId` when creating a share. Present in both minified and full item
   *  shapes, but optional here since some legacy paths may omit it. */
  id?: string;
  metadata: BookMetadata;
  chapters: Chapter[];
  audioFiles: LibraryAudioFile[];
  /** Expanded item responses also include the resolved playback track list. */
  tracks?: AudioTrack[];
  tags: string[];
  duration: number;
}

export interface FileMetadata {
  filename: string;
  size: number;
  path?: string | null;
  relPath?: string | null;
  ext?: string | null;
  format?: string | null;
  mtimeMs?: number | null;
  ctimeMs?: number | null;
  birthtimeMs?: number | null;
}

export interface LibraryFile {
  ino: string;
  metadata: FileMetadata;
  fileType: string;
  isSupplementary?: boolean | null;
  addedAt?: number | null;
  updatedAt?: number | null;
}

export interface LibraryItem {
  id: string;
  ino: string;
  libraryId: string;
  /** ABS item creation time (Unix ms); local items use catalog insertion time. */
  addedAt?: number | null;
  /** "book" | "podcast". Backend defaults to "book" when the server omits it. */
  mediaType: string;
  media: BookMedia;
  libraryFiles?: LibraryFile[];
  /** Expanded ABS item flags used by the file inspector. */
  isFile?: boolean;
  isMissing?: boolean;
  relPath?: string | null;
  /** Local Library only: absolute on-disk path of the book unit (playback/ingest source). */
  localPath?: string;
  /** Local Library only: true when an embedded cover was detected during the scan. */
  hasLocalCover?: boolean;
}

export interface MediaProgress {
  id: string;
  libraryItemId: string;
  episodeId: string | null;
  duration: number;
  progress: number;
  currentTime: number;
  isFinished: boolean;
  lastUpdate: number;
}

export interface MeResponse {
  id: string;
  username: string;
  token: string;
  mediaProgress: MediaProgress[];
  bookmarks: Bookmark[];
  type?: string;
  /** Full permissions object — gates the Upload affordance (permissions.upload). */
  permissions?: UserPermissions | null;
}

export interface ListeningStatItem {
  id: string;
  timeListening: number;
}

export interface ListeningStats {
  totalTime: number;
  today: number;
  items: Record<string, ListeningStatItem>;
  days: Record<string, number>;
}

export interface Bookmark {
  libraryItemId: string;
  title: string;
  time: number;
  /** Local Library bookmarks carry a catalog id used for deletion; ABS omits it. */
  id?: string;
}

// Mirrors downloads::LocalStopPoint — a position snapshot recorded locally
// at pause, book-switch, and app-close, independent of the server.
export interface LocalStopPoint {
  itemId: string;
  position: number;    // playback position in seconds
  recordedAt: number;  // Unix timestamp ms — displayed as date/time in the UI
}

export interface AudioDevice {
  id: string;
  name: string;
}

export interface PlaySession {
  id: string;
  currentTime: number;
  audioTracks: AudioTrack[];
}

export interface OpenSessionResult {
  sessionId: string;
  currentTime: number;
}
