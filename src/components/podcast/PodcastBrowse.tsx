// Podcast library pane (cluster E) — split design:
//   • Top: a horizontal carousel of podcast covers with a genre filter. Selecting
//     a podcast filters the episode feed below to that podcast.
//   • Bottom: a chronological episode feed (newest first) across all podcasts via
//     the recent-episodes endpoint, re-fetched when the library changes so newly
//     downloaded episodes appear automatically.
import React, { useState, useEffect, useRef, type CSSProperties } from 'react';
import type { OnyxState, LibraryItem } from '../../state/onyx';
import { fmtRemaining, fmtTime } from '../../state/onyx';
import { asPodcastItem, getRecentEpisodes, type RecentEpisode } from '../../api/abs';
import { resolvePodcastImage, cachedPodcastImage } from '../../lib/podcastCover';
import { playEpisode, togglePlayback } from '../../api/playbook';
import Cover from '../Cover';
import Icon from '../Icon';
import { COVER_SIZES } from '../shelf/LibraryShelf';
import PodcastSubscribeModal from './PodcastSubscribeModal';

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

export default function PodcastBrowse({ st }: PodcastBrowseProps) {
  const [showSubscribe, setShowSubscribe] = useState(false);
  const [feedImages, setFeedImages] = useState<Record<string, string>>({});
  const [episodes, setEpisodes] = useState<RecentEpisode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [genre, setGenre] = useState<string | null>(null);
  const [genreOpen, setGenreOpen] = useState(false);
  // Carousel cover size follows the global cover-size preference (Settings → Library).
  const coverPx = COVER_SIZES[st.coverSize] ?? COVER_SIZES.L;

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

  // Backfill cover art from the live feed for any podcast lacking a stored image.
  useEffect(() => {
    st.library.forEach(it => {
      if (directImage(it) || cachedPodcastImage(it.id) || feedImages[it.id]) return;
      const meta = (it.media?.metadata ?? {}) as unknown as Record<string, unknown>;
      const feedUrl = meta.feedUrl as string | undefined;
      if (!feedUrl) return;
      resolvePodcastImage(st.serverUrl, it.id, feedUrl).then(url => {
        if (url) setFeedImages(prev => (prev[it.id] ? prev : { ...prev, [it.id]: url }));
      });
    });
  }, [st.library, st.serverUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Chronological episode feed across all podcasts. Re-fetched when the library
  // changes (e.g. after a download lands) so new episodes appear automatically.
  useEffect(() => {
    if (!st.currentLibraryId || !st.serverUrl) return;
    let cancelled = false;
    console.log('[Podcast] loading recent episodes for', st.currentLibraryId);
    getRecentEpisodes(st.serverUrl, st.currentLibraryId, 100)
      .then(res => { if (!cancelled) setEpisodes(res.episodes ?? []); })
      .catch(e => console.error('[Podcast] recent-episodes failed:', e));
    return () => { cancelled = true; };
  }, [st.currentLibraryId, st.serverUrl, st.library]);

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

  // Episode feed: a selected podcast wins; otherwise honour the genre filter.
  const visibleEpisodes = episodes.filter(ep => {
    if (selectedId) return ep.libraryItemId === selectedId;
    if (!genre) return true;
    const it = st.library.find(i => i.id === ep.libraryItemId);
    return it ? podcastGenres(it).includes(genre) : false;
  });

  const selectedPodcast = selectedId ? st.library.find(i => i.id === selectedId) : undefined;

  const openDetail = (id: string) => { st.setPodcastDetailId(id); st.setScreen('podcast'); };

  const playEp = (ep: RecentEpisode) => {
    const pid = ep.libraryItemId;
    if (!pid || !ep.id) return;
    const isCurrent = st.currentEpisodeId === ep.id && st.currentBookId === pid;
    if (isCurrent) { st.setScreen('player'); return; }
    playEpisode(st, pid, ep).catch(e => {
      console.error('[Podcast] playEpisode failed:', e);
      st.setToast({ message: 'Could not start episode', type: 'error' });
    });
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
      onSubscribed={() => { st.refreshLibrary().catch(e => console.error('[Podcast] refresh after subscribe failed:', e)); }}
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
        {/* All chip */}
        <button
          onClick={() => setSelectedId(null)}
          title="All podcasts"
          style={{
            flexShrink: 0, width: coverPx, height: coverPx, borderRadius: 8, cursor: 'pointer',
            border: `2px solid ${selectedId === null ? 'var(--onyx-accent)' : 'var(--onyx-glass-edge)'}`,
            background: 'rgba(0,0,0,0.25)', color: 'var(--onyx-text-dim)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
            fontFamily: MONO, fontSize: 10, letterSpacing: '0.06em',
          }}
        >
          <Icon name="grid" size={18} /> ALL
        </button>
        {visiblePodcasts.map(it => {
          const selected = it.id === selectedId;
          return (
            <button
              key={it.id}
              onClick={() => setSelectedId(prev => prev === it.id ? null : it.id)}
              onDoubleClick={() => openDetail(it.id)}
              title={`${asPodcastItem(it).media?.metadata?.title ?? ''} — click to filter, double-click to open`}
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
        <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)' }}>{visibleEpisodes.length}</div>
        {selectedPodcast && (
          <button onClick={() => openDetail(selectedPodcast.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--onyx-accent)', fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.04em' }}>
            open podcast →
          </button>
        )}
      </div>

      {/* Episode feed */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 2, paddingRight: 4 }}>
        {visibleEpisodes.length === 0 && (
          <div style={{ color: 'var(--onyx-text-mute)', fontFamily: MONO, fontSize: 12, padding: '16px 2px' }}>
            No episodes yet. Open a podcast and use Find Episodes to download some.
          </div>
        )}
        {visibleEpisodes.map(ep => {
          const pid = ep.libraryItemId;
          const podItem = pid ? st.library.find(i => i.id === pid) : undefined;
          const mp = st.mediaProgress.find(x => x.libraryItemId === pid && x.episodeId === ep.id);
          const dur = ep.duration ?? mp?.duration ?? 0;
          const pct = mp ? Math.min(100, Math.round((mp.progress ?? 0) * 100)) : 0;
          const finished = mp?.isFinished ?? false;
          const nowPlaying = st.currentEpisodeId === ep.id && st.currentBookId === pid;
          const podTitle = ep.podcast?.metadata?.title
            ?? (podItem ? asPodcastItem(podItem).media?.metadata?.title : '')
            ?? '';
          const date = episodeDate(ep);
          return (
            <div
              key={(pid ?? '') + (ep.id ?? ep.title)}
              className="onyx-row"
              onClick={() => playEp(ep)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 8px', borderRadius: 8, borderBottom: '1px solid var(--onyx-line)', cursor: 'pointer' }}
            >
              {/* Podcast cover thumb */}
              <div style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 6, overflow: 'hidden', background: 'rgba(0,0,0,0.25)' }}>
                {podItem && <Cover item={podItem} fill serverUrl={st.serverUrl} fallbackImageUrl={coverForId(pid)} />}
              </div>
              {/* Play/pause */}
              <button
                onClick={(e) => { e.stopPropagation(); if (nowPlaying) togglePlayback(st).catch(console.error); else playEp(ep); }}
                title={nowPlaying && st.playing ? 'Pause' : 'Play'}
                style={{
                  width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                  background: nowPlaying ? 'var(--onyx-accent)' : 'rgba(255,255,255,0.06)',
                  color: nowPlaying ? 'var(--onyx-bg)' : 'var(--onyx-text)',
                  border: '1px solid var(--onyx-glass-edge)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Icon name={nowPlaying && st.playing ? 'pause' : 'play'} size={13} />
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: 'var(--onyx-text)', fontWeight: nowPlaying ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ep.title}</div>
                <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.03em', marginTop: 2, display: 'flex', gap: 10, overflow: 'hidden' }}>
                  {!selectedId && podTitle && <span style={{ color: 'var(--onyx-text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{podTitle}</span>}
                  {date && <span>{date}</span>}
                  {dur > 0 && <span>{fmtRemaining(dur)}</span>}
                  {finished ? <span style={{ color: 'var(--onyx-accent)' }}>finished</span>
                    : pct > 0 ? <span>{fmtTime(mp?.currentTime ?? 0)} · {pct}%</span> : null}
                </div>
                {pct > 0 && !finished && (
                  <div style={{ height: 2, background: 'var(--onyx-line)', borderRadius: 1, marginTop: 5, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: 'var(--onyx-accent)' }} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {modal}
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
