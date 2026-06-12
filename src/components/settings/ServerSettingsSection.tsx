import { useState, useEffect, useCallback } from 'react';
import type { OnyxState, ServerSettings } from '../../state/onyx';
import { SectionHead, Row, Toggle, MONO } from './shared';
import {
  getServerSettings,
  updateServerSettings,
  updateSortingPrefixes,
  COVER_PROVIDERS,
  LOG_LEVELS,
} from '../../api/abs';

export interface ServerSettingsSectionProps { st: OnyxState; }

// ── Internal helpers ──────────────────────────────────────────────────────────

function GroupHead({ label }: { label: string }) {
  return (
    <div style={{
      fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em',
      textTransform: 'uppercase' as const,
      color: 'var(--onyx-accent)',
      marginTop: 28, marginBottom: 4,
      paddingBottom: 6,
      borderBottom: '1px solid var(--onyx-glass-edge)',
    }}>
      {label}
    </div>
  );
}

function Dropdown<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T | null | undefined;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <select
      value={value ?? ''}
      onChange={e => {
        const raw = e.target.value;
        const opt = options.find(o => String(o.value) === raw);
        if (opt) onChange(opt.value);
      }}
      style={{
        fontFamily: MONO, fontSize: 11,
        background: 'var(--onyx-bg2)',
        color: 'var(--onyx-text)',
        border: '1px solid var(--onyx-glass-edge)',
        borderRadius: 6, padding: '5px 10px', cursor: 'pointer',
        minWidth: 160,
      }}
    >
      {options.map(o => (
        <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
      ))}
    </select>
  );
}

function NumInput({
  value, onChange, min, max, suffix,
}: {
  value: number | null | undefined;
  onChange: (v: number) => void;
  min?: number; max?: number; suffix?: string;
}) {
  const [local, setLocal] = useState(String(value ?? ''));

  useEffect(() => setLocal(String(value ?? '')), [value]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input
        type="number"
        value={local}
        min={min}
        max={max}
        onChange={e => setLocal(e.target.value)}
        onBlur={() => {
          const n = parseInt(local, 10);
          if (!isNaN(n)) onChange(n);
        }}
        style={{
          fontFamily: MONO, fontSize: 11,
          background: 'var(--onyx-bg2)',
          color: 'var(--onyx-text)',
          border: '1px solid var(--onyx-glass-edge)',
          borderRadius: 6, padding: '5px 10px',
          width: 64, textAlign: 'right' as const,
        }}
      />
      {suffix && <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-dim)' }}>{suffix}</span>}
    </div>
  );
}

function CronInput({
  value, onChange,
}: {
  value: string | null | undefined;
  onChange: (v: string) => void;
}) {
  const [local, setLocal] = useState(value ?? '');
  useEffect(() => setLocal(value ?? ''), [value]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 4 }}>
      <input
        type="text"
        value={local}
        onChange={e => setLocal(e.target.value)}
        onBlur={() => onChange(local.trim())}
        placeholder="e.g. 0 * * * *"
        style={{
          fontFamily: MONO, fontSize: 11,
          background: 'var(--onyx-bg2)',
          color: 'var(--onyx-text)',
          border: '1px solid var(--onyx-glass-edge)',
          borderRadius: 6, padding: '5px 10px', width: 180,
        }}
      />
      {local && (
        <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)' }}>
          {describeCron(local)}
        </span>
      )}
    </div>
  );
}

/** Minimal human-readable cron description for the most common patterns. */
function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return 'custom schedule';
  const [min, hr, dom, , dow] = parts;
  if (expr === '0 * * * *') return 'every hour';
  if (min !== '*' && hr === '*' && dom === '*' && dow === '*') return `every hour at :${min.padStart(2, '0')}`;
  if (min !== '*' && hr !== '*' && dom === '*' && dow === '*') return `daily at ${hr.padStart(2, '0')}:${min.padStart(2, '0')}`;
  if (dom === '*' && dow !== '*') return `weekly (day ${dow}) at ${hr.padStart(2, '0')}:${min.padStart(2, '0')}`;
  return 'custom schedule';
}

