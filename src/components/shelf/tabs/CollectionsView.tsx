import { useState } from 'react';
import type { OnyxState, LibraryItem } from '../../../state/onyx';
import { bookTitle, bookAuthor } from '../../../state/onyx';
import BrowseView, { posterTile } from '../BrowseView';
import BrowseList from '../BrowseList';
import CoverMosaic from '../CoverMosaic';
import Cover from '../../Cover';
import Icon from '../../Icon';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const MONO = "'JetBrains Mono', ui-monospace, monospace";

interface Collection {
  name: string;
  subtitle: string;
  bookIds: string[];
}

const SEED_COLLECTIONS: Collection[] = [];

export interface CollectionsViewProps {
  st: OnyxState;
  inline?: boolean;
}

export default function CollectionsView({ st, inline = false }: CollectionsViewProps) {
  const [userCollections, setUserCollections] = useState<Collection[]>([]);
  let allCollections = [...SEED_COLLECTIONS, ...userCollections];

  const booksFor = (c: Collection): LibraryItem[] =>
    c.bookIds.map(id => st.library.find(b => b.id === id)).filter((b): b is LibraryItem => Boolean(b));

  if (st.search) {
    const q = st.search.toLowerCase();
    allCollections = allCollections.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.subtitle.toLowerCase().includes(q) ||
      c.bookIds.some(id => {
        const b = st.library.find(x => x.id === id);
        return b && (bookTitle(b).toLowerCase().includes(q) || bookAuthor(b).toLowerCase().includes(q));
      })
    );
  }

  const openCollection = (c: Collection) => {
    st.setContextFilter({ kind: 'collection', value: c.name, bookIds: c.bookIds });
    st.setShelfTab('library');
    st.setScreen('library');
  };

  const createCollection = () => {
    const name = window.prompt('Name your new collection:');
    if (!name || !name.trim()) return;
    const subtitle = window.prompt('A short description (optional):') || 'Empty — add books from the shelf.';
    setUserCollections(prev => [...prev, { name: name.trim(), subtitle, bookIds: [] }]);
  };

  return (
    <BrowseView
      st={st}
      title="Collections"
      subtitle={`${allCollections.length} ${allCollections.length === 1 ? 'collection' : 'collections'} · sets that don't follow a single series or author`}
      showModeToggle
      inline={inline}
    >
      {st.libraryView === 'grid' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 22 }}>
          {allCollections.map(c => {
            const books = booksFor(c);
            return (
              <button key={c.name} onClick={() => openCollection(c)} className="onyx-poster" style={posterTile()}>
                {books.length > 0 ? (
                  <CoverMosaic books={books} serverUrl={st.serverUrl} />
                ) : (
                  <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--onyx-text-mute)', fontFamily: SERIF, fontStyle: 'italic', fontSize: 14, background: 'linear-gradient(180deg, rgba(212,166,74,0.06), rgba(0,0,0,0.12))', borderBottom: '1px solid var(--onyx-line)' }}>
                    Empty collection
                  </div>
                )}
                <div style={{ padding: '18px 16px 16px', textAlign: 'center' }}>
                  <div style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 500, lineHeight: 1.1, color: 'var(--onyx-text)', letterSpacing: '-0.01em' }}>{c.name}</div>
                  <div style={{ fontSize: 13, color: 'var(--onyx-text-dim)', marginTop: 6, fontStyle: 'italic' }}>{c.subtitle}</div>
                  <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--onyx-line)' }}>
                    {books.length} TITLE{books.length === 1 ? '' : 'S'}
                  </div>
                </div>
              </button>
            );
          })}
          <button
            onClick={createCollection}
            title="Create a new collection"
            className="onyx-poster"
            style={{
              ...posterTile(),
              background: 'transparent',
              border: '1px dashed var(--onyx-glass-edge)',
              color: 'var(--onyx-text-mute)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10,
              minHeight: 380,
            }}
          >
            <Icon name="plus" size={22} />
            <div style={{ fontFamily: SERIF, fontSize: 16, fontStyle: 'italic' }}>New collection</div>
          </button>
        </div>
      ) : (
        <BrowseList
          columns={[
            { id: 'name',     label: 'Collection',  flex: 2 },
            { id: 'subtitle', label: 'Description', flex: 2 },
            { id: 'titles',   label: 'Titles',      width: 80 },
          ]}
          rows={[
            ...allCollections.map(c => {
              const books = booksFor(c);
              return {
                key: c.name,
                onClick: () => openCollection(c),
                leading: books[0]
                  ? <Cover item={books[0]} size={28} serverUrl={st.serverUrl} />
                  : <div style={{ width: 28, height: 28, borderRadius: 4, background: 'var(--onyx-glass)', border: '1px dashed var(--onyx-glass-edge)' }} />,
                sort: { name: c.name, subtitle: c.subtitle, titles: books.length },
                cells: {
                  name:     <div style={{ fontFamily: SERIF, fontSize: 14, fontWeight: 500, color: 'var(--onyx-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>,
                  subtitle: <div style={{ fontSize: 12.5, color: 'var(--onyx-text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.subtitle}</div>,
                  titles:   <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)' }}>{books.length}</div>,
                },
              };
            }),
            {
              key: '__new__',
              onClick: createCollection,
              leading: (
                <div style={{ width: 28, height: 28, borderRadius: 14, border: '1px dashed var(--onyx-glass-edge)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--onyx-text-mute)' }}>
                  <Icon name="plus" size={11} />
                </div>
              ),
              sort: { name: '￿', subtitle: '', titles: -1 },
              cells: {
                name:     <div style={{ fontFamily: SERIF, fontSize: 14, fontStyle: 'italic', color: 'var(--onyx-text-mute)' }}>New collection…</div>,
                subtitle: <div style={{ fontSize: 12.5, color: 'var(--onyx-text-mute)' }}>Create an empty collection.</div>,
                titles:   <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)' }}>—</div>,
              },
            },
          ]}
        />
      )}
    </BrowseView>
  );
}
