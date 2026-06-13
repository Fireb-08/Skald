import type { OnyxState } from '../../state/onyx';
import type { SearchScope } from '../../lib/shelfFilters';
import Glass from './Glass';
import Icon from '../Icon';

export interface TopNavProps {
  st: OnyxState;
}

export default function TopNav({ st }: TopNavProps) {
  const mono = "'JetBrains Mono', ui-monospace, monospace";

  const items: { id: string; label: string }[] = [
    { id: 'library', label: 'Library' },
  ];

  return (
    <Glass translucent={st.translucent} style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 18, overflow: 'visible' }}>
      {/* overflow: visible — active tab underline protrudes below via position:absolute, must not be clipped */}
      {items.map(n => {
        const active = st.screen === n.id;
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
