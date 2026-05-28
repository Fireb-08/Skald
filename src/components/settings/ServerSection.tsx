import { useState } from 'react';
import { SectionHead, Row, Toggle, TextInput, Pill, SERIF, MONO } from './shared';

export default function ServerSection() {
  const [url, setUrl] = useState('https://abs.home.lan:8443');
  return (
    <div>
      <SectionHead title="Server" subtitle="Your Audiobookshelf server connection." />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 0 18px', borderBottom: '1px solid var(--onyx-line)', marginBottom: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: '#5ac88a', boxShadow: '0 0 8px #5ac88a', flexShrink: 0, display: 'inline-block' }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: SERIF, fontSize: 17, fontWeight: 500 }}>Connected</div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', marginTop: 2 }}>v2.18.3 · 247 titles · last sync 12s ago</div>
        </div>
        <button style={{ padding: '6px 14px', fontSize: 11, fontFamily: MONO, letterSpacing: '0.06em', textTransform: 'uppercase' as const, background: 'var(--onyx-glass)', border: '1px solid var(--onyx-glass-edge)', borderRadius: 6, color: 'var(--onyx-text-dim)', cursor: 'pointer' }}>Reconnect</button>
      </div>
      <Row label="Server URL" hint="The address of your Audiobookshelf instance.">
        <TextInput value={url} onChange={setUrl} mono />
      </Row>
      <Row label="Auto-reconnect" hint="Try to re-establish a dropped connection in the background.">
        <Toggle on={true} onChange={() => {}} />
      </Row>
      <Row label="Sync interval" hint="How often to push playback state up to the server.">
        <div style={{ display: 'flex', gap: 6 }}>
          {['10s', '30s', '60s', '5m'].map((v, i) => (
            <Pill key={v} active={i === 1} onClick={() => {}}>{v}</Pill>
          ))}
        </div>
      </Row>
      <Row label="Verify TLS certificate" hint="Disable only for self-signed certs on your home network.">
        <Toggle on={false} onChange={() => {}} />
      </Row>
    </div>
  );
}
