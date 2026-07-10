import { useEffect, useRef, useState } from 'react';
import type { OnyxState } from '../state/onyx';
import Icon from './Icon';

export interface ActivityCenterProps { st: OnyxState; }
const MONO = "'JetBrains Mono', ui-monospace, monospace";

function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

export default function ActivityCenter({ st }: ActivityCenterProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); } };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: 'fixed', top: 52, right: 16, zIndex: 850 }}>
      <button ref={triggerRef} type="button" aria-label={`Recent activity${st.activity.length ? `, ${st.activity.length} items` : ''}`} aria-haspopup="dialog" aria-expanded={open} aria-controls="onyx-activity-center" title="Recent activity" onClick={() => setOpen(value => !value)} style={{ position: 'relative', width: 34, height: 34, display: 'grid', placeItems: 'center', borderRadius: 9, border: '1px solid var(--onyx-glass-edge)', background: 'var(--onyx-panel2)', color: 'var(--onyx-text-dim)', cursor: 'pointer', boxShadow: '0 8px 20px rgba(0,0,0,0.25)' }}>
        <Icon name="bell" size={15} />
        {st.activity.length > 0 && <span aria-hidden="true" style={{ position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, padding: '0 3px', boxSizing: 'border-box', borderRadius: 8, background: 'var(--onyx-accent)', color: 'var(--onyx-bg)', font: `700 9px/16px ${MONO}`, textAlign: 'center' }}>{Math.min(99, st.activity.length)}</span>}
      </button>
      {open && (
        <section id="onyx-activity-center" role="dialog" aria-modal="false" aria-labelledby="onyx-activity-title" style={{ position: 'absolute', top: 42, right: 0, width: 360, maxHeight: 420, overflow: 'auto', padding: 14, borderRadius: 12, border: '1px solid var(--onyx-glass-edge)', background: 'var(--onyx-panel2)', boxShadow: '0 24px 60px rgba(0,0,0,0.5)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <h2 id="onyx-activity-title" style={{ margin: 0, fontFamily: MONO, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Recent activity</h2>
            {st.activity.length > 0 && <button type="button" onClick={st.clearActivity} style={{ border: 0, background: 'transparent', color: 'var(--onyx-text-dim)', cursor: 'pointer', fontFamily: MONO, fontSize: 9 }}>Clear</button>}
          </div>
          {st.activity.length === 0 ? <div style={{ padding: '24px 8px', color: 'var(--onyx-text-mute)', fontSize: 12, textAlign: 'center' }}>No recent background activity.</div> : st.activity.map(entry => (
            <div key={entry.id} style={{ display: 'grid', gridTemplateColumns: '8px 1fr auto', gap: 9, alignItems: 'start', padding: '10px 4px', borderTop: '1px solid var(--onyx-line)' }}>
              <span aria-hidden="true" style={{ width: 7, height: 7, marginTop: 5, borderRadius: '50%', background: entry.outcome === 'error' ? '#e05a5a' : entry.outcome === 'success' ? '#52c97a' : 'var(--onyx-accent)' }} />
              <div><div style={{ color: 'var(--onyx-text)', fontSize: 12.5, lineHeight: 1.4 }}>{entry.message}</div><div style={{ marginTop: 3, color: 'var(--onyx-text-mute)', fontFamily: MONO, fontSize: 8.5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{entry.category}</div></div>
              <time dateTime={new Date(entry.timestamp).toISOString()} style={{ color: 'var(--onyx-text-mute)', fontFamily: MONO, fontSize: 8.5, whiteSpace: 'nowrap' }}>{relativeTime(entry.timestamp)}</time>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
