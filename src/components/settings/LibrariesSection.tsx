// LibrariesSection — admin-only UI for managing Audiobookshelf libraries.
// Lets admin users create, edit, delete, and scan libraries without opening
// the ABS web interface. Hidden entirely for non-admin accounts (Phase 7
// adds the nav-level guard; this component returns null as a safety net).

import { useState, useEffect, useRef, type ReactNode } from 'react';
import { SectionHead, Row, Toggle, MONO, SERIF, Panel } from './shared';
import type { OnyxState } from '../../state/onyx';
import { clearReviewCache } from '../../api/reviewCache';
import {
  getLibrariesFull,
  createLibrary as apiCreateLibrary,
  updateLibrary as apiUpdateLibrary,
  deleteLibrary as apiDeleteLibrary,
  scanLibrary as apiScanLibrary,
  browseServerFilesystem,
  getCustomMetadataProviders,
  createCustomMetadataProvider,
  deleteCustomMetadataProvider,
  LIBRARY_ICONS,
  LIBRARY_PROVIDERS_BOOK,
  LIBRARY_PROVIDERS_PODCAST,
} from '../../api/abs';
import type { Library, LibrarySettings, UpdateLibraryPayload, FsEntry, CustomMetadataProvider } from '../../api/abs';

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(ms: number | null): string {
  if (ms === null) return 'Never';
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const ICON_EMOJI: Record<string, string> = {
  database: '🗄️', book: '📖', audiobook: '📚', podcast: '🎙️',
  music: '🎵', comic: '💬', manga: '🀄', paper: '📄',
  magazine: '📰', pirate: '☠️', 'crystal-ball': '🔮', alien: '👽',
  astronaut: '🧑‍🚀', cat: '🐱', dog: '🐶', heart: '❤️', star: '⭐', moon: '🌙',
};
function iconEmoji(slug: string | null | undefined): string {
  return (slug && ICON_EMOJI[slug]) ?? '📚';
}

// ── Form types ────────────────────────────────────────────────────────────────

interface FormState {
  name: string;
  mediaType: 'book' | 'podcast';
  icon: string;
  provider: string;
  folders: string[];
  watcherEnabled: boolean;
  audiobooksOnly: boolean;
  hideSingleBookSeries: boolean;
  autoScanCron: string;
  markFinishedPercent: string;
  markFinishedRemaining: string;
}

const DEFAULT_FORM: FormState = {
  name: '',
  mediaType: 'book',
  icon: 'database',
  provider: 'google',
  folders: [''],
  watcherEnabled: true,
  audiobooksOnly: false,
  hideSingleBookSeries: false,
  autoScanCron: '',
  markFinishedPercent: '100',
  markFinishedRemaining: '10',
};

function libraryToForm(lib: Library): FormState {
  const s = lib.settings;
  return {
    name: lib.name,
    mediaType: lib.mediaType === 'podcast' ? 'podcast' : 'book',
    icon: lib.icon ?? 'database',
    provider: lib.provider ?? (lib.mediaType === 'podcast' ? 'itunes' : 'google'),
    folders: lib.folders.length ? lib.folders.map(f => f.fullPath) : [''],
    watcherEnabled: s?.disableWatcher !== true,
    audiobooksOnly: s?.audiobooksOnly ?? false,
    hideSingleBookSeries: s?.hideSingleBookSeries ?? false,
    autoScanCron: s?.autoScanCronExpression ?? '',
    markFinishedPercent: String(s?.markAsFinishedPercentComplete ?? 100),
    markFinishedRemaining: String(s?.markAsFinishedTimeRemaining ?? 10),
  };
}

function formToSettings(form: FormState): LibrarySettings {
  return {
    coverAspectRatio: null,
    disableWatcher: !form.watcherEnabled,
    autoScanCronExpression: form.autoScanCron.trim() || null,
    audiobooksOnly: form.audiobooksOnly,
    hideSingleBookSeries: form.hideSingleBookSeries,
    onlyShowLaterBooksInContinueSeries: null,
    skipMatchingMediaWithAsin: null,
    skipMatchingMediaWithIsbn: null,
    metadataPrecedence: null,
    markAsFinishedPercentComplete: parseFloat(form.markFinishedPercent) || null,
    markAsFinishedTimeRemaining: parseFloat(form.markFinishedRemaining) || null,
    podcastSearchRegion: null,
    epubsAllowScriptedContent: null,
  };
}

// ── Small shared sub-components ───────────────────────────────────────────────

function SmallBtn({
  onClick,
  danger = false,
  muted = false,
  disabled = false,
  title,
  children,
}: {
  onClick?: () => void;
  danger?: boolean;
  muted?: boolean;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}) {
  const col = danger ? '#e8716a' : muted ? 'var(--onyx-text-dim)' : 'var(--onyx-accent)';
  const bdr = danger
    ? 'rgba(232,113,106,0.35)'
    : muted
    ? 'var(--onyx-glass-edge)'
    : 'rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.3)';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        padding: '5px 12px',
        background: 'transparent',
        border: `1px solid ${bdr}`,
        borderRadius: 6,
        color: col,
        fontFamily: MONO,
        fontSize: 10.5,
        letterSpacing: '0.07em',
        textTransform: 'uppercase',
        cursor: disabled ? 'wait' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}

function Field({
  value,
  onChange,
  placeholder,
  mono = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      spellCheck={false}
      style={{
        flex: 1,
        width: '100%',
        boxSizing: 'border-box',
        padding: '7px 10px',
        background: 'rgba(0,0,0,0.28)',
        border: '1px solid var(--onyx-glass-edge)',
        borderRadius: 6,
        color: 'var(--onyx-text)',
        fontSize: 12.5,
        fontFamily: mono ? MONO : 'inherit',
        outline: 'none',
      }}
    />
  );
}

function OnOff({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  const pill = (label: string, active: boolean, val: boolean) => (
    <button
      key={label}
      onClick={() => onChange(val)}
      style={{
        padding: '4px 10px', borderRadius: 4,
        background: active ? 'var(--onyx-accent-dim)' : 'transparent',
        border: `1px solid ${active ? 'var(--onyx-accent-edge)' : 'rgba(255,255,255,0.08)'}`,
        color: active ? 'var(--onyx-accent)' : 'var(--onyx-text-mute)',
        fontFamily: MONO, fontSize: 10, letterSpacing: '0.07em',
        cursor: 'pointer', fontWeight: active ? 600 : 400,
      }}
    >{label}</button>
  );
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {pill('On', on, true)}
      {pill('Off', !on, false)}
    </div>
  );
}

function SelectInput({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        padding: '7px 10px',
        background: 'rgba(0,0,0,0.28)',
        border: '1px solid var(--onyx-glass-edge)',
        borderRadius: 6,
        color: 'var(--onyx-text)',
        fontSize: 12.5,
        fontFamily: 'inherit',
        outline: 'none',
        cursor: 'pointer',
        minWidth: 180,
      }}
    >
      {options.map(o => (
        <option key={o.value} value={o.value} style={{ background: '#1a1a1f' }}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ── Server folder picker modal ────────────────────────────────────────────────

interface ServerFolderPickerProps {
  serverUrl: string;
  initial: string;          // pre-navigate to this path if non-empty, else "/"
  onSelect: (path: string) => void;
  onCancel: () => void;
}

function ServerFolderPicker({ serverUrl, initial, onSelect, onCancel }: ServerFolderPickerProps) {
  const startPath = initial.trim() || '/';
  const [currentPath, setCurrentPath] = useState(startPath);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Fetch whenever the path changes.
  useEffect(() => { void navigate(currentPath); }, [currentPath]); // eslint-disable-line react-hooks/exhaustive-deps

  async function navigate(path: string) {
    setLoading(true);
    setError('');
    try {
      const result = await browseServerFilesystem(serverUrl, path);
      // ABS response has no top-level path field — keep the path we requested.
      setCurrentPath(path);
      setEntries(result.directories.slice().sort((a, b) => a.dirname.localeCompare(b.dirname)));
    } catch (e) {
      setError(typeof e === 'string' ? e : (e as Error)?.message ?? 'Failed to read directory.');
    } finally {
      setLoading(false);
    }
  }

  // Split current path into breadcrumb segments for navigation.
  function breadcrumbs(): { label: string; path: string }[] {
    const parts = currentPath.replace(/\\/g, '/').split('/').filter(Boolean);
    const crumbs = [{ label: '/', path: '/' }];
    let accumulated = '';
    for (const part of parts) {
      accumulated += '/' + part;
      crumbs.push({ label: part, path: accumulated });
    }
    return crumbs;
  }

  // Parent path: strip the last segment.
  function parentPath(): string {
    const norm = currentPath.replace(/\\/g, '/').replace(/\/$/, '');
    const idx = norm.lastIndexOf('/');
    return idx <= 0 ? '/' : norm.slice(0, idx);
  }

  const crumbs = breadcrumbs();
  const canGoUp = currentPath !== '/' && currentPath !== '';

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 600,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.7)',
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{
        width: 540, maxWidth: '92vw', maxHeight: '78vh',
        display: 'flex', flexDirection: 'column',
        background: 'var(--onyx-panel2)',
        backdropFilter: 'blur(40px) saturate(120%)',
        WebkitBackdropFilter: 'blur(40px) saturate(120%)',
        border: '1px solid var(--onyx-glass-edge)',
        borderRadius: 12,
        boxShadow: '0 24px 60px rgba(0,0,0,0.65)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px 12px',
          borderBottom: '1px solid var(--onyx-line)',
          flexShrink: 0,
        }}>
          <div style={{ fontFamily: SERIF, fontSize: 16, fontWeight: 500, marginBottom: 10 }}>
            Select Server Folder
          </div>

          {/* Breadcrumb strip */}
          <div style={{
            display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '2px 0',
            fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.03em',
            background: 'rgba(0,0,0,0.25)', borderRadius: 6,
            padding: '6px 10px', minHeight: 30,
          }}>
            {crumbs.map((crumb, i) => (
              <span key={crumb.path} style={{ display: 'flex', alignItems: 'center' }}>
                {i > 0 && <span style={{ color: 'var(--onyx-text-mute)', margin: '0 2px' }}>/</span>}
                <button
                  onClick={() => setCurrentPath(crumb.path)}
                  style={{
                    background: 'none', border: 'none', padding: '1px 3px',
                    borderRadius: 3, cursor: 'pointer', fontFamily: MONO, fontSize: 10.5,
                    color: i === crumbs.length - 1 ? 'var(--onyx-text)' : 'var(--onyx-accent)',
                    fontWeight: i === crumbs.length - 1 ? 500 : 400,
                  }}
                >
                  {crumb.label}
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* Directory list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }}>
          {loading && (
            <div style={{ padding: '20px 12px', fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em' }}>
              Loading…
            </div>
          )}

          {!loading && error && (
            <div style={{ padding: '12px', fontFamily: MONO, fontSize: 11, color: '#e8716a' }}>
              {error}
            </div>
          )}

          {!loading && !error && (
            <>
              {/* Up / parent row */}
              {canGoUp && (
                <button
                  onClick={() => setCurrentPath(parentPath())}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    width: '100%', padding: '8px 12px', borderRadius: 6,
                    background: 'transparent', border: 'none',
                    color: 'var(--onyx-text-dim)', fontFamily: MONO, fontSize: 12,
                    cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: 14 }}>↑</span>
                  <span style={{ letterSpacing: '0.02em' }}>..</span>
                </button>
              )}

              {entries.length === 0 && (
                <div style={{ padding: '12px', fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', letterSpacing: '0.05em' }}>
                  No subdirectories
                </div>
              )}

              {entries.map(entry => (
                <button
                  key={entry.path}
                  onClick={() => setCurrentPath(entry.path)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    width: '100%', padding: '8px 12px', borderRadius: 6,
                    background: 'transparent', border: 'none',
                    color: 'var(--onyx-text)', fontFamily: 'inherit', fontSize: 13,
                    cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: 14, flexShrink: 0 }}>📁</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {entry.dirname}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>

        {/* Footer: current selection + action buttons */}
        <div style={{
          padding: '12px 20px',
          borderTop: '1px solid var(--onyx-line)',
          flexShrink: 0,
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{
            fontFamily: MONO, fontSize: 10.5, color: 'var(--onyx-text-mute)',
            letterSpacing: '0.03em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {currentPath}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <SmallBtn muted onClick={onCancel}>Cancel</SmallBtn>
            <SmallBtn onClick={() => onSelect(currentPath)} disabled={loading}>
              Select This Folder
            </SmallBtn>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Library edit / create form ────────────────────────────────────────────────

interface LibraryFormProps {
  initial: FormState;
  lockMediaType?: boolean;
  onSubmit: (form: FormState) => Promise<void>;
  onCancel: () => void;
  submitLabel: string;
  serverUrl: string;
  customProviders: CustomMetadataProvider[];
}

function LibraryForm({ initial, lockMediaType = false, onSubmit, onCancel, submitLabel, serverUrl, customProviders }: LibraryFormProps) {
  const [form, setForm] = useState<FormState>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Index of the folder row currently being browsed (null = picker closed).
  const [pickerFor, setPickerFor] = useState<number | null>(null);

  function setMediaType(mt: 'book' | 'podcast') {
    setForm(f => ({
      ...f,
      mediaType: mt,
      provider: mt === 'podcast' ? LIBRARY_PROVIDERS_PODCAST[0] : LIBRARY_PROVIDERS_BOOK[0],
    }));
  }

  function updateFolder(i: number, v: string) {
    setForm(f => { const folders = [...f.folders]; folders[i] = v; return { ...f, folders }; });
  }

  function addFolder() {
    setForm(f => ({ ...f, folders: [...f.folders, ''] }));
  }

  function removeFolder(i: number) {
    setForm(f => {
      const folders = f.folders.filter((_, idx) => idx !== i);
      return { ...f, folders: folders.length ? folders : [''] };
    });
  }

  function browseFolder(i: number) {
    setPickerFor(i);
  }

  async function handleSubmit() {
    if (!form.name.trim()) return setError('Name is required.');
    const validFolders = form.folders.filter(p => p.trim());
    if (!validFolders.length) return setError('At least one folder path is required.');
    setError('');
    setSaving(true);
    try {
      await onSubmit({ ...form, folders: validFolders });
    } catch (e) {
      setError(typeof e === 'string' ? e : (e as Error)?.message ?? 'An error occurred.');
      setSaving(false);
    }
  }

  const providers = [
    ...(form.mediaType === 'podcast' ? LIBRARY_PROVIDERS_PODCAST : LIBRARY_PROVIDERS_BOOK).map(v => ({ value: v, label: v })),
    // Append registered custom providers for this media type (slug = custom-{id}).
    ...customProviders.filter(p => p.mediaType === form.mediaType).map(p => ({ value: p.slug, label: `${p.name} (custom)` })),
  ];

  const iconOptions = LIBRARY_ICONS.map(v => ({ value: v, label: `${iconEmoji(v)}  ${v}` }));

  // Label + content row reused throughout the form.
  const fRow = (label: string, content: ReactNode) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16, padding: '8px 0',
      borderBottom: '1px solid rgba(255,255,255,0.04)',
    }}>
      <div style={{
        width: 140, flexShrink: 0, fontFamily: MONO, fontSize: 10,
        color: 'var(--onyx-text-mute)', letterSpacing: '0.08em', textTransform: 'uppercase',
      }}>
        {label}
      </div>
      <div style={{ flex: 1 }}>{content}</div>
    </div>
  );

  return (
    <div style={{ padding: '18px 20px', background: 'rgba(0,0,0,0.18)' }}>

      {fRow('Name', (
        <Field value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="Library name" />
      ))}

      {!lockMediaType && fRow('Media type', (
        <div style={{ display: 'flex', gap: 6 }}>
          {(['book', 'podcast'] as const).map(mt => (
            <button
              key={mt}
              onClick={() => setMediaType(mt)}
              style={{
                padding: '5px 14px', borderRadius: 6,
                background: form.mediaType === mt ? 'var(--onyx-accent-dim)' : 'transparent',
                border: `1px solid ${form.mediaType === mt ? 'var(--onyx-accent-edge)' : 'rgba(255,255,255,0.08)'}`,
                color: form.mediaType === mt ? 'var(--onyx-accent)' : 'var(--onyx-text-mute)',
                fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.06em',
                cursor: 'pointer', fontWeight: form.mediaType === mt ? 600 : 400,
              }}
            >{mt}</button>
          ))}
        </div>
      ))}

      {fRow('Icon', (
        <SelectInput value={form.icon} onChange={v => setForm(f => ({ ...f, icon: v }))} options={iconOptions} />
      ))}

      {fRow('Provider', (
        <SelectInput value={form.provider} onChange={v => setForm(f => ({ ...f, provider: v }))} options={providers} />
      ))}

      {/* Folder list */}
      <div style={{ padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <div style={{
            flex: 1, fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)',
            letterSpacing: '0.08em', textTransform: 'uppercase',
          }}>
            Folders
          </div>
          <button
            onClick={addFolder}
            style={{
              fontFamily: MONO, fontSize: 10, color: 'var(--onyx-accent)',
              background: 'transparent', border: 'none', cursor: 'pointer', letterSpacing: '0.06em',
            }}
          >
            + Add Folder
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {form.folders.map((fp, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <Field value={fp} onChange={v => updateFolder(i, v)} placeholder="/path/to/folder" mono />
              <button
                onClick={() => browseFolder(i)}
                title="Browse server filesystem"
                style={{
                  flexShrink: 0, padding: '7px 10px',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid var(--onyx-glass-edge)',
                  borderRadius: 6, color: 'var(--onyx-text-dim)',
                  fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.06em',
                  cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >
                Browse…
              </button>
              {form.folders.length > 1 && (
                <button
                  onClick={() => removeFolder(i)}
                  title="Remove folder"
                  style={{
                    width: 28, height: 28, flexShrink: 0, background: 'transparent',
                    border: 'none', color: 'var(--onyx-text-mute)', cursor: 'pointer',
                    fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Settings sub-section */}
      <div style={{
        marginTop: 14, marginBottom: 4, fontFamily: MONO, fontSize: 9,
        color: 'var(--onyx-text-mute)', letterSpacing: '0.12em', textTransform: 'uppercase',
      }}>
        Settings
      </div>

      {fRow('File watcher', (
        <OnOff on={form.watcherEnabled} onChange={v => setForm(f => ({ ...f, watcherEnabled: v }))} />
      ))}

      {form.mediaType === 'book' && fRow('Audiobooks only', (
        <OnOff on={form.audiobooksOnly} onChange={v => setForm(f => ({ ...f, audiobooksOnly: v }))} />
      ))}

      {form.mediaType === 'book' && fRow('Hide 1-book series', (
        <OnOff on={form.hideSingleBookSeries} onChange={v => setForm(f => ({ ...f, hideSingleBookSeries: v }))} />
      ))}

      {fRow('Auto-scan cron', (
        <Field
          value={form.autoScanCron}
          onChange={v => setForm(f => ({ ...f, autoScanCron: v }))}
          placeholder="0 2 * * *  (leave blank to disable)"
          mono
        />
      ))}

      {fRow('Mark finished at', (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            value={form.markFinishedPercent}
            onChange={e => setForm(f => ({ ...f, markFinishedPercent: e.target.value }))}
            style={{
              width: 50, padding: '7px 8px', background: 'rgba(0,0,0,0.28)',
              border: '1px solid var(--onyx-glass-edge)', borderRadius: 6,
              color: 'var(--onyx-text)', fontSize: 12, fontFamily: MONO,
              outline: 'none', textAlign: 'center',
            }}
          />
          <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-dim)' }}>% complete  or</span>
          <input
            value={form.markFinishedRemaining}
            onChange={e => setForm(f => ({ ...f, markFinishedRemaining: e.target.value }))}
            style={{
              width: 50, padding: '7px 8px', background: 'rgba(0,0,0,0.28)',
              border: '1px solid var(--onyx-glass-edge)', borderRadius: 6,
              color: 'var(--onyx-text)', fontSize: 12, fontFamily: MONO,
              outline: 'none', textAlign: 'center',
            }}
          />
          <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-dim)' }}>s remaining</span>
        </div>
      ))}

      {error && (
        <div style={{ marginTop: 10, fontFamily: MONO, fontSize: 11, color: '#e8716a' }}>{error}</div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <SmallBtn muted onClick={onCancel}>Cancel</SmallBtn>
        <SmallBtn onClick={handleSubmit} disabled={saving}>
          {saving ? 'Saving…' : submitLabel}
        </SmallBtn>
      </div>

      {pickerFor !== null && (
        <ServerFolderPicker
          serverUrl={serverUrl}
          initial={form.folders[pickerFor] ?? ''}
          onSelect={path => { updateFolder(pickerFor, path); setPickerFor(null); }}
          onCancel={() => setPickerFor(null)}
        />
      )}
    </div>
  );
}

// ── Custom metadata providers manager ─────────────────────────────────────────

function CustomProvidersManager({ providers, onAdd, onDelete }: {
  providers: CustomMetadataProvider[];
  onAdd: (p: { name: string; url: string; mediaType: string; authHeaderValue?: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [auth, setAuth] = useState('');
  const [mediaType, setMediaType] = useState<'book' | 'podcast'>('book');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function add() {
    if (!name.trim() || !url.trim()) { setErr('Name and URL are required.'); return; }
    setErr(''); setBusy(true);
    try {
      await onAdd({ name: name.trim(), url: url.trim(), mediaType, authHeaderValue: auth.trim() || undefined });
      setName(''); setUrl(''); setAuth('');
    } catch (e) {
      setErr(typeof e === 'string' ? e : (e as Error)?.message ?? 'Failed to add provider.');
    } finally { setBusy(false); }
  }

  return (
    <Panel label="Custom metadata providers">
      <div style={{ fontSize: 12, color: 'var(--onyx-text-dim)', margin: '10px 2px', lineHeight: 1.5 }}>
        Register a community or self-hosted provider; it then appears in the Provider dropdown above and in the Match dialog.
      </div>

      {providers.length === 0 && (
        <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', padding: '4px 0 10px' }}>None registered.</div>
      )}
      {providers.map(p => (
        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--onyx-line)' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</div>
            <div style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--onyx-text-mute)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {p.mediaType} · {p.url}
            </div>
          </div>
          <SmallBtn danger onClick={() => void onDelete(p.id)}>Delete</SmallBtn>
        </div>
      ))}

      {/* Add form */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Field value={name} onChange={setName} placeholder="Provider name" />
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {(['book', 'podcast'] as const).map(mt => (
              <button key={mt} onClick={() => setMediaType(mt)} style={{
                padding: '5px 12px', borderRadius: 6,
                background: mediaType === mt ? 'var(--onyx-accent-dim)' : 'transparent',
                border: `1px solid ${mediaType === mt ? 'var(--onyx-accent-edge)' : 'rgba(255,255,255,0.08)'}`,
                color: mediaType === mt ? 'var(--onyx-accent)' : 'var(--onyx-text-mute)',
                fontFamily: MONO, fontSize: 10.5, cursor: 'pointer',
              }}>{mt}</button>
            ))}
          </div>
        </div>
        <Field value={url} onChange={setUrl} placeholder="https://provider.example/search" mono />
        <Field value={auth} onChange={setAuth} placeholder="Authorization header value (optional)" mono />
        {err && <div style={{ fontFamily: MONO, fontSize: 11, color: '#e8716a' }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <SmallBtn onClick={add} disabled={busy}>{busy ? 'Adding…' : '+ Add Provider'}</SmallBtn>
        </div>
      </div>
    </Panel>
  );
}

// ── Open Library integration ──────────────────────────────────────────────────
// Moved here from the former standalone Integrations tab — it enriches the player
// with Open Library community ratings, so it lives alongside library settings. The
// review-cache reset is part of the same integration (it clears Open Library data).
function OpenLibraryManager({ st }: { st: OnyxState }) {
  const [cacheCleared, setCacheCleared] = useState(false);
  return (
    <Panel label="Open Library">
      <div style={{ fontSize: 12, color: 'var(--onyx-text-dim)', margin: '10px 2px 2px', lineHeight: 1.5 }}>
        Enrich the player with community ratings and shelf data from Open Library.
      </div>

      <Row label="Open Library" hint="Community ratings and shelf data.">
        <Toggle on={st.enableOpenLibrary} onChange={st.setEnableOpenLibrary} />
      </Row>

      <Row label="Review cache" hint="Force a fresh fetch of all ratings data on next visit to the Player screen.">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {cacheCleared && (
            <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em' }}>
              Cache cleared
            </span>
          )}
          <button
            onClick={() => {
              clearReviewCache();
              setCacheCleared(true);
              setTimeout(() => setCacheCleared(false), 2000);
            }}
            style={{
              padding: '7px 14px', borderRadius: 6, cursor: 'pointer',
              background: 'transparent', border: '1px solid var(--onyx-glass-edge)',
              color: 'var(--onyx-text-dim)', fontFamily: MONO, fontSize: 10,
              letterSpacing: '0.06em', textTransform: 'uppercase' as const,
            }}
          >
            Clear review cache
          </button>
        </div>
      </Row>
    </Panel>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface LibrariesSectionProps {
  st: OnyxState;
  // Hides the SectionHead so the section can be hosted inside another pane
  // (LibraryManagementSection's combined "Libraries" view).
  embedded?: boolean;
}

export default function LibrariesSection({ st, embedded = false }: LibrariesSectionProps) {
  const isAdmin = st.isAdmin;

  const [libraries, setLibraries] = useState<Library[]>([]);
  const [customProviders, setCustomProviders] = useState<CustomMetadataProvider[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [editTarget, setEditTarget] = useState<string | null>(null);   // library id
  const [createMode, setCreateMode] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Library | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [scanPending, setScanPending] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (st.serverUrl) void load();
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isAdmin) return null;

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }

  async function load() {
    setLoading(true);
    setListError('');
    try {
      setLibraries(await getLibrariesFull(st.serverUrl));
      // Custom providers are best-effort — older ABS versions lack the endpoint.
      getCustomMetadataProviders(st.serverUrl).then(setCustomProviders).catch(() => setCustomProviders([]));
    } catch (e) {
      setListError(typeof e === 'string' ? e : (e as Error)?.message ?? 'Failed to load libraries.');
    } finally {
      setLoading(false);
    }
  }

  async function handleScan(lib: Library) {
    setScanPending(prev => new Set([...prev, lib.id]));
    try {
      await apiScanLibrary(st.serverUrl, lib.id, false);
      showToast(`Scan started for "${lib.name}"`);
    } catch (e) {
      showToast(`Scan failed: ${typeof e === 'string' ? e : (e as Error)?.message ?? 'error'}`);
    } finally {
      setScanPending(prev => { const s = new Set(prev); s.delete(lib.id); return s; });
    }
  }

  async function handleCreate(form: FormState) {
    const folders = form.folders.filter(p => p.trim()).map(p => ({ fullPath: p.trim() }));
    const lib = await apiCreateLibrary(
      st.serverUrl, form.name.trim(), form.mediaType,
      folders, form.icon, form.provider, formToSettings(form),
    );
    setLibraries(prev => [...prev, lib]);
    setCreateMode(false);
    showToast(`Library "${lib.name}" created`);
    // Refresh global state so the shelf switcher picks up the new library.
    void st.refreshLibrary();
  }

  async function handleEdit(lib: Library, form: FormState) {
    const folders = form.folders.filter(p => p.trim()).map(p => ({ fullPath: p.trim() }));
    const payload: UpdateLibraryPayload = {
      name: form.name.trim(),
      icon: form.icon,
      provider: form.provider,
      folders,
      settings: formToSettings(form),
    };
    const updated = await apiUpdateLibrary(st.serverUrl, lib.id, payload);
    setLibraries(prev => prev.map(l => (l.id === updated.id ? updated : l)));
    setEditTarget(null);
    showToast(`"${updated.name}" updated`);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeletePending(true);
    try {
      await apiDeleteLibrary(st.serverUrl, deleteTarget.id);
      setLibraries(prev => prev.filter(l => l.id !== deleteTarget.id));
      setDeleteTarget(null);
      showToast('Library deleted');
      // Refresh global state so the shelf switcher removes the deleted library
      // and currentLibraryId is repointed if it was the active one.
      void st.refreshLibrary();
    } catch (e) {
      setListError(typeof e === 'string' ? e : (e as Error)?.message ?? 'Delete failed.');
      setDeleteTarget(null);
    } finally {
      setDeletePending(false);
    }
  }

  async function handleAddProvider(p: { name: string; url: string; mediaType: string; authHeaderValue?: string }) {
    const created = await createCustomMetadataProvider(st.serverUrl, p);
    setCustomProviders(prev => [...prev, created]);
    showToast(`Provider "${created.name}" added`);
  }

  async function handleDeleteProvider(id: string) {
    await deleteCustomMetadataProvider(st.serverUrl, id);
    setCustomProviders(prev => prev.filter(p => p.id !== id));
    showToast('Provider removed');
  }

  return (
    <div>
      {!embedded && (
        <SectionHead
          title="Libraries"
          subtitle="Manage libraries on your Audiobookshelf server."
        />
      )}

      <Panel
        label="Libraries"
        action={!createMode ? (
          <SmallBtn onClick={() => { setCreateMode(true); setEditTarget(null); setDeleteTarget(null); }}>
            + New Library
          </SmallBtn>
        ) : undefined}
      >
      {/* Create form */}
      {createMode && (
        <div style={{
          margin: '8px 2px 14px',
          border: '1px solid var(--onyx-accent-edge)',
          borderRadius: 8,
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '12px 20px 0',
            fontFamily: SERIF, fontSize: 14, fontWeight: 500,
            color: 'var(--onyx-text-dim)',
          }}>
            New Library
          </div>
          <LibraryForm
            initial={DEFAULT_FORM}
            lockMediaType={false}
            onSubmit={handleCreate}
            onCancel={() => setCreateMode(false)}
            submitLabel="Create Library"
            serverUrl={st.serverUrl}
            customProviders={customProviders}
          />
        </div>
      )}

      {/* Loading / error */}
      {loading && (
        <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em', padding: '12px 0' }}>
          Loading libraries…
        </div>
      )}
      {!loading && listError && (
        <div style={{ fontFamily: MONO, fontSize: 11, color: '#e8716a', padding: '8px 0' }}>
          {listError}
        </div>
      )}

      {/* Library list */}
      {!loading && !listError && (
        <div>
          {libraries.length === 0 && !createMode && (
            <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em', padding: '12px 0' }}>
              No libraries found.
            </div>
          )}

          {libraries.map((lib, idx) => {
            const isEditing = editTarget === lib.id;
            const isDeleting = deleteTarget?.id === lib.id;
            const isScanning = scanPending.has(lib.id);

            return (
              <div key={lib.id} style={{ borderBottom: idx < libraries.length - 1 && !isEditing ? '1px solid var(--onyx-line)' : 'none' }}>
                {/* Library row */}
                <div style={{ padding: '14px 2px' }}>
                  {/* Top row: icon · name+meta · action buttons */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 18, flexShrink: 0, lineHeight: 1 }}>
                      {iconEmoji(lib.icon)}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 14, fontWeight: 500, color: 'var(--onyx-text)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {lib.name}
                      </div>
                      <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', marginTop: 2, letterSpacing: '0.04em' }}>
                        {lib.mediaType}{lib.provider ? ` · ${lib.provider}` : ''}
                      </div>
                    </div>

                    {!isDeleting && (
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                        <SmallBtn
                          muted
                          onClick={() => handleScan(lib)}
                          disabled={isScanning}
                          title="Trigger incremental scan"
                        >
                          {isScanning ? 'Scanning…' : 'Scan'}
                        </SmallBtn>
                        <SmallBtn
                          muted
                          onClick={() => {
                            setEditTarget(isEditing ? null : lib.id);
                            setCreateMode(false);
                            setDeleteTarget(null);
                          }}
                        >
                          {isEditing ? 'Collapse' : 'Edit'}
                        </SmallBtn>
                        <SmallBtn
                          danger
                          onClick={() => {
                            setDeleteTarget(lib);
                            setEditTarget(null);
                            setCreateMode(false);
                          }}
                        >
                          Delete
                        </SmallBtn>
                      </div>
                    )}
                  </div>

                  {/* Folder paths */}
                  {lib.folders.length > 0 && (
                    <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: '2px 14px' }}>
                      {lib.folders.map((f, i) => (
                        <span key={i} style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.02em' }}>
                          {f.fullPath}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Last scan */}
                  <div style={{ marginTop: 5, fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', opacity: 0.65 }}>
                    Last scanned {relativeTime(lib.lastScan)}
                  </div>

                  {/* Delete confirmation — inline warning, no modal */}
                  {isDeleting && (
                    <div style={{
                      marginTop: 14, padding: '14px 16px',
                      background: 'rgba(232,113,106,0.07)',
                      border: '1px solid rgba(232,113,106,0.22)',
                      borderRadius: 7,
                    }}>
                      <div style={{ fontSize: 12.5, color: 'var(--onyx-text)', lineHeight: 1.55, marginBottom: 14 }}>
                        <span style={{ color: '#e8716a', fontWeight: 600 }}>⚠ Deleting "{lib.name}"</span>{' '}
                        will permanently remove all library items, collections, and listening progress from the server.
                        Files on disk are <strong>not</strong> deleted. This cannot be undone.
                      </div>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <SmallBtn muted onClick={() => setDeleteTarget(null)}>Cancel</SmallBtn>
                        <SmallBtn danger onClick={handleDelete} disabled={deletePending}>
                          {deletePending ? 'Deleting…' : 'Delete Library'}
                        </SmallBtn>
                      </div>
                    </div>
                  )}
                </div>

                {/* Inline edit form — expands below the row */}
                {isEditing && (
                  <div style={{
                    margin: '0 2px 14px',
                    border: '1px solid var(--onyx-accent-edge)',
                    borderRadius: 8,
                    overflow: 'hidden',
                  }}>
                    <LibraryForm
                      initial={libraryToForm(lib)}
                      lockMediaType
                      onSubmit={form => handleEdit(lib, form)}
                      onCancel={() => setEditTarget(null)}
                      submitLabel="Save Changes"
                      serverUrl={st.serverUrl}
                      customProviders={customProviders}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      </Panel>

      {/* Custom metadata providers */}
      {!loading && !listError && (
        <CustomProvidersManager
          providers={customProviders}
          onAdd={handleAddProvider}
          // Confirm before deleting — provider config (URL + auth header) is
          // not recoverable and nearby destructive actions all confirm.
          onDelete={async id => {
            const p = customProviders.find(x => x.id === id);
            st.setConfirmDialog({
              title: 'Delete metadata provider',
              message: `Delete the custom provider "${p?.name ?? id}"? Its configuration cannot be recovered.`,
              confirmLabel: 'Delete',
              onConfirm: () => void handleDeleteProvider(id),
            });
          }}
        />
      )}

      {/* Open Library integration (moved from the former Integrations tab) */}
      <OpenLibraryManager st={st} />

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 28, right: 32,
          padding: '10px 18px',
          background: 'var(--onyx-panel2)',
          border: '1px solid var(--onyx-glass-edge)',
          borderRadius: 8,
          fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text)',
          letterSpacing: '0.04em',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          zIndex: 1000,
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}
