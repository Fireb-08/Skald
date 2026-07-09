// Split from the original single-file abs.ts (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. Import from '../abs' (the barrel),
// not from this file directly.
import { invoke } from '@tauri-apps/api/core';

export interface ShortcutBinding {
  action: string;
  shortcut: string;
}

export function registerShortcuts(bindings: ShortcutBinding[]): Promise<void> {
  return invoke('register_shortcuts', { bindings });
}

// ── Phase B: Socket.IO transport wrappers ─────────────────────────────────

/** Opens an authenticated Socket.IO connection to the ABS server. The session
 *  JWT is loaded from the OS keyring on the Rust side — the frontend never
 *  holds the persisted token value (see the auth-material migration in onyx.ts).
 *  Stores the client in Rust managed state; call disconnectSocket() to close it.
 *  Emits 'socket-connected' / 'socket-disconnected' Tauri events on lifecycle changes. */
export function connectSocket(serverUrl: string): Promise<void> {
  return invoke('connect_socket', { serverUrl });
}

/** Tears down the active Socket.IO connection cleanly.
 *  Safe to call when no connection is open. */
export function disconnectSocket(): Promise<void> {
  return invoke('disconnect_socket');
}

// ── Diagnostic logging (Diagnostic Logging roadmap) ──────────────────────────
/** Reads the on-disk Skald log file (skald.log) for the Skald log viewer + report. */
export function readSkaldLog(): Promise<string> {
  return invoke('read_skald_log');
}

/** Reveals the Skald log folder (app_log_dir) in the OS file explorer. */
export function openLogDir(): Promise<void> {
  return invoke('open_log_dir');
}

/** Opens a Rust-side save dialog and writes `contents` to the chosen path
 *  (used to export the notices / diagnostic report). The renderer never picks
 *  the path — see export_text_file in commands.rs. Resolves false on cancel. */
export function exportTextFile(defaultName: string, contents: string): Promise<boolean> {
  return invoke('export_text_file', { defaultName, contents });
}
