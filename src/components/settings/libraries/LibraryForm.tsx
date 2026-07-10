// Library create/edit form (name, media type, icon, provider, folders, and the
// per-library settings block).
// Moved verbatim out of LibrariesSection.tsx (God-File Decomposition roadmap, L3/L7).
import { useState, type ReactNode } from 'react';
import { MONO } from '../shared';
import {
  LIBRARY_ICONS,
  LIBRARY_PROVIDERS_BOOK,
  LIBRARY_PROVIDERS_PODCAST,
} from '../../../api/abs';
import type { CustomMetadataProvider } from '../../../api/abs';
import { iconEmoji, type FormState } from './formModel';
import { SmallBtn, Field, OnOff, SelectInput } from './widgets';
import ServerFolderPicker from './ServerFolderPicker';

export interface LibraryFormProps {
  initial: FormState;
  lockMediaType?: boolean;
  onSubmit: (form: FormState) => Promise<void>;
  onCancel: () => void;
  submitLabel: string;
  serverUrl: string;
  customProviders: CustomMetadataProvider[];
}

export default function LibraryForm({ initial, lockMediaType = false, onSubmit, onCancel, submitLabel, serverUrl, customProviders }: LibraryFormProps) {
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
