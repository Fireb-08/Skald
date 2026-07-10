import { describe, expect, it } from 'vitest';
import type { Library } from '../api/abs';
import { ALL_LIBRARIES_ID, allLibrariesAvailable, allLibrariesShelf, bookLibraries } from './allLibraries';

const library = (id: string, mediaType = 'book', source?: string): Library => ({
  id, name: id, mediaType, source, icon: null, provider: null, displayOrder: null,
  folders: [], settings: null, lastScan: null, createdAt: null, lastUpdate: null,
});

describe('All Libraries shelf', () => {
  const libraries = [library('server'), library('local', 'book', 'local'), library('podcast', 'podcast')];

  it('combines audiobook libraries but excludes podcasts', () => {
    expect(bookLibraries(libraries).map(item => item.id)).toEqual(['server', 'local']);
    expect(allLibrariesAvailable(libraries)).toBe(true);
  });

  it('creates a synthetic shelf only when multiple book libraries exist', () => {
    expect(allLibrariesShelf(libraries)?.id).toBe(ALL_LIBRARIES_ID);
    expect(allLibrariesShelf([library('only')])).toBeUndefined();
  });
});
