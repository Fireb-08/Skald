// Split from the original single-file abs.ts (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. Import from '../abs' (the barrel),
// not from this file directly.
import { invoke } from '@tauri-apps/api/core';
import type { OpmlFeed, PodcastEpisode, PodcastMedia, RecentEpisode } from './podcasts';
import type { LibraryItem } from './types';

// ── Local podcasts (Local Podcasts roadmap) ──────────────────────────────────
// Server-free counterparts of the ABS podcast wrappers. The active library's
// `source` decides which set the podcast components call (see podcastSource.ts).

/** A discovery result from the iTunes podcast directory (search_local_podcasts). */
export interface PodcastSearchResult {
  title: string | null;
  author: string | null;
  feedUrl: string;
  cover: string | null;
  genres: string[];
  trackCount: number | null;
  itunesId: number | null;
}

/** Fetch + parse a feed locally for the subscribe preview. Returns PodcastMedia. */
export function getLocalPodcastFeed(feedUrl: string): Promise<PodcastMedia> {
  return invoke('get_local_podcast_feed', { feedUrl });
}

/** Subscribe a local podcast library to a feed; returns the new podcast item. */
export function subscribeLocalPodcast(libraryId: string, feedUrl: string, autoDownload = false): Promise<LibraryItem> {
  return invoke('subscribe_local_podcast', { libraryId, feedUrl, autoDownload });
}

/** A local podcast library's subscriptions (ABS-shaped LibraryItems). */
export function getLocalPodcastItems(libraryId: string): Promise<LibraryItem[]> {
  return invoke('get_local_podcast_items', { libraryId });
}

/** Downloaded episodes across a local podcast library (recent-episodes equivalent). */
export function getLocalRecentEpisodes(libraryId: string): Promise<RecentEpisode[]> {
  return invoke('get_local_recent_episodes', { libraryId });
}

/** Download one episode's enclosure; resolves with the on-disk audio path. */
export function downloadLocalEpisode(podcastId: string, episode: PodcastEpisode): Promise<string> {
  return invoke('download_local_episode', { podcastId, episode });
}

/** Update a local podcast's auto-download settings; returns the updated item. */
export function updateLocalPodcastSettings(
  podcastId: string, autoDownload: boolean, schedule: string | null, maxNew: number, maxKeep: number,
): Promise<LibraryItem> {
  return invoke('update_local_podcast_settings', { podcastId, autoDownload, schedule, maxNew, maxKeep });
}

/** Re-poll a local podcast's feed now; upserts new episodes, returns the feed list. */
export function checkLocalNewEpisodes(podcastId: string): Promise<{ episodes: PodcastEpisode[] }> {
  return invoke('check_local_new_episodes', { podcastId });
}

/** Unsubscribe a local podcast (rows + files + folder). */
export function deleteLocalPodcast(podcastId: string): Promise<void> {
  return invoke('delete_local_podcast', { podcastId });
}

/** Search the iTunes podcast directory for discovery. */
export function searchLocalPodcasts(query: string, region?: string): Promise<PodcastSearchResult[]> {
  return invoke('search_local_podcasts', { query, region: region ?? null });
}

/** Parse OPML text into a feed list (local). */
export function parseLocalOpml(opmlText: string): Promise<{ feeds: OpmlFeed[] }> {
  return invoke('parse_local_opml', { opmlText });
}

/** Bulk-subscribe a local library to OPML feed URLs; returns the success count. */
export function subscribeLocalOpml(libraryId: string, feeds: string[], autoDownload = false): Promise<number> {
  return invoke('subscribe_local_opml', { libraryId, feeds, autoDownload });
}

/** Export a local podcast library's subscriptions as OPML XML text. */
export function exportLocalOpml(libraryId: string): Promise<string> {
  return invoke('export_local_opml', { libraryId });
}
