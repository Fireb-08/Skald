import { useState, useEffect } from 'react';
import type { OnyxState, ServerSettings } from '../../state/onyx';
import { SectionHead, Row, Toggle, MONO, SERIF, Panel } from './shared';
import {
  updateServerSettings,
  updateSortingPrefixes,
  COVER_PROVIDERS,
  LOG_LEVELS,
} from '../../api/abs';
import CronEditor from './CronEditor';

export interface ServerSettingsSectionProps {
  st: OnyxState;
  /** When true, render as a sub-section under the Server panel (a lighter
   *  divider heading) instead of a standalone panel with its own SectionHead. */
  embedded?: boolean;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

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
        background: 'var(--onyx-panel2)',
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
          background: 'var(--onyx-panel2)',
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
          background: 'var(--onyx-panel2)',
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

export default function ServerSettingsSection({ st, embedded = false }: ServerSettingsSectionProps) {
  // Hook-free admin guard wrapper — see BackupSection for the rationale
  // (an early return between hooks crashes React if isAdmin flips).
  if (!st.isAdmin) return null;
  return <ServerSettingsSectionInner st={st} embedded={embedded} />;
}

function ServerSettingsSectionInner({ st, embedded = false }: ServerSettingsSectionProps) {
  // Local copy of settings — mutated optimistically on each toggle/change.
  // Seeded from st.serverSettings, which is captured at login and refreshed on
  // every app launch via POST /api/authorize (ABS has no standalone GET endpoint
  // for server settings — they only ride along with the login/authorize payload).
  const [settings, setSettings] = useState<ServerSettings | null>(st.serverSettings);

  // Heading: a standalone SectionHead when used as its own panel, or a lighter
  // divider sub-heading when embedded under the Server panel.
  const head = embedded ? (
    <div style={{ marginTop: 32, paddingTop: 24, borderTop: '1px solid var(--onyx-line)', marginBottom: 8 }}>
      <div style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 500 }}>Server administration</div>
      <div style={{ marginTop: 4, fontSize: 12.5, color: 'var(--onyx-text-dim)' }}>
        Global Audiobookshelf server configuration. Admin only.
      </div>
    </div>
  ) : (
    <SectionHead title="Server Settings" subtitle="Global Audiobookshelf server configuration. Admin only." />
  );

  // Keep local state in sync if the parent state is updated externally
  // (e.g. a successful PATCH updates st.serverSettings via setServerSettings).
  useEffect(() => {
    if (st.serverSettings) setSettings(st.serverSettings);
  }, [st.serverSettings]);

  // ── Per-field update helpers ──────────────────────────────────────────────

  async function patch(partial: Partial<ServerSettings>) {
    try {
      const updated = await updateServerSettings(st.serverUrl, partial);
      setSettings(updated);
      st.setServerSettings(updated);
      st.setToast({ message: 'Server setting saved.', type: 'success' });
    } catch (e) {
      st.setToast({ message: `Failed to save: ${e}`, type: 'error' });
    }
  }

  async function patchPrefixes(prefixes: string[]) {
    try {
      const updated = await updateSortingPrefixes(st.serverUrl, prefixes);
      setSettings(updated);
      st.setServerSettings(updated);
      st.setToast({ message: 'Sort prefixes updated. Re-index triggered on server.', type: 'success' });
    } catch (e) {
      st.setToast({ message: `Failed to save: ${e}`, type: 'error' });
    }
  }

  // Settings come from the login payload — if null here it means the user
  // logged in before this feature was added. A fresh sign-in will populate them.
  if (!settings) {
    return (
      <div>
        {head}
        <div style={{
          fontFamily: MONO, fontSize: 11,
          color: 'var(--onyx-text-mute)',
          marginTop: 24,
          padding: '12px 16px',
          background: 'var(--onyx-glass)',
          borderRadius: 8,
          border: '1px solid var(--onyx-glass-edge)',
        }}>
          Loading server settings… If this persists, check your server connection and try reopening this panel.
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
      {head}

      {/* ── Scanner ──────────────────────────────────────────────────────── */}
      <Panel label="Scanner">

      <Row
        label="Find covers online"
        hint="Automatically download cover art from the selected provider during library scans."
      >
        <Toggle
          on={s.scannerFindCovers ?? false}
          onChange={v => {
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
            setSettings(prev => ({ ...prev, scannerDisableWatcher: v }));
            patch({ scannerDisableWatcher: v });
          }}
        />
      </Row>

      </Panel>

      {/* ── Metadata storage ─────────────────────────────────────────────── */}
      <Panel label="Metadata storage">

      <Row
        label="Store cover with item"
        hint="Save the cover image file inside each item's folder on the server disk."
      >
        <Toggle
          on={s.storeCoverWithItem ?? false}
          onChange={v => {
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
            setSettings(prev => ({ ...prev, storeMetadataWithItem: v }));
            patch({ storeMetadataWithItem: v });
          }}
        />
      </Row>

      </Panel>

      {/* ── Sorting ──────────────────────────────────────────────────────── */}
      <Panel label="Sorting">

      <Row
        label="Ignore sort prefixes"
        hint='Sort "The Great Gatsby" under G, not T.'
      >
        <Toggle
          on={s.sortingIgnorePrefix ?? false}
          onChange={v => {
            setSettings(prev => ({ ...prev, sortingIgnorePrefix: v }));
            patch({ sortingIgnorePrefix: v });
          }}
        />
      </Row>

      {/* Prefix list is only relevant when prefix-ignoring is on — hide it
          otherwise to avoid implying it has any effect. */}
      {(s.sortingIgnorePrefix ?? false) && (
        <Row
          label="Prefixes"
          hint="Click a prefix to remove it. Press Enter to add. Triggers a full title re-index."
          align="top"
        >
          <PrefixEditor
            prefixes={prefixes}
            onChange={newPrefixes => {
              setSettings(prev => ({ ...prev, sortingPrefixes: newPrefixes }));
              patchPrefixes(newPrefixes);
            }}
          />
        </Row>
      )}

      </Panel>

      {/* ── Podcasts ─────────────────────────────────────────────────────── */}
      <Panel label="Podcasts">

      <Row
        label="Episode check schedule"
        hint="How often new podcast episodes are checked. Default: every hour."
        align="top"
      >
        <CronEditor
          value={s.podcastEpisodeSchedule ?? '0 * * * *'}
          onChange={v => {
            setSettings(prev => ({ ...prev, podcastEpisodeSchedule: v }));
            patch({ podcastEpisodeSchedule: v });
          }}
        />
      </Row>

      </Panel>

      {/* ── Logging ──────────────────────────────────────────────────────── */}
      <Panel label="Logging">

      <Row label="Log level" hint="Controls verbosity of the server log files.">
        <Dropdown
          value={s.logLevel ?? 1}
          options={logLevelOptions}
          onChange={v => {
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
            setSettings(prev => ({ ...prev, loggerScannerLogsToKeep: v }));
            patch({ loggerScannerLogsToKeep: v });
          }}
        />
      </Row>
      </Panel>
    </div>
  );
}
