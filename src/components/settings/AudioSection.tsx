import { useState, useEffect } from 'react';
import { getAudioDevices, setAudioDevice as setAudioDeviceCmd } from '../../api/abs';
import type { AudioDevice } from '../../api/abs';
import Icon from '../Icon';
import { SectionHead, Row, Toggle, Pill, MONO } from './shared';

export interface AudioSectionProps {}

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

export default function AudioSection() {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    getAudioDevices()
      .then(list => {
        setDevices(list);
        setSelectedId(prev => prev ?? list[0]?.id ?? null);
      })
      .catch(console.error);
  }, []);

  function selectDevice(id: string) {
    setSelectedId(id);
    setAudioDeviceCmd(id).catch(console.error);
  }

  return (
    <div>
      <SectionHead title="Audio" subtitle="Output device and signal-chain preferences." />

      <Row label="Output device" hint="Active right now. Pick a different device any time from the toolbar." align="top">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          {devices.length === 0 ? (
            <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', padding: '8px 12px', letterSpacing: '0.06em' }}>
              Loading devices…
            </div>
          ) : devices.map(d => (
            <button key={d.id} onClick={() => selectDevice(d.id)} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', minWidth: 280,
              borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' as const,
              background: d.id === selectedId ? 'var(--onyx-accent-dim)' : 'var(--onyx-glass)',
              border: `1px solid ${d.id === selectedId ? 'var(--onyx-accent-edge)' : 'var(--onyx-glass-edge)'}`,
            }}>
              <Icon name="headphones" size={14} color={d.id === selectedId ? 'var(--onyx-accent)' : 'var(--onyx-text-dim)'} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: d.id === selectedId ? 'var(--onyx-accent)' : 'var(--onyx-text)', fontWeight: d.id === selectedId ? 500 : 400 }}>{d.name}</div>
              </div>
              {d.id === selectedId && <Icon name="dot" size={10} color="var(--onyx-accent)" />}
            </button>
          ))}
        </div>
      </Row>

      <Row label="Exclusive mode" hint="Take exclusive control of the device for bit-perfect playback. Other apps can't play audio while Skald is using it.">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Toggle on={true} onChange={() => {}} />
          <WipBadge />
        </div>
      </Row>

      <Row label="Sample rate" hint="Match the source. Auto follows each book's native rate.">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {['Auto', '44.1', '48', '96 kHz'].map((v, i) => (
              <Pill key={v} active={i === 0} onClick={() => {}}>{v}</Pill>
            ))}
          </div>
          <WipBadge />
        </div>
      </Row>

      <Row label="Voice boost" hint="Mild compression to keep dialogue audible at low volume.">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Toggle on={false} onChange={() => {}} />
          <WipBadge />
        </div>
      </Row>

      <Row label="Mono downmix" hint="Combine stereo channels for single-earbud listening.">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Toggle on={false} onChange={() => {}} />
          <WipBadge />
        </div>
      </Row>
    </div>
  );
}
