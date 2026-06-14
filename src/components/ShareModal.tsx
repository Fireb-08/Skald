import { useState, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import ReactDOM from 'react-dom';
import type { LibraryItem, OnyxState } from '../state/onyx';
import {
  createShare, deleteShare, getFeeds, openFeed, closeFeed, fetchItem,
  type MediaItemShare, type RssFeed,
} from '../api/abs';
import {
  addTrackedShare, removeTrackedShare, findTrackedShareForItem, suggestSlug, publicBase, absoluteFeedUrl,
  type TrackedShare,
} from '../lib/shareTracker';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const MONO  = "'JetBrains Mono', ui-monospace, monospace";

export interface ShareModalProps {
  item: LibraryItem;
  st: OnyxState;
  onClose: () => void;
}

// Expiry presets for a share link. `null` here means "never"; it is sent to ABS
// as 0, NOT null — ShareController validates `expiresAt === null` as an error and
// stores `expiresAt || null`, so 0 is the wire value that yields a never-expiring
// share. A positive value is `Date.now() + ms`.
const EXPIRY_OPTIONS: Array<{ label: string; ms: number | null }> = [
  { label: 'Never',   ms: null },
  { label: '1 day',   ms: 24 * 60 * 60 * 1000 },
  { label: '7 days',  ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '30 days', ms: 30 * 24 * 60 * 60 * 1000 },
];

/** Build the public share URL from the configured public base (or server) + slug. */
function shareUrl(serverUrl: string, slug: string): string {
  return `${publicBase(serverUrl)}/share/${slug}`;
}

async function copy(text: string, st: OnyxState, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    st.setToast({ message: `${label} copied to clipboard`, type: 'success' });
  } catch {
    // Clipboard can be blocked; surface the URL so the user can copy manually.
    st.setToast({ message: `Copy failed — ${text}`, type: 'info' });
  }
}

/**
 * Per-item Share & Publish modal (cluster G, admin-only). Two independent blocks:
 *  - a public share link (POST /api/share/mediaitem) — book items only, since a
 *    share's mediaItemType must be "book" | "podcastEpisode" and the context menu
 *    targets the library item, not an episode;
 *  - an RSS feed for the item (POST /api/feeds/item/:id/open) — books or podcasts.
 * Both surface a copyable public URL and a revoke/close action.
 */
