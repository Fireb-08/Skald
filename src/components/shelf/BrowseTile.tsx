import type { CSSProperties, ReactNode } from 'react';
import type { LibraryItem } from '../../state/onyx';
import CoverFan from './CoverFan';
import CoverMosaic from './CoverMosaic';
import { posterTile } from './BrowseView';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const MONO = "'JetBrains Mono', ui-monospace, monospace";

export interface BrowseTileProps {
  /** Design language: 'stack' = fanned covers + text below; 'mosaic' = 2×2 quilt
   *  with the name on an overlaid bottom band. Driven by st.browseTileStyle. */
  mode: 'stack' | 'mosaic';
  /** Entity type label shown as a small badge over the art (e.g. "Series"). */
  tag: string;
  title: string;
  subtitle?: string;
  /** Footer stat line, e.g. "5 VOLUMES · 154H" or "12 TITLES". */
  stat: string;
  books: LibraryItem[];
  serverUrl?: string;
  onClick: () => void;
  /** Optional top-right overlay (e.g. the collection "Manage" button). */
  corner?: ReactNode;
  /** Placeholder text when there are no covers to show. */
  emptyLabel?: string;
}

const TAG_STYLE: CSSProperties = {
  position: 'absolute', top: 8, left: 8, zIndex: 3,
  padding: '3px 8px', borderRadius: 5,
  // No backdrop-filter (see Glass.tsx) — the tag sits on cover art inside a
  // scrolling panel; a slightly more opaque fill replaces the 4px blur for
  // legibility without a live backdrop sample.
  background: 'rgba(8,8,11,0.82)', border: '1px solid var(--onyx-glass-edge)',
  color: 'var(--onyx-text-dim)', fontFamily: MONO, fontSize: 9,
  letterSpacing: '0.12em', textTransform: 'uppercase',
};

const EMPTY_ART: CSSProperties = {
  height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: 'var(--onyx-text-mute)', fontFamily: SERIF, fontStyle: 'italic', fontSize: 14,
  background: 'linear-gradient(180deg, rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.06), rgba(0,0,0,0.12))',
};

export default function BrowseTile({ mode, tag, title, subtitle, stat, books, serverUrl, onClick, corner, emptyLabel }: BrowseTileProps) {
  const hasArt = books.length > 0;
  const art = !hasArt
    ? <div style={{ ...EMPTY_ART, ...(mode === 'mosaic' ? { borderBottom: 'none' } : { borderBottom: '1px solid var(--onyx-line)' }) }}>{emptyLabel ?? '—'}</div>
    : mode === 'stack'
      ? <CoverFan books={books.slice(0, 5)} serverUrl={serverUrl} />
      : <CoverMosaic books={books} serverUrl={serverUrl} />;

  // ── Mosaic: quilt fills the card; name/subtitle/stat sit on an overlaid band ──
  if (mode === 'mosaic') {
    return (
      <button onClick={onClick} className="onyx-poster" style={{ ...posterTile(), position: 'relative' }}>
        {corner && <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 4 }}>{corner}</div>}
        <div style={{ position: 'relative' }}>
          <div style={TAG_STYLE}>{tag}</div>
          {art}
          <div style={{
            position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 2,
            padding: '34px 14px 12px',
            background: 'linear-gradient(180deg, transparent, rgba(8,8,11,0.55) 32%, rgba(8,8,11,0.9))',
          }}>
            <div style={{ fontFamily: SERIF, fontSize: 20, fontWeight: 500, lineHeight: 1.1, letterSpacing: '-0.01em', color: 'var(--onyx-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12.5, color: 'var(--onyx-text-dim)', marginTop: 3, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</div>}
            <div style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--onyx-text-mute)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 8 }}>{stat}</div>
          </div>
        </div>
      </button>
    );
  }

  // ── Stack: fanned covers, then a centered text block below the art ──
  return (
    <button onClick={onClick} className="onyx-poster" style={{ ...posterTile(), position: 'relative' }}>
      {corner}
      <div style={{ position: 'relative' }}>
        <div style={TAG_STYLE}>{tag}</div>
        {art}
      </div>
      <div style={{ padding: '18px 16px 16px', textAlign: 'center' }}>
        <div style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 500, lineHeight: 1.1, color: 'var(--onyx-text)', letterSpacing: '-0.01em' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 13, color: 'var(--onyx-text-dim)', marginTop: 6, fontStyle: 'italic' }}>{subtitle}</div>}
        <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--onyx-line)' }}>{stat}</div>
      </div>
    </button>
  );
}
