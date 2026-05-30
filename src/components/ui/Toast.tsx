import { useEffect, useRef } from 'react';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastProps {
  message: string;
  type: ToastType;
  onDismiss: () => void;
}

const BORDER_COLOR: Record<ToastType, string> = {
  success: 'var(--onyx-accent)',
  error:   '#e05a5a',
  info:    'var(--onyx-text-dim)',
};

const MONO = "'JetBrains Mono', ui-monospace, monospace";

export default function Toast({ message, type, onDismiss }: ToastProps) {
  const dismissRef = useRef(onDismiss);
  useEffect(() => { dismissRef.current = onDismiss; });

  useEffect(() => {
    const t = setTimeout(() => dismissRef.current(), 4000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div style={{
      position: 'fixed',
      bottom: 24,
      right: 24,
      zIndex: 1000,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      minWidth: 260,
      maxWidth: 420,
      background: 'var(--onyx-panel2)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      border: '1px solid var(--onyx-glass-edge)',
      borderLeft: `3px solid ${BORDER_COLOR[type]}`,
      borderRadius: 8,
      boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
      padding: '11px 10px 11px 14px',
      pointerEvents: 'auto',
    }}>
      <span style={{ flex: 1, fontSize: 13, color: 'var(--onyx-text)', lineHeight: 1.4 }}>
        {message}
      </span>
      <button
        onClick={onDismiss}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--onyx-text-mute)',
          cursor: 'pointer',
          fontFamily: MONO,
          fontSize: 13,
          lineHeight: 1,
          padding: '2px 4px',
          flexShrink: 0,
        }}
        title="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
