import { describe, expect, it } from 'vitest';
import { ACTIVITY_LIMIT, prependActivity } from './activity';
import type { ActivityEntry } from '../state/onyx';

const entry = (id: string, timestamp: number): ActivityEntry => ({ id, timestamp, category: 'app', outcome: 'info', message: id });

describe('activity history', () => {
  it('orders newest entries first without mutating the input', () => {
    const current = [entry('old', 1)];
    const next = prependActivity(current, entry('new', 2));
    expect(next.map(item => item.id)).toEqual(['new', 'old']);
    expect(current.map(item => item.id)).toEqual(['old']);
  });

  it('stays bounded', () => {
    let current: ActivityEntry[] = [];
    for (let index = 0; index < ACTIVITY_LIMIT + 10; index += 1) current = prependActivity(current, entry(String(index), index));
    expect(current).toHaveLength(ACTIVITY_LIMIT);
    expect(current[0].id).toBe(String(ACTIVITY_LIMIT + 9));
  });
});
