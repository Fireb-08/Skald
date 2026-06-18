import { useState, useEffect, useCallback } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import type { OnyxState } from '../../state/onyx';
import type { Library, ScannedItem } from '../../api/abs';
import { createLocalLibrary, deleteLocalLibrary, scanLocalLibrary, ingestLocalPaths, setLocalLibraryConfig, getUnidentifiedItems, type IngestOutcome } from '../../api/abs';
import { log } from '../../lib/log';
import Icon from '../Icon';
import { SectionHead, Panel, Seg, MONO, DIM_GOLD } from './shared';
import LocalMatchModal from './LocalMatchModal';

// Local Library settings (Local Library & Split Libraries roadmap, Phase 2/3).
// Create a local library from a folder on disk, (re)scan it into the catalog, and
// switch to it. Unlike the ABS Libraries section this is always available — local
// libraries are a client-side concept and require neither a server nor admin.
export interface LocalLibrarySectionProps { st: OnyxState; }

export default function LocalLibrarySection({ st }: LocalLibrarySectionProps) {
  // Busy id: the library currently scanning (or '__new__' while adding), so the
  // relevant button shows a spinner and is disabled.
  const [busy, setBusy] = useState<string | null>(null);
  // Quarantined books per library (from <root>/_Unidentified), and the active
  // match-modal target.
  const [unidentified, setUnidentified] = useState<Record<string, ScannedItem[]>>({});
  const [matchTarget, setMatchTarget] = useState<{ libId: string; item: ScannedItem } | null>(null);

  const locals: Library[] = st.libraries.filter(l => l.source === 'local');

  const reloadUnidentified = useCallback(async () => {
    const locs = st.libraries.filter(l => l.source === 'local');
    const map: Record<string, ScannedItem[]> = {};
    await Promise.all(locs.map(async l => {
      try { map[l.id] = await getUnidentifiedItems(l.id); } catch { map[l.id] = []; }
    }));
    setUnidentified(map);
  }, [st.libraries]);

  useEffect(() => { void reloadUnidentified(); }, [reloadUnidentified]);

  // Folder name → default library name (last path segment).
  const folderName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() || 'Local Library';

  async function addLibrary() {
    try {
      const dir = await open({ directory: true, multiple: false, title: 'Choose a library folder' });
      if (typeof dir !== 'string') return; // cancelled
      setBusy('__new__');
      const name = folderName(dir);
      log.info('library', 'add local library', { name });
      const lib = await createLocalLibrary(name, dir);
      const count = await scanLocalLibrary(lib.id);
      await st.refreshLibrary();
      st.setToast({ message: `Added "${name}" — ${count} item${count === 1 ? '' : 's'}`, type: 'success' });
    } catch (e) {
      log.error('library', 'add local library failed', { err: String(e) });
      st.setToast({ message: 'Could not add local library', type: 'error' });
    } finally {
      setBusy(null);
    }
  }

  // Summarize an ingest run into a single toast.
  function reportIngest(outcomes: IngestOutcome[]) {
    const filed = outcomes.filter(o => o.outcome === 'filed').length;
    const quar = outcomes.filter(o => o.outcome === 'quarantined').length;
    const err = outcomes.filter(o => o.outcome === 'error').length;
    if (outcomes.length === 0) { st.setToast({ message: 'No books found to import', type: 'info' }); return; }
    const parts = [`${filed} filed`];
    if (quar) parts.push(`${quar} need attention`);
    if (err) parts.push(`${err} failed`);
    st.setToast({ message: `Imported — ${parts.join(', ')}`, type: err ? 'error' : 'success' });
  }

  async function importInto(lib: Library) {
    try {
      const picked = await open({ directory: true, multiple: true, title: 'Choose folder(s) to import' });
      const sources = Array.isArray(picked) ? picked : typeof picked === 'string' ? [picked] : [];
      if (sources.length === 0) return; // cancelled
      setBusy(lib.id);
      log.info('library', 'ingest into library', { count: sources.length });
      const outcomes = await ingestLocalPaths(lib.id, sources);
      if (st.currentLibraryId === lib.id) await st.setActiveLibrary(lib.id);
      else await st.refreshLibrary();
      void reloadUnidentified();
      reportIngest(outcomes);
    } catch (e) {
      log.error('library', 'ingest failed', { err: String(e) });
      st.setToast({ message: 'Import failed', type: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function importStaging(lib: Library) {
    if (!lib.stagingPath) return;
    try {
      setBusy(lib.id);
      const outcomes = await ingestLocalPaths(lib.id, [lib.stagingPath]);
      if (st.currentLibraryId === lib.id) await st.setActiveLibrary(lib.id);
      else await st.refreshLibrary();
      void reloadUnidentified();
      reportIngest(outcomes);
    } catch (e) {
      log.error('library', 'staging import failed', { err: String(e) });
      st.setToast({ message: 'Import failed', type: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function chooseStaging(lib: Library) {
    try {
      const dir = await open({ directory: true, multiple: false, title: 'Choose a staging folder' });
      if (typeof dir !== 'string') return;
      await setLocalLibraryConfig(lib.id, dir, undefined);
      await st.refreshLibrary();
      st.setToast({ message: 'Staging folder set', type: 'success' });
    } catch (e) {
      log.error('library', 'set staging failed', { err: String(e) });
    }
  }

  async function setMode(lib: Library, mode: 'copy' | 'move') {
    try {
      await setLocalLibraryConfig(lib.id, undefined, mode);
      await st.refreshLibrary();
    } catch (e) {
      log.error('library', 'set organize mode failed', { err: String(e) });
    }
  }

  async function rescan(lib: Library) {
    try {
      setBusy(lib.id);
      const count = await scanLocalLibrary(lib.id);
      // If the rescanned library is the active one, reload its items into the shelf.
      if (st.currentLibraryId === lib.id) await st.setActiveLibrary(lib.id);
      st.setToast({ message: `Rescanned "${lib.name}" — ${count} item${count === 1 ? '' : 's'}`, type: 'success' });
    } catch (e) {
      log.error('library', 'rescan local library failed', { err: String(e) });
      st.setToast({ message: 'Rescan failed', type: 'error' });
    } finally {
      setBusy(null);
    }
  }

  function removeLibrary(lib: Library) {
    st.setConfirmDialog({
      title: 'Remove local library',
      message: `Remove "${lib.name}" from Skald? This only removes it from the catalog — your files on disk are left untouched.`,
      confirmLabel: 'Remove',
      onConfirm: async () => {
        try {
          await deleteLocalLibrary(lib.id);
          await st.refreshLibrary();
          st.setToast({ message: `Removed "${lib.name}"`, type: 'info' });
        } catch (e) {
          log.error('library', 'remove local library failed', { err: String(e) });
          st.setToast({ message: 'Could not remove library', type: 'error' });
        }
      },
    });
  }

  const rootPath = (lib: Library) => lib.folders?.[0]?.fullPath ?? '';

  return (
    <div>
      <SectionHead
        title="Local Library"
        subtitle="Build a library from audiobooks on this computer — no server required. Skald scans the folder, reads embedded metadata, and adds the books alongside any Audiobookshelf libraries."
      />

      <Panel
        label="Your local libraries"
        action={
          <button
            onClick={addLibrary}
            disabled={busy === '__new__'}
            style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '6px 12px', borderRadius: 8,
              background: 'var(--onyx-accent-dim)', border: '1px solid var(--onyx-accent-edge)',
              color: 'var(--onyx-accent)', cursor: busy === '__new__' ? 'default' : 'pointer',
              fontFamily: MONO, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase',
              opacity: busy === '__new__' ? 0.6 : 1,
            }}
          >
            <Icon name="plus" size={12} />
            {busy === '__new__' ? 'Scanning…' : 'Add folder…'}
          </button>
        }
      >
        {locals.length === 0 ? (
          <div style={{ padding: '22px 4px', color: 'var(--onyx-text-mute)', fontSize: 13 }}>
            No local libraries yet. Choose a folder of audiobooks to get started.
          </div>
        ) : (
          locals.map(lib => {
            const active = st.currentLibraryId === lib.id;
            const scanning = busy === lib.id;
            return (
              <div
                key={lib.id}
                style={{ padding: '14px 0', borderBottom: '1px solid var(--onyx-line)' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--onyx-text)' }}>{lib.name}</span>
                      {active && (
                        <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: DIM_GOLD }}>
                          Active
                        </span>
                      )}
                    </div>
                    <div style={{ marginTop: 3, fontSize: 11.5, color: 'var(--onyx-text-mute)', fontFamily: MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {rootPath(lib)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    {!active && (
                      <button onClick={() => st.setActiveLibrary(lib.id)} style={btn()}>Open</button>
                    )}
                    <button onClick={() => rescan(lib)} disabled={scanning} style={btn(scanning)}>
                      {scanning ? 'Scanning…' : 'Rescan'}
                    </button>
                    <button onClick={() => removeLibrary(lib)} style={btn(false, true)}>Remove</button>
                  </div>
                </div>

                {/* Ingest controls — import into the Author/Series/Title tree. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                  <button onClick={() => importInto(lib)} disabled={scanning} style={btn(scanning)}>
                    {scanning ? 'Working…' : 'Import…'}
                  </button>
                  {/* Copy vs move organize mode */}
                  <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                    <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--onyx-text-mute)' }}>On import</span>
                    <Seg active={(lib.organizeMode ?? 'copy') === 'copy'} onClick={() => setMode(lib, 'copy')}>Copy</Seg>
                    <Seg active={lib.organizeMode === 'move'} onClick={() => setMode(lib, 'move')}>Move</Seg>
                  </div>
                  {/* Staging folder */}
                  {lib.stagingPath ? (
                    <button onClick={() => importStaging(lib)} disabled={scanning} style={btn(scanning)}>Import staging</button>
                  ) : (
                    <button onClick={() => chooseStaging(lib)} style={btn()}>Set staging…</button>
                  )}
                </div>
                {lib.stagingPath && (
                  <div style={{ marginTop: 6, fontSize: 10.5, color: 'var(--onyx-text-mute)', fontFamily: MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    staging · {lib.stagingPath} ·{' '}
                    <button onClick={() => chooseStaging(lib)} style={{ background: 'none', border: 'none', color: DIM_GOLD, cursor: 'pointer', font: 'inherit', padding: 0 }}>change</button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </Panel>

      {/* Needs attention — quarantined books awaiting a metadata match. */}
      {locals.some(l => (unidentified[l.id]?.length ?? 0) > 0) && (
        <Panel label="Needs attention">
          {locals.flatMap(lib =>
            (unidentified[lib.id] ?? []).map(item => (
              <div
                key={item.sourcePath}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '12px 0', borderBottom: '1px solid var(--onyx-line)' }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, color: 'var(--onyx-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.sourcePath.split(/[\\/]/).filter(Boolean).pop()}
                  </div>
                  <div style={{ marginTop: 2, fontSize: 10.5, color: 'var(--onyx-text-mute)', fontFamily: MONO }}>{lib.name} · unidentified</div>
                </div>
                <button onClick={() => setMatchTarget({ libId: lib.id, item })} style={btn()}>Match…</button>
              </div>
            )),
          )}
        </Panel>
      )}

      {matchTarget && (
        <LocalMatchModal
          st={st}
          libraryId={matchTarget.libId}
          item={matchTarget.item}
          onClose={() => setMatchTarget(null)}
          onApplied={async () => {
            if (st.currentLibraryId === matchTarget.libId) await st.setActiveLibrary(matchTarget.libId);
            else await st.refreshLibrary();
            void reloadUnidentified();
          }}
        />
      )}
    </div>
  );
}

// Small mono action button used in the library rows.
function btn(disabled = false, danger = false): React.CSSProperties {
  return {
    padding: '6px 11px', borderRadius: 6, fontFamily: MONO, fontSize: 10,
    letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap',
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.55 : 1,
    background: 'transparent',
    border: `1px solid ${danger ? 'rgba(220,90,90,0.35)' : 'var(--onyx-glass-edge)'}`,
    color: danger ? 'rgba(230,120,120,0.9)' : 'var(--onyx-text-dim)',
  };
}
