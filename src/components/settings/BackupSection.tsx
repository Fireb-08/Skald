import { useState, useEffect, useCallback } from 'react';
import type { OnyxState } from '../../state/onyx';
import {
  getBackups,
  createBackup,
  deleteBackup,
  applyBackup,
  updateServerSettings,
  type Backup,
  type ServerSettings,
} from '../../api/abs';
import { SectionHead, Row, Toggle, MONO } from './shared';
import ConfirmDialog from '../ui/ConfirmDialog';

export interface BackupSectionProps { st: OnyxState; }

// Default cron used when the user first enables automatic backups (01:30 daily).
const DEFAULT_BACKUP_CRON = '30 1 * * *';

// ── Helpers ─────────────────────────────────────────────────────────────────────

function formatBytes(n: number): string {
  if (!n || n < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const v = n / Math.pow(1024, i);
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
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

function Btn({
  children, onClick, variant = 'ghost', disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: 'ghost' | 'accent' | 'danger';
  disabled?: boolean;
}) {
  const palette = {
    ghost:  { bg: 'transparent',            border: 'var(--onyx-glass-edge)', color: 'var(--onyx-text-dim)' },
    accent: { bg: 'var(--onyx-accent-dim)', border: 'var(--onyx-accent-edge)', color: 'var(--onyx-accent)' },
    danger: { bg: 'rgba(220,80,80,0.12)',   border: 'rgba(220,80,80,0.35)',    color: '#e08a8a' },
  }[variant];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        fontFamily: MONO, fontSize: 11, padding: '5px 12px', borderRadius: 6,
        background: palette.bg, border: `1px solid ${palette.border}`,
        color: palette.color, cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {children}
    </button>
  );
}

// Numeric input that commits on blur (avoids a PATCH per keystroke).
function NumField({
  value, onCommit, min, max, suffix, step,
}: {
  value: number;
  onCommit: (v: number) => void;
  min?: number; max?: number; suffix?: string; step?: number;
}) {
  const [local, setLocal] = useState(String(value));
  useEffect(() => setLocal(String(value)), [value]);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input
        type="number"
        value={local}
        min={min}
        max={max}
        step={step}
        onChange={e => setLocal(e.target.value)}
        onBlur={() => {
          const n = parseFloat(local);
          if (!isNaN(n) && n !== value) onCommit(n);
        }}
        style={{
          fontFamily: MONO, fontSize: 11, background: 'var(--onyx-panel2)', color: 'var(--onyx-text)',
          border: '1px solid var(--onyx-glass-edge)', borderRadius: 6, padding: '5px 10px',
          width: 80, textAlign: 'right' as const,
        }}
      />
      {suffix && <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-dim)' }}>{suffix}</span>}
    </div>
  );
}

// ── Main section ────────────────────────────────────────────────────────────────

