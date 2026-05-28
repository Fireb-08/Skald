import type { OnyxState } from '../../state/onyx';
import {
  bookTitle, bookAuthor, bookSeries, bookNarrator, bookProgress,
} from '../../state/onyx';
import ViewModeToggle from './ViewModeToggle';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const MONO = "'JetBrains Mono', ui-monospace, monospace";

const SORT_LABELS: Record<string, string> = {
  recently: 'recently added',
  title: 'title',
  author: 'author',
  'most-listened': 'most listened',
};

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

  let shelfCount = filtered.length;
  if (st.groupBySeries && st.contextFilter?.kind !== 'series') {
    const seen = new Set<string>();
    shelfCount = filtered.filter(b => {
      const name = seriesNameOf(bookSeries(b));
      if (!name) return true;
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    }).length;
  }

  const countText = (() => {
    let t = `${filtered.length} title${filtered.length === 1 ? '' : 's'}`;
    if (st.search) t += ` matching "${st.search}"`;
    if (st.contextFilter?.kind === 'series') {
      t += ' · sort: volume order';
    } else {
      t += ` · sort: ${SORT_LABELS[st.librarySort] ?? 'recently added'}`;
    }
    if (st.groupBySeries && st.contextFilter?.kind !== 'series' && shelfCount !== filtered.length) {
      t += ` · ${shelfCount} series grouped`;
    }
    return t;
  })();

  const isLibrary = st.shelfTab === 'library';

  const tabCountText = (() => {
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
      default:
        return countText;
    }
  })();

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '8px 4px 14px' }}>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, minWidth: 0, flexShrink: 0 }}>
        <div style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 500, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {isLibrary && st.contextFilter ? st.contextFilter.value : 'The shelf'}
        </div>
        <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.1em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
          {tabCountText}
        </div>
        {isLibrary && st.contextFilter && (
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
        )}
      </div>

      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', minWidth: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4, padding: '4px',
          background: 'var(--onyx-glass)', border: '1px solid var(--onyx-glass-edge)',
          borderRadius: 10, alignSelf: 'flex-start',
        }}>
          {TABS.map(t => {
            const active = st.shelfTab === t.id;
            return (
              <button key={t.id} onClick={() => st.setShelfTab(t.id)} style={{
                padding: '7px 14px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit',
                background: active ? 'var(--onyx-accent-dim)' : 'transparent',
                border: `1px solid ${active ? 'var(--onyx-accent-edge)' : 'transparent'}`,
                color: active ? 'var(--onyx-accent)' : 'var(--onyx-text-dim)',
                fontSize: 12.5, fontWeight: active ? 600 : 500,
              }}>
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
        <div style={{ marginRight: 6 }}>
          <ViewModeToggle st={st} />
        </div>
        {FILTER_PILLS.map(f => (
          <button key={f.id} onClick={() => st.setFilter(f.id)} style={{
            padding: '5px 10px', borderRadius: 999, cursor: 'pointer',
            background: st.filter === f.id ? 'var(--onyx-accent-dim)' : 'transparent',
            border: `1px solid ${st.filter === f.id ? 'var(--onyx-accent-edge)' : 'transparent'}`,
            color: st.filter === f.id ? 'var(--onyx-accent)' : 'var(--onyx-text-mute)',
            fontFamily: MONO, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>{f.l}</button>
        ))}
      </div>

    </div>
  );
}
