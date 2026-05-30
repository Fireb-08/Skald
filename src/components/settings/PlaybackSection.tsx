import { SPEEDS } from '../../state/onyx';
import { SectionHead, Row, Toggle, Pill, useLocal, MONO } from './shared';

export interface PlaybackSectionProps {}

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

export default function PlaybackSection() {
  const [speed, setSpeed]               = useLocal('onyx.playback.speed',       '1.0');
  const [skipDur, setSkipDur]           = useLocal('onyx.playback.skip',        '30s');
  const [rewindOnResume, setRewindOnResume] = useLocal('onyx.playback.rewind',  '5s');
  const [autoPlayNext, setAutoPlayNext] = useLocal('onyx.playback.autoPlayNext', true);
  const [smartPause, setSmartPause]     = useLocal('onyx.playback.smartPause',   true);
  const [sleepDefault, setSleepDefault] = useLocal('onyx.playback.sleepDefault', 'End of chapter');

  const SKIP   = ['10s', '15s', '30s', '60s'];
  const REWIND = ['Off', '2s', '5s', '10s'];
  const SLEEP  = ['Off', '15m', '30m', '1h', 'End of chapter'];

  return (
    <div>
      <SectionHead title="Playback" subtitle="Defaults applied when starting a new book." />

      <Row label="Default playback speed" hint="Applied when you open a book for the first time. Per-book speed overrides this.">
        <div style={{ display: 'flex', gap: 6 }}>
          {SPEEDS.map(s => (
            <Pill key={s} active={s === speed} onClick={() => setSpeed(s)}>{s}×</Pill>
          ))}
        </div>
      </Row>

      <Row label="Skip duration" hint="Used by the −/+ skip buttons and ←/→ keys.">
        <div style={{ display: 'flex', gap: 6 }}>
          {SKIP.map(v => <Pill key={v} active={v === skipDur} onClick={() => setSkipDur(v)}>{v}</Pill>)}
        </div>
      </Row>

      <Row label="Auto-rewind on resume" hint="Step backwards a few seconds when you resume after a pause.">
        <div style={{ display: 'flex', gap: 6 }}>
          {REWIND.map(v => <Pill key={v} active={v === rewindOnResume} onClick={() => setRewindOnResume(v)}>{v}</Pill>)}
        </div>
      </Row>

      <Row label="Auto-play next chapter" hint="Continue without pausing when a chapter ends.">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Toggle on={autoPlayNext} onChange={setAutoPlayNext} />
          <WipBadge />
        </div>
      </Row>

      <Row label="Smart pause" hint="Pause when the audio device disconnects (e.g. headphones unplugged).">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Toggle on={smartPause} onChange={setSmartPause} />
          <WipBadge />
        </div>
      </Row>

      <Row label="Sleep timer default" hint="Pre-fill when you open the sleep timer.">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {SLEEP.map(v => <Pill key={v} active={v === sleepDefault} onClick={() => setSleepDefault(v)}>{v}</Pill>)}
          </div>
          <WipBadge />
        </div>
      </Row>
    </div>
  );
}
