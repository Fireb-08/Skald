// Diagnostic logging wrapper (Diagnostic Logging roadmap, Phase 2).
//
// Thin layer over @tauri-apps/plugin-log that adds:
//   • feature CATEGORIES (typed) — ride in the log line and the in-app viewer,
//   • an in-memory RING BUFFER — instant, current-session view for the Logs →
//     Skald subtab and the About diagnostic report (no file read needed),
//   • secret REDACTION at write time — tokens/passwords never reach disk.
//
// Rust side logs via `log::*` with target "skald::<cat>"; both land in the same
// rotated file (skald.log under app_log_dir) configured in lib.rs.

import { info as pInfo, warn as pWarn, error as pError, debug as pDebug, attachConsole } from '@tauri-apps/plugin-log';

// Feature areas — keep in sync with the Rust `skald::<cat>` log targets.
export type LogCategory =
  | 'app' | 'auth' | 'library' | 'playback' | 'sync' | 'downloads' | 'sharing' | 'metadata';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface SkaldLogEntry {
  ts: number;        // Date.now() at emit
  level: LogLevel;
  cat: LogCategory;
  msg: string;       // message + redacted context (display-ready)
}

// ── Ring buffer ───────────────────────────────────────────────────────────────
const RING_MAX = 500;
const ring: SkaldLogEntry[] = [];
const subscribers = new Set<() => void>();

function pushRing(entry: SkaldLogEntry): void {
  ring.push(entry);
  if (ring.length > RING_MAX) ring.shift();
  subscribers.forEach(cb => { try { cb(); } catch { /* a bad subscriber must not break logging */ } });
}

/** Snapshot of the current session's buffered Skald log entries (oldest first). */
export function getLogBuffer(): readonly SkaldLogEntry[] {
  return ring;
}

/** Subscribe to buffer changes (for the Logs → Skald subtab). Returns an unsubscribe. */
export function subscribeLog(cb: () => void): () => void {
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
}

/** Clear the in-memory buffer (the on-disk file is unaffected). */
export function clearLogBuffer(): void {
  ring.length = 0;
  subscribers.forEach(cb => { try { cb(); } catch { /* ignore */ } });
}

// ── Redaction ─────────────────────────────────────────────────────────────────
// Mask values whose KEY looks secret, recursively. Applied before anything is
// serialized, so secrets never reach the log file, the buffer, or the report.
const SECRET_KEY = /token|authoriz|password|passwd|apikey|api_key|secret|bearer|cookie/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '…';
  if (Array.isArray(value)) return value.map(v => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? '***' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function ctxToString(ctx: unknown): string {
  try { return JSON.stringify(redact(ctx)); }
  catch { return String(ctx); }
}

// ── Emit ──────────────────────────────────────────────────────────────────────
function emit(level: LogLevel, cat: LogCategory, msg: string, ctx?: unknown): void {
  const display = ctx === undefined ? msg : `${msg} — ${ctxToString(ctx)}`;
  pushRing({ ts: Date.now(), level, cat, msg: display });
  // Forward to the plugin (stdout + file + webview). Fire-and-forget; a logging
  // failure must never affect app behaviour.
  const line = `[${cat}] ${display}`;
  const fn = level === 'error' ? pError : level === 'warn' ? pWarn : level === 'debug' ? pDebug : pInfo;
  void fn(line).catch(() => { /* non-fatal */ });
}

/** Categorised structured logging. `ctx` is redacted and appended. */
export const log = {
  debug: (cat: LogCategory, msg: string, ctx?: unknown) => emit('debug', cat, msg, ctx),
  info:  (cat: LogCategory, msg: string, ctx?: unknown) => emit('info',  cat, msg, ctx),
  warn:  (cat: LogCategory, msg: string, ctx?: unknown) => emit('warn',  cat, msg, ctx),
  error: (cat: LogCategory, msg: string, ctx?: unknown) => emit('error', cat, msg, ctx),
};

// ── Init ──────────────────────────────────────────────────────────────────────
let initialised = false;

/** Attach the devtools console to the plugin so Rust logs are visible in the
 *  WebView console too (dev convenience). Idempotent; safe to call once at boot. */
export async function initLogging(): Promise<void> {
  if (initialised) return;
  initialised = true;
  try { await attachConsole(); } catch { /* not in a Tauri context (e.g. tests) */ }
  log.info('app', 'logging initialised');
}
