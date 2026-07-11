import { describe, expect, it } from 'vitest';
import { shelfScrollDecision } from './scrollState';

describe('shelfScrollDecision', () => {
  it('restores a saved view on initial mount', () => {
    expect(shelfScrollDecision(null, 'library-a:grid', null, false, '420')).toEqual({
      top: 420,
      pendingRestoreKey: null,
    });
  });

  it('defers a library restore until its async dataset has loaded', () => {
    const waiting = shelfScrollDecision(null, 'library-b:grid', null, true, '420');
    expect(waiting).toEqual({ top: null, pendingRestoreKey: 'library-b:grid' });
    expect(shelfScrollDecision('library-b:grid', 'library-b:grid', waiting.pendingRestoreKey, false, '420'))
      .toEqual({ top: 420, pendingRestoreKey: null });
  });

  it('resets when the current view receives a different dataset', () => {
    expect(shelfScrollDecision('library-a:grid', 'library-a:grid', null, false, '420'))
      .toEqual({ top: 0, pendingRestoreKey: null });
  });

  it('rejects an invalid persisted position', () => {
    expect(shelfScrollDecision(null, 'library-a:grid', null, false, 'not-a-number').top).toBe(0);
  });
});
