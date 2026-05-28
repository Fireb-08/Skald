import type { OnyxState } from '../../state/onyx';
import { AUDIO_DEVICES } from '../../state/onyx';
import type { IconName } from '../Icon';
import Icon from '../Icon';
import { SectionHead, Row, Toggle, Pill, MONO } from './shared';

export interface AudioSectionProps { st: OnyxState; }

export default function AudioSection({ st }: AudioSectionProps) {
  return (
    <div>
      <SectionHead title="Audio" subtitle="Output device and signal-chain preferences." />
      <Row label="Output device" hint="Active right now. Pick a different device any time from the toolbar." align="top">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          {AUDIO_DEVICES.map(d => (
            <button key={d.id} onClick={() => st.setDevice(d.id)} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', minWidth: 280,
              borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' as const,
              background: d.id === st.device ? 'var(--onyx-accent-dim)' : 'var(--onyx-glass)',
              border: `1px solid ${d.id === st.device ? 'var(--onyx-accent-edge)' : 'var(--onyx-glass-edge)'}`,
            }}>
              <Icon name={d.icon as IconName} size={14} color={d.id === st.device ? 'var(--onyx-accent)' : 'var(--onyx-text-dim)'} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: d.id === st.device ? 'var(--onyx-accent)' : 'var(--onyx-text)', fontWeight: d.id === st.device ? 500 : 400 }}>{d.name}</div>
                <div style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--onyx-text-mute)', marginTop: 1 }}>{d.sub}</div>
              </div>
              {d.id === st.device && <Icon name="dot" size={10} color="var(--onyx-accent)" />}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Exclusive mode" hint="Take exclusive control of the device for bit-perfect playback. Other apps can't play audio while Skald is using it.">
        <Toggle on={true} onChange={() => {}} />
      </Row>
      <Row label="Sample rate" hint="Match the source. Auto follows each book's native rate.">
        <div style={{ display: 'flex', gap: 6 }}>
          {['Auto', '44.1', '48', '96 kHz'].map((v, i) => (
            <Pill key={v} active={i === 0} onClick={() => {}}>{v}</Pill>
          ))}
        </div>
      </Row>
      <Row label="Voice boost" hint="Mild compression to keep dialogue audible at low volume.">
        <Toggle on={false} onChange={() => {}} />
      </Row>
      <Row label="Mono downmix" hint="Combine stereo channels for single-earbud listening.">
        <Toggle on={false} onChange={() => {}} />
      </Row>
    </div>
  );
}
