import { useState } from 'react';
import { SectionHead, Row, Toggle, TextInput, SERIF, MONO } from './shared';

export default function AccountSection() {
  const [name, setName] = useState('Jordan');
  const [email] = useState('jordan@home.lan');
  return (
    <div>
      <SectionHead title="Account" subtitle="Your local profile and identity on this device." />
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '0 0 24px', borderBottom: '1px solid var(--onyx-line)' }}>
        <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--onyx-accent)', color: 'var(--onyx-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 28 }}>J</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: SERIF, fontSize: 20, fontWeight: 500 }}>{name}</div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', marginTop: 2 }}>{email}</div>
          <button style={{ marginTop: 10, padding: '5px 12px', fontSize: 11, fontFamily: MONO, letterSpacing: '0.06em', textTransform: 'uppercase' as const, background: 'var(--onyx-glass)', border: '1px solid var(--onyx-glass-edge)', borderRadius: 6, color: 'var(--onyx-text-dim)', cursor: 'pointer' }}>Change avatar</button>
        </div>
      </div>
      <Row label="Display name" hint="Shown in the titlebar and listening activity.">
        <TextInput value={name} onChange={setName} />
      </Row>
      <Row label="Email" hint="Used to identify your account on the Audiobookshelf server.">
        <TextInput value={email} onChange={() => {}} />
      </Row>
      <Row label="Listening stats" hint="Share anonymous listening time + streak with the server.">
        <Toggle on={true} onChange={() => {}} />
      </Row>
    </div>
  );
}
