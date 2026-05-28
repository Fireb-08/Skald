import { useRef, useEffect } from 'react';
import type { OnyxState } from '../../state/onyx';
import { AUDIO_DEVICES } from '../../state/onyx';
import Icon from '../Icon';
import type { IconName } from '../Icon';

export interface DeviceSelectorProps {
  st: OnyxState;
}

export default function DeviceSelector({ st }: DeviceSelectorProps) {
  const current = AUDIO_DEVICES.find(d => d.id === st.device) ?? AUDIO_DEVICES[0];
  const ref = useRef<HTMLDivElement>(null);
  const mono = "'JetBrains Mono', ui-monospace, monospace";

  useEffect(() => {
    if (!st.deviceOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) st.setDeviceOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [st.deviceOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => st.setDeviceOpen(!st.deviceOpen)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px 6px 12px',
          border: `1px solid ${st.deviceOpen ? 'var(--onyx-accent-edge)' : 'var(--onyx-glass-edge)'}`,
          borderRadius: 8,
          background: st.deviceOpen ? 'var(--onyx-accent-dim)' : 'var(--onyx-glass)',
          backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
          color: 'var(--onyx-text)', cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: 3, background: '#5ac88a', boxShadow: '0 0 6px #5ac88a' }} />
        <Icon name={current.icon as IconName} size={14} color="var(--onyx-text-dim)" />
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1, textAlign: 'left' }}>
          <span style={{ fontSize: 11.5, color: 'var(--onyx-text)' }}>{current.name}</span>
          <span style={{ fontFamily: mono, fontSize: 9, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {current.sub.split(' · ').slice(0, 2).join(' · ')}
          </span>
        </div>
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
          {AUDIO_DEVICES.map(d => (
            <button
              key={d.id}
              onClick={() => { st.setDevice(d.id); st.setDeviceOpen(false); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px', borderRadius: 6,
                background: d.id === st.device ? 'var(--onyx-accent-dim)' : 'transparent',
                border: 'none', width: '100%', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
              }}
            >
              <Icon
                name={d.icon as IconName}
                size={15}
                color={d.id === st.device ? 'var(--onyx-accent)' : 'var(--onyx-text-dim)'}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: d.id === st.device ? 'var(--onyx-accent)' : 'var(--onyx-text)', fontWeight: d.id === st.device ? 500 : 400 }}>{d.name}</div>
                <div style={{ fontFamily: mono, fontSize: 9.5, color: 'var(--onyx-text-mute)', letterSpacing: '0.04em', marginTop: 1 }}>{d.sub}</div>
              </div>
              {d.id === st.device && <Icon name="dot" size={10} color="var(--onyx-accent)" />}
            </button>
          ))}
          <div style={{ borderTop: '1px solid var(--onyx-line)', marginTop: 4, padding: '8px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontFamily: mono, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Exclusive Mode</span>
            <div style={{ width: 26, height: 14, borderRadius: 7, background: 'var(--onyx-accent)', position: 'relative' }}>
              <div style={{ position: 'absolute', right: 2, top: 2, width: 10, height: 10, borderRadius: 5, background: 'var(--onyx-bg)' }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
