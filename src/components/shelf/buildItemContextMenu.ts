import { bookAuthor, type LibraryItem, type OnyxState, type MediaProgress } from '../../state/onyx';
import type { ContextMenuItem, ContextMenuSection } from '../ContextMenu';
import { updateProgress, deleteProgress, closeActiveSession, rescanItem, deleteItem, downloadItem, removeDownload, deleteLocalItem, setLocalProgress, seekAudio, pauseAudio } from '../../api/abs';
// Canonical play function — routes through shared resume and UI-sync logic
import { playBook } from '../../api/playbook';
import { log } from '../../lib/log';

// Guard against double-invocation (React portal event bubbling / StrictMode).
const pendingItems = new Set<string>();

// Builds the item right-click menu as labelled sections (PLAYBACK / ORGANIZE /
// MANAGE) with icons. The five admin "library tools" (edit / cover / match /
// files / re-scan) are collapsed into a single "Library tools" submenu.
type ItemSetter = (item: LibraryItem) => void;

export interface BuildItemContextMenuOpts {
  setMatchItem?: ItemSetter;
  setCollectionItem?: ItemSetter;
  setFilesItem?: ItemSetter;
  setPlaylistItem?: ItemSetter;
  setEditItem?: ItemSetter;
  setCoverItem?: ItemSetter;
  setShareItem?: ItemSetter;
  /** True only when the menu is opened from the Pick-it-up shelf — enables the
   *  "Remove from Pick it up" action, which is hidden on the main shelf. */
  fromPickItUp?: boolean;
}

