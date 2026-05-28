import { useState, useCallback, type ReactNode } from 'react';

export const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
export const MONO = "'JetBrains Mono', ui-monospace, monospace";

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
