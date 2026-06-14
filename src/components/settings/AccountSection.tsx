// AccountSection — profile view for all users, plus admin-only user management.
// Non-admin users see their username, account type, and a WIP change-password stub.
// Admin and root users additionally see a paginated user list with CRUD controls.
import { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { SectionHead, Row, Pill, SERIF, MONO } from './shared';
import type { OnyxState } from '../../state/onyx';
import ConfirmDialog from '../ui/ConfirmDialog';
import {
  getAllUsers,
  getOnlineUsers,
  createUser,
  updateUser,
  deleteUser,
  getUser,
  changePassword,
  getAuthSettings,
} from '../../api/abs';
import type { AdminUser, UserPermissions, AuthSettings } from '../../api/abs';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Returns a human-readable relative time string for a Unix-ms timestamp.
 *  Returns "Never" when the timestamp is null (user has never signed in). */
function relativeTime(ms: number | null): string {
  if (ms === null) return 'Never';
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** Formats a Unix-ms timestamp as MM/DD/YYYY. Returns "—" when null. */
function formatDate(ms: number | null): string {
  if (ms === null) return '—';
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

// ── Sub-components ─────────────────────────────────────────────────────────


/** Mono pill badge for account type. Brass-tinted for admin/root, muted for user/guest. */
function TypeBadge({ type }: { type: string }) {
  const brass = type === 'root' || type === 'admin';
  return (
    <span style={{
      fontFamily: MONO,
      fontSize: 9,
      letterSpacing: '0.06em',
      textTransform: 'uppercase' as const,
      padding: '2px 7px',
      borderRadius: 4,
      background: brass ? 'rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.14)' : 'rgba(255,255,255,0.06)',
      color: brass ? 'var(--onyx-accent)' : 'var(--onyx-text-mute)',
      border: `1px solid ${brass ? 'rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.24)' : 'rgba(255,255,255,0.08)'}`,
      whiteSpace: 'nowrap' as const,
    }}>
      {type}
    </span>
  );
}

/** Small square icon button used for per-row edit/delete actions. */
function RowButton({
  onClick,
  danger = false,
  title,
  children,
}: {
  onClick: () => void;
  danger?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 28,
        height: 28,
        borderRadius: 6,
        border: '1px solid transparent',
        background: 'transparent',
        // Danger (delete) uses the app's standard red; edit uses dimmed text colour
        color: danger ? '#e8716a' : 'var(--onyx-text-dim)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        padding: 0,
      }}
    >
      {children}
    </button>
  );
}

// Feather-style pencil SVG (13px, stroke-only) for the edit button.
const PencilIcon = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

// Feather-style trash SVG (13px, stroke-only) for the delete button.
const TrashIcon = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

// ── Shared modal field styles ────────────────────────────────────────────────
const fieldLabelStyle: React.CSSProperties = {
  fontFamily: MONO, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
  color: 'var(--onyx-text-mute)', marginBottom: 6,
};
const fieldInputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '9px 12px', background: 'rgba(0,0,0,0.25)',
  border: '1px solid var(--onyx-glass-edge)', borderRadius: 7, color: 'var(--onyx-text)',
  fontSize: 13, outline: 'none', fontFamily: 'inherit',
};
const ghostBtnStyle: React.CSSProperties = {
  padding: '8px 18px', background: 'transparent', border: '1px solid var(--onyx-glass-edge)',
  borderRadius: 7, color: 'var(--onyx-text-dim)', fontFamily: MONO, fontSize: 11,
  letterSpacing: '0.07em', textTransform: 'uppercase', cursor: 'pointer',
};
const brassBtnStyle: React.CSSProperties = {
  // Theme accent (follows the selected accent), not a hardcoded gold gradient.
  padding: '8px 18px', background: 'var(--onyx-accent)',
  border: '1px solid var(--onyx-accent-edge)',
  borderRadius: 7, color: 'var(--onyx-bg)', fontFamily: MONO, fontSize: 11, letterSpacing: '0.07em',
  textTransform: 'uppercase', cursor: 'pointer', fontWeight: 600,
};

// ── ChangePasswordModal ──────────────────────────────────────────────────────

/** Self-service password change (PATCH /api/me/password). Guests are blocked
 *  server-side; the caller hides this for guest accounts. */
