import { useState } from 'react';
import { SPEEDS } from '../../state/onyx';
import type { OnyxState } from '../../state/onyx';
import { SectionHead, Row, Toggle, useLocal, MONO, Panel, Seg, SegGroup } from './shared';
import ListeningSessionsSection from './ListeningSessionsSection';

// 'playback' shows the existing speed/skip/sleep controls.
// 'sessions' shows the paginated listening-sessions table.
type PlaybackTab = 'playback' | 'sessions';

export interface PlaybackSectionProps {
  st: OnyxState; // needed by ListeningSessionsSection for serverUrl and user type
}

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

export default function PlaybackSection({ st }: PlaybackSectionProps) {
  // Active subtab — persisted so the user returns to the same tab on re-open.
  const [tab, setTab] = useState<PlaybackTab>(() => {
    const stored = localStorage.getItem('onyx.playback.tab');
    return (stored === 'sessions' ? 'sessions' : 'playback') as PlaybackTab;
  });

  // Persist the tab choice whenever it changes.
  const switchTab = (t: PlaybackTab) => {
    localStorage.setItem('onyx.playback.tab', t);
    setTab(t);
  };

  const [speed, setSpeed]               = useLocal('onyx.playback.speed',       '1.0');
  const [skipDur, setSkipDur]           = useLocal('onyx.playback.skip',        '30s');
  const [rewindOnResume, setRewindOnResume] = useLocal('onyx.playback.rewind',  '5s');
  const [autoPlayNext, setAutoPlayNext] = useLocal('onyx.playback.autoPlayNext', true);
  const [sleepDefault, setSleepDefault] = useLocal('onyx.playback.sleepDefault', 'End of chapter');

  const SKIP   = ['10s', '15s', '30s', '60s'];
  const REWIND = ['Off', '2s', '5s', '10s'];
  const SLEEP  = ['Off', '15m', '30m', '1h', 'End of chapter'];

  return (
    <div>
      <SectionHead title="Playback" subtitle="Defaults applied when starting a new book." />

      {/* Subtab pill toggle — Playback settings vs Listening Sessions */}
      <div style={{
        display: 'flex',
        padding: 3,
        gap: 3,
        background: 'var(--onyx-glass)',
        border: '1px solid var(--onyx-glass-edge)',
        borderRadius: 10,
        marginBottom: 28, // space before the active tab's content
        width: 'fit-content', // shrink-wrap to just the two pills
      }}>
        {([ { id: 'playback', label: 'Playback' }, { id: 'sessions', label: 'Sessions' } ] as const).map(t => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => switchTab(t.id)}
              style={{
                padding: '7px 18px',
                borderRadius: 7,
                cursor: 'pointer',
                border: 'none',
                fontFamily: MONO,
                fontSize: 11,
                fontWeight: active ? 600 : 400,
                letterSpacing: '0.04em',
                // Active pill: dimmed gold background with inset ring (matches GreetingPane toggle).
                background: active ? 'var(--onyx-accent-dim)' : 'transparent',
                boxShadow: active ? 'inset 0 0 0 1px var(--onyx-accent-edge)' : 'none',
                color: active ? 'var(--onyx-accent)' : 'var(--onyx-text-dim)',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Sessions tab — renders the paginated listening-sessions table */}
      {tab === 'sessions' && <ListeningSessionsSection st={st} />}

      {/* Playback tab — existing speed/skip/sleep/auto-play controls, wrapped in a Panel */}
      {tab === 'playback' && (
        <Panel label="Playback" style={{ marginTop: 0 }}>
          <Row label="Default playback speed" hint="Applied when you open a book for the first time. Per-book speed overrides this.">
            <SegGroup>
              {SPEEDS.map(s => (
                <Seg key={s} active={s === speed} onClick={() => setSpeed(s)}>{s}×</Seg>
              ))}
            </SegGroup>
          </Row>

          <Row label="Skip duration" hint="Used by the −/+ skip buttons and ←/→ keys.">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <SegGroup>
                {SKIP.map(v => <Seg key={v} active={v === skipDur} onClick={() => setSkipDur(v)}>{v}</Seg>)}
              </SegGroup>
              <WipBadge />
            </div>
          </Row>

          <Row label="Auto-rewind on resume" hint="Step backwards a few seconds when you resume after a pause.">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <SegGroup>
                {REWIND.map(v => <Seg key={v} active={v === rewindOnResume} onClick={() => setRewindOnResume(v)}>{v}</Seg>)}
              </SegGroup>
              <WipBadge />
            </div>
          </Row>

          <Row label="Auto-play next chapter" hint="Continue without pausing when a chapter ends.">
            <Toggle on={autoPlayNext} onChange={setAutoPlayNext} />
          </Row>

          <Row label="Sleep timer default" hint="Pre-fill when you open the sleep timer.">
            <SegGroup>
              {SLEEP.map(v => <Seg key={v} active={v === sleepDefault} onClick={() => setSleepDefault(v)}>{v}</Seg>)}
            </SegGroup>
          </Row>
        </Panel>
      )} {/* end tab === 'playback' */}
    </div>
  );
}
