// Split from the original single-file abs.ts (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. Import from '../abs' (the barrel),
// not from this file directly.
import { invoke } from '@tauri-apps/api/core';
import type { FolderInput, Library, LibrarySettings, UpdateLibraryPayload } from './types';

// ── Server filesystem browser ──────────────────────────────────────────────────

/** A single directory entry from the server's filesystem. */
export interface FsEntry {
  /** Full path on the server, e.g. "/audiobooks" */
  path: string;
  dirname: string;
  level: number;
}

/** Response from GET /api/filesystem — subdirectories at a given server path. */
export interface FsDirectory {
  posix: boolean;
  directories: FsEntry[];
}

/** Lists subdirectories on the ABS server at `path`. Pass "/" for the root.
 *  Admin-only — ABS returns 403 for non-admin callers. */
export function browseServerFilesystem(serverUrl: string, path: string): Promise<FsDirectory> {
  return invoke('browse_server_filesystem', { serverUrl, path });
}

// ── Library management wrappers (admin/root only) ─────────────────────────────
// ABS enforces admin/root access server-side; calling these as a regular user
// returns HTTP 403. The frontend admin guard (Phase 7) prevents the UI from
// rendering these controls at all, but the server check is the authoritative gate.

/** GET /api/libraries — all libraries with the full expanded shape (folders, settings, timestamps). */
export function getLibrariesFull(serverUrl: string): Promise<Library[]> {
  return invoke('get_libraries_full', { serverUrl });
}

/** POST /api/libraries — creates a new library and returns the created Library. */
export function createLibrary(
  serverUrl: string,
  name: string,
  mediaType: string,
  folders: FolderInput[],
  icon?: string | null,
  provider?: string | null,
  settings?: LibrarySettings | null,
): Promise<Library> {
  return invoke('create_library', {
    serverUrl,
    name,
    mediaType,
    folders,
    icon: icon ?? null,
    provider: provider ?? null,
    settings: settings ?? null,
  });
}

/** PATCH /api/libraries/{id} — partially updates a library; only set fields are sent. */
export function updateLibrary(
  serverUrl: string,
  libraryId: string,
  payload: UpdateLibraryPayload,
): Promise<Library> {
  return invoke('update_library', { serverUrl, libraryId, payload });
}

/** DELETE /api/libraries/{id} — permanently removes the library and all its items.
 *  Returns the deleted Library so callers can confirm what was removed. */
export function deleteLibrary(serverUrl: string, libraryId: string): Promise<void> {
  return invoke('delete_library', { serverUrl, libraryId });
}

/** POST /api/libraries/{id}/scan — triggers a server-side scan.
 *  force=true requests a full rescan; force=false runs incremental. Fire-and-forget. */
export function scanLibrary(serverUrl: string, libraryId: string, force: boolean): Promise<void> {
  return invoke('scan_library', { serverUrl, libraryId, force });
}

// ── Custom metadata providers (admin) ───────────────────────────────────────────

/** A registered custom metadata provider. `slug` (custom-{id}) is the value used
 *  as a library's provider or in a match search. */
export interface CustomMetadataProvider {
  id: string;
  name: string;
  url: string;
  mediaType: string;
  authHeaderValue?: string | null;
  slug: string;
}

/** GET /api/custom-metadata-providers — list custom providers. Admin only. */
export function getCustomMetadataProviders(serverUrl: string): Promise<CustomMetadataProvider[]> {
  return invoke('get_custom_metadata_providers', { serverUrl });
}

/** POST /api/custom-metadata-providers — register one (name/url/mediaType + optional
 *  authHeaderValue). Returns the created provider. Admin only. */
export function createCustomMetadataProvider(
  serverUrl: string,
  payload: { name: string; url: string; mediaType: string; authHeaderValue?: string },
): Promise<CustomMetadataProvider> {
  return invoke('create_custom_metadata_provider', { serverUrl, payload });
}

/** DELETE /api/custom-metadata-providers/:id — remove one. Admin only. */
export function deleteCustomMetadataProvider(serverUrl: string, id: string): Promise<void> {
  return invoke('delete_custom_metadata_provider', { serverUrl, id });
}

