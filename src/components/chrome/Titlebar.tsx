import type { CSSProperties, ReactNode } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import lyreIcon from '../../assets/lyre.png';

export interface TitlebarProps {
  subtitle?: string;
  isDark: boolean;
  // When true, only "SKALD" is shown — no theme name or subtitle.
  minimal?: boolean;
  // Optional controls rendered in the left cluster, just right of the app-name
  // and status pills (e.g. the Recent-activity bell). Interactive children must
  // opt out of the drag region themselves (WebkitAppRegion: 'no-drag').
  trailing?: ReactNode;
  // True when the library was loaded from the disk cache (server unreachable).
  // Displays a persistent amber OFFLINE pill so the user always knows they are
  // browsing cached data rather than a live server connection.
  isOffline?: boolean;
  lastRefresh?: number | null;
  // True when the configured ABS server URL is plain http: (review L6). LAN
  // HTTP is a legitimate self-hosted setup, so this only surfaces the missing
  // transport encryption — it never blocks the connection.
  isUnencrypted?: boolean;
}

type DragStyle = CSSProperties & { WebkitAppRegion?: string };

const BUTTONS = [
  { label: 'Minimize', kind: 'min' },
  { label: 'Maximize', kind: 'max' },
  { label: 'Close', kind: 'close' },
] as const;

function WindowControlIcon({ kind }: { kind: (typeof BUTTONS)[number]['kind'] }) {
  // Stroke icons keep the native-looking visual weight without relying on
  // Segoe MDL2 Assets, which is absent on Linux.
  if (kind === 'min') {
    return <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12"><path d="M2 8.5h8" /></svg>;
  }
  if (kind === 'max') {
    return <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12"><rect x="2.25" y="2.25" width="7.5" height="7.5" /></svg>;
  }
  return <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12"><path d="m2.5 2.5 7 7m0-7-7 7" /></svg>;
}

const HANDLERS: Record<string, () => void> = {
  min:   () => { void getCurrentWindow().minimize(); },
  max:   () => { void getCurrentWindow().toggleMaximize(); },
  close: () => { void getCurrentWindow().close(); },
};

export default function Titlebar({ subtitle, isDark, minimal, isOffline, lastRefresh, isUnencrypted, trailing }: TitlebarProps) {
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
          {minimal ? 'Skald' : `Skald · ${themeName}${subtitle ? ` · ${subtitle}` : ''}`}
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
            offline{lastRefresh ? ` · refreshed ${new Date(lastRefresh).toLocaleString()}` : ''}
          </div>
        )}
        {/* Transport-encryption indicator (review L6) — same amber family as
            OFFLINE. Plain-HTTP ABS servers are fine on a trusted LAN, but the
            traffic (including media tokens in URLs) is readable on the network;
            the pill keeps that visible without forbidding the setup. */}
        {isUnencrypted && (
          <div
            title="Connected over plain HTTP — traffic to your server (including media tokens) is not encrypted. Fine on a trusted home network; use an https:// address to encrypt."
            style={{
              fontFamily: mono,
              fontSize: 9,
              letterSpacing: '0.12em',
              textTransform: 'uppercase' as const,
              color: '#d4834a',
              border: '1px solid rgba(212,131,74,0.4)',
              borderRadius: 4,
              padding: '2px 6px',
              background: 'rgba(212,131,74,0.08)',
              lineHeight: 1,
            }}>
            not encrypted
          </div>
        )}
        {/* Optional trailing controls (e.g. Recent activity) sit just right of the
            status pills. Rendered inside the left cluster so they follow the app
            name rather than crowding the window buttons. */}
        {trailing}
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
              cursor: 'pointer', padding: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <WindowControlIcon kind={b.kind} />
          </button>
        ))}
      </div>
    </div>
  );
}
