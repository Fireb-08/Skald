import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-log', () => ({
  info: vi.fn(async () => {}), warn: vi.fn(async () => {}), error: vi.fn(async () => {}),
  debug: vi.fn(async () => {}), attachConsole: vi.fn(async () => () => {}),
}));

import ShelfHeader from './ShelfHeader';
import type { OnyxState } from '../../state/onyx';
import type { Library } from '../../api/abs';

beforeAll(() => {
  // jsdom has no ResizeObserver, and no layout engine behind it — every measured
  // width here is 0. That is convenient rather than limiting: 0 is the narrowest
  // case, and the tab row must survive it.
  class StubResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', StubResizeObserver);
});

afterEach(cleanup);

const absLibrary: Library = {
  id: 'lib_1', name: 'Audiobooks', mediaType: 'book', source: undefined, icon: null,
  provider: null, displayOrder: null, folders: [], settings: null, lastScan: null,
  createdAt: null, lastUpdate: null,
};

function state(): OnyxState {
  return {
    // serverUrl empty so the canonical series-count fetch is skipped — this test
    // is about the header's layout, not its data.
    serverUrl: '',
    currentLibraryId: 'lib_1',
    activeLibrary: absLibrary,
    libraries: [absLibrary],
    library: [],
    mediaProgress: [],
    search: '',
    searchScope: 'all',
    filter: 'all',
    contextFilter: null,
    advFilter: { tags: [], languages: [], explicit: 'any' },
    shelfTab: 'library',
    optionalTabs: { narrators: false, genres: false, publishers: false, playlists: false },
    libraryView: 'grid',
    allLibrariesPartial: null,
    setFilter: vi.fn(),
    setShelfTab: vi.fn(),
    setContextFilter: vi.fn(),
    setLibraryView: vi.fn(),
    setAdvFilter: vi.fn(),
    setActiveLibrary: vi.fn(async () => {}),
    dismissAllLibrariesPartial: vi.fn(),
  } as unknown as OnyxState;
}

describe('ShelfHeader tab row', () => {
  it('keeps the tab strip inside its own lane', () => {
    // The regression this pins: the strip is nowrap and centred, so unless the
    // wrapper clips it and the strip itself can shrink below its content, a tab
    // row wider than its share of the header overflows *both* ways and paints
    // over the shelf title on one side and the view/filter controls on the other.
    // This file has already lost that once — the clipping was traded for hiding
    // tabs at narrow widths, and collisions returned when a tab was added.
    render(<ShelfHeader st={state()} />);

    const pill = document.querySelector('.shelf-tab-pill') as HTMLElement;
    expect(pill).toBeTruthy();
    expect(pill.style.overflowX).toBe('auto');
    expect(pill.style.minWidth).toBe('0px');

    const wrapper = pill.parentElement as HTMLElement;
    expect(wrapper.style.overflow).toBe('hidden');
    expect(wrapper.style.minWidth).toBe('0px');
  });

  it('reaches every enabled tab however narrow the header measures', () => {
    // Width measures 0 here, which is what the old rule called "insufficient
    // space" before dropping Collections and Playlists from the row entirely —
    // removing the only way to reach them instead of letting the strip scroll.
    render(<ShelfHeader st={state()} />);

    expect(screen.getByText('Collections')).toBeTruthy();
    expect(screen.getByText('Home')).toBeTruthy();
    expect(screen.getByText('Recently Added')).toBeTruthy();
  });

  it('still honours the tabs turned off in settings', () => {
    // Scrolling replaces width-based hiding, not the user's own choice.
    render(<ShelfHeader st={state()} />);

    expect(screen.queryByText('Playlists')).toBeNull();
    expect(screen.queryByText('Narrators')).toBeNull();
  });
});
