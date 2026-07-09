// Podcast library pane (cluster E) — split design:
//   • Top: a horizontal carousel of podcast covers with a genre filter. Selecting
//     a podcast filters the episode feed below to that podcast.
//   • Bottom: a chronological episode feed (newest first) across all podcasts via
//     the recent-episodes endpoint, re-fetched when the library changes so newly
//     downloaded episodes appear automatically.
import React, { useState, useEffect, useRef, type CSSProperties } from 'react';
import type { OnyxState, LibraryItem } from '../../state/onyx';
import { fmtRemaining, fmtTime } from '../../state/onyx';
import { asPodcastItem, getRecentEpisodes, getLocalRecentEpisodes, type RecentEpisode } from '../../api/abs';
import { resolvePodcastFeed, cachedPodcastImage, episodeKey } from '../../lib/podcastCover';
import { playEpisode, togglePlayback } from '../../api/playbook';
import { log } from '../../lib/log';
import Cover from '../Cover';
import Icon from '../Icon';
import ContextMenu from '../ContextMenu';
import CoverPicker from '../CoverPicker';
import FilesModal from '../shelf/FilesModal';
import { COVER_SIZES } from '../shelf/LibraryShelf';
import PodcastSubscribeModal from './PodcastSubscribeModal';
import PodcastSettingsModal from './PodcastSettingsModal';
import PodcastDownloadModal from './PodcastDownloadModal';
import { buildPodcastContextMenu } from './buildPodcastContextMenu';

export interface PodcastBrowseProps {
  st: OnyxState;
}

const MONO = "'JetBrains Mono', ui-monospace, monospace";

// Stored cover URL a podcast item already carries (imageUrl, or raw-feed `image`).
function directImage(it: LibraryItem): string | undefined {
  const m = (it.media?.metadata ?? {}) as unknown as Record<string, unknown>;
  return (m.imageUrl as string) || (m.image as string) || undefined;
}

function podcastGenres(it: LibraryItem): string[] {
  return asPodcastItem(it).media?.metadata?.genres ?? [];
}

