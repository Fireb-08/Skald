import { useState } from 'react';
import type { OnyxState } from '../../state/onyx';
import { SectionHead, Row, MONO } from './shared';

export interface IntegrationsSectionProps { st: OnyxState; }

export default function IntegrationsSection({ st }: IntegrationsSectionProps) {
  const [showKey, setShowKey] = useState(false);

  return (
    <div>
      <SectionHead title="Integrations" subtitle="Connect third-party services for additional metadata and reviews." />
      <Row
        label="Google Books API key"
        hint="Used to fetch ratings and reviews on the Player screen. Get a free key at console.cloud.google.com → APIs & Services → Credentials."
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type={showKey ? 'text' : 'password'}
            value={st.googleBooksApiKey}
            onChange={e => st.setGoogleBooksApiKey(e.target.value)}
            placeholder="AIza…"
            style={{
              padding: '8px 12px', minWidth: 260, fontSize: 12,
              background: 'rgba(0,0,0,0.3)', borderRadius: 8,
              color: 'var(--onyx-text)', border: '1px solid var(--onyx-glass-edge)',
              outline: 'none', fontFamily: MONO,
            }}
          />
          <button
            onClick={() => setShowKey(s => !s)}
            style={{
              padding: '7px 12px', borderRadius: 6, cursor: 'pointer',
              background: 'var(--onyx-glass)', border: '1px solid var(--onyx-glass-edge)',
              color: 'var(--onyx-text-dim)', fontFamily: MONO, fontSize: 10,
              letterSpacing: '0.06em', textTransform: 'uppercase' as const,
            }}
          >
            {showKey ? 'Hide' : 'Show'}
          </button>
        </div>
      </Row>
    </div>
  );
}