export default function BackupSection({ st }: BackupSectionProps) {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [location, setLocation] = useState('');
  const [pathEnvSet, setPathEnvSet] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Pending confirmation dialog (delete or restore), or null.
  const [confirm, setConfirm] = useState<{ kind: 'delete' | 'restore'; backup: Backup } | null>(null);

  // Admin guard — non-admins should never reach this section.
  if (!st.isAdmin) return null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await getBackups(st.serverUrl);
      setBackups(resp.backups);
      setLocation(resp.backupLocation);
      setPathEnvSet(resp.backupPathEnvSet);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [st.serverUrl]);

  useEffect(() => { void load(); }, [load]);

  // ── Backup actions ────────────────────────────────────────────────────────

  async function doCreate() {
    setBusy(true);
    st.setToast({ message: 'Creating backup…', type: 'info' });
    try {
      const resp = await createBackup(st.serverUrl);
      setBackups(resp.backups);
      st.setToast({ message: 'Backup created.', type: 'success' });
    } catch (e) {
      st.setToast({ message: `Backup failed: ${e}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function doDelete(backup: Backup) {
    setBusy(true);
    try {
      const resp = await deleteBackup(st.serverUrl, backup.id);
      setBackups(resp.backups);
      st.setToast({ message: 'Backup deleted.', type: 'success' });
    } catch (e) {
      st.setToast({ message: `Failed to delete: ${e}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function doRestore(backup: Backup) {
    setBusy(true);
    st.setToast({ message: 'Restoring backup — the server will restart…', type: 'info' });
    try {
      await applyBackup(st.serverUrl, backup.id);
      st.setToast({ message: 'Restore started. Audiobookshelf is restarting; reconnect shortly.', type: 'success' });
    } catch (e) {
      st.setToast({ message: `Restore failed: ${e}`, type: 'error' });
    } finally {
      setBusy(false);
    }
  }

  // ── Schedule / retention config (lives in ServerSettings) ───────────────────

  async function patchSettings(partial: Partial<ServerSettings>) {
    try {
      const updated = await updateServerSettings(st.serverUrl, partial);
      st.setServerSettings(updated);
      st.setToast({ message: 'Backup settings saved.', type: 'success' });
    } catch (e) {
      st.setToast({ message: `Failed to save: ${e}`, type: 'error' });
    }
  }

  // Current schedule state read from server settings. backupSchedule is a cron
  // string when enabled, or `false`/null when disabled.
  const schedule = st.serverSettings?.backupSchedule;
  const scheduleEnabled = typeof schedule === 'string' && schedule.length > 0;
  const cronValue = scheduleEnabled ? (schedule as string) : DEFAULT_BACKUP_CRON;

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div>
        <SectionHead title="Backups" subtitle="Database and metadata backups. Admin only." />
        <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', marginTop: 24 }}>
          Loading backups…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <SectionHead title="Backups" subtitle="Database and metadata backups. Admin only." />
        <div style={{
          fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', marginTop: 24,
          padding: '12px 16px', background: 'var(--onyx-glass)', borderRadius: 8,
          border: '1px solid var(--onyx-glass-edge)',
        }}>
          Couldn't load backups: {error}.
          <div style={{ marginTop: 10 }}><Btn variant="accent" onClick={() => void load()}>Retry</Btn></div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <SectionHead
        title="Backups"
        subtitle="Audiobookshelf backs up its database and metadata (not your audio files). Admin only."
      />

      {/* ── Backups list ─────────────────────────────────────────────────── */}
      <GroupHead label="Backups" />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0' }}>
        <div style={{ fontSize: 12.5, color: 'var(--onyx-text-dim)' }}>
          {backups.length} backup{backups.length === 1 ? '' : 's'}
          {location && <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)' }}> · {location}{pathEnvSet ? ' (env)' : ''}</span>}
        </div>
        <Btn variant="accent" onClick={() => void doCreate()} disabled={busy}>+ Create backup now</Btn>
      </div>

      {backups.length === 0 && (
        <div style={{ fontSize: 12.5, color: 'var(--onyx-text-mute)', padding: '4px 0 12px' }}>
          No backups yet.
        </div>
      )}

      {backups.map(b => (
        <div
          key={b.id}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 16, padding: '12px 0', borderBottom: '1px solid var(--onyx-line)',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{b.datePretty || b.id}</div>
            <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', marginTop: 3 }}>
              {formatBytes(b.fileSize)}
              {b.serverVersion ? ` · v${b.serverVersion}` : ''}
              {b.key ? ` · ${b.key}` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <Btn variant="danger" onClick={() => setConfirm({ kind: 'restore', backup: b })} disabled={busy}>Restore</Btn>
            <Btn variant="ghost" onClick={() => setConfirm({ kind: 'delete', backup: b })} disabled={busy}>Delete</Btn>
          </div>
        </div>
      ))}

      {/* ── Schedule & retention ─────────────────────────────────────────── */}
      <GroupHead label="Schedule & Retention" />

      <Row label="Automatic backups" hint="Run a backup on a recurring schedule.">
        <Toggle
          on={scheduleEnabled}
          onChange={v => {
            // Enable → set a default cron; disable → false.
            void patchSettings({ backupSchedule: v ? DEFAULT_BACKUP_CRON : false });
          }}
        />
      </Row>

      {scheduleEnabled && (
        <Row label="Schedule (cron)" hint="Cron expression controlling when automatic backups run. Default: 01:30 daily.">
          <CronField
            value={cronValue}
            onCommit={v => void patchSettings({ backupSchedule: v })}
          />
        </Row>
      )}

      <Row label="Backups to keep" hint="Older backups beyond this count are pruned automatically.">
        <NumField
          value={st.serverSettings?.backupsToKeep ?? 2}
          min={1} max={100}
          onCommit={v => void patchSettings({ backupsToKeep: v })}
        />
      </Row>

      <Row label="Max backup size" hint="Safety limit; a backup larger than this is aborted. Set 0 to disable the limit.">
        <NumField
          value={st.serverSettings?.maxBackupSize ?? 1}
          min={0} max={1024} step={0.5} suffix="GB"
          onCommit={v => void patchSettings({ maxBackupSize: v })}
        />
      </Row>

      {/* ── Confirm dialogs ──────────────────────────────────────────────── */}
      {confirm?.kind === 'delete' && (
        <ConfirmDialog
          title="Delete backup?"
          message={`Permanently delete the backup from ${confirm.backup.datePretty || confirm.backup.id}? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => { const b = confirm.backup; setConfirm(null); void doDelete(b); }}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm?.kind === 'restore' && (
        <ConfirmDialog
          title="Restore this backup?"
          message={`Restoring the backup from ${confirm.backup.datePretty || confirm.backup.id} overwrites the server's current database and metadata, then restarts Audiobookshelf. You will be disconnected. This cannot be undone.`}
          confirmLabel="Restore & restart"
          danger
          onConfirm={() => { const b = confirm.backup; setConfirm(null); void doRestore(b); }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

// Cron text input committing on blur.
function CronField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <input
      value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => { const v = local.trim(); if (v && v !== value) onCommit(v); }}
      placeholder="30 1 * * *"
      style={{
        fontFamily: MONO, fontSize: 12, background: 'var(--onyx-panel2)', color: 'var(--onyx-text)',
        border: '1px solid var(--onyx-glass-edge)', borderRadius: 6, padding: '6px 10px', width: 160,
        textAlign: 'right' as const,
      }}
    />
  );
}
