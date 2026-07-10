import { useState } from 'react';
import type { CSSProperties } from 'react';
import ReactDOM from 'react-dom';
import { open } from '@tauri-apps/plugin-dialog';
import type { Library, IngestOutcome, ScannedItem } from '../api/abs';
import { getUnidentifiedItems, ingestLocalPaths, revealPath } from '../api/abs';
import type { OnyxState } from '../state/onyx';
import { log } from '../lib/log';
import { newQuarantineItems, summarizeImport } from '../lib/localImport';
import Icon, { type IconName } from './Icon';
import MatchModal, { makeLocalQuarantineAdapter } from './MatchModal';

const MONO = "'JetBrains Mono', ui-monospace, monospace";
const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const AUDIO_EXTENSIONS = ['m4b', 'm4a', 'mp3', 'flac', 'ogg', 'opus', 'aac', 'wav'];

export interface LocalImportDialogProps {
  st: OnyxState;
  library: Library;
  onClose: () => void;
  onImported?: () => void | Promise<void>;
}

type ImportRoute = 'files' | 'folder';

interface PendingMatch {
  outcomes: IngestOutcome[];
  items: ScannedItem[];
  index: number;
}

function Choice({ icon, title, copy, disabled, onClick }: {
  icon: IconName;
  title: string;
  copy: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left',
        padding: '14px 15px', borderRadius: 10,
        background: 'var(--onyx-glass)', border: '1px solid var(--onyx-glass-edge)',
        color: 'var(--onyx-text)', cursor: disabled ? 'wait' : 'pointer', opacity: disabled ? 0.55 : 1,
      }}
    >
      <span style={{ width: 34, height: 34, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: 'var(--onyx-accent-dim)', color: 'var(--onyx-accent)', border: '1px solid var(--onyx-accent-edge)' }}>
        <Icon name={icon} size={16} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600 }}>{title}</span>
        <span style={{ display: 'block', marginTop: 3, fontSize: 11.5, lineHeight: 1.45, color: 'var(--onyx-text-mute)' }}>{copy}</span>
      </span>
      <Icon name="chevron-right" size={13} color="var(--onyx-text-mute)" />
    </button>
  );
}

