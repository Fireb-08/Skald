import type { LibraryItem, OnyxState } from '../../state/onyx';
import type { ContextMenuItem } from '../ContextMenu';
import { updateProgress, deleteProgress, getMe } from '../../api/abs';

export function buildItemContextMenu(
  item: LibraryItem,
  st: OnyxState,
  setMatchItem?: (item: LibraryItem) => void,
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
        try {
          await updateProgress(st.serverUrl, item.id, item.media.duration, item.media.duration, true);
          await refreshProgress();
        } catch (e) {
          console.error('[ctx] mark finished failed:', e);
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
      { label: 'Re-Scan (coming soon)', onClick: () => {}, disabled: true },
      { label: 'Match', onClick: () => setMatchItem?.(item), disabled: !setMatchItem },
      { label: 'Delete (coming soon)',  onClick: () => {}, disabled: true, danger: true },
    );
  }

  return items;
}
