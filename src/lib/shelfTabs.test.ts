import { describe, expect, it } from 'vitest';
import { isServerOnlyShelfTab, shelfTabForSource } from './shelfTabs';

describe('shelf tab source gating', () => {
  it('marks Collections and Playlists as server-only', () => {
    expect(isServerOnlyShelfTab('collections')).toBe(true);
    expect(isServerOnlyShelfTab('playlists')).toBe(true);
    expect(isServerOnlyShelfTab('series')).toBe(false);
  });

  it('falls back to Home only for incompatible local tabs', () => {
    expect(shelfTabForSource('collections', true)).toBe('library');
    expect(shelfTabForSource('playlists', true)).toBe('library');
    expect(shelfTabForSource('series', true)).toBe('series');
    expect(shelfTabForSource('collections', false)).toBe('collections');
  });
});
