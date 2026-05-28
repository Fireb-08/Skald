import { useOnyxState } from './state/onyx';
import OnyxWash from './components/chrome/OnyxWash';
import Titlebar from './components/chrome/Titlebar';
import TopNav from './components/chrome/TopNav';
import Home from './screens/Home';
import Library from './screens/Library';
import Player from './screens/Player';
import Settings from './screens/Settings';

export default function App() {
  const st = useOnyxState();
  const isDark = st.theme !== 'light';
  const showNav = st.screen === 'library' || st.screen === 'home';
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
      {/* Content area — sits below the 44px absolute Titlebar */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        paddingTop: 44,
        position: 'relative',
        zIndex: 1,
        minHeight: 0,
      }}>
        {showNav && <TopNav st={st} />}
        {st.screen === 'home'     && <Home     st={st} />}
        {st.screen === 'library'  && <Library  st={st} />}
        {st.screen === 'player'   && <Player   st={st} />}
        {st.screen === 'settings' && <Settings st={st} />}
      </div>
    </div>
  );
}
