// One row of the Player's bookmarks/stop-points timeline rail: a connecting
// line + dot, then time/label/meta. Pure props → JSX; kept as a render helper
// (not a mounted component) so the caller's list keys stay on the button.
// Moved verbatim out of Player.tsx (God-File Decomposition roadmap, L3/L7).

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const MONO = "'JetBrains Mono', ui-monospace, monospace";

export interface RailRowOpts {
  keyId: string;
  time: string;
  label: string;
  italic: boolean;
  meta?: string;
  accent: boolean;
  isLast: boolean;
  onClick: () => void;
}

export const railRow = (opts: RailRowOpts) => (
  <button key={opts.keyId} onClick={opts.onClick} style={{ display: 'flex', gap: 14, width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', color: 'inherit', padding: 0 }}>
    {/* Rail: vertical connector (omitted on the last row) + the dot */}
    <div style={{ position: 'relative', width: 14, flexShrink: 0, alignSelf: 'stretch', display: 'flex', justifyContent: 'center' }}>
      {!opts.isLast && <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 14, bottom: -2, width: 1, background: 'var(--onyx-line)' }} />}
      <div style={{ position: 'absolute', top: 4, width: 9, height: 9, borderRadius: '50%', background: opts.accent ? 'var(--onyx-accent)' : 'var(--onyx-text-mute)', boxShadow: opts.accent ? '0 0 8px var(--onyx-accent)' : 'none' }} />
    </div>
    {/* Content */}
    <div style={{ flex: 1, minWidth: 0, paddingBottom: 18 }}>
      <div style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, color: 'var(--onyx-accent)' }}>{opts.time}</div>
      <div style={{ fontFamily: SERIF, fontStyle: opts.italic ? 'italic' : 'normal', fontSize: 14, color: 'var(--onyx-text)', lineHeight: 1.3, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis' }}>{opts.label}</div>
      {opts.meta && <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.04em', marginTop: 5 }}>{opts.meta}</div>}
    </div>
  </button>
);
