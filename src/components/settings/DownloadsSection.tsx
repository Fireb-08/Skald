import { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { OnyxState } from '../../state/onyx';
import {
  getCacheDir, revealCacheDir, getDownloads, removeDownload, cancelDownload,
} from '../../api/abs';
import type { DownloadRecord } from '../../api/abs';
import ConfirmDialog from '../ui/ConfirmDialog';
import Cover from '../Cover';
import { SectionHead, Row, MONO, SERIF, Panel } from './shared';

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

// Muted outline badge used in a panel header (e.g. "Coming soon").
function MutedBadge({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontFamily: MONO, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase',
      color: 'var(--onyx-text-mute)', border: '1px solid var(--onyx-line)', borderRadius: 4, padding: '3px 8px',
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

// Small pill badge for features that are planned but not yet implemented.
function WipBadge() {
  return (
    <span style={{
      fontFamily: MONO,
      fontSize: 9,
      letterSpacing: '0.08em',
      textTransform: 'uppercase' as const,
      color: 'var(--onyx-text-mute)',
      border: '1px solid var(--onyx-line)',
      borderRadius: 4,
      padding: '2px 6px',
    }}>
      WIP
    </span>
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
  const [cacheDir, setCacheDir] = useState('');
  // Local copy of the registry, kept in sync with Rust on mount and on events.
  const [records, setRecords] = useState<DownloadRecord[]>([]);
  // Record awaiting individual delete confirmation.
  const [pendingDelete, setPendingDelete] = useState<DownloadRecord | null>(null);
  // True when the "clear all" confirmation dialog is open.
  const [pendingClearAll, setPendingClearAll] = useState(false);
  // Active transfers keyed by itemId — populated/cleared by download-progress events.
  const [inProgress, setInProgress] = useState<Map<string, InProgressEntry>>(new Map());

  // Load cache dir path and completed downloads on mount.
  useEffect(() => {
    getCacheDir().then(setCacheDir).catch(console.error);
    getDownloads().then(setRecords).catch(console.error);
  }, []);

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
      getDownloads().then(setRecords).catch(console.error);
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

      {/* ── Cache ────────────────────────────────────────────────────────── */}
      <Panel label="Cache">
        <Row label="Location" hint="Where downloaded audio files are stored on this device.">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              readOnly
              value={cacheDir || 'Loading…'}
              onFocus={e => e.currentTarget.select()}
              title={cacheDir}
              style={{
                fontFamily: MONO, fontSize: 11, background: 'rgba(0,0,0,0.3)',
                border: '1px solid var(--onyx-glass-edge)', borderRadius: 7, color: 'var(--onyx-text-dim)',
                padding: '7px 10px', width: 300, maxWidth: '38vw', outline: 'none',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            />
            <button
              onClick={() => revealCacheDir().catch(console.error)}
              style={{
                padding: '7px 14px', fontSize: 10, fontFamily: MONO, letterSpacing: '0.08em',
                textTransform: 'uppercase' as const, background: 'transparent',
                border: '1px solid var(--onyx-glass-edge)', borderRadius: 6, color: 'var(--onyx-text-dim)', cursor: 'pointer',
              }}
            >
              Reveal
            </button>
          </div>
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
                  onClick={() => cancelDownload(itemId).catch(console.error)}
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
        label="Downloaded books"
        action={
          <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', letterSpacing: '0.04em' }}>
            {records.length} book{records.length === 1 ? '' : 's'}
          </span>
        }
      >
        {records.length === 0 ? (
          <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--onyx-text-mute)', fontSize: 12, fontFamily: MONO, letterSpacing: '0.04em' }}>
            No downloads yet.
          </div>
        ) : (
          <>
            {records.map((record, i) => {
              // Full library item for the cover; may be undefined if removed server-side.
              const libraryItem = st.library.find(b => b.id === record.itemId);
              return (
                <div
                  key={record.itemId}
                  style={{ display: 'flex', alignItems: 'center', padding: '13px 0', borderBottom: i < records.length - 1 ? '1px solid var(--onyx-line)' : 'none', gap: 14 }}
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
                      <Chip>{relativeTime(record.downloadedAt)}</Chip>
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

      {/* ── Behaviour (planned) ────────────────────────────────────────────── */}
      <Panel label="Behaviour" action={<MutedBadge>Coming soon</MutedBadge>}>
        <Row label="Auto-download next in series" hint="Automatically queue the next book when you finish one.">
          <WipBadge />
        </Row>
        <Row label="Keep downloads after finishing" hint="Retain the local file instead of removing it on completion.">
          <WipBadge />
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
