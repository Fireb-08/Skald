// Self-service change-password modal (cluster H).
// Moved verbatim out of AccountSection.tsx (God-File Decomposition roadmap, L3/L7).
import { useState } from 'react';
import { SERIF, MONO } from '../shared';
import { changePassword } from '../../../api/abs';
import { useModalFocus } from '../../../hooks/useModalFocus';
import { errorMessage } from '../../../lib/presentError';
import { log } from '../../../lib/log';

// ── Shared modal field styles ────────────────────────────────────────────────
const fieldLabelStyle: React.CSSProperties = {
  fontFamily: MONO, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
  color: 'var(--onyx-text-mute)', marginBottom: 6,
};
const fieldInputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '9px 12px', background: 'rgba(0,0,0,0.25)',
  border: '1px solid var(--onyx-glass-edge)', borderRadius: 7, color: 'var(--onyx-text)',
  fontSize: 13, outline: 'none', fontFamily: 'inherit',
};
const ghostBtnStyle: React.CSSProperties = {
  padding: '8px 18px', background: 'transparent', border: '1px solid var(--onyx-glass-edge)',
  borderRadius: 7, color: 'var(--onyx-text-dim)', fontFamily: MONO, fontSize: 11,
  letterSpacing: '0.07em', textTransform: 'uppercase', cursor: 'pointer',
};
const brassBtnStyle: React.CSSProperties = {
  // Theme accent (follows the selected accent), not a hardcoded gold gradient.
  padding: '8px 18px', background: 'var(--onyx-accent)',
  border: '1px solid var(--onyx-accent-edge)',
  borderRadius: 7, color: 'var(--onyx-bg)', fontFamily: MONO, fontSize: 11, letterSpacing: '0.07em',
  textTransform: 'uppercase', cursor: 'pointer', fontWeight: 600,
};

/** Self-service password change (PATCH /api/me/password). Guests are blocked
 *  server-side; the caller hides this for guest accounts. */
export default function ChangePasswordModal({ serverUrl, onClose }: { serverUrl: string; onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const dialogRef = useModalFocus<HTMLFormElement>(onClose, !pending);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!next) return setError('Enter a new password.');
    if (next !== confirm) return setError('New passwords do not match.');
    setError('');
    setPending(true);
    try {
      await changePassword(serverUrl, current, next);
      setDone(true);
    } catch (err) {
      log.warn('auth', 'password change failed', { err: String(err) });
      setError(errorMessage(err, { operation: 'save' }));
      setPending(false);
    }
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.65)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-password-title"
        onSubmit={submit}
        style={{ width: 400, maxWidth: '90vw', background: 'var(--onyx-panel2)', backdropFilter: 'blur(40px) saturate(120%)', WebkitBackdropFilter: 'blur(40px) saturate(120%)', border: '1px solid var(--onyx-glass-edge)', borderRadius: 12, boxShadow: '0 24px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)', padding: '26px 26px 22px', display: 'flex', flexDirection: 'column', gap: 18 }}
      >
        <div id="change-password-title" style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 500, color: 'var(--onyx-text)' }}>Change password</div>
        {done ? (
          <>
            <div style={{ fontSize: 13, color: 'var(--onyx-text-dim)', lineHeight: 1.5 }}>
              Your password has been changed.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" onClick={onClose} style={brassBtnStyle}>Done</button>
            </div>
          </>
        ) : (
          <>
            <div>
              <div style={fieldLabelStyle}>Current password</div>
              <input style={fieldInputStyle} type="password" value={current} onChange={e => setCurrent(e.target.value)} autoFocus />
            </div>
            <div>
              <div style={fieldLabelStyle}>New password</div>
              <input style={fieldInputStyle} type="password" value={next} onChange={e => setNext(e.target.value)} />
            </div>
            <div>
              <div style={fieldLabelStyle}>Confirm new password</div>
              <input style={fieldInputStyle} type="password" value={confirm} onChange={e => setConfirm(e.target.value)} />
            </div>
            {error && <div style={{ fontSize: 12, color: '#e8716a', fontFamily: MONO }}>{error}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button type="button" onClick={onClose} style={ghostBtnStyle}>Cancel</button>
              <button type="submit" disabled={pending} style={{ ...brassBtnStyle, cursor: pending ? 'wait' : 'pointer' }}>
                {pending ? 'Saving…' : 'Change'}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
