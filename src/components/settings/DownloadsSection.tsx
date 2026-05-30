import { useState, useEffect } from 'react';
import { getCacheDir, revealCacheDir } from '../../api/abs';
import { SectionHead, Row, Toggle, Pill, MONO } from './shared';

function WipBadge() {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '2px 8px',
      borderRadius: 999,
      background: 'var(--onyx-accent-dim)',
      color: 'var(--onyx-accent)',
      fontSize: 10,
      fontFamily: MONO,
      letterSpacing: '0.05em',
      whiteSpace: 'nowrap' as const,
      marginLeft: 8,
    }}>
      Work in progress
    </span>
  );
}

export default function DownloadsSection() {
  const [cacheDir, setCacheDir] = useState('');

  useEffect(() => {
    getCacheDir().then(setCacheDir).catch(console.error);
  }, []);

  return (
    <div>
      <SectionHead title="Downloads" subtitle="Offline copies and cache." />

      <Row label="Cache location" hint={cacheDir || 'Loading…'}>
        <button
          onClick={() => revealCacheDir().catch(console.error)}
          style={{ padding: '6px 14px', fontSize: 11, fontFamily: MONO, letterSpacing: '0.06em', textTransform: 'uppercase' as const, background: 'var(--onyx-glass)', border: '1px solid var(--onyx-glass-edge)', borderRadius: 6, color: 'var(--onyx-text-dim)', cursor: 'pointer' }}
        >
          Reveal
        </button>
      </Row>

      <Row label="Maximum cache size" hint="2.4 GB used of 10 GB.">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {['1', '5', '10', '25', '∞ GB'].map((v, i) => (
              <Pill key={v} active={i === 2} onClick={() => {}}>{v}</Pill>
            ))}
          </div>
          <WipBadge />
        </div>
      </Row>

      <Row label="Auto-download next book in series" hint="Pre-fetch when you finish a volume.">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Toggle on={true} onChange={() => {}} />
          <WipBadge />
        </div>
      </Row>

      <Row label="Keep downloaded books after finishing" hint="Hold on to the audio in case you re-listen.">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Toggle on={false} onChange={() => {}} />
          <WipBadge />
        </div>
      </Row>

      <Row label="Clear all cached audio">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <button style={{ padding: '6px 14px', fontSize: 11, fontFamily: MONO, letterSpacing: '0.06em', textTransform: 'uppercase' as const, background: 'transparent', border: '1px solid rgba(232,113,106,0.4)', borderRadius: 6, color: '#e8716a', cursor: 'pointer' }}>
            Clear 2.4 GB
          </button>
          <WipBadge />
        </div>
      </Row>
    </div>
  );
}
