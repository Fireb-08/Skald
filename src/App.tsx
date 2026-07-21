// Root application component. Renders the Saga login screen when the user
// has no saved auth token; otherwise renders the main library/player shell.
import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useOnyxState } from './state/onyx';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { closeActiveSession, connectSocket, disconnectSocket, flushOfflineProgress, getMe, recordStopPoint, startStagingWatch, autoIngestStaging } from './api/abs';
import { log } from './lib/log';
import Toast from './components/ui/Toast';
import ActivityCenter from './components/ActivityCenter';
import ConfirmDialog from './components/ui/ConfirmDialog';
import DownloadProgressToast from './components/downloads/DownloadProgressToast';
import UnidentifiedNotice from './components/UnidentifiedNotice';
import OnyxWash from './components/chrome/OnyxWash';
import Titlebar from './components/chrome/Titlebar';
import Login from './screens/Login';
import Onboarding from './screens/Onboarding';
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
      connectSocket(st.serverUrl).catch(e => {
        // Non-fatal: the toggle in Settings → Sync remains the manual fallback.
        log.warn('sync', 'auto-connect on startup failed', { err: String(e) });
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
      log.warn('sync', 'socket disconnected');
      if (localStorage.getItem('onyx.sync.live') === 'true') {
        st.setToast({ message: 'Live sync disconnected — reconnecting…', type: 'info' });
        st.recordActivity({ category: 'sync', outcome: 'error', message: 'Live sync disconnected — reconnecting' });
      }
    }).then(fn => { unlistenDisconnected = fn; });

    // socket-reconnected fires after the socket re-authenticates following a drop.
    listen('socket-reconnected', async () => {
      log.info('sync', 'socket reconnected');
      if (localStorage.getItem('onyx.sync.live') === 'true') {
        st.setToast({ message: 'Live sync restored', type: 'success' });
        st.recordActivity({ category: 'sync', outcome: 'success', message: 'Live sync restored' });
      }
      // When live sync reconnects after an offline period, flush any progress
      // updates that were queued locally during the disconnection window.
      try {
        const count = await flushOfflineProgress(st.serverUrl);
        if (count > 0) {
          log.info('downloads', 'flushed offline progress on reconnect', { count });
          // Override the "live sync restored" toast with a more informative one.
          st.setToast({
            message: `Synced ${count} offline progress update${count > 1 ? 's' : ''} to server`,
            type: 'success',
          });
          st.recordActivity({ category: 'sync', outcome: 'success', message: `Synced ${count} offline progress update${count > 1 ? 's' : ''} to server` });
          // Refresh mediaProgress so cover overlays and Pick it up reflect the synced values.
          // applyServerProgress preserves local-library progress (server payload omits it).
          const me = await getMe(st.serverUrl);
          st.applyServerProgress(me.mediaProgress);
        }
      } catch (e) {
        log.error('downloads', 'offline progress flush failed', { err: String(e) });
      } finally {
        await st.surfaceCorruptPersistenceNotices();
      }
    }).then(fn => { unlistenReconnected = fn; });

    return () => {
      unlistenDisconnected?.();
      unlistenReconnected?.();
    };
  // Listeners are set up once — st.setToast is a stable setter from useState.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Downloaded-book progress sync ────────────────────────────────────────
  // Downloaded books play from local disk with no server session, so the Rust
  // 30s session-sync never runs for them — their progress only lands in the
  // local offline queue. Flush that queue to the server every 30s while a local
  // book is playing (mirroring the online sync cadence), and once more when local
  // playback ends, so the server stays current. Flush failures are non-fatal:
  // entries remain queued and the existing startup/reconnect flush picks them up.
  useEffect(() => {
    if (!st.isLocalPlayback || !st.serverUrl) return;
    const flush = () => {
      flushOfflineProgress(st.serverUrl)
        .catch(() => { /* offline — entries stay queued */ })
        .finally(st.surfaceCorruptPersistenceNotices);
    };
    const iv = setInterval(flush, 30_000);
    return () => { clearInterval(iv); flush(); };
  }, [st.isLocalPlayback, st.serverUrl, st.surfaceCorruptPersistenceNotices]);

  // ── Local staging watcher + auto-distribute (app-wide) ───────────────────
  // Staging is an intake zone: when files land there, scan and MOVE identified
  // books into Author/Series/Title (unidentified → _Unidentified). Runs here
  // (always mounted) so it works regardless of which screen is open.
  const localLibsRef = useRef<{ id: string }[]>([]);
  useEffect(() => {
    localLibsRef.current = st.libraries.filter(l => l.source === 'local').map(l => ({ id: l.id }));
  });

  // Re-arm the OS watcher whenever the set of staging paths changes.
  const stagingKey = st.libraries
    .filter(l => l.source === 'local')
    .map(l => l.stagingPath)
    .filter(Boolean)
    .join('|');
  useEffect(() => {
    const paths = stagingKey ? stagingKey.split('|') : [];
    startStagingWatch(paths).catch(e => log.warn('library', 'staging watch start failed', { err: String(e) }));
  }, [stagingKey]);

  useEffect(() => {
    let un: (() => void) | undefined;
    let timer: number | null = null;
    listen('staging-changed', () => {
      // Debounce so a drop / large copy settles before we move anything.
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        try {
          let filed = 0, quarantined = 0;
          for (const lib of localLibsRef.current) {
            const outcomes = await autoIngestStaging(lib.id);
            filed += outcomes.filter(o => o.outcome === 'filed').length;
            quarantined += outcomes.filter(o => o.outcome === 'quarantined').length;
          }
          if (filed || quarantined) {
            await st.refreshLibrary();
            const parts = [`${filed} added`];
            if (quarantined) parts.push(`${quarantined} need attention`);
            st.setToast({ message: `Imported from staging — ${parts.join(', ')}`, type: 'success' });
            log.info('library', 'auto-ingest staging', { filed, quarantined });
          }
        } catch (e) {
          log.error('library', 'auto-ingest staging failed', { err: String(e) });
        }
      }, 4000);
    }).then(fn => { un = fn; });
    return () => { un?.(); if (timer) window.clearTimeout(timer); };
  // Listener is set up once; current libraries are read via localLibsRef.
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

  // ── Onboarding gate ─────────────────────────────────────────────────────
  // Sits AHEAD of the auth gate. st.onboarded is derived synchronously (false
  // only for a genuinely fresh profile — see onyx.ts), so this is flash-free.
  // The flow itself writes auth/local state and flips st.setOnboarded(true) when
  // it finishes or is skipped, after which this condition is false forever.
  if (!st.onboarded) {
    return <Onboarding st={st} />;
  }

  // ── Auth gate ───────────────────────────────────────────────────────────
  // st.authToken is initialised synchronously from localStorage, so this
  // check is instant and produces no flash. When Login succeeds it calls
  // st.setAuthToken which re-renders App and this condition becomes false.
  if (!st.authToken && !st.localMode) {
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
      // Skip the transform entirely at 100% scale: even scale(1) forces the
      // whole app subtree through an extra rastered layer, which feeds the
      // WebView2 partial-repaint banding on the translucent panels (see
      // Glass.tsx). At non-default scales the transform is the feature itself.
      transform: z === 1 ? undefined : `scale(${z})`,
      transformOrigin: 'top left',
    }}>
      {/* Ambient wash gradient and titlebar chrome */}
      <OnyxWash isDark={isDark} />
      {/* isOffline is true when the library loaded from disk cache (server unreachable);
          isUnencrypted flags a plain-http ABS connection (review L6 — visible, never blocked) */}
      <Titlebar isDark={isDark} isOffline={st.isOffline} lastRefresh={st.lastLibraryRefresh} isUnencrypted={!!st.authToken && st.serverUrl.startsWith('http://')} trailing={<ActivityCenter st={st} />} />

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
        serverUrl={st.serverUrl}
        onComplete={(title) => { st.setToast({ message: `Downloaded "${title}"`, type: 'success' }); st.recordActivity({ category: 'downloads', outcome: 'success', message: `Downloaded "${title}"` }); }}
        onCancel={(title) => st.setToast({ message: `Download cancelled — "${title}"`, type: 'info' })}
        onFailed={(title, _error) => { st.setToast({ message: `Download failed — "${title}"`, type: 'error' }); st.recordActivity({ category: 'downloads', outcome: 'error', message: `Download failed — "${title}"` }); }}
      />

      {/* Quarantine notice — local-library books awaiting a metadata match. */}
      <UnidentifiedNotice st={st} />

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
