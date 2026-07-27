import { useEffect, useState } from 'react';
import { setAutoRewindCfg } from '../../api/abs';
import { autoRewindCfg } from '../../lib/playbackPrefs';
import { log } from '../../lib/log';
import { SPEEDS } from '../../state/onyx';
import type { OnyxState } from '../../state/onyx';
import { SectionHead, Row, Toggle, useLocal, MONO, Panel, Pill, Seg, SegGroup } from './shared';
import { clearAllPerBookSpeeds, rememberedSpeedCount } from '../../lib/speedMemory';
import ListeningSessionsSection from './ListeningSessionsSection';

// 'playback' shows the existing speed/skip/sleep controls.
// 'sessions' shows the paginated listening-sessions table.
type PlaybackTab = 'playback' | 'sessions';

export interface PlaybackSectionProps {
  st: OnyxState; // needed by ListeningSessionsSection for serverUrl and user type
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

  // Adaptive auto-rewind. `onyx.playback.rewind` above stays the fixed step —
  // these are additions beside it, never a reinterpretation of it, so turning
  // scaling back off restores exactly the behaviour the user had before.
  const [adaptive, setAdaptive]             = useLocal('onyx.playback.autoRewind.adaptive', false);
  const [rewindMin, setRewindMin]           = useLocal('onyx.playback.autoRewind.min', 1);
  const [rewindMax, setRewindMax]           = useLocal('onyx.playback.autoRewind.max', 30);
  const [rewindDelay, setRewindDelay]       = useLocal('onyx.playback.autoRewind.delay', 0);
  const [chapterBarrier, setChapterBarrier] = useLocal('onyx.playback.autoRewind.chapterBarrier', false);

  // Per-book speed memory. Default on: the feature is only useful if it works
  // before you go looking for it, and turning it off restores global-only
  // behaviour without discarding what was already remembered.
  const [perBookSpeed, setPerBookSpeed] = useLocal('onyx.playback.perBookSpeed', true);
  const [rememberedCount, setRememberedCount] = useState(() => rememberedSpeedCount());

  // The backend owns the resume decision, so every change has to reach it. Runs
  // on mount too, which is harmless (App.tsx pushes the same values) and means
  // the panel cannot leave the backend stale if it is opened before that.
  useEffect(() => {
    setAutoRewindCfg(autoRewindCfg()).catch(e =>
      log.warn('playback', 'auto-rewind config push failed', { err: String(e) }),
    );
  }, [adaptive, rewindMin, rewindMax, rewindDelay, chapterBarrier, rewindOnResume]);

  const SKIP   = ['10s', '15s', '30s', '60s'];
  const REWIND = ['Off', '2s', '5s', '10s'];
  const SLEEP  = ['Off', '15m', '30m', '1h', 'End of chapter'];
  // Kept short and log-spaced: these are "feel" choices, not dial-in numbers.
  const MIN_STEPS = [1, 2, 5, 10];
  const MAX_STEPS = [15, 30, 60, 120];
  const DELAYS    = [0, 5, 15, 60];

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

          <Row
            label="Remember speed per book"
            hint="Each book keeps the speed you last chose for it. Off means every book uses the default above."
          >
            <Toggle on={perBookSpeed} onChange={setPerBookSpeed} />
          </Row>

          {perBookSpeed && (
            <Row
              label="Saved book speeds"
              hint={rememberedCount === 0
                ? 'No book has its own speed yet.'
                : `${rememberedCount} book${rememberedCount === 1 ? '' : 's'} play at their own speed.`}
            >
              <Pill
                active={false}
                onClick={() => {
                  if (rememberedCount === 0) return;
                  clearAllPerBookSpeeds();
                  // Re-read rather than assume: the reset touches storage, and
                  // the count is what tells the user it worked.
                  setRememberedCount(rememberedSpeedCount());
                }}
              >
                Reset all
              </Pill>
            </Row>
          )}

          <Row label="Skip duration" hint="Used by the −/+ skip buttons and ←/→ keys.">
            <SegGroup>
              {SKIP.map(v => <Seg key={v} active={v === skipDur} onClick={() => setSkipDur(v)}>{v}</Seg>)}
            </SegGroup>
          </Row>

          <Row label="Auto-rewind on resume" hint="Step backwards a few seconds when you resume after a pause.">
            <SegGroup>
              {REWIND.map(v => <Seg key={v} active={v === rewindOnResume} onClick={() => setRewindOnResume(v)}>{v}</Seg>)}
            </SegGroup>
          </Row>

          <Row
            label="Scale rewind with time away"
            hint="Rewind further after a long break than after a short one. Replaces the fixed step above."
          >
            <Toggle on={adaptive} onChange={setAdaptive} />
          </Row>

          {/* The advanced controls only make sense once scaling is on — showing
              them inert would suggest the fixed step respects them, which it
              does not. */}
          {adaptive && (
            <>
              <Row label="Shortest rewind" hint="Applied after a brief pause.">
                <SegGroup>
                  {MIN_STEPS.map(v => (
                    <Seg key={v} active={v === rewindMin} onClick={() => setRewindMin(v)}>{v}s</Seg>
                  ))}
                </SegGroup>
              </Row>

              <Row label="Longest rewind" hint="Applied after several hours away.">
                <SegGroup>
                  {MAX_STEPS.map(v => (
                    <Seg key={v} active={v === rewindMax} onClick={() => setRewindMax(v)}>{v}s</Seg>
                  ))}
                </SegGroup>
              </Row>

              <Row label="Ignore pauses shorter than" hint="Skip the rewind entirely for a quick interruption.">
                <SegGroup>
                  {DELAYS.map(v => (
                    <Seg key={v} active={v === rewindDelay} onClick={() => setRewindDelay(v)}>
                      {v === 0 ? 'Off' : `${v}s`}
                    </Seg>
                  ))}
                </SegGroup>
              </Row>

              <Row label="Stay within the chapter" hint="Never rewind past the start of the chapter you are in.">
                <Toggle on={chapterBarrier} onChange={setChapterBarrier} />
              </Row>
            </>
          )}

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
