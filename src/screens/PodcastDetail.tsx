// Podcast detail screen (cluster E). Shows a podcast's header and the full list
// of PUBLISHED episodes (resolved from the live feed on open, merged with the
// downloaded ones). Downloaded episodes play; undownloaded ones open the player
// in its download-then-play flow. A "Download…" picker queues selected
// not-yet-downloaded episodes. Reached from PodcastBrowse via setScreen('podcast').
import { useState, useEffect } from 'react';
import type { OnyxState, LibraryItem } from '../state/onyx';
import { fmtRemaining, fmtTime } from '../state/onyx';
import { asPodcastItem, fetchItem, type PodcastEpisode, type RecentEpisode } from '../api/abs';
import { resolvePodcastFeed, cachedFeedEpisodes, cachedPodcastImage, episodeKey } from '../lib/podcastCover';
import { playEpisode, togglePlayback } from '../api/playbook';
import { log } from '../lib/log';
import Cover from '../components/Cover';
import Icon from '../components/Icon';
import ContextMenu from '../components/ContextMenu';
import PlaylistPicker from '../components/PlaylistPicker';
import PodcastSettingsModal from '../components/podcast/PodcastSettingsModal';
import PodcastDownloadModal from '../components/podcast/PodcastDownloadModal';
import { buildEpisodeContextMenu } from '../components/podcast/buildEpisodeContextMenu';

export interface PodcastDetailProps {
  st: OnyxState;
}

