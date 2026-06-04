import lyreIcon from '../../assets/lyre.png';
import { SectionHead, Row, Pill, SERIF, MONO } from './shared';

export default function AboutSection() {
  return (
    <div>
      <SectionHead title="About" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '0 0 24px', borderBottom: '1px solid var(--onyx-line)' }}>
        <img
          src={lyreIcon}
          alt="Skald"
          style={{
            width: 64,
            height: 64,
            objectFit: 'contain',
            filter: 'drop-shadow(0 0 12px rgba(var(--onyx-accent-r), var(--onyx-accent-g), var(--onyx-accent-b), 0.3))',
          }}
        />
        <div>
          <div style={{ fontFamily: SERIF, fontSize: 26, fontWeight: 500 }}>Skald<span style={{ color: 'var(--onyx-accent)' }}>.</span></div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', marginTop: 2 }}>v0.1.0 · Onyx · alpha</div>
          <div style={{ fontSize: 12, color: 'var(--onyx-text-dim)', marginTop: 6, maxWidth: 480 }}>A native desktop client for Audiobookshelf.</div>
        </div>
      </div>
      <Row label="Check for updates" hint="Automatic checks run every 24h.">
        <button style={{ padding: '6px 14px', fontSize: 11, fontFamily: MONO, letterSpacing: '0.06em', textTransform: 'uppercase' as const, background: 'var(--onyx-glass)', border: '1px solid var(--onyx-glass-edge)', borderRadius: 6, color: 'var(--onyx-text-dim)', cursor: 'pointer' }}>Check now</button>
      </Row>
      <Row label="Release channel">
        <div style={{ display: 'flex', gap: 6 }}>
          {['Stable', 'Beta', 'Nightly'].map((v, i) => (
            <Pill key={v} active={i === 1} onClick={() => {}}>{v}</Pill>
          ))}
        </div>
      </Row>
      <Row label="Open source licenses">
        <button style={{ padding: '6px 14px', fontSize: 11, fontFamily: MONO, letterSpacing: '0.06em', textTransform: 'uppercase' as const, background: 'var(--onyx-glass)', border: '1px solid var(--onyx-glass-edge)', borderRadius: 6, color: 'var(--onyx-text-dim)', cursor: 'pointer' }}>View</button>
      </Row>
      <Row label="Diagnostic report" hint="Bundle logs + config for sharing with support.">
        <button style={{ padding: '6px 14px', fontSize: 11, fontFamily: MONO, letterSpacing: '0.06em', textTransform: 'uppercase' as const, background: 'var(--onyx-glass)', border: '1px solid var(--onyx-glass-edge)', borderRadius: 6, color: 'var(--onyx-text-dim)', cursor: 'pointer' }}>Generate</button>
      </Row>
    </div>
  );
}
