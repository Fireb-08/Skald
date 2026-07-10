// Combined-shelf context-menu boundary (review L1): All Libraries offers
// search/play plus a jump to the item's source library — never the
// library-scoped Organize actions, which would silently target the wrong scope.
import { describe, it, expect, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => undefined, convertFileSrc: (p: string) => `asset://${p}` }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
vi.mock('@tauri-apps/plugin-log', () => ({
  info: vi.fn(async () => {}), warn: vi.fn(async () => {}), error: vi.fn(async () => {}),
  debug: vi.fn(async () => {}), attachConsole: vi.fn(async () => () => {}),
}));

import { buildItemContextMenu } from './buildItemContextMenu';
import type { OnyxState, LibraryItem } from '../../state/onyx';
import type { Library } from '../../api/abs';

const library = (id: string, name: string, source?: string): Library => ({
  id, name, mediaType: 'book', source, icon: null, provider: null, displayOrder: null,
  folders: [], settings: null, lastScan: null, createdAt: null, lastUpdate: null,
});

const LIBS = [library('abs-lib', 'Server Shelf'), library('local-lib', 'On this PC', 'local')];

// Only the state the menu builder reads. activeSource selects which shelf the
// menu is opened from; the item always belongs to abs-lib.
function fakeState(activeSource: 'all' | undefined): OnyxState {
  return {
    user: null,
    libraries: LIBS,
    activeLibrary: activeSource === 'all'
      ? { ...library('__all__', 'All Libraries', 'all') }
      : LIBS[0],
    downloads: [],
    mediaProgress: [],
    setActiveLibrary: vi.fn(async () => {}),
    setSearch: vi.fn(),
    setContextFilter: vi.fn(),
    setShelfTab: vi.fn(),
    setFocusedBookId: vi.fn(),
  } as unknown as OnyxState;
}

const ITEM = { id: 'book-1', libraryId: 'abs-lib', media: { metadata: { title: 'A Book' } } } as LibraryItem;

describe('combined-shelf context menu (All Libraries boundary)', () => {
  it('offers Open in <source library> and omits Organize', () => {
    const sections = buildItemContextMenu(ITEM, fakeState('all'));
    const labels = sections.map(s => s.label);

    expect(labels).not.toContain('Organize');
    const source = sections.find(s => s.label === 'Source');
    expect(source?.items.map(i => i.label)).toEqual(['Open in Server Shelf']);
  });

  it('jumping to the source library resets the view context and focuses the item', () => {
    const st = fakeState('all');
    const sections = buildItemContextMenu(ITEM, st);
    sections.find(s => s.label === 'Source')!.items[0].onClick!();

    expect(st.setActiveLibrary).toHaveBeenCalledWith('abs-lib');
    expect(st.setSearch).toHaveBeenCalledWith('');
    expect(st.setContextFilter).toHaveBeenCalledWith(null);
    expect(st.setShelfTab).toHaveBeenCalledWith('library');
    expect(st.setFocusedBookId).toHaveBeenCalledWith('book-1');
  });

  it('shows no Source section on a normal library, where Organize is available', () => {
    const sections = buildItemContextMenu(ITEM, fakeState(undefined));
    const labels = sections.map(s => s.label);

    expect(labels).not.toContain('Source');
    expect(labels).toContain('Organize');
  });
});
