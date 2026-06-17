// SyncSection — settings pane for controlling how Skald synchronises with the server.
//
// Phase A: toggle + WIP badge (cosmetic only).
// Phase B: toggle wired to the real Rust Socket.IO connect/disconnect commands.
// Phase G: live connection indicator, graceful degradation on persistent failure,
//          WIP badge removed now that all sync phases are complete.

import { useState, useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { SectionHead, Row, Toggle, useLocal, MONO } from './shared';
import type { OnyxState } from '../../state/onyx';
import { connectSocket, disconnectSocket } from '../../api/abs';

// Connection state for the live indicator dot.
// 'off'          — toggle is disabled or socket has never connected this session.
// 'connected'    — socket-authenticated received; ABS is dispatching events.
// 'reconnecting' — socket-disconnected fired unexpectedly; the library is
//                  rebuilding the transport (normal after a network blip or sleep/wake).
type ConnectionStatus = 'off' | 'connected' | 'reconnecting';

export interface SyncSectionProps {
  // OnyxState supplies serverUrl, authToken (for connect) and setToast (for errors).
  st: OnyxState;
  /** When true, render only the live-sync row (no SectionHead) for embedding
   *  under the Server panel. */
  embedded?: boolean;
}

export default function SyncSection({ st, embedded = false }: SyncSectionProps) {
  // Live-sync toggle preference — persisted to 'onyx.sync.live' in localStorage.
  // Read by App.tsx and AccountSection to restore the connection on startup.
  const [liveSync, setLiveSync] = useLocal<boolean>('onyx.sync.live', false);

  // Tracks the user's current *intent* synchronously so the socket-disconnected
  // listener can tell apart an intentional teardown (the user clicked the toggle
  // off — intent is already false) from an unintentional network drop (intent
  // is still true). Updated before any async operations in handleToggle.
  const liveSyncIntentRef = useRef(liveSync);

  // Visible connection indicator state — drives the dot colour and label.
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('off');

  // Error-tracking refs for the graceful-degradation logic (Part 2).
  // We use refs (not state) because incrementing error counts should not
  // trigger a re-render — only reaching the threshold causes a visible change.
  const errorCountRef     = useRef(0);
  const firstErrorTimeRef = useRef<number | null>(null);

  // ── Socket lifecycle listeners ──────────────────────────────────────────────
  // Subscribe to Tauri events forwarded from the Rust socket layer.
  // Set up once on mount; all closures reference only refs and stable React
  // state setters, so no stale-closure problem even with empty deps.
  useEffect(() => {
    let unlistenAuthenticated: (() => void) | undefined;
    let unlistenReconnected:   (() => void) | undefined;
    let unlistenDisconnected:  (() => void) | undefined;
    let unlistenError:         (() => void) | undefined;

    // socket-authenticated — ABS confirmed auth ("init" event); socket is live.
    // This is the definitive signal that events are flowing. Also clears the
    // error counter so a successful reconnect resets the degradation window.
    listen('socket-authenticated', () => {
      errorCountRef.current     = 0;
      firstErrorTimeRef.current = null;
      setConnectionStatus('connected');
    }).then(fn => { unlistenAuthenticated = fn; });

    // socket-reconnected — re-auth was emitted after the transport reconnected.
    // Belt-and-suspenders: ABS typically re-sends "init" (→ socket-authenticated)
    // but we set connected here too in case the server skips the second init.
    listen('socket-reconnected', () => {
      setConnectionStatus('connected');
    }).then(fn => { unlistenReconnected = fn; });

    // socket-disconnected — transport dropped or intentional toggle-off teardown.
    // Only set 'reconnecting' for unintentional drops: handleToggle(false) already
    // flipped liveSyncIntentRef.current to false before the disconnect fires,
    // so intentional teardowns fall through without touching the indicator.
    listen('socket-disconnected', () => {
      if (liveSyncIntentRef.current) {
        setConnectionStatus('reconnecting');
      }
    }).then(fn => { unlistenDisconnected = fn; });

    // socket-error — a connection attempt failed at the transport level (server
    // unreachable, TLS error, etc.). Track consecutive failures within a 60-second
    // window; after three, auto-disable live sync so the user is notified rather
    // than silently receiving stale data from an unresponsive socket.
    listen<string>('socket-error', () => {
      const now = Date.now();
      // Start a fresh window if this is the first error or the previous one expired.
      if (firstErrorTimeRef.current === null || now - firstErrorTimeRef.current > 60_000) {
        firstErrorTimeRef.current = now;
        errorCountRef.current     = 1;
      } else {
        // Within the window — increment the consecutive-failure count.
        errorCountRef.current += 1;
      }

      if (errorCountRef.current >= 3) {
        // Three consecutive failures — tear down cleanly, update prefs, notify user.
        errorCountRef.current     = 0;
        firstErrorTimeRef.current = null;
        liveSyncIntentRef.current = false;
        setLiveSync(false);
        setConnectionStatus('off');
        // Disconnect is best-effort; ignore the result (may already be closed).
        disconnectSocket().catch(() => {});
        st.setToast({
          message: 'Live sync disabled after repeated connection failures. Check your server.',
          type: 'error',
        });
      }
    }).then(fn => { unlistenError = fn; });

    // Tear down all four listeners when the component unmounts so they do not
    // accumulate across Settings screen open/close cycles.
    return () => {
      unlistenAuthenticated?.();
      unlistenReconnected?.();
      unlistenDisconnected?.();
      unlistenError?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Toggle handler ──────────────────────────────────────────────────────────
  async function handleToggle(next: boolean) {
    // Update the intent ref synchronously before any async operations so
    // that the socket-disconnected listener reads the new intent value when
    // the Rust-side disconnect fires moments later.
    liveSyncIntentRef.current = next;
    setLiveSync(next);

    // Set the indicator to 'off' immediately when the user disables the toggle.
    // Without this, the socket-disconnected event that fires during teardown
    // would race with this setter and could briefly show 'Reconnecting…'.
    if (!next) setConnectionStatus('off');

    try {
      if (next) {
        // Enabling — open the Socket.IO connection and authenticate.
        await connectSocket(st.serverUrl, st.authToken);
      } else {
        // Disabling — tear down cleanly; safe to call with no active connection.
        await disconnectSocket();
      }
    } catch (e) {
      // Roll back the toggle on failure so the displayed state matches reality.
      console.warn('[sync] toggle failed:', e);
      liveSyncIntentRef.current = !next;
      setLiveSync(!next);
      // If enabling failed, the indicator should return to 'off'.
      if (next) setConnectionStatus('off');
    }
  }

  // ── Indicator style values ──────────────────────────────────────────────────
  // Resolved once per render — avoids nested ternaries in JSX.

  // Dot fill colour: green / amber / translucent grey.
  const dotColor = connectionStatus === 'connected'    ? '#4caf50'
                 : connectionStatus === 'reconnecting' ? '#f59e0b'
                 :                                       'rgba(255,255,255,0.28)';

  // Label text colour matches the dot for a cohesive signal.
  const labelColor = connectionStatus === 'connected'    ? '#4caf50'
                   : connectionStatus === 'reconnecting' ? '#f59e0b'
                   :                                       'var(--onyx-text-mute)';

  // Human-readable status string. Ellipsis rendered as Unicode to avoid a
  // trailing '...' that would misalign with the mono font.
  const labelText = connectionStatus === 'connected'    ? 'Connected'
                  : connectionStatus === 'reconnecting' ? 'Reconnecting…'
                  :                                       'Off';

  // ── Live sync toggle row ── (shared by the standalone and embedded layouts)
  const liveSyncRow = (
    <Row
      label="Live sync"
      hint="Maintain a live connection to the server for real-time progress and library updates."
    >
      {/* Right-side slot: connection indicator (only when active) + toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>

        {/* Live connection status — shown only when sync is connected/reconnecting.
            When off, the toggle alone conveys the state (no redundant "Off" label). */}
        {connectionStatus !== 'off' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {/* 6 px filled circle — colour encodes state at a glance */}
            <div style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: dotColor,
              flexShrink: 0,
            }} />

            {/* Mono 10 px label — compact, technical feel matching Onyx aesthetics */}
            <span style={{
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: '0.04em',
              color: labelColor,
            }}>
              {labelText}
            </span>
          </div>
        )}

        {/* Toggle — calls handleToggle which drives the Rust socket commands */}
        <Toggle on={liveSync} onChange={handleToggle} />
      </div>
    </Row>
  );

  // Embedded under the Server panel: render just the row (the panel supplies the
  // heading). Standalone: keep the section header for backward compatibility.
  if (embedded) return liveSyncRow;

  return (
    <div>
      <SectionHead
        title="Sync"
        subtitle="Control how Skald stays in sync with your server."
      />
      {liveSyncRow}
    </div>
  );
}
