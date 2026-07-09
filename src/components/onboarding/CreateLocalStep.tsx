// Step 4 — Create a local library. Reuses createLocalLibrary (the same call the
// LocalLibrarySection create form uses): Skald provisions <location>/<name>/ with
// managed Staging / Audiobooks / Podcasts / Unidentified subfolders. On success it
// refreshes the library list and advances. (First-Launch Onboarding, Phase 3.)
import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import type { OnyxState } from '../../state/onyx';
import type { Library } from '../../api/abs';
import { createLocalLibrary } from '../../api/abs';
import { log } from '../../lib/log';
import { GoldButton, GhostButton, SERIF, MONO, SANS } from './frame';

export interface CreateLocalStepProps {
  st: OnyxState;
  // The library created in this run (null until created), so returning to the step
  // shows the success state instead of an empty form.
  created: Library | null;
  onCreated: (lib: Library) => void;
  onSkip: () => void;
}

export default function CreateLocalStep({ st, created, onCreated, onSkip }: CreateLocalStepProps) {
  const [name, setName] = useState('');
  const [parent, setParent] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<'book' | 'podcast'>('book');
  const [busy, setBusy] = useState(false);

  async function chooseLocation() {
    const dir = await open({ directory: true, multiple: false, title: 'Choose where to create the library' });
    if (typeof dir === 'string') setParent(dir);
  }

  async function create() {
    if (!name.trim() || !parent) return;
    try {
      setBusy(true);
      log.info('app', 'onboarding local library create', { mediaType });
      const lib = await createLocalLibrary(name.trim(), parent, mediaType);
      // Fold the new library into global state so the watcher + AddBooks step see it.
      await st.refreshLibrary();
      log.info('app', 'onboarding local library created', { mediaType });
      onCreated(lib);
    } catch (e) {
      log.error('app', 'onboarding local library create failed', { err: String(e) });
      st.setToast({ message: 'Could not create the library', type: 'error' });
    } finally {
      setBusy(false);
    }
  }

  // Already created — confirmation + Continue.
  if (created) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 12, background: 'rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.08)', border: '1px solid rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.25)' }}>
          <span style={{ color: 'var(--onyx-accent)', fontSize: 18 }}>✓</span>
          <div>
            <div style={{ fontFamily: SERIF, fontSize: 15, color: '#ebe7df' }}>Created “{created.name}”</div>
            <div style={{ fontFamily: MONO, fontSize: 11, color: 'rgba(235,231,223,0.5)', marginTop: 2 }}>
              {created.folders?.[0]?.fullPath ?? ''}
            </div>
          </div>
        </div>
        <div><GoldButton onClick={() => onCreated(created)}>Continue</GoldButton></div>
      </div>
    );
  }

  const btn = (disabled = false): React.CSSProperties => ({
    padding: '9px 15px', borderRadius: 8, fontFamily: MONO, fontSize: 10, letterSpacing: '0.07em',
    textTransform: 'uppercase', whiteSpace: 'nowrap', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
    background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(235,231,223,0.7)',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Name */}
      <label style={{ display: 'block' }}>
        <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 13, color: 'rgba(235,231,223,0.62)', marginBottom: 7 }}>What shall we call it?</div>
        <input
          className="saga-input"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={mediaType === 'podcast' ? 'Podcasts' : 'Audiobooks'}
          spellCheck={false}
          style={{ width: '100%', boxSizing: 'border-box', background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.12)', outline: 'none', color: '#ebe7df', fontSize: 16, fontFamily: SERIF, padding: '0 0 9px' }}
        />
      </label>

      {/* Media type + location */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, overflow: 'hidden' }}>
          {(['book', 'podcast'] as const).map(t => (
            <button
              key={t} type="button" onClick={() => setMediaType(t)}
              style={{
                padding: '8px 14px', fontFamily: MONO, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
                cursor: 'pointer', border: 'none',
                background: mediaType === t ? 'rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.15)' : 'transparent',
                color: mediaType === t ? 'var(--onyx-accent)' : 'rgba(235,231,223,0.5)',
              }}
            >{t === 'book' ? 'Audiobooks' : 'Podcasts'}</button>
          ))}
        </div>
        <button type="button" onClick={chooseLocation} style={btn()}>{parent ? 'Change location' : 'Choose location…'}</button>
      </div>

      <div style={{ fontFamily: MONO, fontSize: 11.5, color: 'rgba(235,231,223,0.42)', lineHeight: 1.5 }}>
        {parent
          ? `Will create  ${parent.replace(/[\\/]+$/, '')}\\${name.trim() || '<name>'}\\  with Staging, Audiobooks, Podcasts and Unidentified subfolders.`
          : 'Pick a location and Skald creates the library folder — with Staging, Audiobooks, Podcasts and Unidentified subfolders — for you.'}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <GoldButton onClick={create} busy={busy} disabled={!name.trim() || !parent}>
          {busy ? 'Creating…' : 'Create library'}
        </GoldButton>
        <GhostButton onClick={onSkip}>Skip for now</GhostButton>
      </div>

      <div style={{ fontFamily: SANS, fontSize: 11.5, color: 'rgba(235,231,223,0.35)', maxWidth: 440, lineHeight: 1.5 }}>
        You can add more local libraries, or remove this one, any time in Settings → Libraries → On this PC.
      </div>
    </div>
  );
}
