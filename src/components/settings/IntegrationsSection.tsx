import { useState } from 'react';
import type { OnyxState } from '../../state/onyx';
import { SectionHead, Row, Toggle, MONO } from './shared';
import { clearReviewCache } from '../../api/reviewCache';

export interface IntegrationsSectionProps { st: OnyxState; }

export default function IntegrationsSection({ st }: IntegrationsSectionProps) {
  const [cacheCleared, setCacheCleared] = useState(false);

  return (
    <div>
      <SectionHead title="Integrations" subtitle="Connect third-party services for additional metadata and reviews." />
      <Row
        label="Open Library"
        hint="Community ratings and shelf data"
      >
        <Toggle on={st.enableOpenLibrary} onChange={st.setEnableOpenLibrary} />
      </Row>
      <Row
        label="Review Cache"
        hint="Force a fresh fetch of all ratings data on next visit to the Player screen."
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {cacheCleared && (
            <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em' }}>
              Cache cleared
            </span>
          )}
          <button
            onClick={() => {
              clearReviewCache();
              setCacheCleared(true);
              setTimeout(() => setCacheCleared(false), 2000);
            }}
            style={{
              padding: '7px 14px', borderRadius: 6, cursor: 'pointer',
              background: 'transparent', border: '1px solid var(--onyx-glass-edge)',
              color: 'var(--onyx-text-dim)', fontFamily: MONO, fontSize: 10,
              letterSpacing: '0.06em', textTransform: 'uppercase' as const,
            }}
          >
            Clear Review Cache
          </button>
        </div>
      </Row>
    </div>
  );
}
