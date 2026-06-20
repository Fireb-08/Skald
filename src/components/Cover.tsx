import { useState, useEffect, type CSSProperties } from 'react';
// convertFileSrc turns an absolute disk path into an asset:// URL that WebView2
// can fetch directly through Tauri's asset protocol.
import { convertFileSrc } from '@tauri-apps/api/core';
import type { LibraryItem } from '../state/onyx';
import { bookPalette, bookTpl, bookTitle, bookAuthor, bookSeries } from '../state/onyx';
import { getCover, getLocalCover, cacheRemoteImage } from '../api/abs';
import { subscribeCover } from '../lib/coverBust';

export interface CoverProps {
  item: LibraryItem;
  size?: number;
  scale?: number;
  fill?: boolean;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
  serverUrl?: string;
  // Remote image URL to use when the ABS server cover is unavailable, before
  // falling back to the generated template. Podcasts pass their feed artwork
  // (media.metadata.imageUrl) here so tiles show real cover art.
  fallbackImageUrl?: string;
}

export default function Cover({ item, size = 180, scale = 1, fill = false, className, style, onClick, serverUrl, fallbackImageUrl }: CoverProps) {
  const [coverSrc, setCoverSrc] = useState<string | null>(null);
  // Bumped when this item's cover changes (via the coverBust registry) to force
  // a re-fetch of the cleared cache and a fresh ?v token on the <img> src.
  const [bust, setBust] = useState(0);

  useEffect(() => subscribeCover(item.id, () => setBust(b => b + 1)), [item.id]);

  useEffect(() => {
    let cancelled = false;
    // Remote fallback (podcast feed art the ABS server doesn't store): cache the
    // bytes to disk once, then render from the asset:// path like any other cover.
    // This turns repeated remote <img> loads — the cause of the slow, "uncached"
    // podcast grid — into a one-time fetch. On failure we leave coverSrc null so
    // the raw-URL <img> fallback below still shows something.
    const useRemoteFallback = () => {
      if (!fallbackImageUrl) return;
      cacheRemoteImage(fallbackImageUrl)
        .then(path => { if (!cancelled) setCoverSrc(path); })
        .catch(() => {});
    };
    // Local-library item: load its embedded/sidecar cover from the catalog folder
    // (resized + cached by the backend). Skip when the scan found no cover so we
    // fall through to the remote fallback / generated template — and note this
    // path needs no serverUrl, so it works in standalone mode too.
    if (item.localPath) {
      if (!item.hasLocalCover) { useRemoteFallback(); return () => { cancelled = true; }; }
      getLocalCover(item.id, bust)
        .then(path => { if (!cancelled) setCoverSrc(path); })
        .catch(() => { useRemoteFallback(); });
      return () => { cancelled = true; };
    }
    // No server configured (standalone) — go straight to the remote fallback.
    if (!serverUrl) { useRemoteFallback(); return () => { cancelled = true; }; }
    // get_cover returns an absolute file path; convertFileSrc turns it into an
    // asset:// URL at render. 400px gives ~2× headroom for high-DPI shelves.
    // If the server has no cover (common for older podcast subscriptions), cache
    // the remote feed image instead of re-downloading it on every render.
    getCover(serverUrl, item.id, 400, bust)
      .then(path => { if (!cancelled) setCoverSrc(path); })
      .catch(() => { useRemoteFallback(); });
    return () => { cancelled = true; };
  }, [serverUrl, item.id, item.localPath, item.hasLocalCover, bust, fallbackImageUrl]);

  const [bg, mid, accent] = bookPalette(item);
  const tpl = bookTpl(item);
  const title = bookTitle(item);
  const author = bookAuthor(item);
  const series = bookSeries(item);
  const base: CSSProperties = {
    width: fill ? '100%' : size,
    height: fill ? '100%' : size,
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 4 * scale,
    background: bg,
    color: accent,
    flexShrink: 0,
    boxShadow: '0 1px 2px rgba(0,0,0,.3), 0 4px 16px rgba(0,0,0,.25)',
    fontFamily: '"Source Serif 4", "Iowan Old Style", Georgia, serif',
    cursor: onClick ? 'pointer' : undefined,
    ...style,
  };
  const titleSize = Math.max(11, size * 0.095);
  const authorSize = Math.max(8, size * 0.052);

  if (coverSrc) {
    return (
      <div style={base} className={className} onClick={onClick}>
        {/* convertFileSrc turns the absolute disk path into an asset:// URL WebView2 can load. */}
        {/* loading="lazy" defers offscreen cover fetches until they scroll into view. */}
        <img src={convertFileSrc(coverSrc)} loading="lazy" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} alt={title} />
      </div>
    );
  }

  // No server cover — use the remote feed artwork (podcasts) before the
  // generated template. Loaded directly over HTTPS, not via the asset protocol.
  if (fallbackImageUrl) {
    return (
      <div style={base} className={className} onClick={onClick}>
        <img src={fallbackImageUrl} loading="lazy" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} alt={title} />
      </div>
    );
  }

  if (tpl === 'split') {
    return (
      <div style={base} className={className} onClick={onClick}>
        <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(155deg, ${mid} 0%, ${bg} 70%)` }} />
        <div style={{ position: 'absolute', left: '8%', right: '8%', top: '10%', fontSize: authorSize, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.75, fontFamily: 'ui-sans-serif, system-ui' }}>{author}</div>
        <div style={{ position: 'absolute', left: '8%', right: '8%', bottom: '12%', fontSize: titleSize, fontWeight: 700, lineHeight: 1.05 }}>{title}</div>
        <div style={{ position: 'absolute', left: '8%', bottom: '8%', width: '20%', height: 2, background: accent, opacity: 0.8 }} />
      </div>
    );
  }
  if (tpl === 'rule') {
    return (
      <div style={base} className={className} onClick={onClick}>
        <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(120% 80% at 50% 0%, ${mid} 0%, ${bg} 75%)` }} />
        <div style={{ position: 'absolute', left: '10%', right: '10%', top: '15%', fontSize: titleSize * 1.05, fontWeight: 700, lineHeight: 1.0, textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.01em' }}>{title}</div>
        <div style={{ position: 'absolute', left: '30%', right: '30%', top: '58%', height: 1, background: accent }} />
        <div style={{ position: 'absolute', left: '10%', right: '10%', top: '62%', fontSize: authorSize, textAlign: 'center', letterSpacing: '0.18em', textTransform: 'uppercase', opacity: 0.85, fontFamily: 'ui-sans-serif, system-ui' }}>{author}</div>
      </div>
    );
  }
  if (tpl === 'numeral') {
    const num = (series?.match(/\d+/) ?? ['I'])[0];
    return (
      <div style={base} className={className} onClick={onClick}>
        <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, ${bg} 0%, ${mid} 100%)` }} />
        <div style={{ position: 'absolute', left: '-5%', top: '-8%', fontSize: size * 0.95, fontWeight: 900, color: accent, opacity: 0.25, fontFamily: 'Georgia, serif', lineHeight: 0.85 }}>{num}</div>
        <div style={{ position: 'absolute', left: '10%', right: '10%', bottom: '18%', fontSize: titleSize, fontWeight: 700, lineHeight: 1.05 }}>{title}</div>
        <div style={{ position: 'absolute', left: '10%', right: '10%', bottom: '10%', fontSize: authorSize, opacity: 0.7, fontFamily: 'ui-sans-serif, system-ui', letterSpacing: '0.06em' }}>{author}</div>
      </div>
    );
  }
  if (tpl === 'pattern') {
    const stripes = `repeating-linear-gradient(45deg, ${mid} 0px, ${mid} 6px, ${bg} 6px, ${bg} 14px)`;
    return (
      <div style={base} className={className} onClick={onClick}>
        <div style={{ position: 'absolute', inset: 0, background: stripes, opacity: 0.7 }} />
        <div style={{ position: 'absolute', left: '8%', right: '8%', top: '40%', bottom: '20%', background: bg, border: `1.5px solid ${accent}`, padding: '6%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div style={{ fontSize: titleSize, fontWeight: 700, lineHeight: 1.05 }}>{title}</div>
          <div style={{ fontSize: authorSize, fontFamily: 'ui-sans-serif, system-ui', opacity: 0.75, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{author}</div>
        </div>
      </div>
    );
  }
  return (
    <div style={base} className={className} onClick={onClick}>
      <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(155deg, ${mid}, ${bg})` }} />
      <div style={{ position: 'absolute', left: '10%', right: '10%', top: '40%', fontSize: titleSize, fontWeight: 600 }}>{title}</div>
    </div>
  );
}
