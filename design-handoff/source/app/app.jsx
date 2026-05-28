// Onyx — App shell. Hosts state, renders Titlebar + wash + current screen.

function App() {
  const st = useOnyxState();
  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative', color: ONYX.text, fontFamily: ONYX.sans, fontSize: 14 }}>
      <OnyxWash />
      <Titlebar subtitle={st.screen === 'player' ? st.currentBook.title : st.screen === 'settings' ? 'Settings' : st.screen === 'home' ? 'Home' : 'Library'} />
      <div style={{ position: 'absolute', top: 44, left: 0, right: 0, bottom: 0, display: 'flex', minHeight: 0 }}>
        {st.screen === 'library' && <Library st={st} />}
        {st.screen === 'player' && <Player st={st} />}
        {st.screen === 'settings' && <Settings st={st} />}
        {st.screen === 'home' && <HomeView st={st} />}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
