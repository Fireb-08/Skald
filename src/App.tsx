import { useOnyxState } from './state/onyx';
import OnyxWash from './components/chrome/OnyxWash';
import Titlebar from './components/chrome/Titlebar';
import Home from './screens/Home';
import Library from './screens/Library';
import Player from './screens/Player';
import Settings from './screens/Settings';

export default function App() {
  const st = useOnyxState();
  const isDark = st.theme !== 'light';
  const z = st.scale / 100;

  return (
    <div style={{
      position: 'relative',
      width: `${100 / z}vw`,
      height: `${100 / z}vh`,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      transform: `scale(${z})`,
      transformOrigin: 'top left',
    }}>
      <OnyxWash isDark={isDark} />
      <Titlebar isDark={isDark} />
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
        {st.libraryLoading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--onyx-text-mute)', fontSize: 14, fontFamily: "'JetBrains Mono', ui-monospace, monospace", letterSpacing: '0.08em' }}>
            Loading library…
          </div>
        ) : (
          <>
            {st.screen === 'home'     && <Home     st={st} />}
            {st.screen === 'library'  && <Library  st={st} />}
            {st.screen === 'player'   && <Player   st={st} />}
            {st.screen === 'settings' && <Settings st={st} />}
          </>
        )}
      </div>
    </div>
  );
}
