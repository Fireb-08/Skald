import type { OnyxState } from '../state/onyx';
import {
  bookTitle, bookAuthor, bookSeries, bookDur,
  bookProgress, bookCurrentTime,
} from '../state/onyx';
import Glass from './chrome/Glass';
import Cover from './Cover';
import Icon from './Icon';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const MONO = "'JetBrains Mono', ui-monospace, monospace";

export interface PickItUpProps {
  st: OnyxState;
}

export default function PickItUp({ st }: PickItUpProps) {
  const inProg = st.library.filter(b => bookProgress(b, st.mediaProgress) > 0);

  if (inProg.length === 0 || st.search || st.contextFilter) {
    return null;
  }

  const openBook = (id: string) => {
    st.setCurrentBookId(id);
    if (id !== st.currentBookId) {
      const b = st.library.find(x => x.id === id);
      if (b) st.setPosition(bookCurrentTime(b, st.mediaProgress));
    }
    st.setScreen('player');
  };

  return (
    <div style={{ minWidth: 0 }}>
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
        <div className="pickitup-scroll" style={{ display: 'flex', flexDirection: 'row', width: '100%', minWidth: 0, gap: 14, overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch', paddingBottom: 8 }}>
          {inProg.map(b => {
            const prog = bookProgress(b, st.mediaProgress);
            return (
              <Glass key={b.id} translucent={st.translucent} onClick={() => openBook(b.id)} style={{ flexGrow: 0, flexShrink: 0, flexBasis: 260, padding: 14, display: 'flex', gap: 14, minHeight: 110, cursor: 'pointer' }}>
                <Cover item={b} size={80} serverUrl={st.serverUrl} />
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ fontFamily: MONO, fontSize: 9, color: 'var(--onyx-text-mute)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>{bookSeries(b)}</div>
                  <div style={{ marginTop: 4, fontFamily: SERIF, fontSize: 17, fontWeight: 500, lineHeight: 1.1 }}>{bookTitle(b)}</div>
                  <div style={{ marginTop: 2, fontSize: 12, color: 'var(--onyx-text-dim)' }}>{bookAuthor(b)}</div>
                  <div style={{ flex: 1 }} />
                  <div style={{ height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${prog * 100}%`, height: '100%', background: 'var(--onyx-accent)' }} />
                  </div>
                  <div style={{ marginTop: 4, fontFamily: MONO, fontSize: 9.5, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em', display: 'flex', justifyContent: 'space-between' }}>
                    <span>{Math.round(prog * 100)}%</span><span>{bookDur(b)}</span>
                  </div>
                </div>
              </Glass>
            );
          })}
        </div>
      )}
    </div>
  );
}
