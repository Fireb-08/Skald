// Auto-download settings (cluster E). Per-podcast automatic episode download:
// toggle, schedule (cron via the shared CronEditor), and retention limits.
// Persisted through the standard media patch (PATCH /api/items/:id/media).
import { useState } from 'react';
import ReactDOM from 'react-dom';
import type { OnyxState } from '../../state/onyx';
import { updateMedia, validateCron, updateLocalPodcastSettings, asPodcastItem, type LibraryItem } from '../../api/abs';
import CronEditor from '../settings/CronEditor';
import { useModalFocus } from '../../hooks/useModalFocus';
import { errorMessage } from '../../lib/presentError';
import { log } from '../../lib/log';

const MONO = "'JetBrains Mono', ui-monospace, monospace";
const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';

export interface PodcastSettingsModalProps {
  st: OnyxState;
  item: LibraryItem;
  onClose: () => void;
  onSaved: () => void;
}

export default function PodcastSettingsModal({ st, item, onClose, onSaved }: PodcastSettingsModalProps) {
  const media = asPodcastItem(item).media;

  const [autoDownload, setAutoDownload] = useState<boolean>(media.autoDownloadEpisodes ?? false);
  const [schedule, setSchedule] = useState<string>(media.autoDownloadSchedule || '0 * * * *');
  const [maxKeep, setMaxKeep] = useState<number>(media.maxEpisodesToKeep ?? 0);
  const [maxNew, setMaxNew] = useState<number>(media.maxNewEpisodesToDownload ?? 3);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useModalFocus<HTMLDivElement>(onClose, !saving);

  const isLocal = st.activeLibrary?.source === 'local';

  async function save() {
    setSaving(true); setError('');
    try {
      // Validate the cron only when auto-download is on (otherwise schedule is
      // moot). Local libraries have no server validator — accept any 5-field
      // expression (the scheduler evaluates it locally; the CronEditor only emits
      // valid shapes anyway).
      if (autoDownload && !isLocal) {
        const ok = await validateCron(st.serverUrl, schedule).catch(() => false);
        if (!ok) { setError('Schedule is not a valid cron expression.'); setSaving(false); return; }
      }
      if (isLocal) {
        await updateLocalPodcastSettings(
          item.id, autoDownload, autoDownload ? schedule : null,
          Number(maxNew) || 0, Number(maxKeep) || 0,
        );
      } else {
        await updateMedia(st.serverUrl, item.id, {
          autoDownloadEpisodes: autoDownload,
          autoDownloadSchedule: schedule,
          maxEpisodesToKeep: Number(maxKeep) || 0,
          maxNewEpisodesToDownload: Number(maxNew) || 0,
        });
      }
      st.setToast({ message: 'Auto-download settings saved', type: 'success' });
      onSaved();
      onClose();
    } catch (e) {
      log.warn('library', 'podcast settings save failed', { itemId: item.id, err: String(e) });
      setError(errorMessage(e, { operation: 'save' }));
      setSaving(false);
    }
  }

  const numField = (label: string, hint: string, value: number, set: (n: number) => void) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12.5, color: 'var(--onyx-text)' }}>{label}</div>
        <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', marginTop: 2 }}>{hint}</div>
      </div>
      <input
        type="number" min={0} value={value}
        onChange={e => set(parseInt(e.target.value || '0', 10))}
        style={{ width: 72, background: 'rgba(0,0,0,0.3)', color: 'var(--onyx-text)', border: '1px solid var(--onyx-line)', borderRadius: 6, padding: '6px 8px', fontSize: 12.5, fontFamily: 'inherit' }}
      />
    </div>
  );

  const modal = (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)' }}
      onMouseDown={e => { if (e.target === e.currentTarget && !saving) onClose(); }}
    >
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="podcast-settings-title" style={{
        width: 460, maxHeight: '80vh', background: 'var(--onyx-panel2)', border: '1px solid var(--onyx-line)',
        borderRadius: 12, boxShadow: '0 24px 60px rgba(0,0,0,0.7)', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--onyx-line)' }}>
          <div id="podcast-settings-title" style={{ fontFamily: SERIF, fontSize: 17, fontWeight: 500, color: 'var(--onyx-text)' }}>Auto-Download</div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', marginTop: 4, letterSpacing: '0.04em' }}>
            {media.metadata?.title ?? ''}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={autoDownload} onChange={e => setAutoDownload(e.target.checked)} />
            <div style={{ fontSize: 13, color: 'var(--onyx-text)' }}>Automatically download new episodes</div>
          </label>

          {autoDownload && (
            <>
              <div>
                <div style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--onyx-text-dim)', letterSpacing: '0.06em', marginBottom: 8 }}>CHECK SCHEDULE</div>
                <CronEditor value={schedule} onChange={setSchedule} />
              </div>
              {numField('Max episodes to keep', '0 = keep all episodes', maxKeep, setMaxKeep)}
              {numField('Max new per check', 'cap downloads per scheduled check', maxNew, setMaxNew)}
            </>
          )}

          {error && <div style={{ fontSize: 12, color: '#e8716a' }}>{error}</div>}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--onyx-line)', display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button onClick={onClose} disabled={saving} style={{ background: 'none', border: 'none', cursor: saving ? 'default' : 'pointer', fontFamily: MONO, fontSize: 11, letterSpacing: '0.06em', color: 'var(--onyx-text-dim)' }}>CANCEL</button>
          <button
            onClick={save}
            disabled={saving}
            style={{
              padding: '9px 16px', borderRadius: 8, border: 'none', cursor: saving ? 'default' : 'pointer',
              background: saving ? 'var(--onyx-line)' : 'var(--onyx-accent)', color: saving ? 'var(--onyx-text-mute)' : 'var(--onyx-bg)',
              fontFamily: MONO, fontSize: 11, letterSpacing: '0.06em', fontWeight: 600,
            }}
          >{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, document.body);
}
