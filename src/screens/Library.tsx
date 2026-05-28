import type { OnyxState } from '../state/onyx';
import FocusPanel from '../components/FocusPanel';
import PickItUp from '../components/PickItUp';
import ShelfHeader from '../components/shelf/ShelfHeader';
import LibraryShelf from '../components/shelf/LibraryShelf';
import { SeriesView } from '../components/shelf/tabs';
import { AuthorsView } from '../components/shelf/tabs';
import { NarratorsView } from '../components/shelf/tabs';
import { CollectionsView } from '../components/shelf/tabs';

export interface LibraryProps {
  st: OnyxState;
}

export default function Library({ st }: LibraryProps) {
  return (
    <div style={{ flex: 1, display: 'flex', gap: 24, padding: '8px 24px 24px', minHeight: 0 }}>
      <FocusPanel st={st} />

      {/* RIGHT — shelf column */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
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
