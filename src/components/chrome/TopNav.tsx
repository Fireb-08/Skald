import { useEffect } from 'react';
import type { OnyxState } from '../../state/onyx';
import Glass from './Glass';
import Icon from '../Icon';

export interface TopNavProps {
  st: OnyxState;
}

export default function TopNav({ st }: TopNavProps) {
  const mono = "'JetBrains Mono', ui-monospace, monospace";

  const items = [
    st.showHome && { id: 'home', label: 'Home' },
    { id: 'library', label: 'Library' },
  ].filter(Boolean) as { id: string; label: string }[];

  useEffect(() => {
    if (!st.showHome && st.screen === 'home') st.setScreen('library');
  }, [st.showHome, st.screen]); // eslint-disable-line react-hooks/exhaustive-deps

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
            padding: '8px 38px 8px 34px',
            background: 'rgba(0,0,0,0.3)', borderRadius: 8,
            fontSize: 12, color: 'var(--onyx-text)',
            border: '1px solid var(--onyx-line)', outline: 'none', fontFamily: 'inherit',
          }}
        />
        <div style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontFamily: mono, fontSize: 10, padding: '1px 5px', border: '1px solid var(--onyx-glass-edge)', borderRadius: 4, color: 'var(--onyx-text-mute)', pointerEvents: 'none' }}>Ctrl+K</div>
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
