import type { OnyxState } from '../../state/onyx';
import { SPEEDS } from '../../state/onyx';
import { SectionHead, Row, Toggle, Pill, useLocal } from './shared';

export interface PlaybackSectionProps { st: OnyxState; }

export default function PlaybackSection({ st }: PlaybackSectionProps) {
  const [skipDur, setSkipDur] = useLocal('onyx.playback.skip', '30s');
  const [rewindOnResume, setRewindOnResume] = useLocal('onyx.playback.rewind', '5s');
  const [autoPlayNext, setAutoPlayNext] = useLocal('onyx.playback.autoPlayNext', true);
  const [smartPause, setSmartPause] = useLocal('onyx.playback.smartPause', true);
  const [sleepDefault, setSleepDefault] = useLocal('onyx.playback.sleepDefault', 'End of chapter');

  const SKIP = ['10s', '15s', '30s', '60s'];
  const REWIND = ['Off', '2s', '5s', '10s'];
  const SLEEP = ['Off', '15m', '30m', '1h', 'End of chapter'];

  return (
    <div>
      <SectionHead title="Playback" subtitle="Defaults applied when starting a new book." />
      <Row label="Default playback speed" hint="Applied when you open a book for the first time. Per-book speed overrides this.">
        <div style={{ display: 'flex', gap: 6 }}>
          {SPEEDS.map(s => <Pill key={s} active={s === st.speed} onClick={() => st.setSpeed(s)}>{s}×</Pill>)}
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
        <Toggle on={autoPlayNext} onChange={setAutoPlayNext} />
      </Row>
      <Row label="Smart pause" hint="Pause when the audio device disconnects (e.g. headphones unplugged).">
        <Toggle on={smartPause} onChange={setSmartPause} />
      </Row>
      <Row label="Sleep timer default" hint="Pre-fill when you open the sleep timer.">
        <div style={{ display: 'flex', gap: 6 }}>
          {SLEEP.map(v => <Pill key={v} active={v === sleepDefault} onClick={() => setSleepDefault(v)}>{v}</Pill>)}
        </div>
      </Row>
    </div>
  );
}
