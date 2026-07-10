import type { ActivityEntry } from '../state/onyx';

export const ACTIVITY_LIMIT = 50;

export function prependActivity(current: ActivityEntry[], entry: ActivityEntry): ActivityEntry[] {
  return [entry, ...current].slice(0, ACTIVITY_LIMIT);
}