export default function LocalImportDialog({ st, library, onClose, onImported }: LocalImportDialogProps) {
  const [busy, setBusy] = useState<ImportRoute | 'staging' | null>(null);
  const [error, setError] = useState('');
  const [pendingMatch, setPendingMatch] = useState<PendingMatch | null>(null);

  async function refreshAfterImport() {
    if (st.currentLibraryId === library.id) await st.setActiveLibrary(library.id);
    else await st.refreshLibrary();
    await onImported?.();
  }

  async function finishImport(outcomes: IngestOutcome[], matched: number) {
    const summary = summarizeImport(outcomes, matched);
    const parts = [`${summary.added} added`];
    if (summary.needsAttention) parts.push(`${summary.needsAttention} need attention`);
    if (summary.failed) parts.push(`${summary.failed} failed`);
    log.info('library', 'local import complete', { libraryId: library.id, ...summary });
    st.setToast({
      message: `Imported into "${library.name}" — ${parts.join(', ')}`,
      type: summary.failed && summary.added === 0 ? 'error' : summary.added ? 'success' : 'info',
    });
    onClose();
    try {
      await refreshAfterImport();
    } catch (e) {
      log.error('library', 'refresh after local import failed', { libraryId: library.id, err: String(e) });
    }
  }

  async function ingest(route: ImportRoute, sources: string[]) {
    if (sources.length === 0) return;
    setBusy(route);
    setError('');
    log.info('library', 'local import start', { libraryId: library.id, route, sources: sources.length });
    try {
      const outcomes = await ingestLocalPaths(library.id, sources);
      const quarantined = outcomes.some(outcome => outcome.outcome === 'quarantined');
      if (quarantined) {
        try {
          const items = newQuarantineItems(outcomes, await getUnidentifiedItems(library.id));
          if (items.length > 0) {
            setPendingMatch({ outcomes, items, index: 0 });
            return;
          }
        } catch (e) {
          // Import succeeded; a queue lookup failure must not turn it into a
          // false failure. The existing Needs attention panel remains the fallback.
          log.warn('library', 'local import match queue unavailable', { libraryId: library.id, err: String(e) });
        }
      }
      await finishImport(outcomes, 0);
    } catch (e) {
      log.error('library', 'local import failed', { libraryId: library.id, route, err: String(e) });
      setError('Could not import from that location. Check the Skald log for details.');
    } finally {
      setBusy(null);
    }
  }

  async function pickFiles() {
    const picked = await open({
      directory: false,
      multiple: true,
      title: `Add books to "${library.name}"`,
      filters: [{ name: 'Audiobook files', extensions: AUDIO_EXTENSIONS }],
    });
    const sources = Array.isArray(picked) ? picked : typeof picked === 'string' ? [picked] : [];
    await ingest('files', sources);
  }

  async function pickFolder() {
    const picked = await open({ directory: true, multiple: false, title: `Choose a book folder or parent folder for "${library.name}"` });
    if (typeof picked === 'string') await ingest('folder', [picked]);
  }

  async function openStaging() {
    if (!library.stagingPath) {
      setError('This library does not have a Staging folder configured.');
      return;
    }
    setBusy('staging');
    setError('');
    try {
      await revealPath(library.stagingPath);
      log.info('library', 'open local import staging folder', { libraryId: library.id });
      onClose();
    } catch (e) {
      log.error('library', 'open local import staging folder failed', { libraryId: library.id, err: String(e) });
      setError('Could not open the Staging folder.');
    } finally {
      setBusy(null);
    }
  }

  if (pendingMatch) {
    const target = pendingMatch.items[pendingMatch.index];
    return (
      <MatchModal
        key={target.sourcePath}
        item={target.item}
        adapter={makeLocalQuarantineAdapter(library.id, target)}
        queue={{ index: pendingMatch.index, total: pendingMatch.items.length }}
        onClose={() => void finishImport(pendingMatch.outcomes, pendingMatch.index)}
        onComplete={() => {
          const matched = pendingMatch.index + 1;
          if (matched >= pendingMatch.items.length) void finishImport(pendingMatch.outcomes, matched);
          else setPendingMatch({ ...pendingMatch, index: matched });
        }}
        onRefresh={() => {}}
      />
    );
  }

  const working = busy !== null;
  const modalStyle: CSSProperties = {
    width: 500, maxWidth: 'calc(100vw - 48px)',
    background: 'var(--onyx-panel)', border: '1px solid var(--onyx-glass-edge)', borderRadius: 16,
    boxShadow: '0 40px 100px rgba(0,0,0,0.72), inset 0 1px 0 rgba(255,255,255,0.04)',
    overflow: 'hidden',
  };

  return ReactDOM.createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}
      onMouseDown={event => { if (event.target === event.currentTarget && !working) onClose(); }}
    >
      <div style={modalStyle}>
        <div style={{ padding: '20px 20px 16px 22px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, borderBottom: '1px solid var(--onyx-line)' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: SERIF, fontSize: 20, fontWeight: 500 }}>Add books to “{library.name}”</div>
            <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em', marginTop: 6 }}>Choose how the books enter this PC library</div>
          </div>
          <button onClick={onClose} disabled={working} style={{ width: 28, height: 28, borderRadius: 7, background: 'none', border: 'none', color: 'var(--onyx-text-mute)', cursor: working ? 'wait' : 'pointer', opacity: working ? 0.4 : 1, fontSize: 15 }}>×</button>
        </div>

        <div style={{ padding: '18px 22px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Choice icon="file" title={busy === 'files' ? 'Adding files…' : 'Add files'} copy="Choose one or more audiobook files from this PC." disabled={working} onClick={() => void pickFiles()} />
          <Choice icon="layers" title={busy === 'folder' ? 'Scanning folder…' : 'Add folder'} copy="Choose a book folder or a parent folder; Skald will scan and file every book it finds." disabled={working} onClick={() => void pickFolder()} />
          <Choice icon="upload" title={busy === 'staging' ? 'Opening Staging…' : 'Open Staging'} copy="Drop files or folders into the watched Staging folder for automatic import." disabled={working} onClick={() => void openStaging()} />
          {error && <div style={{ marginTop: 2, padding: '9px 11px', borderRadius: 8, background: 'rgba(232,113,106,0.08)', color: '#e8716a', fontFamily: MONO, fontSize: 10.5, lineHeight: 1.45 }}>{error}</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
