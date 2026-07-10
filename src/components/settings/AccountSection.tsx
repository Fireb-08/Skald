// AccountSection — profile view for all users, plus admin-only user management.
// Non-admin users see their username, account type, and self-service change password
// (PATCH /api/me/password). Admin and root users additionally see a paginated user
// list with CRUD controls.
import { useState, useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { SectionHead, Row, SERIF, MONO } from './shared';
import type { OnyxState } from '../../state/onyx';
import ConfirmDialog from '../ui/ConfirmDialog';
import {
  getAllUsers,
  getOnlineUsers,
  createUser,
  updateUser,
  deleteUser,
  getUser,
  getAuthSettings,
} from '../../api/abs';
import type { AdminUser, UserPermissions, AuthSettings } from '../../api/abs';
import { log } from '../../lib/log';
// Helpers, widgets, and modals split out per the God-File Decomposition roadmap
// (review L3/L7) — pure moves, same behavior.
import { relativeTime, formatDate, loadColorMap, saveColorMap, randomColor } from './account/helpers';
import { TypeBadge, RowButton, PencilIcon, TrashIcon, UserAvatar, ColorPickerPopover } from './account/widgets';
import ChangePasswordModal from './account/ChangePasswordModal';
import UserModal from './account/UserModal';


export interface AccountSectionProps {
  st: OnyxState;
  onSignOut: () => void;
}

export default function AccountSection({ st, onSignOut }: AccountSectionProps) {
  // Admin check — used to gate the user-list section and the "Add User" button.
  const isAdmin = st.isAdmin;
  // True when connected to an Audiobookshelf server. Local-only users get a
  // simplified profile: an editable display name, no account type / password.
  const hasAbs = !!st.authToken && !!st.serverUrl;

  // Local-only display name lives in shared state (persisted to localStorage) so
  // the TopNav avatar and library greeting react to edits here immediately.
  const localName = st.localDisplayName;
  const saveLocalName = st.setLocalDisplayName;

  // Profile display values — used in the avatar block for all users.
  const displayName = hasAbs ? (st.user?.username ?? '') : localName;
  const initial = displayName.charAt(0).toUpperCase() || '?';

  // ── Admin-only state ──────────────────────────────────────────────────────
  const [users, setUsers] = useState<AdminUser[]>([]);
  // IDs of users currently connected to the server via WebSocket (from /api/users/online).
  // Drives the presence dot — a user is "online" only if their ID appears here.
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');

  // ── Per-user avatar colours ───────────────────────────────────────────────
  // Map of userId → hex, persisted in localStorage. Missing users are assigned a
  // random palette colour (and persisted) by the effect below once the list loads.
  const [colorMap, setColorMap] = useState<Record<string, string>>(() => loadColorMap());
  // Which user's colour picker is currently open (null = none) and where to
  // anchor it (fixed coords from the clicked avatar). Outside click closes it.
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [pickerPos, setPickerPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const pickerRef = useRef<HTMLDivElement | null>(null);

  const openPicker = (e: React.MouseEvent, userId: string) => {
    e.stopPropagation();
    if (pickerFor === userId) { setPickerFor(null); return; }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPickerPos({ x: r.left, y: r.bottom + 6 });
    setPickerFor(userId);
  };

  const setUserColor = (userId: string, hex: string) => {
    setColorMap(prev => { const next = { ...prev, [userId]: hex }; saveColorMap(next); return next; });
  };

  // Modal visibility. editTarget/deleteTarget hold the user being acted on.
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  // cluster H: self-service password change + read-only SSO status.
  const [showChangePw, setShowChangePw] = useState(false);
  const isGuest = (st.user?.type ?? '') === 'guest';
  const [authSettings, setAuthSettings] = useState<AuthSettings | null>(null);
  const oidcEnabled = authSettings?.authActiveAuthMethods?.includes('openid') ?? false;

  // Library list + tags for the permissions editor (tags derived from the loaded
  // library, mirroring FilterPopover; covers the active library's tags). Empty
  // ids/tags are filtered out so React list keys stay unique.
  // Exclude local libraries — they're a client-side concept with no server-side
  // user/permission counterpart, so a managed server user can never access them.
  const libraryOptions = st.libraries.filter(l => l.id && l.source !== 'local').map(l => ({ id: l.id, name: l.name }));
  const availableTags = [...new Set(st.library.flatMap(b => b.media.tags ?? []))].filter(Boolean).sort((a, b) => a.localeCompare(b));

  // Admin-only: read whether OIDC/SSO is configured (read-only indicator).
  useEffect(() => {
    if (!isAdmin || !st.serverUrl) return;
    getAuthSettings(st.serverUrl).then(setAuthSettings).catch(e => log.error('auth', 'getAuthSettings failed', { err: String(e) }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch the full user list once on mount — only when the session is admin.
  useEffect(() => {
    if (!isAdmin || !st.serverUrl) return;
    loadUsers();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Live presence event subscription ──────────────────────────────────────
  // When live sync is enabled, subscribe to presence events forwarded from the
  // Rust socket layer. Each event carries a JSON string containing the user
  // object; we extract the id and update onlineUserIds accordingly.
  // The initial online set is fetched once on mount so the list is correct
  // even if some events were missed before this component mounted.
  useEffect(() => {
    // Only subscribe when the user has enabled live sync — avoids dangling
    // listeners when the toggle is off and the socket is not connected.
    const syncLive = localStorage.getItem('onyx.sync.live') === 'true';
    if (!syncLive || !st.serverUrl) return;

    // Seed the initial online set via HTTP so the dots are correct on mount,
    // before any WebSocket events arrive.
    getOnlineUsers(st.serverUrl).then(setOnlineUserIds).catch(e => log.error('auth', 'getOnlineUsers failed', { err: String(e) }));

    // Subscribe to the Tauri event emitted by socket.rs when ABS fires user_online.
    const unlistenOnline = listen<string>('presence-user-online', event => {
      try {
        const user = JSON.parse(event.payload) as { id: string };
        // Append the id only if it is not already present.
        setOnlineUserIds(prev => prev.includes(user.id) ? prev : [...prev, user.id]);
      } catch (e) {
        log.error('auth', 'presence online event parse failed', { err: String(e) });
      }
    });

    // Subscribe to the Tauri event emitted by socket.rs when ABS fires user_offline.
    const unlistenOffline = listen<string>('presence-user-offline', event => {
      try {
        const user = JSON.parse(event.payload) as { id: string };
        setOnlineUserIds(prev => prev.filter(id => id !== user.id));
      } catch (e) {
        log.error('auth', 'presence offline event parse failed', { err: String(e) });
      }
    });

    // Tear down both listeners when the component unmounts or the effect re-runs.
    return () => {
      unlistenOnline.then(fn => fn());
      unlistenOffline.then(fn => fn());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Assign a random, persisted colour to any user that doesn't have one yet.
  useEffect(() => {
    if (users.length === 0) return;
    setColorMap(prev => {
      let changed = false;
      const next = { ...prev };
      for (const u of users) {
        if (!next[u.id]) { next[u.id] = randomColor(); changed = true; }
      }
      if (changed) saveColorMap(next);
      return changed ? next : prev;
    });
  }, [users]);

  // Close the colour picker when clicking anywhere outside the open popover.
  useEffect(() => {
    if (!pickerFor) return;
    const onDown = (e: MouseEvent) => {
      if (!pickerRef.current?.contains(e.target as Node)) setPickerFor(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pickerFor]);

  /** Fetches /api/users and /api/users/online in parallel, then updates state. */
  async function loadUsers() {
    setLoading(true);
    setListError('');
    try {
      // Run both requests concurrently — neither depends on the other's result.
      const [list, onlineIds] = await Promise.all([
        getAllUsers(st.serverUrl),
        // Online user fetch is best-effort: fall back to an empty array so a
        // network error here doesn't block the whole user list from rendering.
        getOnlineUsers(st.serverUrl).catch(() => [] as string[]),
      ]);
      setOnlineUserIds(onlineIds);
      setUsers(
        [...list].sort((a, b) => {
          // Own row always floats to the top.
          if (a.id === st.userId) return -1;
          if (b.id === st.userId) return 1;
          return a.username.localeCompare(b.username);
        }),
      );
    } catch (e) {
      setListError(
        typeof e === 'string' ? e : (e as Error)?.message ?? 'Failed to load users.',
      );
    } finally {
      setLoading(false);
    }
  }

  /** POSTs a new user (with email, enable flag, and full permissions) and inserts
   *  it into the sorted list. */
  async function handleCreate(username: string, password: string, type: 'user' | 'admin', email: string, enable: boolean, permissions: UserPermissions) {
    const created = await createUser(st.serverUrl, username, password, type, email || null, enable, permissions);
    setUsers(prev =>
      [...prev, created].sort((a, b) => {
        if (a.id === st.userId) return -1;
        if (b.id === st.userId) return 1;
        return a.username.localeCompare(b.username);
      }),
    );
    setShowAdd(false);
  }

  /** PATCHes an existing user (incl. email, enable flag, permissions) and replaces
   *  its cached row. */
  async function handleEdit(username: string, password: string, type: 'user' | 'admin', email: string, enable: boolean, permissions: UserPermissions) {
    if (!editTarget) return;
    const updated = await updateUser(
      st.serverUrl,
      editTarget.id,
      username || null,
      // Empty string → null so the server keeps the existing password hash.
      password || null,
      type,
      email,
      enable,
      permissions,
    );
    setUsers(prev => prev.map(u => (u.id === updated.id ? updated : u)));
    setEditTarget(null);
  }

  /** Opens the edit modal, fetching the full user first so the permissions
   *  object is available (the list endpoint may omit it). */
  async function openEdit(u: AdminUser) {
    try {
      const full = await getUser(st.serverUrl, u.id);
      setEditTarget(full);
    } catch (e) {
      // Fall back to the list row — the editor will skip the permissions block
      // (it requires a permissions object) but username/type still work.
      log.error('auth', 'getUser for edit failed, using list row', { userId: u.id, err: String(e) });
      setEditTarget(u);
    }
  }

  /** DELETEs the targeted account and removes it from the cached list. */
  async function handleDelete() {
    if (!deleteTarget) return;
    setDeletePending(true);
    try {
      await deleteUser(st.serverUrl, deleteTarget.id);
      setUsers(prev => prev.filter(u => u.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e) {
      // Surface the error in the list area and dismiss the dialog.
      setListError(
        typeof e === 'string' ? e : (e as Error)?.message ?? 'Delete failed.',
      );
      setDeleteTarget(null);
    } finally {
      setDeletePending(false);
    }
  }

  return (
    <div>
      <SectionHead
        title="Account"
        subtitle={hasAbs
          ? 'Your profile on this Audiobookshelf server.'
          : 'Your profile on this device. Server accounts appear here after you connect to Audiobookshelf.'}
      />

      {/* ── Profile header card — shown for all users ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        padding: 18,
        marginBottom: 28,
        background: 'rgba(255,255,255,0.025)',
        border: '1px solid var(--onyx-glass-edge)',
        borderRadius: 14,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
      }}>
        {/* Avatar — rounded square containing the user's initial (theme accent) */}
        <div style={{
          width: 64,
          height: 64,
          borderRadius: 16,
          background: 'var(--onyx-accent)',
          color: 'var(--onyx-bg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: SERIF,
          fontWeight: 600,
          fontSize: 26,
          flexShrink: 0,
        }}>
          {initial}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: SERIF, fontSize: 20, fontWeight: 500 }}>
            {displayName}
          </div>
          <div className="onyx-selectable" style={{
            fontFamily: MONO,
            fontSize: 10,
            color: 'var(--onyx-text-mute)',
            marginTop: 6,
            letterSpacing: '0.06em',
          }}>
            {hasAbs ? (st.serverUrl || 'Not connected') : 'Local library'}
            {/* Transport-encryption note (review L6) — mirrors the titlebar pill.
                Plain HTTP stays allowed (common on trusted LANs); this only makes
                the missing encryption visible where the address is shown. */}
            {hasAbs && st.serverUrl.startsWith('http://') && (
              <span
                title="Traffic to this server (including media tokens) is not encrypted. Fine on a trusted home network; use an https:// address to encrypt."
                style={{
                  marginLeft: 8, padding: '1px 5px', borderRadius: 4,
                  color: '#d4834a', border: '1px solid rgba(212,131,74,0.4)',
                  background: 'rgba(212,131,74,0.08)', textTransform: 'uppercase',
                  letterSpacing: '0.08em', fontSize: 9,
                }}
              >not encrypted</span>
            )}
          </div>
        </div>
      </div>

      {/* ── Local-only view: editable display name (no account type / password) ── */}
      {!hasAbs && (
        <Row label="Display name" hint="Shown in your library greeting. Stored on this device.">
          <input
            type="text"
            value={localName}
            onChange={e => saveLocalName(e.target.value)}
            placeholder="Reader"
            maxLength={40}
            style={{
              padding: '8px 12px',
              minWidth: 200,
              fontSize: 13,
              background: 'rgba(0,0,0,0.25)',
              borderRadius: 8,
              color: 'var(--onyx-text)',
              border: '1px solid var(--onyx-glass-edge)',
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
        </Row>
      )}

      {/* ── Admin self-service: password change + read-only SSO status ── */}
      {isAdmin && (
        <>
          <Row label="Password" hint="Change your own account password.">
            <button
              onClick={() => setShowChangePw(true)}
              style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--onyx-glass-edge)', borderRadius: 7, color: 'var(--onyx-text-dim)', fontFamily: MONO, fontSize: 11, letterSpacing: '0.07em', textTransform: 'uppercase' as const, cursor: 'pointer' }}
            >
              Change password
            </button>
          </Row>
          <Row label="Single sign-on (SSO)" hint="OpenID Connect is enabled in this server's Audiobookshelf auth settings. SSO login from Skald is not yet available.">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: MONO, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: oidcEnabled ? 'var(--onyx-accent)' : 'var(--onyx-text-mute)' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: oidcEnabled ? 'var(--onyx-accent)' : 'var(--onyx-text-mute)', flexShrink: 0 }} />
              {oidcEnabled ? 'Enabled · OpenID' : 'Not configured'}
            </span>
          </Row>
        </>
      )}

      {/* ── Non-admin ABS view: read-only account info ── */}
      {!isAdmin && hasAbs && (
        <>
          {/* Username row — read-only; ABS has no public rename endpoint */}
          <Row label="Display name" hint="Name is managed by your Audiobookshelf server.">
            <input
              type="text"
              value={displayName}
              readOnly
              disabled
              title="Name is managed by your Audiobookshelf server"
              style={{
                padding: '8px 12px',
                minWidth: 200,
                fontSize: 13,
                background: 'rgba(0,0,0,0.15)',
                borderRadius: 8,
                color: 'var(--onyx-text-dim)',
                border: '1px solid var(--onyx-glass-edge)',
                outline: 'none',
                cursor: 'default',
                opacity: 0.7,
                fontFamily: 'inherit',
              }}
            />
          </Row>

          {/* Account type row */}
          <Row label="Account type" hint="Role assigned to your account on this server.">
            <TypeBadge type={st.user?.type ?? 'user'} />
          </Row>

          {/* Change password — self-service. Guests cannot (server returns 403). */}
          <Row
            label="Password"
            hint={isGuest ? 'Guest accounts cannot change their password.' : 'Change your account password.'}
          >
            <button
              onClick={() => setShowChangePw(true)}
              disabled={isGuest}
              title={isGuest ? 'Not available for guest accounts' : 'Change password'}
              style={{
                padding: '8px 16px',
                background: 'transparent',
                border: '1px solid var(--onyx-glass-edge)',
                borderRadius: 7,
                color: isGuest ? 'var(--onyx-text-mute)' : 'var(--onyx-text-dim)',
                fontFamily: MONO,
                fontSize: 11,
                letterSpacing: '0.07em',
                textTransform: 'uppercase' as const,
                cursor: isGuest ? 'default' : 'pointer',
                opacity: isGuest ? 0.45 : 1,
              }}
            >
              Change password
            </button>
          </Row>
        </>
      )}

      {/* ── Admin view: full user-management section ── */}
      {isAdmin && (
        <div style={{ marginTop: 28 }}>
          {/* Sub-section header: "Users" heading + member count + Add User button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 500 }}>
                Users
              </div>
              {/* Member count — plain mono text, shown once the list has loaded */}
              {!loading && !listError && (
                <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)', letterSpacing: '0.04em' }}>
                  {users.length} {users.length === 1 ? 'member' : 'members'}
                </span>
              )}
            </div>

            {/* Outlined "Add User" button */}
            <button
              onClick={() => setShowAdd(true)}
              style={{
                padding: '7px 14px',
                background: 'transparent',
                border: '1px solid var(--onyx-glass-edge)',
                borderRadius: 7,
                color: 'var(--onyx-text-dim)',
                fontFamily: MONO,
                fontSize: 10.5,
                letterSpacing: '0.07em',
                textTransform: 'uppercase' as const,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              + Add User
            </button>
          </div>

          {/* Loading state */}
          {loading && (
            <div style={{
              padding: '20px 0',
              fontFamily: MONO,
              fontSize: 11,
              color: 'var(--onyx-text-mute)',
              letterSpacing: '0.06em',
            }}>
              Loading users…
            </div>
          )}

          {/* Error state */}
          {!loading && listError && (
            <div style={{ padding: '12px 0', fontSize: 12, color: '#e8716a', fontFamily: MONO }}>
              {listError}
            </div>
          )}

          {/* User table — column headers + scrollable body inside one rounded pane */}
          {!loading && !listError && (() => {
            const GRID = 'minmax(0,1fr) 80px 96px 124px 60px';
            // Sync mode drives presence: live mode uses the server's online set;
            // local mode treats only the logged-in user as connected.
            const syncLive = localStorage.getItem('onyx.sync.live') === 'true';
            const headCell: React.CSSProperties = {
              fontFamily: MONO, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase',
              color: 'rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.6)',
            };
            const metaCell: React.CSSProperties = {
              fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            };
            return (
              <div style={{ border: '1px solid var(--onyx-line)', borderRadius: 12, overflow: 'hidden' }}>
                {/* Header */}
                <div style={{ display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', gap: 14, padding: '9px 18px', borderBottom: '1px solid var(--onyx-line)', background: 'rgba(255,255,255,0.02)' }}>
                  <span style={headCell}>Name</span>
                  <span style={headCell}>Role</span>
                  <span style={headCell}>Last seen</span>
                  <span style={headCell}>Joined</span>
                  <span style={{ ...headCell, textAlign: 'right' }}>Actions</span>
                </div>

                {/* Rows */}
                <div style={{ maxHeight: 440, overflowY: 'auto' }}>
                  {users.map((u, i) => {
                    const isSelf = u.id === st.userId;
                    const isOnline = syncLive ? onlineUserIds.includes(u.id) : isSelf;
                    const color = colorMap[u.id] ?? '#888888';
                    const initialCh = u.username.charAt(0).toUpperCase() || '?';
                    return (
                      <div
                        key={u.id}
                        style={{
                          display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', gap: 14,
                          padding: '11px 18px',
                          borderBottom: i < users.length - 1 ? '1px solid var(--onyx-line)' : 'none',
                          background: isSelf ? 'rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.04)' : 'transparent',
                        }}
                      >
                        {/* Name: colour avatar (click to recolour) + username */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                          <UserAvatar color={color} initial={initialCh} online={isOnline} onClick={e => openPicker(e, u.id)} />
                          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13.5, fontWeight: isSelf ? 600 : 400, color: 'var(--onyx-text)' }}>
                            {u.username}
                            {isSelf && <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.08em', color: 'var(--onyx-text-mute)', marginLeft: 8 }}>you</span>}
                          </span>
                        </div>

                        {/* Role */}
                        <div style={{ minWidth: 0 }}><TypeBadge type={u.type} /></div>

                        {/* Last seen */}
                        <span style={metaCell}>{relativeTime(u.lastSeen)}</span>

                        {/* Joined */}
                        <span style={metaCell}>{formatDate(u.createdAt)}</span>

                        {/* Actions — hidden on the logged-in user's own row. */}
                        <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                          {!isSelf && (
                            <>
                              <RowButton onClick={() => openEdit(u)} title={`Edit ${u.username}`}>{PencilIcon}</RowButton>
                              <RowButton onClick={() => setDeleteTarget(u)} danger title={`Delete ${u.username}`}>{TrashIcon}</RowButton>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Sign out — shown for all users ── */}
      <div style={{
        marginTop: 32,
        paddingTop: 24,
        borderTop: '1px solid var(--onyx-line)',
        display: 'flex',
        justifyContent: 'flex-end',
      }}>
        <button
          onClick={onSignOut}
          style={{
            padding: '9px 20px',
            background: 'transparent',
            border: '1px solid rgba(232,113,106,0.4)',
            borderRadius: 8,
            color: '#e8716a',
            cursor: 'pointer',
            fontFamily: MONO,
            fontSize: 11.5,
            letterSpacing: '0.08em',
            textTransform: 'uppercase' as const,
          }}
        >
          Sign out
        </button>
      </div>

      {/* ── User colour picker popover ── */}
      {pickerFor && (
        <ColorPickerPopover
          value={colorMap[pickerFor] ?? '#888888'}
          onPick={hex => setUserColor(pickerFor, hex)}
          popRef={pickerRef}
          pos={pickerPos}
        />
      )}

      {/* ── Modals ── */}

      {/* Add User modal */}
      {showAdd && (
        <UserModal
          title="Add User"
          libraries={libraryOptions}
          availableTags={availableTags}
          onSubmit={handleCreate}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {/* Edit User modal — pre-filled with the target user's current values */}
      {editTarget && (
        <UserModal
          title="Edit User"
          initialUsername={editTarget.username}
          initialType={editTarget.type}
          isEdit
          editUser={editTarget}
          libraries={libraryOptions}
          availableTags={availableTags}
          onSubmit={handleEdit}
          onCancel={() => setEditTarget(null)}
        />
      )}

      {/* Change-password modal (self-service) */}
      {showChangePw && (
        <ChangePasswordModal serverUrl={st.serverUrl} onClose={() => setShowChangePw(false)} />
      )}

      {/* Delete confirmation — ConfirmDialog is already styled to match the Glass aesthetic */}
      {deleteTarget && (
        <ConfirmDialog
          title={`Delete ${deleteTarget.username}?`}
          message={`This will permanently remove "${deleteTarget.username}" from the server. This cannot be undone.`}
          confirmLabel={deletePending ? 'Deleting…' : 'Delete'}
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
