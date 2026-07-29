// Regression: offline, a podcast's detail screen must show its DOWNLOADED
// episodes even though the cached library item is minified (numEpisodes but no
// episodes[]). This was the "podcast in library but 0 episodes, yet they're in
// Downloads" bug — the detail read only the cached item's empty episodes[] and
// never folded in the offline downloads registry.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act, cleanup } from '@testing-library/react';

const tauri = vi.hoisted(() => {
  const handlers = new Map<string, (args?: Record<string, unknown>) => unknown>();
  const listeners = new Map<string, Set<(e: { event: string; payload: unknown }) => void>>();
  return {
    handlers,
    invoke: async (cmd: string, args?: Record<string, unknown>) => handlers.get(cmd)?.(args),
    listen: (event: string, cb: (e: { event: string; payload: unknown }) => void) => {
      let set = listeners.get(event);
      if (!set) { set = new Set(); listeners.set(event, set); }
      set.add(cb);
      return Promise.resolve(() => { set!.delete(cb); });
    },
  };
});

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke, convertFileSrc: (p: string) => `asset://${p}` }));
vi.mock('@tauri-apps/api/event', () => ({ listen: tauri.listen }));
vi.mock('@tauri-apps/plugin-log', () => ({
  info: vi.fn(async () => {}), warn: vi.fn(async () => {}), error: vi.fn(async () => {}),
  debug: vi.fn(async () => {}), attachConsole: vi.fn(async () => () => {}),
}));

import { useOnyxState, type OnyxState } from '../state/onyx';
import PodcastDetail from './PodcastDetail';

const SERVER = 'http://abs.local';
const POD = 'pod-1';

let captured: OnyxState;
function Harness() {
  const st = useOnyxState();
  captured = st;
  return <PodcastDetail st={st} />;
}

afterEach(cleanup);

beforeEach(() => {
  localStorage.clear();
  tauri.handlers.clear();
  localStorage.setItem('skald.serverUrl', SERVER);
  localStorage.setItem('skald.hasAuth', 'true');

  // Offline launch with the podcast in the cached library — MINIFIED, so it has
  // numEpisodes but no episodes[], exactly like a real cached ABS podcast item.
  tauri.handlers.set('fetch_libraries', () => { throw new Error('offline'); });
  tauri.handlers.set('get_local_libraries', () => []);
  tauri.handlers.set('load_library_cache', () => [
    { id: POD, mediaType: 'podcast', media: { metadata: { title: 'Laying Down The Lore', feedUrl: 'https://x/rss' }, numEpisodes: 0, episodes: [] } },
  ]);
  // Three downloaded episodes of that podcast in the registry.
  tauri.handlers.set('get_downloads', () => [
    { itemId: POD, episodeId: 'e1', title: 'Drukhari Introduction', author: 'Laying Down The Lore', filePath: 'C:/dl/pod-1/e1/e1.mp3', fileSize: 100, downloadedAt: 30 },
    { itemId: POD, episodeId: 'e2', title: 'Chaos Mortals Introduction', author: 'Laying Down The Lore', filePath: 'C:/dl/pod-1/e2/e2.mp3', fileSize: 200, downloadedAt: 20 },
    { itemId: POD, episodeId: 'e3', title: 'Aeldari Introduction', author: 'Laying Down The Lore', filePath: 'C:/dl/pod-1/e3/e3.mp3', fileSize: 300, downloadedAt: 10 },
  ]);
  tauri.handlers.set('take_corrupt_persistence_notices', () => []);
  tauri.handlers.set('flush_offline_progress', () => 0);
  tauri.handlers.set('list_offline_progress', () => []);
  tauri.handlers.set('get_me', () => ({ mediaProgress: [] }));
});

describe('offline podcast detail', () => {
  it('shows the downloaded episodes even when the cached item is minified', async () => {
    render(<Harness />);
    await waitFor(() => {
      expect(captured.isOffline).toBe(true);
      expect(captured.downloads.filter(d => d.episodeId).length).toBe(3);
    });

    // Open the podcast (as the shelf tile does).
    act(() => { captured.setPodcastDetailId(POD); });

    // The three downloaded episodes render (previously it showed "No episodes
    // found in the feed." because the cached item's episodes[] was empty).
    await waitFor(() => {
      expect(document.body.textContent).toContain('Drukhari Introduction');
    });
    expect(document.body.textContent).toContain('Aeldari Introduction');
    expect(document.body.textContent).toContain('3 episodes');
    expect(document.body.textContent).not.toContain('No episodes found');
  });
});
