import type { CSSProperties, ReactNode } from 'react';
import type { OnyxState } from '../../state/onyx';
import { bookDurSecs } from '../../state/onyx';
import type { LibraryItem } from '../../state/onyx';
import TopNav from '../chrome/TopNav';
import ViewModeToggle from './ViewModeToggle';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';

export interface BrowseViewProps {
  st: OnyxState;
  title?: string;
  subtitle?: string;
  showModeToggle?: boolean;
  children?: ReactNode;
  inline?: boolean;
  /** Slot for the ShelfTabs component — wired up in the shelf step. */
  shelfTabsSlot?: ReactNode;
}

export default function BrowseView({
  st, title, subtitle, showModeToggle = false, children, inline = false, shelfTabsSlot: _shelfTabsSlot,
}: BrowseViewProps) {
  if (inline) {
    return (
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0, paddingRight: 4 }}>
        {children}
      </div>
    );
  }
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 18, padding: '8px 24px 24px', minWidth: 0, minHeight: 0 }}>
      <TopNav st={st} />
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0, paddingRight: 4 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', padding: '12px 4px 20px', gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {title && <div style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 500, letterSpacing: '-0.015em' }}>{title}</div>}
            {subtitle && <div style={{ fontSize: 13, color: 'var(--onyx-text-dim)', marginTop: 4 }}>{subtitle}</div>}
          </div>
          {showModeToggle && <ViewModeToggle st={st} />}
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Style helpers used by SeriesView / AuthorsView / etc. ────────────────────

export function posterTile(): CSSProperties {
  return {
    display: 'flex', flexDirection: 'column', padding: 0,
    background: 'var(--onyx-glass)', border: '1px solid var(--onyx-glass-edge)',
    borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit', color: 'inherit',
    textAlign: 'left', overflow: 'hidden',
    // Shadows are deliberately not interpolated: blur/shadow animation paints
    // every frame. The lift stays smooth while the visual shadow switches once.
    transition: 'transform 0.15s, border-color 0.15s',
  };
}

export function browseTile(): CSSProperties {
  return {
    display: 'flex', gap: 14, padding: 14,
    background: 'var(--onyx-glass)', border: '1px solid var(--onyx-glass-edge)',
    borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', color: 'inherit',
    textAlign: 'left', alignItems: 'center',
  };
}

// ─── Shared helper used by SeriesView / AuthorsView / etc. ────────────────────

export function seriesTotalDur(books: LibraryItem[]): string {
  let total = 0;
  for (const b of books) total += bookDurSecs(b);
  const h = Math.floor(total / 3600);
  return `${h}H`;
}
