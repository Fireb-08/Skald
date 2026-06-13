import { useState, useRef, useEffect } from 'react';
import type { OnyxState } from '../../state/onyx';
import type { SearchScope } from '../../lib/shelfFilters';
import Glass from './Glass';
import Icon from '../Icon';

export interface TopNavProps {
  st: OnyxState;
}

// Display label for a library in the switcher (podcast libraries are prefixed).
function libraryLabel(l: { name: string; mediaType: string }): string {
  return l.mediaType === 'podcast' ? `Podcasts: ${l.name}` : l.name;
}

export default function TopNav({ st }: TopNavProps) {
  const mono = "'JetBrains Mono', ui-monospace, monospace";
  // Custom library dropdown (a native <select> can't be themed to match Onyx).
  const [libMenuOpen, setLibMenuOpen] = useState(false);
  const [hoverLib, setHoverLib] = useState<string | null>(null);
  const libRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!libMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (libRef.current && !libRef.current.contains(e.target as Node)) setLibMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [libMenuOpen]);

  const items: { id: string; label: string }[] = [
    { id: 'library', label: 'Library' },
  ];

  // Switch the active library and reset the shelf view context so the new
  // library starts clean (no stale search/filter/tab/focus from the old one).
  const switchLibrary = (id: string) => {
    if (id === st.currentLibraryId) { st.setScreen('library'); return; }
    st.setActiveLibrary(id).catch(e => console.error('[library] switch failed:', e));
    st.setScreen('library');
    st.setSearch('');
    st.setContextFilter(null);
    st.setShelfTab('library');
    st.setFocusedBookId(null);
  };

  return (
    <Glass translucent={st.translucent} style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 18, overflow: 'visible' }}>
      {/* overflow: visible — active tab underline protrudes below via position:absolute, must not be clipped */}
      {items.map(n => {
        const active = st.screen === n.id || (n.id === 'library' && st.screen === 'podcast');
        return (
          <button key={n.id} onClick={() => st.setScreen(n.id)} style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 13, fontWeight: active ? 600 : 400,
            color: active ? 'var(--onyx-text)' : 'var(--onyx-text-dim)',
            position: 'relative',
          }}>
            {n.label}
            {active && <div style={{ position: 'absolute', left: 0, right: 0, bottom: -14, height: 2, background: 'var(--onyx-accent)', borderRadius: 1 }} />}
          </button>
        );
      })}

      {/* Library switcher — only shown when the server has more than one library.
          Custom dropdown (black surface; accent highlight on hover/selection) so
          it matches the Onyx UI, which a native <select> cannot. */}
      {st.libraries.length > 1 && (
        <div ref={libRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setLibMenuOpen(o => !o)}
            title="Switch library"
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              fontFamily: mono, fontSize: 11, letterSpacing: '0.04em',
              background: '#000', color: 'var(--onyx-text)',
              border: '1px solid var(--onyx-glass-edge)', borderRadius: 6, padding: '5px 10px', cursor: 'pointer',
              maxWidth: 240,
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {(() => { const a = st.libraries.find(l => l.id === st.currentLibraryId); return a ? libraryLabel(a) : 'Library'; })()}
            </span>
            <span style={{ display: 'inline-flex', color: 'var(--onyx-text-mute)', transform: libMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
              <Icon name="chevron-down" size={12} />
            </span>
          </button>
          {libMenuOpen && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 100, minWidth: 200,
              background: '#000', border: '1px solid var(--onyx-glass-edge)', borderRadius: 8,
              boxShadow: '0 12px 32px rgba(0,0,0,0.6)', padding: 4, overflow: 'hidden',
            }}>
              {st.libraries.map(l => {
                const active = l.id === st.currentLibraryId;
                const hot = hoverLib === l.id || active;
                return (
                  <button
                    key={l.id}
                    onClick={() => { switchLibrary(l.id); setLibMenuOpen(false); }}
                    onMouseEnter={() => setHoverLib(l.id)}
                    onMouseLeave={() => setHoverLib(prev => (prev === l.id ? null : prev))}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 6,
                      background: hot ? 'var(--onyx-accent)' : 'transparent',
                      color: hot ? 'var(--onyx-bg)' : 'var(--onyx-text)',
                      border: 'none', cursor: 'pointer', fontFamily: mono, fontSize: 11, letterSpacing: '0.04em',
                      fontWeight: active ? 600 : 400,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                  >
                    {libraryLabel(l)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      <div style={{ flex: 1, marginLeft: 24, position: 'relative' }}>
        <div style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--onyx-text-mute)', display: 'flex', pointerEvents: 'none' }}>
          <Icon name="search" size={13} />
        </div>
        <input
          id="onyx-search"
          type="text"
          placeholder={`Search ${st.library.length} titles…`}
          value={st.search}
          onChange={(e) => st.setSearch(e.target.value)}
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '8px 92px 8px 34px',
            background: 'rgba(0,0,0,0.3)', borderRadius: 8,
            fontSize: 12, color: 'var(--onyx-text)',
            border: '1px solid var(--onyx-line)', outline: 'none', fontFamily: 'inherit',
          }}
        />
        {/* Search scope — narrows the query to a single field (Ctrl+K still focuses). */}
        <select
          value={st.searchScope}
          onChange={(e) => st.setSearchScope(e.target.value as SearchScope)}
          title="Search field scope"
          style={{
            position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
            fontFamily: mono, fontSize: 10, letterSpacing: '0.04em',
            background: 'rgba(0,0,0,0.3)', color: 'var(--onyx-text-dim)',
            border: '1px solid var(--onyx-glass-edge)', borderRadius: 4, padding: '2px 4px', cursor: 'pointer',
          }}
        >
          <option value="all">All</option>
          <option value="title">Title</option>
          <option value="author">Author</option>
          <option value="series">Series</option>
        </select>
      </div>
      {/* User avatar — initial derived from logged-in username, not hardcoded */}
      <button
        onClick={() => st.setScreen('settings')}
        title="Account & settings"
        style={{
          width: 28, height: 28, borderRadius: '50%',
          background: 'var(--onyx-accent)', color: 'var(--onyx-bg)',
          border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 700, flexShrink: 0,
        }}
      >{(st.user?.username?.[0] ?? '?').toUpperCase()}</button>
    </Glass>
  );
}
