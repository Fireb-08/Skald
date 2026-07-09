// Split from the original single-file abs.ts (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. Import from '../abs' (the barrel),
// not from this file directly.
import { invoke } from '@tauri-apps/api/core';
import type { Chapter, LibraryItem } from './types';

// ── Podcasts (cluster E) ─────────────────────────────────────────────────────
// The Rust LibraryItem.media is pass-through JSON, so a podcast item arrives as
// a LibraryItem whose `media` is really PodcastMedia. Rather than force a
// discriminated union (which would demand mediaType guards across all existing
// book code that reads media.chapters/duration/tags), book code keeps the
// BookMedia view and podcast code uses PodcastLibraryItem via asPodcastItem().

/** Per-episode enclosure (the audio file reference from the RSS feed). */
export interface EpisodeEnclosure {
  url?: string;
  type?: string;
  length?: string;
}

/** A podcast episode. Feed-preview episodes (not yet downloaded) carry no id;
 *  library episodes do. `audioFile`/`audioTrack`/`chapters` shapes vary, so
 *  they stay loosely typed. */
export interface PodcastEpisode {
  id?: string;
  podcastId?: string;
  index?: number;
  season?: string;
  episode?: string;
  episodeType?: string;
  title: string;
  subtitle?: string;
  description?: string;
  pubDate?: string;
  publishedAt?: number;
  enclosure?: EpisodeEnclosure;
  duration?: number;
  size?: number;
  // Present on downloaded library episodes only.
  audioFile?: unknown;
  audioTrack?: unknown;
  chapters?: Chapter[];
  // Feed episodes carry a guid used to dedupe against downloaded episodes.
  guid?: string;
}

/** An episode as returned by the recent-episodes feed: the expanded episode
 *  plus a reference back to its parent podcast (id + metadata) for display. */
export interface RecentEpisode extends PodcastEpisode {
  libraryItemId?: string;
  libraryId?: string;
  podcast?: { metadata?: PodcastMetadata };
}

/** Podcast-level metadata (parallels BookMetadata). */
export interface PodcastMetadata {
  title: string | null;
  author?: string | null;
  description?: string | null;
  releaseDate?: string | null;
  genres?: string[];
  feedUrl?: string | null;
  imageUrl?: string | null;
  itunesPageUrl?: string | null;
  itunesId?: string | number | null;
  itunesArtistId?: string | number | null;
  language?: string | null;
  explicit?: boolean;
  type?: string | null;
}

/** Podcast media payload. Auto-download settings live here. */
export interface PodcastMedia {
  metadata: PodcastMetadata;
  episodes: PodcastEpisode[];
  tags?: string[];
  autoDownloadEpisodes?: boolean;
  autoDownloadSchedule?: string | null;
  lastEpisodeCheck?: number;
  maxEpisodesToKeep?: number;
  maxNewEpisodesToDownload?: number;
  numEpisodes?: number;
  size?: number;
}

/** A library item known to be a podcast — same shape as LibraryItem but with
 *  the podcast media view. Obtain via asPodcastItem(). */
export interface PodcastLibraryItem extends Omit<LibraryItem, 'media'> {
  media: PodcastMedia;
}

/** Narrow a LibraryItem to its podcast view. The runtime shape already matches
 *  (media is pass-through JSON); this is a typed reinterpretation, not a copy. */
export function asPodcastItem(item: LibraryItem): PodcastLibraryItem {
  return item as unknown as PodcastLibraryItem;
}

// ── Podcasts (cluster E) ─────────────────────────────────────────────────────
// Wrappers over the podcast Tauri commands. Backend forwards JSON verbatim, so
// several of these are typed loosely (the feed/episode/queue shapes vary).

/** A feed entry parsed from OPML (parseOpml result). */
export interface OpmlFeed {
  title?: string;
  feedUrl: string;
  [k: string]: unknown;
}

/** POST /api/podcasts/feed — preview an RSS feed. Returns `{ podcast }` whose
 *  shape is PodcastMedia plus the episode list pulled from the live feed. */
export function getPodcastFeed(serverUrl: string, rssFeed: string): Promise<{ podcast: PodcastMedia }> {
  return invoke('get_podcast_feed', { serverUrl, rssFeed });
}

