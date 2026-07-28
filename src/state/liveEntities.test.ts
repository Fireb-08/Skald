import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-log', () => ({
  info: vi.fn(async () => {}), warn: vi.fn(async () => {}), error: vi.fn(async () => {}),
  debug: vi.fn(async () => {}), attachConsole: vi.fn(async () => () => {}),
}));

import { renderHook } from '@testing-library/react';

import {
  createCoalescer,
  INVALIDATION_WINDOW_MS,
  parseEntityChange,
  publishEntityChange,
  removeById,
  resetEntityListeners,
  upsertById,
  useEntityChanges,
  useEntityInvalidation,
  type EntityChange,
} from './liveEntities';

afterEach(() => resetEntityListeners());

// Payloads below are the verified ABS v2.36.0 shapes, kept literal so a server
// change that reshapes one is caught here rather than by a stale pane.
describe('parseEntityChange', () => {
  it('hands a full payload straight to the consumer to patch with', () => {
    // Collections and playlists always carry the whole expanded object — on
    // removal too — which is what lets a view patch without re-fetching.
    const collection = JSON.stringify({
      id: 'col_1',
      libraryId: 'lib_1',
      name: 'Winter Reading',
      books: [{ id: 'li_1' }],
    });

    const change = parseEntityChange('collection', 'updated', collection);

    expect(change).toMatchObject({ kind: 'collection', op: 'updated', id: 'col_1' });
    expect(change?.object).toMatchObject({ name: 'Winter Reading' });
  });

  it('reports a thin payload as identity-only so the consumer re-fetches instead', () => {
    // `series_removed` is `{ id, libraryId }` — there is nothing to patch from.
    const change = parseEntityChange('series', 'removed', JSON.stringify({ id: 'ser_1', libraryId: 'lib_1' }));

    expect(change).toEqual({ kind: 'series', op: 'removed', id: 'ser_1', object: null });
  });

  it('classifies each author_removed shape on its own merits', () => {
    // ABS sends the full author from AuthorController but `{ id, libraryId }`
    // from ApiRouter and the scanner, so the same event arrives both ways
    // depending on how the author was deleted. Asking the payload what it is
    // keeps both correct without hard-coding either.
    const fromController = parseEntityChange('author', 'removed', JSON.stringify({
      id: 'aut_1', libraryId: 'lib_1', name: 'Miles Cameron', numBooks: 4,
    }));
    const fromScanner = parseEntityChange('author', 'removed', JSON.stringify({
      id: 'aut_1', libraryId: 'lib_1',
    }));

    expect(fromController?.object).not.toBeNull();
    expect(fromScanner?.object).toBeNull();
    expect(fromController?.id).toBe(fromScanner?.id);
  });

  it('drops a payload it cannot key, rather than guessing an id', () => {
    // Every consumer keys on id; inventing one corrupts a cache far more
    // quietly than a missed update does.
    expect(parseEntityChange('collection', 'added', 'not json')).toBeNull();
    expect(parseEntityChange('collection', 'added', JSON.stringify({ name: 'no id' }))).toBeNull();
    expect(parseEntityChange('collection', 'added', JSON.stringify([{ id: 'col_1' }]))).toBeNull();
    expect(parseEntityChange('collection', 'added', JSON.stringify(null))).toBeNull();
  });
});

describe('useEntityChanges', () => {
  it('patches a mounted view in place, and never fetches to do it', () => {
    // The collections/playlists path: the payload carries the whole object, so
    // applying it is a local state update and the API is never touched.
    const received: EntityChange<{ id: string; name?: string }>[] = [];
    const refetch = vi.fn();
    renderHook(() => useEntityChanges<{ id: string; name?: string }>('collection', c => { received.push(c); }));

    publishEntityChange({
      kind: 'collection', op: 'updated', id: 'col_1',
      object: { id: 'col_1', name: 'Winter Reading' },
    });

    expect(received).toHaveLength(1);
    expect(received[0].object).toMatchObject({ name: 'Winter Reading' });
    expect(refetch).not.toHaveBeenCalled();
  });

  it('delivers only to subscribers of that kind', () => {
    const onCollection = vi.fn();
    const onSeries = vi.fn();
    renderHook(() => useEntityChanges('collection', onCollection));
    renderHook(() => useEntityChanges('series', onSeries));

    publishEntityChange({ kind: 'collection', op: 'added', id: 'col_1', object: { id: 'col_1' } });

    expect(onCollection).toHaveBeenCalledTimes(1);
    expect(onSeries).not.toHaveBeenCalled();
  });

  it('stops delivering once the view unmounts', () => {
    // The lazy-invalidation guarantee: an unmounted view has no subscription, so
    // nothing is applied or fetched on its behalf until it mounts again.
    const handler = vi.fn();
    const { unmount } = renderHook(() => useEntityChanges('collection', handler));

    unmount();
    publishEntityChange({ kind: 'collection', op: 'updated', id: 'col_1', object: { id: 'col_1' } });

    expect(handler).not.toHaveBeenCalled();
  });

  it('calls the latest handler without re-subscribing on every render', () => {
    // Views pass an inline closure over their current state; the handler is held
    // in a ref so that costs no churn in the registry.
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ handler }: { handler: () => void }) => useEntityChanges('collection', handler),
      { initialProps: { handler: first } },
    );

    rerender({ handler: second });
    publishEntityChange({ kind: 'collection', op: 'updated', id: 'col_1', object: null });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('keeps delivering after a subscriber throws', () => {
    // One view failing to apply a change must not cost every other view its
    // update — the surfaces are unrelated and share only the transport.
    const broken = vi.fn(() => { throw new Error('render blew up'); });
    const healthy = vi.fn();
    renderHook(() => useEntityChanges('collection', broken));
    renderHook(() => useEntityChanges('collection', healthy));

    publishEntityChange({ kind: 'collection', op: 'updated', id: 'col_1', object: null });

    expect(broken).toHaveBeenCalled();
    expect(healthy).toHaveBeenCalled();
  });
});

