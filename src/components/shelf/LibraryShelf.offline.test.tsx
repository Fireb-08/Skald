// Regression: rendering the offline shelf must not crash on the synthetic
// downloaded-podcast entries. A genre-less item once threw in bookGenre() during
// per-tile render and blanked the whole window (black-screen bug). This mounts
// the real LibraryShelf in an offline state with a downloaded podcast and asserts
// it renders the podcast entry and drops cached-but-undownloaded books.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';

const tauri = vi.hoisted(() => {
  const handlers = new Map<string, (args?: Record<string, unknown>) => unknown>();
  const listeners = new Map<string, Set<(e: { event: string; payload: unknown }) => void>>();
  return {
    handlers,
    invoke: async (cmd: string, args?: Record<string, unknown>) => handlers.get(cmd)?.(args),
    listen: (event: string, cb: (e: { event: string; payload: unknown }) => void) => {
      let set = listeners.get(event);
      if (!set) { set = new Set(); listeners.set(event, set); }
      set.add(cb);
      return Promise.resolve(() => { set!.delete(cb); });
    },
  };
});

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke, convertFileSrc: (p: string) => `asset://${p}` }));
vi.mock('@tauri-apps/api/event', () => ({ listen: tauri.listen }));
vi.mock('@tauri-apps/plugin-log', () => ({
  info: vi.fn(async () => {}), warn: vi.fn(async () => {}), error: vi.fn(async () => {}),
  debug: vi.fn(async () => {}), attachConsole: vi.fn(async () => () => {}),
}));

import { useOnyxState, type OnyxState } from '../../state/onyx';
import LibraryShelf from './LibraryShelf';

const SERVER = 'http://abs.local';

// Owns the real state and feeds the live snapshot into the shelf, so the offline
// launch effect drives isOffline / library / downloads exactly as in the app.
let captured: OnyxState;
function Harness() {
  const st = useOnyxState();
  captured = st;
  return <LibraryShelf st={st} />;
}

// Save the DOM globals this test overrides so they can be restored — otherwise
// the prototype mutations leak into other test files and cause flaky failures.
const orig = {
  scrollTo: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTo'),
  rect: Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect'),
  clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight'),
  clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth'),
  resizeObserver: Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver'),
};

afterEach(() => {
  const restore = (obj: object, prop: string, desc: PropertyDescriptor | undefined) => {
    if (desc) Object.defineProperty(obj, prop, desc);
    else delete (obj as Record<string, unknown>)[prop];
  };
  restore(Element.prototype, 'scrollTo', orig.scrollTo);
  restore(Element.prototype, 'getBoundingClientRect', orig.rect);
  restore(HTMLElement.prototype, 'clientHeight', orig.clientHeight);
  restore(HTMLElement.prototype, 'clientWidth', orig.clientWidth);
  restore(globalThis, 'ResizeObserver', orig.resizeObserver);
});

beforeEach(() => {
  // jsdom implements no scroll methods; the shelf's scroll-restore layout effect
  // calls scrollTo on its container.
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
  // Give the virtualizer a real viewport: jsdom reports 0 for client dimensions
  // and has no ResizeObserver, so its visible range would be empty and no rows
  // would render. A no-op observer keeps the virtualizer on its initialRect.
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1000 });
  // The virtualizer measures its viewport via getBoundingClientRect (all zeros in
  // jsdom → empty visible window). Report a real size so rows actually render.
  Element.prototype.getBoundingClientRect = () => ({
    width: 1000, height: 800, top: 0, left: 0, right: 1000, bottom: 800, x: 0, y: 0, toJSON: () => {},
  }) as DOMRect;
  // Feed the virtualizer a real size synchronously on observe (it reads
  // borderBoxSize, falling back to contentRect) so its visible window is non-empty
  // and rows render.
  globalThis.ResizeObserver = class {
    cb: (entries: unknown[]) => void;
    constructor(cb: (entries: unknown[]) => void) { this.cb = cb; }
    observe(el: Element) {
      this.cb([{ target: el, borderBoxSize: [{ inlineSize: 1000, blockSize: 800 }], contentRect: { width: 1000, height: 800 } }]);
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  localStorage.clear();
  tauri.handlers.clear();
  localStorage.setItem('skald.serverUrl', SERVER);
  localStorage.setItem('skald.hasAuth', 'true');
  localStorage.setItem('onyx.lib.view', 'list'); // list view renders rows regardless of jsdom's zero width

  // Offline launch: the server is unreachable, there are no local libraries, and
  // the cache holds one (minified, genre-less) book — so isOffline stays true and
  // the cached book is the shelf's base source.
  tauri.handlers.set('fetch_libraries', () => { throw new Error('offline'); });
  tauri.handlers.set('get_local_libraries', () => []);
  tauri.handlers.set('load_library_cache', () => [
    { id: 'book-1', mediaType: 'book', media: { metadata: { title: 'Cached Book' } } },
  ]);
  // One downloaded episode → one synthetic podcast entry on the offline shelf.
  tauri.handlers.set('get_downloads', () => [
    { itemId: 'pod-1', episodeId: 'e1', title: 'Episode One', author: 'Test Podcast',
      filePath: 'C:/dl/pod-1/e1/e1.mp3', fileSize: 100, downloadedAt: 1_000 },
  ]);
  tauri.handlers.set('take_corrupt_persistence_notices', () => []);
  tauri.handlers.set('flush_offline_progress', () => 0);
  tauri.handlers.set('get_me', () => ({ mediaProgress: [] }));
  tauri.handlers.set('close_all_open_sessions', () => undefined);
});

describe('offline shelf render', () => {
  it('renders the downloaded-podcast entry without crashing and hides undownloaded cached books', async () => {
    render(<Harness />);

    // The offline launch path settles: isOffline true, the episode in the registry.
    await waitFor(() => {
      expect(captured.isOffline).toBe(true);
      expect(captured.downloads.some(d => d.episodeId === 'e1')).toBe(true);
    });

    // The synthetic podcast entry renders (this tile used to crash the shelf via
    // bookGenre on a genre-less item — reaching here at all proves it no longer does).
    await waitFor(() => expect(document.body.textContent).toContain('Test Podcast'));

    // Available-only offline: the cached book has no local copy, so it is dropped.
    expect(document.body.textContent).not.toContain('Cached Book');
  });

  it('resolves the now-playing item to the podcast, not a book, when offline', async () => {
    render(<Harness />);
    await waitFor(() => {
      expect(captured.isOffline).toBe(true);
      expect(captured.downloads.some(d => d.episodeId === 'e1')).toBe(true);
    });

    // Selecting the downloaded episode sets the current/focused book to the podcast
    // id. Offline that id isn't in the cached (book) library, so without the
    // resolveLibrary fold-in it would fall back to library[0] — a book — and the
    // player would render the episode as that book (the reported bug).
    act(() => { captured.setCurrentBookId('pod-1'); captured.setFocusedBookId('pod-1'); });
    await waitFor(() => expect(captured.currentBook?.mediaType).toBe('podcast'));
    expect(captured.focusedBook?.mediaType).toBe('podcast');
  });
});
