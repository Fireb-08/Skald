import type { OnyxState } from '../state/onyx';
import { LIBRARY, parseDur } from '../state/onyx';
import Glass from './chrome/Glass';
import Cover from './Cover';
import Icon from './Icon';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const MONO = "'JetBrains Mono', ui-monospace, monospace";

export interface PickItUpProps {
  st: OnyxState;
}

export default function PickItUp({ st }: PickItUpProps) {
  const inProg = LIBRARY.filter(b => b.progress > 0);

  if (inProg.length === 0 || st.filter !== 'all' || st.search || st.contextFilter) {
    return null;
  }

  const openBook = (id: string) => {
    st.setCurrentBookId(id);
    if (id !== st.currentBookId) {
      const b = LIBRARY.find(x => x.id === id);
      st.setPosition((b?.progress ?? 0) * parseDur(b?.dur ?? '0h 0m'));
    }
    st.setScreen('player');
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '0 4px 12px' }}>
        <button
          onClick={() => st.setPickItUpCollapsed(!st.pickItUpCollapsed)}
          title={st.pickItUpCollapsed ? 'Expand Pick it up' : 'Collapse Pick it up'}
          style={{ display: 'flex', alignItems: 'baseline', gap: 12, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', color: 'inherit' }}
        >
          <div style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 500, letterSpacing: '-0.01em', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              display: 'inline-flex',
              color: 'var(--onyx-text-mute)',
              transform: st.pickItUpCollapsed ? 'rotate(-90deg)' : 'none',
              transition: 'transform 0.18s',
            }}>
              <Icon name="chevron-down" size={13} />
            </span>
            Pick it up
          </div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            {inProg.length} in progress
          </div>
        </button>
      </div>
      {!st.pickItUpCollapsed && (
        <div style={{ display: 'flex', gap: 14 }}>
          {inProg.map(b => (
            <Glass key={b.id} translucent={st.translucent} onClick={() => openBook(b.id)} style={{ flex: 1, padding: 14, display: 'flex', gap: 14, minHeight: 110, cursor: 'pointer' }}>
              <Cover item={b} size={80} />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontFamily: MONO, fontSize: 9, color: 'var(--onyx-text-mute)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>{b.series}</div>
                <div style={{ marginTop: 4, fontFamily: SERIF, fontSize: 17, fontWeight: 500, lineHeight: 1.1 }}>{b.title}</div>
                <div style={{ marginTop: 2, fontSize: 12, color: 'var(--onyx-text-dim)' }}>{b.author}</div>
                <div style={{ flex: 1 }} />
                <div style={{ height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ width: `${b.progress * 100}%`, height: '100%', background: 'var(--onyx-accent)' }} />
                </div>
                <div style={{ marginTop: 4, fontFamily: MONO, fontSize: 9.5, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{Math.round(b.progress * 100)}%</span><span>{b.dur}</span>
                </div>
              </div>
            </Glass>
          ))}
        </div>
      )}
    </div>
  );
}
