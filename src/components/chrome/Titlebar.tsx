import type { CSSProperties } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import lyreIcon from '../../assets/lyre.png';

export interface TitlebarProps {
  subtitle?: string;
  isDark: boolean;
  // True when the library was loaded from the disk cache (server unreachable).
  // Displays a persistent amber OFFLINE pill so the user always knows they are
  // browsing cached data rather than a live server connection.
  isOffline?: boolean;
}

type DragStyle = CSSProperties & { WebkitAppRegion?: string };

const BUTTONS = [
  { glyph: '–',      label: 'Minimize', kind: 'min',   font: undefined },
  { glyph: '', label: 'Maximize', kind: 'max',   font: '"Segoe MDL2 Assets", "Segoe Fluent Icons"' },
  { glyph: '✕',      label: 'Close',    kind: 'close', font: undefined },
] as const;

const HANDLERS: Record<string, () => void> = {
  min:   () => { void getCurrentWindow().minimize(); },
  max:   () => { void getCurrentWindow().toggleMaximize(); },
  close: () => { void getCurrentWindow().close(); },
};

export default function Titlebar({ subtitle, isDark, isOffline }: TitlebarProps) {
  const themeName = isDark ? 'Onyx' : 'Folio';
  const mono = "'JetBrains Mono', ui-monospace, monospace";

  const bar: DragStyle = {
    position: 'absolute', top: 0, left: 0, right: 0, height: 44,
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '0 18px', zIndex: 50,
    WebkitAppRegion: 'drag',
  };

  const noDrag: DragStyle = {
    display: 'flex', gap: 0,
    WebkitAppRegion: 'no-drag',
    marginRight: -18, height: 44,
  };

  return (
    <div style={bar} data-tauri-drag-region>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* Lyre logo mark — transparent PNG sits cleanly against the dark titlebar */}
        <img
          src={lyreIcon}
          alt="Skald"
          style={{
            width: 20,
            height: 20,
            objectFit: 'contain',
            // Slight brightness boost so the gold reads clearly at small size
            filter: 'brightness(1.1)',
          }}
        />
        {/* App name + optional theme/subtitle */}
        <div style={{ fontFamily: mono, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          Skald · {themeName}{subtitle ? ` · ${subtitle}` : ''}
        </div>
        {/* Offline indicator — shown when the library loaded from disk cache.
            Amber pill gives the user a persistent signal that they are in offline mode. */}
        {isOffline && (
          <div style={{
            fontFamily: mono,
            fontSize: 9,
            letterSpacing: '0.12em',
            textTransform: 'uppercase' as const,
            color: '#d4834a',                       // amber warning tone
            border: '1px solid rgba(212,131,74,0.4)',
            borderRadius: 4,
            padding: '2px 6px',
            background: 'rgba(212,131,74,0.08)',
            lineHeight: 1,
          }}>
            offline
          </div>
        )}
      </div>
      <div style={noDrag}>
        {BUTTONS.map((b) => (
          <button
            key={b.kind}
            className={`onyx-winbtn onyx-winbtn-${b.kind}`}
            title={b.label}
            onClick={HANDLERS[b.kind]}
            data-tauri-drag-region="false"
            style={{
              width: 46, height: 44, borderRadius: 0,
              background: 'transparent', border: 'none',
              color: 'var(--onyx-text-dim)',
              fontSize: b.kind === 'max' ? 11 : 16, lineHeight: 1,
              cursor: 'pointer', padding: 0,
              fontFamily: b.font ?? "'Segoe UI', system-ui, -apple-system, sans-serif",
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >{b.glyph}</button>
        ))}
      </div>
    </div>
  );
}
