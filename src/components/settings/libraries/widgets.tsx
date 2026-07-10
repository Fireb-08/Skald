// Small shared sub-components for the libraries pane — pure props → JSX.
// Moved verbatim out of LibrariesSection.tsx (God-File Decomposition roadmap, L3/L7).
import type { ReactNode } from 'react';
import { MONO } from '../shared';

export function SmallBtn({
  onClick,
  danger = false,
  muted = false,
  disabled = false,
  title,
  children,
}: {
  onClick?: () => void;
  danger?: boolean;
  muted?: boolean;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}) {
  const col = danger ? '#e8716a' : muted ? 'var(--onyx-text-dim)' : 'var(--onyx-accent)';
  const bdr = danger
    ? 'rgba(232,113,106,0.35)'
    : muted
    ? 'var(--onyx-glass-edge)'
    : 'rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.3)';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        padding: '5px 12px',
        background: 'transparent',
        border: `1px solid ${bdr}`,
        borderRadius: 6,
        color: col,
        fontFamily: MONO,
        fontSize: 10.5,
        letterSpacing: '0.07em',
        textTransform: 'uppercase',
        cursor: disabled ? 'wait' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}

export function Field({
  value,
  onChange,
  placeholder,
  mono = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      spellCheck={false}
      style={{
        flex: 1,
        width: '100%',
        boxSizing: 'border-box',
        padding: '7px 10px',
        background: 'rgba(0,0,0,0.28)',
        border: '1px solid var(--onyx-glass-edge)',
        borderRadius: 6,
        color: 'var(--onyx-text)',
        fontSize: 12.5,
        fontFamily: mono ? MONO : 'inherit',
        outline: 'none',
      }}
    />
  );
}

export function OnOff({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  const pill = (label: string, active: boolean, val: boolean) => (
    <button
      key={label}
      onClick={() => onChange(val)}
      style={{
        padding: '4px 10px', borderRadius: 4,
        background: active ? 'var(--onyx-accent-dim)' : 'transparent',
        border: `1px solid ${active ? 'var(--onyx-accent-edge)' : 'rgba(255,255,255,0.08)'}`,
        color: active ? 'var(--onyx-accent)' : 'var(--onyx-text-mute)',
        fontFamily: MONO, fontSize: 10, letterSpacing: '0.07em',
        cursor: 'pointer', fontWeight: active ? 600 : 400,
      }}
    >{label}</button>
  );
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {pill('On', on, true)}
      {pill('Off', !on, false)}
    </div>
  );
}

export function SelectInput({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        padding: '7px 10px',
        background: 'rgba(0,0,0,0.28)',
        border: '1px solid var(--onyx-glass-edge)',
        borderRadius: 6,
        color: 'var(--onyx-text)',
        fontSize: 12.5,
        fontFamily: 'inherit',
        outline: 'none',
        cursor: 'pointer',
        minWidth: 180,
      }}
    >
      {options.map(o => (
        <option key={o.value} value={o.value} style={{ background: '#1a1a1f' }}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
