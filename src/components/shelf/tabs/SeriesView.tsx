import type { OnyxState, LibraryItem } from '../../../state/onyx';
import { LIBRARY, parseDur } from '../../../state/onyx';
import BrowseView, { posterTile, seriesTotalDur } from '../BrowseView';
import BrowseList from '../BrowseList';
import CoverFan from '../CoverFan';
import Cover from '../../Cover';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const MONO = "'JetBrains Mono', ui-monospace, monospace";

interface SeriesGroup {
  name: string;
  books: LibraryItem[];
}

function seriesNameOf(s: string | undefined): string {
  return (s || '').split(' · ')[0];
}

function seriesVolOf(s: string | undefined): number {
  return parseInt((s || '').split(' · ')[1] || '0', 10);
}

export interface SeriesViewProps {
  st: OnyxState;
  inline?: boolean;
}

export default function SeriesView({ st, inline = false }: SeriesViewProps) {
  const groups: Record<string, LibraryItem[]> = {};
  for (const b of LIBRARY) {
    const name = seriesNameOf(b.series);
    if (!name) continue;
    if (!groups[name]) groups[name] = [];
    groups[name].push(b);
  }

  let seriesList: SeriesGroup[] = Object.entries(groups)
    .map(([name, books]) => ({
      name,
      books: books.slice().sort((a, b) => seriesVolOf(a.series) - seriesVolOf(b.series)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (st.search) {
    const q = st.search.toLowerCase();
    seriesList = seriesList.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.books.some(b => b.author.toLowerCase().includes(q) || b.title.toLowerCase().includes(q))
    );
  }

  const openSeries = (name: string) => {
    st.setContextFilter({ kind: 'series', value: name });
    st.setShelfTab('library');
    st.setScreen('library');
  };

  return (
    <BrowseView st={st} title="Series" subtitle={`${seriesList.length} series in your library`} showModeToggle inline={inline}>
      {st.libraryView === 'grid' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 22 }}>
          {seriesList.map(s => (
            <button key={s.name} onClick={() => openSeries(s.name)} className="onyx-poster" style={posterTile()}>
              <CoverFan books={s.books.slice(0, 5)} />
              <div style={{ padding: '18px 16px 16px', textAlign: 'center' }}>
                <div style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 500, lineHeight: 1.1, color: 'var(--onyx-text)', letterSpacing: '-0.01em' }}>{s.name}</div>
                <div style={{ fontSize: 13, color: 'var(--onyx-text-dim)', marginTop: 6, fontStyle: 'italic' }}>{s.books[0].author}</div>
                <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--onyx-line)' }}>
                  {s.books.length} {s.books.length === 1 ? 'VOLUME' : 'VOLUMES'}{' '}
                  <span style={{ opacity: 0.5, margin: '0 6px' }}>·</span>
                  {seriesTotalDur(s.books)}
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <BrowseList
          columns={[
            { id: 'name',   label: 'Series',   flex: 2   },
            { id: 'author', label: 'Author',   flex: 1.5 },
            { id: 'vols',   label: 'Volumes',  width: 90 },
            { id: 'dur',    label: 'Duration', width: 110 },
          ]}
          rows={seriesList.map(s => ({
            key: s.name,
            onClick: () => openSeries(s.name),
            leading: <Cover item={s.books[0]} size={28} />,
            sort: {
              name:   s.name,
              author: s.books[0].author,
              vols:   s.books.length,
              dur:    s.books.reduce((acc, b) => acc + parseDur(b.dur), 0),
            },
            cells: {
              name:   <div style={{ fontFamily: SERIF, fontSize: 14, fontWeight: 500, color: 'var(--onyx-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>,
              author: <div style={{ fontSize: 13, color: 'var(--onyx-text-dim)' }}>{s.books[0].author}</div>,
              vols:   <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)' }}>{s.books.length}</div>,
              dur:    <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)' }}>{seriesTotalDur(s.books)}</div>,
            },
          }))}
        />
      )}
    </BrowseView>
  );
}
