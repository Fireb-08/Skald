import type { Library } from '../api/abs';

export const ALL_LIBRARIES_ID = '__all_libraries__';

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
