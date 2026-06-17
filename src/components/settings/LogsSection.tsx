import { useState, useEffect, useRef, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { OnyxState } from '../../state/onyx';
import { getLoggerData, startLogStream, stopLogStream, LOGGER_LEVELS, type LogEntry } from '../../api/abs';
import { SectionHead, MONO, Panel } from './shared';

export interface LogsSectionProps { st: OnyxState; }

// Cap the in-memory buffer — logs can be high-volume.
const MAX_LOGS = 2000;

// LogLevel numerics (server/utils/constants.js): TRACE=0, DEBUG=1, INFO=2,
// WARN=3, ERROR=4, FATAL=5, NOTE=6. The "FATAL only" preset (cluster L — there is
// no crash-log endpoint, so crash-level lines are isolated here in the daily log)
// matches FATAL exactly, NOT FATAL-and-above, since NOTE(6) sorts above FATAL.
const FATAL_LEVEL = 5;

const colorForLevel = (level: number) =>
  LOGGER_LEVELS.find(l => l.value === level)?.color ?? 'var(--onyx-text)';

export default function LogsSection({ st }: LogsSectionProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [minLevel, setMinLevel] = useState(2); // Info and above by default
  const [fatalOnly, setFatalOnly] = useState(false); // crash-level preset (cluster L)
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Admin guard — non-admins should never reach this section.
  if (!st.isAdmin) return null;

  // The live tail rides the live-sync socket; without it we only have the seed.
  const liveSyncOn = localStorage.getItem('onyx.sync.live') === 'true';

  // Seed the current day's recent entries via HTTP.
  const seed = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getLoggerData(st.serverUrl);
      setLogs(data.currentDailyLogs);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [st.serverUrl]);

  useEffect(() => { void seed(); }, [seed]);

  // Live tail: register the socket as a log listener at minLevel and append
  // 'server-log' events. Re-runs when minLevel changes (re-registers at the new
  // level). Only active when live sync is connected.
  useEffect(() => {
    if (!liveSyncOn) return;
    let unlisten: (() => void) | undefined;
    let active = true;
    void startLogStream(minLevel);
    listen<string>('server-log', e => {
      try {
        const entry = JSON.parse(e.payload) as LogEntry;
        setLogs(prev => {
          const next = [...prev, entry];
          return next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next;
        });
      } catch { /* ignore malformed log payload */ }
    }).then(fn => { if (active) unlisten = fn; else fn(); });
    return () => {
      active = false;
      unlisten?.();
      void stopLogStream();
    };
  }, [liveSyncOn, minLevel, st.serverUrl]);

  // Client-side view: respect the level filter (covers the seed too) + search.
  // The FATAL-only preset overrides the min-level dropdown and matches FATAL
  // exactly (crash-level isolation — cluster L).
  const filtered = logs.filter(l =>
    (fatalOnly ? l.level === FATAL_LEVEL : l.level >= minLevel) &&
    (search === '' ||
      l.message.toLowerCase().includes(search.toLowerCase()) ||
      l.source.toLowerCase().includes(search.toLowerCase()))
  );

  // Pin to the bottom as new lines arrive when auto-scroll is on.
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filtered.length, autoScroll]);

  const inputStyle = {
    fontFamily: MONO, fontSize: 11, background: 'var(--onyx-panel2)', color: 'var(--onyx-text)',
    border: '1px solid var(--onyx-glass-edge)', borderRadius: 6, padding: '5px 8px',
  } as const;

  return (
    <div>
      <SectionHead title="Logs" subtitle="Live server log. Admin only." />

      <Panel label="Server log">
      {/* Controls */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '10px 0 14px' }}>
        <select
          value={minLevel}
          onChange={e => setMinLevel(Number(e.target.value))}
          disabled={fatalOnly}
          title={fatalOnly ? 'Disabled while FATAL only is active' : undefined}
          style={{ ...inputStyle, cursor: fatalOnly ? 'default' : 'pointer', opacity: fatalOnly ? 0.5 : 1 }}
        >
          {LOGGER_LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}+</option>)}
        </select>
        {/* FATAL-only preset — isolates crash-level lines (cluster L; ABS has no
            crash-log endpoint, so these surface via the normal daily log). */}
        <button
          onClick={() => setFatalOnly(v => !v)}
          title="Show only FATAL (crash-level) entries"
          style={{
            ...inputStyle, cursor: 'pointer',
            background: fatalOnly ? 'var(--onyx-accent-dim)' : 'var(--onyx-panel2)',
            color: fatalOnly ? 'var(--onyx-accent)' : 'var(--onyx-text-dim)',
            border: `1px solid ${fatalOnly ? 'var(--onyx-accent-edge)' : 'var(--onyx-glass-edge)'}`,
            fontWeight: fatalOnly ? 600 : 400,
          }}
        >
          FATAL only
        </button>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="filter text…"
          style={{ ...inputStyle, flex: 1, minWidth: 160 }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--onyx-text-dim)', cursor: 'pointer' }}>
          <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} />
          Auto-scroll
        </label>
        <button
          onClick={() => setLogs([])}
          style={{ ...inputStyle, cursor: 'pointer', color: 'var(--onyx-text-dim)' }}
        >
          Clear
        </button>
      </div>

      {!liveSyncOn && (
        <div style={{ fontSize: 11.5, color: 'var(--onyx-text-mute)', padding: '0 0 10px', lineHeight: 1.5 }}>
          Live tail is off — showing the current day's recent log only. Enable live sync (Settings → Server) to stream new lines.
        </div>
      )}

      {loading && (
        <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', padding: '8px 0' }}>Loading logs…</div>
      )}
      {error && !loading && (
        <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', padding: '8px 0' }}>
          Couldn't load logs: {error}
        </div>
      )}

      {/* Log list */}
      {!loading && !error && (
        <div
          ref={scrollRef}
          className="onyx-selectable"
          style={{
            maxHeight: '58vh', overflowY: 'auto',
            background: 'var(--onyx-bg-deep)', border: '1px solid var(--onyx-glass-edge)', borderRadius: 8,
            padding: '8px 10px', fontFamily: MONO, fontSize: 11, lineHeight: 1.6,
          }}
        >
          {filtered.length === 0 && (
            <div style={{ color: 'var(--onyx-text-mute)' }}>No log entries match.</div>
          )}
          {filtered.map((l, i) => (
            <div key={`${l.timestamp}-${i}`} style={{ display: 'flex', gap: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} title={l.source}>
              <span style={{ color: 'var(--onyx-text-mute)', flexShrink: 0 }}>{l.timestamp}</span>
              <span style={{ color: colorForLevel(l.level), flexShrink: 0, minWidth: 42 }}>{l.levelName}</span>
              <span style={{ color: 'var(--onyx-text)' }}>{l.message}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: 11, color: 'var(--onyx-text-mute)', marginTop: 12, paddingBottom: 4 }}>
        Showing {filtered.length} of {logs.length} buffered. Log level and retention are configured in Settings → Server → Logging.
      </div>
      </Panel>
    </div>
  );
}
