import { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { OnyxState } from '../../state/onyx';
import {
  getCacheDir, revealCacheDir, getDownloads, removeDownload, cancelDownload,
} from '../../api/abs';
import type { DownloadRecord } from '../../api/abs';
import ConfirmDialog from '../ui/ConfirmDialog';
import { SectionHead, Row, MONO } from './shared';

// Format bytes as KB / MB / GB for the size column and storage total.
function fmtSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Return a human-friendly relative time string from a Unix-ms timestamp.
function relativeTime(ms: number): string {
  const diff = (Date.now() - ms) / 1000; // elapsed seconds
  if (diff < 60) return 'just now';
  const minutes = Math.floor(diff / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

// Tracks a single active download for the In Progress section.
interface InProgressEntry {
  title: string;
  bytesDownloaded: number;
  totalBytes: number; // 0 when Content-Length was absent — renders indeterminate bar
}

interface Props { st: OnyxState; }

export default function DownloadsSection({ st }: Props) {
  const [cacheDir, setCacheDir] = useState('');
  const [records, setRecords] = useState<DownloadRecord[]>([]);
  // The record currently pending deletion — drives the ConfirmDialog.
  const [pendingDelete, setPendingDelete] = useState<DownloadRecord | null>(null);

  // Active downloads keyed by itemId — populated by download-progress events.
  // Entries disappear when the corresponding download completes or is cancelled.
  const [inProgress, setInProgress] = useState<Map<string, InProgressEntry>>(new Map());

  // Load cache dir and completed downloads once on mount.
  useEffect(() => {
    getCacheDir().then(setCacheDir).catch(console.error);
    getDownloads().then(setRecords).catch(console.error);
  }, []);

  // Subscribe to download lifecycle events to drive the In Progress section.
  useEffect(() => {
    let unlistenProgress:  (() => void) | undefined;
    let unlistenComplete:  (() => void) | undefined;
    let unlistenCancelled: (() => void) | undefined;
    let unlistenFailed:    (() => void) | undefined;

    // Each chunk from Rust adds or updates an entry in the in-progress map.
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

    // On completion, remove from in-progress and re-fetch the registry so the
    // newly completed download appears immediately in the completed list.
    listen<{ itemId: string }>('download-complete', event => {
      const { itemId } = event.payload;
      setInProgress(prev => {
        const next = new Map(prev);
        next.delete(itemId);
        return next;
      });
      // Re-fetch so the completed list reflects the registry without a page reload.
      getDownloads().then(setRecords).catch(console.error);
    }).then(fn => { unlistenComplete = fn; });

    // Cancelled or failed downloads simply disappear from the in-progress section.
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
  }, []); // register once per mount; setInProgress/setRecords are stable

  // Sum file sizes across all completed records for the section subtitle.
  const totalBytes = records.reduce((sum, r) => sum + r.fileSize, 0);
  const storageLabel = totalBytes > 0 ? ` — ${fmtSize(totalBytes)} used` : '';

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    const record = pendingDelete;
    setPendingDelete(null);
    // Remove from local state immediately — the Rust side always removes the
    // registry entry even when the file is gone, so the UI stays consistent.
    setRecords(prev => prev.filter(r => r.itemId !== record.itemId));
    try {
      await removeDownload(record.itemId);
      st.setToast({ message: `"${record.title}" removed from downloads`, type: 'success' });
    } catch {
      // File was already deleted outside the app — registry was still cleaned up.
      st.setToast({ message: `"${record.title}" was already gone — removed from list`, type: 'info' });
    }
  };

  return (
    <div>
      <SectionHead title="Downloads" subtitle={`Offline copies and cache${storageLabel}.`} />

      {/* Cache location row */}
      <Row label="Cache location" hint={cacheDir || 'Loading…'}>
        <button
          onClick={() => revealCacheDir().catch(console.error)}
          style={{
            padding: '6px 14px',
            fontSize: 11,
            fontFamily: MONO,
            letterSpacing: '0.06em',
            textTransform: 'uppercase' as const,
            background: 'var(--onyx-glass)',
            border: '1px solid var(--onyx-glass-edge)',
            borderRadius: 6,
            color: 'var(--onyx-text-dim)',
            cursor: 'pointer',
          }}
        >
          Reveal
        </button>
      </Row>

      {/* ── In Progress section ───────────────────────────────────────────────
          Only rendered when at least one download is actively streaming.
          Each row shows the book title, a compact progress bar, and a cancel
          button that calls cancel_download on the Rust side. */}
      {inProgress.size > 0 && (
        <div>
          {/* Sub-section label */}
          <div style={{
            marginTop: 20,
            marginBottom: 4,
            fontSize: 11,
            fontFamily: MONO,
            letterSpacing: '0.08em',
            textTransform: 'uppercase' as const,
            color: 'var(--onyx-text-mute)',
          }}>
            In Progress
          </div>

          {Array.from(inProgress.entries()).map(([itemId, { title, bytesDownloaded, totalBytes: total }]) => {
            // pct is null when Content-Length was absent — shows indeterminate animation.
            const pct = total > 0
              ? Math.min(100, (bytesDownloaded / total) * 100)
              : null;

            return (
              <div
                key={itemId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 0',
                  borderBottom: '1px solid var(--onyx-line)',
                  gap: 12,
                }}
              >
                {/* Title + progress bar + byte counter */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13,
                    color: 'var(--onyx-text)',
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    marginBottom: 6,
                  }}>
                    {title}
                  </div>

                  {/* Compact progress bar track */}
                  <div style={{
                    height: 3,
                    borderRadius: 2,
                    background: 'var(--onyx-glass-edge)',
                    overflow: 'hidden',
                  }}>
                    {pct !== null ? (
                      // Determinate: bar grows left-to-right as bytes arrive.
                      <div style={{
                        height: '100%',
                        width: `${pct}%`,
                        background: 'var(--onyx-accent)',
                        borderRadius: 2,
                        transition: 'width 0.2s ease',
                      }} />
                    ) : (
                      // Indeterminate: sliding shimmer when Content-Length absent.
                      <div style={{
                        height: '100%',
                        width: '40%',
                        background: 'var(--onyx-accent)',
                        borderRadius: 2,
                        animation: 'onyx-indeterminate 1.4s ease-in-out infinite',
                      }} />
                    )}
                  </div>

                  {/* Byte counter below the bar */}
                  <div style={{
                    marginTop: 4,
                    fontSize: 11,
                    color: 'var(--onyx-text-mute)',
                    fontFamily: MONO,
                  }}>
                    {total > 0
                      ? `${fmtSize(bytesDownloaded)} / ${fmtSize(total)}`
                      : fmtSize(bytesDownloaded)}
                  </div>
                </div>

                {/* Cancel button — signals Rust to abort on the next chunk boundary.
                    The download-cancelled event removes the row once the partial file
                    has been deleted. */}
                <button
                  onClick={() => cancelDownload(itemId).catch(console.error)}
                  title={`Cancel download of "${title}"`}
                  style={{
                    flexShrink: 0,
                    padding: '5px 12px',
                    fontSize: 11,
                    fontFamily: MONO,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase' as const,
                    background: 'transparent',
                    border: '1px solid var(--onyx-glass-edge)',
                    borderRadius: 6,
                    color: 'var(--onyx-text-dim)',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Completed downloads list ──────────────────────────────────────────
          Populated from the persistent downloads registry on mount and on each
          download-complete event. */}
      {records.length === 0 && inProgress.size === 0 ? (
        // Empty state — shown when nothing is downloaded or downloading.
        <div style={{
          padding: '40px 0',
          textAlign: 'center',
          color: 'var(--onyx-text-mute)',
          fontSize: 13,
          fontFamily: MONO,
          letterSpacing: '0.04em',
        }}>
          No downloads yet
        </div>
      ) : records.length > 0 ? (
        records.map(record => (
          <div
            key={record.itemId}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 0',
              borderBottom: '1px solid var(--onyx-line)',
              gap: 16,
            }}
          >
            {/* Book info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 13.5,
                color: 'var(--onyx-text)',
                fontWeight: 500,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {record.title}
              </div>
              <div style={{
                marginTop: 3,
                fontSize: 11.5,
                color: 'var(--onyx-text-mute)',
                fontFamily: MONO,
                display: 'flex',
                gap: 10,
              }}>
                {/* Author — shows "Unknown Author" if blank */}
                <span>{record.author || 'Unknown Author'}</span>
                <span style={{ color: 'var(--onyx-line)' }}>·</span>
                {/* File size */}
                <span>{fmtSize(record.fileSize)}</span>
                <span style={{ color: 'var(--onyx-line)' }}>·</span>
                {/* Relative download date */}
                <span>{relativeTime(record.downloadedAt)}</span>
              </div>
            </div>

            {/* Delete button — opens the ConfirmDialog before acting */}
            <button
              onClick={() => setPendingDelete(record)}
              title={`Remove "${record.title}" from downloads`}
              style={{
                flexShrink: 0,
                padding: '5px 12px',
                fontSize: 11,
                fontFamily: MONO,
                letterSpacing: '0.06em',
                textTransform: 'uppercase' as const,
                background: 'transparent',
                border: '1px solid rgba(232,113,106,0.35)',
                borderRadius: 6,
                color: '#e8716a',
                cursor: 'pointer',
              }}
            >
              Delete
            </button>
          </div>
        ))
      ) : null}

      {/* Confirmation dialog — rendered when a delete button is clicked. */}
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
    </div>
  );
}