// ── Server settings ───────────────────────────────────────────────────────────
// Mirrors models::ServerSettings in src-tauri/src/models.rs.
// All fields are optional — older ABS versions may omit some.

export interface ServerSettings {
  // Scanner
  scannerFindCovers?: boolean | null;
  scannerCoverProvider?: string | null;
  scannerParseSubtitle?: boolean | null;
  scannerPreferMatchedMetadata?: boolean | null;
  scannerDisableWatcher?: boolean | null;
  // Metadata storage
  storeCoverWithItem?: boolean | null;
  storeMetadataWithItem?: boolean | null;
  // Sorting
  sortingIgnorePrefix?: boolean | null;
  sortingPrefixes?: string[] | null;
  // Podcasts
  podcastEpisodeSchedule?: string | null;
  // Chromecast
  chromecastEnabled?: boolean | null;
  // Logging
  logLevel?: number | null;
  loggerDailyLogsToKeep?: number | null;
  loggerScannerLogsToKeep?: number | null;
  // Backups — backupSchedule is a cron string when enabled, or `false` when off.
  backupSchedule?: string | boolean | null;
  backupsToKeep?: number | null;
  maxBackupSize?: number | null;
}

// Valid cover providers for the scanner cover-finder feature.
export const COVER_PROVIDERS = ['google', 'audible', 'apple', 'openlibrary', 'audiobookcovers'] as const;
export type CoverProvider = typeof COVER_PROVIDERS[number];

// ABS log levels: 0 = Debug, 1 = Info, 2 = Warn.
export const LOG_LEVELS = [
  { value: 0, label: 'Debug' },
  { value: 1, label: 'Info' },
  { value: 2, label: 'Warn' },
] as const;

/** POST /api/authorize — refreshes serverSettings using the stored token.
 *  Used on an already-logged-in app launch, when the login-time payload is gone. */
export function fetchServerSettings(serverUrl: string): Promise<ServerSettings> {
  return invoke('fetch_server_settings', { serverUrl });
}

/** PATCH /api/settings — updates one or more server settings fields. Admin only.
 *  `payload` is a sparse object; ABS merges it with the current values server-side. */
export function updateServerSettings(serverUrl: string, payload: Partial<ServerSettings>): Promise<ServerSettings> {
  return invoke('update_server_settings', { serverUrl, payload });
}

/** PATCH /api/sorting-prefixes — replaces the sorting prefix list. Admin only.
 *  Triggers a full title re-index on the server; use sparingly. */
export function updateSortingPrefixes(serverUrl: string, prefixes: string[]): Promise<ServerSettings> {
  return invoke('update_sorting_prefixes', { serverUrl, prefixes });
}

// ── Notification settings (Apprise) ─────────────────────────────────────────────
// Mirrors the notification models in src-tauri/src/models.rs. All endpoints are
// admin-only. ABS fires notifications through an EXTERNAL Apprise API server
// (see appriseApiUrl) — without one configured, nothing is delivered.

/** One configured notification rule. Read-only status fields are populated by ABS. */
export interface Notification {
  id?: string | null;
  /** Required when the event's requiresLibrary is true. */
  libraryId?: string | null;
  eventName: string;
  /** Apprise target URLs (e.g. "discord://…"). */
  urls: string[];
  titleTemplate: string;
  bodyTemplate: string;
  enabled: boolean;
  /** Apprise message type: "info" | "warning" | "success" (serialized as `type`). */
  type: string;
  // Read-only status
  lastFiredAt?: number | null;
  lastAttemptFailed?: boolean | null;
  numConsecutiveFailedAttempts?: number | null;
  numTimesFired?: number | null;
  createdAt?: number | null;
}

/** Global notification configuration. */
export interface NotificationSettings {
  id?: string;
  appriseType?: string;
  appriseApiUrl?: string | null;
  notifications: Notification[];
  maxFailedAttempts?: number;
  maxNotificationQueue?: number;
  notificationDelay?: number;
}

