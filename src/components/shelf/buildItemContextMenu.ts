import { bookAuthor, type LibraryItem, type OnyxState, type MediaProgress } from '../../state/onyx';
import type { ContextMenuItem } from '../ContextMenu';
import { updateProgress, deleteProgress, getMe, closeActiveSession, rescanItem, deleteItem, downloadItem } from '../../api/abs';
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

  const refreshProgress = async () => {
    try {
      const me = await getMe(st.serverUrl);
      st.setMediaProgress(me.mediaProgress);
    } catch (e) {
      console.error('[ctx] refresh progress failed:', e);
    }
  };

  const items: ContextMenuItem[] = [
    {
      // Phase B: fires the Rust streaming command with title and author so the
      // progress toast and downloads registry both have the metadata they need.
      // The info and success toasts are now handled by DownloadProgressToast via
      // the download-progress / download-complete Tauri events.
      label: 'Download',
      onClick: () => {
        const title = item.media?.metadata?.title ?? item.id;
        const author = bookAuthor(item);
        // ABS serves multi-file audiobooks as a zip archive at this endpoint.
        const fileName = `${title}.zip`;
        downloadItem(st.serverUrl, item.id, fileName, title, author)
          .then(path => {
            // Log the resolved path for debug purposes; the success toast is
            // triggered by DownloadProgressToast via the download-complete event.
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
      onClick: async () => {
        try {
          await deleteProgress(st.serverUrl, item.id);
          await refreshProgress();
        } catch (e) {
          console.error('[ctx] delete progress failed:', e);
        }
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
