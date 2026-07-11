// Multi-select download menu (cluster E). Lists the podcast's not-yet-downloaded
// episodes with checkboxes so the user can queue several at once. The episodes
// are passed in already-resolved from the detail screen (no re-fetch).
import { useState, useMemo } from 'react';
import ReactDOM from 'react-dom';
import type { OnyxState } from '../../state/onyx';
import { downloadEpisodes, downloadLocalEpisode, type RecentEpisode } from '../../api/abs';
import { episodeKey } from '../../lib/podcastCover';
import { useModalFocus } from '../../hooks/useModalFocus';
import { errorMessage } from '../../lib/presentError';
import { log } from '../../lib/log';

const MONO = "'JetBrains Mono', ui-monospace, monospace";
const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';

export interface PodcastDownloadModalProps {
  st: OnyxState;
  itemId: string;
  episodes: RecentEpisode[];   // undownloaded episodes, newest first
  onClose: () => void;
  onQueued: () => void;
}

function epDate(ep: RecentEpisode): Date | null {
  const d = ep.publishedAt ? new Date(ep.publishedAt) : ep.pubDate ? new Date(ep.pubDate) : null;
  return d && !isNaN(d.getTime()) ? d : null;
}

export default function PodcastDownloadModal({ st, itemId, episodes, onClose, onQueued }: PodcastDownloadModalProps) {
  // Default to all selected — the common case is "grab the recent batch".
  const [selected, setSelected] = useState<Set<string>>(() => new Set(episodes.map(episodeKey)));
  const [since, setSince] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useModalFocus<HTMLDivElement>(onClose, !busy);

  // Apply the optional since-date filter for display + selection scope.
  const visible = useMemo(() => {
    if (!since) return episodes;
    const s = new Date(since);
    if (isNaN(s.getTime())) return episodes;
    return episodes.filter(ep => { const d = epDate(ep); return d ? d >= s : true; });
  }, [episodes, since]);

  const toggle = (key: string) =>
    setSelected(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const selectAll = () => setSelected(new Set(visible.map(episodeKey)));
  const selectNone = () => setSelected(new Set());

  async function queue() {
    const chosen = episodes.filter(ep => selected.has(episodeKey(ep)));
    if (chosen.length === 0) return;
    setBusy(true); setError('');
    try {
      if (st.activeLibrary?.source === 'local') {
        // Local: download each enclosure directly (no server queue). Sequential so
        // the progress toast tracks one episode at a time.
        for (const ep of chosen) await downloadLocalEpisode(itemId, ep);
      } else {
        await downloadEpisodes(st.serverUrl, itemId, chosen);
      }
      st.setToast({ message: `Queued ${chosen.length} episode${chosen.length === 1 ? '' : 's'} for download`, type: 'success' });
      onQueued();
      onClose();
    } catch (e) {
      log.warn('downloads', 'podcast download queue failed', { itemId, count: chosen.length, err: String(e) });
      setError(errorMessage(e, { operation: 'download' }));
      setBusy(false);
    }
  }

  const modal = (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)' }}
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="podcast-download-title" style={{
        width: 540, maxHeight: '80vh', background: 'var(--onyx-panel2)', border: '1px solid var(--onyx-line)',
        borderRadius: 12, boxShadow: '0 24px 60px rgba(0,0,0,0.7)', display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--onyx-line)' }}>
          <div id="podcast-download-title" style={{ fontFamily: SERIF, fontSize: 17, fontWeight: 500, color: 'var(--onyx-text)' }}>Download Episodes</div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', marginTop: 4, letterSpacing: '0.04em' }}>
            {visible.length} available · {selected.size} selected
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
            <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--onyx-text-dim)', letterSpacing: '0.04em' }}>SINCE</span>
            <input
              type="date" value={since} onChange={e => setSince(e.target.value)}
              style={{ background: 'rgba(0,0,0,0.3)', color: 'var(--onyx-text)', border: '1px solid var(--onyx-line)', borderRadius: 6, padding: '4px 8px', fontSize: 12, fontFamily: 'inherit' }}
            />
            {since && <button onClick={() => setSince('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--onyx-text-mute)', fontFamily: MONO, fontSize: 10 }}>clear</button>}
            <div style={{ flex: 1 }} />
            <button onClick={selectAll} style={{ background: 'none', border: '1px solid var(--onyx-glass-edge)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', color: 'var(--onyx-text-dim)', fontFamily: MONO, fontSize: 10, letterSpacing: '0.04em' }}>ALL</button>
            <button onClick={selectNone} style={{ background: 'none', border: '1px solid var(--onyx-glass-edge)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', color: 'var(--onyx-text-dim)', fontFamily: MONO, fontSize: 10, letterSpacing: '0.04em' }}>NONE</button>
          </div>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', minHeight: 120 }}>
          {visible.length === 0 && (
            <div style={{ padding: 16, fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)' }}>Nothing to download.</div>
          )}
          {visible.map(ep => {
            const key = episodeKey(ep);
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
          <button onClick={onClose} disabled={busy} style={{ background: 'none', border: 'none', cursor: busy ? 'default' : 'pointer', fontFamily: MONO, fontSize: 11, letterSpacing: '0.06em', color: 'var(--onyx-text-dim)' }}>CANCEL</button>
          <button
            onClick={queue}
            disabled={busy || selected.size === 0}
            style={{
              padding: '9px 16px', borderRadius: 8, border: 'none', cursor: (busy || selected.size === 0) ? 'default' : 'pointer',
              background: (busy || selected.size === 0) ? 'var(--onyx-line)' : 'var(--onyx-accent)',
              color: (busy || selected.size === 0) ? 'var(--onyx-text-mute)' : 'var(--onyx-bg)',
              fontFamily: MONO, fontSize: 11, letterSpacing: '0.06em', fontWeight: 600,
            }}
          >{busy ? 'Queueing…' : `Download (${selected.size})`}</button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, document.body);
}