/** Read-only catalog entry describing an available event (drives the editor). */
export interface NotificationEventData {
  name: string;
  requiresLibrary: boolean;
  description: string;
  variables: string[];
  defaults?: { title: string; body: string } | null;
}

/** Response of GET /api/notifications: live settings + the event catalog. */
export interface NotificationsResponse {
  settings: NotificationSettings;
  data: { events: NotificationEventData[] };
}

/** Apprise message types, used by the rule editor's type selector. */
export const NOTIFICATION_TYPES = ['info', 'success', 'warning'] as const;
export type NotificationType = typeof NOTIFICATION_TYPES[number];

/** Static fallback labels for the six ABS notification events. Used only if the
 *  server's live event catalog (data.events) comes back empty — normally the UI
 *  drives off the live catalog, which also carries the template variables. */
export const NOTIFICATION_EVENTS: { name: string; label: string; requiresLibrary: boolean }[] = [
  { name: 'onPodcastEpisodeDownloaded', label: 'Podcast episode downloaded', requiresLibrary: true },
  { name: 'onBackupCompleted', label: 'Backup completed', requiresLibrary: false },
  { name: 'onBackupFailed', label: 'Backup failed', requiresLibrary: false },
  { name: 'onRSSFeedFailed', label: 'RSS feed request failed', requiresLibrary: true },
  { name: 'onRSSFeedDisabled', label: 'RSS feed auto-download disabled', requiresLibrary: true },
  { name: 'onTest', label: 'Test event', requiresLibrary: false },
];

/** GET /api/notifications — current settings + event catalog. Admin only. */
export function getNotifications(serverUrl: string): Promise<NotificationsResponse> {
  return invoke('get_notifications', { serverUrl });
}

/** PATCH /api/notifications — update global settings (appriseApiUrl, limits). Admin only. */
export function updateNotificationSettings(serverUrl: string, payload: Partial<NotificationSettings>): Promise<NotificationSettings> {
  return invoke('update_notification_settings', { serverUrl, payload });
}

/** POST /api/notifications — create a rule. Returns updated settings. Admin only. */
export function createNotification(serverUrl: string, payload: Partial<Notification>): Promise<NotificationSettings> {
  return invoke('create_notification', { serverUrl, payload });
}

/** PATCH /api/notifications/:id — update a rule. Returns updated settings. Admin only. */
export function updateNotification(serverUrl: string, id: string, payload: Partial<Notification>): Promise<NotificationSettings> {
  return invoke('update_notification', { serverUrl, id, payload });
}

/** DELETE /api/notifications/:id — delete a rule. Returns updated settings. Admin only. */
export function deleteNotification(serverUrl: string, id: string): Promise<NotificationSettings> {
  return invoke('delete_notification', { serverUrl, id });
}

/** GET /api/notifications/:id/test — send a real test to one rule's URLs. Admin only. */
export function testNotification(serverUrl: string, id: string): Promise<void> {
  return invoke('test_notification', { serverUrl, id });
}

/** GET /api/notifications/test — fire a synthetic onTest event end-to-end. Admin only. */
export function fireTestNotificationEvent(serverUrl: string): Promise<void> {
  return invoke('fire_test_notification_event', { serverUrl });
}

// ── Backups ─────────────────────────────────────────────────────────────────────
// Mirrors the backup models in src-tauri/src/models.rs. All endpoints are
// admin-only. ABS backs up its database + metadata (not the audio files).

/** One backup archive on the server. */
export interface Backup {
  id: string;
  key?: string | null;
  datePretty: string;
  backupDirPath: string;
  filename: string;
  path: string;
  fullPath: string;
  /** Archive size in bytes. */
  fileSize: number;
  /** Creation time, ms since epoch. */
  createdAt: number;
  serverVersion?: string | null;
}

/** Response of GET /api/backups. */
export interface BackupsResponse {
  backups: Backup[];
  backupLocation: string;
  backupPathEnvSet: boolean;
}

