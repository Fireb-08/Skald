import { useState, useEffect } from 'react';
import { getAudioDevices, setAudioDevice as setAudioDeviceCmd } from '../../api/abs';
import type { AudioDevice } from '../../api/abs';
import Icon from '../Icon';
import { SectionHead, Row, MONO } from './shared';

export interface AudioSectionProps {}

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
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 8, width: '100%' }}>
          {devices.length === 0 ? (
            <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', padding: '8px 12px', letterSpacing: '0.06em' }}>
              Loading devices…
            </div>
          ) : devices.map(d => (
            <button key={d.id} onClick={() => selectDevice(d.id)} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', width: '100%',
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
    </div>
  );
}
