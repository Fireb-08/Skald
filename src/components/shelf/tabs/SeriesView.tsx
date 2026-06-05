import { useState, useEffect } from 'react';
import type { OnyxState, LibraryItem } from '../../../state/onyx';
import { groupMatchesFilter } from '../../../lib/shelfFilters';
import { bookTitle, bookAuthor, bookSeries, bookDurSecs } from '../../../state/onyx';
import type { SeriesObject, Series } from '../../../api/abs';
import { getLibrarySeries } from '../../../api/abs';
import BrowseView, { posterTile, seriesTotalDur } from '../BrowseView';
import BrowseList from '../BrowseList';
import CoverFan from '../CoverFan';
import Cover from '../../Cover';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const MONO = "'JetBrains Mono', ui-monospace, monospace";

interface SeriesGroup {
  id?: string;
  name: string;
  books: LibraryItem[];
}

// Extract series name from the full series object (preferred) or fall back to flat seriesName.
function seriesNameOf(b: LibraryItem): string {
  const s = b.media?.metadata?.series as SeriesObject | SeriesObject[] | null | undefined;
  if (s) {
    const first = Array.isArray(s) ? s[0] : s;
    if (first?.name) return first.name;
  }
  return bookSeries(b) ?? '';
}

function seriesVolOf(b: LibraryItem): number {
  const s = b.media?.metadata?.series as SeriesObject | SeriesObject[] | null | undefined;
  if (s) {
    const first = Array.isArray(s) ? s[0] : s;
    const seq = first?.sequence;
    if (typeof seq === 'number') return seq;
    if (typeof seq === 'string') return parseFloat(seq) || 0;
  }
  const flat = bookSeries(b) ?? '';
  const h = flat.match(/#(\d+)/);
  if (h) return parseInt(h[1], 10);
  const d = flat.match(/·\s*(\d+)/);
  return d ? parseInt(d[1], 10) : 0;
}


export interface SeriesViewProps {
  st: OnyxState;
  inline?: boolean;
}

export default function SeriesView({ st, inline = false }: SeriesViewProps) {
  // Fetch the canonical series list from the dedicated endpoint — gives clean names and IDs.
  const [fetchedSeries, setFetchedSeries] = useState<Series[]>([]);
  useEffect(() => {
    if (!st.serverUrl || !st.currentLibraryId) return;
    getLibrarySeries(st.serverUrl, st.currentLibraryId)
      .then(setFetchedSeries)
      .catch(console.error);
  }, [st.serverUrl, st.currentLibraryId]);

  // For each fetched series, find matching books from the local library by series ID.
  // Falls back to name matching for books whose series field lacks an ID (minified responses).
  let seriesList: SeriesGroup[] = fetchedSeries.map(s => {
    const books = st.library
      .filter(b => {
        const bSeries = b.media?.metadata?.series as SeriesObject | SeriesObject[] | null | undefined;
        if (bSeries) {
          const arr = Array.isArray(bSeries) ? bSeries : [bSeries];
          if (arr.some(so => so.id === s.id)) return true;
        }
        // Fallback: match by cleaned name if series object/ID is absent (bulk library endpoint).
        return seriesNameOf(b) === s.name;
      })
      .slice()
      .sort((a, b) => seriesVolOf(a) - seriesVolOf(b));
    return { id: s.id, name: s.name, books };
  }).filter(s => s.books.length > 0);

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

  console.log('[SeriesView] series count:', seriesList.length, 'first item:', seriesList[0]);

  return (
    <BrowseView st={st} title="Series" subtitle={`${seriesList.length} series in your library`} showModeToggle inline={inline}>
      {st.libraryView === 'grid' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 22 }}>
          {seriesList.map(s => (
            <button key={s.name} onClick={() => openSeries(s.name, s.id)} className="onyx-poster" style={posterTile()}>
              <CoverFan books={s.books.slice(0, 5)} serverUrl={st.serverUrl} />
              <div style={{ padding: '18px 16px 16px', textAlign: 'center' }}>
                <div style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 500, lineHeight: 1.1, color: 'var(--onyx-text)', letterSpacing: '-0.01em' }}>{s.name}</div>
                <div style={{ fontSize: 13, color: 'var(--onyx-text-dim)', marginTop: 6, fontStyle: 'italic' }}>{bookAuthor(s.books[0])}</div>
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
