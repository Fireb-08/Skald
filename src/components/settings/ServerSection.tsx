import { SectionHead, Row, SERIF, MONO } from './shared';
import type { OnyxState } from '../../state/onyx';

export interface ServerSectionProps { st: OnyxState; }

export default function ServerSection({ st }: ServerSectionProps) {
  const connected = Boolean(st.serverUrl && !st.libraryLoading && st.library.length > 0);

  return (
    <div>
      <SectionHead title="Server" subtitle="Your Audiobookshelf server connection." />

      {/* Connection status — dot + label only, no placeholder version/sync data */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 0 20px', borderBottom: '1px solid var(--onyx-line)', marginBottom: 8 }}>
        <span style={{
          width: 8, height: 8, borderRadius: 4, flexShrink: 0, display: 'inline-block',
          background: connected ? '#5ac88a' : 'var(--onyx-text-mute)',
          boxShadow: connected ? '0 0 8px #5ac88a' : 'none',
        }} />
        <span style={{ fontFamily: SERIF, fontSize: 15, fontWeight: 500, color: connected ? 'var(--onyx-text)' : 'var(--onyx-text-dim)' }}>
          {connected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      {/* Server URL — read-only; changing server requires signing out */}
      <Row label="Server URL" hint="To change servers, sign out and sign back in.">
        <input
          type="text"
          value={st.serverUrl}
          readOnly
          disabled
          title="To change servers, sign out and sign back in"
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
            fontFamily: MONO,
          }}
        />
      </Row>
    </div>
  );
}
