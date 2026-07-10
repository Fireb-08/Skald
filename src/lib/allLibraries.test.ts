import { describe, expect, it } from 'vitest';
import type { Library, LibraryItem } from '../api/abs';
import { ALL_LIBRARIES_ID, allLibrariesAvailable, allLibrariesShelf, bookLibraries, loadAllLibrarySources } from './allLibraries';

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

// Review H1: a failed source must be preserved as *recorded partial coverage*,
// never silently dropped so the composite looks complete.
describe('loadAllLibrarySources', () => {
  const libraries = [library('server'), library('local', 'book', 'local'), library('pod', 'podcast')];
  const item = (id: string) => ({ id } as LibraryItem);

  it('keeps items from reachable sources and records the failed one', async () => {
    const result = await loadAllLibrarySources(libraries, async lib => {
      if (lib.id === 'server') throw new Error('offline');
      return [item(`${lib.id}-book`)];
    });
    expect(result.items.map(i => i.id)).toEqual(['local-book']);
    expect(result.failedSources.map(l => l.id)).toEqual(['server']);
    expect(result.totalSources).toBe(2); // podcast library is never a combined source
  });

  it('reports zero failures on a fully successful load', async () => {
    const result = await loadAllLibrarySources(libraries, async lib => [item(`${lib.id}-book`)]);
    expect(result.items.map(i => i.id)).toEqual(['server-book', 'local-book']);
    expect(result.failedSources).toEqual([]);
    expect(result.totalSources).toBe(2);
  });

  it('records every source as failed when all loaders reject', async () => {
    const result = await loadAllLibrarySources(libraries, async () => { throw new Error('down'); });
    expect(result.items).toEqual([]);
    expect(result.failedSources.map(l => l.id)).toEqual(['server', 'local']);
  });
});
