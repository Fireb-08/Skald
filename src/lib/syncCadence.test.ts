import { describe, expect, it } from 'vitest';
import {
  FOCUS_RECONCILE_MINIMUM_MS,
  OFFLINE_PROGRESS_FLUSH_MS,
  ONLINE_SESSION_SYNC_MS,
  SEEK_SYNC_DEBOUNCE_MS,
} from './syncCadence';

describe('playback sync cadence', () => {
  it('keeps the reviewed online, offline, seek, and focus intervals explicit', () => {
    expect(ONLINE_SESSION_SYNC_MS).toBe(10_000);
    expect(OFFLINE_PROGRESS_FLUSH_MS).toBe(30_000);
    expect(SEEK_SYNC_DEBOUNCE_MS).toBe(750);
    expect(FOCUS_RECONCILE_MINIMUM_MS).toBe(15_000);
  });
});
