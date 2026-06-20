import type { LibraryItem, OnyxState } from '../../state/onyx';
import type { ContextMenuItem, ContextMenuSection } from '../ContextMenu';
import { rescanItem, deleteItem, deleteLocalPodcast, checkLocalNewEpisodes } from '../../api/abs';

// Right-click menu for a podcast in the podcast library (cluster E). Mirrors the
// audiobook menu's sectioned layout but with podcast-relevant actions — the key
// addition is Unsubscribe (which removes the podcast library item). Most actions
// require admin/update/delete permission on the server, so they're admin-gated.
export interface BuildPodcastContextMenuOpts {
  /** Navigate to the podcast detail screen. */
  openDetail: (id: string) => void;
  /** Open the episode download picker for this podcast. */
  setDownloadItem?: (item: LibraryItem) => void;
  /** Open the auto-download settings modal. */
  setSettingsItem?: (item: LibraryItem) => void;
  setCoverItem?: (item: LibraryItem) => void;
  setFilesItem?: (item: LibraryItem) => void;
  /** Called after a successful unsubscribe so the caller can clear selection. */
  onUnsubscribed?: (id: string) => void;
}

export function buildPodcastContextMenu(
  item: LibraryItem,
  st: OnyxState,
  opts: BuildPodcastContextMenuOpts,
): ContextMenuSection[] {
  const { openDetail, setDownloadItem, setSettingsItem, setCoverItem, setFilesItem, onUnsubscribed } = opts;
  // Local podcast libraries have no server permission model — the user fully owns
  // them, so the management actions are always available; ABS keeps admin-gating.
  const isLocal = st.activeLibrary?.source === 'local';
  const isAdmin = st.user?.type === 'root' || st.user?.type === 'admin';
  const canManage = isLocal || isAdmin;
  const title = item.media?.metadata?.title ?? 'this podcast';

  // ── PODCAST ────────────────────────────────────────────────────────────────
  const podcast: ContextMenuItem[] = [
    { label: 'Open Podcast', icon: 'list', primary: true, onClick: () => openDetail(item.id) },
  ];
  if (canManage) {
    podcast.push(
      { label: 'Download Episodes…', icon: 'download', onClick: () => setDownloadItem?.(item), disabled: !setDownloadItem },
      { label: 'Auto-download Settings', icon: 'sliders', onClick: () => setSettingsItem?.(item), disabled: !setSettingsItem },
    );
  }

  const sections: ContextMenuSection[] = [{ label: 'Podcast', items: podcast }];

  // ── MANAGE ──────────────────────────────────────────────────────────────────
  if (canManage) {
    const manage: ContextMenuItem[] = [];
    // Cover/Files use ABS server endpoints — only meaningful for ABS podcasts.
    if (!isLocal) {
      manage.push(
        { label: 'Change Cover', icon: 'image', onClick: () => setCoverItem?.(item), disabled: !setCoverItem },
        { label: 'Files', icon: 'file', onClick: () => setFilesItem?.(item), disabled: !setFilesItem },
      );
    }
    manage.push({
      label: isLocal ? 'Check for New Episodes' : 'Re-Scan',
      icon: 'refresh',
      onClick: () => {
        const p = isLocal ? checkLocalNewEpisodes(item.id).then(() => st.refreshLibrary()) : rescanItem(st.serverUrl, item.id);
        p.then(() => st.setToast({ message: isLocal ? `Checked "${title}" for new episodes` : `Rescan started for "${title}"`, type: 'success' }))
          .catch(e => st.setToast({ message: `Failed: ${String(e)}`, type: 'error' }));
      },
    });
    sections.push({ label: 'Manage', items: manage });

    // Unsubscribe sits in its own divided-off group, like the audiobook Delete.
    sections.push({
      items: [
        {
          label: 'Unsubscribe',
          icon: 'trash',
          danger: true,
          onClick: () => {
            st.setConfirmDialog({
              title: `Unsubscribe from "${title}"?`,
              message: isLocal
                ? 'This removes the podcast from your library and deletes its downloaded episodes from disk. This cannot be undone.'
                : 'This removes the podcast from your library. If file deletion is enabled on the server, its downloaded episodes are also deleted from disk. This cannot be undone.',
              confirmLabel: 'Unsubscribe',
              onConfirm: () => {
                const p = isLocal ? deleteLocalPodcast(item.id) : deleteItem(st.serverUrl, item.id);
                p.then(() => {
                    st.removeLibraryItem(item.id);
                    onUnsubscribed?.(item.id);
                    st.setToast({ message: `Unsubscribed from "${title}"`, type: 'success' });
                  })
                  .catch(e => st.setToast({ message: `Unsubscribe failed: ${String(e)}`, type: 'error' }));
              },
            });
          },
        },
      ],
    });
  }

  return sections;
}
