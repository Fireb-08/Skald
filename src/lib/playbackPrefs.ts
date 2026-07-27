import type { AutoRewindCfg } from '../api/abs';

// Reads the user's Playback-behaviour preferences (Settings → Playback) from
// localStorage. Centralized so every consumer — the transport ±skip buttons, the
// ←/→ keys, the global OS shortcuts, and the resume path — agrees on one value
// instead of hardcoding their own. Values are written by PlaybackSection via
// `useLocal`, which JSON-stringifies, so they are parsed with JSON.parse here.

// Skip step in seconds, used by the ±skip buttons, the ←/→ keys, and the global
// skip shortcuts. Stored as e.g. "30s"; defaults to 30 on absence / parse error.
export function skipSeconds(): number {
  try {
    const raw = localStorage.getItem('onyx.playback.skip') ?? '"30s"';
    const str = JSON.parse(raw) as string;
    return parseInt(str.replace('s', ''), 10) || 30;
  } catch {
    return 30;
  }
}

// Auto-rewind-on-resume step in seconds. Stored as "Off" | "2s" | "5s" | "10s";
// "Off" (or an unparseable value) yields 0, meaning "do not rewind on resume".
// Defaults to 5 when the key is absent (matches PlaybackSection's default).
export function rewindSeconds(): number {
  try {
    const raw = localStorage.getItem('onyx.playback.rewind') ?? '"5s"';
    const str = JSON.parse(raw) as string;
    if (str === 'Off') return 0;
    return parseInt(str.replace('s', ''), 10) || 0;
  } catch {
    return 0;
  }
}

// ── Adaptive auto-rewind ─────────────────────────────────────────────────────
// The backend decides every resume, so it needs the whole picture: the legacy
// fixed step AND the advanced settings. Keeping `onyx.playback.rewind` as the
// fixed value (rather than folding it into a new key) is deliberate — an
// existing install must keep the amount it already chose.

function localNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const value = JSON.parse(raw) as unknown;
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function localBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) === true;
  } catch {
    return fallback;
  }
}

/** The complete rewind configuration to hand the backend. Defaults mirror the
 *  Rust `AutoRewindCfg::default()`, so a fresh install behaves identically
 *  whether or not this has been pushed yet. */
export function autoRewindCfg(): AutoRewindCfg {
  return {
    // Opt-in: an upgrade must not start scaling a setting the user chose as fixed.
    adaptive: localBool('onyx.playback.autoRewind.adaptive', false),
    fixedSecs: rewindSeconds(),
    minSecs: localNumber('onyx.playback.autoRewind.min', 1),
    maxSecs: localNumber('onyx.playback.autoRewind.max', 30),
    activationDelaySecs: localNumber('onyx.playback.autoRewind.delay', 0),
    chapterBarrier: localBool('onyx.playback.autoRewind.chapterBarrier', false),
  };
}
