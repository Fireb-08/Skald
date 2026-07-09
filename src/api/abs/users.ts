// Split from the original single-file abs.ts (Large-File Split roadmap,
// 2026-07-09) — pure move, no logic changes. Import from '../abs' (the barrel),
// not from this file directly.
import { invoke } from '@tauri-apps/api/core';

// ── Admin user-management types ────────────────────────────────────────────
// Mirror of models::AdminUser in src-tauri/src/models.rs.
// Used by the AccountSection admin view; never used in the auth flow.

/** A user's permissions object (cluster H). ABS splits librariesAccessible /
 *  itemTagsSelected out to top-level user keys in its JSON, so they normally
 *  arrive empty here; they may be sent back nested on update. */
export interface UserPermissions {
  download: boolean;
  update: boolean;
  delete: boolean;
  upload: boolean;
  createEreader: boolean;
  accessAllLibraries: boolean;
  accessAllTags: boolean;
  accessExplicitContent: boolean;
  /** false = inclusive (only selected tags); true = exclusive (all but them). */
  selectedTagsNotAccessible: boolean;
  librariesAccessible: string[];
  itemTagsSelected: string[];
}

export interface AdminUser {
  id: string;
  username: string;
  // JSON key is "type" (Rust field is user_type with #[serde(rename="type")]).
  type: string;
  // Unix ms of last sign-in; null when the account was never used.
  lastSeen: number | null;
  // Unix ms when the account was created.
  createdAt: number | null;
  isActive: boolean | null;
  email?: string | null;
  currentBookId: string | null;
  // ── Access control (cluster H); present on getUser, may be absent in the list.
  permissions?: UserPermissions | null;
  librariesAccessible?: string[];
  itemTagsSelected?: string[];
}

/** Minimal GET /api/auth-settings view (admin-only). OIDC is enabled iff
 *  authActiveAuthMethods includes "openid". */
export interface AuthSettings {
  authActiveAuthMethods: string[];
  authOpenIDIssuerURL?: string | null;
}

/** GET /api/users/online — returns the IDs of users currently connected via WebSocket.
 *  Used to drive the presence dot in the admin user list. */
export function getOnlineUsers(serverUrl: string): Promise<string[]> {
  return invoke('get_online_users', { serverUrl });
}

/** GET /api/users — returns all accounts on the server. */
export function getAllUsers(serverUrl: string): Promise<AdminUser[]> {
  return invoke('get_all_users', { serverUrl });
}

/** POST /api/users — creates a new user account, with optional email, the enable
 *  flag, and a full permissions blob (download/update/…, library + tag access). */
export function createUser(
  serverUrl: string,
  username: string,
  password: string,
  userType: string,
  email: string | null = null,
  isActive = true,
  permissions: UserPermissions | null = null,
): Promise<AdminUser> {
  return invoke('create_user', { serverUrl, username, password, userType, email, isActive, permissions });
}

/** PATCH /api/users/{id} — partially updates a user account.
 *  Pass `null` for any field that should remain unchanged on the server.
 *  `permissions` (cluster H) carries librariesAccessible/itemTagsSelected nested. */
export function updateUser(
  serverUrl: string,
  userId: string,
  username: string | null,
  password: string | null,
  userType: string | null,
  email: string | null = null,
  isActive: boolean | null = null,
  permissions: UserPermissions | null = null,
): Promise<AdminUser> {
  return invoke('update_user', { serverUrl, userId, username, password, userType, email, isActive, permissions });
}

/** DELETE /api/users/{id} — permanently removes a user account. */
export function deleteUser(serverUrl: string, userId: string): Promise<void> {
  return invoke('delete_user', { serverUrl, userId });
}

/** GET /api/users/{id} — fetch one user with the full permissions object. */
export function getUser(serverUrl: string, userId: string): Promise<AdminUser> {
  return invoke('get_user', { serverUrl, userId });
}

/** PATCH /api/me/password — self-service password change. Guests are rejected
 *  server-side (403). */
export function changePassword(serverUrl: string, current: string, newPassword: string): Promise<void> {
  return invoke('change_password', { serverUrl, current, newPassword });
}

/** GET /api/auth-settings — admin-only auth config (read-only SSO indicator). */
export function getAuthSettings(serverUrl: string): Promise<AuthSettings> {
  return invoke('get_auth_settings', { serverUrl });
}
