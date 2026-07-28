import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-log', () => ({
  info: vi.fn(async () => {}), warn: vi.fn(async () => {}), error: vi.fn(async () => {}),
  debug: vi.fn(async () => {}), attachConsole: vi.fn(async () => () => {}),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }));

const getLibrarySeries = vi.hoisted(() => vi.fn(async () => [] as Array<{ id: string }>));
vi.mock('../../api/abs', async importOriginal => ({
  ...(await importOriginal<typeof import('../../api/abs')>()),
  getLibrarySeries,
}));

import ShelfHeader from './ShelfHeader';
import type { OnyxState } from '../../state/onyx';
import type { Library } from '../../api/abs';
import { publishEntityChange, resetEntityListeners, INVALIDATION_WINDOW_MS } from '../../state/liveEntities';

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

afterEach(() => { cleanup(); resetEntityListeners(); });

const absLibrary: Library = {
  id: 'lib_1', name: 'Audiobooks', mediaType: 'book', source: undefined, icon: null,
  provider: null, displayOrder: null, folders: [], settings: null, lastScan: null,
  createdAt: null, lastUpdate: null,
};

function state(overrides: Partial<OnyxState> = {}): OnyxState {
  return {
    // serverUrl empty so the canonical series-count fetch is skipped — the layout
    // tests are about the header's shape, not its data.
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
    ...overrides,
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

describe('ShelfHeader series count', () => {
  const onSeriesTab = () => state({ serverUrl: 'http://abs.local', shelfTab: 'series' });
  const seriesList = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `ser_${i}` }));

  it('follows a live series change, so the header cannot contradict the body', async () => {
    // SeriesView re-fetches its list on a series event and is mounted alongside
    // this header while that tab is open. Without the same subscription the screen
    // states two different series counts at once — "8 series" up here and "9 series
    // in your library" down there.
    getLibrarySeries.mockResolvedValue(seriesList(8));
    render(<ShelfHeader st={onSeriesTab()} />);
    await waitFor(() => expect(screen.getByText('8 series')).toBeTruthy());

    getLibrarySeries.mockResolvedValue(seriesList(9));
    act(() => {
      publishEntityChange({ kind: 'series', op: 'added', id: 'ser_8', object: { id: 'ser_8' } });
    });
    // Coalesced like every other invalidation — nothing is fetched until the burst
    // window closes.
    expect(getLibrarySeries).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(screen.getByText('9 series')).toBeTruthy());
    expect(getLibrarySeries).toHaveBeenCalledTimes(2);
  });

  it('does not fetch a count no tab is showing', async () => {
    // The header is mounted on every tab; only the Series subtitle reads this
    // count. Fetching it for a pane nobody is looking at is the overfetch the
    // whole feed is built to avoid.
    getLibrarySeries.mockResolvedValue(seriesList(8));
    render(<ShelfHeader st={state({ serverUrl: 'http://abs.local', shelfTab: 'library' })} />);

    act(() => {
      publishEntityChange({ kind: 'series', op: 'added', id: 'ser_8', object: { id: 'ser_8' } });
    });
    await new Promise(resolve => setTimeout(resolve, INVALIDATION_WINDOW_MS + 20));

    expect(getLibrarySeries).not.toHaveBeenCalled();
  });

  it('fetches on arrival at the Series tab, so a change made elsewhere is not shown stale', async () => {
    getLibrarySeries.mockResolvedValue(seriesList(8));
    const { rerender } = render(<ShelfHeader st={state({ serverUrl: 'http://abs.local', shelfTab: 'library' })} />);
    expect(getLibrarySeries).not.toHaveBeenCalled();

    rerender(<ShelfHeader st={onSeriesTab()} />);

    await waitFor(() => expect(screen.getByText('8 series')).toBeTruthy());
  });
});
