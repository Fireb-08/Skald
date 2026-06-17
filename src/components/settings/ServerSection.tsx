import { SectionHead, Row, MONO, Panel } from './shared';
import type { OnyxState } from '../../state/onyx';
import ServerSettingsSection from './ServerSettingsSection';
import SyncSection from './SyncSection';

export interface ServerSectionProps { st: OnyxState; }

export default function ServerSection({ st }: ServerSectionProps) {
  const connected = Boolean(st.serverUrl && !st.libraryLoading && st.library.length > 0);

  return (
    <div>
      <SectionHead title="Server" subtitle="Your Audiobookshelf server connection." />

      <Panel label="Connection">
        {/* Connection status — dot + label */}
        <Row label="Status">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              width: 8, height: 8, borderRadius: 4, flexShrink: 0, display: 'inline-block',
              background: connected ? '#5ac88a' : 'var(--onyx-text-mute)',
              boxShadow: connected ? '0 0 8px #5ac88a' : 'none',
            }} />
            <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.06em', color: connected ? '#5ac88a' : 'var(--onyx-text-mute)' }}>
              {connected ? 'Connected' : 'Not connected'}
            </span>
          </span>
        </Row>

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
              background: 'rgba(0,0,0,0.3)',
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

        {/* Live sync toggle — connection-related, so it lives in the Connection panel. */}
        <SyncSection st={st} embedded />
      </Panel>

      {/* Global server administration settings — admin only. Embedded here so
          there is a single "Server" panel rather than a confusing split between
          "Server" (connection) and "Server Settings" (admin config). */}
      {st.isAdmin && <ServerSettingsSection st={st} embedded />}
    </div>
  );
}
