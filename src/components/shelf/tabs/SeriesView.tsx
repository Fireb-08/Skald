import { useState, useEffect } from 'react';
import type { OnyxState, LibraryItem } from '../../../state/onyx';
import { groupMatchesFilter } from '../../../lib/shelfFilters';
import { bookTitle, bookAuthor, bookDurSecs } from '../../../state/onyx';
import type { SeriesObject, Series } from '../../../api/abs';
import { getLibrarySeries } from '../../../api/abs';
import BrowseView, { seriesTotalDur } from '../BrowseView';
import BrowseList from '../BrowseList';
import BrowseTile from '../BrowseTile';
import Cover from '../../Cover';
import { log } from '../../../lib/log';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const MONO = "'JetBrains Mono', ui-monospace, monospace";

interface SeriesGroup {
  id?: string;
  name: string;
  books: LibraryItem[];
}

// Series sequence lives at media.metadata.series.sequence as a string (decimals possible).
// When series is an array, use the first entry.
function seriesVolOf(b: LibraryItem): number {
  const s = b.media?.metadata?.series as SeriesObject | SeriesObject[] | null | undefined;
  const first = Array.isArray(s) ? s?.[0] : s;
  return parseFloat((first?.sequence as string | number | undefined | null) as string ?? '0') || 0;
}


export interface SeriesViewProps {
  st: OnyxState;
  inline?: boolean;
}

export default function SeriesView({ st, inline = false }: SeriesViewProps) {
  // Local libraries have no server series endpoint — derive series from the
  // loaded items instead. ABS libraries use the dedicated endpoint (clean
  // names/IDs + a books array per series).
  const isLocal = st.activeLibrary?.source === 'local';

  // Fetch the canonical series list from the dedicated endpoint — gives clean names and IDs.
  const [fetchedSeries, setFetchedSeries] = useState<Series[]>([]);
  useEffect(() => {
    if (isLocal || !st.serverUrl || !st.currentLibraryId) return;
    getLibrarySeries(st.serverUrl, st.currentLibraryId)
      .then(setFetchedSeries)
      .catch(e => log.error('library', 'series list fetch failed', { err: String(e) }));
  }, [isLocal, st.serverUrl, st.currentLibraryId]);

  let seriesList: SeriesGroup[];
  if (isLocal) {
    // Group loaded items by seriesName (set by the scanner from folder structure).
    const map = new Map<string, LibraryItem[]>();
    for (const b of st.library) {
      const name = b.media?.metadata?.seriesName;
      if (!name) continue;
      const arr = map.get(name);
      if (arr) arr.push(b); else map.set(name, [b]);
    }
    seriesList = Array.from(map.entries()).map(([name, books]) => ({
      name,
      books: books.slice().sort((a, b) => seriesVolOf(a) - seriesVolOf(b)),
    }));
  } else {
    // Each series from getLibrarySeries already includes its full books list —
    // no client-side matching against st.library is needed or correct.
    seriesList = fetchedSeries.map(s => ({
      id: s.id,
      name: s.name,
      // Sort by series sequence so volumes appear in reading order.
      books: s.books.slice().sort((a, b) => seriesVolOf(a) - seriesVolOf(b)),
    }));
  }

  if (st.search) {
    const q = st.search.toLowerCase();
    seriesList = seriesList.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.books.some(b => bookAuthor(b).toLowerCase().includes(q) || bookTitle(b).toLowerCase().includes(q))
    );
  }

  if (st.filter !== 'all') {
    seriesList = seriesList.filter(s => groupMatchesFilter(s.books, st.filter, st.mediaProgress));
  }

  const openSeries = (name: string, seriesId?: string) => {
    st.setContextFilter({ kind: 'series', value: name, seriesId });
    st.setShelfTab('library');
    st.setScreen('library');
  };

  return (
    <BrowseView st={st} title="Series" subtitle={`${seriesList.length} series in your library`} showModeToggle inline={inline}>
      {st.libraryView === 'grid' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 22 }}>
          {seriesList.map(s => (
            <BrowseTile
              key={s.name}
              mode={st.browseTileStyle}
              tag="Series"
              title={s.name}
              subtitle={bookAuthor(s.books[0])}
              stat={`${s.books.length} ${s.books.length === 1 ? 'VOLUME' : 'VOLUMES'} · ${seriesTotalDur(s.books)}`}
              books={s.books}
              serverUrl={st.serverUrl}
              onClick={() => openSeries(s.name, s.id)}
            />
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
            onClick: () => openSeries(s.name, s.id),
            leading: <Cover item={s.books[0]} size={28} serverUrl={st.serverUrl} />,
            sort: {
              name:   s.name,
              author: bookAuthor(s.books[0]),
              vols:   s.books.length,
              dur:    s.books.reduce((acc, b) => acc + bookDurSecs(b), 0),
            },
            cells: {
              name:   <div style={{ fontFamily: SERIF, fontSize: 14, fontWeight: 500, color: 'var(--onyx-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>,
              author: <div style={{ fontSize: 13, color: 'var(--onyx-text-dim)' }}>{bookAuthor(s.books[0])}</div>,
              vols:   <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)' }}>{s.books.length}</div>,
              dur:    <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)' }}>{seriesTotalDur(s.books)}</div>,
            },
          }))}
        />
      )}
    </BrowseView>
  );
}
