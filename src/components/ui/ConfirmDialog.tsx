import ReactDOM from 'react-dom';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const MONO  = "'JetBrains Mono', ui-monospace, monospace";

export interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title, message, confirmLabel, danger, onConfirm, onCancel,
}: ConfirmDialogProps) {
  // Portaled to document.body so the overlay isn't trapped inside a parent
  // stacking context — without this it renders below body-level modal portals
  // (e.g. ShareModal) regardless of zIndex.
  const dialog = (
    <div
      style={{
        // Above modals (z 500) and the context menu (z 1000) — a confirmation
        // must always sit on top, including when launched from within a modal.
        position: 'fixed', inset: 0, zIndex: 2000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.65)',
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{
        width: 420,
        maxWidth: '90vw',
        background: 'var(--onyx-panel2)',
        backdropFilter: 'blur(40px) saturate(120%)',
        WebkitBackdropFilter: 'blur(40px) saturate(120%)',
        border: '1px solid var(--onyx-glass-edge)',
        borderRadius: 12,
        boxShadow: '0 24px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)',
        padding: '28px 28px 22px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}>
        <div style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 500, color: 'var(--onyx-text)', lineHeight: 1.2 }}>
          {title}
        </div>
        <div style={{ fontSize: 13, color: 'var(--onyx-text-dim)', lineHeight: 1.55 }}>
          {message}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button
            onClick={onCancel}
            style={{
              padding: '8px 18px',
              background: 'transparent',
              border: '1px solid var(--onyx-glass-edge)',
              borderRadius: 7,
              color: 'var(--onyx-text-dim)',
              fontFamily: MONO,
              fontSize: 11,
              letterSpacing: '0.07em',
              textTransform: 'uppercase' as const,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: '8px 18px',
              background: danger ? '#e05a5a' : 'var(--onyx-accent)',
              border: 'none',
              borderRadius: 7,
              color: '#fff',
              fontFamily: MONO,
              fontSize: 11,
              letterSpacing: '0.07em',
              textTransform: 'uppercase' as const,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(dialog, document.body);
}
