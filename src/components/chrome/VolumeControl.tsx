import type { CSSProperties } from 'react';
import type { OnyxState } from '../../state/onyx';
import Icon from '../Icon';
// muteAudio/unmuteAudio pair the LibVLC command with st.setMuted so
// clicking mute actually silences LibVLC, not just the UI slider.
import { muteAudio, unmuteAudio } from '../../api/playbook';

export interface VolumeControlProps {
  st: OnyxState;
  // Compact variant: narrower slider, no numeric label — used in the transport bar.
  compact?: boolean;
  // Optional outer style override — used to constrain width in transport slot.
  style?: CSSProperties;
}

export default function VolumeControl({ st, compact, style }: VolumeControlProps) {
  const v = st.muted ? 0 : st.volume;
  const mono = "'JetBrains Mono', ui-monospace, monospace";

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    st.setMuted(false);
    st.setVolume(parseFloat(e.target.value) / 100);
  };

  return (
    // Outer style prop allows the parent to constrain width (e.g. maxWidth: 120 in compact slot).
    <div style={{
      display: 'flex', alignItems: 'center', gap: compact ? 6 : 10, padding: '6px 12px',
      border: '1px solid var(--onyx-glass-edge)', borderRadius: 8,
      background: 'var(--onyx-glass)',
      // No backdrop-filter (see Glass.tsx) — control sits on the static-tinted top bar.
      ...style,
    }}>
      <button
        onClick={() => st.muted ? unmuteAudio(st) : muteAudio(st)}
        aria-label={st.muted ? 'Unmute' : 'Mute'}
        style={{ background: 'none', border: 'none', color: 'var(--onyx-text-dim)', cursor: 'pointer', padding: 2, display: 'flex' }}
        title="Mute"
      >
        <Icon name={st.muted || st.volume < 0.01 ? 'volume-mute' : 'volume'} size={15} />
      </button>
      {/* Slider — narrower in compact mode to fit the transport bar slot */}
      <div style={{ position: 'relative', width: compact ? 60 : 100, height: 18, display: 'flex', alignItems: 'center' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, height: 2, background: 'rgba(255,255,255,0.12)', borderRadius: 1 }}>
          <div style={{ width: `${v * 100}%`, height: '100%', background: 'var(--onyx-accent)', borderRadius: 1 }} />
        </div>
        <div style={{
          position: 'absolute', left: `calc(${v * 100}% - 5px)`,
          width: 10, height: 10, borderRadius: 5,
          background: 'var(--onyx-text)',
          boxShadow: '0 0 0 1px rgba(0,0,0,0.4), 0 2px 4px rgba(0,0,0,0.4)',
          pointerEvents: 'none',
        }} />
        <input
          type="range" min={0} max={100} value={Math.round(v * 100)}
          aria-label="Volume"
          onChange={onChange}
          style={{ position: 'absolute', inset: 0, width: '100%', opacity: 0, cursor: 'pointer' }}
        />
      </div>
      {/* Numeric label — hidden in compact mode to save horizontal space */}
      {!compact && (
        <span style={{ fontFamily: mono, fontSize: 10, color: 'var(--onyx-text-mute)', minWidth: 22, textAlign: 'right' }}>
          {Math.round(v * 100)}
        </span>
      )}
    </div>
  );
}