export default function ShareModal({ item, st, onClose }: ShareModalProps) {
  const title = item.media?.metadata?.title ?? item.id;
  const canShare = item.mediaType === 'book'; // podcast-episode shares not yet supported

  // ── Share-link state ──────────────────────────────────────────────────────
  const [share, setShare] = useState<TrackedShare | null>(() => findTrackedShareForItem(item.id) ?? null);
  // The share target is the Book record id (item.media.id), NOT the LibraryItem
  // id — ABS validates mediaItemId against the bookModel. Resolve from the item
  // in hand, falling back to a full fetch if the minified shape omitted it.
  const [mediaId, setMediaId] = useState<string | null>(() => item.media?.id ?? null);
  const [slug, setSlug] = useState(() => suggestSlug(title));
  const [expiryIdx, setExpiryIdx] = useState(0);
  const [downloadable, setDownloadable] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);

  // ── RSS-feed state ────────────────────────────────────────────────────────
  const [feed, setFeed] = useState<RssFeed | null>(null);
  const [feedSlug, setFeedSlug] = useState(() => suggestSlug(title));
  const [feedBusy, setFeedBusy] = useState(false);
  const [feedLoading, setFeedLoading] = useState(true);

  // Resolve the Book record id if the item we were handed lacks media.id.
  useEffect(() => {
    if (mediaId || !canShare) return;
    let cancelled = false;
    fetchItem(st.serverUrl, item.id)
      .then(full => {
        if (cancelled) return;
        setMediaId(full.media?.id ?? null);
      })
      .catch(e => console.error('[ShareModal] media.id resolve failed:', e));
    return () => { cancelled = true; };
  }, [mediaId, canShare, st.serverUrl, item.id]);

  // On open, look up an existing open feed for this item (no per-item route, so
  // we list all feeds and match on entityId).
  useEffect(() => {
    let cancelled = false;
    getFeeds(st.serverUrl)
      .then(feeds => {
        if (cancelled) return;
        setFeed(feeds.find(f => f.entityId === item.id) ?? null);
      })
      .catch(e => console.error('[ShareModal] feed lookup failed:', e))
      .finally(() => { if (!cancelled) setFeedLoading(false); });
    return () => { cancelled = true; };
  }, [st.serverUrl, item.id]);

  const doCreateShare = useCallback(async () => {
    const s = slug.trim();
    if (!s) { st.setToast({ message: 'A slug is required.', type: 'error' }); return; }
    if (!mediaId) { st.setToast({ message: 'Could not resolve this item’s media id.', type: 'error' }); return; }
    setShareBusy(true);
    try {
      const ms = EXPIRY_OPTIONS[expiryIdx].ms;
      // ABS rejects null and treats 0 as "never" (stored as null). Send 0 for the
      // never option; track null locally so the UI shows "never expires".
      const expiresAt = ms === null ? 0 : Date.now() + ms;
      // mediaItemId is the Book record id, not the LibraryItem id.
      const created: MediaItemShare = await createShare(st.serverUrl, s, 'book', mediaId, expiresAt, downloadable);
      const tracked: TrackedShare = {
        id: created.id, slug: created.slug, libraryItemId: item.id, mediaItemId: mediaId,
        mediaItemType: 'book', title, isDownloadable: created.isDownloadable,
        expiresAt: ms === null ? null : expiresAt, createdAt: Date.now(),
      };
      addTrackedShare(tracked);
      setShare(tracked);
      st.setToast({ message: 'Share link created.', type: 'success' });
      void copy(shareUrl(st.serverUrl, created.slug), st, 'Share link');
    } catch (e) {
      st.setToast({ message: `Create share failed: ${String(e)}`, type: 'error' });
    } finally {
      setShareBusy(false);
    }
  }, [slug, mediaId, expiryIdx, downloadable, st, item.id, title]);

  const doRevokeShare = useCallback(() => {
    if (!share) return;
    st.setConfirmDialog({
      title: 'Revoke share link?',
      message: `The public link for "${title}" will stop working immediately.`,
      confirmLabel: 'Revoke',
      onConfirm: async () => {
        setShareBusy(true);
        try {
          await deleteShare(st.serverUrl, share.id);
          removeTrackedShare(share.id);
          setShare(null);
          setSlug(suggestSlug(title));
          st.setToast({ message: 'Share link revoked.', type: 'success' });
        } catch (e) {
          st.setToast({ message: `Revoke failed: ${String(e)}`, type: 'error' });
        } finally {
          setShareBusy(false);
        }
      },
    });
  }, [share, st, title]);

  const doOpenFeed = useCallback(async () => {
    const s = feedSlug.trim();
    if (!s) { st.setToast({ message: 'A feed slug is required.', type: 'error' }); return; }
    setFeedBusy(true);
    try {
      // serverAddress is the public ABS origin the feedUrl is built from — use the
      // configured public base when set so feeds work outside the LAN.
      const opened = await openFeed(st.serverUrl, 'item', item.id, publicBase(st.serverUrl), s);
      setFeed(opened);
      st.setToast({ message: 'RSS feed opened.', type: 'success' });
      void copy(absoluteFeedUrl(opened.serverAddress, opened.feedUrl, st.serverUrl), st, 'Feed URL');
    } catch (e) {
      st.setToast({ message: `Open feed failed: ${String(e)}`, type: 'error' });
    } finally {
      setFeedBusy(false);
    }
  }, [feedSlug, st, item.id]);

  const doCloseFeed = useCallback(() => {
    if (!feed) return;
    st.setConfirmDialog({
      title: 'Close RSS feed?',
      message: `The public feed for "${title}" will stop working immediately.`,
      confirmLabel: 'Close feed',
      onConfirm: async () => {
        setFeedBusy(true);
        try {
          await closeFeed(st.serverUrl, feed.id);
          setFeed(null);
          setFeedSlug(suggestSlug(title));
          st.setToast({ message: 'RSS feed closed.', type: 'success' });
        } catch (e) {
          st.setToast({ message: `Close feed failed: ${String(e)}`, type: 'error' });
        } finally {
          setFeedBusy(false);
        }
      },
    });
  }, [feed, st, title]);

  const label: CSSProperties = { fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--onyx-text-mute)', marginBottom: 5 };
  const input: CSSProperties = { padding: '7px 10px', background: 'var(--onyx-panel2)', borderRadius: 7, color: 'var(--onyx-text)', border: '1px solid var(--onyx-glass-edge)', outline: 'none', fontSize: 12.5, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' };
  const primaryBtn: CSSProperties = { padding: '8px 18px', borderRadius: 8, cursor: 'pointer', background: 'var(--onyx-accent)', border: 'none', color: 'var(--onyx-bg)', fontFamily: MONO, fontSize: 11, fontWeight: 600 };
  const ghostBtn: CSSProperties = { padding: '8px 14px', borderRadius: 8, cursor: 'pointer', background: 'var(--onyx-accent-dim)', border: '1px solid var(--onyx-accent-edge)', color: 'var(--onyx-accent)', fontFamily: MONO, fontSize: 11 };
  const dangerBtn: CSSProperties = { padding: '8px 14px', borderRadius: 8, cursor: 'pointer', background: 'rgba(220,80,80,0.12)', border: '1px solid rgba(220,80,80,0.35)', color: '#e08a8a', fontFamily: MONO, fontSize: 11 };

  // A read-only URL row with a Copy button.
  const UrlRow = ({ url, lbl }: { url: string; lbl: string }) => (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input readOnly value={url} style={{ ...input, fontFamily: MONO, fontSize: 11, color: 'var(--onyx-accent)' }} onFocus={e => e.currentTarget.select()} />
      <button onClick={() => void copy(url, st, lbl)} style={ghostBtn}>Copy</button>
    </div>
  );

  const modal = (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <div style={{ width: '100%', maxWidth: 560, maxHeight: '90vh', background: 'var(--onyx-panel2)', border: '1px solid var(--onyx-line)', borderRadius: 14, boxShadow: '0 32px 80px rgba(0,0,0,0.7)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--onyx-line)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 500 }}>Share &amp; Publish</div>
            <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--onyx-text-mute)', fontSize: 18, padding: 4 }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 22 }}>
          {/* ── Public share link ── */}
          <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontFamily: SERIF, fontSize: 15 }}>Public share link</div>
            {!canShare ? (
              <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', lineHeight: 1.5 }}>
                Share links are available for book items only. Sharing an individual podcast episode is not yet supported.
              </div>
            ) : share ? (
              <>
                <UrlRow url={shareUrl(st.serverUrl, share.slug)} lbl="Share link" />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--onyx-text-mute)' }}>
                    {share.expiresAt ? `Expires ${new Date(share.expiresAt).toLocaleString()}` : 'Never expires'}
                    {share.isDownloadable ? ' · downloadable' : ''}
                  </div>
                  <button onClick={doRevokeShare} disabled={shareBusy} style={dangerBtn}>Revoke</button>
                </div>
              </>
            ) : (
              <>
                <div>
                  <div style={label}>Slug</div>
                  <input value={slug} onChange={e => setSlug(e.target.value)} style={{ ...input, fontFamily: MONO }} placeholder="my-book" />
                </div>
                <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <div style={label}>Expires</div>
                    <select value={expiryIdx} onChange={e => setExpiryIdx(Number(e.target.value))} style={{ ...input, cursor: 'pointer' }}>
                      {EXPIRY_OPTIONS.map((o, i) => <option key={i} value={i}>{o.label}</option>)}
                    </select>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-dim)', cursor: 'pointer', paddingBottom: 8 }}>
                    <input type="checkbox" checked={downloadable} onChange={e => setDownloadable(e.target.checked)} />
                    Allow download
                  </label>
                </div>
                <button onClick={() => void doCreateShare()} disabled={shareBusy || !slug.trim() || !mediaId} style={{ ...primaryBtn, alignSelf: 'flex-start', opacity: shareBusy || !slug.trim() || !mediaId ? 0.6 : 1 }}>
                  {shareBusy ? 'Creating…' : !mediaId ? 'Loading…' : 'Create share link'}
                </button>
              </>
            )}
          </section>

          <div style={{ borderTop: '1px solid var(--onyx-line)' }} />

          {/* ── RSS feed ── */}
          <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontFamily: SERIF, fontSize: 15 }}>RSS feed</div>
            {feedLoading ? (
              <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)' }}>Checking…</div>
            ) : feed ? (
              <>
                <UrlRow url={absoluteFeedUrl(feed.serverAddress, feed.feedUrl, st.serverUrl)} lbl="Feed URL" />
                <button onClick={doCloseFeed} disabled={feedBusy} style={{ ...dangerBtn, alignSelf: 'flex-start' }}>Close feed</button>
              </>
            ) : (
              <>
                <div>
                  <div style={label}>Feed slug</div>
                  <input value={feedSlug} onChange={e => setFeedSlug(e.target.value)} style={{ ...input, fontFamily: MONO }} placeholder="my-feed" />
                </div>
                <button onClick={() => void doOpenFeed()} disabled={feedBusy || !feedSlug.trim()} style={{ ...primaryBtn, alignSelf: 'flex-start', opacity: feedBusy || !feedSlug.trim() ? 0.6 : 1 }}>
                  {feedBusy ? 'Opening…' : 'Open RSS feed'}
                </button>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, document.body);
}
