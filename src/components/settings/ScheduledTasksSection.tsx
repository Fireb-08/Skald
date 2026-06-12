import { useState, useEffect, useCallback } from 'react';
import type { OnyxState } from '../../state/onyx';
import { getTasks, validateCron, type Task } from '../../api/abs';
import { SectionHead, Row, MONO } from './shared';

export interface ScheduledTasksSectionProps { st: OnyxState; }

// Poll interval for the activity monitor while the panel is open.
const POLL_MS = 3000;

// ── Helpers ─────────────────────────────────────────────────────────────────────

/** Compact "Ns ago" / "Nm ago" / "Nh ago" relative time from a ms-epoch value. */
function relTime(ms: number | null | undefined): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 0) return 'just now';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Minimal human-readable description for the most common cron patterns. */
function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return 'custom schedule';
  const [min, hr, dom, , dow] = parts;
  if (expr === '0 * * * *') return 'every hour';
  if (min !== '*' && hr === '*' && dom === '*' && dow === '*') return `hourly at :${min.padStart(2, '0')}`;
  if (min !== '*' && hr !== '*' && dom === '*' && dow === '*') return `daily at ${hr.padStart(2, '0')}:${min.padStart(2, '0')}`;
  if (dom === '*' && dow !== '*') return `weekly (day ${dow}) at ${hr.padStart(2, '0')}:${min.padStart(2, '0')}`;
  return 'custom schedule';
}

function GroupHead({ label }: { label: string }) {
  return (
    <div style={{
      fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em',
      textTransform: 'uppercase' as const, color: 'var(--onyx-accent)',
      marginTop: 28, marginBottom: 4, paddingBottom: 6,
      borderBottom: '1px solid var(--onyx-glass-edge)',
    }}>
      {label}
    </div>
  );
}

// Status presentation for a task: dot colour + label.
function taskStatus(t: Task): { color: string; label: string } {
  if (!t.isFinished) return { color: '#f59e0b', label: 'Running' };
  if (t.isFailed)   return { color: '#e08a8a', label: 'Failed' };
  return { color: '#4caf50', label: 'Done' };
}

// ── Main section ────────────────────────────────────────────────────────────────

