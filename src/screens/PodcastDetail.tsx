// Podcast detail screen (cluster E). Shows a podcast's header (cover, title,
// author, feed URL) and its downloaded episodes with per-episode progress and
// a play action. Reached from PodcastBrowse via st.setScreen('podcast').
import { useState, useEffect } from 'react';
import type { OnyxState, LibraryItem } from '../state/onyx';
import { fmtRemaining, fmtTime } from '../state/onyx';
import { asPodcastItem, fetchItem, type PodcastEpisode } from '../api/abs';
import { playEpisode, togglePlayback } from '../api/playbook';
import Cover from '../components/Cover';
import Icon from '../components/Icon';
import PodcastFindEpisodesModal from '../components/podcast/PodcastFindEpisodesModal';
import PodcastSettingsModal from '../components/podcast/PodcastSettingsModal';

export interface PodcastDetailProps {
  st: OnyxState;
}

// Resolve an episode's publish date to a display string, tolerating both the
// numeric publishedAt (ms) and the raw RSS pubDate string.
function episodeDate(ep: PodcastEpisode): string {
  const d = ep.publishedAt
    ? new Date(ep.publishedAt)
    : ep.pubDate
      ? new Date(ep.pubDate)
      : null;
  if (!d || isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function PodcastDetail({ st }: PodcastDetailProps) {
  const mono = "'JetBrains Mono', ui-monospace, monospace";
  const [showFind, setShowFind] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // The library list returns MINIFIED podcast items — they carry numEpisodes but
  // not the episodes[] array. Fetch the expanded item (GET /api/items/:id) so the
  // episode list is populated. Re-fetch when the episode count changes (e.g. a
  // download lands via the live-sync item-updated event) or after Find Episodes.
  const libEntry = st.library.find(i => i.id === st.podcastDetailId);
  const libEpisodeCount = libEntry
    ? (asPodcastItem(libEntry).media.numEpisodes ?? asPodcastItem(libEntry).media.episodes?.length ?? 0)
    : 0;
  const [full, setFull] = useState<LibraryItem | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (!st.podcastDetailId || !st.serverUrl) { setFull(null); return; }
    let cancelled = false;
    console.log('[Podcast] fetch expanded item', st.podcastDetailId);
    fetchItem(st.serverUrl, st.podcastDetailId)
      .then(it => { if (!cancelled) setFull(it); })
      .catch(e => console.error('[Podcast] fetchItem detail failed:', e));
    return () => { cancelled = true; };
  }, [st.podcastDetailId, st.serverUrl, libEpisodeCount, refreshTick]);

  // Prefer the expanded item (has episodes[]); fall back to the minified entry
  // for the header while the expanded fetch is in flight.
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
  const episodes = [...(p.media.episodes ?? [])].sort((a, b) => {
    const ax = a.publishedAt ?? a.index ?? 0;
    const bx = b.publishedAt ?? b.index ?? 0;
    return bx - ax; // newest first
  });

  const back = () => { st.setScreen('library'); st.setPodcastDetailId(null); };

  const play = (ep: PodcastEpisode) => {
    if (!ep.id) return;
    playEpisode(st, item.id, ep).catch(e => {
      console.error('[Podcast] playEpisode failed:', e);
      st.setToast({ message: 'Could not start episode', type: 'error' });
    });
    st.setScreen('player');
  };

  // Clicking anywhere on an episode row opens the player: if it is already the
  // loaded episode, just navigate (don't restart the session); otherwise start it.
  const openEpisode = (ep: PodcastEpisode) => {
    if (!ep.id) return;
    const isCurrent = st.currentEpisodeId === ep.id && st.currentBookId === item.id;
    if (isCurrent) { st.setScreen('player'); return; }
    play(ep);
  };

  // The round button toggles pause/resume for the loaded episode (no restart);
  // for any other episode it starts playback and opens the player.
  const onPlayButton = (e: React.MouseEvent, ep: PodcastEpisode, isCurrent: boolean) => {
    e.stopPropagation();
    if (isCurrent) { togglePlayback(st).catch(console.error); return; }
    play(ep);
  };

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
          <Cover item={item} fill serverUrl={st.serverUrl} fallbackImageUrl={meta?.imageUrl ?? undefined} />
        </div>
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--onyx-text)', lineHeight: 1.15 }}>
            {meta.title ?? item.id}
          </div>
          {meta.author && <div style={{ fontSize: 13, color: 'var(--onyx-text-dim)' }}>{meta.author}</div>}
          <div style={{ fontFamily: mono, fontSize: 11, color: 'var(--onyx-text-mute)', letterSpacing: '0.04em' }}>
            {episodes.length} episode{episodes.length === 1 ? '' : 's'}
            {meta.explicit ? ' · explicit' : ''}
          </div>
          {meta.feedUrl && (
            <div style={{
              fontFamily: mono, fontSize: 10.5, color: 'var(--onyx-text-mute)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 460, opacity: 0.8,
            }} title={meta.feedUrl}>{meta.feedUrl}</div>
          )}
          {meta.description && (
            <div style={{
              fontSize: 12, color: 'var(--onyx-text-dim)', lineHeight: 1.45, marginTop: 4, maxWidth: 560,
              overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
            }}>{meta.description}</div>
          )}
          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button
              onClick={() => setShowFind(true)}
              style={{ padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--onyx-accent)', color: 'var(--onyx-bg)', fontFamily: mono, fontSize: 11, letterSpacing: '0.06em', fontWeight: 600 }}
            >Find Episodes</button>
            <button
              onClick={() => setShowSettings(true)}
              style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--onyx-glass-edge)', cursor: 'pointer', background: 'transparent', color: 'var(--onyx-text-dim)', fontFamily: mono, fontSize: 11, letterSpacing: '0.06em' }}
            >Auto-download</button>
          </div>
        </div>
      </div>

      {/* Episode list */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 2, paddingRight: 4 }}>
        {episodes.length === 0 && (
          <div style={{ color: 'var(--onyx-text-mute)', fontFamily: mono, fontSize: 12, padding: '16px 0' }}>
            No downloaded episodes yet.
          </div>
        )}
        {episodes.map(ep => {
          const mp = st.mediaProgress.find(x => x.libraryItemId === item.id && x.episodeId === ep.id);
          const dur = ep.duration ?? mp?.duration ?? 0;
          const pct = mp ? Math.min(100, Math.round((mp.progress ?? 0) * 100)) : 0;
          const finished = mp?.isFinished ?? false;
          const nowPlaying = st.currentEpisodeId === ep.id && st.currentBookId === item.id;
          const date = episodeDate(ep);
          return (
            <div
              key={ep.id ?? ep.title}
              className="onyx-row"
              onClick={() => openEpisode(ep)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 10px',
                borderRadius: 8, borderBottom: '1px solid var(--onyx-line)', cursor: 'pointer',
              }}
            >
              <button
                onClick={(e) => onPlayButton(e, ep, nowPlaying)}
                title={nowPlaying && st.playing ? 'Pause' : 'Play episode'}
                style={{
                  width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                  background: nowPlaying ? 'var(--onyx-accent)' : 'rgba(255,255,255,0.06)',
                  color: nowPlaying ? 'var(--onyx-bg)' : 'var(--onyx-text)',
                  border: '1px solid var(--onyx-glass-edge)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Icon name={nowPlaying && st.playing ? 'pause' : 'play'} size={14} />
              </button>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13, color: 'var(--onyx-text)', fontWeight: nowPlaying ? 600 : 400,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{ep.title}</div>
                <div style={{ fontFamily: mono, fontSize: 10.5, color: 'var(--onyx-text-mute)', letterSpacing: '0.03em', marginTop: 2, display: 'flex', gap: 10 }}>
                  {date && <span>{date}</span>}
                  {dur > 0 && <span>{fmtRemaining(dur)}</span>}
                  {finished ? <span style={{ color: 'var(--onyx-accent)' }}>finished</span>
                    : pct > 0 ? <span>{fmtTime((mp?.currentTime ?? 0))} · {pct}%</span> : null}
                </div>
                {/* Progress bar */}
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

      {showFind && (
        <PodcastFindEpisodesModal
          st={st}
          item={item}
          onClose={() => setShowFind(false)}
          onQueued={() => { setRefreshTick(t => t + 1); st.refreshLibrary().catch(e => console.error('[Podcast] refresh after queue failed:', e)); }}
        />
      )}
      {showSettings && (
        <PodcastSettingsModal
          st={st}
          item={item}
          onClose={() => setShowSettings(false)}
          onSaved={() => { setRefreshTick(t => t + 1); st.refreshLibrary().catch(e => console.error('[Podcast] refresh after settings save failed:', e)); }}
        />
      )}
    </div>
  );
}
