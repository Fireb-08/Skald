import { useEffect, useState, useCallback } from 'react';
import type { CSSProperties } from 'react';
import type { OnyxState } from '../../state/onyx';
import { getFeeds, deleteShare, closeFeed, getShareBySlug, type RssFeed } from '../../api/abs';
import { getTrackedShares, removeTrackedShare, getPublicBaseUrl, setPublicBaseUrl, publicBase, absoluteFeedUrl, type TrackedShare } from '../../lib/shareTracker';
import { SectionHead, MONO } from './shared';

export interface SharingSectionProps { st: OnyxState; }

function publicShareUrl(serverUrl: string, slug: string): string {
  return `${publicBase(serverUrl)}/share/${slug}`;
}

async function copy(text: string, st: OnyxState, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    st.setToast({ message: `${label} copied to clipboard`, type: 'success' });
  } catch {
    st.setToast({ message: `Copy failed — ${text}`, type: 'info' });
  }
}

/**
 * Sharing & RSS admin hub (cluster G). Three blocks:
 *  - Share Manager — lists locally-tracked shares (ABS has no list route), each
 *    re-validated against GET /api/share/:slug so stale entries self-purge;
 *  - RSS Feed Manager — lists open feeds from GET /api/feeds with a close action;
 *  - OPDS — informational only (ABS exposes no OPDS route).
 * Per-item creation lives in the shelf's Share & Publish modal.
 */
