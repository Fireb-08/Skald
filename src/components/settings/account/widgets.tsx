// Presentational widgets for the account pane's user list — pure props → JSX.
// Moved verbatim out of AccountSection.tsx (God-File Decomposition roadmap, L3/L7).
import { MONO } from '../shared';
import { USER_PALETTE } from './helpers';

/** Mono pill badge for account type. Brass-tinted for admin/root, muted for user/guest. */
export function TypeBadge({ type }: { type: string }) {
  const brass = type === 'root' || type === 'admin';
  return (
    <span style={{
      fontFamily: MONO,
      fontSize: 9,
      letterSpacing: '0.06em',
      textTransform: 'uppercase' as const,
      padding: '2px 7px',
      borderRadius: 4,
      background: brass ? 'rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.14)' : 'rgba(255,255,255,0.06)',
      color: brass ? 'var(--onyx-accent)' : 'var(--onyx-text-mute)',
      border: `1px solid ${brass ? 'rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.24)' : 'rgba(255,255,255,0.08)'}`,
      whiteSpace: 'nowrap' as const,
    }}>
      {type}
    </span>
  );
}

/** Small square icon button used for per-row edit/delete actions. */
export function RowButton({
  onClick,
  danger = false,
  title,
  children,
}: {
  onClick: () => void;
  danger?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 28,
        height: 28,
        borderRadius: 6,
        border: '1px solid transparent',
        background: 'transparent',
        // Danger (delete) uses the app's standard red; edit uses dimmed text colour
        color: danger ? '#e8716a' : 'var(--onyx-text-dim)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        padding: 0,
      }}
    >
      {children}
    </button>
  );
}

// Feather-style pencil SVG (13px, stroke-only) for the edit button.
export const PencilIcon = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

// Feather-style trash SVG (13px, stroke-only) for the delete button.
export const TrashIcon = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

/** Square initial-badge avatar. When the user is connected it "lights up" — a
 *  solid colour fill with a soft glow; offline it shows a dim tinted box with
 *  the coloured initial. Clicking opens the colour picker. */
export function UserAvatar({ color, initial, online, onClick }: {
  color: string; initial: string; online: boolean; onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      title="Change colour"
      style={{
        width: 34, height: 34, borderRadius: 9, flexShrink: 0, padding: 0, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: MONO, fontSize: 13, fontWeight: 700,
        // Lit (online): solid fill + dark glyph + glow. Dim (offline): tinted box + coloured glyph.
        background: online ? color : `${color}1f`,
        color: online ? 'var(--onyx-bg)' : color,
        border: `1px solid ${online ? color : `${color}3a`}`,
        boxShadow: online ? `0 0 11px ${color}66` : 'none',
        transition: 'background 0.15s, box-shadow 0.15s, color 0.15s, border-color 0.15s',
      }}
    >
      {initial}
    </button>
  );
}

/** Glass popover anchored under an avatar (fixed-positioned so the row's scroll
 *  container can't clip it): curated palette swatches + a native full-spectrum
 *  custom input. Closes on outside click (handled by the caller). */
export function ColorPickerPopover({ value, onPick, popRef, pos }: {
  value: string; onPick: (hex: string) => void;
  popRef: React.RefObject<HTMLDivElement | null>; pos: { x: number; y: number };
}) {
  const W = 168;
  const left = Math.min(pos.x, window.innerWidth - W - 12);
  return (
    <div
      ref={popRef}
      onClick={e => e.stopPropagation()}
      style={{
        position: 'fixed', top: pos.y, left, zIndex: 600,
        background: 'var(--onyx-panel2)', backdropFilter: 'blur(40px) saturate(120%)',
        WebkitBackdropFilter: 'blur(40px) saturate(120%)',
        border: '1px solid var(--onyx-glass-edge)', borderRadius: 10,
        boxShadow: '0 16px 40px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)',
        padding: 12, width: W,
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 7 }}>
        {USER_PALETTE.map(c => {
          const active = c.toLowerCase() === value.toLowerCase();
          return (
            <button
              key={c}
              onClick={() => onPick(c)}
              title={c}
              style={{
                width: 20, height: 20, borderRadius: 6, cursor: 'pointer', padding: 0, background: c,
                border: active ? '2px solid var(--onyx-text)' : '1px solid rgba(255,255,255,0.18)',
                boxShadow: active ? `0 0 8px ${c}88` : 'none',
              }}
            />
          );
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 11, paddingTop: 11, borderTop: '1px solid var(--onyx-line)' }}>
        <label style={{ position: 'relative', width: 22, height: 22, flexShrink: 0, cursor: 'pointer', borderRadius: 6, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.18)', display: 'block' }}>
          <input
            type="color"
            value={value}
            onChange={e => onPick(e.target.value)}
            style={{ position: 'absolute', inset: -4, width: 'calc(100% + 8px)', height: 'calc(100% + 8px)', border: 'none', padding: 0, background: 'none', cursor: 'pointer' }}
          />
        </label>
        <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em' }}>Custom</span>
        <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-dim)', marginLeft: 'auto', textTransform: 'uppercase' }}>{value}</span>
      </div>
    </div>
  );
}