function episodeDate(ep: RecentEpisode): string {
  const d = ep.publishedAt ? new Date(ep.publishedAt) : ep.pubDate ? new Date(ep.pubDate) : null;
  if (!d || isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Sort key — milliseconds since epoch from publishedAt or the RSS pubDate.
function episodeTime(ep: RecentEpisode): number {
  if (ep.publishedAt) return ep.publishedAt;
  if (ep.pubDate) { const t = Date.parse(ep.pubDate); return isNaN(t) ? 0 : t; }
  return 0;
}

export default function PodcastBrowse({ st }: PodcastBrowseProps) {
  const [showSubscribe, setShowSubscribe] = useState(false);
  const [feedImages, setFeedImages] = useState<Record<string, string>>({});
  // Published episodes resolved from each podcast's live feed (keyed by podcast).
  const [feedEpisodes, setFeedEpisodes] = useState<Record<string, RecentEpisode[]>>({});
  // Downloaded episodes (from recent-episodes), indexed by stable episode key, so
  // a feed episode can be matched to its downloaded (playable) counterpart.
  const [downloadedMap, setDownloadedMap] = useState<Map<string, RecentEpisode>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [genre, setGenre] = useState<string | null>(null);
  const [genreOpen, setGenreOpen] = useState(false);
  // Right-click context menu + the modals its actions open.
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: LibraryItem } | null>(null);
  const [settingsItem, setSettingsItem] = useState<LibraryItem | null>(null);
  const [downloadItem, setDownloadItem] = useState<LibraryItem | null>(null);
  const [coverItem, setCoverItem] = useState<LibraryItem | null>(null);
  const [filesItem, setFilesItem] = useState<LibraryItem | null>(null);
  // Carousel cover size follows the global cover-size preference (Settings → Library).
  const coverPx = COVER_SIZES[st.coverSize] ?? COVER_SIZES.L;
  // Local podcast libraries resolve feeds + downloaded episodes server-free.
  const isLocal = st.activeLibrary?.source === 'local';

  // Click-drag-to-swipe for the carousel (mirrors the Pick it up shelf). A drag
  // of >5px is flagged so the trailing click doesn't select/open a podcast.
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startScrollLeft: number; didDrag: boolean } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const onCarouselMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    dragRef.current = { startX: e.clientX, startScrollLeft: el.scrollLeft, didDrag: false };
    setIsDragging(true);
    const onMove = (me: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = me.clientX - dragRef.current.startX;
      if (Math.abs(delta) > 5) dragRef.current.didDrag = true;
      el.scrollLeft = dragRef.current.startScrollLeft - delta;
    };
    const onUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // Swallow the click that follows a drag so it doesn't trigger select/open.
  const onCarouselClickCapture = (e: React.MouseEvent) => {
    if (dragRef.current?.didDrag) {
      e.stopPropagation();
      dragRef.current.didDrag = false;
    }
  };

  // Resolve each podcast's live feed once (cached): backfills cover art AND the
  // published episode list, so the feed below shows the latest *published*
  // episodes rather than only the downloaded ones.
  useEffect(() => {
    st.library.forEach(it => {
      const meta = (it.media?.metadata ?? {}) as unknown as Record<string, unknown>;
      const feedUrl = meta.feedUrl as string | undefined;
      if (!feedUrl) return;
      resolvePodcastFeed(st.serverUrl, it.id, feedUrl, isLocal).then(data => {
        if (!data) return;
        if (data.image) setFeedImages(prev => (prev[it.id] ? prev : { ...prev, [it.id]: data.image! }));
        if (data.episodes.length) setFeedEpisodes(prev => ({ ...prev, [it.id]: data.episodes }));
      });
    });
  }, [st.library, st.serverUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Map of downloaded episodes (keyed by stable episode key) so feed episodes can
  // be matched to a playable downloaded counterpart. Re-fetched when the library
  // changes (e.g. after a download lands).
  useEffect(() => {
    if (!st.currentLibraryId) return;
    if (!isLocal && !st.serverUrl) return; // ABS needs a server; local does not
    let cancelled = false;
    const fetchDownloaded = isLocal
      ? getLocalRecentEpisodes(st.currentLibraryId).then(episodes => ({ episodes }))
      : getRecentEpisodes(st.serverUrl, st.currentLibraryId, 200);
    fetchDownloaded
      .then(res => {
        if (cancelled) return;
        const m = new Map<string, RecentEpisode>();
        (res.episodes ?? []).forEach(e => m.set(episodeKey(e), e));
        setDownloadedMap(m);
      })
      .catch(e => log.error('library', 'podcast recent-episodes fetch failed', { err: String(e) }));
    return () => { cancelled = true; };
  }, [st.currentLibraryId, st.serverUrl, st.library, isLocal]);

  // Drop cached feed episodes/images for podcasts that have left the library
  // (e.g. after unsubscribe) so the caches don't grow stale. Returns the previous
  // object unchanged when nothing was pruned, avoiding needless re-renders.
  useEffect(() => {
    const libIds = new Set(st.library.map(i => i.id));
    const prune = <T,>(prev: Record<string, T>): Record<string, T> => {
      const kept = Object.keys(prev).filter(id => libIds.has(id));
      if (kept.length === Object.keys(prev).length) return prev;
      return Object.fromEntries(kept.map(id => [id, prev[id]]));
    };
    setFeedEpisodes(prune);
    setFeedImages(prune);
  }, [st.library]);

  const coverForId = (id?: string): string | undefined => {
    if (!id) return undefined;
    const it = st.library.find(i => i.id === id);
    return (it ? directImage(it) : undefined) ?? cachedPodcastImage(id) ?? feedImages[id];
  };

  // Genre options aggregated across podcasts.
  const genres = [...new Set(st.library.flatMap(podcastGenres).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  // Carousel podcasts (genre-narrowed).
  const visiblePodcasts = genre
    ? st.library.filter(it => podcastGenres(it).includes(genre))
    : st.library;

  // Unified feed: published feed episodes (each matched to its downloaded
  // counterpart when present) plus any downloaded episode no longer in the feed.
  // Filtered by the selected podcast / genre, newest first.
  const mergedEpisodes = (() => {
    // Only episodes whose podcast is still in the library — the feed/cover caches
    // (feedEpisodes/downloadedMap) can retain entries for a podcast after it's
    // unsubscribed, so guard against showing its episodes.
    const libIds = new Set(st.library.map(i => i.id));
    const byKey = new Map<string, { ep: RecentEpisode; downloaded: boolean }>();
    for (const list of Object.values(feedEpisodes)) {
      for (const ep of list) {
        const k = episodeKey(ep);
        const dl = downloadedMap.get(k);
        byKey.set(k, { ep: dl ?? ep, downloaded: !!dl });
      }
    }
    // Downloaded episodes that have aged out of the feed should still appear.
    downloadedMap.forEach((ep, k) => { if (!byKey.has(k)) byKey.set(k, { ep, downloaded: true }); });
    return [...byKey.values()]
      .filter(({ ep }) => {
        if (!ep.libraryItemId || !libIds.has(ep.libraryItemId)) return false;
        if (selectedId) return ep.libraryItemId === selectedId;
        if (!genre) return true;
        const it = st.library.find(i => i.id === ep.libraryItemId);
        return it ? podcastGenres(it).includes(genre) : false;
      })
      .sort((a, b) => episodeTime(b.ep) - episodeTime(a.ep))
      .slice(0, 60);
  })();

  const selectedPodcast = selectedId ? st.library.find(i => i.id === selectedId) : undefined;

  // Undownloaded episodes for the podcast whose download picker is open (newest
  // first, drawn from the resolved feed minus what's already downloaded).
  const downloadEpisodes = downloadItem
    ? (feedEpisodes[downloadItem.id] ?? []).filter(ep => !downloadedMap.has(episodeKey(ep)))
    : [];

  const openDetail = (id: string) => { st.setPodcastDetailId(id); st.setScreen('podcast'); };

  // Downloaded episode → play directly (open the player on it).
  const playEp = async (ep: RecentEpisode) => {
    const pid = ep.libraryItemId;
    if (!pid || !ep.id) return;
    const isCurrent = st.currentEpisodeId === ep.id && st.currentBookId === pid;
    if (isCurrent) { st.setScreen('player'); return; }
    // Navigate only after playback starts (see PodcastDetail.play) — a failed
    // session open must not strand the user on a player showing stale state.
    try {
      await playEpisode(st, pid, ep);
      st.setScreen('player');
    } catch (e) {
      log.error('playback', 'playEpisode failed', { itemId: pid, episodeId: ep.id, err: String(e) });
      st.setToast({ message: 'Could not start episode', type: 'error' });
    }
  };

  // Undownloaded episode → open the player in its pending-download state (no
  // episode id yet); the player offers Download → auto-play on completion.
  const openUndownloaded = (ep: RecentEpisode) => {
    const pid = ep.libraryItemId;
    if (!pid) return;
    st.setCurrentEpisode(ep);
    st.setCurrentEpisodeId(null);
    st.setCurrentBookId(pid);
    st.setFocusedBookId(pid);
    st.setScreen('player');
  };

  const subscribeBtn = (
    <button
      onClick={() => setShowSubscribe(true)}
      style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--onyx-glass-edge)', cursor: 'pointer', background: 'var(--onyx-accent)', color: 'var(--onyx-bg)', fontFamily: MONO, fontSize: 11, letterSpacing: '0.06em', fontWeight: 600 }}
    >+ Subscribe</button>
  );

  const modal = showSubscribe && st.activeLibrary && (
    <PodcastSubscribeModal
      st={st}
      library={st.activeLibrary}
      onClose={() => setShowSubscribe(false)}
      onSubscribed={() => { st.refreshLibrary().catch(e => log.error('library', 'refresh after podcast subscribe failed', { err: String(e) })); }}
    />
  );

  if (st.library.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-dim)', letterSpacing: '0.06em' }}>0 PODCASTS</div>
          <div style={{ flex: 1 }} />{subscribeBtn}
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--onyx-text-mute)', fontFamily: MONO, fontSize: 13, letterSpacing: '0.06em', gap: 8 }}>
          <div>No podcasts in this library yet.</div>
          <div style={{ fontSize: 11, opacity: 0.7 }}>Use Subscribe to add one by RSS feed or OPML import.</div>
        </div>
        {modal}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-dim)', letterSpacing: '0.06em' }}>
          {st.library.length} PODCAST{st.library.length === 1 ? '' : 'S'}
        </div>
        {/* All filter — small pill (replaces the old full-size carousel tile) so
            the covers lead. Active when no single podcast is selected. */}
        <button
          onClick={() => setSelectedId(null)}
          title="Show all podcasts"
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 6, cursor: 'pointer',
            background: selectedId === null ? 'var(--onyx-accent-dim)' : 'rgba(0,0,0,0.3)',
            color: selectedId === null ? 'var(--onyx-accent)' : 'var(--onyx-text-dim)',
            border: `1px solid ${selectedId === null ? 'var(--onyx-accent-edge)' : 'var(--onyx-glass-edge)'}`,
            fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.04em',
          }}
        >
          <Icon name="grid" size={12} /> All
        </button>
        {/* Genre filter for the carousel */}
        {genres.length > 0 && (
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setGenreOpen(o => !o)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 6, cursor: 'pointer',
                background: genre ? 'var(--onyx-accent-dim)' : 'rgba(0,0,0,0.3)',
                color: genre ? 'var(--onyx-accent)' : 'var(--onyx-text-dim)',
                border: `1px solid ${genre ? 'var(--onyx-accent-edge)' : 'var(--onyx-glass-edge)'}`,
                fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.04em',
              }}
            >
              {genre ?? 'All genres'} <Icon name="chevron-down" size={12} />
            </button>
            {genreOpen && (
              <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 50, minWidth: 160, maxHeight: 280, overflowY: 'auto', background: 'var(--onyx-panel)', border: '1px solid var(--onyx-glass-edge)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', padding: 4 }}>
                <button onClick={() => { setGenre(null); setGenreOpen(false); }} style={genreItemStyle(genre === null)}>All genres</button>
                {genres.map(g => (
                  <button key={g} onClick={() => { setGenre(g); setGenreOpen(false); }} style={genreItemStyle(genre === g)}>{g}</button>
                ))}
              </div>
            )}
          </div>
        )}
        <div style={{ flex: 1 }} />
        {subscribeBtn}
      </div>

      {/* Carousel of podcast covers — drag to swipe (like Pick it up) */}
      <div
        ref={scrollRef}
        onMouseDown={onCarouselMouseDown}
        onMouseLeave={() => { if (dragRef.current) { setIsDragging(false); dragRef.current = null; } }}
        onDragStart={e => e.preventDefault()}
        onClickCapture={onCarouselClickCapture}
        className="pickitup-scroll"
        style={{ flexShrink: 0, display: 'flex', gap: 12, overflowX: 'auto', overflowY: 'hidden', paddingBottom: 6, cursor: isDragging ? 'grabbing' : 'grab', userSelect: isDragging ? 'none' : undefined, WebkitOverflowScrolling: 'touch' }}
      >
        {visiblePodcasts.map(it => {
          const selected = it.id === selectedId;
          return (
            <button
              key={it.id}
              onClick={() => setSelectedId(prev => prev === it.id ? null : it.id)}
              onDoubleClick={() => openDetail(it.id)}
              onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, item: it }); }}
              title={`${asPodcastItem(it).media?.metadata?.title ?? ''} — click to filter, double-click to open, right-click for options`}
              className="onyx-poster"
              style={{
                flexShrink: 0, width: coverPx, height: coverPx, borderRadius: 8, cursor: 'pointer', padding: 0, overflow: 'hidden',
                border: `2px solid ${selected ? 'var(--onyx-accent)' : 'transparent'}`, background: 'none',
              }}
            >
              <Cover item={it} fill serverUrl={st.serverUrl} fallbackImageUrl={coverForId(it.id)} />
            </button>
          );
        })}
      </div>

      {/* Episode feed header — shows the active filter + a way into the detail */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <div style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--onyx-text-mute)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          {selectedPodcast ? (asPodcastItem(selectedPodcast).media?.metadata?.title ?? 'Episodes') : 'Latest Episodes'}
        </div>
        <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)' }}>{mergedEpisodes.length}</div>
        {selectedPodcast && (
          <button onClick={() => openDetail(selectedPodcast.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--onyx-accent)', fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.04em' }}>
            open podcast →
          </button>
        )}
      </div>

      {/* Episode feed */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 2, paddingRight: 4 }}>
        {mergedEpisodes.length === 0 && (
          <div style={{ color: 'var(--onyx-text-mute)', fontFamily: MONO, fontSize: 12, padding: '16px 2px' }}>
            No episodes found. Subscribe to a podcast to see its latest episodes.
          </div>
        )}
        {mergedEpisodes.map(({ ep, downloaded }) => {
          const pid = ep.libraryItemId;
          const podItem = pid ? st.library.find(i => i.id === pid) : undefined;
          const mp = downloaded ? st.mediaProgress.find(x => x.libraryItemId === pid && x.episodeId === ep.id) : undefined;
          const dur = ep.duration ?? mp?.duration ?? 0;
          const pct = mp ? Math.min(100, Math.round((mp.progress ?? 0) * 100)) : 0;
          const finished = mp?.isFinished ?? false;
          const nowPlaying = downloaded && st.currentEpisodeId === ep.id && st.currentBookId === pid;
          const podTitle = ep.podcast?.metadata?.title
            ?? (podItem ? asPodcastItem(podItem).media?.metadata?.title : '')
            ?? '';
          const date = episodeDate(ep);
          const onRow = () => (downloaded ? playEp(ep) : openUndownloaded(ep));
          return (
            <div
              key={(pid ?? '') + episodeKey(ep)}
              className="onyx-row"
              onClick={onRow}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 8px', borderBottom: '1px solid var(--onyx-line)', cursor: 'pointer' }}
            >
              {/* Podcast cover thumb */}
              <div style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 6, overflow: 'hidden', background: 'rgba(0,0,0,0.25)' }}>
                {podItem && <Cover item={podItem} fill serverUrl={st.serverUrl} fallbackImageUrl={coverForId(pid)} />}
              </div>
              {/* Play (downloaded) / Download (not yet downloaded) */}
              <button
                onClick={(e) => { e.stopPropagation(); if (!downloaded) { openUndownloaded(ep); return; } if (nowPlaying) togglePlayback(st).catch(err => log.error('playback', 'episode toggle playback failed', { err: String(err) })); else playEp(ep); }}
                title={!downloaded ? 'Download episode' : (nowPlaying && st.playing ? 'Pause' : 'Play')}
                style={{
                  width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                  background: nowPlaying ? 'var(--onyx-accent)' : 'rgba(255,255,255,0.06)',
                  color: nowPlaying ? 'var(--onyx-bg)' : (downloaded ? 'var(--onyx-text-mute)' : 'var(--onyx-text-mute)'),
                  border: `1px solid ${nowPlaying ? 'var(--onyx-accent)' : 'rgba(255,255,255,0.11)'}`, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.1s',
                }}
              >
                <Icon name={!downloaded ? 'plus' : (nowPlaying && st.playing ? 'pause' : 'play')} size={12} />
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: downloaded ? 'var(--onyx-text)' : 'var(--onyx-text-dim)', fontWeight: downloaded ? 500 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2 }}>{ep.title}</div>
                <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.03em', marginTop: 3, display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
                  {!selectedId && podTitle && <><span style={{ color: 'var(--onyx-text-mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>{podTitle}</span><span style={{ margin: '0 5px', display: 'inline-flex', width: 2, height: 2, borderRadius: '50%', background: 'rgba(235,231,223,0.2)', flexShrink: 0 }} /></>}
                  {date && <>{date}<span style={{ margin: '0 5px', display: 'inline-flex', width: 2, height: 2, borderRadius: '50%', background: 'rgba(235,231,223,0.2)', flexShrink: 0 }} /></>}
                  {dur > 0 && <span>{fmtRemaining(dur)}</span>}
                  {!downloaded && <><span style={{ margin: '0 5px', display: 'inline-flex', width: 2, height: 2, borderRadius: '50%', background: 'rgba(235,231,223,0.2)', flexShrink: 0 }} /><span style={{ color: 'rgba(235,231,223,0.5)' }}>not downloaded</span></>}
                  {downloaded && finished && <><span style={{ margin: '0 5px', display: 'inline-flex', width: 2, height: 2, borderRadius: '50%', background: 'rgba(235,231,223,0.2)', flexShrink: 0 }} /><span style={{ color: 'var(--onyx-accent)' }}>finished</span></>}
                  {downloaded && pct > 0 && !finished && <><span style={{ margin: '0 5px', display: 'inline-flex', width: 2, height: 2, borderRadius: '50%', background: 'rgba(235,231,223,0.2)', flexShrink: 0 }} /><span>{fmtTime(mp?.currentTime ?? 0)} · {pct}%</span></>}
                </div>
                {pct > 0 && !finished && (
                  <div style={{ height: 2, background: 'var(--onyx-line)', borderRadius: 1, marginTop: 5, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: 'var(--onyx-accent)' }} />
                  </div>
                )}
              </div>
              {!downloaded && (
                <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '3px 8px', borderRadius: 5, background: 'var(--onyx-accent-dim)', color: 'var(--onyx-accent)', border: `1px solid var(--onyx-accent-edge)`, flexShrink: 0, whiteSpace: 'nowrap' }}>New</div>
              )}
            </div>
          );
        })}
      </div>

      {modal}

      {/* Right-click context menu + the modals its actions open */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          sections={buildPodcastContextMenu(contextMenu.item, st, {
            openDetail,
            setDownloadItem,
            setSettingsItem,
            setCoverItem,
            setFilesItem,
            onUnsubscribed: (id) => { if (selectedId === id) setSelectedId(null); },
          })}
          onClose={() => setContextMenu(null)}
        />
      )}
      {settingsItem && (
        <PodcastSettingsModal
          st={st}
          item={settingsItem}
          onClose={() => setSettingsItem(null)}
          onSaved={() => { st.refreshLibrary().catch(e => log.error('library', 'refresh after podcast settings save failed', { err: String(e) })); setSettingsItem(null); }}
        />
      )}
      {downloadItem && (
        <PodcastDownloadModal
          st={st}
          itemId={downloadItem.id}
          episodes={downloadEpisodes}
          onClose={() => setDownloadItem(null)}
          onQueued={() => setDownloadItem(null)}
        />
      )}
      {coverItem && <CoverPicker item={coverItem} st={st} onClose={() => setCoverItem(null)} />}
      {filesItem && <FilesModal bookId={filesItem.id} serverUrl={st.serverUrl} onClose={() => setFilesItem(null)} />}
    </div>
  );
}

function genreItemStyle(active: boolean): CSSProperties {
  return {
    display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', borderRadius: 6,
    background: active ? 'var(--onyx-accent-dim)' : 'transparent',
    color: active ? 'var(--onyx-accent)' : 'var(--onyx-text)',
    border: 'none', cursor: 'pointer', fontFamily: MONO, fontSize: 11, letterSpacing: '0.03em',
  };
}
