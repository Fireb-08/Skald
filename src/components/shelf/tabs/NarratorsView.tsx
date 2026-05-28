import type { OnyxState, LibraryItem } from '../../../state/onyx';
import { bookTitle, bookNarrator, bookGenre, bookDurSecs } from '../../../state/onyx';
import BrowseView, { posterTile, seriesTotalDur } from '../BrowseView';
import BrowseList from '../BrowseList';
import CoverMosaic from '../CoverMosaic';
import Initial from '../Initial';
import Icon from '../../Icon';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const MONO = "'JetBrains Mono', ui-monospace, monospace";

interface NarratorGroup {
  name: string;
  books: LibraryItem[];
}

export interface NarratorsViewProps {
  st: OnyxState;
  inline?: boolean;
}

export default function NarratorsView({ st, inline = false }: NarratorsViewProps) {
  const groups: Record<string, LibraryItem[]> = {};
  for (const b of st.library) {
    const key = bookNarrator(b) || 'Unknown';
    if (!groups[key]) groups[key] = [];
    groups[key].push(b);
  }

  let list: NarratorGroup[] = Object.entries(groups)
    .map(([name, books]) => ({ name, books }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (st.search) {
    const q = st.search.toLowerCase();
    list = list.filter(a =>
      a.name.toLowerCase().includes(q) ||
      a.books.some(b => bookTitle(b).toLowerCase().includes(q))
    );
  }

  const open = (name: string) => {
    st.setContextFilter({ kind: 'narrator', value: name });
    st.setShelfTab('library');
    st.setScreen('library');
  };

  return (
    <BrowseView st={st} title="Narrators" subtitle={`${list.length} narrators · vocal performances in your library`} showModeToggle inline={inline}>
      {st.libraryView === 'grid' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 22 }}>
          {list.map(a => {
            const genres = [...new Set(a.books.map(b => bookGenre(b)).filter(Boolean))];
            return (
              <button key={a.name} onClick={() => open(a.name)} className="onyx-poster" style={posterTile()}>
                <CoverMosaic books={a.books} serverUrl={st.serverUrl} />
                <div style={{ padding: '18px 16px 16px', textAlign: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <Icon name="headphones" size={13} color="var(--onyx-text-mute)" />
                    <div style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 500, lineHeight: 1.1, letterSpacing: '-0.01em' }}>{a.name}</div>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--onyx-text-dim)', marginTop: 6, fontStyle: 'italic' }}>{genres.join(' · ') || '—'}</div>
                  <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--onyx-line)' }}>
                    {a.books.length} TITLE{a.books.length === 1 ? '' : 'S'}{' '}
                    <span style={{ opacity: 0.5, margin: '0 6px' }}>·</span>
                    {seriesTotalDur(a.books)}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <BrowseList
          columns={[
            { id: 'name',   label: 'Narrator', flex: 2   },
            { id: 'titles', label: 'Titles',   width: 80 },
            { id: 'dur',    label: 'Duration', width: 110 },
          ]}
          rows={list.map(a => ({
            key: a.name,
            onClick: () => open(a.name),
            leading: <Initial name={a.name} icon="headphones" small />,
            sort: {
              name:   a.name,
              titles: a.books.length,
              dur:    a.books.reduce((acc, b) => acc + bookDurSecs(b), 0),
            },
            cells: {
              name:   <div style={{ fontFamily: SERIF, fontSize: 14, fontWeight: 500 }}>{a.name}</div>,
              titles: <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)' }}>{a.books.length}</div>,
              dur:    <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)' }}>{seriesTotalDur(a.books)}</div>,
            },
          }))}
        />
      )}
    </BrowseView>
  );
}
