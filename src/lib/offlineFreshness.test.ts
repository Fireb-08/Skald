import { beforeEach, describe, expect, it } from 'vitest';
import { freshnessKey, readLastRefresh, writeLastRefresh } from './offlineFreshness';

beforeEach(() => localStorage.clear());

describe('offline freshness', () => {
  it('scopes timestamps by server and library', () => {
    writeLastRefresh('https://one.example', 'books', 123);
    expect(readLastRefresh('https://one.example', 'books')).toBe(123);
    expect(readLastRefresh('https://two.example', 'books')).toBeNull();
    expect(readLastRefresh('https://one.example', 'podcasts')).toBeNull();
  });

  it('encodes URL and id components safely', () => {
    expect(freshnessKey('https://host/path', 'id/one')).not.toContain('https://');
  });
});