export default function ScheduledTasksSection({ st }: ScheduledTasksSectionProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Cron validator state.
  const [cronInput, setCronInput] = useState('');
  const [cronValid, setCronValid] = useState<boolean | null>(null);
  const [cronChecking, setCronChecking] = useState(false);

  // Admin guard — non-admins should never reach this section.
  if (!st.isAdmin) return null;

  // refresh(silent): silent skips the loading spinner so polling doesn't flicker.
  const refresh = useCallback(async (silent: boolean) => {
    if (!silent) setLoading(true);
    try {
      const resp = await getTasks(st.serverUrl);
      setTasks(resp.tasks);
      setError(null);
    } catch (e) {
      console.error('[Tasks] load failed:', e);
      setError(String(e));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [st.serverUrl]);

  // Initial load + poll while the panel is mounted; stop on unmount.
  useEffect(() => {
    console.log('[Tasks] mounting activity monitor');
    void refresh(false);
    const iv = setInterval(() => void refresh(true), POLL_MS);
    return () => { console.log('[Tasks] stopping activity monitor'); clearInterval(iv); };
  }, [refresh]);

  async function checkCron() {
    const expr = cronInput.trim();
    if (!expr) { setCronValid(null); return; }
    console.log('[Tasks] validate cron →', expr);
    setCronChecking(true);
    try {
      const ok = await validateCron(st.serverUrl, expr);
      setCronValid(ok);
    } catch (e) {
      console.error('[Tasks] validate cron failed:', e);
      setCronValid(false);
    } finally {
      setCronChecking(false);
    }
  }

  // Running tasks first, then most-recently-active. Sort key: running before
  // finished, then by the relevant timestamp descending.
  const sorted = [...tasks].sort((a, b) => {
    if (a.isFinished !== b.isFinished) return a.isFinished ? 1 : -1;
    const ta = a.finishedAt ?? a.startedAt ?? 0;
    const tb = b.finishedAt ?? b.startedAt ?? 0;
    return tb - ta;
  });

  // Schedule summary, read from server settings.
  const backupSchedule = st.serverSettings?.backupSchedule;
  const backupEnabled = typeof backupSchedule === 'string' && backupSchedule.length > 0;
  const podcastSchedule = st.serverSettings?.podcastEpisodeSchedule ?? null;

  return (
    <div>
      <SectionHead
        title="Scheduled Tasks"
        subtitle="Background server activity and the schedules that drive it. Admin only."
      />

      {/* ── Activity monitor ─────────────────────────────────────────────── */}
      <GroupHead label="Activity" />

      {loading && (
        <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', padding: '14px 0' }}>
          Loading tasks…
        </div>
      )}

      {error && !loading && (
        <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', padding: '14px 0' }}>
          Couldn't load tasks: {error}
        </div>
      )}

      {!loading && !error && sorted.length === 0 && (
        <div style={{ fontSize: 12.5, color: 'var(--onyx-text-mute)', padding: '14px 0' }}>
          No active or recent tasks. Background operations (library scans, backups, metadata embeds) will appear here while they run.
        </div>
      )}

      {sorted.map(t => {
        const status = taskStatus(t);
        const title = t.title || t.titleKey || t.action || 'Task';
        const desc = t.description || t.descriptionKey || '';
        const when = t.isFinished ? relTime(t.finishedAt) : relTime(t.startedAt);
        return (
          <div
            key={t.id}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 16, padding: '12px 0', borderBottom: '1px solid var(--onyx-line)',
            }}
          >
            <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 7, height: 7, borderRadius: 4, background: status.color, flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{title}</div>
                {(desc || t.error) && (
                  <div style={{
                    fontSize: 11.5, color: t.error ? '#e08a8a' : 'var(--onyx-text-mute)', marginTop: 3,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 420,
                  }}>
                    {t.error || t.errorKey || desc}
                  </div>
                )}
              </div>
            </div>
            <div style={{ flexShrink: 0, textAlign: 'right' as const }}>
              <div style={{ fontFamily: MONO, fontSize: 10, color: status.color }}>{status.label}</div>
              {when && <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', marginTop: 2 }}>{when}</div>}
            </div>
          </div>
        );
      })}

      {/* ── Schedule summary ─────────────────────────────────────────────── */}
      <GroupHead label="Schedules" />

      <Row label="Automatic backups" hint="Edit in Settings → Backups.">
        <span style={{ fontFamily: MONO, fontSize: 11, color: backupEnabled ? 'var(--onyx-text)' : 'var(--onyx-text-mute)' }}>
          {backupEnabled ? `${backupSchedule as string} · ${describeCron(backupSchedule as string)}` : 'Disabled'}
        </span>
      </Row>

      <Row label="Podcast episode check" hint="Edit in Settings → Server.">
        <span style={{ fontFamily: MONO, fontSize: 11, color: podcastSchedule ? 'var(--onyx-text)' : 'var(--onyx-text-mute)' }}>
          {podcastSchedule ? `${podcastSchedule} · ${describeCron(podcastSchedule)}` : '—'}
        </span>
      </Row>

      {/* ── Cron validator ───────────────────────────────────────────────── */}
      <GroupHead label="Cron Validator" />

      <Row label="Validate a cron expression" hint="Check an expression against the server before using it in a schedule." align="top">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              value={cronInput}
              onChange={e => { setCronInput(e.target.value); setCronValid(null); }}
              onKeyDown={e => { if (e.key === 'Enter') void checkCron(); }}
              placeholder="0 * * * *"
              style={{
                fontFamily: MONO, fontSize: 12, background: 'var(--onyx-panel2)', color: 'var(--onyx-text)',
                border: '1px solid var(--onyx-glass-edge)', borderRadius: 6, padding: '6px 10px', width: 160,
              }}
            />
            <button
              onClick={() => void checkCron()}
              disabled={cronChecking || !cronInput.trim()}
              style={{
                fontFamily: MONO, fontSize: 11, padding: '6px 12px', borderRadius: 6,
                background: 'var(--onyx-accent-dim)', border: '1px solid var(--onyx-accent-edge)',
                color: 'var(--onyx-accent)', cursor: cronChecking || !cronInput.trim() ? 'default' : 'pointer',
                opacity: cronChecking || !cronInput.trim() ? 0.45 : 1,
              }}
            >
              Validate
            </button>
          </div>
          {cronValid !== null && (
            <span style={{ fontFamily: MONO, fontSize: 11, color: cronValid ? '#4caf50' : '#e08a8a' }}>
              {cronValid ? `✓ valid — ${describeCron(cronInput.trim())}` : '✕ invalid expression'}
            </span>
          )}
        </div>
      </Row>
    </div>
  );
}
