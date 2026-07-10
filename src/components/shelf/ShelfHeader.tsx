import { useState, useRef, useEffect } from 'react';
import type { OnyxState, LibraryItem } from '../../state/onyx';
import {
  bookTitle, bookAuthor, bookSeries, bookNarrator, bookProgress, bookGenres, bookPublisher,
} from '../../state/onyx';
import { advFilterActive, bookMatchesAdvFilter, naturalTitleCompare, searchScopeMatch } from '../../lib/shelfFilters';
import type { SeriesObject } from '../../api/abs';
import { getLibrarySeries } from '../../api/abs';
import ViewModeToggle from './ViewModeToggle';
import FilterPopover from './FilterPopover';
import { log } from '../../lib/log';
import { isServerOnlyShelfTab } from '../../lib/shelfTabs';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const MONO = "'JetBrains Mono', ui-monospace, monospace";

// Core tabs are always shown; optional ones are toggled in Settings → Library →
// Display (st.optionalTabs), defaulting off to keep the bar short.
const TABS: { id: string; label: string; optional?: boolean }[] = [
  { id: 'library',     label: 'Home'        },
  { id: 'series',      label: 'Series'      },
  { id: 'authors',     label: 'Authors'     },
  { id: 'narrators',   label: 'Narrators',   optional: true },
  { id: 'genres',      label: 'Genres',      optional: true },
  { id: 'publishers',  label: 'Publishers',  optional: true },
  { id: 'collections', label: 'Collections' },
  { id: 'playlists',   label: 'Playlists',   optional: true },
];

// The optional tab ids — shared with the settings toggles and the fallback guard.
export const OPTIONAL_TAB_IDS = ['narrators', 'genres', 'publishers', 'playlists'] as const;

const FILTER_PILLS = [
  { id: 'all',      l: 'All'      },
  { id: 'reading',  l: 'Reading'  },
  { id: 'unread',   l: 'Unread'   },
  { id: 'finished', l: 'Finished' },
];

