import { useState, useCallback, createContext, useContext, type ReactNode, type CSSProperties } from 'react';

export const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
export const MONO = "'JetBrains Mono', ui-monospace, monospace";

// Dimmed accent (gold) — used for panel eyebrows and sub-headers across the
// settings facelift. References the live accent tokens so it follows the theme.
export const DIM_GOLD = 'rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.6)';

// Mono uppercase eyebrow label (panel headers, sub-section headers).
export const eyebrowStyle: CSSProperties = {
  fontFamily: MONO, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: DIM_GOLD,
};

export function useLocal<T>(key: string, def: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    const raw = localStorage.getItem(key);
    if (raw === null) return def;
    try { return JSON.parse(raw) as T; } catch { return raw as unknown as T; }
  });
  const set = useCallback((next: T) => {
    setV(next);
    localStorage.setItem(key, JSON.stringify(next));
  }, [key]);
  return [v, set];
}

export interface SectionHeadProps { title: string; subtitle?: string; }
export function SectionHead({ title, subtitle }: SectionHeadProps) {
  return (
    <div style={{ marginBottom: 28, paddingBottom: 18, borderBottom: '1px solid var(--onyx-line)' }}>
      <div style={{ fontFamily: SERIF, fontSize: 26, fontWeight: 500, letterSpacing: '-0.01em' }}>{title}</div>
      {subtitle && <div style={{ marginTop: 6, fontSize: 13.5, color: 'var(--onyx-text-dim)', maxWidth: 540 }}>{subtitle}</div>}
    </div>
  );
}

export interface RowProps { label: string; hint?: string; children?: ReactNode; align?: 'center' | 'top'; }
export function Row({ label, hint, children, align = 'center' }: RowProps) {
  return (
    <div style={{ display: 'flex', alignItems: align === 'top' ? 'flex-start' : 'center', justifyContent: 'space-between', padding: '16px 0', borderBottom: '1px solid var(--onyx-line)', gap: 24 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, color: 'var(--onyx-text)', fontWeight: 500 }}>{label}</div>
        {hint && <div style={{ marginTop: 4, fontSize: 12, color: 'var(--onyx-text-mute)', maxWidth: 480, lineHeight: 1.45 }}>{hint}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

export interface ToggleProps { on: boolean; onChange: (v: boolean) => void; }
export function Toggle({ on, onChange }: ToggleProps) {
  return (
    <button
      onClick={() => onChange(!on)}
      style={{
        width: 36, height: 20, borderRadius: 10, padding: 0,
        background: on ? 'var(--onyx-accent)' : 'rgba(255,255,255,0.12)',
        border: 'none', cursor: 'pointer', position: 'relative',
        transition: 'background 0.15s',
      }}
    >
      <div style={{
        position: 'absolute', top: 2, left: on ? 18 : 2,
        width: 16, height: 16, borderRadius: 8,
        background: on ? 'var(--onyx-bg)' : '#ebe7df',
        transition: 'left 0.15s',
      }} />
    </button>
  );
}

export interface PillProps { active: boolean; onClick: () => void; children?: ReactNode; }
export function Pill({ active, onClick, children }: PillProps) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 12px', borderRadius: 999, fontFamily: MONO, fontSize: 11,
        background: active ? 'var(--onyx-accent-dim)' : 'transparent',
        border: `1px solid ${active ? 'var(--onyx-accent-edge)' : 'var(--onyx-glass-edge)'}`,
        color: active ? 'var(--onyx-accent)' : 'var(--onyx-text-dim)',
        fontWeight: active ? 600 : 400, cursor: 'pointer',
      }}
    >{children}</button>
  );
}

// ── Glass panel (settings facelift) ───────────────────────────────────────────
// A bordered glass card with an eyebrow header that can carry a right-aligned
// action/badge. `style` overrides the outer card (width/flex/marginTop — e.g. the
// Appearance two-column layout); `bodyStyle` overrides the body padding.
// When true, nested <Panel>s drop their own glass card and render as a flush
// eyebrow-divider + content instead. This lets a PARENT pane host several
// sub-sections as ONE glass surface — the look the Appearance Theme/Shelf panes
// have, reused to fold the Libraries sub-sections into two single panes. Default
// false, so every existing standalone Panel is unaffected.
export const PanelFlatContext = createContext(false);

export interface PanelProps {
  label: string;
  action?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
  bodyStyle?: CSSProperties;
}
export function Panel({ label, action, children, style, bodyStyle }: PanelProps) {
  const flat = useContext(PanelFlatContext);
  if (flat) {
    // No glass card — an eyebrow divider + flush content, so it reads as a
    // sub-section of the surrounding pane (cf. Appearance's "Shelf tabs" divider).
    return (
      <div style={{ marginTop: 16, ...style }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '4px 0 8px', borderBottom: '1px solid var(--onyx-line)' }}>
          <span style={eyebrowStyle}>{label}</span>
          {action}
        </div>
        <div style={{ padding: '2px 0 4px', ...bodyStyle }}>{children}</div>
      </div>
    );
  }
  return (
    <div style={{
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid var(--onyx-glass-edge)',
      borderRadius: 14,
      overflow: 'hidden',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
      boxSizing: 'border-box',
      marginTop: 20,
      ...style,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--onyx-line)' }}>
        <span style={eyebrowStyle}>{label}</span>
        {action}
      </div>
      <div style={{ padding: '2px 20px 8px', ...bodyStyle }}>{children}</div>
    </div>
  );
}

// ── Segmented control (settings facelift) ─────────────────────────────────────
// Rectangular uppercase mono pill; accent-tinted when active.
export interface SegProps { active: boolean; onClick: () => void; children: ReactNode; }
export function Seg({ active, onClick, children }: SegProps) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 11px', borderRadius: 6, fontFamily: MONO, fontSize: 10,
        letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap', cursor: 'pointer',
        background: active ? 'var(--onyx-accent-dim)' : 'transparent',
        border: `1px solid ${active ? 'var(--onyx-accent-edge)' : 'var(--onyx-glass-edge)'}`,
        color: active ? 'var(--onyx-accent)' : 'var(--onyx-text-mute)',
        fontWeight: active ? 600 : 400,
      }}
    >{children}</button>
  );
}

// Right-aligned wrapping group for a Row's segmented buttons.
export function SegGroup({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>{children}</div>;
}

export interface TextInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  mono?: boolean;
}
export function TextInput({ value, onChange, placeholder, type = 'text', mono = false }: TextInputProps) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        padding: '8px 12px', minWidth: 280, fontSize: 13,
        background: 'rgba(0,0,0,0.3)', borderRadius: 8,
        color: 'var(--onyx-text)', border: '1px solid var(--onyx-glass-edge)',
        outline: 'none', fontFamily: mono ? MONO : 'inherit',
      }}
    />
  );
}
