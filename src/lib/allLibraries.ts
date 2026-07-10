import type { Library, LibraryItem } from '../api/abs';

export const ALL_LIBRARIES_ID = '__all_libraries__';

// Result of a combined-shelf load. failedSources lets the UI distinguish a
// complete composite from a partial one (review H1 — a source dropping out
// must not produce a healthy-looking shelf).
export interface AllLibrariesLoadResult {
  items: LibraryItem[];
  failedSources: Library[];
  totalSources: number;
}

// Load every book library through the supplied per-library loader, preserving
// partial success: a failed source contributes no items but is recorded in
// failedSources instead of being silently dropped. The loader owns logging and
// source routing; this function stays dependency-free so the partial-success
// contract is unit-testable without Tauri mocks.
export async function loadAllLibrarySources(
  libraries: Library[],
  loader: (library: Library) => Promise<LibraryItem[]>,
): Promise<AllLibrariesLoadResult> {
  const sources = bookLibraries(libraries);
  const failedSources: Library[] = [];
  const results = await Promise.all(sources.map(async library => {
    try {
      return await loader(library);
    } catch {
      failedSources.push(library);
      return [] as LibraryItem[];
    }
  }));
  return { items: results.flat(), failedSources, totalSources: sources.length };
}

export function bookLibraries(libraries: Library[]): Library[] {
  return libraries.filter(library => library.mediaType !== 'podcast');
}

export function allLibrariesAvailable(libraries: Library[]): boolean {
  return bookLibraries(libraries).length > 1;
}

export function allLibrariesShelf(libraries: Library[]): Library | undefined {
  if (!allLibrariesAvailable(libraries)) return undefined;
  return {
    id: ALL_LIBRARIES_ID,
    name: 'All Libraries',
    mediaType: 'book',
    icon: null,
    provider: null,
    displayOrder: -1,
    folders: [],
    settings: null,
    lastScan: null,
    createdAt: null,
    lastUpdate: null,
    source: 'all',
  };
}
