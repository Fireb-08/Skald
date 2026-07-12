import type { LibraryItem } from '../api/abs';

/** ABS's personalized shelf orders its library-item `createdAt` column
 * descending and defaults to ten entries. Its public JSON names this `addedAt`. */
export const RECENTLY_ADDED_LIMIT = 10;

export function recentlyAddedItems(
  items: LibraryItem[],
  limit = RECENTLY_ADDED_LIMIT,
): LibraryItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const byAdded = (b.item.addedAt ?? 0) - (a.item.addedAt ?? 0);
      return byAdded || a.index - b.index;
    })
    .slice(0, limit)
    .map(({ item }) => item);
}