// Extract series name from the full series object (preferred) or fall back to the flat seriesName string.
// ABS series field may be a single object or an array — handle both shapes.
function seriesNameOf(b: LibraryItem): string {
  const s = b.media?.metadata?.series as SeriesObject | SeriesObject[] | null | undefined;
  if (s) {
    const first = Array.isArray(s) ? s[0] : s;
    if (first?.name) return first.name;
  }
  // Fall back to flat seriesName for minified responses that omit the object.
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
  // Fall back to parsing the flat seriesName string for legacy responses.
  const flat = bookSeries(b) ?? '';
  const h = flat.match(/#(\d+)/);
  if (h) return parseInt(h[1], 10);
  const d = flat.match(/·\s*(\d+)/);
  return d ? parseInt(d[1], 10) : 0;
}

export interface ShelfHeaderProps {
  st: OnyxState;
}

export default function ShelfHeader({ st }: ShelfHeaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(9999);
  const isLocalLibrary = st.activeLibrary?.source === 'local';
  const isAllLibraries = st.activeLibrary?.source === 'all';

  // If the active tab is an optional one that's been hidden, fall back to Home so
  // the user isn't stranded on a view with no corresponding (highlighted) tab.
  useEffect(() => {
    const optionalHidden = OPTIONAL_TAB_IDS.includes(st.shelfTab as typeof OPTIONAL_TAB_IDS[number]) && !st.optionalTabs[st.shelfTab];
    const unavailableForSource = (isLocalLibrary && isServerOnlyShelfTab(st.shelfTab))
      || (isAllLibraries && st.shelfTab !== 'library');
    if (optionalHidden || unavailableForSource) {
      log.debug('library', 'reset unavailable shelf tab', { tab: st.shelfTab, source: isLocalLibrary ? 'local' : 'abs' });
      st.setShelfTab('library');
    }
  }, [st.shelfTab, st.optionalTabs, isLocalLibrary, isAllLibraries]); // eslint-disable-line react-hooks/exhaustive-deps

  // Canonical series count from GET /api/libraries/{id}/series — the same
  // authoritative source SeriesView uses. Deriving the count from a Set of
  // series names over st.library miscounts (the bulk library response omits
  // series objects for many books and falls back to the flat seriesName string),
  // so we fetch the real list and use its length for the subtitle.
  const [seriesCount, setSeriesCount] = useState<number | null>(null);
  useEffect(() => {
    if (isLocalLibrary || isAllLibraries || !st.serverUrl || !st.currentLibraryId) { setSeriesCount(null); return; }
    let cancelled = false;
    getLibrarySeries(st.serverUrl, st.currentLibraryId)
      .then(list => { if (!cancelled) setSeriesCount(list.length); })
      .catch(e => log.error('library', 'series count fetch failed', { err: String(e) }));
    return () => { cancelled = true; };
  }, [st.serverUrl, st.currentLibraryId, isLocalLibrary, isAllLibraries]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      setContainerWidth(entries[0]?.contentRect.width ?? el.clientWidth);
    });
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const pillsInline  = containerWidth >= 900;
  const toggleInline = containerWidth >= 700;
  const filtered = st.library.filter(b => {
    if (st.contextFilter) {
      const { kind, value, bookIds, seriesId } = st.contextFilter;
      if (kind === 'series') {
        if (seriesId) {
          // Match by series ID when available — exact, unambiguous.
          const bSeries = b.media?.metadata?.series as SeriesObject | SeriesObject[] | null | undefined;
          const arr = Array.isArray(bSeries) ? bSeries : bSeries ? [bSeries] : [];
          if (!arr.some(s => s.id === seriesId)) {
            // Fall back to name comparison for books that lack a series.id (bulk library response).
            if (seriesNameOf(b) !== value) return false;
          }
        } else if (seriesNameOf(b) !== value) {
          return false;
        }
      }
      if (kind === 'author'     && bookAuthor(b)   !== value)                    return false;
      if (kind === 'narrator'   && bookNarrator(b) !== value)                    return false;
      if (kind === 'genre'      && !bookGenres(b).includes(value))               return false;
      if (kind === 'publisher'  && bookPublisher(b) !== value)                   return false;
      if ((kind === 'collection' || kind === 'playlist') && !(bookIds ?? []).includes(b.id)) return false;
    }
    if (advFilterActive(st.advFilter) && !bookMatchesAdvFilter(b, st.advFilter)) return false;
    const prog = bookProgress(b, st.mediaProgress);
    if (!st.showFinished && prog >= 0.98 && st.filter !== 'finished') return false;
    if (st.filter === 'reading'  && !prog)      return false;
    if (st.filter === 'unread'   &&  prog)      return false;
    if (st.filter === 'finished' &&  prog < 0.98) return false;
    if (st.search && !searchScopeMatch(st.search, st.searchScope, bookTitle(b), bookAuthor(b), bookSeries(b) || '')) return false;
    return true;
  });

  if (st.contextFilter?.kind === 'series') {
    filtered.sort((a, b) => seriesVolOf(a) - seriesVolOf(b));
  } else if (st.librarySort === 'title') {
    const prefixes = st.serverSettings?.sortingIgnorePrefix ? (st.serverSettings.sortingPrefixes ?? []) : [];
    filtered.sort((a, b) => naturalTitleCompare(bookTitle(a), bookTitle(b), prefixes));
  } else if (st.librarySort === 'author') {
    filtered.sort((a, b) => bookAuthor(a).localeCompare(bookAuthor(b)) || bookTitle(a).localeCompare(bookTitle(b)));
  } else if (st.librarySort === 'most-listened') {
    filtered.sort((a, b) => bookProgress(b, st.mediaProgress) - bookProgress(a, st.mediaProgress));
  }

  const isLibrary = st.shelfTab === 'library';

  const subtitleText = (() => {
    switch (st.shelfTab) {
      case 'series': {
        // Prefer the canonical count from the series endpoint; fall back to the
        // library-derived estimate only while that fetch is still in flight.
        const n = seriesCount ?? new Set(st.library.map(b => seriesNameOf(b)).filter(Boolean)).size;
        return `${n} series`;
      }
      case 'authors': {
        const n = new Set(st.library.map(b => bookAuthor(b)).filter(Boolean)).size;
        return `${n} authors`;
      }
      case 'narrators': {
        const n = new Set(st.library.map(b => bookNarrator(b)).filter(Boolean)).size;
        return `${n} narrators`;
      }
      case 'genres': {
        const set = new Set<string>();
        st.library.forEach(b => bookGenres(b).forEach(g => { if (g) set.add(g); }));
        return `${set.size} genres`;
      }
      case 'publishers': {
        const n = new Set(st.library.map(b => bookPublisher(b)).filter(Boolean)).size;
        return `${n} publishers`;
      }
      case 'collections':
        return 'collections';
      case 'playlists':
        return 'playlists';
      default: {
        let t = `${filtered.length} title${filtered.length === 1 ? '' : 's'}`;
        if (st.search) t += ` matching "${st.search}"`;
        return t;
      }
    }
  })();

  const filterPills = FILTER_PILLS.map(f => (
    <button key={f.id} onClick={() => st.setFilter(f.id)} style={{
      padding: '5px 10px', borderRadius: 999, cursor: 'pointer',
      background: st.filter === f.id ? 'var(--onyx-accent-dim)' : 'transparent',
      border: `1px solid ${st.filter === f.id ? 'var(--onyx-accent-edge)' : 'transparent'}`,
      color: st.filter === f.id ? 'var(--onyx-accent)' : 'var(--onyx-text-mute)',
      fontFamily: MONO, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
    }}>{f.l}</button>
  ));

  return (
    <div ref={containerRef} style={{ padding: '8px 4px 14px' }}>

      {/* Main row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <div style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 500, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {/* Always show "The shelf" — active filter is indicated by the pill row below */}
              The shelf
            </div>
          </div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {subtitleText}
          </div>
          {/* Context filter pill — own row beneath the shelf title, left-aligned */}
          {isLibrary && st.contextFilter && (
            <div style={{ display: 'flex', alignItems: 'center', paddingBottom: 14 /* Extra bottom padding clears the TopNav tab underline indicator which protrudes below the nav bar */ }}>
              <button onClick={() => st.setContextFilter(null)} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px 4px 10px',
                background: 'var(--onyx-accent-dim)', border: '1px solid var(--onyx-accent-edge)', borderRadius: 999,
                fontFamily: MONO, fontSize: 10, color: 'var(--onyx-accent)', letterSpacing: '0.06em', textTransform: 'uppercase',
                cursor: 'pointer',
              }}>
                <span style={{ fontSize: 9, opacity: 0.7 }}>{st.contextFilter.kind.toUpperCase()}</span>
                {st.contextFilter.value}
                <span style={{ fontSize: 13, marginLeft: 2, lineHeight: 1 }}>×</span>
              </button>
            </div>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'center' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4, padding: '4px',
            background: 'var(--onyx-glass)', border: '1px solid var(--onyx-glass-edge)',
            borderRadius: 10, flexWrap: 'nowrap',
          }}>
            {TABS
              .filter(t => {
                // Optional tabs are shown only when enabled in Settings → Library → Display.
                // The local catalog has no collection or playlist model yet.
                if (isAllLibraries && t.id !== 'library') return false;
                if (isLocalLibrary && isServerOnlyShelfTab(t.id)) return false;
                if (t.optional && !st.optionalTabs[t.id]) return false;
                // Hide Collections and Playlists tabs when horizontal space is insufficient.
                // containerWidth measures the full ShelfHeader; 400px leaves enough room
                // for all other tabs. Adjust threshold after testing if needed.
                if ((t.id === 'collections' || t.id === 'playlists') && containerWidth <= 400) return false;
                return true;
              })
              .map(t => {
                const active = st.shelfTab === t.id;
                return (
                  <button key={t.id} onClick={() => st.setShelfTab(t.id)} style={{
                    padding: '7px 10px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit',
                    background: active ? 'var(--onyx-accent-dim)' : 'transparent',
                    border: `1px solid ${active ? 'var(--onyx-accent-edge)' : 'transparent'}`,
                    color: active ? 'var(--onyx-accent)' : 'var(--onyx-text-dim)',
                    fontSize: 12, fontWeight: active ? 600 : 500,
                    whiteSpace: 'nowrap',
                  }}>
                    {t.label}
                  </button>
                );
              })}
          </div>
        </div>

        {toggleInline && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
            <div style={{ marginRight: pillsInline ? 6 : 0 }}>
              <ViewModeToggle st={st} />
            </div>
            {pillsInline && <>{filterPills}<FilterPopover st={st} /></>}
          </div>
        )}

      </div>

      {/* Partial-coverage notice (review H1) — the combined shelf must never
          present a partial composite as complete. Amber matches the titlebar
          OFFLINE pill family. Retry re-runs the combined load; dismiss hides
          the notice until the next partial load. */}
      {isAllLibraries && st.allLibrariesPartial && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, marginTop: 10,
          padding: '6px 6px 6px 12px', borderRadius: 8, width: 'fit-content',
          border: '1px solid rgba(212,131,74,0.4)', background: 'rgba(212,131,74,0.08)',
          fontFamily: MONO, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
          color: '#d4834a',
        }}>
          <span>
            Showing {st.allLibrariesPartial.loaded} of {st.allLibrariesPartial.total} libraries
            {' — '}{st.allLibrariesPartial.failedNames.join(', ')} unavailable
          </span>
          <button
            onClick={() => { void st.setActiveLibrary(st.currentLibraryId); }}
            style={{
              padding: '3px 10px', borderRadius: 999, cursor: 'pointer',
              background: 'rgba(212,131,74,0.14)', border: '1px solid rgba(212,131,74,0.4)',
              color: '#d4834a', fontFamily: MONO, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
            }}
          >Retry</button>
          <button
            onClick={() => st.dismissAllLibrariesPartial()}
            aria-label="Dismiss"
            style={{
              padding: '3px 8px', borderRadius: 999, cursor: 'pointer',
              background: 'transparent', border: '1px solid transparent',
              color: '#d4834a', fontSize: 13, lineHeight: 1,
            }}
          >×</button>
        </div>
      )}

      {/* Second row — shown below 900px */}
      {!pillsInline && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 10 }}>
          {!toggleInline && <ViewModeToggle st={st} />}
          {filterPills}
          <FilterPopover st={st} />
        </div>
      )}

    </div>
  );
}