export function buildItemContextMenu(
  item: LibraryItem,
  st: OnyxState,
  opts: BuildItemContextMenuOpts = {},
): ContextMenuSection[] {
  const {
    setMatchItem, setCollectionItem, setFilesItem, setPlaylistItem,
    setEditItem, setCoverItem, setShareItem, fromPickItUp,
  } = opts;
  const isAdmin = st.user?.type === 'root' || st.user?.type === 'admin';
  // Local-library items live on disk already (carry a localPath) — they get no
  // Download action, and their own Delete (files + catalog row) in Library tools.
  const isLocal = !!item.localPath;
  // Used to toggle the first menu item between Download and Delete Download.
  const existingDownload = st.downloads.find(d => d.itemId === item.id);

  // ── PLAYBACK ───────────────────────────────────────────────────────────────
  const playback: ContextMenuItem[] = [
    {
      label: 'Play Book',
      icon: 'play',
      primary: true,
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
    // Download/Delete-Download only applies to server items — local books are
    // already on disk, so the action is omitted for them.
    ...(isLocal ? [] : [
      existingDownload
        ? {
            // Already downloaded — offer deletion so the user can free up space directly
            // from the shelf without navigating to Settings → Downloads.
            label: 'Delete Download',
            icon: 'trash',
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
            label: 'Download',
            icon: 'download',
            onClick: () => {
              const title = item.media?.metadata?.title ?? item.id;
              const author = bookAuthor(item);
              // ABS serves multi-file audiobooks as a zip archive at this endpoint.
              const fileName = `${title}.zip`;
              downloadItem(st.serverUrl, item.id, fileName, title, author)
                // Item id only — no local paths or titles in the log stream.
                .then(() => log.info('downloads', 'download completed', { itemId: item.id }))
                .catch(e => {
                  log.error('downloads', 'download failed', { itemId: item.id, err: String(e) });
                  st.setToast({ message: `Download failed: ${String(e)}`, type: 'error' });
                });
            },
          },
    ] as ContextMenuItem[]),
    {
      label: 'Mark as Finished',
      icon: 'check-circle',
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
          if (item.localPath) {
            // Local-library item — persist to the catalog (no server session).
            // If this is the item playing right now, move the playhead to the end and
            // pause first: the local playback tick has no session to close, so without
            // this it would converge back on the live (earlier) position and undo the
            // finished flag. Seeking to the end makes the tick agree it's complete.
            if (st.currentBookId === item.id) {
              await seekAudio(item.media.duration).catch(() => {});
              await pauseAudio().catch(() => {});
              st.setPlaying(false);
            }
            setLocalProgress(item.id, item.media.duration, item.media.duration, true)
              .catch(console.error);
          } else {
            await closeActiveSession().catch(() => {}); // no-op if no session open
            st.setSessionReady(false); // force fresh session on next play
            st.setSessionId('');
            st.setPlaying(false);
            updateProgress(st.serverUrl, item.id, item.media.duration, item.media.duration, true)
              .catch(console.error);
          }
        } catch (e) {
          console.error('[ctx] mark finished failed:', e);
        } finally {
          pendingItems.delete(item.id);
        }
      },
    },
  ];

  // "Remove from Pick it up" is only meaningful when the menu is opened from the
  // Pick-it-up shelf — right-clicking the same book on the main shelf omits it.
  if (fromPickItUp) {
    playback.push({
      label: 'Remove from Pick it up',
      icon: 'clock',
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
            st.setToast({ message: `Removed "${title}" from Pick it up`, type: 'success' });
          })
          .catch(e => st.setToast({ message: `Failed to remove: ${String(e)}`, type: 'error' }));
      },
    });
  }

  // ── ORGANIZE ─────────────────────────────────────────────────────────────
  const organize: ContextMenuItem[] = [
    { label: 'Add to Playlist', icon: 'playlist', onClick: () => setPlaylistItem?.(item), disabled: !setPlaylistItem },
  ];
  if (isAdmin) {
    organize.push({ label: 'Add to Collection', icon: 'layers', onClick: () => setCollectionItem?.(item), disabled: !setCollectionItem });
  }

  const sections: ContextMenuSection[] = [
    { label: 'Playback', items: playback },
    { label: 'Organize', items: organize },
  ];

  // ── MANAGE ─────────────────────────────────────────────────────────────────
  // Local-library items carry a localPath. Their manage tools differ from ABS:
  // Match and Edit Metadata are wired (both write the catalog + re-file on disk);
  // the rest (Cover/Re-Scan/Share/Delete) are still server-coupled, so they're
  // omitted for local items rather than shown broken. These are offered for local
  // items regardless of server-admin status, since a standalone local session has
  // no server user.
  if (isLocal) {
    sections.push({
      label: 'Manage',
      items: [
        {
          label: 'Library tools',
          icon: 'sliders',
          submenu: [
            { label: 'Edit Metadata', icon: 'edit', onClick: () => setEditItem?.(item), disabled: !setEditItem },
            { label: 'Match', icon: 'target', onClick: () => setMatchItem?.(item), disabled: !setMatchItem },
            {
              label: 'Delete',
              icon: 'trash',
              danger: true,
              onClick: () => {
                const title = item.media?.metadata?.title ?? 'this book';
                st.setConfirmDialog({
                  title: `Delete "${title}"?`,
                  message: 'This permanently deletes the book and its files from this device. This cannot be undone.',
                  confirmLabel: 'Delete',
                  onConfirm: () => {
                    deleteLocalItem(item.id)
                      .then(() => {
                        st.removeLibraryItem(item.id);
                        st.setToast({ message: `"${title}" deleted`, type: 'success' });
                      })
                      .catch(e => st.setToast({ message: `Delete failed: ${String(e)}`, type: 'error' }));
                  },
                });
              },
            },
          ],
        },
      ],
    });
  } else if (isAdmin) {
    sections.push({
      label: 'Manage',
      items: [
        { label: 'Share & Publish…', icon: 'share', onClick: () => setShareItem?.(item), disabled: !setShareItem },
        {
          label: 'Library tools',
          icon: 'sliders',
          submenu: [
            { label: 'Edit Metadata', icon: 'edit', onClick: () => setEditItem?.(item), disabled: !setEditItem },
            { label: 'Change Cover', icon: 'image', onClick: () => setCoverItem?.(item), disabled: !setCoverItem },
            { label: 'Match', icon: 'target', onClick: () => setMatchItem?.(item), disabled: !setMatchItem },
            { label: 'Files', icon: 'file', onClick: () => setFilesItem?.(item), disabled: !setFilesItem },
            {
              label: 'Re-Scan',
              icon: 'refresh',
              onClick: () => {
                const title = item.media?.metadata?.title ?? item.id;
                rescanItem(st.serverUrl, item.id)
                  .then(() => st.setToast({ message: `Rescan started for "${title}"`, type: 'success' }))
                  .catch(e => st.setToast({ message: `Rescan failed: ${String(e)}`, type: 'error' }));
              },
            },
          ],
        },
      ],
    });

    // Delete sits in its own unlabelled group so it's divided off from the rest.
    sections.push({
      items: [
        {
          label: 'Delete',
          icon: 'trash',
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
      ],
    });
  }

  return sections;
}
