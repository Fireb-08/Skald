// The "Up next" prompt (Auto-Play Next roadmap, Phase 4). Sits above the
// MiniPlayer with the cover, what is about to play, and a countdown ring — the
// ring rather than a bare number because the listener is usually not looking at
// the screen when a book ends, and a shrinking arc reads at a glance.
//
// The countdown itself is a reducer (lib/upNextCountdown.ts): Cancel has to stop
// a tick that is already in flight, and "Play now" must not start a second
// session on a double-click.
import { useEffect, useReducer, useRef } from 'react';
import Cover from '../Cover';
import type { UpNextTarget } from '../../state/upNextTarget';
import { countdownReducer, startCountdown } from '../../lib/upNextCountdown';

const MONO = "'JetBrains Mono', ui-monospace, monospace";

export interface UpNextPanelProps {
  target: UpNextTarget;
  seconds: number;
  serverUrl: string;
  /** Countdown elapsed, or "Play now". */
  onPlay: () => void;
  /** Cancel — playback stays stopped. */
  onDismiss: () => void;
}

const RING_SIZE = 34;
const RING_RADIUS = 14;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export default function UpNextPanel({ target, seconds, serverUrl, onPlay, onDismiss }: UpNextPanelProps) {
  const [state, dispatch] = useReducer(countdownReducer, seconds, startCountdown);

  // Restart cleanly if a second item resolves while the panel is still up.
  const key = target.kind === 'book' ? target.item.id : target.episode.id ?? target.item.id;
  useEffect(() => { dispatch({ type: 'start', seconds }); }, [key, seconds]);

  useEffect(() => {
    if (state.status !== 'counting') return;
    const t = setInterval(() => dispatch({ type: 'tick' }), 1000);
    return () => clearInterval(t);
  }, [state.status]);

  // Fire the outcome once the machine resolves. Guarded by a ref because the
  // effect re-runs on every render while the terminal state persists.
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current || state.status === 'counting') return;
    firedRef.current = true;
    if (state.status === 'playing') onPlay();
    else onDismiss();
  }, [state.status, onPlay, onDismiss]);

  const title = target.kind === 'book'
    ? target.item.media?.metadata?.title ?? 'Next book'
    : target.episode.title;
  const subtitle = target.kind === 'book'
    ? target.item.media?.metadata?.seriesName ?? ''
    : target.item.media?.metadata?.title ?? '';
  const elapsed = seconds > 0 ? (seconds - state.secondsLeft) / seconds : 1;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 96,
        right: 24,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: 340,
        background: 'var(--onyx-panel2)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid var(--onyx-glass-edge)',
        borderLeft: '3px solid var(--onyx-accent)',
        borderRadius: 8,
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        padding: 12,
        pointerEvents: 'auto',
      }}
    >
      <Cover item={target.item} size={48} serverUrl={serverUrl} style={{ flexShrink: 0, borderRadius: 4 }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.08em', color: 'var(--onyx-text-mute)' }}>
          UP NEXT
        </div>
        <div style={{
          fontSize: 13,
          color: 'var(--onyx-text)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {title}
        </div>
        {subtitle && (
          <div style={{
            fontSize: 11,
            color: 'var(--onyx-text-dim)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {subtitle}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            onClick={() => dispatch({ type: 'play-now' })}
            style={{
              background: 'var(--onyx-accent)',
              border: 'none',
              borderRadius: 4,
              color: 'var(--onyx-bg)',
              cursor: 'pointer',
              fontSize: 11,
              padding: '4px 10px',
            }}
          >
            Play now
          </button>
          <button
            onClick={() => dispatch({ type: 'cancel' })}
            style={{
              background: 'none',
              border: '1px solid var(--onyx-glass-edge)',
              borderRadius: 4,
              color: 'var(--onyx-text-dim)',
              cursor: 'pointer',
              fontSize: 11,
              padding: '4px 10px',
            }}
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Countdown ring — the arc drains clockwise as the seconds run out. */}
      <div style={{ position: 'relative', width: RING_SIZE, height: RING_SIZE, flexShrink: 0 }}>
        <svg width={RING_SIZE} height={RING_SIZE} style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
          <circle
            cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS}
            fill="none" stroke="var(--onyx-glass-edge)" strokeWidth={2}
          />
          <circle
            cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS}
            fill="none" stroke="var(--onyx-accent)" strokeWidth={2}
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={RING_CIRCUMFERENCE * elapsed}
            style={{ transition: 'stroke-dashoffset 1s linear' }}
          />
        </svg>
        <span style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: MONO,
          fontSize: 11,
          color: 'var(--onyx-text-dim)',
        }}>
          {state.secondsLeft}
        </span>
      </div>
    </div>
  );
}