export default function SharingSection({ st }: SharingSectionProps) {
  const [shares, setShares] = useState<TrackedShare[]>([]);
  const [feeds, setFeeds] = useState<RssFeed[]>([]);
  const [feedsLoading, setFeedsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Public base URL used to build share/feed links (persisted via shareTracker).
  const [pubUrl, setPubUrl] = useState(getPublicBaseUrl());

  // Load tracked shares and drop any the server no longer has (404 on slug).
  const loadShares = useCallback(async () => {
    const tracked = getTrackedShares();
    const checks = await Promise.allSettled(tracked.map(s => getShareBySlug(st.serverUrl, s.slug)));
    const live = tracked.filter((s, i) => {
      if (checks[i].status === 'rejected') {
        console.log('[Sharing] purging stale tracked share', s.slug);
        removeTrackedShare(s.id);
        return false;
      }
      return true;
    });
    setShares(live);
  }, [st.serverUrl]);

  const loadFeeds = useCallback(async () => {
    setFeedsLoading(true);
    try {
      const list = await getFeeds(st.serverUrl);
      setFeeds(list);
      console.log('[Sharing] SharingSection loaded', list.length, 'open feed(s)');
    } catch (e) {
      console.error('[Sharing] getFeeds failed:', e);
      st.setToast({ message: `Failed to load feeds: ${String(e)}`, type: 'error' });
    } finally {
      setFeedsLoading(false);
    }
  }, [st.serverUrl]);

  useEffect(() => { void loadShares(); void loadFeeds(); }, [loadShares, loadFeeds]);

  const revokeShare = useCallback((s: TrackedShare) => {
    st.setConfirmDialog({
      title: 'Revoke share link?',
      message: `The public link for "${s.title}" will stop working immediately.`,
      confirmLabel: 'Revoke',
      onConfirm: async () => {
        setBusyId(s.id);
        try {
          await deleteShare(st.serverUrl, s.id);
          removeTrackedShare(s.id);
          setShares(prev => prev.filter(x => x.id !== s.id));
          st.setToast({ message: 'Share link revoked.', type: 'success' });
        } catch (e) {
          st.setToast({ message: `Revoke failed: ${String(e)}`, type: 'error' });
        } finally {
          setBusyId(null);
        }
      },
    });
  }, [st]);

  const close = useCallback((f: RssFeed) => {
    const name = f.meta?.title || f.slug || f.id;
    st.setConfirmDialog({
      title: 'Close RSS feed?',
      message: `The public feed "${name}" will stop working immediately.`,
      confirmLabel: 'Close feed',
      onConfirm: async () => {
        setBusyId(f.id);
        try {
          await closeFeed(st.serverUrl, f.id);
          setFeeds(prev => prev.filter(x => x.id !== f.id));
          st.setToast({ message: 'RSS feed closed.', type: 'success' });
        } catch (e) {
          st.setToast({ message: `Close failed: ${String(e)}`, type: 'error' });
        } finally {
          setBusyId(null);
        }
      },
    });
  }, [st]);

  const card: CSSProperties = { border: '1px solid var(--onyx-line)', borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--onyx-panel2)' };
  const sub: CSSProperties = { fontFamily: MONO, fontSize: 10.5, color: 'var(--onyx-text-mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
  const ghostBtn: CSSProperties = { padding: '6px 12px', borderRadius: 7, cursor: 'pointer', background: 'var(--onyx-accent-dim)', border: '1px solid var(--onyx-accent-edge)', color: 'var(--onyx-accent)', fontFamily: MONO, fontSize: 10.5, flexShrink: 0 };
  const dangerBtn: CSSProperties = { padding: '6px 12px', borderRadius: 7, cursor: 'pointer', background: 'rgba(220,80,80,0.12)', border: '1px solid rgba(220,80,80,0.35)', color: '#e08a8a', fontFamily: MONO, fontSize: 10.5, flexShrink: 0 };
  const heading: CSSProperties = { fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--onyx-text-dim)', margin: '26px 0 12px' };
  const empty: CSSProperties = { fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', padding: '10px 0' };
  const input: CSSProperties = { padding: '8px 12px', minWidth: 320, fontSize: 13, background: 'rgba(0,0,0,0.3)', borderRadius: 8, color: 'var(--onyx-text)', border: '1px solid var(--onyx-glass-edge)', outline: 'none', fontFamily: MONO };

  return (
    <div>
      <SectionHead
        title="Sharing & RSS"
        subtitle="Manage public share links and RSS feeds. Create them per item from the library context menu (Share & Publish). These are admin-only server surfaces."
      />

      {/* ── Public link address ── */}
      <div style={heading}>Public link address</div>
      <input
        value={pubUrl}
        onChange={e => { setPubUrl(e.target.value); setPublicBaseUrl(e.target.value); }}
        placeholder={st.serverUrl}
        style={input}
      />
      <div style={empty}>
        Share and new RSS feed links are built from this address. Leave blank to use the server URL Skald connects to ({st.serverUrl}). Set it to a public domain (e.g. https://abs.example.com) so links work outside your LAN — your Audiobookshelf server must be reachable there.
      </div>

      {/* ── Share Manager ── */}
      <div style={heading}>Share links</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {shares.length === 0 ? (
          <div style={empty}>
            No share links created from this device. ABS provides no way to list shares, so links created on the web client or another device aren't shown here.
          </div>
        ) : shares.map(s => (
          <div key={s.id} style={card}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: 'var(--onyx-text)' }}>{s.title}</div>
              <div style={sub}>
                {publicShareUrl(st.serverUrl, s.slug)}
                {s.expiresAt ? ` · expires ${new Date(s.expiresAt).toLocaleDateString()}` : ' · never expires'}
                {s.isDownloadable ? ' · downloadable' : ''}
              </div>
            </div>
            <button onClick={() => void copy(publicShareUrl(st.serverUrl, s.slug), st, 'Share link')} style={ghostBtn}>Copy</button>
            <button onClick={() => revokeShare(s)} disabled={busyId === s.id} style={dangerBtn}>Revoke</button>
          </div>
        ))}
      </div>

      {/* ── RSS Feed Manager ── */}
      <div style={heading}>Open RSS feeds</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {feedsLoading ? (
          <div style={empty}>Loading…</div>
        ) : feeds.length === 0 ? (
          <div style={empty}>No open feeds. Open one from an item's Share &amp; Publish menu.</div>
        ) : feeds.map(f => (
          <div key={f.id} style={card}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: 'var(--onyx-text)' }}>{f.meta?.title || f.slug}</div>
              <div style={sub}>{f.entityType} · {absoluteFeedUrl(f.serverAddress, f.feedUrl, st.serverUrl)}</div>
            </div>
            <button onClick={() => void copy(absoluteFeedUrl(f.serverAddress, f.feedUrl, st.serverUrl), st, 'Feed URL')} style={ghostBtn}>Copy</button>
            <button onClick={() => close(f)} disabled={busyId === f.id} style={dangerBtn}>Close</button>
          </div>
        ))}
      </div>

      {/* ── OPDS (informational) ── */}
      <div style={heading}>OPDS</div>
      <div style={empty}>
        Audiobookshelf does not expose an OPDS catalog endpoint, so there is nothing to manage here. If your deployment serves OPDS through a separate add-on, point your OPDS reader at that URL directly.
      </div>
    </div>
  );
}
