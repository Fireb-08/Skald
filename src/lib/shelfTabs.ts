/** Shelf views backed by Audiobookshelf APIs with no local-catalog equivalent. */
export const SERVER_ONLY_SHELF_TABS = ['collections', 'playlists'] as const;

export function isServerOnlyShelfTab(tab: string): boolean {
  return SERVER_ONLY_SHELF_TABS.includes(tab as typeof SERVER_ONLY_SHELF_TABS[number]);
}

/** Prevent a source switch from briefly mounting an incompatible server view. */
export function shelfTabForSource(tab: string, isLocalLibrary: boolean): string {
  return isLocalLibrary && isServerOnlyShelfTab(tab) ? 'library' : tab;
}
