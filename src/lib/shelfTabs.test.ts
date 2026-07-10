import { describe, expect, it } from 'vitest';
import { isServerOnlyShelfTab, shelfTabForSource, shelfTabUnavailable } from './shelfTabs';

describe('shelf tab source gating', () => {
  it('marks Collections and Playlists as server-only', () => {
    expect(isServerOnlyShelfTab('collections')).toBe(true);
    expect(isServerOnlyShelfTab('playlists')).toBe(true);
    expect(isServerOnlyShelfTab('series')).toBe(false);
  });

  it('falls back to Home only for incompatible tabs per source', () => {
    expect(shelfTabForSource('collections', 'local')).toBe('library');
    expect(shelfTabForSource('playlists', 'local')).toBe('library');
    expect(shelfTabForSource('series', 'local')).toBe('series');
    expect(shelfTabForSource('collections', 'abs')).toBe('collections');
  });

  // The combined shelf keeps every client-side browse tab (they aggregate the
  // loaded items) and hides only the library-scoped Collections/Playlists —
  // a Home-only combined tab strip was the original bug.
  it('combined shelf keeps the client-side browse tabs', () => {
    for (const tab of ['library', 'series', 'authors', 'narrators', 'genres', 'publishers']) {
      expect(shelfTabUnavailable(tab, 'all')).toBe(false);
      expect(shelfTabForSource(tab, 'all')).toBe(tab);
    }
    expect(shelfTabForSource('collections', 'all')).toBe('library');
    expect(shelfTabForSource('playlists', 'all')).toBe('library');
  });
});
