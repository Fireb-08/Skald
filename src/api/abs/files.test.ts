import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn(async () => ({ id: 'item' })));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import { deleteLibraryFile, fetchItemExpanded, updateItemTracks } from './files';

beforeEach(() => invoke.mockClear());

describe('file inspector command bindings', () => {
  it('uses the dedicated expanded-item command', async () => {
    await fetchItemExpanded('http://abs', 'item');
    expect(invoke).toHaveBeenCalledWith('fetch_item_expanded', { serverUrl: 'http://abs', itemId: 'item' });
  });

  it('passes the complete ordered track payload with Tauri camelCase arguments', async () => {
    const orderedFileData = [{ ino: '2', exclude: false }, { ino: '1', exclude: true }];
    await updateItemTracks('http://abs', 'item', orderedFileData);
    expect(invoke).toHaveBeenCalledWith('update_item_tracks', { serverUrl: 'http://abs', itemId: 'item', orderedFileData });
  });

  it('targets one item-owned inode for deletion', async () => {
    await deleteLibraryFile('http://abs', 'item', 'inode');
    expect(invoke).toHaveBeenCalledWith('delete_library_file', { serverUrl: 'http://abs', itemId: 'item', fileId: 'inode' });
  });
});
