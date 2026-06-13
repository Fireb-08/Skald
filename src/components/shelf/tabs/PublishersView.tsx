import type { OnyxState, LibraryItem } from '../../../state/onyx';
import { groupMatchesFilter } from '../../../lib/shelfFilters';
import { bookTitle, bookPublisher, bookDurSecs } from '../../../state/onyx';
import BrowseView, { posterTile, seriesTotalDur } from '../BrowseView';
import BrowseList from '../BrowseList';
import CoverMosaic from '../CoverMosaic';
import Initial from '../Initial';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const MONO = "'JetBrains Mono', ui-monospace, monospace";

interface PublisherGroup { name: string; books: LibraryItem[]; }

export interface PublishersViewProps {
  st: OnyxState;
  inline?: boolean;
}

export default function PublishersView({ st, inline = false }: PublishersViewProps) {
  const groups: Record<string, LibraryItem[]> = {};
  for (const b of st.library) {
    const p = bookPublisher(b);
    if (!p) continue;
    if (!groups[p]) groups[p] = [];
    groups[p].push(b);
  }

  let list: PublisherGroup[] = Object.entries(groups)
    .map(([name, books]) => ({ name, books }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (st.search) {
    const q = st.search.toLowerCase();
    list = list.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.books.some(b => bookTitle(b).toLowerCase().includes(q))
    );
  }

  if (st.filter !== 'all') {
    list = list.filter(p => groupMatchesFilter(p.books, st.filter, st.mediaProgress));
  }

  const open = (name: string) => {
    st.setContextFilter({ kind: 'publisher', value: name });
    st.setShelfTab('library');
    st.setScreen('library');
  };

  return (
    <BrowseView st={st} title="Publishers" subtitle={`${list.length} publishers in your library`} showModeToggle inline={inline}>
      {st.libraryView === 'grid' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 22 }}>
          {list.map(p => (
            <button key={p.name} onClick={() => open(p.name)} className="onyx-poster" style={posterTile()}>
              <CoverMosaic books={p.books} serverUrl={st.serverUrl} />
              <div style={{ padding: '18px 16px 16px', textAlign: 'center' }}>
                <div style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 500, lineHeight: 1.1, letterSpacing: '-0.01em' }}>{p.name}</div>
                <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--onyx-line)' }}>
                  {p.books.length} TITLE{p.books.length === 1 ? '' : 'S'}{' '}
                  <span style={{ opacity: 0.5, margin: '0 6px' }}>·</span>
                  {seriesTotalDur(p.books)}
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <BrowseList
          columns={[
            { id: 'name',   label: 'Publisher', flex: 2   },
            { id: 'titles', label: 'Titles',    width: 80 },
            { id: 'dur',    label: 'Duration',  width: 110 },
          ]}
          rows={list.map(p => ({
            key: p.name,
            onClick: () => open(p.name),
            leading: <Initial name={p.name} small />,
            sort: { name: p.name, titles: p.books.length, dur: p.books.reduce((acc, b) => acc + bookDurSecs(b), 0) },
            cells: {
              name:   <div style={{ fontFamily: SERIF, fontSize: 14, fontWeight: 500 }}>{p.name}</div>,
              titles: <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)' }}>{p.books.length}</div>,
              dur:    <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)' }}>{seriesTotalDur(p.books)}</div>,
            },
          }))}
        />
      )}
    </BrowseView>
  );
}
