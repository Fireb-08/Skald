import type { Library } from '../api/abs';

/** Human-readable name used wherever a library is selected. */
export function libraryDisplayLabel(library: Pick<Library, 'name' | 'mediaType'>): string {
  return library.mediaType === 'podcast' ? `Podcasts: ${library.name}` : library.name;
}

/** Text badge that makes the library's storage source explicit. */
export function librarySourceBadge(library: Pick<Library, 'mediaType' | 'source'>): string {
  const source = library.source === 'local' ? 'This PC' : 'Server';
  return library.mediaType === 'podcast' ? `${source} Podcast` : source;
}
