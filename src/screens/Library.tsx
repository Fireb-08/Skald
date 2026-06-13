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

  // Podcast libraries use a dedicated full-width browse grid instead of the
  // book-centric Focus/Greeting + shelf-tabs layout (those components assume
  // book media). The library switcher in TopNav toggles between the two.
  if (isPodcast) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 18, padding: '8px 24px 24px', minHeight: 0, width: '100%', maxWidth: '100%', overflow: 'visible' }}>
        <TopNav st={st} />
        <PodcastBrowse st={st} />
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', gap: 24, padding: '8px 24px 24px', minHeight: 0, width: '100%', maxWidth: '100%', overflow: 'visible' }}>
      {/* overflow: visible required — TopNav active tab indicator protrudes below nav bar via position:absolute */}
      {/* Left slot: GreetingPane until the user starts playback, then FocusPanel.
          currentBookId is '' on cold launch and only set by playBook(), so
          clicking a shelf book (which sets focusedBookId only) leaves the pane intact.
          The wrapper div gives GreetingPane an explicit containing block so that
          height: '100%' on its Glass card resolves correctly against the column height. */}
      {st.currentBookId
        ? <FocusPanel st={st} />
        : (
          <div style={{
            alignSelf: 'stretch',     // fill the cross-axis height of the Library flex container
            display: 'flex',          // make this a flex column so the child can use height: '100%'
            flexDirection: 'column',  // vertical so GreetingPane stretches to fill the wrapper
            flexShrink: 0,            // prevent width compression (same constraint as FocusPanel)
          }}>
            <GreetingPane st={st} name={st.user?.username ?? 'Reader'} />
          </div>
        )
      }

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
