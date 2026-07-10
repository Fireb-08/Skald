// Popout dropdown that escapes the settings pane's overflow clipping.
// Uses position: fixed so the list floats above every parent container,
// including Glass panels that have overflow: hidden or overflow: auto.
// The trigger button measures its own DOMRect on open so the popout
// is anchored correctly regardless of scroll position.

import { useRef, useState, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Icon, { type IconName } from '../Icon';
import { MONO } from './shared';

export interface DropdownItem {
  id: string;
  name: string;
  // Optional subtitle shown in smaller muted text below the name.
  sub?: string;
  // Icon name passed to <Icon>. If omitted no icon is rendered.
  icon?: string;
}

export interface DropdownProps {
  // Content rendered inside the trigger button (string or JSX).
  trigger: ReactNode;
  items: DropdownItem[];
  // Currently selected item id — highlighted with accent colour.
  selected: string | null;
  onChange: (id: string) => void;
  // Which edge the popout aligns to. 'right' keeps it flush with the
  // right edge of the trigger; 'left' aligns to the left edge. Default 'right'.
  align?: 'left' | 'right';
}

export default function Dropdown({ trigger, items, selected, onChange, align = 'right' }: DropdownProps) {
  const [open, setOpen] = useState(false);
  // Stores the trigger button's viewport rect so the popout can be positioned.
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Refs used to detect outside clicks without relying on React state timing.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const closeAndRestoreFocus = () => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  // Re-measure the trigger rect each time the dropdown opens so the position
  // stays correct even after scroll or window resize between opens.
  useEffect(() => {
    if (open && triggerRef.current) {
      setRect(triggerRef.current.getBoundingClientRect());
      // A selected device is the most useful keyboard starting point; fall back
      // to the first option when none has been selected yet.
      const index = Math.max(0, items.findIndex(item => item.id === selected));
      requestAnimationFrame(() => optionRefs.current[index]?.focus());
    }
  }, [open, items, selected]);

  // Close on click outside — attaches only while open to minimise overhead.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // Ignore clicks on the trigger itself — the toggle handler deals with those.
      if (triggerRef.current?.contains(target)) return;
      if (!dropdownRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); closeAndRestoreFocus(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const onTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
    }
  };

  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const current = optionRefs.current.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') { e.preventDefault(); closeAndRestoreFocus(); return; }
    if (e.key === 'Home' || e.key === 'End' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const last = items.length - 1;
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? last : (current + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      optionRefs.current[next]?.focus();
    }
  };

  // ── Popout position calculation ────────────────────────────────────────────
  // The popout renders with position: fixed so it is placed relative to the
  // viewport — not to any scrolled or overflow-clipped ancestor.
  //
  // Horizontal: align='right' → right edge locks to trigger's right edge.
  //             align='left'  → left edge locks to trigger's left edge.
  // Vertical:   open below by default; if that would overflow the bottom of
  //             the viewport, flip the popout above the trigger instead.
  const POPOUT_WIDTH = 280;
  const POPOUT_GAP   = 6; // px between trigger bottom and popout top

  let popoutStyle: React.CSSProperties = { position: 'fixed', zIndex: 9999, width: POPOUT_WIDTH };

  if (rect) {
    // Horizontal positioning.
    if (align === 'right') {
      // Right-align: lock to the trigger's right edge.
      // Using 'right' avoids a left→right recalculation on every render.
      popoutStyle.right = window.innerWidth - rect.right;
    } else {
      popoutStyle.left = rect.left;
    }

    // Vertical positioning: prefer below, flip above if it would overflow.
    const spaceBelow = window.innerHeight - rect.bottom - POPOUT_GAP;
    const estimatedHeight = Math.min(items.length * 48 + 32, 360); // rough cap
    if (spaceBelow >= estimatedHeight || spaceBelow >= window.innerHeight / 2) {
      // Enough room below — open downward.
      popoutStyle.top = rect.bottom + POPOUT_GAP;
    } else {
      // Not enough room — flip the popout to open upward above the trigger.
      popoutStyle.bottom = window.innerHeight - rect.top + POPOUT_GAP;
    }
  }

  return (
    // Inline wrapper — no positioning applied here. The popout uses position: fixed
    // with viewport coordinates so it does not anchor to this element at all.
    <div style={{ display: 'inline-block' }}>
      {/* Trigger button — toggles the popout */}
      <button
        ref={triggerRef}
        onClick={() => setOpen(o => !o)}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="onyx-dropdown-options"
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 12px',
          background: open ? 'var(--onyx-accent-dim)' : 'var(--onyx-glass)',
          border: `1px solid ${open ? 'var(--onyx-accent-edge)' : 'var(--onyx-glass-edge)'}`,
          borderRadius: 8,
          color: open ? 'var(--onyx-accent)' : 'var(--onyx-text)',
          fontFamily: 'inherit', fontSize: 12,
          cursor: 'pointer',
          transition: 'background 0.12s, border-color 0.12s',
        }}
      >
        {trigger}
        {/* Caret rotates 180° when open */}
        <span style={{
          display: 'inline-flex',
          transform: open ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.15s',
          color: 'var(--onyx-text-dim)',
        }}>
          <Icon name="chevron-down" size={11} />
        </span>
      </button>

      {/* Fixed-position popout — portalled into document.body to escape any
          ancestor backdrop-filter, which would otherwise create a new containing
          block and break position:fixed viewport anchoring. */}
      {open && rect && createPortal(
        <div
          ref={dropdownRef}
          id="onyx-dropdown-options"
          role="listbox"
          aria-label="Output device"
          onKeyDown={onListKeyDown}
          style={{
            ...popoutStyle,
            // Visual chrome matching other Onyx panels.
            background: 'var(--onyx-panel2)',
            border: '1px solid var(--onyx-line)',
            borderRadius: 8,
            boxShadow: '0 16px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.06)',
            padding: 6,
            // Cap height and scroll if there are many devices.
            maxHeight: 360,
            overflowY: 'auto',
          }}
        >
          {/* Section label */}
          <div style={{
            fontFamily: MONO, fontSize: 9, color: 'var(--onyx-text-mute)',
            letterSpacing: '0.12em', textTransform: 'uppercase',
            padding: '6px 8px 4px',
          }}>
            Output device
          </div>

          {items.map((item, i) => {
            const active = item.id === selected;
            return (
              <button
                key={item.id}
                ref={el => { optionRefs.current[i] = el; }}
                role="option"
                aria-selected={active}
                onClick={() => { onChange(item.id); closeAndRestoreFocus(); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', padding: '8px 10px', borderRadius: 6,
                  background: active ? 'var(--onyx-accent-dim)' : 'transparent',
                  border: 'none', cursor: 'pointer',
                  fontFamily: 'inherit', textAlign: 'left',
                }}
              >
                {/* Device icon — only rendered when the item provides one */}
                {item.icon && (
                  <Icon
                    name={item.icon as IconName}
                    size={14}
                    color={active ? 'var(--onyx-accent)' : 'var(--onyx-text-dim)'}
                  />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Device name */}
                  <div style={{
                    fontSize: 12,
                    color: active ? 'var(--onyx-accent)' : 'var(--onyx-text)',
                    fontWeight: active ? 500 : 400,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {item.name}
                  </div>
                  {/* Optional subtitle (e.g. connection type) */}
                  {item.sub && (
                    <div style={{
                      fontFamily: MONO, fontSize: 9.5, color: 'var(--onyx-text-mute)',
                      letterSpacing: '0.04em', marginTop: 1,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {item.sub}
                    </div>
                  )}
                </div>
                {/* Active indicator dot */}
                {active && <Icon name="dot" size={8} color="var(--onyx-accent)" />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
