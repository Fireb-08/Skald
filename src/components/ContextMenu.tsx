import { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

const MONO = "'JetBrains Mono', ui-monospace, monospace";
const MENU_W = 200;
const MENU_H = 120;

export default function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  // Flip toward the left if the menu would overflow the right edge.
  const flipX = x + MENU_W > window.innerWidth;
  // Flip upward if the menu would overflow the bottom edge.
  const flipY = y + MENU_H > window.innerHeight;

  const posStyle: React.CSSProperties = {
    position: 'fixed',
    zIndex: 1000,
    width: MENU_W,
    ...(flipX ? { right: window.innerWidth - x } : { left: x }),
    ...(flipY ? { bottom: window.innerHeight - y } : { top: y }),
  };

  const menu = (
    <div
      ref={ref}
      style={{
        ...posStyle,
        background: 'var(--onyx-panel2)',
        border: '1px solid var(--onyx-line)',
        borderRadius: 8,
        boxShadow: '0 12px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.06)',
        padding: 4,
        fontFamily: MONO,
      }}
    >
      {items.map((item, i) => {
        const hovered = hoveredIdx === i && !item.disabled;
        return (
          <button
            key={i}
            disabled={item.disabled}
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(null)}
            onClick={(e) => {
              e.stopPropagation();
              if (!item.disabled) {
                item.onClick();
                onClose();
              }
            }}
            style={{
              display: 'block',
              width: '100%',
              padding: '7px 10px',
              borderRadius: 5,
              border: 'none',
              background: hovered ? 'var(--onyx-accent-dim)' : 'transparent',
              color: item.disabled
                ? 'var(--onyx-text-mute)'
                : item.danger
                  ? (hovered ? '#f47c7c' : '#c96464')
                  : (hovered ? 'var(--onyx-accent)' : 'var(--onyx-text)'),
              fontSize: 11.5,
              textAlign: 'left',
              cursor: item.disabled ? 'default' : 'pointer',
              fontFamily: 'inherit',
              letterSpacing: '0.01em',
              transition: 'background 0.1s, color 0.1s',
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );

  return ReactDOM.createPortal(menu, document.body);
}
