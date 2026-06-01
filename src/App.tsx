// Root application component. Renders the Saga login screen when the user
// has no saved auth token; otherwise renders the main library/player shell.
import { useOnyxState } from './state/onyx';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import Toast from './components/ui/Toast';
import ConfirmDialog from './components/ui/ConfirmDialog';
import OnyxWash from './components/chrome/OnyxWash';
import Titlebar from './components/chrome/Titlebar';
import Login from './screens/Login';
import Home from './screens/Home';
import Library from './screens/Library';
import Player from './screens/Player';
import Settings from './screens/Settings';

export default function App() {
  // Single shared state object — all screens read from and write to this
  const st = useOnyxState();
  const isDark = st.theme !== 'light';
  // UI scale factor applied via CSS transform on the root div
  const z = st.scale / 100;

  // Register global keyboard shortcuts (Ctrl+Alt+Space etc.) once on mount
  useGlobalShortcuts(st);

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
      <Titlebar isDark={isDark} />

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
            {st.screen === 'home'     && <Home     st={st} />}
            {st.screen === 'library'  && <Library  st={st} />}
            {st.screen === 'player'   && <Player   st={st} />}
            {/* Settings receives onLogout which clears the token and shows Login again */}
            {st.screen === 'settings' && <Settings st={st} onLogout={() => st.setAuthToken('')} />}
          </>
        )}
      </div>

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
