import { SectionHead, Row, Toggle, Pill, MONO } from './shared';

export default function DownloadsSection() {
  return (
    <div>
      <SectionHead title="Downloads" subtitle="Offline copies and cache." />
      <Row label="Cache location" hint="~/.local/share/skald/cache">
        <button style={{ padding: '6px 14px', fontSize: 11, fontFamily: MONO, letterSpacing: '0.06em', textTransform: 'uppercase' as const, background: 'var(--onyx-glass)', border: '1px solid var(--onyx-glass-edge)', borderRadius: 6, color: 'var(--onyx-text-dim)', cursor: 'pointer' }}>Reveal</button>
      </Row>
      <Row label="Maximum cache size" hint="2.4 GB used of 10 GB.">
        <div style={{ display: 'flex', gap: 6 }}>
          {['1', '5', '10', '25', '∞ GB'].map((v, i) => (
            <Pill key={v} active={i === 2} onClick={() => {}}>{v}</Pill>
          ))}
        </div>
      </Row>
      <Row label="Auto-download next book in series" hint="Pre-fetch when you finish a volume.">
        <Toggle on={true} onChange={() => {}} />
      </Row>
      <Row label="Keep downloaded books after finishing" hint="Hold on to the audio in case you re-listen.">
        <Toggle on={false} onChange={() => {}} />
      </Row>
      <Row label="Download quality" hint="Audiobookshelf transcodes on the fly. Original is best for archival listening.">
        <div style={{ display: 'flex', gap: 6 }}>
          {['Low', 'Standard', 'High', 'Original'].map((v, i) => (
            <Pill key={v} active={i === 3} onClick={() => {}}>{v}</Pill>
          ))}
        </div>
      </Row>
      <Row label="Clear all cached audio">
        <button style={{ padding: '6px 14px', fontSize: 11, fontFamily: MONO, letterSpacing: '0.06em', textTransform: 'uppercase' as const, background: 'transparent', border: '1px solid rgba(232,113,106,0.4)', borderRadius: 6, color: '#e8716a', cursor: 'pointer' }}>Clear 2.4 GB</button>
      </Row>
    </div>
  );
}
