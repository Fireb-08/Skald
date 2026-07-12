import { describe, expect, it } from 'vitest';
import type { LibraryItem } from '../api/abs';
import { RECENTLY_ADDED_LIMIT, recentlyAddedItems } from './recentlyAdded';

function item(id: string, addedAt?: number | null): LibraryItem {
  return {
    id,
    ino: id,
    libraryId: 'library',
    mediaType: 'book',
    media: { metadata: {} },
    addedAt,
  } as LibraryItem;
}

describe('recentlyAddedItems', () => {
  it('matches ABS by sorting addedAt newest-first and limiting to ten', () => {
    const items = Array.from({ length: 12 }, (_, i) => item(String(i), i));

    expect(recentlyAddedItems(items).map(value => value.id)).toEqual(
      Array.from({ length: RECENTLY_ADDED_LIMIT }, (_, i) => String(11 - i)),
    );
  });

  it('keeps missing timestamps behind dated items without mutating the source', () => {
    const items = [item('unknown'), item('new', 20), item('old', 10)];

    expect(recentlyAddedItems(items).map(value => value.id)).toEqual(['new', 'old', 'unknown']);
    expect(items.map(value => value.id)).toEqual(['unknown', 'new', 'old']);
  });
});
