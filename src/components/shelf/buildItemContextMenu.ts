import { bookAuthor, type LibraryItem, type OnyxState, type MediaProgress } from '../../state/onyx';
import type { ContextMenuItem } from '../ContextMenu';
import { updateProgress, deleteProgress, closeActiveSession, rescanItem, deleteItem, downloadItem, removeDownload } from '../../api/abs';
// Canonical play function — routes through shared resume and UI-sync logic
import { playBook } from '../../api/playbook';

// Guard against double-invocation (React portal event bubbling / StrictMode).
const pendingItems = new Set<string>();

export function buildItemContextMenu(
  item: LibraryItem,
  st: OnyxState,
  setMatchItem?: (item: LibraryItem) => void,
  setCollectionItem?: (item: LibraryItem) => void,
  setFilesItem?: (item: LibraryItem) => void,
): ContextMenuItem[] {
  const isAdmin = st.user?.type === 'root' || st.user?.type === 'admin';
  // Used to toggle the first menu item between Download and Delete Download.
  // Prevents duplicate downloads and gives a shelf-level management action.
  const existingDownload = st.downloads.find(d => d.itemId === item.id);

  const items: ContextMenuItem[] = [
    existingDownload
      ? {
          // Already downloaded — offer deletion so the user can free up space directly
          // from the shelf without navigating to Settings → Downloads.
          label: 'Delete Download',
          danger: true,
          onClick: () => {
            const title = item.media?.metadata?.title ?? item.id;
            st.setConfirmDialog({
              title: `Delete downloaded copy of "${title}"?`,
              message: 'This will remove the local audio file from your device. The book will still be available for streaming from your server.',
              confirmLabel: 'Delete',
              onConfirm: async () => {
                try {
                  await removeDownload(item.id);
                  // Sync global downloads state so the badge and playback router
                  // reflect the change immediately without a page reload.
                  st.setDownloads(prev => prev.filter(d => d.itemId !== item.id));
                  st.setToast({ message: `Downloaded copy of "${title}" removed`, type: 'success' });
                } catch (e) {
                  st.setToast({ message: `Delete failed: ${String(e)}`, type: 'error' });
                }
              },
            });
          },
        }
      : {
          // Not yet downloaded — fires the Rust streaming command.
          // Progress toasts come from DownloadProgressToast via Tauri events.
          label: 'Download',
          onClick: () => {
            const title = item.media?.metadata?.title ?? item.id;
            const author = bookAuthor(item);
            // ABS serves multi-file audiobooks as a zip archive at this endpoint.
            const fileName = `${title}.zip`;
            downloadItem(st.serverUrl, item.id, fileName, title, author)
              .then(path => {
                console.log('[download] completed:', path);
              })
              .catch(e => {
                console.error('[download] failed:', e);
                st.setToast({ message: `Download failed: ${String(e)}`, type: 'error' });
              });
          },
        },
    {
      label: 'Play Book',
      onClick: async () => {
        const title = item.media?.metadata?.title ?? item.id;
        try {
          // Delegate session teardown, resume-position lookup, session open,
          // UI sync, and playAudio to the canonical playBook function.
          await playBook(st, item.id);
          st.setToast({ message: `Now playing "${title}"`, type: 'success' });
        } catch (e) {
          st.setToast({ message: `Failed to start playback: ${String(e)}`, type: 'error' });
        }
      },
    },
    {
      label: 'Mark as Finished',
      onClick: async () => {
        if (pendingItems.has(item.id)) return;
        pendingItems.add(item.id);
        try {
          // Immediate optimistic update — UI responds before server round-trip.
          const existing = st.mediaProgress.find(p => p.libraryItemId === item.id);
          const optimistic: MediaProgress = {
            id: existing?.id ?? item.id,
            libraryItemId: item.id,
            episodeId: existing?.episodeId ?? null,
            duration: item.media.duration,
            progress: 1,
            currentTime: item.media.duration,
            isFinished: true,
            lastUpdate: Date.now(),
          };
          st.setMediaProgress(
            existing
              ? st.mediaProgress.map(p => p.libraryItemId === item.id ? optimistic : p)
              : [...st.mediaProgress, optimistic],
          );
          await closeActiveSession().catch(() => {}); // no-op if no session open
          st.setSessionReady(false); // force fresh session on next play
          st.setSessionId('');
          st.setPlaying(false);
          updateProgress(st.serverUrl, item.id, item.media.duration, item.media.duration, true)
            .catch(console.error);
        } catch (e) {
          console.error('[ctx] mark finished failed:', e);
        } finally {
          pendingItems.delete(item.id);
        }
      },
    },
    {
      label: 'Remove from Continue Listening',
      onClick: () => {
        // The DELETE endpoint requires the progress record's own id, not the library item id.
        const progressRecord = st.mediaProgress.find(p => p.libraryItemId === item.id);
        if (!progressRecord) {
          st.setToast({ message: 'No progress record found for this book.', type: 'info' });
          return;
        }
        const title = item.media?.metadata?.title ?? item.id;
        deleteProgress(st.serverUrl, progressRecord.id)
          .then(() => {
            st.setMediaProgress(st.mediaProgress.filter(p => p.id !== progressRecord.id));
            st.setToast({ message: `Removed "${title}" from Continue Listening`, type: 'success' });
          })
          .catch(e => {
            st.setToast({ message: `Failed to remove: ${String(e)}`, type: 'error' });
          });
      },
    },
  ];

  if (isAdmin) {
    items.push(
      { label: 'Add to Collection', onClick: () => setCollectionItem?.(item), disabled: !setCollectionItem },
      { label: 'Files',             onClick: () => setFilesItem?.(item),      disabled: !setFilesItem },
      {
        label: 'Re-Scan',
        onClick: () => {
          const title = item.media?.metadata?.title ?? item.id;
          rescanItem(st.serverUrl, item.id)
            .then(() => st.setToast({ message: `Rescan started for "${title}"`, type: 'success' }))
            .catch(e => st.setToast({ message: `Rescan failed: ${String(e)}`, type: 'error' }));
        },
      },
      { label: 'Match', onClick: () => setMatchItem?.(item), disabled: !setMatchItem },
      {
        label: 'Delete',
        danger: true,
        onClick: () => {
          const title = item.media?.metadata?.title ?? 'this item';
          st.setConfirmDialog({
            title: `Delete "${title}"`,
            message: 'This will permanently remove the item from the server. If file deletion is enabled on the server, the audio files will also be deleted from disk. This cannot be undone.',
            confirmLabel: 'Delete',
            onConfirm: () => {
              deleteItem(st.serverUrl, item.id)
                .then(() => {
                  st.removeLibraryItem(item.id);
                  st.setToast({ message: `"${title}" was deleted`, type: 'success' });
                })
                .catch(e => st.setToast({ message: `Delete failed: ${String(e)}`, type: 'error' }));
            },
          });
        },
      },
    );
  }

  return items;
}
