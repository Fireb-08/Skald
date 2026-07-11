import { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import type { OnyxState } from '../../state/onyx';
import {
  getDownloadsDir, revealDownloadsDir, getDownloads, removeDownload, cancelDownload,
  getCacheDir, setDownloadsDir, setCacheDir, revealPath,
} from '../../api/abs';
import { log } from '../../lib/log';
import type { DownloadRecord } from '../../api/abs';
import ConfirmDialog from '../ui/ConfirmDialog';
import Cover from '../Cover';
import { SectionHead, Row, MONO, SERIF, Panel, Toggle, useLocal } from './shared';

// Subtle metadata chip (e.g. size / relative date on a download row).
function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontFamily: MONO, fontSize: 10, letterSpacing: '0.03em', color: 'var(--onyx-text-dim)',
      background: 'rgba(255,255,255,0.04)', border: '1px solid var(--onyx-glass-edge)',
      borderRadius: 5, padding: '2px 7px', whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

// Format bytes as KB / MB / GB to one decimal place for size display.
function fmtSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// Return a human-friendly relative time string from a Unix-ms timestamp.
function relativeTime(ms: number): string {
  const diff = (Date.now() - ms) / 1000; // seconds elapsed
  if (diff < 60)  return 'just now';
  const minutes = Math.floor(diff / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30)  return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

// Read-only path field + Open/Change buttons for a relocatable storage root.
function StorageControls({ value, busy, onOpen, onChange }: { value: string; busy: boolean; onOpen: () => void; onChange: () => void }) {
  const btn = {
    padding: '7px 14px', fontSize: 10, fontFamily: MONO, letterSpacing: '0.08em',
    textTransform: 'uppercase' as const, background: 'transparent',
    border: '1px solid var(--onyx-glass-edge)', borderRadius: 6, color: 'var(--onyx-text-dim)',
  } as const;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input
        readOnly
        value={value || 'Loading…'}
        onFocus={e => e.currentTarget.select()}
        title={value}
        style={{
          fontFamily: MONO, fontSize: 11, background: 'rgba(0,0,0,0.3)',
          border: '1px solid var(--onyx-glass-edge)', borderRadius: 7, color: 'var(--onyx-text-dim)',
          padding: '7px 10px', width: 260, maxWidth: '32vw', outline: 'none',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      />
      <button onClick={onOpen} style={{ ...btn, cursor: 'pointer' }}>Open</button>
      <button onClick={onChange} disabled={busy} style={{ ...btn, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1 }}>
        {busy ? 'Moving…' : 'Change…'}
      </button>
    </div>
  );
}

// Tracks a single active download for the In Progress sub-section.
interface InProgressEntry {
  title: string;
  bytesDownloaded: number;
  totalBytes: number; // 0 when Content-Length is absent — renders indeterminate bar
}

interface Props { st: OnyxState; }

export default function DownloadsSection({ st }: Props) {
  // The two relocatable storage roots (Onboarding roadmap, Phase 4 / gap #1):
  // downloadsDir holds offline audio; coverCacheDir holds covers + the offline
  // library/chapter caches. relocating guards the active move.
  const [downloadsDir, setDownloadsDirState] = useState('');
  const [coverCacheDir, setCoverCacheDir] = useState('');
  const [relocating, setRelocating] = useState<'downloads' | 'cache' | null>(null);
  // Local copy of the registry, kept in sync with Rust on mount and on events.
  const [records, setRecords] = useState<DownloadRecord[]>([]);
  const [historySort, setHistorySort] = useState<'newest' | 'oldest' | 'largest'>(() => (localStorage.getItem('onyx.downloads.historySort') as 'newest' | 'oldest' | 'largest') ?? 'newest');
  // Record awaiting individual delete confirmation.
  const [pendingDelete, setPendingDelete] = useState<DownloadRecord | null>(null);
  // True when the "clear all" confirmation dialog is open.
  const [pendingClearAll, setPendingClearAll] = useState(false);
  // Active transfers keyed by itemId — populated/cleared by download-progress events.
  const [inProgress, setInProgress] = useState<Map<string, InProgressEntry>>(new Map());

  // Download behaviour preferences — read by the book-finished observer in onyx.ts.
  // autoNextInSeries defaults off; keepAfterFinish defaults ON (preserve current
  // behaviour — nothing is auto-removed unless the user opts in by turning it off).
  const [autoNextInSeries, setAutoNextInSeries] = useLocal('onyx.downloads.autoNextInSeries', false);
  const [keepAfterFinish, setKeepAfterFinish]   = useLocal('onyx.downloads.keepAfterFinish', true);

  // Load the downloads dir path and completed downloads on mount. getDownloads
  // validates the registry against disk (pruning files deleted outside the app),
  // so we also push the result into global st.downloads — that's what the sidebar
  // count reads, so opening this section corrects a stale badge.
  useEffect(() => {
    getDownloadsDir().then(setDownloadsDirState).catch(e => log.error('downloads', 'getDownloadsDir failed', { err: String(e) }));
    getCacheDir().then(setCoverCacheDir).catch(e => log.error('downloads', 'getCacheDir failed', { err: String(e) }));
    getDownloads().then(recs => { setRecords(recs); st.setDownloads(recs); }).catch(e => log.error('downloads', 'load downloads registry failed', { err: String(e) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Relocate one of the two storage roots: pick a folder, run the backend move
  // (which also repoints the downloads registry), then refresh the displayed path.
  async function relocate(which: 'downloads' | 'cache') {
    const picked = await open({ directory: true, multiple: false, title: which === 'downloads' ? 'Choose where to store downloads' : 'Choose where to store the cache' });
    if (typeof picked !== 'string') return;
    try {
      setRelocating(which);
      log.info('downloads', 'relocate storage root', { which });
      if (which === 'downloads') { await setDownloadsDir(picked); setDownloadsDirState(await getDownloadsDir()); }
      else { await setCacheDir(picked); setCoverCacheDir(await getCacheDir()); }
      st.setToast({ message: which === 'downloads' ? 'Downloads folder moved' : 'Cache folder moved', type: 'success' });
    } catch (e) {
      log.error('downloads', 'relocate storage root failed', { which, err: String(e) });
      st.setToast({ message: 'Could not move the folder', type: 'error' });
    } finally {
      setRelocating(null);
    }
  }

  // Subscribe to Rust download lifecycle events to keep the In Progress section live.
  useEffect(() => {
    let unlistenProgress:  (() => void) | undefined;
    let unlistenComplete:  (() => void) | undefined;
    let unlistenCancelled: (() => void) | undefined;
    let unlistenFailed:    (() => void) | undefined;

    // Each chunk from the Rust streaming loop updates or inserts an in-progress entry.
    listen<{ itemId: string; title: string; bytesDownloaded: number; totalBytes: number }>(
      'download-progress',
      event => {
        const { itemId, title, bytesDownloaded, totalBytes } = event.payload;
        setInProgress(prev => {
          const next = new Map(prev);
          next.set(itemId, { title, bytesDownloaded, totalBytes });
          return next;
        });
      },
    ).then(fn => { unlistenProgress = fn; });

    // Completion: remove from in-progress and refresh the completed registry.
    listen<{ itemId: string }>('download-complete', event => {
      const { itemId } = event.payload;
      setInProgress(prev => {
        const next = new Map(prev);
        next.delete(itemId);
        return next;
      });
      // Re-fetch the registry so the newly completed entry appears without a page reload.
      getDownloads().then(setRecords).catch(e => log.error('downloads', 'refresh registry after download-complete failed', { err: String(e) }));
      // Note: st.downloads is refreshed by the listener in onyx.ts — no duplicate call needed.
    }).then(fn => { unlistenComplete = fn; });

    // Cancelled or failed: just remove from in-progress; no registry changes needed.
    const clearEntry = (itemId: string) =>
      setInProgress(prev => {
        const next = new Map(prev);
        next.delete(itemId);
        return next;
      });

    listen<{ itemId: string }>('download-cancelled', event => {
      clearEntry(event.payload.itemId);
    }).then(fn => { unlistenCancelled = fn; });

    listen<{ itemId: string }>('download-failed', event => {
      clearEntry(event.payload.itemId);
    }).then(fn => { unlistenFailed = fn; });

    return () => {
      unlistenProgress?.();
      unlistenComplete?.();
      unlistenCancelled?.();
      unlistenFailed?.();
    };
  }, []); // register once per mount — setters and st.setDownloads are stable

  // Sum all file sizes for the "used" pill in the header.
  const totalBytes = records.reduce((sum, r) => sum + r.fileSize, 0);
  const sortedRecords = records.slice().sort((a, b) => historySort === 'oldest'
    ? a.downloadedAt - b.downloadedAt
    : historySort === 'largest'
      ? b.fileSize - a.fileSize
      : b.downloadedAt - a.downloadedAt);

  // Confirm and execute deletion of a single downloaded book.
  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    const record = pendingDelete;
    setPendingDelete(null);
    // Optimistic update: remove from local display and global state immediately.
    // The Rust command always clears the registry entry even when the file is gone,
    // so the UI stays consistent regardless of the actual disk outcome.
    setRecords(prev => prev.filter(r => r.itemId !== record.itemId));
    // Sync to global st.downloads so the offline playback router stops routing to
    // the now-deleted file without requiring a full app reload.
    st.setDownloads(prev => prev.filter(r => r.itemId !== record.itemId));
    try {
      await removeDownload(record.itemId);
      st.setToast({ message: `"${record.title}" removed from downloads`, type: 'success' });
    } catch {
      // File was already deleted outside the app — registry is still cleaned up by Rust.
      st.setToast({ message: `"${record.title}" was already gone — removed from list`, type: 'info' });
    }
  };

  // Confirm and execute deletion of every downloaded book in sequence.
  const handleConfirmClearAll = async () => {
    setPendingClearAll(false);
    // Snapshot and clear immediately so the UI reflects the intent before async work finishes.
    const snapshot = [...records];
    setRecords([]);
    st.setDownloads([]);
    let failed = 0;
    for (const record of snapshot) {
      try { await removeDownload(record.itemId); }
      // Count failures but continue — registry is cleaned up by Rust even when file is gone.
      catch { failed++; }
    }
    if (failed === 0) {
      st.setToast({
        message: `All ${snapshot.length} download${snapshot.length !== 1 ? 's' : ''} removed`,
        type: 'success',
      });
    } else {
      st.setToast({
        message: `Removed ${snapshot.length - failed} of ${snapshot.length} — ${failed} already gone`,
        type: 'info',
      });
    }
  };

  return (
    <div>
      <SectionHead title="Downloads" subtitle="Offline copies and cache." />

      {/* Total storage used — pill in lieu of a hard cache limit (none configured). */}
      {totalBytes > 0 && (
        <div style={{ marginBottom: 4 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', padding: '4px 10px', borderRadius: 6,
            background: 'var(--onyx-accent-dim)', border: '1px solid var(--onyx-accent-edge)', color: 'var(--onyx-accent)',
            fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase',
          }}>{fmtSize(totalBytes)} used</span>
        </div>
      )}

      {/* ── Storage locations ────────────────────────────────────────────── */}
      {/* Two independently relocatable roots (Onboarding roadmap, Resolved #1):
          downloaded audio, and the cover/library cache. */}
      <Panel label="Storage">
        <Row label="Downloads folder" hint="Where downloaded audio files are stored on this device.">
          <StorageControls
            value={downloadsDir}
            busy={relocating === 'downloads'}
            onOpen={() => revealDownloadsDir().catch(e => log.error('downloads', 'reveal downloads folder failed', { err: String(e) }))}
            onChange={() => relocate('downloads')}
          />
        </Row>
        <Row label="Cache folder" hint="Where cover images and the offline library cache are kept.">
          <StorageControls
            value={coverCacheDir}
            busy={relocating === 'cache'}
            onOpen={() => { if (coverCacheDir) revealPath(coverCacheDir).catch(e => log.error('downloads', 'reveal cache folder failed', { err: String(e) })); }}
            onChange={() => relocate('cache')}
          />
        </Row>
      </Panel>

      {/* ── Downloading (only while transfers are active) ──────────────────── */}
      {inProgress.size > 0 && (
        <Panel label="Downloading">
          {Array.from(inProgress.entries()).map(([itemId, { title, bytesDownloaded, totalBytes: total }], i, arr) => {
            // pct is null when the server didn't send Content-Length — shows indeterminate bar.
            const pct = total > 0 ? Math.min(100, (bytesDownloaded / total) * 100) : null;
            return (
              <div
                key={itemId}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--onyx-line)' : 'none', gap: 12,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--onyx-text)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 6 }}>
                    {title}
                  </div>
                  <div style={{ height: 3, borderRadius: 2, background: 'var(--onyx-glass-edge)', overflow: 'hidden' }}>
                    {pct !== null ? (
                      <div style={{ height: '100%', width: `${pct}%`, background: 'var(--onyx-accent)', borderRadius: 2, transition: 'width 0.2s ease' }} />
                    ) : (
                      <div style={{ height: '100%', width: '40%', background: 'var(--onyx-accent)', borderRadius: 2, animation: 'onyx-indeterminate 1.4s ease-in-out infinite' }} />
                    )}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 11, color: 'var(--onyx-text-mute)', fontFamily: MONO }}>
                    {total > 0 ? `${fmtSize(bytesDownloaded)} / ${fmtSize(total)}` : fmtSize(bytesDownloaded)}
                  </div>
                </div>
                <button
                  onClick={() => cancelDownload(itemId).catch(e => log.error('downloads', 'cancelDownload failed', { itemId, err: String(e) }))}
                  title={`Cancel download of "${title}"`}
                  style={{
                    flexShrink: 0, padding: '6px 13px', fontSize: 10, fontFamily: MONO, letterSpacing: '0.08em',
                    textTransform: 'uppercase' as const, background: 'transparent',
                    border: '1px solid var(--onyx-glass-edge)', borderRadius: 6, color: 'var(--onyx-text-dim)', cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            );
          })}
        </Panel>
      )}

      {/* ── Downloaded books ───────────────────────────────────────────────── */}
      <Panel
        label="Download history"
        action={
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            {records.length > 1 && (
              <select aria-label="Sort download history" value={historySort} onChange={event => { const value = event.target.value as typeof historySort; setHistorySort(value); localStorage.setItem('onyx.downloads.historySort', value); }} style={{ padding: '4px 7px', borderRadius: 5, border: '1px solid var(--onyx-glass-edge)', background: 'var(--onyx-glass)', color: 'var(--onyx-text-dim)', fontFamily: MONO, fontSize: 9.5 }}>
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="largest">Largest</option>
              </select>
            )}
            <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', letterSpacing: '0.04em' }}>{records.length} book{records.length === 1 ? '' : 's'}</span>
          </div>
        }
      >
        {records.length === 0 ? (
          <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--onyx-text-mute)', fontSize: 12, fontFamily: MONO, letterSpacing: '0.04em' }}>
            No downloads yet.
          </div>
        ) : (
          <>
            {sortedRecords.map((record, i) => {
              // Full library item for the cover; may be undefined if removed server-side.
              const libraryItem = st.library.find(b => b.id === record.itemId);
              return (
                <div
                  key={record.itemId}
                  style={{ display: 'flex', alignItems: 'center', padding: '13px 0', borderBottom: i < sortedRecords.length - 1 ? '1px solid var(--onyx-line)' : 'none', gap: 14 }}
                >
                  {/* Cover thumbnail */}
                  <div style={{ flexShrink: 0, width: 52, height: 52, borderRadius: 6, overflow: 'hidden', background: 'var(--onyx-glass)' }}>
                    {libraryItem ? (
                      <Cover item={libraryItem} size={52} serverUrl={st.serverUrl} />
                    ) : (
                      <div style={{ width: 52, height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: 16, fontWeight: 600, color: 'var(--onyx-text-mute)' }}>
                        {record.title.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>

                  {/* Title + author + size/date chips */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: SERIF, fontSize: 15, fontWeight: 500, color: 'var(--onyx-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2 }}>
                      {record.title}
                    </div>
                    <div style={{ marginTop: 2, fontSize: 12, color: 'var(--onyx-text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {record.author || 'Unknown Author'}
                    </div>
                    <div style={{ marginTop: 7, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <Chip>{fmtSize(record.fileSize)}</Chip>
                      <Chip><time dateTime={new Date(record.downloadedAt).toISOString()} title={new Date(record.downloadedAt).toLocaleString()}>{relativeTime(record.downloadedAt)}</time></Chip>
                      <button onClick={() => revealPath(record.filePath).catch(e => log.error('downloads', 'reveal downloaded file failed', { itemId: record.itemId, err: String(e) }))} title={record.filePath} style={{ padding: '2px 7px', borderRadius: 5, border: '1px solid var(--onyx-glass-edge)', background: 'transparent', color: 'var(--onyx-text-dim)', cursor: 'pointer', fontFamily: MONO, fontSize: 10 }}>Open location</button>
                    </div>
                    {/* Server-deleted warning — local copy retained and still playable offline. */}
                    {record.serverDeleted && (
                      <div style={{ marginTop: 5, fontSize: 10, color: '#d4834a', fontFamily: MONO, letterSpacing: '0.04em' }}>
                        ⚠ No longer on server — local copy only
                      </div>
                    )}
                  </div>

                  {/* Delete (danger) */}
                  <button
                    onClick={() => setPendingDelete(record)}
                    title={`Remove "${record.title}" from downloads`}
                    style={{
                      flexShrink: 0, padding: '6px 13px', fontSize: 10, fontFamily: MONO, letterSpacing: '0.08em',
                      textTransform: 'uppercase' as const, background: 'rgba(220,80,80,0.12)',
                      border: '1px solid rgba(220,80,80,0.35)', borderRadius: 6, color: '#e08a8a', cursor: 'pointer',
                    }}
                  >
                    Delete
                  </button>
                </div>
              );
            })}

            {/* Clear all footer */}
            <div style={{ marginTop: 6, paddingTop: 13, borderTop: '1px solid var(--onyx-line)', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setPendingClearAll(true)}
                style={{
                  padding: '7px 15px', fontSize: 10, fontFamily: MONO, letterSpacing: '0.08em',
                  textTransform: 'uppercase' as const, background: 'rgba(220,80,80,0.12)',
                  border: '1px solid rgba(220,80,80,0.35)', borderRadius: 6, color: '#e08a8a', cursor: 'pointer',
                }}
              >
                Clear all downloads
              </button>
            </div>
          </>
        )}
      </Panel>

      {/* ── Behaviour ──────────────────────────────────────────────────────── */}
      <Panel label="Behaviour">
        <Row label="Auto-download next in series" hint="When you finish a book, automatically download the next one in its series (server libraries only).">
          <Toggle on={autoNextInSeries} onChange={setAutoNextInSeries} />
        </Row>
        <Row label="Keep downloads after finishing" hint="Keep the local file when you finish a book. Turn off to free space by removing it automatically.">
          <Toggle on={keepAfterFinish} onChange={setKeepAfterFinish} />
        </Row>
      </Panel>

      {/* ── Confirmation dialogs ─────────────────────────────────────────────── */}

      {/* Individual delete confirmation */}
      {pendingDelete && (
        <ConfirmDialog
          title={`Delete "${pendingDelete.title}"`}
          message={`This will remove the downloaded audio file (${fmtSize(pendingDelete.fileSize)}) from your device. The book will still be available for streaming from your server.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {/* Clear all confirmation */}
      {pendingClearAll && (
        <ConfirmDialog
          title="Clear all downloads?"
          message="This will delete all downloaded audio files from your device. This cannot be undone."
          confirmLabel="Clear All"
          danger
          onConfirm={handleConfirmClearAll}
          onCancel={() => setPendingClearAll(false)}
        />
      )}
    </div>
  );
}
