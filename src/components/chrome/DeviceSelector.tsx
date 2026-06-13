import { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
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
  const mono = "'JetBrains Mono', ui-monospace, monospace";

  // Ref on the outer wrapper — used to detect clicks on the trigger area.
  const ref = useRef<HTMLDivElement>(null);
  // Ref on the trigger button — measured with getBoundingClientRect() when the
  // dropdown opens so the fixed panel can be anchored to the button's position.
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Ref on the dropdown panel — needed for outside-click detection now that the
  // panel is fixed-positioned and is no longer a DOM child of the wrapper div.
  const panelRef = useRef<HTMLDivElement>(null);

  // Viewport-relative position for the fixed dropdown panel.
  // Updated each time the dropdown opens so it tracks any scroll or resize.
  const [dropPos, setDropPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });

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

  // Outside-click handler — must check BOTH the trigger wrapper and the dropdown
  // panel because the panel is now fixed-positioned and not inside ref.current.
  useEffect(() => {
    if (!st.deviceOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // Clicks on the trigger wrapper or the floating panel are not "outside".
      if (ref.current?.contains(target) || panelRef.current?.contains(target)) return;
      st.setDeviceOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [st.deviceOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = devices.find(d => d.id === st.device) ?? devices[0];

  return (
    // position: relative removed — the fixed panel uses viewport coordinates
    // directly, so it does not need a positioned ancestor.
    <div ref={ref} style={{ ...style }}>
      <button
        ref={triggerRef}
        onClick={() => {
          // Measure the trigger's viewport rect before opening so the dropdown
          // panel is positioned flush below the button regardless of scroll.
          if (!st.deviceOpen && triggerRef.current) {
            const r = triggerRef.current.getBoundingClientRect();
            setDropPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
          }
          st.setDeviceOpen(!st.deviceOpen);
        }}
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

      {/* Portal to document.body so the panel renders outside #root entirely.
          InterfaceScalePicker applies transform:scale() to #root, which makes
          position:fixed children position relative to that element rather than
          the viewport — placing them off-screen. Portalling out of #root bypasses
          the transform ancestor and restores true viewport-relative positioning. */}
      {st.deviceOpen && ReactDOM.createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed',
            top: dropPos.top,
            right: dropPos.right,
            width: 300,
            background: 'var(--onyx-panel2)',
            border: '1px solid var(--onyx-line)',
            borderRadius: 10,
            boxShadow: '0 16px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.08)',
            padding: 6,
            zIndex: 9999,
          }}
        >
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
        </div>,
        document.body,
      )}
    </div>
  );
}
