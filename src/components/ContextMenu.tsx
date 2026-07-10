import { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import Icon, { type IconName } from './Icon';

const MONO = "'JetBrains Mono', ui-monospace, monospace";

export interface ContextMenuItem {
  label: string;
  /** Optional when the item only opens a submenu. */
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  icon?: IconName;
  /** Accent-colored emphasis row (e.g. the primary "Play Book" action) —
   *  accent text + heavier weight; background appears only on hover. */
  primary?: boolean;
  /** Nested actions shown in a flyout; the row gets a › affordance. */
  submenu?: ContextMenuItem[];
}

/** A labelled group of items. `label` omitted renders the group with just a
 *  divider above it (no mono header). */
export interface ContextMenuSection {
  label?: string;
  items: ContextMenuItem[];
}

export interface ContextMenuProps {
  x: number;
  y: number;
  sections: ContextMenuSection[];
  onClose: () => void;
}

const MENU_W = 248;
const SUB_W = 210;

const PANEL: React.CSSProperties = {
  background: 'var(--onyx-panel2)',
  border: '1px solid var(--onyx-line)',
  borderRadius: 12,
  boxShadow: '0 16px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.05)',
  padding: 6,
  fontFamily: 'inherit',
};

const HEADER: React.CSSProperties = {
  fontFamily: MONO, fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase',
  color: 'var(--onyx-text-mute)', padding: '8px 10px 5px',
};

export default function ContextMenu({ x, y, sections, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [openSub, setOpenSub] = useState<string | null>(null);

  // Submenu close is delayed so the cursor can travel across the gap into the
  // flyout without it dismissing; entering the flyout (or its parent row) cancels it.
  const subTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelSubClose = () => { if (subTimer.current) { clearTimeout(subTimer.current); subTimer.current = null; } };
  const scheduleSubClose = () => { cancelSubClose(); subTimer.current = setTimeout(() => setOpenSub(null), 260); };

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  // Clear any pending submenu-close timer on unmount.
  useEffect(() => () => { if (subTimer.current) clearTimeout(subTimer.current); }, []);

  // Estimate height for the upward-flip check from the visible row/header count.
  const rowCount = sections.reduce((n, s) => n + s.items.length + (s.label ? 1 : 0), 0);
  const estH = rowCount * 34 + sections.length * 8 + 12;

  const flipX = x + MENU_W > window.innerWidth;
  const flipY = y + estH > window.innerHeight;

  const posStyle: React.CSSProperties = {
    position: 'fixed',
    zIndex: 1000,
    width: MENU_W,
    ...(flipX ? { right: window.innerWidth - x } : { left: x }),
    ...(flipY ? { bottom: window.innerHeight - y } : { top: y }),
  };

  // Row renderer shared by the main menu and submenu panels.
  const renderRow = (item: ContextMenuItem, key: string, inSub: boolean) => {
    const hasSub = !!item.submenu?.length;
    // A submenu parent is enabled if any child is enabled.
    const subEnabled = hasSub && item.submenu!.some(s => !s.disabled);
    const disabled = item.disabled || (hasSub && !subEnabled);
    const isHover = hovered === key && !disabled;
    const subOpen = openSub === key;

    const color = disabled
      ? 'var(--onyx-text-mute)'
      : item.danger
        ? (isHover ? '#f47c7c' : '#d87a72')
        : item.primary
          ? 'var(--onyx-accent)'
          : (isHover ? 'var(--onyx-accent)' : 'var(--onyx-text)');

    // Primary rows are emphasized by accent COLOR + weight only — a resting
    // background would be indistinguishable from the hover state, reading as a
    // stuck highlight. Background is reserved for actual hover / open submenu.
    const bg = (isHover || subOpen) && !disabled
      ? (item.danger ? 'rgba(220,80,80,0.12)' : 'var(--onyx-accent-dim)')
      : 'transparent';

    return (
      <div
        key={key}
        style={{ position: 'relative' }}
        onMouseEnter={() => {
          setHovered(key);
          // Entering a submenu parent (or re-entering it via its open flyout)
          // cancels the pending close and keeps it open.
          if (hasSub) { cancelSubClose(); setOpenSub(key); }
          // Hovering a different top-level row dismisses any open flyout at once.
          else if (!inSub) { cancelSubClose(); setOpenSub(null); }
        }}
        onMouseLeave={() => {
          setHovered(h => (h === key ? null : h));
          // Delay the close so the cursor can reach the flyout across the gap.
          if (hasSub) scheduleSubClose();
        }}
      >
        <button
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            if (disabled || hasSub) return;
            item.onClick?.();
            onClose();
          }}
          style={{
            display: 'flex', alignItems: 'center', gap: 11, width: '100%',
            padding: '8px 10px', borderRadius: 7, border: 'none', background: bg,
            color, cursor: disabled ? 'default' : 'pointer', textAlign: 'left',
            fontFamily: 'inherit', fontSize: 13, fontWeight: item.primary ? 600 : 500,
            transition: 'background 0.1s, color 0.1s',
          }}
        >
          <span style={{ width: 16, display: 'inline-flex', justifyContent: 'center', flexShrink: 0, opacity: disabled ? 0.5 : 0.9 }}>
            {item.icon && <Icon name={item.icon} size={15} />}
          </span>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
          {hasSub && <Icon name="chevron-right" size={12} color="var(--onyx-text-mute)" />}
        </button>

        {/* Submenu flyout */}
        {hasSub && subOpen && (
          <div style={{
            ...PANEL, position: 'absolute', top: -6, width: SUB_W, zIndex: 1001,
            ...(flipX ? { right: 'calc(100% + 4px)' } : { left: 'calc(100% + 4px)' }),
          }}>
            <div style={HEADER}>{item.label}</div>
            {item.submenu!.map((sub, i) => renderRow(sub, `${key}.${i}`, true))}
          </div>
        )}
      </div>
    );
  };

  const menu = (
    <div ref={ref} style={{ ...posStyle, ...PANEL }}>
      {sections.map((section, si) => (
        <div key={si}>
          {/* Divider above every group after the first; header replaces it when present. */}
          {si > 0 && !section.label && (
            <div style={{ height: 1, background: 'var(--onyx-line)', margin: '6px 8px' }} />
          )}
          {section.label && (
            <div style={{ ...HEADER, ...(si > 0 ? { borderTop: '1px solid var(--onyx-line)', marginTop: 4, paddingTop: 10 } : {}) }}>
              {section.label}
            </div>
          )}
          {section.items.map((item, ii) => renderRow(item, `${si}.${ii}`, false))}
        </div>
      ))}
    </div>
  );

  return ReactDOM.createPortal(menu, document.body);
}