function episodeDate(ep: PodcastEpisode): string {
  const d = ep.publishedAt ? new Date(ep.publishedAt) : ep.pubDate ? new Date(ep.pubDate) : null;
  if (!d || isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function episodeTime(ep: PodcastEpisode): number {
  if (ep.publishedAt) return ep.publishedAt;
  if (ep.pubDate) { const t = Date.parse(ep.pubDate); return isNaN(t) ? 0 : t; }
  return ep.index ?? 0;
}

export default function PodcastDetail({ st }: PodcastDetailProps) {
  const mono = "'JetBrains Mono', ui-monospace, monospace";
  const [showSettings, setShowSettings] = useState(false);
  const [showDownload, setShowDownload] = useState(false);
  // Episode right-click menu + the Add-to-Playlist picker it can open.
  const [epMenu, setEpMenu] = useState<{ x: number; y: number; ep: PodcastEpisode; downloaded: boolean } | null>(null);
  const [playlistEp, setPlaylistEp] = useState<PodcastEpisode | null>(null);

  // The library list returns MINIFIED podcast items (numEpisodes but no
  // episodes[]). Fetch the expanded item for the downloaded episode list.
  const libEntry = st.library.find(i => i.id === st.podcastDetailId);
  const libEpisodeCount = libEntry
    ? (asPodcastItem(libEntry).media.numEpisodes ?? asPodcastItem(libEntry).media.episodes?.length ?? 0)
    : 0;
  const [full, setFull] = useState<LibraryItem | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const bumpRefresh = () => { setRefreshTick(t => t + 1); st.refreshLibrary().catch(e => log.error('library', 'podcast detail refresh failed', { err: String(e) })); };
  const [feedImg, setFeedImg] = useState<string | undefined>(
    () => (st.podcastDetailId ? cachedPodcastImage(st.podcastDetailId) : undefined),
  );
  // Published feed episodes (auto-resolved on open). Seed from cache for instant
  // display, then refresh from the live feed.
  const [feedEps, setFeedEps] = useState<RecentEpisode[]>(
    () => (st.podcastDetailId ? cachedFeedEpisodes(st.podcastDetailId) ?? [] : []),
  );

  // Local podcast libraries embed the full episode list in the library item, so
  // there is no server item to expand — render from libEntry directly.
  const isLocal = st.activeLibrary?.source === 'local';

  useEffect(() => {
    if (isLocal) { setFull(null); return; }
    if (!st.podcastDetailId || !st.serverUrl) { setFull(null); return; }
    let cancelled = false;
    fetchItem(st.serverUrl, st.podcastDetailId)
      .then(it => { if (!cancelled) setFull(it); })
      .catch(e => log.error('library', 'podcast detail fetchItem failed', { itemId: st.podcastDetailId, err: String(e) }));
    return () => { cancelled = true; };
  }, [st.podcastDetailId, st.serverUrl, libEpisodeCount, refreshTick, isLocal]);

  // Auto "find episodes": resolve the live feed on open (cached) so the screen
  // shows the latest published episodes, not just the downloaded ones.
  const metaFeedUrl = ((full ?? libEntry) as unknown as { media?: { metadata?: Record<string, unknown> } })?.media?.metadata?.feedUrl as string | undefined;
  useEffect(() => {
    const id = st.podcastDetailId;
    if (!id || !metaFeedUrl) return;
    let cancelled = false;
    resolvePodcastFeed(st.serverUrl, id, metaFeedUrl, isLocal).then(d => {
      if (cancelled || !d) return;
      if (d.episodes.length) setFeedEps(d.episodes);
      if (d.image) setFeedImg(prev => prev ?? d.image ?? undefined);
    });
    return () => { cancelled = true; };
  }, [st.podcastDetailId, st.serverUrl, metaFeedUrl, isLocal]);

  const item = full ?? libEntry;

  if (!item) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--onyx-text-mute)', fontFamily: mono, fontSize: 13 }}>
        Podcast not found.
      </div>
    );
  }

  const p = asPodcastItem(item);
  const meta = p.media.metadata;
  const autoOn = p.media.autoDownloadEpisodes ?? false;

  // Merge downloaded episodes (playable, with progress) with the published feed.
  const downloadedEps = p.media.episodes ?? [];
  const dlMap = new Map<string, PodcastEpisode>();
  downloadedEps.forEach(e => dlMap.set(episodeKey(e), e));
  const byKey = new Map<string, { ep: PodcastEpisode; downloaded: boolean }>();
  feedEps.forEach(fe => {
    const k = episodeKey(fe);
    const dl = dlMap.get(k);
    byKey.set(k, { ep: dl ?? fe, downloaded: !!dl });
  });
  downloadedEps.forEach(e => {
    const k = episodeKey(e);
    if (!byKey.has(k)) byKey.set(k, { ep: e, downloaded: true });
  });
  const episodes = [...byKey.values()].sort((a, b) => episodeTime(b.ep) - episodeTime(a.ep));
  const pendingCount = episodes.filter(e => !e.downloaded).length;

  const back = () => { st.setScreen('library'); st.setPodcastDetailId(null); };

  const play = async (ep: PodcastEpisode) => {
    if (!ep.id) return;
    // Navigate only after playback actually starts — jumping to the player
    // first would leave it showing the previous (or no) item when the session
    // open fails, which reads as a broken player rather than a play error.
    try {
      await playEpisode(st, item.id, ep);
      st.setScreen('player');
    } catch (e) {
      log.error('playback', 'playEpisode failed', { itemId: item.id, episodeId: ep.id, err: String(e) });
      st.setToast({ message: 'Could not start episode', type: 'error' });
    }
  };

  // Undownloaded → open the player in its pending/download-then-play state.
  const openUndownloaded = (ep: PodcastEpisode) => {
    st.setCurrentEpisode(ep);
    st.setCurrentEpisodeId(null);
    st.setCurrentBookId(item.id);
    st.setFocusedBookId(item.id);
    st.setScreen('player');
  };

  const onRow = (ep: PodcastEpisode, downloaded: boolean) => {
    if (!downloaded) { openUndownloaded(ep); return; }
    if (!ep.id) return;
    const isCurrent = st.currentEpisodeId === ep.id && st.currentBookId === item.id;
    if (isCurrent) { st.setScreen('player'); return; }
    play(ep);
  };

  // The undownloaded episodes offered in the download picker.
  const undownloaded = episodes.filter(e => !e.downloaded).map(e => e.ep);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 18, padding: '8px 24px 24px', minHeight: 0, width: '100%', overflow: 'hidden' }}>
      {/* Back */}
      <button
        onClick={back}
        style={{
          alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6,
          background: 'none', border: 'none', cursor: 'pointer', fontFamily: mono,
          fontSize: 11, letterSpacing: '0.06em', color: 'var(--onyx-text-dim)', padding: 0,
        }}
      >
        <Icon name="chevron-left" size={14} /> LIBRARY
      </button>

      {/* Header */}
      <div style={{ display: 'flex', gap: 20, flexShrink: 0 }}>
        <div style={{ width: 160, height: 160, flexShrink: 0 }}>
          <Cover item={item} fill serverUrl={st.serverUrl} fallbackImageUrl={(meta?.imageUrl ?? (meta as unknown as { image?: string })?.image) || feedImg} />
        </div>
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--onyx-text)', lineHeight: 1.15 }}>
            {meta.title ?? item.id}
          </div>
          {meta.author && <div style={{ fontSize: 13, color: 'var(--onyx-text-dim)' }}>{meta.author}</div>}
          <div style={{ fontFamily: mono, fontSize: 11, color: 'var(--onyx-text-mute)', letterSpacing: '0.04em' }}>
            {episodes.length} episode{episodes.length === 1 ? '' : 's'}
            {pendingCount > 0 ? ` · ${pendingCount} not downloaded` : ''}
            {meta.explicit ? ' · explicit' : ''}
          </div>
          {meta.feedUrl && (
            <div className="onyx-selectable" style={{
              fontFamily: mono, fontSize: 10.5, color: 'var(--onyx-text-mute)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 460, opacity: 0.8,
            }} title={meta.feedUrl}>{meta.feedUrl}</div>
          )}
          {meta.description && (
            <div className="onyx-selectable" style={{
              fontSize: 12, color: 'var(--onyx-text-dim)', lineHeight: 1.45, marginTop: 4, maxWidth: 560,
              overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
            }}>{meta.description}</div>
          )}
          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button
              onClick={() => setShowDownload(true)}
              disabled={pendingCount === 0}
              title={pendingCount === 0 ? 'All episodes downloaded' : `Choose from ${pendingCount} episode${pendingCount === 1 ? '' : 's'} to download`}
              style={{
                padding: '7px 14px', borderRadius: 8, border: 'none',
                cursor: pendingCount === 0 ? 'default' : 'pointer',
                background: pendingCount === 0 ? 'var(--onyx-line)' : 'var(--onyx-accent)',
                color: pendingCount === 0 ? 'var(--onyx-text-mute)' : 'var(--onyx-bg)',
                fontFamily: mono, fontSize: 11, letterSpacing: '0.06em', fontWeight: 600,
              }}
            >{pendingCount === 0 ? 'All downloaded' : `Download… (${pendingCount})`}</button>
            <button
              onClick={() => setShowSettings(true)}
              title={autoOn ? 'Auto-download is on — click to configure' : 'Configure auto-download'}
              style={{
                padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
                background: autoOn ? 'var(--onyx-accent)' : 'transparent',
                color: autoOn ? 'var(--onyx-bg)' : 'var(--onyx-text-dim)',
                border: autoOn ? 'none' : '1px solid var(--onyx-glass-edge)',
                fontFamily: mono, fontSize: 11, letterSpacing: '0.06em', fontWeight: autoOn ? 600 : 400,
              }}
            >{autoOn ? 'Auto-download · enabled' : 'Auto-download'}</button>
          </div>
        </div>
      </div>

      {/* Episode list */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 2, paddingRight: 4 }}>
        {episodes.length === 0 && (
          <div style={{ color: 'var(--onyx-text-mute)', fontFamily: mono, fontSize: 12, padding: '16px 0' }}>
            No episodes found in the feed.
          </div>
        )}
        {episodes.map(({ ep, downloaded }) => {
          const mp = downloaded ? st.mediaProgress.find(x => x.libraryItemId === item.id && x.episodeId === ep.id) : undefined;
          const dur = ep.duration ?? mp?.duration ?? 0;
          const pct = mp ? Math.min(100, Math.round((mp.progress ?? 0) * 100)) : 0;
          const finished = mp?.isFinished ?? false;
          const nowPlaying = downloaded && st.currentEpisodeId === ep.id && st.currentBookId === item.id;
          const date = episodeDate(ep);
          return (
            <div
              key={episodeKey(ep)}
              className="onyx-row"
              onClick={() => onRow(ep, downloaded)}
              onContextMenu={(e) => { e.preventDefault(); setEpMenu({ x: e.clientX, y: e.clientY, ep, downloaded }); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 10px',
                borderRadius: 8, borderBottom: '1px solid var(--onyx-line)', cursor: 'pointer',
              }}
            >
              <button
                onClick={(e) => { e.stopPropagation(); if (!downloaded) { openUndownloaded(ep); return; } if (nowPlaying) togglePlayback(st).catch(err => log.error('playback', 'episode toggle playback failed', { err: String(err) })); else play(ep); }}
                title={!downloaded ? 'Download episode' : (nowPlaying && st.playing ? 'Pause' : 'Play episode')}
                style={{
                  width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                  background: nowPlaying ? 'var(--onyx-accent)' : 'rgba(255,255,255,0.06)',
                  color: nowPlaying ? 'var(--onyx-bg)' : (downloaded ? 'var(--onyx-text)' : 'var(--onyx-text-mute)'),
                  border: '1px solid var(--onyx-glass-edge)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Icon name={!downloaded ? 'plus' : (nowPlaying && st.playing ? 'pause' : 'play')} size={14} />
              </button>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13, color: downloaded ? 'var(--onyx-text)' : 'var(--onyx-text-dim)', fontWeight: nowPlaying ? 600 : 400,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{ep.title}</div>
                <div style={{ fontFamily: mono, fontSize: 10.5, color: 'var(--onyx-text-mute)', letterSpacing: '0.03em', marginTop: 2, display: 'flex', gap: 10 }}>
                  {date && <span>{date}</span>}
                  {dur > 0 && <span>{fmtRemaining(dur)}</span>}
                  {!downloaded ? <span style={{ color: 'var(--onyx-text-mute)' }}>not downloaded</span>
                    : finished ? <span style={{ color: 'var(--onyx-accent)' }}>finished</span>
                    : pct > 0 ? <span>{fmtTime((mp?.currentTime ?? 0))} · {pct}%</span> : null}
                </div>
                {pct > 0 && !finished && (
                  <div style={{ height: 2, background: 'var(--onyx-line)', borderRadius: 1, marginTop: 6, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: 'var(--onyx-accent)' }} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Episode right-click menu (Podcast Episode Context Menu roadmap) */}
      {epMenu && (
        <ContextMenu
          x={epMenu.x}
          y={epMenu.y}
          sections={buildEpisodeContextMenu(item, epMenu.ep, epMenu.downloaded, st, {
            play,
            openUndownloaded,
            setPlaylistEpisode: isLocal ? undefined : (_it, ep2) => setPlaylistEp(ep2),
            onDeleted: bumpRefresh,
          })}
          onClose={() => setEpMenu(null)}
        />
      )}
      {playlistEp && (
        <PlaylistPicker item={item} episode={playlistEp} serverUrl={st.serverUrl} onClose={() => setPlaylistEp(null)} />
      )}

      {showDownload && (
        <PodcastDownloadModal
          st={st}
          itemId={item.id}
          episodes={undownloaded}
          onClose={() => setShowDownload(false)}
          onQueued={bumpRefresh}
        />
      )}
      {showSettings && (
        <PodcastSettingsModal
          st={st}
          item={item}
          onClose={() => setShowSettings(false)}
          onSaved={bumpRefresh}
        />
      )}
    </div>
  );
}
