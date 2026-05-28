import { SectionHead, Row, Pill, SERIF, MONO } from './shared';

export default function AboutSection() {
  return (
    <div>
      <SectionHead title="About" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '0 0 24px', borderBottom: '1px solid var(--onyx-line)' }}>
        <div style={{ width: 56, height: 56, borderRadius: 12, background: 'var(--onyx-glass-strong)', border: '1px solid var(--onyx-glass-edge)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--onyx-accent)', fontFamily: SERIF, fontSize: 30, fontWeight: 600 }}>S</div>
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