/** POST /api/podcasts — create a podcast item from a previewed feed.
 *  `payload` is the full create body the caller assembles. */
export function createPodcast(serverUrl: string, payload: unknown): Promise<LibraryItem> {
  return invoke('create_podcast', { serverUrl, payload });
}

/** POST /api/podcasts/opml/parse — parse OPML text into a feed list. */
export function parseOpml(serverUrl: string, opmlText: string): Promise<{ feeds: OpmlFeed[] }> {
  return invoke('parse_opml', { serverUrl, opmlText });
}

/** POST /api/podcasts/opml/create — bulk-subscribe from feed URLs. */
export function createPodcastsFromOpml(serverUrl: string, payload: unknown): Promise<void> {
  return invoke('create_podcasts_from_opml', { serverUrl, payload });
}

/** GET /api/podcasts/:id/checknew — poll the feed for new episodes now. */
export function checkNewEpisodes(serverUrl: string, itemId: string, limit?: number): Promise<{ episodes: PodcastEpisode[] }> {
  return invoke('check_new_episodes', { serverUrl, itemId, limit: limit ?? null });
}

/** GET /api/podcasts/:id/downloads — the current episode download queue. */
export function getEpisodeDownloads(serverUrl: string, itemId: string): Promise<{ downloads: unknown[]; currentDownload?: unknown }> {
  return invoke('get_episode_downloads', { serverUrl, itemId });
}

/** GET /api/podcasts/:id/clear-queue — clear queued episode downloads. */
export function clearEpisodeDownloadQueue(serverUrl: string, itemId: string): Promise<void> {
  return invoke('clear_episode_download_queue', { serverUrl, itemId });
}

/** POST /api/podcasts/:id/download-episodes — queue episodes for download.
 *  `episodes` is the array of feed-episode objects to fetch. */
export function downloadEpisodes(serverUrl: string, itemId: string, episodes: PodcastEpisode[]): Promise<void> {
  return invoke('download_episodes', { serverUrl, itemId, episodes });
}

/** GET /api/podcasts/:id/search-episode — find one episode in the live feed. */
export function findEpisode(serverUrl: string, itemId: string, title: string): Promise<{ episodes: PodcastEpisode[] }> {
  return invoke('find_episode', { serverUrl, itemId, title });
}

/** POST /api/podcasts/:id/match-episodes — quick-match episode metadata. */
export function matchEpisodes(serverUrl: string, itemId: string, overrideExisting: boolean): Promise<{ numEpisodesUpdated: number }> {
  return invoke('match_episodes', { serverUrl, itemId, overrideExisting });
}

/** GET /api/podcasts/:id/episode/:episodeId — fetch one episode. */
export function getEpisode(serverUrl: string, itemId: string, episodeId: string): Promise<PodcastEpisode> {
  return invoke('get_episode', { serverUrl, itemId, episodeId });
}

/** PATCH /api/podcasts/:id/episode/:episodeId — edit episode metadata. */
export function updateEpisode(serverUrl: string, itemId: string, episodeId: string, payload: unknown): Promise<LibraryItem> {
  return invoke('update_episode', { serverUrl, itemId, episodeId, payload });
}

/** DELETE /api/podcasts/:id/episode/:episodeId — remove an episode (hard=disk). */
export function deleteEpisode(serverUrl: string, itemId: string, episodeId: string, hard: boolean): Promise<LibraryItem> {
  return invoke('delete_episode', { serverUrl, itemId, episodeId, hard });
}

/** GET /api/libraries/:id/recent-episodes — episodes across all podcasts in the
 *  library, newest first (publishedAt DESC). Each carries its parent podcast. */
export function getRecentEpisodes(serverUrl: string, libraryId: string, limit?: number, page?: number): Promise<{ episodes: RecentEpisode[] }> {
  return invoke('get_recent_episodes', { serverUrl, libraryId, limit: limit ?? null, page: page ?? null });
}

/** GET /api/libraries/:id/opml — export the podcast library as OPML XML text. */
export function exportOpml(serverUrl: string, libraryId: string): Promise<string> {
  return invoke('export_opml', { serverUrl, libraryId });
}
