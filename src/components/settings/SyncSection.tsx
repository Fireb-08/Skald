// SyncSection — settings pane for controlling how Skald synchronises with the server.
//
// The live-sync toggle is wired to the Rust Socket.IO connect/disconnect commands and
// shows a live connection indicator with graceful degradation on persistent failure.

import { useState, useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { SectionHead, Row, Toggle, MONO } from './shared';
import type { OnyxState } from '../../state/onyx';
import { connectSocket, disconnectSocket } from '../../api/abs';
import { log } from '../../lib/log';

// Connection state for the live indicator dot.
// 'off'          — toggle is disabled or socket has never connected this session.
// 'connecting'   — the user just enabled the toggle; transport is up (or opening)
//                  but ABS has not yet confirmed auth with "init".
// 'connected'    — socket-authenticated received; ABS is dispatching events.
// 'reconnecting' — socket-disconnected fired unexpectedly; the library is
//                  rebuilding the transport (normal after a network blip or sleep/wake).
type ConnectionStatus = 'off' | 'connecting' | 'connected' | 'reconnecting';

// How long an enable waits for the server's auth confirmation (socket-authenticated)
// before concluding live sync isn't actually working and reverting the toggle.
// connect_socket resolving only proves the transport opened and the auth event was
// *sent* — a bad token or misbehaving server never answers with "init".
const CONNECT_CONFIRM_TIMEOUT_MS = 10_000;

export interface SyncSectionProps {
  // OnyxState supplies serverUrl, authToken (for connect) and setToast (for errors).
  st: OnyxState;
  /** When true, render only the live-sync row (no SectionHead) for embedding
   *  under the Server panel. */
  embedded?: boolean;
}

export default function SyncSection({ st, embedded = false }: SyncSectionProps) {
  // The preference lives in useOnyxState so its socket listeners react to a
  // runtime toggle instead of reading localStorage only when auth changes.
  const liveSync = st.liveSyncEnabled;
  const setLiveSync = st.setLiveSyncEnabled;

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

  // Non-null while an enable is awaiting auth confirmation. Holds the timeout
  // that reverts the toggle if socket-authenticated never arrives — the "toggle
  // stuck on with live sync dead" failure mode (e.g. a stale/wrong stored token,
  // where the transport connects fine but ABS never answers the auth emit).
  const pendingConfirmRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cancels the pending-enable timeout (auth confirmed, user toggled off, unmount).
  function clearPendingConfirm() {
    if (pendingConfirmRef.current !== null) {
      clearTimeout(pendingConfirmRef.current);
      pendingConfirmRef.current = null;
    }
  }

  // Reverts a failed enable: toggle back to off, socket torn down, user notified.
  // Called from the confirmation timeout and from socket-error while pending.
  // References only refs and stable setters, so it is safe inside the
  // mount-once listeners below.
  function revertFailedEnable(reason: string) {
    clearPendingConfirm();
    log.warn('sync', 'live sync enable failed — reverting toggle', { reason });
    liveSyncIntentRef.current = false;
    setLiveSync(false);
    setConnectionStatus('off');
    // Best-effort teardown of the half-open socket; may already be closed.
    disconnectSocket().catch(() => {});
    st.setToast({
      message: 'Live sync could not connect. Check your server and try again.',
      type: 'error',
    });
  }

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
    // error counter so a successful reconnect resets the degradation window,
    // and settles any pending-enable confirmation so the toggle stays on.
    listen('socket-authenticated', () => {
      clearPendingConfirm();
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
      // A transport failure while the enable is still awaiting confirmation
      // means the connection the user just asked for isn't coming up — revert
      // the toggle right away instead of leaving it on and waiting out the
      // three-strike window (that logic is for drops on established sockets).
      if (pendingConfirmRef.current !== null) {
        revertFailedEnable('socket-error during connect');
        return;
      }

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
    // accumulate across Settings screen open/close cycles. Also drop any
    // pending-enable timeout — its revert closure would otherwise fire setState
    // against the unmounted component.
    return () => {
      unlistenAuthenticated?.();
      unlistenReconnected?.();
      unlistenDisconnected?.();
      unlistenError?.();
      clearPendingConfirm();
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

    // A new toggle action supersedes any enable still awaiting confirmation.
    clearPendingConfirm();

    // Show 'Connecting…' while an enable awaits confirmation; set the indicator
    // to 'off' immediately when disabling. Without the latter, the
    // socket-disconnected event that fires during teardown would race with
    // this setter and could briefly show 'Reconnecting…'.
    setConnectionStatus(next ? 'connecting' : 'off');

    try {
      if (next) {
        // Enabling — open the Socket.IO connection and send the auth event.
        // Resolving here only means the transport is up and auth was *sent*;
        // the toggle is not confirmed until socket-authenticated arrives.
        // Arm the timeout *before* invoking Rust: a fast server can emit
        // socket-authenticated before connectSocket resolves. The listener must
        // always have a real pending timer to clear in that ordering.
        pendingConfirmRef.current = setTimeout(() => {
          pendingConfirmRef.current = null;
          revertFailedEnable(`no auth confirmation within ${CONNECT_CONFIRM_TIMEOUT_MS}ms`);
        }, CONNECT_CONFIRM_TIMEOUT_MS);
        await connectSocket(st.serverUrl);
      } else {
        // Disabling — tear down cleanly; safe to call with no active connection.
        await disconnectSocket();
      }
    } catch (e) {
      clearPendingConfirm();
      // Roll back the toggle on failure so the displayed state matches reality.
      log.warn('sync', 'live-sync toggle failed', { enabling: next, err: String(e) });
      liveSyncIntentRef.current = !next;
      setLiveSync(!next);
      // If enabling failed, the indicator should return to 'off'.
      if (next) setConnectionStatus('off');
    }
  }

  // ── Indicator style values ──────────────────────────────────────────────────
  // Resolved once per render — avoids nested ternaries in JSX.

  // Dot fill colour: green / amber (both transitional states) / translucent grey.
  const dotColor = connectionStatus === 'connected'    ? '#4caf50'
                 : connectionStatus === 'reconnecting' ? '#f59e0b'
                 : connectionStatus === 'connecting'   ? '#f59e0b'
                 :                                       'rgba(255,255,255,0.28)';

  // Label text colour matches the dot for a cohesive signal.
  const labelColor = connectionStatus === 'connected'    ? '#4caf50'
                   : connectionStatus === 'reconnecting' ? '#f59e0b'
                   : connectionStatus === 'connecting'   ? '#f59e0b'
                   :                                       'var(--onyx-text-mute)';

  // Human-readable status string. Ellipsis rendered as Unicode to avoid a
  // trailing '...' that would misalign with the mono font.
  const labelText = connectionStatus === 'connected'    ? 'Connected'
                  : connectionStatus === 'reconnecting' ? 'Reconnecting…'
                  : connectionStatus === 'connecting'   ? 'Connecting…'
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

  const health = st.syncHealth ?? {
    lastSuccessfulServerSync: null,
    queuedUpdates: 0,
    degraded: false,
  };
  const healthValueStyle = {
    fontFamily: MONO,
    fontSize: 11,
    color: 'var(--onyx-text-dim)',
  } as const;
  const healthRows = (
    <>
      <Row label="Server delivery" hint="HTTP session writes are authoritative; failed writes stay in Skald's local recovery queue.">
        <span style={{ ...healthValueStyle, color: health.degraded ? '#f59e0b' : '#4caf50' }}>
          {health.degraded ? 'Degraded' : 'Healthy'}
        </span>
      </Row>
      <Row label="Last server sync" hint="The most recent playback position acknowledged by ABS.">
        <span style={healthValueStyle}>
          {health.lastSuccessfulServerSync
            ? new Date(health.lastSuccessfulServerSync).toLocaleTimeString()
            : 'Not yet this session'}
        </span>
      </Row>
      <Row label="Queued updates" hint="Local progress writes waiting for conflict-safe delivery to ABS.">
        <span style={healthValueStyle}>{health.queuedUpdates}</span>
      </Row>
      <Row label="Playback device" hint="A remote device only moves Skald after you choose which position to keep.">
        <span style={healthValueStyle}>
          {st.syncConflict ? `${st.syncConflict.deviceDescription} (conflict)` : 'Skald'}
        </span>
      </Row>
    </>
  );

  // Embedded under the Server panel: render just the row (the panel supplies the
  // heading). Standalone: keep the section header for backward compatibility.
  if (embedded) return <>{liveSyncRow}{healthRows}</>;

  return (
    <div>
      <SectionHead
        title="Sync"
        subtitle="Control how Skald stays in sync with your server."
      />
      {liveSyncRow}
      {healthRows}
    </div>
  );
}
