import Icon from '../Icon';
import type { OnyxState } from '../../state/onyx';

const MONO = "'JetBrains Mono', ui-monospace, monospace";

export interface ViewModeToggleProps {
  st: OnyxState;
}

const MODES = [
  { id: 'grid', icon: 'grid', label: 'Grid' },
  { id: 'list', icon: 'list', label: 'List' },
] as const;

export default function ViewModeToggle({ st }: ViewModeToggleProps) {
  return (
    <div style={{
      display: 'flex', padding: 3, gap: 2,
      background: 'var(--onyx-glass)', border: '1px solid var(--onyx-glass-edge)', borderRadius: 8,
    }}>
      {MODES.map(m => {
        const active = st.libraryView === m.id;
        return (
          <button key={m.id} onClick={() => st.setLibraryView(m.id)} title={`${m.label} view`} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
            background: active ? 'var(--onyx-accent-dim)' : 'transparent',
            border: 'none',
            color: active ? 'var(--onyx-accent)' : 'var(--onyx-text-dim)',
            fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase',
            fontWeight: active ? 600 : 400,
          }}>
            <Icon name={m.icon} size={13} />
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
