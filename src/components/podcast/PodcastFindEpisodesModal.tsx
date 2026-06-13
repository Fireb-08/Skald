// Find Episodes (cluster E). Fetches the podcast's live RSS feed, diffs it
// against already-downloaded episodes, and lets the user multi-select and queue
// downloads. A "since" date filter narrows the feed client-side before display.
import { useState, useEffect, useMemo } from 'react';
import ReactDOM from 'react-dom';
import type { OnyxState } from '../../state/onyx';
import {
  getPodcastFeed, downloadEpisodes, asPodcastItem,
  type LibraryItem, type PodcastEpisode,
} from '../../api/abs';

const MONO = "'JetBrains Mono', ui-monospace, monospace";
const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';

export interface PodcastFindEpisodesModalProps {
  st: OnyxState;
  item: LibraryItem;
  onClose: () => void;
  onQueued: () => void;
}

// A stable key for an episode: enclosure URL first (most reliable), then guid.
function epKey(ep: PodcastEpisode): string {
  return ep.enclosure?.url ?? ep.guid ?? `${ep.title}|${ep.pubDate ?? ''}`;
}

function epDate(ep: PodcastEpisode): Date | null {
  const d = ep.publishedAt ? new Date(ep.publishedAt) : ep.pubDate ? new Date(ep.pubDate) : null;
  return d && !isNaN(d.getTime()) ? d : null;
}

export default function PodcastFindEpisodesModal({ st, item, onClose, onQueued }: PodcastFindEpisodesModalProps) {
  const podcast = asPodcastItem(item);
  const feedUrl = podcast.media.metadata?.feedUrl ?? '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedEpisodes, setFeedEpisodes] = useState<PodcastEpisode[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [since, setSince] = useState('');
  const [queueing, setQueueing] = useState(false);

  // Keys of episodes already in the library — used to hide downloaded ones.
  const downloadedKeys = useMemo(
    () => new Set((podcast.media.episodes ?? []).map(epKey)),
    [podcast.media.episodes],
  );

  useEffect(() => {
    if (!feedUrl) { setError('This podcast has no feed URL.'); setLoading(false); return; }
    let cancelled = false;
    setLoading(true); setError('');
    getPodcastFeed(st.serverUrl, feedUrl)
      .then(res => {
        if (cancelled) return;
        const all = res.podcast?.episodes ?? [];
        // Only show episodes not already downloaded.
        const notDownloaded = all.filter(ep => !downloadedKeys.has(epKey(ep)));
        setFeedEpisodes(notDownloaded);
      })
      .catch(e => { if (!cancelled) setError(`Could not fetch feed: ${String(e)}`); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [st.serverUrl, feedUrl, downloadedKeys]);

  // Apply the since-date filter for display.
  const visible = useMemo(() => {
    if (!since) return feedEpisodes;
    const sinceDate = new Date(since);
    if (isNaN(sinceDate.getTime())) return feedEpisodes;
    return feedEpisodes.filter(ep => {
      const d = epDate(ep);
      return d ? d >= sinceDate : true;
    });
  }, [feedEpisodes, since]);

  function toggle(key: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function selectAllVisible() {
    setSelected(new Set(visible.map(epKey)));
  }

  async function queue() {
    const chosen = feedEpisodes.filter(ep => selected.has(epKey(ep)));
    if (chosen.length === 0) return;
    setQueueing(true); setError('');
    try {
      await downloadEpisodes(st.serverUrl, item.id, chosen);
      st.setToast({ message: `Queued ${chosen.length} episode${chosen.length === 1 ? '' : 's'} for download`, type: 'success' });
      onQueued();
      onClose();
    } catch (e) {
      setError(`Download failed: ${String(e)}`);
      setQueueing(false);
    }
  }

  const modal = (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)' }}
      onMouseDown={e => { if (e.target === e.currentTarget && !queueing) onClose(); }}
    >
      <div style={{
        width: 540, maxHeight: '80vh', background: 'var(--onyx-panel2)', border: '1px solid var(--onyx-line)',
        borderRadius: 12, boxShadow: '0 24px 60px rgba(0,0,0,0.7)', display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--onyx-line)' }}>
          <div style={{ fontFamily: SERIF, fontSize: 17, fontWeight: 500, color: 'var(--onyx-text)' }}>Find Episodes</div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', marginTop: 4, letterSpacing: '0.04em' }}>
            {loading ? 'Fetching feed…' : `${visible.length} episode${visible.length === 1 ? '' : 's'} not yet downloaded`}
          </div>
          {/* Since-date filter + select all */}
          {!loading && feedEpisodes.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
              <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--onyx-text-dim)', letterSpacing: '0.04em' }}>SINCE</span>
              <input
                type="date" value={since} onChange={e => setSince(e.target.value)}
                style={{ background: 'rgba(0,0,0,0.3)', color: 'var(--onyx-text)', border: '1px solid var(--onyx-line)', borderRadius: 6, padding: '4px 8px', fontSize: 12, fontFamily: 'inherit' }}
              />
              {since && <button onClick={() => setSince('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--onyx-text-mute)', fontFamily: MONO, fontSize: 10 }}>clear</button>}
              <div style={{ flex: 1 }} />
              <button onClick={selectAllVisible} style={{ background: 'none', border: '1px solid var(--onyx-glass-edge)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', color: 'var(--onyx-text-dim)', fontFamily: MONO, fontSize: 10, letterSpacing: '0.04em' }}>SELECT ALL</button>
            </div>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', minHeight: 120 }}>
          {loading && <div style={{ padding: 16, fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)' }}>Loading…</div>}
          {!loading && visible.length === 0 && !error && (
            <div style={{ padding: 16, fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)' }}>No new episodes to download.</div>
          )}
          {visible.map(ep => {
            const key = epKey(ep);
            const d = epDate(ep);
            return (
              <label key={key} className="onyx-row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 8px', borderRadius: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--onyx-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ep.title}</div>
                  <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', marginTop: 2 }}>
                    {d ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : ''}
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--onyx-line)', display: 'flex', alignItems: 'center', gap: 12 }}>
          {error && <div style={{ fontSize: 11.5, color: '#e8716a', flex: 1 }}>{error}</div>}
          <div style={{ flex: error ? 0 : 1 }} />
          <button onClick={onClose} disabled={queueing} style={{ background: 'none', border: 'none', cursor: queueing ? 'default' : 'pointer', fontFamily: MONO, fontSize: 11, letterSpacing: '0.06em', color: 'var(--onyx-text-dim)' }}>CANCEL</button>
          <button
            onClick={queue}
            disabled={queueing || selected.size === 0}
            style={{
              padding: '9px 16px', borderRadius: 8, border: 'none', cursor: (queueing || selected.size === 0) ? 'default' : 'pointer',
              background: (queueing || selected.size === 0) ? 'var(--onyx-line)' : 'var(--onyx-accent)',
              color: (queueing || selected.size === 0) ? 'var(--onyx-text-mute)' : 'var(--onyx-bg)',
              fontFamily: MONO, fontSize: 11, letterSpacing: '0.06em', fontWeight: 600,
            }}
          >{queueing ? 'Queueing…' : `Download (${selected.size})`}</button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, document.body);
}
