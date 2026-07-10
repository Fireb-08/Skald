/** Shelf views backed by Audiobookshelf APIs with no local-catalog equivalent.
 *  They are also library-scoped, so the combined All Libraries shelf can't host
 *  them either — every other tab aggregates the loaded items client-side and
 *  works for any source. */
export const SERVER_ONLY_SHELF_TABS = ['collections', 'playlists'] as const;

export function isServerOnlyShelfTab(tab: string): boolean {
  return SERVER_ONLY_SHELF_TABS.includes(tab as typeof SERVER_ONLY_SHELF_TABS[number]);
}

/** The library source kinds the shelf routes on (undefined source = ABS). */
export type ShelfSource = 'abs' | 'local' | 'all';

/** True when `tab` cannot render for the given source: local libraries lack
 *  the server collection/playlist model, and the combined shelf spans
 *  libraries so those library-scoped views have no single home. */
export function shelfTabUnavailable(tab: string, source: ShelfSource): boolean {
  return source !== 'abs' && isServerOnlyShelfTab(tab);
}

/** Prevent a source switch from briefly mounting an incompatible server view. */
export function shelfTabForSource(tab: string, source: ShelfSource): string {
  return shelfTabUnavailable(tab, source) ? 'library' : tab;
}