function ChangePasswordModal({ serverUrl, onClose }: { serverUrl: string; onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!next) return setError('Enter a new password.');
    if (next !== confirm) return setError('New passwords do not match.');
    setError('');
    setPending(true);
    try {
      await changePassword(serverUrl, current, next);
      setDone(true);
    } catch (err) {
      setError(typeof err === 'string' ? err : (err as Error)?.message ?? 'Change failed.');
      setPending(false);
    }
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.65)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form
        onSubmit={submit}
        style={{ width: 400, maxWidth: '90vw', background: 'var(--onyx-panel2)', backdropFilter: 'blur(40px) saturate(120%)', WebkitBackdropFilter: 'blur(40px) saturate(120%)', border: '1px solid var(--onyx-glass-edge)', borderRadius: 12, boxShadow: '0 24px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)', padding: '26px 26px 22px', display: 'flex', flexDirection: 'column', gap: 18 }}
      >
        <div style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 500, color: 'var(--onyx-text)' }}>Change password</div>
        {done ? (
          <>
            <div style={{ fontSize: 13, color: 'var(--onyx-text-dim)', lineHeight: 1.5 }}>
              Your password has been changed.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" onClick={onClose} style={brassBtnStyle}>Done</button>
            </div>
          </>
        ) : (
          <>
            <div>
              <div style={fieldLabelStyle}>Current password</div>
              <input style={fieldInputStyle} type="password" value={current} onChange={e => setCurrent(e.target.value)} autoFocus />
            </div>
            <div>
              <div style={fieldLabelStyle}>New password</div>
              <input style={fieldInputStyle} type="password" value={next} onChange={e => setNext(e.target.value)} />
            </div>
            <div>
              <div style={fieldLabelStyle}>Confirm new password</div>
              <input style={fieldInputStyle} type="password" value={confirm} onChange={e => setConfirm(e.target.value)} />
            </div>
            {error && <div style={{ fontSize: 12, color: '#e8716a', fontFamily: MONO }}>{error}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button type="button" onClick={onClose} style={ghostBtnStyle}>Cancel</button>
              <button type="submit" disabled={pending} style={{ ...brassBtnStyle, cursor: pending ? 'wait' : 'pointer' }}>
                {pending ? 'Saving…' : 'Change'}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

// ── UserModal ──────────────────────────────────────────────────────────────

interface UserModalProps {
  /** "Add User" or "Edit User" — shown as the modal title. */
  title: string;
  /** Pre-fill the username input when editing an existing account. */
  initialUsername?: string;
  /** Pre-select the type pill when editing. "root" is clamped to "admin". */
  initialType?: string;
  /** When true, the password field shows a "leave blank to keep" hint. */
  isEdit?: boolean;
  /** Full user (with permissions) when editing — drives the access-control editor. */
  editUser?: AdminUser;
  /** Libraries available to assign (cluster H). */
  libraries?: Array<{ id: string; name: string }>;
  /** Tags available to assign (derived from the loaded library). */
  availableTags?: string[];
  /** Called with the validated field values + permissions (null = leave default).
   *  Should throw on server errors. */
  onSubmit: (username: string, password: string, type: 'user' | 'admin', permissions: UserPermissions | null) => Promise<void>;
  onCancel: () => void;
}

/** Glass-panel modal for creating or editing a user account. */
function UserModal({
  title,
  initialUsername = '',
  initialType = 'user',
  isEdit = false,
  editUser,
  libraries = [],
  availableTags = [],
  onSubmit,
  onCancel,
}: UserModalProps) {
  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState('');
  // Clamp to 'admin' or 'user'; 'root' cannot be assigned through the UI.
  const [userType, setUserType] = useState<'user' | 'admin'>(
    initialType === 'admin' || initialType === 'root' ? 'admin' : 'user',
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  // ── Access-control state (edit mode only); seeded from the full user. ──
  const seed = editUser?.permissions;
  const seedLibs = editUser?.librariesAccessible ?? seed?.librariesAccessible ?? [];
  const seedTags = editUser?.itemTagsSelected ?? seed?.itemTagsSelected ?? [];
  const [accessAllLibraries, setAccessAllLibraries] = useState(seed?.accessAllLibraries ?? true);
  const [librariesAccessible, setLibrariesAccessible] = useState<string[]>(seedLibs);
  const [accessAllTags, setAccessAllTags] = useState(seed?.accessAllTags ?? true);
  const [itemTagsSelected, setItemTagsSelected] = useState<string[]>(seedTags);
  const [tagsExclusive, setTagsExclusive] = useState(seed?.selectedTagsNotAccessible ?? false);
  const [accessExplicit, setAccessExplicit] = useState(seed?.accessExplicitContent ?? false);

  const toggleInArray = (arr: string[], v: string) =>
    arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Validate required fields before making the network call.
    if (!username.trim()) return setError('Username is required.');
    if (!isEdit && !password) return setError('Password is required.');
    setError('');
    setPending(true);
    try {
      // Build the permissions blob only in edit mode (add uses server defaults).
      // Spread the existing permissions so non-edited flags (download/update/…)
      // are preserved; override the access-control fields the editor exposes.
      let permissions: UserPermissions | null = null;
      if (isEdit && seed) {
        permissions = {
          ...seed,
          accessAllLibraries,
          librariesAccessible: accessAllLibraries ? [] : librariesAccessible,
          accessAllTags,
          itemTagsSelected: accessAllTags ? [] : itemTagsSelected,
          selectedTagsNotAccessible: tagsExclusive,
          accessExplicitContent: accessExplicit,
        };
      }
      await onSubmit(username.trim(), password, userType, permissions);
    } catch (err) {
      setError(typeof err === 'string' ? err : (err as Error)?.message ?? 'An error occurred.');
      setPending(false);
    }
  };

  // Shared label style above each field.
  const fieldLabel: React.CSSProperties = {
    fontFamily: MONO,
    fontSize: 10,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--onyx-text-mute)',
    marginBottom: 6,
  };

  // Shared text-input style for username and password fields.
  const fieldInput: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '9px 12px',
    background: 'rgba(0,0,0,0.25)',
    border: '1px solid var(--onyx-glass-edge)',
    borderRadius: 7,
    color: 'var(--onyx-text)',
    fontSize: 13,
    outline: 'none',
    fontFamily: 'inherit',
  };

  return (
    // Backdrop — clicking outside the panel cancels the modal.
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 500,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.65)',
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      {/* Glass panel — same visual spec as ConfirmDialog */}
      <form
        onSubmit={handleSubmit}
        style={{
          width: 400,
          maxWidth: '90vw',
          background: 'var(--onyx-panel2)',
          backdropFilter: 'blur(40px) saturate(120%)',
          WebkitBackdropFilter: 'blur(40px) saturate(120%)',
          border: '1px solid var(--onyx-glass-edge)',
          borderRadius: 12,
          boxShadow: '0 24px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)',
          padding: '26px 26px 22px',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        {/* Modal title */}
        <div style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 500, color: 'var(--onyx-text)' }}>
          {title}
        </div>

        {/* Username field */}
        <div>
          <div style={fieldLabel}>Username</div>
          <input
            style={fieldInput}
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="username"
            spellCheck={false}
            // Auto-focus the first field when the modal opens.
            autoFocus
          />
        </div>

        {/* Password field — optional when editing (leave blank to keep existing) */}
        <div>
          <div style={fieldLabel}>
            Password
            {/* Show the "optional" hint only in edit mode. */}
            {isEdit && (
              <span style={{
                fontFamily: MONO,
                fontSize: 9,
                color: 'var(--onyx-text-mute)',
                marginLeft: 8,
                letterSpacing: '0.04em',
                textTransform: 'none',
                fontWeight: 400,
              }}>
                leave blank to keep existing
              </span>
            )}
          </div>
          <input
            style={fieldInput}
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>

        {/* Account type pill selector — only "user" and "admin" are creatable via UI */}
        <div>
          <div style={fieldLabel}>Account type</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Pill active={userType === 'user'} onClick={() => setUserType('user')}>user</Pill>
            <Pill active={userType === 'admin'} onClick={() => setUserType('admin')}>admin</Pill>
          </div>
        </div>

        {/* ── Access control (edit mode only) ── */}
        {isEdit && seed && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 4, borderTop: '1px solid var(--onyx-line)' }}>
            <div style={fieldLabel}>Access control</div>

            {/* Explicit content */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5, color: 'var(--onyx-text)', cursor: 'pointer' }}>
              <input type="checkbox" checked={accessExplicit} onChange={e => setAccessExplicit(e.target.checked)} />
              Allow explicit content
            </label>

            {/* Library access */}
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5, color: 'var(--onyx-text)', cursor: 'pointer' }}>
                <input type="checkbox" checked={accessAllLibraries} onChange={e => setAccessAllLibraries(e.target.checked)} />
                Access all libraries
              </label>
              {!accessAllLibraries && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8, paddingLeft: 24, maxHeight: 120, overflowY: 'auto' }}>
                  {libraries.length === 0 && <div style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--onyx-text-mute)' }}>No libraries found.</div>}
                  {libraries.map(lib => (
                    <label key={lib.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--onyx-text-dim)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={librariesAccessible.includes(lib.id)} onChange={() => setLibrariesAccessible(prev => toggleInArray(prev, lib.id))} />
                      {lib.name}
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Tag access */}
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5, color: 'var(--onyx-text)', cursor: 'pointer' }}>
                <input type="checkbox" checked={accessAllTags} onChange={e => setAccessAllTags(e.target.checked)} />
                Access all tags
              </label>
              {!accessAllTags && (
                <div style={{ marginTop: 8, paddingLeft: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {/* Inclusive vs exclusive */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Pill active={!tagsExclusive} onClick={() => setTagsExclusive(false)}>only selected</Pill>
                    <Pill active={tagsExclusive} onClick={() => setTagsExclusive(true)}>all except</Pill>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 120, overflowY: 'auto' }}>
                    {availableTags.length === 0 && <div style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--onyx-text-mute)' }}>No tags in the loaded library.</div>}
                    {availableTags.map(tag => {
                      const on = itemTagsSelected.includes(tag);
                      return (
                        <button key={tag} type="button" onClick={() => setItemTagsSelected(prev => toggleInArray(prev, tag))}
                          style={{ padding: '4px 10px', borderRadius: 999, fontFamily: MONO, fontSize: 10.5, cursor: 'pointer',
                            background: on ? 'var(--onyx-accent-dim)' : 'transparent',
                            border: `1px solid ${on ? 'var(--onyx-accent-edge)' : 'var(--onyx-glass-edge)'}`,
                            color: on ? 'var(--onyx-accent)' : 'var(--onyx-text-dim)' }}>
                          {tag}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Inline validation / server error */}
        {error && (
          <div style={{ fontSize: 12, color: '#e8716a', fontFamily: MONO }}>
            {error}
          </div>
        )}

        {/* Action row: Cancel (ghost) + Create/Save (brass) */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '8px 18px',
              background: 'transparent',
              border: '1px solid var(--onyx-glass-edge)',
              borderRadius: 7,
              color: 'var(--onyx-text-dim)',
              fontFamily: MONO,
              fontSize: 11,
              letterSpacing: '0.07em',
              textTransform: 'uppercase' as const,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            style={{
              padding: '8px 18px',
              // Theme accent (follows the selected accent), not a hardcoded gold gradient.
              background: 'var(--onyx-accent)',
              border: '1px solid var(--onyx-accent-edge)',
              borderRadius: 7,
              color: 'var(--onyx-bg)',
              fontFamily: MONO,
              fontSize: 11,
              letterSpacing: '0.07em',
              textTransform: 'uppercase' as const,
              cursor: pending ? 'wait' : 'pointer',
              fontWeight: 600,
            }}
          >
            {/* Label changes to show progress while the request is in flight. */}
            {pending ? (isEdit ? 'Saving…' : 'Creating…') : (isEdit ? 'Save' : 'Create')}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export interface AccountSectionProps {
  st: OnyxState;
  onSignOut: () => void;
}

export default function AccountSection({ st, onSignOut }: AccountSectionProps) {
  // Admin check — used to gate the user-list section and the "Add User" button.
  const isAdmin = st.isAdmin;

  // Profile display values — used in the avatar block for all users.
  const displayName = st.user?.username ?? '';
  const initial = displayName.charAt(0).toUpperCase() || '?';

  // ── Admin-only state ──────────────────────────────────────────────────────
  const [users, setUsers] = useState<AdminUser[]>([]);
  // IDs of users currently connected to the server via WebSocket (from /api/users/online).
  // Drives the presence dot — a user is "online" only if their ID appears here.
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');

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
  const libraryOptions = st.libraries.filter(l => l.id).map(l => ({ id: l.id, name: l.name }));
  const availableTags = [...new Set(st.library.flatMap(b => b.media.tags ?? []))].filter(Boolean).sort((a, b) => a.localeCompare(b));

  // Admin-only: read whether OIDC/SSO is configured (read-only indicator).
  useEffect(() => {
    if (!isAdmin || !st.serverUrl) return;
    getAuthSettings(st.serverUrl).then(setAuthSettings).catch(e => console.error('[AccountSection] getAuthSettings failed:', e));
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
    getOnlineUsers(st.serverUrl).then(setOnlineUserIds).catch(console.error);

    // Subscribe to the Tauri event emitted by socket.rs when ABS fires user_online.
    const unlistenOnline = listen<string>('presence-user-online', event => {
      try {
        const user = JSON.parse(event.payload) as { id: string };
        // Append the id only if it is not already present.
        setOnlineUserIds(prev => prev.includes(user.id) ? prev : [...prev, user.id]);
      } catch (e) {
        console.error('presence online parse failed', e);
      }
    });

    // Subscribe to the Tauri event emitted by socket.rs when ABS fires user_offline.
    const unlistenOffline = listen<string>('presence-user-offline', event => {
      try {
        const user = JSON.parse(event.payload) as { id: string };
        setOnlineUserIds(prev => prev.filter(id => id !== user.id));
      } catch (e) {
        console.error('presence offline parse failed', e);
      }
    });

    // Tear down both listeners when the component unmounts or the effect re-runs.
    return () => {
      unlistenOnline.then(fn => fn());
      unlistenOffline.then(fn => fn());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  /** POSTs a new user and inserts it into the sorted list. (Permissions are left
   *  at the server defaults on create; edit the user to refine access.) */
  async function handleCreate(username: string, password: string, type: 'user' | 'admin') {
    const created = await createUser(st.serverUrl, username, password, type);
    setUsers(prev =>
      [...prev, created].sort((a, b) => {
        if (a.id === st.userId) return -1;
        if (b.id === st.userId) return 1;
        return a.username.localeCompare(b.username);
      }),
    );
    setShowAdd(false);
  }

  /** PATCHes an existing user (incl. permissions) and replaces its cached row. */
  async function handleEdit(username: string, password: string, type: 'user' | 'admin', permissions: UserPermissions | null) {
    if (!editTarget) return;
    const updated = await updateUser(
      st.serverUrl,
      editTarget.id,
      username || null,
      // Empty string → null so the server keeps the existing password hash.
      password || null,
      type,
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
      console.error('[AccountSection] getUser failed:', e);
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
      <SectionHead title="Account" subtitle="Your profile on this Audiobookshelf server." />

      {/* ── Profile header — shown for all users ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        padding: '0 0 24px',
        borderBottom: '1px solid var(--onyx-line)',
      }}>
        {/* Avatar circle containing the user's initial */}
        <div style={{
          width: 72,
          height: 72,
          borderRadius: '50%',
          background: 'var(--onyx-accent)',
          color: 'var(--onyx-bg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 700,
          fontSize: 28,
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
            marginTop: 4,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}>
            {st.serverUrl || 'Not connected'}
          </div>
        </div>
      </div>

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
            <span style={{ fontFamily: MONO, fontSize: 11, color: oidcEnabled ? 'var(--onyx-accent)' : 'var(--onyx-text-mute)' }}>
              {oidcEnabled ? 'Enabled · OpenID' : 'Not configured'}
            </span>
          </Row>
        </>
      )}

      {/* ── Non-admin view: read-only account info ── */}
      {!isAdmin && (
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
          {/* Sub-section header: "Users" heading + count badge + Add User button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 500, flex: 1 }}>
              Users
            </div>

            {/* Count badge — only visible once the list has loaded successfully */}
            {!loading && !listError && (
              <span style={{
                fontFamily: MONO,
                fontSize: 9,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--onyx-text-mute)',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 4,
                padding: '2px 8px',
                whiteSpace: 'nowrap',
              }}>
                {users.length} {users.length === 1 ? 'user' : 'users'}
              </span>
            )}

            {/* Brass "Add User" button */}
            <button
              onClick={() => setShowAdd(true)}
              style={{
                padding: '7px 14px',
                // Subtle brass fill matches the Onyx accent without being as prominent
                // as the primary CTA; still clearly interactive against the dark panel.
                background: 'linear-gradient(180deg, rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.18), rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.10))',
                border: '1px solid rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.3)',
                borderRadius: 7,
                color: 'var(--onyx-accent)',
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

          {/* User rows — scrollable container capped at ~420px tall */}
          {!loading && !listError && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              maxHeight: 420,
              overflowY: 'auto',
            }}>
              {users.map(u => {
                // Flag whether this row is the currently logged-in user.
                const isSelf = u.id === st.userId;
                return (
                  <div
                    key={u.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 12px',
                      borderRadius: 8,
                      // Own row gets a subtle brass tint to make it identifiable at a glance.
                      background: isSelf
                        ? 'rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.06)'
                        : 'rgba(255,255,255,0.03)',
                      border: isSelf
                        ? '1px solid rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.15)'
                        : '1px solid rgba(255,255,255,0.05)',
                    }}
                  >
                    {/* ── Presence dot ──────────────────────────────────────────
                        Colour is determined by the current sync mode, read from
                        localStorage so it reacts to the Sync → Live sync toggle
                        without requiring a component re-mount.

                        'true'  → live mode  (Phase C will wire real WebSocket events)
                        anything else → local mode (Phase A behaviour, default)    */}
                    <div style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      flexShrink: 0,
                      background: (() => {
                        // Read sync mode from localStorage each render so toggling
                        // in Settings → Sync is reflected immediately on return.
                        const syncLive = localStorage.getItem('onyx.sync.live') === 'true';

                        // Determine whether this user's dot should be green.
                        const isOnline = syncLive
                          // Live path — onlineUserIds populated from /api/users/online.
                          // Will be replaced by WebSocket events in Phase C.
                          ? onlineUserIds.includes(u.id)
                          // Local path — only the logged-in user is ever "present".
                          // All other rows are grey; no server round-trip required.
                          : u.id === st.userId;

                        return isOnline ? '#52c97a' : 'var(--onyx-text-mute)';
                      })(),
                    }} />

                    {/* Username — bold for own row; "you" label appended */}
                    <div style={{
                      flex: 1,
                      fontSize: 13.5,
                      fontWeight: isSelf ? 600 : 400,
                      color: 'var(--onyx-text)',
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {u.username}
                      {isSelf && (
                        <span style={{
                          fontFamily: MONO,
                          fontSize: 9,
                          letterSpacing: '0.08em',
                          color: 'var(--onyx-text-mute)',
                          marginLeft: 8,
                        }}>
                          you
                        </span>
                      )}
                    </div>

                    {/* Account type pill */}
                    <TypeBadge type={u.type} />

                    {/* Last seen — mono relative time */}
                    <div style={{
                      fontFamily: MONO,
                      fontSize: 10,
                      color: 'var(--onyx-text-mute)',
                      minWidth: 90,
                      textAlign: 'right',
                      flexShrink: 0,
                    }}>
                      {relativeTime(u.lastSeen)}
                    </div>

                    {/* Created at — mono absolute date */}
                    <div style={{
                      fontFamily: MONO,
                      fontSize: 10,
                      color: 'var(--onyx-text-mute)',
                      minWidth: 80,
                      textAlign: 'right',
                      flexShrink: 0,
                    }}>
                      {formatDate(u.createdAt)}
                    </div>

                    {/* Edit + Delete buttons — hidden on the logged-in user's own row.
                        The server also blocks self-deletion, but hiding the controls is cleaner UX. */}
                    <div style={{
                      display: 'flex',
                      gap: 2,
                      flexShrink: 0,
                      // Fixed width keeps all rows aligned even when buttons are hidden.
                      width: 60,
                      justifyContent: 'flex-end',
                    }}>
                      {!isSelf && (
                        <>
                          <RowButton
                            onClick={() => openEdit(u)}
                            title={`Edit ${u.username}`}
                          >
                            {PencilIcon}
                          </RowButton>
                          <RowButton
                            onClick={() => setDeleteTarget(u)}
                            danger
                            title={`Delete ${u.username}`}
                          >
                            {TrashIcon}
                          </RowButton>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
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

      {/* ── Modals ── */}

      {/* Add User modal */}
      {showAdd && (
        <UserModal
          title="Add User"
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
