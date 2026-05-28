import type { OnyxState } from '../../state/onyx';
import { LIBRARY } from '../../state/onyx';
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

function seriesNameOf(s: string | undefined) { return (s || '').split(' · ')[0]; }
function seriesVolOf(s: string | undefined)  { return parseInt((s || '').split(' · ')[1] || '0', 10); }

export interface ShelfHeaderProps {
  st: OnyxState;
}

export default function ShelfHeader({ st }: ShelfHeaderProps) {
  // Compute filtered + shelfBooks counts for the library-tab subtitle.
  const filtered = LIBRARY.filter(b => {
    if (st.contextFilter) {
      const { kind, value, bookIds } = st.contextFilter;
      if (kind === 'series'     && seriesNameOf(b.series) !== value)         return false;
      if (kind === 'author'     && b.author   !== value)                      return false;
      if (kind === 'narrator'   && b.narrator !== value)                      return false;
      if (kind === 'collection' && !(bookIds ?? []).includes(b.id))           return false;
    }
    if (!st.showFinished && b.progress >= 0.98 && st.filter !== 'finished')  return false;
    if (st.filter === 'reading'  && !b.progress)   return false;
    if (st.filter === 'unread'   &&  b.progress)   return false;
    if (st.filter === 'finished' &&  b.progress < 0.98) return false;
    if (st.search) {
      const q = st.search.toLowerCase();
      if (
        !b.title.toLowerCase().includes(q) &&
        !b.author.toLowerCase().includes(q) &&
        !(b.series || '').toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  if (st.contextFilter?.kind === 'series') {
    filtered.sort((a, b) => seriesVolOf(a.series) - seriesVolOf(b.series));
  } else if (st.librarySort === 'title') {
    filtered.sort((a, b) => a.title.localeCompare(b.title));
  } else if (st.librarySort === 'author') {
    filtered.sort((a, b) => a.author.localeCompare(b.author) || a.title.localeCompare(b.title));
  } else if (st.librarySort === 'most-listened') {
    filtered.sort((a, b) => (b.progress || 0) - (a.progress || 0));
  }

  let shelfCount = filtered.length;
  if (st.groupBySeries && st.contextFilter?.kind !== 'series') {
    const seen = new Set<string>();
    shelfCount = filtered.filter(b => {
      const name = seriesNameOf(b.series);
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

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '8px 4px 14px' }}>

      {/* Left — title + count + context filter pill (library tab only) */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, minWidth: 0, flexShrink: 0 }}>
        {isLibrary && (
          <>
            <div style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 500, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {st.contextFilter ? st.contextFilter.value : 'The shelf'}
            </div>
            <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.1em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
              {countText}
            </div>
            {st.contextFilter && (
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
          </>
        )}
      </div>

      {/* Center — ShelfTabs (always visible) */}
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

      {/* Right — ViewModeToggle + filter pills (library tab only) */}
      {isLibrary && (
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
      )}

    </div>
  );
}
