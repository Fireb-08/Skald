import type { CSSProperties } from 'react';

export interface TitlebarProps {
  subtitle?: string;
  isDark: boolean;
}

type DragStyle = CSSProperties & { WebkitAppRegion?: string };

const BUTTONS = [
  { glyph: '–', label: 'Minimize', kind: 'min'   },
  { glyph: '□', label: 'Maximize', kind: 'max'   },
  { glyph: '✕', label: 'Close',    kind: 'close' },
] as const;

const HANDLERS: Record<string, () => void> = {
  min:   () => console.log('[titlebar] minimize'),
  max:   () => console.log('[titlebar] maximize'),
  close: () => console.log('[titlebar] close'),
};

export default function Titlebar({ subtitle, isDark }: TitlebarProps) {
  const themeName = isDark ? 'Onyx' : 'Folio';
  const mono = "'JetBrains Mono', ui-monospace, monospace";

  const bar: DragStyle = {
    position: 'absolute', top: 0, left: 0, right: 0, height: 44,
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '0 18px', zIndex: 50,
    WebkitAppRegion: 'drag',
  };

  const noDrag: DragStyle = {
    display: 'flex', gap: 0,
    WebkitAppRegion: 'no-drag',
    marginRight: -18, height: 44,
  };

  return (
    <div style={bar}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 18, height: 18, borderRadius: 5,
          background: 'var(--onyx-glass-strong)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid var(--onyx-glass-edge)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 700, color: 'var(--onyx-accent)',
        }}>S</div>
        <div style={{ fontFamily: mono, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          Skald · {themeName}{subtitle ? ` · ${subtitle}` : ''}
        </div>
      </div>
      <div style={noDrag}>
        {BUTTONS.map((b) => (
          <button
            key={b.kind}
            className={`onyx-winbtn onyx-winbtn-${b.kind}`}
            title={b.label}
            onClick={HANDLERS[b.kind]}
            style={{
              width: 46, height: 44, borderRadius: 0,
              background: 'transparent', border: 'none',
              color: 'var(--onyx-text-dim)',
              fontSize: b.kind === 'max' ? 11 : 13, lineHeight: 1,
              cursor: 'pointer', padding: 0, fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >{b.glyph}</button>
        ))}
      </div>
    </div>
  );
}
