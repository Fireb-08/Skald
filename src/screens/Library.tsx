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
import { shelfTabForSource } from '../lib/shelfTabs';

export interface LibraryProps {
  st: OnyxState;
}

export default function Library({ st }: LibraryProps) {
  const isPodcast = st.activeLibrary?.mediaType === 'podcast';
  const isLocalLibrary = st.activeLibrary?.source === 'local';
  const isAllLibraries = st.activeLibrary?.source === 'all';
  // Combined + local sources route through the same gate: only the
  // library-scoped Collections/Playlists views fall back to Home; the
  // client-side browse tabs render for every source.
  const shelfSource = isAllLibraries ? 'all' : isLocalLibrary ? 'local' : 'abs';
  const visibleShelfTab = shelfTabForSource(st.shelfTab, shelfSource);

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
      // Cap at the Focus/Greeting card footprint (360) so a long nowrap episode
      // title in the MiniPlayer can't stretch the column's intrinsic width past
      // the card — the title then ellipsizes instead. maxWidth (not width) so
      // the collapsed FocusPanel rail (76px) still shrinks the column to fit.
      maxWidth: 360,
    }}>
      {/* Host stretches the Focus/Greeting card to the available height; the
          MiniPlayer (when shown) docks below it at the column's width. */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {showFocus
          ? <FocusPanel st={st} />
          : <GreetingPane st={st} name={st.user?.username || st.localDisplayName || 'Reader'} />}
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
        {visibleShelfTab === 'library'     && <LibraryShelf    st={st} />}
        {visibleShelfTab === 'series'      && <SeriesView      st={st} inline />}
        {visibleShelfTab === 'authors'     && <AuthorsView     st={st} inline />}
        {visibleShelfTab === 'narrators'   && <NarratorsView   st={st} inline />}
        {visibleShelfTab === 'genres'      && <GenresView      st={st} inline />}
        {visibleShelfTab === 'publishers'  && <PublishersView  st={st} inline />}
        {visibleShelfTab === 'collections' && <CollectionsView st={st} inline />}
        {visibleShelfTab === 'playlists'   && <PlaylistsView   st={st} inline />}
      </div>
    </div>
  );
}
