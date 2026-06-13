import type { OnyxState, LibraryItem } from '../../../state/onyx';
import { groupMatchesFilter } from '../../../lib/shelfFilters';
import { bookTitle, bookGenres, bookDurSecs } from '../../../state/onyx';
import BrowseView, { posterTile, seriesTotalDur } from '../BrowseView';
import BrowseList from '../BrowseList';
import CoverMosaic from '../CoverMosaic';
import Initial from '../Initial';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const MONO = "'JetBrains Mono', ui-monospace, monospace";

interface GenreGroup { name: string; books: LibraryItem[]; }

export interface GenresViewProps {
  st: OnyxState;
  inline?: boolean;
}

export default function GenresView({ st, inline = false }: GenresViewProps) {
  // A book can belong to several genres, so it appears in each genre's group.
  const groups: Record<string, LibraryItem[]> = {};
  for (const b of st.library) {
    for (const g of bookGenres(b)) {
      if (!g) continue;
      if (!groups[g]) groups[g] = [];
      groups[g].push(b);
    }
  }

  let list: GenreGroup[] = Object.entries(groups)
    .map(([name, books]) => ({ name, books }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (st.search) {
    const q = st.search.toLowerCase();
    list = list.filter(g =>
      g.name.toLowerCase().includes(q) ||
      g.books.some(b => bookTitle(b).toLowerCase().includes(q))
    );
  }

  if (st.filter !== 'all') {
    list = list.filter(g => groupMatchesFilter(g.books, st.filter, st.mediaProgress));
  }

  const open = (name: string) => {
    st.setContextFilter({ kind: 'genre', value: name });
    st.setShelfTab('library');
    st.setScreen('library');
  };

  return (
    <BrowseView st={st} title="Genres" subtitle={`${list.length} genres in your library`} showModeToggle inline={inline}>
      {st.libraryView === 'grid' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 22 }}>
          {list.map(g => (
            <button key={g.name} onClick={() => open(g.name)} className="onyx-poster" style={posterTile()}>
              <CoverMosaic books={g.books} serverUrl={st.serverUrl} />
              <div style={{ padding: '18px 16px 16px', textAlign: 'center' }}>
                <div style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 500, lineHeight: 1.1, letterSpacing: '-0.01em' }}>{g.name}</div>
                <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--onyx-line)' }}>
                  {g.books.length} TITLE{g.books.length === 1 ? '' : 'S'}{' '}
                  <span style={{ opacity: 0.5, margin: '0 6px' }}>·</span>
                  {seriesTotalDur(g.books)}
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <BrowseList
          columns={[
            { id: 'name',   label: 'Genre',    flex: 2   },
            { id: 'titles', label: 'Titles',   width: 80 },
            { id: 'dur',    label: 'Duration', width: 110 },
          ]}
          rows={list.map(g => ({
            key: g.name,
            onClick: () => open(g.name),
            leading: <Initial name={g.name} small />,
            sort: { name: g.name, titles: g.books.length, dur: g.books.reduce((acc, b) => acc + bookDurSecs(b), 0) },
            cells: {
              name:   <div style={{ fontFamily: SERIF, fontSize: 14, fontWeight: 500 }}>{g.name}</div>,
              titles: <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)' }}>{g.books.length}</div>,
              dur:    <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)' }}>{seriesTotalDur(g.books)}</div>,
            },
          }))}
        />
      )}
    </BrowseView>
  );
}