describe('useEntityInvalidation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('re-fetches once for a burst, whatever the payloads were', () => {
    // The series/author path: nothing to patch from, so the view asks the server
    // — but only once per burst, however many events the scan emitted.
    const refetch = vi.fn();
    renderHook(() => useEntityInvalidation('series', refetch));

    for (let i = 0; i < 20; i++) {
      publishEntityChange({ kind: 'series', op: 'updated', id: `ser_${i}`, object: null });
    }
    expect(refetch).not.toHaveBeenCalled();

    vi.advanceTimersByTime(INVALIDATION_WINDOW_MS);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('drops a fetch the unmounting view had pending', () => {
    const refetch = vi.fn();
    const { unmount } = renderHook(() => useEntityInvalidation('series', refetch));

    publishEntityChange({ kind: 'series', op: 'removed', id: 'ser_1', object: null });
    unmount();
    vi.advanceTimersByTime(INVALIDATION_WINDOW_MS * 4);

    expect(refetch).not.toHaveBeenCalled();
  });
});

describe('list reducers', () => {
  const winter = { id: 'col_1', name: 'Winter Reading' };
  const summer = { id: 'col_2', name: 'Summer Reading' };

  it('appends an entity it has never seen and replaces one it has', () => {
    // Why upsert on both verbs: `_added` is redelivered on reconnect, and our own
    // create echoes back as one, so an append-only add would duplicate the row.
    expect(upsertById([winter], summer)).toEqual([winter, summer]);
    const renamed = { id: 'col_1', name: 'Deep Winter' };
    expect(upsertById([winter, summer], renamed)).toEqual([renamed, summer]);
  });

  it('leaves the array reference alone when nothing changed', () => {
    // A redelivered event should cost no re-render.
    const list = [winter, summer];
    expect(upsertById(list, winter)).toBe(list);
    expect(removeById(list, 'col_404')).toBe(list);
  });

  it('removes by id alone', () => {
    // `author_removed` carries only `id` from the scanner path, so id is the only
    // field a removal may key on.
    expect(removeById([winter, summer], 'col_1')).toEqual([summer]);
  });
});

describe('createCoalescer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('collapses a scan burst into one refetch', () => {
    // The guard this exists for: a library scan emits its series/author changes
    // in a burst, and one fetch per event would answer a server that is already
    // busy scanning with a request storm.
    const fire = vi.fn();
    const coalescer = createCoalescer(INVALIDATION_WINDOW_MS, fire);

    for (let i = 0; i < 20; i++) {
      coalescer.schedule();
      vi.advanceTimersByTime(10); // 20 events across 200 ms — inside one window
    }
    expect(fire).not.toHaveBeenCalled();

    vi.advanceTimersByTime(INVALIDATION_WINDOW_MS);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('fires again for a change that arrives after the window closed', () => {
    const fire = vi.fn();
    const coalescer = createCoalescer(INVALIDATION_WINDOW_MS, fire);

    coalescer.schedule();
    vi.advanceTimersByTime(INVALIDATION_WINDOW_MS);
    coalescer.schedule();
    vi.advanceTimersByTime(INVALIDATION_WINDOW_MS);

    expect(fire).toHaveBeenCalledTimes(2);
  });

  it('cancels a pending fetch so an unmounted view never issues one', () => {
    const fire = vi.fn();
    const coalescer = createCoalescer(INVALIDATION_WINDOW_MS, fire);

    coalescer.schedule();
    coalescer.cancel();
    vi.advanceTimersByTime(INVALIDATION_WINDOW_MS * 4);

    expect(fire).not.toHaveBeenCalled();
  });
});