/** GET /api/backups — list backups + location. Admin only. */
export function getBackups(serverUrl: string): Promise<BackupsResponse> {
  return invoke('get_backups', { serverUrl });
}

/** POST /api/backups — create a backup now; returns the updated list. Admin only. */
export function createBackup(serverUrl: string): Promise<BackupsResponse> {
  return invoke('create_backup', { serverUrl });
}

/** DELETE /api/backups/:id — delete a backup; returns the updated list. Admin only. */
export function deleteBackup(serverUrl: string, id: string): Promise<BackupsResponse> {
  return invoke('delete_backup', { serverUrl, id });
}

/** GET /api/backups/:id/apply — restore from a backup. DESTRUCTIVE: overwrites the
 *  server database and restarts ABS, so the connection will drop. Admin only. */
export function applyBackup(serverUrl: string, id: string): Promise<void> {
  return invoke('apply_backup', { serverUrl, id });
}

// ── Scheduled tasks ─────────────────────────────────────────────────────────────
// Mirrors the Task models in src-tauri/src/models.rs. GET /api/tasks lists current
// and recently-finished background operations; POST /api/validate-cron validates a
// cron expression. Gated to admins in the UI for consistency with the server panels.

/** One background task. Newer ABS populates the *Key fields (i18n); fall back to
 *  the plain string when the key is what's set. Running = !isFinished. */
export interface Task {
  id: string;
  action: string;
  title: string;
  titleKey?: string | null;
  description: string;
  descriptionKey?: string | null;
  error?: string | null;
  errorKey?: string | null;
  isFinished: boolean;
  isFailed: boolean;
  startedAt?: number | null;
  finishedAt?: number | null;
}

/** Response of GET /api/tasks. */
export interface TasksResponse {
  tasks: Task[];
}

/** GET /api/tasks — current + recently-finished background tasks. */
export function getTasks(serverUrl: string): Promise<TasksResponse> {
  return invoke('get_tasks', { serverUrl });
}

/** POST /api/validate-cron — resolves true if the cron expression is valid. */
export function validateCron(serverUrl: string, expression: string): Promise<boolean> {
  return invoke('validate_cron', { serverUrl, expression });
}

// ── Server logs ─────────────────────────────────────────────────────────────────
// Mirrors the log models in src-tauri/src/models.rs. GET /api/logger-data seeds the
// current day's recent entries; the live tail arrives via the 'server-log' Tauri
// event after start_log_stream registers the socket as a log listener. Admin-only.

/** One server log line. */
export interface LogEntry {
  timestamp: string;
  source: string;
  message: string;
  /** TRACE / DEBUG / INFO / WARN / ERROR / FATAL / NOTE. */
  levelName: string;
  /** Numeric level (LogLevel constants). */
  level: number;
}

/** Response of GET /api/logger-data. */
export interface LoggerData {
  currentDailyLogs: LogEntry[];
}

/** ABS LogLevel constants (server/utils/constants.js) + display colors. Used for
 *  the level filter and row coloring. */
export const LOGGER_LEVELS = [
  { value: 0, label: 'Trace', color: 'var(--onyx-text-mute)' },
  { value: 1, label: 'Debug', color: 'var(--onyx-text-dim)' },
  { value: 2, label: 'Info',  color: 'var(--onyx-text)' },
  { value: 3, label: 'Warn',  color: '#f59e0b' },
  { value: 4, label: 'Error', color: '#e08a8a' },
  { value: 5, label: 'Fatal', color: '#e05a5a' },
] as const;

/** GET /api/logger-data — current day's recent log entries. Admin only. */
export function getLoggerData(serverUrl: string): Promise<LoggerData> {
  return invoke('get_logger_data', { serverUrl });
}

/** Register the live-sync socket as a log listener at `level` (0=Trace … 5=Fatal).
 *  New entries then arrive via the 'server-log' Tauri event. Admin only. */
export function startLogStream(level: number): Promise<void> {
  return invoke('start_log_stream', { level });
}

/** Stop the live log stream. */
export function stopLogStream(): Promise<void> {
  return invoke('stop_log_stream', {});
}
