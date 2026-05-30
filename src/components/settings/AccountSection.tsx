import { SectionHead, Row, SERIF, MONO } from './shared';
import type { OnyxState } from '../../state/onyx';

export interface AccountSectionProps {
  st: OnyxState;
  onSignOut: () => void;
}

export default function AccountSection({ st, onSignOut }: AccountSectionProps) {
  const displayName = st.user?.username ?? '';
  const initial = displayName.charAt(0).toUpperCase() || '?';

  return (
    <div>
      <SectionHead title="Account" subtitle="Your profile on this Audiobookshelf server." />

      {/* Profile header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '0 0 24px', borderBottom: '1px solid var(--onyx-line)' }}>
        <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--onyx-accent)', color: 'var(--onyx-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 28 }}>
          {initial}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: SERIF, fontSize: 20, fontWeight: 500 }}>{displayName}</div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', marginTop: 4, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {st.serverUrl || 'Not connected'}
          </div>
        </div>
      </div>

      {/* Display name — read-only; ABS has no simple rename endpoint for regular users */}
      <Row label="Display name" hint="Name is managed by your Audiobookshelf server.">
        <input
          type="text"
          value={displayName}
          readOnly
          disabled
          title="Name is managed by your Audiobookshelf server"
          style={{
            padding: '8px 12px',
            minWidth: 280,
            fontSize: 13,
            background: 'rgba(0,0,0,0.15)',
            borderRadius: 8,
            color: 'var(--onyx-text-dim)',
            border: '1px solid var(--onyx-glass-edge)',
            outline: 'none',
            cursor: 'default',
            opacity: 0.7,
            fontFamily: 'inherit',
          }}
        />
      </Row>

      {/* Sign out */}
      <div style={{ marginTop: 32, paddingTop: 24, borderTop: '1px solid var(--onyx-line)', display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={onSignOut}
          style={{
            padding: '9px 20px',
            background: 'transparent',
            border: '1px solid rgba(232,113,106,0.4)',
            borderRadius: 8,
            color: '#e8716a',
            cursor: 'pointer',
            fontFamily: MONO,
            fontSize: 11.5,
            letterSpacing: '0.08em',
            textTransform: 'uppercase' as const,
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
