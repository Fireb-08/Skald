// Floating progress bars for active downloads.
// Listens for download-progress, download-complete, download-cancelled, and
// download-failed events emitted by the Rust streaming loop.
// The outer container uses pointerEvents:'none' to avoid blocking clicks on
// content behind it; each individual card re-enables pointer events so the
// cancel button remains clickable.
import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { cancelDownload, downloadItem, downloadEpisode } from '../../api/abs';
import { log } from '../../lib/log';

const MONO = "'JetBrains Mono', ui-monospace, monospace";

// Cards are keyed by (itemId, episodeId) so a podcast's sibling episodes — which
// share one itemId — never overwrite each other's card. Books have no episodeId.
const dlKey = (itemId: string, episodeId?: string | null): string =>
  episodeId ? `${itemId}|${episodeId}` : itemId;

// Shape of a single active download tracked in local state. Carries the identity
// so the cancel button can address the right (item, episode).
interface ProgressEntry {
  itemId: string;
  episodeId?: string | null;
  title: string;
  bytesDownloaded: number;
  totalBytes: number; // 0 when the server did not send Content-Length
}

// Mirrors the Rust serde_json payload for "download-progress".
interface DownloadProgressPayload {
  itemId: string;
  episodeId?: string | null;
  title: string;
  bytesDownloaded: number;
  totalBytes: number;
}

// Mirrors the Rust serde_json payload for "download-complete" and
// "download-cancelled" (same shape — both carry itemId and title).
interface DownloadDonePayload {
  itemId: string;
  episodeId?: string | null;
  title: string;
}

// Mirrors the Rust serde_json payload for "download-failed". For an episode
// failure the payload also carries ino/fileName so RETRY can re-issue the
// episode download (books omit them and rebuild from the title).
interface DownloadFailedPayload {
  itemId: string;
  episodeId?: string | null;
  title: string;
  error: string;
  ino?: string | null;
  fileName?: string | null;
}

export interface DownloadProgressToastProps {
  serverUrl: string;
  // Called when a download completes so the caller can show a success toast.
  onComplete: (title: string) => void;
  // Called when the user cancels a download so the caller can show an info toast.
  onCancel: (title: string) => void;
  // Called when a download fails due to a network or write error.
  onFailed: (title: string, error: string) => void;
}

