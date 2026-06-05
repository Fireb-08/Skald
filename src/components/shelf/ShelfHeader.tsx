import { useState, useRef, useEffect } from 'react';
import type { OnyxState } from '../../state/onyx';
import {
  bookTitle, bookAuthor, bookSeries, bookNarrator, bookProgress,
} from '../../state/onyx';
import ViewModeToggle from './ViewModeToggle';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const MONO = "'JetBrains Mono', ui-monospace, monospace";

const TABS = [
  { id: 'library',     label: 'Home'        },
  { id: 'series',      label: 'Series'      },
  { id: 'authors',     label: 'Authors'     },
  { id: 'narrators',   label: 'Narrators'   },
  { id: 'collections', label: 'Collections' },
];

const FILTER_PILLS = [
  { id: 'all',      l: 'All'      },
  { id: 'reading',  l: 'Reading'  },
  { id: 'unread',   l: 'Unread'   },
  { id: 'finished', l: 'Finished' },
];

function seriesNameOf(s: string | undefined) { return (s || '').replace(/#\d+.*$/, '').replace(/\s*·\s*\d+.*$/, '').trim(); }
function seriesVolOf(s: string | undefined)  { const h = (s || '').match(/#(\d+)/); if (h) return parseInt(h[1], 10); const d = (s || '').match(/·\s*(\d+)/); return d ? parseInt(d[1], 10) : 0; }

export interface ShelfHeaderProps {
  st: OnyxState;
}

export default function ShelfHeader({ st }: ShelfHeaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(9999);

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
      const { kind, value, bookIds } = st.contextFilter;
      if (kind === 'series'     && seriesNameOf(bookSeries(b)) !== value)       return false;
      if (kind === 'author'     && bookAuthor(b)   !== value)                    return false;
      if (kind === 'narrator'   && bookNarrator(b) !== value)                    return false;
      if (kind === 'collection' && !(bookIds ?? []).includes(b.id))              return false;
    }
    const prog = bookProgress(b, st.mediaProgress);
    if (!st.showFinished && prog >= 0.98 && st.filter !== 'finished') return false;
    if (st.filter === 'reading'  && !prog)      return false;
    if (st.filter === 'unread'   &&  prog)      return false;
    if (st.filter === 'finished' &&  prog < 0.98) return false;
    if (st.search) {
      const q = st.search.toLowerCase();
      if (
        !bookTitle(b).toLowerCase().includes(q) &&
        !bookAuthor(b).toLowerCase().includes(q) &&
        !(bookSeries(b) || '').toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  if (st.contextFilter?.kind === 'series') {
    filtered.sort((a, b) => seriesVolOf(bookSeries(a)) - seriesVolOf(bookSeries(b)));
  } else if (st.librarySort === 'title') {
    filtered.sort((a, b) => bookTitle(a).localeCompare(bookTitle(b)));
  } else if (st.librarySort === 'author') {
    filtered.sort((a, b) => bookAuthor(a).localeCompare(bookAuthor(b)) || bookTitle(a).localeCompare(bookTitle(b)));
  } else if (st.librarySort === 'most-listened') {
    filtered.sort((a, b) => bookProgress(b, st.mediaProgress) - bookProgress(a, st.mediaProgress));
  }

  const isLibrary = st.shelfTab === 'library';

  const subtitleText = (() => {
    switch (st.shelfTab) {
      case 'series': {
        const n = new Set(st.library.map(b => seriesNameOf(bookSeries(b))).filter(Boolean)).size;
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
      case 'collections':
        return 'collections';
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
                // Hide Collections tab when horizontal space is insufficient.
                // containerWidth measures the full ShelfHeader; 400px leaves enough room
                // for all other tabs. Adjust threshold after testing if needed.
                if (t.id === 'collections' && containerWidth <= 400) return false;
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
            {pillsInline && filterPills}
          </div>
        )}

      </div>

      {/* Second row — shown below 900px */}
      {!pillsInline && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 10 }}>
          {!toggleInline && <ViewModeToggle st={st} />}
          {filterPills}
        </div>
      )}

    </div>
  );
}
