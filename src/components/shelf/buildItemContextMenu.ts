import type { LibraryItem, OnyxState, MediaProgress } from '../../state/onyx';
import type { ContextMenuItem } from '../ContextMenu';
import { updateProgress, deleteProgress, getMe, closeActiveSession } from '../../api/abs';

// Guard against double-invocation (React portal event bubbling / StrictMode).
const pendingItems = new Set<string>();

export function buildItemContextMenu(
  item: LibraryItem,
  st: OnyxState,
  setMatchItem?: (item: LibraryItem) => void,
  setCollectionItem?: (item: LibraryItem) => void,
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
      label: 'Add to Collection',
      onClick: () => setCollectionItem?.(item),
      disabled: !setCollectionItem,
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
      { label: 'Re-Scan (coming soon)', onClick: () => {}, disabled: true },
      { label: 'Match', onClick: () => setMatchItem?.(item), disabled: !setMatchItem },
      { label: 'Delete (coming soon)',  onClick: () => {}, disabled: true, danger: true },
    );
  }

  return items;
}
