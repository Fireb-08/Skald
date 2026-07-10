// Split from the original single-file abs.ts (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. Import from '../abs' (the barrel),
// not from this file directly.
import { invoke } from '@tauri-apps/api/core';
import type { ServerSettings } from './admin';
import type { MeResponse, User } from './types';

// ── Command wrappers ───────────────────────────────────────────────────────
// Command names match the Rust #[tauri::command] function names (snake_case).
// Argument keys are camelCase; Tauri converts them to Rust snake_case params.

export interface LoginResult {
  user: User;
  serverSettings: ServerSettings | null;
}

export function login(serverUrl: string, username: string, password: string): Promise<LoginResult> {
  return invoke('login', { serverUrl, username, password });
}

export function logout(): Promise<void> {
  return invoke('logout');
}

export function saveToken(token: string): Promise<void> {
  return invoke('save_token', { token });
}

export function hasToken(): Promise<boolean> {
  return invoke('has_token');
}

export function getMe(serverUrl: string): Promise<MeResponse> {
  return invoke('get_me', { serverUrl });
}

// ── Admin user-management wrappers ─────────────────────────────────────────
// These four functions call the Rust admin commands. They are only invoked
// from AccountSection when the logged-in user is admin or root.

/** Result of an API key login — user profile plus its API-key bearer credential.
 *  It is stored only in the OS keyring, never in localStorage or diagnostics. */
export interface ApiKeyLoginResult {
  user: User;
  token: string;
  serverSettings: ServerSettings | null;
}

/** Validates an API key through GET /api/me and returns its REST bearer token. */
export function loginWithApiKey(serverUrl: string, apiKey: string): Promise<ApiKeyLoginResult> {
  return invoke('login_with_api_key', { serverUrl, apiKey });
}

/** Clears the stored keyring token, forcing a fresh login on next launch.
 *  Call from devtools: invoke('clear_stored_token') */
export function clearStoredToken(): Promise<void> {
  return invoke('clear_stored_token');
}
