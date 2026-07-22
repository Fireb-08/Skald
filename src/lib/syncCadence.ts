import cadence from '../config/playbackSync.json';

// One checked-in definition feeds both React timers and Rust's include_str!
// parser. Keep consumers on these names instead of embedding interval literals.
export const ONLINE_SESSION_SYNC_MS = cadence.onlineSessionSeconds * 1000;
export const OFFLINE_PROGRESS_FLUSH_MS = cadence.offlineFlushSeconds * 1000;
export const SEEK_SYNC_DEBOUNCE_MS = cadence.seekDebounceMilliseconds;
export const FOCUS_RECONCILE_MINIMUM_MS = cadence.focusReconcileMinimumMilliseconds;
