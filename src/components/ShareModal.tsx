import { useState, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import ReactDOM from 'react-dom';
import type { LibraryItem, OnyxState } from '../state/onyx';
import {
  createShare, deleteShare, getFeeds, openFeed, closeFeed, fetchItem, getItemShare,
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
  // Inline error shown within the share section (a toast would sit behind the
  // modal's blurred backdrop, out of view). Cleared on a new attempt / slug edit.
  const [shareError, setShareError] = useState<string | null>(null);

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

  // On open, ask the server whether this item already has a share. ABS exposes it
  // via GET /api/items/:id?include=share (admin + book only) — the one way to
  // recover a share by item. This shows links created on the web client or lost
  // from local tracking, and re-tracks them so they also list in Settings.
  useEffect(() => {
    if (!canShare) return;
    let cancelled = false;
    getItemShare(st.serverUrl, item.id)
      .then(existing => {
        console.log('[ShareModal] getItemShare result:', existing);
        if (cancelled || !existing) return;
        const tracked: TrackedShare = {
          id: existing.id,
          slug: existing.slug,
          libraryItemId: item.id,
          mediaItemId: existing.mediaItemId,
          mediaItemType: existing.mediaItemType || 'book',
          title,
          isDownloadable: existing.isDownloadable,
          expiresAt: existing.expiresAt ? (Date.parse(existing.expiresAt) || null) : null,
          createdAt: existing.createdAt ? (Date.parse(existing.createdAt) || Date.now()) : Date.now(),
        };
        addTrackedShare(tracked);
        setShare(tracked);
      })
      .catch(e => console.error('[ShareModal] getItemShare failed:', e));
    return () => { cancelled = true; };
  }, [canShare, st.serverUrl, item.id, title]);

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
    setShareError(null);
    const s = slug.trim();
    if (!s) { setShareError('A slug is required.'); return; }
    if (!mediaId) { setShareError('Could not resolve this item’s media id.'); return; }
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
      const msg = String(e);
      // ABS returns HTTP 409 "Item is already shared" when a share exists for this
      // book. It exposes no way to look up that share by item (only by its slug,
      // which we don't have when the share isn't tracked locally), so Skald can't
      // retrieve or display the existing link — surface a clear, actionable note
      // inline (a toast would be hidden behind the modal's blurred backdrop).
      if (/already shared/i.test(msg) || /\b409\b/.test(msg)) {
        setShareError('This book is already shared on the server, but Skald doesn’t have the link locally (it was created elsewhere or in an earlier session). Audiobookshelf can’t look up an existing share by item — revoke it from the Audiobookshelf web app, then create a new link here.');
      } else {
        setShareError(`Create share failed: ${msg}`);
      }
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
  const input: CSSProperties = { padding: '9px 12px', background: 'rgba(0,0,0,0.3)', borderRadius: 8, color: 'var(--onyx-text)', border: '1px solid var(--onyx-glass-edge)', outline: 'none', fontSize: 12.5, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' };
  const primaryBtn: CSSProperties = { padding: '9px 18px', borderRadius: 8, cursor: 'pointer', background: 'var(--onyx-accent)', border: 'none', color: 'var(--onyx-bg)', fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' };
  const ghostBtn: CSSProperties = { padding: '9px 14px', borderRadius: 8, cursor: 'pointer', background: 'var(--onyx-accent-dim)', border: '1px solid var(--onyx-accent-edge)', color: 'var(--onyx-accent)', fontFamily: MONO, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' };
  const dangerBtn: CSSProperties = { padding: '9px 14px', borderRadius: 8, cursor: 'pointer', background: 'rgba(220,80,80,0.12)', border: '1px solid rgba(220,80,80,0.35)', color: '#e08a8a', fontFamily: MONO, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' };

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
      style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <div style={{ width: '100%', maxWidth: 560, maxHeight: '90vh', background: 'var(--onyx-panel)', border: '1px solid var(--onyx-glass-edge)', borderRadius: 16, boxShadow: '0 40px 100px rgba(0,0,0,0.72), 0 0 0 1px rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.06), inset 0 1px 0 rgba(255,255,255,0.04)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ flexShrink: 0, padding: '20px 20px 0 22px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: SERIF, fontSize: 19, fontWeight: 500, letterSpacing: '-0.015em', lineHeight: 1.1 }}>Share &amp; Publish</div>
            <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em', marginTop: 6 }}>{title}</div>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 7, background: 'none', border: '1px solid transparent', color: 'var(--onyx-text-mute)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, lineHeight: 1, flexShrink: 0, marginTop: 1, transition: 'background 0.12s, border-color 0.12s, color 0.12s' }} onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.borderColor = 'var(--onyx-line)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.borderColor = 'transparent'; }}>✕</button>
        </div>
        <div style={{ flexShrink: 0, height: 1, background: 'var(--onyx-line)', margin: '14px 0 0' }} />

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 22 }}>
          {/* ── Public share link ── */}
          <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontFamily: SERIF, fontSize: 16, fontWeight: 500, color: 'var(--onyx-text)', letterSpacing: '-0.01em' }}>Public share link</div>
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
                  <input value={slug} onChange={e => { setSlug(e.target.value); setShareError(null); }} style={{ ...input, fontFamily: MONO }} placeholder="my-book" />
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
                {/* Inline error (e.g. 409 already-shared) — shown in-section so it
                    isn't hidden behind the modal's blurred backdrop like a toast. */}
                {shareError && (
                  <div style={{
                    fontSize: 12, lineHeight: 1.5, color: '#e08a8a',
                    background: 'rgba(220,80,80,0.1)', border: '1px solid rgba(220,80,80,0.3)',
                    borderRadius: 8, padding: '10px 12px',
                  }}>
                    {shareError}
                  </div>
                )}
              </>
            )}
          </section>

          <div style={{ borderTop: '1px solid var(--onyx-line)' }} />

          {/* ── RSS feed ── */}
          <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontFamily: SERIF, fontSize: 16, fontWeight: 500, color: 'var(--onyx-text)', letterSpacing: '-0.01em' }}>RSS feed</div>
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
