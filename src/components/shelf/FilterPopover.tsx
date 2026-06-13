import { useState, useRef, useEffect } from 'react';
import type { OnyxState } from '../../state/onyx';
import { EMPTY_ADV_FILTER } from '../../lib/shelfFilters';

const MONO = "'JetBrains Mono', ui-monospace, monospace";

// A compact "Filters" button + popover for tag / language / explicit filtering.
// Options are derived client-side from the loaded library (st.library).
export default function FilterPopover({ st }: { st: OnyxState }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const f = st.advFilter;
  const allTags = [...new Set(st.library.flatMap(b => b.media.tags ?? []))].sort((a, b) => a.localeCompare(b));
  const allLangs = [...new Set(st.library.map(b => b.media.metadata.language).filter((l): l is string => !!l))].sort((a, b) => a.localeCompare(b));
  const activeCount = f.tags.length + (f.language ? 1 : 0) + (f.explicit !== 'all' ? 1 : 0);

  const toggleTag = (t: string) => st.setAdvFilter({
    ...f, tags: f.tags.includes(t) ? f.tags.filter(x => x !== t) : [...f.tags, t],
  });

  const chip = (label: string, active: boolean, onClick: () => void) => (
    <button key={label} onClick={onClick} style={{
      fontFamily: MONO, fontSize: 10.5, padding: '4px 9px', borderRadius: 6, cursor: 'pointer',
      background: active ? 'var(--onyx-accent-dim)' : 'transparent',
      border: `1px solid ${active ? 'var(--onyx-accent-edge)' : 'var(--onyx-glass-edge)'}`,
      color: active ? 'var(--onyx-accent)' : 'var(--onyx-text-dim)',
    }}>{label}</button>
  );

  const head = (label: string) => (
    <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--onyx-text-mute)', margin: '12px 0 6px' }}>{label}</div>
  );

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button onClick={() => setOpen(o => !o)} style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 999, cursor: 'pointer',
        fontFamily: MONO, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
        background: activeCount > 0 ? 'var(--onyx-accent-dim)' : 'transparent',
        border: `1px solid ${activeCount > 0 ? 'var(--onyx-accent-edge)' : 'var(--onyx-glass-edge)'}`,
        color: activeCount > 0 ? 'var(--onyx-accent)' : 'var(--onyx-text-mute)',
      }}>
        Filters{activeCount > 0 ? ` · ${activeCount}` : ''}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 400, width: 280, maxHeight: '60vh', overflowY: 'auto',
          background: 'var(--onyx-panel2)', border: '1px solid var(--onyx-glass-edge)', borderRadius: 10,
          boxShadow: '0 16px 44px rgba(0,0,0,0.6)', padding: '10px 14px 14px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--onyx-text-dim)' }}>Filter library</span>
            {activeCount > 0 && (
              <button onClick={() => st.setAdvFilter(EMPTY_ADV_FILTER)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: MONO, fontSize: 10, color: 'var(--onyx-accent)' }}>Clear</button>
            )}
          </div>

          {/* Tags */}
          {allTags.length > 0 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '12px 0 6px' }}>
                <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--onyx-text-mute)' }}>Tags</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {(['include', 'exclude'] as const).map(m => chip(m, f.tagMode === m, () => st.setAdvFilter({ ...f, tagMode: m })))}
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {allTags.map(t => chip(t, f.tags.includes(t), () => toggleTag(t)))}
              </div>
            </>
          )}

          {/* Language */}
          {allLangs.length > 0 && (
            <>
              {head('Language')}
              <select value={f.language} onChange={e => st.setAdvFilter({ ...f, language: e.target.value })} style={{
                width: '100%', fontFamily: MONO, fontSize: 11, background: 'var(--onyx-panel2)', color: 'var(--onyx-text)',
                border: '1px solid var(--onyx-glass-edge)', borderRadius: 6, padding: '6px 8px', cursor: 'pointer',
              }}>
                <option value="">Any language</option>
                {allLangs.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </>
          )}

          {/* Explicit */}
          {head('Explicit content')}
          <div style={{ display: 'flex', gap: 5 }}>
            {([['all', 'All'], ['clean', 'Clean'], ['explicit', 'Explicit']] as const).map(([v, l]) =>
              chip(l, f.explicit === v, () => st.setAdvFilter({ ...f, explicit: v })))}
          </div>
        </div>
      )}
    </div>
  );
}
