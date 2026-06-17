import { useEffect, useState, useCallback } from 'react';
import type { CSSProperties } from 'react';
import type { OnyxState } from '../../state/onyx';
import { getFeeds, deleteShare, closeFeed, getShareBySlug, type RssFeed } from '../../api/abs';
import { getTrackedShares, removeTrackedShare, getPublicBaseUrl, setPublicBaseUrl, publicBase, absoluteFeedUrl, type TrackedShare } from '../../lib/shareTracker';
import { SectionHead, MONO, Panel } from './shared';

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

/** The URL rendered as an accent link that copies to the clipboard on click. */
function CopyLink({ url, label, st }: { url: string; label: string; st: OnyxState }) {
  const [hover, setHover] = useState(false);
  return (
    <span
      onClick={() => void copy(url, st, label)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title="Click to copy"
      style={{ color: 'var(--onyx-accent)', cursor: 'pointer', textDecoration: hover ? 'underline' : 'none' }}
    >
      {url}
    </span>
  );
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

  // List locally-tracked shares, then re-validate each against the public share
  // route. Only a CONFIRMED 404 (the share is genuinely gone) purges a record —
  // any other failure (network blip, unexpected response shape) keeps it listed,
  // so a single bad response can never wipe valid local shares.
  const loadShares = useCallback(async () => {
    const tracked = getTrackedShares();
    setShares(tracked); // show immediately; validation only ever removes, never adds
    const checks = await Promise.allSettled(tracked.map(s => getShareBySlug(st.serverUrl, s.slug)));
    let purged = false;
    tracked.forEach((s, i) => {
      const c = checks[i];
      if (c.status === 'rejected' && /\b404\b/.test(String(c.reason))) {
        removeTrackedShare(s.id);
        purged = true;
      }
    });
    if (purged) setShares(getTrackedShares());
  }, [st.serverUrl]);

  const loadFeeds = useCallback(async () => {
    setFeedsLoading(true);
    try {
      setFeeds(await getFeeds(st.serverUrl));
    } catch (e) {
      console.error('[SharingSection] getFeeds failed:', e);
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

  const sub: CSSProperties = { fontFamily: MONO, fontSize: 10.5, color: 'var(--onyx-text-mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 3 };
  const ghostBtn: CSSProperties = { padding: '6px 12px', borderRadius: 7, cursor: 'pointer', background: 'var(--onyx-accent-dim)', border: '1px solid var(--onyx-accent-edge)', color: 'var(--onyx-accent)', fontFamily: MONO, fontSize: 10.5, flexShrink: 0 };
  const dangerBtn: CSSProperties = { padding: '6px 12px', borderRadius: 7, cursor: 'pointer', background: 'rgba(220,80,80,0.12)', border: '1px solid rgba(220,80,80,0.35)', color: '#e08a8a', fontFamily: MONO, fontSize: 10.5, flexShrink: 0 };
  const empty: CSSProperties = { fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', padding: '14px 2px', lineHeight: 1.5 };
  const input: CSSProperties = { padding: '8px 12px', minWidth: 320, fontSize: 13, background: 'rgba(0,0,0,0.3)', borderRadius: 8, color: 'var(--onyx-text)', border: '1px solid var(--onyx-glass-edge)', outline: 'none', fontFamily: MONO };
  // Flat row inside a panel; divider below unless it's the last entry.
  const row = (last: boolean): CSSProperties => ({ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 2px', borderBottom: last ? 'none' : '1px solid var(--onyx-line)' });

  return (
    <div>
      <SectionHead
        title="Sharing & RSS"
        subtitle="Manage public share links and RSS feeds. Create them per item from the library context menu (Share & Publish). These are admin-only server surfaces."
      />

      {/* ── Public link address ── */}
      <Panel label="Public link address">
        <div style={{ padding: '12px 2px 2px' }}>
          <input
            value={pubUrl}
            onChange={e => { setPubUrl(e.target.value); setPublicBaseUrl(e.target.value); }}
            placeholder={st.serverUrl}
            style={input}
          />
          <div style={{ ...empty, padding: '10px 0 2px' }}>
            Share and new RSS feed links are built from this address. Leave blank to use the server URL Skald connects to ({st.serverUrl}). Set it to a public domain (e.g. https://abs.example.com) so links work outside your LAN — your Audiobookshelf server must be reachable there.
          </div>
        </div>
      </Panel>

      {/* ── Share Manager ── */}
      <Panel label="Share links">
        {shares.length === 0 ? (
          <div style={empty}>
            No share links created from this device. ABS provides no way to list shares, so links created on the web client or another device aren't shown here.
          </div>
        ) : shares.map((s, i) => (
          <div key={s.id} style={row(i === shares.length - 1)}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: 'var(--onyx-text)' }}>{s.title}</div>
              <div style={sub}>
                <CopyLink url={publicShareUrl(st.serverUrl, s.slug)} label="Share link" st={st} />
                {s.expiresAt ? ` · expires ${new Date(s.expiresAt).toLocaleDateString()}` : ' · never expires'}
                {s.isDownloadable ? ' · downloadable' : ''}
              </div>
            </div>
            <button onClick={() => void copy(publicShareUrl(st.serverUrl, s.slug), st, 'Share link')} style={ghostBtn}>Copy</button>
            <button onClick={() => revokeShare(s)} disabled={busyId === s.id} style={dangerBtn}>Revoke</button>
          </div>
        ))}
      </Panel>

      {/* ── RSS Feed Manager ── */}
      <Panel label="Open RSS feeds">
        {feedsLoading ? (
          <div style={empty}>Loading…</div>
        ) : feeds.length === 0 ? (
          <div style={empty}>No open feeds. Open one from an item's Share &amp; Publish menu.</div>
        ) : feeds.map((f, i) => (
          <div key={f.id} style={row(i === feeds.length - 1)}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: 'var(--onyx-text)' }}>{f.meta?.title || f.slug}</div>
              <div style={sub}>{f.entityType} · <CopyLink url={absoluteFeedUrl(f.serverAddress, f.feedUrl, st.serverUrl)} label="Feed URL" st={st} /></div>
            </div>
            <button onClick={() => void copy(absoluteFeedUrl(f.serverAddress, f.feedUrl, st.serverUrl), st, 'Feed URL')} style={ghostBtn}>Copy</button>
            <button onClick={() => close(f)} disabled={busyId === f.id} style={dangerBtn}>Close</button>
          </div>
        ))}
      </Panel>
    </div>
  );
}
