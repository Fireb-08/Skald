import { useEffect } from 'react';
import type { OnyxState } from '../state/onyx';
import FocusPanel from '../components/FocusPanel';
import PickItUp from '../components/PickItUp';
import TopNav from '../components/chrome/TopNav';
import ShelfHeader from '../components/shelf/ShelfHeader';
import LibraryShelf from '../components/shelf/LibraryShelf';
import { SeriesView } from '../components/shelf/tabs';
import { AuthorsView } from '../components/shelf/tabs';
import { NarratorsView } from '../components/shelf/tabs';
import { CollectionsView } from '../components/shelf/tabs';
import { prefetchReviews } from '../api/reviewCache';

export interface LibraryProps {
  st: OnyxState;
}

export default function Library({ st }: LibraryProps) {
  useEffect(() => {
    if (!st.library.length || !st.serverUrl) return;
    const cancel = prefetchReviews(st.library, st.serverUrl, st.enableOpenLibrary);
    return cancel;
  }, [st.library, st.serverUrl, st.enableOpenLibrary]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ flex: 1, display: 'flex', gap: 24, padding: '8px 24px 24px', minHeight: 0, width: '100%', maxWidth: '100%', overflow: 'hidden' }}>
      <FocusPanel st={st} />

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
        {st.shelfTab === 'collections' && <CollectionsView st={st} inline />}
      </div>
    </div>
  );
}
