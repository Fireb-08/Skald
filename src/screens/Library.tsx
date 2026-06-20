import { useEffect } from 'react';
import type { OnyxState } from '../state/onyx';
import FocusPanel from '../components/FocusPanel';
// GreetingPane replaces FocusPanel in the left slot when nothing is playing.
import GreetingPane from '../components/greeting/GreetingPane';
import PickItUp from '../components/PickItUp';
import TopNav from '../components/chrome/TopNav';
import ShelfHeader from '../components/shelf/ShelfHeader';
import LibraryShelf from '../components/shelf/LibraryShelf';
import { SeriesView } from '../components/shelf/tabs';
import { AuthorsView } from '../components/shelf/tabs';
import { NarratorsView } from '../components/shelf/tabs';
import { CollectionsView } from '../components/shelf/tabs';
import { PlaylistsView } from '../components/shelf/tabs';
import { GenresView } from '../components/shelf/tabs';
import { PublishersView } from '../components/shelf/tabs';
import PodcastBrowse from '../components/podcast/PodcastBrowse';
import MiniPlayer from '../components/player/MiniPlayer';
import { prefetchReviews } from '../api/reviewCache';

export interface LibraryProps {
  st: OnyxState;
}

export default function Library({ st }: LibraryProps) {
  const isPodcast = st.activeLibrary?.mediaType === 'podcast';

  useEffect(() => {
    // Open Library review enrichment is book-specific — skip it for podcasts.
    if (isPodcast || !st.library.length || !st.serverUrl) return;
    const cancel = prefetchReviews(st.library, st.serverUrl, st.enableOpenLibrary);
    return cancel;
  }, [st.library, st.serverUrl, st.enableOpenLibrary, isPodcast]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── The "In focus" left column (shared by the book + podcast views) ──────────
  // Top: FocusPanel when a *book* is playing in the active library, else the
  // GreetingPane (FocusPanel is book-specific, so podcasts always use Greeting).
  // Bottom: the MiniPlayer, docked whenever the user has navigated away from the
  // now-playing item — into another library, or into a podcast library where the
  // Focus panel can't represent the playing episode — so playback stays
  // controllable without returning to the original library.
  const playingIsPodcast = !!st.currentEpisode;
  const playingBookInLib = !!st.currentBookId && st.library.some(b => b.id === st.currentBookId);
  const showFocus = playingBookInLib && !playingIsPodcast;
  const showMini = !!st.playingItem && !!st.currentBookId && !showFocus;

  const focusColumn = (
    <div style={{
      alignSelf: 'stretch',     // fill the cross-axis height of the Library flex container
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,            // prevent width compression (same constraint as FocusPanel)
      minHeight: 0,
    }}>
      {/* Host stretches the Focus/Greeting card to the available height; the
          MiniPlayer (when shown) docks below it at the column's width. */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {showFocus
          ? <FocusPanel st={st} />
          : <GreetingPane st={st} name={st.user?.username ?? 'Reader'} />}
      </div>
      {showMini && <MiniPlayer st={st} force />}
    </div>
  );

  // Podcast libraries use a dedicated browse grid instead of the book-centric
  // shelf-tabs, but share the same Focus/Greeting + MiniPlayer left column for
  // consistency. The library switcher in TopNav toggles between the two.
  if (isPodcast) {
    return (
      <div style={{ flex: 1, display: 'flex', gap: 24, padding: '8px 24px 24px', minHeight: 0, width: '100%', maxWidth: '100%', overflow: 'visible' }}>
        {focusColumn}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
          <TopNav st={st} />
          <PodcastBrowse st={st} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', gap: 24, padding: '8px 24px 24px', minHeight: 0, width: '100%', maxWidth: '100%', overflow: 'visible' }}>
      {/* overflow: visible required — TopNav active tab indicator protrudes below nav bar via position:absolute */}
      {focusColumn}

      {/* RIGHT — shelf column */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
        <TopNav st={st} />
        <PickItUp st={st} />
        <ShelfHeader st={st} />

        {/* Shelf body — routed by shelfTab */}
        {st.shelfTab === 'library' && <LibraryShelf st={st} />}
        {st.shelfTab === 'series'      && <SeriesView      st={st} inline />}
        {st.shelfTab === 'authors'     && <AuthorsView     st={st} inline />}
        {st.shelfTab === 'narrators'   && <NarratorsView   st={st} inline />}
        {st.shelfTab === 'genres'      && <GenresView      st={st} inline />}
        {st.shelfTab === 'publishers'  && <PublishersView  st={st} inline />}
        {st.shelfTab === 'collections' && <CollectionsView st={st} inline />}
        {st.shelfTab === 'playlists'   && <PlaylistsView   st={st} inline />}
      </div>
    </div>
  );
}
