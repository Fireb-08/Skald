import { useState, useEffect } from 'react';
import { MONO } from './shared';

// A friendly editor for the common cron schedules ABS uses (backups, podcast
// checks). Most users never need raw cron — they pick a frequency and a time.
// A "Custom" mode preserves full power for expressions the builder can't model.
//
// Cron format: "minute hour day-of-month month day-of-week" (5 fields).
// Supported friendly shapes:
//   hourly   → "M * * * *"          (every hour at :M)
//   everyN   → "0 */N * * *"        (every N hours, on the hour)
//   daily    → "M H * * *"          (every day at H:M)
//   weekly   → "M H * * D"          (every D-day at H:M)
// Anything else round-trips through Custom.

export interface CronEditorProps {
  value: string;
  onChange: (cron: string) => void;
}

type Mode = 'hourly' | 'everyN' | 'daily' | 'weekly' | 'custom';

interface CronState {
  mode: Mode;
  minute: number;   // hourly: minute of the hour
  everyN: number;   // everyN: hour interval
  time: string;     // daily/weekly: "HH:MM"
  dow: number;      // weekly: 0=Sun … 6=Sat
  custom: string;   // custom: raw expression
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const EVERY_N_OPTIONS = [2, 3, 4, 6, 8, 12];

const pad2 = (n: number) => String(n).padStart(2, '0');
const hmToTime = (h: number, m: number) => `${pad2(h)}:${pad2(m)}`;

/** Parse a cron expression into the builder state, or fall back to Custom. */
function parseCron(expr: string): CronState {
  const base: CronState = { mode: 'custom', minute: 0, everyN: 6, time: '01:30', dow: 1, custom: expr || '' };
  const parts = (expr || '').trim().split(/\s+/);
  if (parts.length !== 5) return base;
  const [min, hr, dom, mon, dow] = parts;
  const isNum = (s: string) => /^\d+$/.test(s);

  // Only month=* schedules are modeled by the builder.
  if (mon !== '*') return base;

  // Weekly: specific day-of-week, every day-of-month.
  if (dom === '*' && isNum(dow) && isNum(min) && isNum(hr)) {
    return { ...base, mode: 'weekly', dow: Number(dow) % 7, time: hmToTime(Number(hr), Number(min)) };
  }

  if (dom === '*' && dow === '*') {
    // Every N hours on the hour: "0 */N * * *".
    const everyMatch = hr.match(/^\*\/(\d+)$/);
    if (everyMatch && min === '0') {
      return { ...base, mode: 'everyN', everyN: Number(everyMatch[1]) };
    }
    // Hourly: "M * * * *".
    if (hr === '*' && isNum(min)) {
      return { ...base, mode: 'hourly', minute: Number(min) };
    }
    // Daily: "M H * * *".
    if (isNum(hr) && isNum(min)) {
      return { ...base, mode: 'daily', time: hmToTime(Number(hr), Number(min)) };
    }
  }
  return base;
}

/** Build a cron expression from the builder state. */
function buildCron(s: CronState): string {
  switch (s.mode) {
    case 'hourly': return `${s.minute} * * * *`;
    case 'everyN': return `0 */${s.everyN} * * *`;
    case 'daily': {
      const [h, m] = s.time.split(':').map(Number);
      return `${m || 0} ${h || 0} * * *`;
    }
    case 'weekly': {
      const [h, m] = s.time.split(':').map(Number);
      return `${m || 0} ${h || 0} * * ${s.dow}`;
    }
    case 'custom': return s.custom.trim();
  }
}

// Shared control styling.
const controlStyle = {
  fontFamily: MONO, fontSize: 12,
  background: 'var(--onyx-panel2)', color: 'var(--onyx-text)',
  border: '1px solid var(--onyx-glass-edge)', borderRadius: 6,
  padding: '5px 8px', cursor: 'pointer',
} as const;

export default function CronEditor({ value, onChange }: CronEditorProps) {
  const [state, setState] = useState<CronState>(() => parseCron(value));

  // Re-sync when the value changes externally (e.g. a successful save round-trip
  // or the parent loading a different schedule). buildCron(state) === value after
  // our own commits, so this does not loop.
  useEffect(() => { setState(parseCron(value)); }, [value]);

  // Apply a state change and emit the resulting cron if it actually changed.
  function commit(next: CronState) {
    setState(next);
    const cron = buildCron(next);
    if (cron && cron !== value) onChange(cron);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {/* Frequency */}
        <select
          value={state.mode}
          onChange={e => {
            const mode = e.target.value as Mode;
            // Seed sensible defaults when entering a mode; Custom keeps the
            // current generated expression so power users can tweak it.
            const next: CronState = mode === 'custom'
              ? { ...state, mode, custom: buildCron(state) || state.custom }
              : { ...state, mode };
            commit(next);
          }}
          style={{ ...controlStyle, minWidth: 130 }}
        >
          <option value="hourly">Every hour</option>
          <option value="everyN">Every few hours</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="custom">Custom…</option>
        </select>

        {/* Mode-specific controls */}
        {state.mode === 'hourly' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--onyx-text-dim)' }}>
            at&nbsp;:
            <input
              type="number" min={0} max={59}
              value={state.minute}
              onChange={e => {
                const minute = Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0));
                commit({ ...state, minute });
              }}
              style={{ ...controlStyle, width: 60, textAlign: 'right' }}
            />
          </label>
        )}

        {state.mode === 'everyN' && (
          <select
            value={state.everyN}
            onChange={e => commit({ ...state, everyN: Number(e.target.value) })}
            style={controlStyle}
          >
            {EVERY_N_OPTIONS.map(n => <option key={n} value={n}>every {n} hours</option>)}
          </select>
        )}

        {(state.mode === 'daily' || state.mode === 'weekly') && (
          <>
            {state.mode === 'weekly' && (
              <select
                value={state.dow}
                onChange={e => commit({ ...state, dow: Number(e.target.value) })}
                style={controlStyle}
              >
                {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--onyx-text-dim)' }}>
              at
              <input
                type="time"
                value={state.time}
                onChange={e => commit({ ...state, time: e.target.value || '00:00' })}
                style={{ ...controlStyle, padding: '4px 8px' }}
              />
            </label>
          </>
        )}

        {state.mode === 'custom' && (
          <input
            type="text"
            value={state.custom}
            onChange={e => setState({ ...state, custom: e.target.value })}
            onBlur={() => commit({ ...state })}
            placeholder="0 * * * *"
            style={{ ...controlStyle, width: 150, cursor: 'text', textAlign: 'right' }}
          />
        )}
      </div>

      {/* Transparency: show the generated cron so power users can see the result. */}
      <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)' }}>
        {buildCron(state) || '—'}
      </span>
    </div>
  );
}
