import { useState, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { OnyxState } from '../../state/onyx';
import Icon from '../Icon';
import { getAudioDevices, setAudioDevice } from '../../api/abs';
import type { AudioDevice } from '../../api/abs';

export interface DeviceSelectorProps {
  st: OnyxState;
  // Compact variant: shows icon only, no device name — used in the transport bar.
  compact?: boolean;
  // Optional outer style override — used to constrain width in transport slot.
  style?: CSSProperties;
}

export default function DeviceSelector({ st, compact, style }: DeviceSelectorProps) {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const mono = "'JetBrains Mono', ui-monospace, monospace";

  useEffect(() => {
    getAudioDevices()
      .then(devs => {
        setDevices(devs);
        if (devs.length > 0 && !devs.find(d => d.id === st.device)) {
          st.setDevice(devs[0].id);
        }
      })
      .catch(e => console.error('[DeviceSelector] getAudioDevices failed:', e));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!st.deviceOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) st.setDeviceOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [st.deviceOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = devices.find(d => d.id === st.device) ?? devices[0];

  return (
    // Outer style prop allows the parent to constrain width (e.g. maxWidth: 120 in compact slot).
    <div ref={ref} style={{ position: 'relative', ...style }}>
      <button
        onClick={() => st.setDeviceOpen(!st.deviceOpen)}
        style={{
          display: 'flex', alignItems: 'center', gap: compact ? 6 : 10,
          padding: compact ? '6px 10px' : '6px 10px 6px 12px',
          border: `1px solid ${st.deviceOpen ? 'var(--onyx-accent-edge)' : 'var(--onyx-glass-edge)'}`,
          borderRadius: 8,
          background: st.deviceOpen ? 'var(--onyx-accent-dim)' : 'var(--onyx-glass)',
          backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
          color: 'var(--onyx-text)', cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: 3, background: '#5ac88a', boxShadow: '0 0 6px #5ac88a' }} />
        <Icon name="headphones" size={14} color="var(--onyx-text-dim)" />
        {/* Device name — hidden in compact mode to fit the narrow transport slot */}
        {!compact && (
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1, textAlign: 'left' }}>
            <span style={{ fontSize: 11.5, color: 'var(--onyx-text)' }}>{current?.name ?? 'Audio output'}</span>
          </div>
        )}
        <span style={{
          color: 'var(--onyx-text-dim)', marginLeft: 4,
          display: 'inline-flex',
          transform: st.deviceOpen ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.15s',
        }}>
          <Icon name="chevron-down" size={11} />
        </span>
      </button>

      {st.deviceOpen && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, width: 300,
          background: 'var(--onyx-panel2)',
          border: '1px solid var(--onyx-line)',
          borderRadius: 10,
          boxShadow: '0 16px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(212,166,74,0.08)',
          padding: 6, zIndex: 100,
        }}>
          <div style={{ fontFamily: mono, fontSize: 9, color: 'var(--onyx-text-mute)', letterSpacing: '0.12em', padding: '6px 8px 4px' }}>OUTPUT DEVICE</div>
          {devices.length === 0 ? (
            <div style={{ padding: '8px', fontFamily: mono, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em' }}>Loading devices…</div>
          ) : devices.map(d => (
            <button
              key={d.id}
              onClick={() => {
                st.setDevice(d.id);
                setAudioDevice(d.id).catch(e => console.error('[DeviceSelector] setAudioDevice failed:', e));
                st.setDeviceOpen(false);
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px', borderRadius: 6,
                background: d.id === st.device ? 'var(--onyx-accent-dim)' : 'transparent',
                border: 'none', width: '100%', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
              }}
            >
              <Icon
                name="headphones"
                size={15}
                color={d.id === st.device ? 'var(--onyx-accent)' : 'var(--onyx-text-dim)'}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12,
                  color: d.id === st.device ? 'var(--onyx-accent)' : 'var(--onyx-text)',
                  fontWeight: d.id === st.device ? 500 : 400,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{d.name}</div>
              </div>
              {d.id === st.device && <Icon name="dot" size={10} color="var(--onyx-accent)" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
