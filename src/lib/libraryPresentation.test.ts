import { describe, expect, it } from 'vitest';
import { libraryDisplayLabel, librarySourceBadge } from './libraryPresentation';

describe('library presentation', () => {
  it('distinguishes server and local audiobook libraries', () => {
    expect(librarySourceBadge({ mediaType: 'book', source: undefined })).toBe('Server');
    expect(librarySourceBadge({ mediaType: 'book', source: 'local' })).toBe('This PC');
  });

  it('keeps podcast context in the name and source badge', () => {
    const podcast = { name: 'News', mediaType: 'podcast', source: 'local' };
    expect(libraryDisplayLabel(podcast)).toBe('Podcasts: News');
    expect(librarySourceBadge(podcast)).toBe('This PC Podcast');
  });
});