// Format a byte count as a human-readable string (KB / MB / GB).
function fmtBytes(n: number): string {
  if (n === 0) return '0 B';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function DownloadProgressToast({ serverUrl, onComplete, onCancel, onFailed }: DownloadProgressToastProps) {
  // Map of itemId → current progress info; each entry renders as its own card.
  const [downloads, setDownloads] = useState<Map<string, ProgressEntry>>(new Map());
  const [failed, setFailed] = useState<Map<string, DownloadFailedPayload>>(new Map());

  useEffect(() => {
    let unlistenProgress:   (() => void) | undefined;
    let unlistenComplete:   (() => void) | undefined;
    let unlistenCancelled:  (() => void) | undefined;
    let unlistenFailed:     (() => void) | undefined;

    // Update the progress bar on every chunk that arrives from Rust.
    listen<DownloadProgressPayload>('download-progress', event => {
      const { itemId, episodeId, title, bytesDownloaded, totalBytes } = event.payload;
      const key = dlKey(itemId, episodeId);
      setDownloads(prev => {
        const next = new Map(prev);
        next.set(key, { itemId, episodeId, title, bytesDownloaded, totalBytes });
        return next;
      });
      setFailed(prev => { const next = new Map(prev); next.delete(key); return next; });
    }).then(fn => { unlistenProgress = fn; });

    // Remove the completed entry and fire the success callback.
    listen<DownloadDonePayload>('download-complete', event => {
      const { itemId, episodeId, title } = event.payload;
      setDownloads(prev => {
        const next = new Map(prev);
        next.delete(dlKey(itemId, episodeId));
        return next;
      });
      onComplete(title);
    }).then(fn => { unlistenComplete = fn; });

    // Remove the cancelled entry and fire the cancel callback for the info toast.
    listen<DownloadDonePayload>('download-cancelled', event => {
      const { itemId, episodeId, title } = event.payload;
      setDownloads(prev => {
        const next = new Map(prev);
        next.delete(dlKey(itemId, episodeId));
        return next;
      });
      onCancel(title);
    }).then(fn => { unlistenCancelled = fn; });

    // Remove the failed entry and fire the error callback.
    listen<DownloadFailedPayload>('download-failed', event => {
      const { itemId, episodeId, title, error } = event.payload;
      const key = dlKey(itemId, episodeId);
      setDownloads(prev => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      setFailed(prev => { const next = new Map(prev); next.set(key, event.payload); return next; });
      onFailed(title, error);
    }).then(fn => { unlistenFailed = fn; });

    return () => {
      unlistenProgress?.();
      unlistenComplete?.();
      unlistenCancelled?.();
      unlistenFailed?.();
    };
  // Callbacks are defined inline in App.tsx; including them in deps would cause
  // a re-subscribe loop on every render — the closures capture stable st.setToast.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Nothing to render while no downloads are in flight.
  if (downloads.size === 0 && failed.size === 0) return null;

  return (
    // Stack above the regular toast (bottom: 24) so they don't overlap.
    // pointerEvents:'none' on the container lets clicks pass through to content
    // behind the toast area; individual cards re-enable pointer events.
    <div style={{
      position: 'fixed',
      bottom: 88,
      right: 24,
      zIndex: 998,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      pointerEvents: 'none',
    }}>
      {Array.from(downloads.entries()).map(([key, { itemId, episodeId, title, bytesDownloaded, totalBytes }]) => {
        // pct is null when Content-Length was absent — frontend shows indeterminate bar.
        const pct = totalBytes > 0
          ? Math.min(100, (bytesDownloaded / totalBytes) * 100)
          : null;

        return (
          // Re-enable pointer events on the card itself so the cancel button works.
          <div key={key} style={{
            minWidth: 260,
            maxWidth: 420,
            background: 'var(--onyx-panel2)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid var(--onyx-glass-edge)',
            borderLeft: '3px solid var(--onyx-accent)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            padding: '11px 14px',
            pointerEvents: 'auto', // re-enable so the cancel button is clickable
          }}>
            {/* Title row — book name on the left, cancel button on the right */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              marginBottom: 8,
            }}>
              <div style={{
                fontSize: 13,
                color: 'var(--onyx-text)',
                fontWeight: 500,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                flex: 1,
                minWidth: 0,
              }}>
                Downloading "{title}"
              </div>

              {/* Cancel button — calls cancel_download on the Rust side; the
                  download-cancelled event will dismiss this card once the partial
                  file has been cleaned up. */}
              <button
                onClick={() => cancelDownload(itemId, episodeId ?? undefined).catch(e => log.error('downloads', 'cancelDownload failed', { itemId, episodeId, err: String(e) }))}
                title="Cancel download"
                style={{
                  flexShrink: 0,
                  width: 22,
                  height: 22,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'transparent',
                  border: '1px solid var(--onyx-glass-edge)',
                  borderRadius: 4,
                  color: 'var(--onyx-text-mute)',
                  fontSize: 12,
                  cursor: 'pointer',
                  padding: 0,
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>

            {/* Progress bar track */}
            <div style={{
              height: 4,
              borderRadius: 2,
              background: 'var(--onyx-glass-edge)',
              overflow: 'hidden',
              marginBottom: 6,
            }}>
              {pct !== null ? (
                // Determinate: grows left-to-right as bytes arrive.
                <div style={{
                  height: '100%',
                  width: `${pct}%`,
                  background: 'var(--onyx-accent)',
                  borderRadius: 2,
                  transition: 'width 0.2s ease',
                }} />
              ) : (
                // Indeterminate: sliding shimmer when Content-Length was unknown.
                <div style={{
                  height: '100%',
                  width: '40%',
                  background: 'var(--onyx-accent)',
                  borderRadius: 2,
                  animation: 'onyx-indeterminate 1.4s ease-in-out infinite',
                }} />
              )}
            </div>

            {/* Byte counter — "245.0 MB / 604.0 MB" or just "245.0 MB" for unknown total */}
            <div style={{ fontSize: 11, color: 'var(--onyx-text-mute)', fontFamily: MONO }}>
              {totalBytes > 0
                ? `${fmtBytes(bytesDownloaded)} / ${fmtBytes(totalBytes)}`
                : fmtBytes(bytesDownloaded)}
            </div>
          </div>
        );
      })}
      {Array.from(failed.entries()).map(([key, entry]) => (
        <div key={key} style={{ minWidth: 260, maxWidth: 420, background: 'var(--onyx-panel2)', border: '1px solid rgba(220,100,100,0.45)', borderRadius: 8, padding: '11px 14px', pointerEvents: 'auto' }}>
          <div style={{ fontSize: 13, color: 'var(--onyx-text)', marginBottom: 7 }}>Download failed: “{entry.title}”</div>
          <button onClick={() => {
            setFailed(prev => { const next = new Map(prev); next.delete(key); return next; });
            // Episode retries re-issue the per-file episode download (needs the
            // echoed ino + fileName); book retries rebuild the whole-item ZIP.
            const retry = entry.episodeId && entry.ino
              ? downloadEpisode(serverUrl, entry.itemId, entry.episodeId, entry.ino, entry.fileName ?? `${entry.title}.mp3`, entry.title, '')
              : downloadItem(serverUrl, entry.itemId, `${entry.title}.zip`, entry.title, '');
            retry.catch(e => log.error('downloads', 'retry download command failed', { itemId: entry.itemId, episodeId: entry.episodeId, err: String(e) }));
          }} style={{ padding: '5px 10px', borderRadius: 5, border: '1px solid var(--onyx-accent-edge)', background: 'var(--onyx-accent-dim)', color: 'var(--onyx-accent)', cursor: 'pointer', fontFamily: MONO, fontSize: 10 }}>RETRY</button>
        </div>
      ))}
    </div>
  );
}
