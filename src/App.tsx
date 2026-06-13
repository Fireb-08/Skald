// Root application component. Renders the Saga login screen when the user
// has no saved auth token; otherwise renders the main library/player shell.
import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useOnyxState } from './state/onyx';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { closeActiveSession, connectSocket, disconnectSocket, flushOfflineProgress, getMe, recordStopPoint } from './api/abs';
import Toast from './components/ui/Toast';
import ConfirmDialog from './components/ui/ConfirmDialog';
import DownloadProgressToast from './components/downloads/DownloadProgressToast';
import OnyxWash from './components/chrome/OnyxWash';
import Titlebar from './components/chrome/Titlebar';
import Login from './screens/Login';
import Library from './screens/Library';
import Player from './screens/Player';
import Settings from './screens/Settings';
import PodcastDetail from './screens/PodcastDetail';

// Guard against React StrictMode double-mounting which would open two
// simultaneous socket connections, causing one to fail with EngineIO error.
let socketInitialised = false;

export default function App() {
  // Single shared state object — all screens read from and write to this
  const st = useOnyxState();
  const isDark = st.theme !== 'light';
  // UI scale factor applied via CSS transform on the root div
  const z = st.scale / 100;

  // Register global keyboard shortcuts (Ctrl+Alt+Space etc.) once on mount
  useGlobalShortcuts(st);

  // ── Live sync auto-connect ──────────────────────────────────────────────
  // Fires whenever the auth token changes (login, logout, or initial mount
  // from a persisted token).
  //
  // On login / initial mount with saved token:
  //   If 'onyx.sync.live' is true the socket is opened automatically so the
  //   user does not have to toggle it off and on after every restart.
  //
  // On logout (st.authToken becomes ''):
  //   The socket is always disconnected — a live connection to the old server
  //   must not persist after the user signs out.
  useEffect(() => {
    if (!st.authToken || !st.serverUrl) {
      // Auth cleared (logout) or serverUrl not yet populated — disconnect.
      disconnectSocket().catch(() => {});
      return;
    }
    if (socketInitialised) return;
    socketInitialised = true;
    // Auth is present: restore connection if the preference is enabled.
    if (localStorage.getItem('onyx.sync.live') === 'true') {
      connectSocket(st.serverUrl, st.authToken).catch(e => {
        // Non-fatal: the toggle in Settings → Sync remains the manual fallback.
        console.warn('[sync] auto-connect on startup failed:', e);
      });
    }
    return () => {
      // Re-arm on genuine unmount so a future mount can reconnect.
      socketInitialised = false;
    };
  // st.authToken is the only meaningful trigger — serverUrl and localStorage
  // are stable after login and do not need to be in the dep array.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.authToken]);

  // ── Live sync connection status toasts ─────────────────────────────────
  // Inform the user when live sync drops so they are not confused by stale
  // data, and confirm when it restores. Only shown when live sync is enabled
  // so users in local mode are not interrupted by socket lifecycle events.
  useEffect(() => {
    let unlistenDisconnected: (() => void) | undefined;
    let unlistenReconnected:  (() => void) | undefined;

    // socket-disconnected fires on clean teardown or unexpected drops.
    listen('socket-disconnected', () => {
      if (localStorage.getItem('onyx.sync.live') === 'true') {
        st.setToast({ message: 'Live sync disconnected — reconnecting…', type: 'info' });
      }
    }).then(fn => { unlistenDisconnected = fn; });

    // socket-reconnected fires after the socket re-authenticates following a drop.
    listen('socket-reconnected', async () => {
      if (localStorage.getItem('onyx.sync.live') === 'true') {
        st.setToast({ message: 'Live sync restored', type: 'success' });
      }
      // When live sync reconnects after an offline period, flush any progress
      // updates that were queued locally during the disconnection window.
      try {
        const count = await flushOfflineProgress(st.serverUrl);
        if (count > 0) {
          // Override the "live sync restored" toast with a more informative one.
          st.setToast({
            message: `Synced ${count} offline progress update${count > 1 ? 's' : ''} to server`,
            type: 'success',
          });
          // Refresh mediaProgress so cover overlays and Pick it up reflect the synced values.
          const me = await getMe(st.serverUrl);
          st.setMediaProgress(me.mediaProgress);
        }
      } catch (e) {
        console.error('[offline] progress flush failed:', e);
      }
    }).then(fn => { unlistenReconnected = fn; });

    return () => {
      unlistenDisconnected?.();
      unlistenReconnected?.();
    };
  // Listeners are set up once — st.setToast is a stable setter from useState.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Shutdown safety net ─────────────────────────────────────────────────
  // beforeunload fires when the WebView is dismissed and gives the frontend
  // a chance to initiate session close before the window disappears.  The
  // Rust ExitRequested handler is the authoritative close path; this is a
  // belt-and-suspenders safety net only.

  // Refs let the beforeunload handler (registered with empty deps) see the
  // current book/position without capturing stale closure values.
  const stopBookRef = useRef('');
  const stopPosRef  = useRef(0);
  useEffect(() => { stopBookRef.current = st.currentBookId; }, [st.currentBookId]);
  useEffect(() => { stopPosRef.current  = st.position;      }, [st.position]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      // Best-effort session close on window dismiss — fire-and-forget since
      // beforeunload cannot await async operations. The Rust ExitRequested
      // handler is the authoritative close; this is a safety net only.
      closeActiveSession().catch(() => {});
      // Record a local stop point so position is preserved even if server sync fails.
      if (stopBookRef.current && stopPosRef.current > 0) {
        recordStopPoint(stopBookRef.current, stopPosRef.current).catch(() => {});
      }
    };

    // Register once on mount; clean up if the component ever unmounts.
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []); // empty deps — handler uses refs, not captured state

  // ── Auth gate ───────────────────────────────────────────────────────────
  // st.authToken is initialised synchronously from localStorage, so this
  // check is instant and produces no flash. When Login succeeds it calls
  // st.setAuthToken which re-renders App and this condition becomes false.
  if (!st.authToken) {
    return <Login st={st} />;
  }

  // ── Main shell ──────────────────────────────────────────────────────────
  return (
    <div style={{
      position: 'relative',
      // Inverse-scale the root so that after the CSS scale() transform the
      // viewport is fully occupied (prevents layout overflow at non-100% scales)
      width: `${100 / z}vw`,
      height: `${100 / z}vh`,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      transform: `scale(${z})`,
      transformOrigin: 'top left',
    }}>
      {/* Ambient wash gradient and titlebar chrome */}
      <OnyxWash isDark={isDark} />
      {/* isOffline is true when the library loaded from disk cache (server unreachable) */}
      <Titlebar isDark={isDark} isOffline={st.isOffline} />

      {/* Screen content area — sits below the 44px titlebar */}
      <div style={{
        position: 'absolute',
        top: 44,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        minHeight: 0,
        width: '100%',
        maxWidth: '100%',
        overflow: 'hidden',
      }}>
        {/* Show a loading indicator while the library fetch is in flight */}
        {st.libraryLoading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--onyx-text-mute)', fontSize: 14, fontFamily: "'JetBrains Mono', ui-monospace, monospace", letterSpacing: '0.08em' }}>
            Loading library…
          </div>
        ) : (
          <>
            {st.screen === 'library'  && <Library  st={st} />}
            {st.screen === 'podcast'  && <PodcastDetail st={st} />}
            {st.screen === 'player'   && <Player   st={st} />}
            {/* Settings receives onLogout which clears the token and shows Login again */}
            {st.screen === 'settings' && <Settings st={st} onLogout={() => st.setAuthToken('')} />}
          </>
        )}
      </div>

      {/* Per-download progress bars — appears during active transfers, clears on completion.
          onCancel/onFailed are wired here alongside onComplete so all download outcome
          toasts originate from the same place and use the same st.setToast mechanism. */}
      <DownloadProgressToast
        onComplete={(title) => st.setToast({ message: `Downloaded "${title}"`, type: 'success' })}
        onCancel={(title) => st.setToast({ message: `Download cancelled — "${title}"`, type: 'info' })}
        onFailed={(title, _error) => st.setToast({ message: `Download failed — "${title}"`, type: 'error' })}
      />

      {/* Global toast notification — rendered above all screens */}
      {st.toast && (
        <Toast
          message={st.toast.message}
          type={st.toast.type}
          onDismiss={() => st.setToast(null)}
        />
      )}

      {/* Global confirmation dialog — rendered above all screens */}
      {st.confirmDialog && (
        <ConfirmDialog
          title={st.confirmDialog.title}
          message={st.confirmDialog.message}
          confirmLabel={st.confirmDialog.confirmLabel}
          danger
          onConfirm={() => { st.confirmDialog!.onConfirm(); st.setConfirmDialog(null); }}
          onCancel={() => st.setConfirmDialog(null)}
        />
      )}
    </div>
  );
}