// ── Prefix tag editor ─────────────────────────────────────────────────────────

function PrefixEditor({
  prefixes,
  onChange,
}: {
  prefixes: string[];
  onChange: (p: string[]) => void;
}) {
  const [input, setInput] = useState('');

  function add() {
    const v = input.trim().toLowerCase();
    if (v && !prefixes.includes(v)) onChange([...prefixes, v]);
    setInput('');
  }

  function remove(p: string) {
    onChange(prefixes.filter(x => x !== p));
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6, alignItems: 'center' }}>
      {prefixes.map(p => (
        <button
          key={p}
          onClick={() => remove(p)}
          title="Click to remove"
          style={{
            fontFamily: MONO, fontSize: 11,
            background: 'var(--onyx-accent-dim)',
            border: '1px solid var(--onyx-accent-edge)',
            borderRadius: 6, padding: '4px 10px',
            color: 'var(--onyx-accent)',
            cursor: 'pointer',
          }}
        >
          {p} ✕
        </button>
      ))}
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') add(); }}
        placeholder="+ add"
        style={{
          fontFamily: MONO, fontSize: 11,
          background: 'var(--onyx-bg2)',
          color: 'var(--onyx-text)',
          border: '1px solid var(--onyx-glass-edge)',
          borderRadius: 6, padding: '4px 10px',
          width: 80,
        }}
      />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ServerSettingsSection({ st }: ServerSettingsSectionProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Local copy of settings — mutated optimistically on each toggle/change
  const [settings, setSettings] = useState<ServerSettings | null>(st.serverSettings);

  // Admin guard — non-admin users should never reach this section
  if (!st.isAdmin) return null;

  // Refresh settings from server on mount (in case another admin changed something)
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await getServerSettings(st.serverUrl);
      console.log('[ServerSettings] fetched:', s);
      setSettings(s);
      st.setServerSettings(s);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [st.serverUrl]);

  useEffect(() => { refresh(); }, [refresh]);

  // ── Per-field update helpers ──────────────────────────────────────────────

  async function patch(partial: Partial<ServerSettings>) {
    console.log('[ServerSettings] patch →', partial);
    try {
      const updated = await updateServerSettings(st.serverUrl, partial);
      console.log('[ServerSettings] patch ← OK:', updated);
      setSettings(updated);
      st.setServerSettings(updated);
      st.setToast({ message: 'Server setting saved.', type: 'success' });
    } catch (e) {
      console.error('[ServerSettings] patch failed:', e);
      st.setToast({ message: `Failed to save: ${e}`, type: 'error' });
    }
  }

  async function patchPrefixes(prefixes: string[]) {
    console.log('[ServerSettings] patchPrefixes →', prefixes);
    try {
      const updated = await updateSortingPrefixes(st.serverUrl, prefixes);
      console.log('[ServerSettings] patchPrefixes ← OK:', updated);
      setSettings(updated);
      st.setServerSettings(updated);
      st.setToast({ message: 'Sort prefixes updated. Re-index triggered on server.', type: 'success' });
    } catch (e) {
      console.error('[ServerSettings] patchPrefixes failed:', e);
      st.setToast({ message: `Failed to save: ${e}`, type: 'error' });
    }
  }

  if (loading && !settings) {
    return (
      <div>
        <SectionHead title="Server Settings" subtitle="Global Audiobookshelf server configuration." />
        <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', marginTop: 24 }}>
          Loading…
        </div>
      </div>
    );
  }

  if (error && !settings) {
    return (
      <div>
        <SectionHead title="Server Settings" subtitle="Global Audiobookshelf server configuration." />
        <div style={{
          fontFamily: MONO, fontSize: 11,
          color: 'var(--onyx-red, #c96442)',
          marginTop: 24,
          padding: '12px 16px',
          background: 'color-mix(in srgb, var(--onyx-red, #c96442) 10%, transparent)',
          borderRadius: 8,
          border: '1px solid color-mix(in srgb, var(--onyx-red, #c96442) 30%, transparent)',
        }}>
          Failed to load server settings: {error}
        </div>
      </div>
    );
  }

  const s = settings ?? {};
  const prefixes = s.sortingPrefixes ?? ['the', 'a'];

  const coverProviderOptions = COVER_PROVIDERS.map(p => ({ value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }));
  const logLevelOptions = LOG_LEVELS.map(l => ({ value: l.value, label: l.label }));

  return (
    <div>
      <SectionHead
        title="Server Settings"
        subtitle="Global Audiobookshelf server configuration. Admin only."
      />

      {/* ── Scanner ──────────────────────────────────────────────────────── */}
      <GroupHead label="Scanner" />

      <Row
        label="Find covers online"
        hint="Automatically download cover art from the selected provider during library scans."
      >
        <Toggle
          on={s.scannerFindCovers ?? false}
          onChange={v => {
            console.log('[ServerSettings] scannerFindCovers toggled →', v);
            setSettings(prev => ({ ...prev, scannerFindCovers: v }));
            patch({ scannerFindCovers: v });
          }}
        />
      </Row>

      <Row label="Cover provider" hint="Source used when downloading covers automatically.">
        <Dropdown
          value={s.scannerCoverProvider ?? 'google'}
          options={coverProviderOptions}
          onChange={v => {
            console.log('[ServerSettings] scannerCoverProvider changed →', v);
            setSettings(prev => ({ ...prev, scannerCoverProvider: v }));
            patch({ scannerCoverProvider: v });
          }}
        />
      </Row>

      <Row
        label="Parse subtitle from title"
        hint="Extract a subtitle when the filename contains a colon or dash separator."
      >
        <Toggle
          on={s.scannerParseSubtitle ?? false}
          onChange={v => {
            console.log('[ServerSettings] scannerParseSubtitle toggled →', v);
            setSettings(prev => ({ ...prev, scannerParseSubtitle: v }));
            patch({ scannerParseSubtitle: v });
          }}
        />
      </Row>

      <Row
        label="Prefer matched metadata"
        hint="During scans, use previously matched metadata rather than re-scanning file tags."
      >
        <Toggle
          on={s.scannerPreferMatchedMetadata ?? false}
          onChange={v => {
            console.log('[ServerSettings] scannerPreferMatchedMetadata toggled →', v);
            setSettings(prev => ({ ...prev, scannerPreferMatchedMetadata: v }));
            patch({ scannerPreferMatchedMetadata: v });
          }}
        />
      </Row>

      <Row
        label="Disable folder watcher"
        hint="Stop watching library folders for file system changes. Scans must be triggered manually."
      >
        <Toggle
          on={s.scannerDisableWatcher ?? false}
          onChange={v => {
            console.log('[ServerSettings] scannerDisableWatcher toggled →', v);
            setSettings(prev => ({ ...prev, scannerDisableWatcher: v }));
            patch({ scannerDisableWatcher: v });
          }}
        />
      </Row>

      {/* ── Metadata storage ─────────────────────────────────────────────── */}
      <GroupHead label="Metadata Storage" />

      <Row
        label="Store cover with item"
        hint="Save the cover image file inside each item's folder on the server disk."
      >
        <Toggle
          on={s.storeCoverWithItem ?? false}
          onChange={v => {
            console.log('[ServerSettings] storeCoverWithItem toggled →', v);
            setSettings(prev => ({ ...prev, storeCoverWithItem: v }));
            patch({ storeCoverWithItem: v });
          }}
        />
      </Row>

      <Row
        label="Store metadata with item"
        hint="Save a metadata.json file inside each item's folder on the server disk."
      >
        <Toggle
          on={s.storeMetadataWithItem ?? false}
          onChange={v => {
            console.log('[ServerSettings] storeMetadataWithItem toggled →', v);
            setSettings(prev => ({ ...prev, storeMetadataWithItem: v }));
            patch({ storeMetadataWithItem: v });
          }}
        />
      </Row>

      {/* ── Sorting ──────────────────────────────────────────────────────── */}
      <GroupHead label="Sorting" />

      <Row
        label="Ignore sort prefixes"
        hint='Sort "The Name of the Wind" under N, not T.'
      >
        <Toggle
          on={s.sortingIgnorePrefix ?? false}
          onChange={v => {
            console.log('[ServerSettings] sortingIgnorePrefix toggled →', v);
            setSettings(prev => ({ ...prev, sortingIgnorePrefix: v }));
            patch({ sortingIgnorePrefix: v });
          }}
        />
      </Row>

      <Row
        label="Prefixes"
        hint="Click a prefix to remove it. Press Enter to add. Triggers a full title re-index."
        align="top"
      >
        <PrefixEditor
          prefixes={prefixes}
          onChange={newPrefixes => {
            console.log('[ServerSettings] sortingPrefixes changed →', newPrefixes);
            setSettings(prev => ({ ...prev, sortingPrefixes: newPrefixes }));
            patchPrefixes(newPrefixes);
          }}
        />
      </Row>

      {/* ── Podcasts ─────────────────────────────────────────────────────── */}
      <GroupHead label="Podcasts" />

      <Row
        label="Episode check schedule"
        hint="Cron expression controlling how often new episodes are checked. Default: every hour."
        align="top"
      >
        <CronInput
          value={s.podcastEpisodeSchedule ?? '0 * * * *'}
          onChange={v => {
            console.log('[ServerSettings] podcastEpisodeSchedule changed →', v);
            setSettings(prev => ({ ...prev, podcastEpisodeSchedule: v }));
            patch({ podcastEpisodeSchedule: v });
          }}
        />
      </Row>

      {/* ── Playback ─────────────────────────────────────────────────────── */}
      <GroupHead label="Playback" />

      <Row
        label="Chromecast support"
        hint="Enable casting to Chromecast devices via the web client."
      >
        <Toggle
          on={s.chromecastEnabled ?? false}
          onChange={v => {
            console.log('[ServerSettings] chromecastEnabled toggled →', v);
            setSettings(prev => ({ ...prev, chromecastEnabled: v }));
            patch({ chromecastEnabled: v });
          }}
        />
      </Row>

      {/* ── Logging ──────────────────────────────────────────────────────── */}
      <GroupHead label="Logging" />

      <Row label="Log level" hint="Controls verbosity of the server log files.">
        <Dropdown
          value={s.logLevel ?? 1}
          options={logLevelOptions}
          onChange={v => {
            console.log('[ServerSettings] logLevel changed →', v);
            setSettings(prev => ({ ...prev, logLevel: v }));
            patch({ logLevel: v });
          }}
        />
      </Row>

      <Row label="Daily logs to keep" hint="Number of days of server logs retained on disk.">
        <NumInput
          value={s.loggerDailyLogsToKeep ?? 7}
          min={1}
          max={90}
          suffix="days"
          onChange={v => {
            console.log('[ServerSettings] loggerDailyLogsToKeep changed →', v);
            setSettings(prev => ({ ...prev, loggerDailyLogsToKeep: v }));
            patch({ loggerDailyLogsToKeep: v });
          }}
        />
      </Row>

      <Row label="Scanner logs to keep">
        <NumInput
          value={s.loggerScannerLogsToKeep ?? 2}
          min={1}
          max={30}
          onChange={v => {
            console.log('[ServerSettings] loggerScannerLogsToKeep changed →', v);
            setSettings(prev => ({ ...prev, loggerScannerLogsToKeep: v }));
            patch({ loggerScannerLogsToKeep: v });
          }}
        />
      </Row>
    </div>
  );
}
