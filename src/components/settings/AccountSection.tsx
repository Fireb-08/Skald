// AccountSection — profile view for all users, plus admin-only user management.
// Non-admin users see their username, account type, and self-service change password
// (PATCH /api/me/password). Admin and root users additionally see a paginated user
// list with CRUD controls.
import { useState, useEffect, useRef } from 'react';
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
import { log } from '../../lib/log';

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

/** Formats a Unix-ms timestamp as "MMM D, YYYY" (e.g. May 18, 2026). Returns "—" when null. */
function formatDate(ms: number | null): string {
  if (ms === null) return '—';
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Per-user avatar colours ──────────────────────────────────────────────────
// Each user is assigned a colour for their initial-badge. ABS exposes no per-user
// colour field, so the mapping lives in localStorage (onyx.* prefix per project
// convention). Colours are picked at random from a curated, on-brand palette the
// first time a user is seen, then persisted so they stay stable across sessions.
// The user can override any colour via the picker (palette swatch or custom hex).
const USER_COLOR_KEY = 'onyx.userColors';
const USER_PALETTE = [
  '#d4a64a', '#c96442', '#7aa86a', '#5a8fc4', '#a86a8e', '#52b2cc',
  '#b8893f', '#6cc0a0', '#9b7fd0', '#d98f6a', '#5fa9b8', '#cf6f8f',
];

function loadColorMap(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(USER_COLOR_KEY) ?? '{}') as Record<string, string>; }
  catch { return {}; }
}
function saveColorMap(map: Record<string, string>): void {
  localStorage.setItem(USER_COLOR_KEY, JSON.stringify(map));
}
function randomColor(): string {
  return USER_PALETTE[Math.floor(Math.random() * USER_PALETTE.length)];
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

/** Square initial-badge avatar. When the user is connected it "lights up" — a
 *  solid colour fill with a soft glow; offline it shows a dim tinted box with
 *  the coloured initial. Clicking opens the colour picker. */
function UserAvatar({ color, initial, online, onClick }: {
  color: string; initial: string; online: boolean; onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      title="Change colour"
      style={{
        width: 34, height: 34, borderRadius: 9, flexShrink: 0, padding: 0, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: MONO, fontSize: 13, fontWeight: 700,
        // Lit (online): solid fill + dark glyph + glow. Dim (offline): tinted box + coloured glyph.
        background: online ? color : `${color}1f`,
        color: online ? 'var(--onyx-bg)' : color,
        border: `1px solid ${online ? color : `${color}3a`}`,
        boxShadow: online ? `0 0 11px ${color}66` : 'none',
        transition: 'background 0.15s, box-shadow 0.15s, color 0.15s, border-color 0.15s',
      }}
    >
      {initial}
    </button>
  );
}

/** Glass popover anchored under an avatar (fixed-positioned so the row's scroll
 *  container can't clip it): curated palette swatches + a native full-spectrum
 *  custom input. Closes on outside click (handled by the caller). */
function ColorPickerPopover({ value, onPick, popRef, pos }: {
  value: string; onPick: (hex: string) => void;
  popRef: React.RefObject<HTMLDivElement | null>; pos: { x: number; y: number };
}) {
  const W = 168;
  const left = Math.min(pos.x, window.innerWidth - W - 12);
  return (
    <div
      ref={popRef}
      onClick={e => e.stopPropagation()}
      style={{
        position: 'fixed', top: pos.y, left, zIndex: 600,
        background: 'var(--onyx-panel2)', backdropFilter: 'blur(40px) saturate(120%)',
        WebkitBackdropFilter: 'blur(40px) saturate(120%)',
        border: '1px solid var(--onyx-glass-edge)', borderRadius: 10,
        boxShadow: '0 16px 40px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)',
        padding: 12, width: W,
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 7 }}>
        {USER_PALETTE.map(c => {
          const active = c.toLowerCase() === value.toLowerCase();
          return (
            <button
              key={c}
              onClick={() => onPick(c)}
              title={c}
              style={{
                width: 20, height: 20, borderRadius: 6, cursor: 'pointer', padding: 0, background: c,
                border: active ? '2px solid var(--onyx-text)' : '1px solid rgba(255,255,255,0.18)',
                boxShadow: active ? `0 0 8px ${c}88` : 'none',
              }}
            />
          );
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 11, paddingTop: 11, borderTop: '1px solid var(--onyx-line)' }}>
        <label style={{ position: 'relative', width: 22, height: 22, flexShrink: 0, cursor: 'pointer', borderRadius: 6, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.18)', display: 'block' }}>
          <input
            type="color"
            value={value}
            onChange={e => onPick(e.target.value)}
            style={{ position: 'absolute', inset: -4, width: 'calc(100% + 8px)', height: 'calc(100% + 8px)', border: 'none', padding: 0, background: 'none', cursor: 'pointer' }}
          />
        </label>
        <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em' }}>Custom</span>
        <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-dim)', marginLeft: 'auto', textTransform: 'uppercase' }}>{value}</span>
      </div>
    </div>
  );
}

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
  /** Called with the validated field values, email, the enable flag, and the full
   *  permissions blob. Should throw on server errors. */
  onSubmit: (username: string, password: string, type: 'user' | 'admin', email: string, enable: boolean, permissions: UserPermissions) => Promise<void>;
  onCancel: () => void;
}

/** A pill switch used inside the UserModal form. Sets type="button" so toggling
 *  a permission never submits the surrounding <form>. */
function PermToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      style={{
        width: 36, height: 20, borderRadius: 10, padding: 0, flexShrink: 0,
        background: on ? 'var(--onyx-accent)' : 'rgba(255,255,255,0.12)',
        border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 0.15s',
      }}
    >
      <div style={{
        position: 'absolute', top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: 8,
        background: on ? 'var(--onyx-bg)' : '#ebe7df', transition: 'left 0.15s',
      }} />
    </button>
  );
}

/** A labelled permission row: name on the left, toggle on the right. */
function PermRow({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ fontSize: 12.5, color: 'var(--onyx-text)' }}>{label}</span>
      <PermToggle on={on} onChange={onChange} />
    </div>
  );
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

  // Email + the account-enable flag (both add and edit).
  const [email, setEmail] = useState(editUser?.email ?? '');
  const [enable, setEnable] = useState(editUser?.isActive ?? true);

  // ── Permissions state — seeded from the user when editing, else ABS defaults
  // (only download + access-all-libraries/tags default on). Shown in both add and
  // edit so a new account can be fully configured at creation time. ──
  const seed = editUser?.permissions;
  const seedLibs = editUser?.librariesAccessible ?? seed?.librariesAccessible ?? [];
  const seedTags = editUser?.itemTagsSelected ?? seed?.itemTagsSelected ?? [];
  const [canDownload, setCanDownload] = useState(seed?.download ?? true);
  const [canUpdate, setCanUpdate] = useState(seed?.update ?? false);
  const [canDelete, setCanDelete] = useState(seed?.delete ?? false);
  const [canUpload, setCanUpload] = useState(seed?.upload ?? false);
  const [canCreateEreader, setCanCreateEreader] = useState(seed?.createEreader ?? false);
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
      // Build the full permissions blob from the editor state (both add + edit),
      // so a new account is created exactly as configured rather than relying on
      // server defaults.
      const permissions: UserPermissions = {
        download: canDownload,
        update: canUpdate,
        delete: canDelete,
        upload: canUpload,
        createEreader: canCreateEreader,
        accessAllLibraries,
        librariesAccessible: accessAllLibraries ? [] : librariesAccessible,
        accessAllTags,
        itemTagsSelected: accessAllTags ? [] : itemTagsSelected,
        selectedTagsNotAccessible: tagsExclusive,
        accessExplicitContent: accessExplicit,
      };
      await onSubmit(username.trim(), password, userType, email.trim(), enable, permissions);
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

  // Two-column field/permission grid — the wider modal lets fields and the
  // permission toggles sit side by side, matching Skald's roomier settings panes.
  const twoCol: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 28, rowGap: 16 };
  // Indented detail box that holds the per-library / per-tag pickers.
  const pickerBox: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: 8,
    padding: '12px 14px', borderRadius: 8,
    background: 'rgba(0,0,0,0.18)', border: '1px solid var(--onyx-glass-edge)',
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
          width: 560,
          maxWidth: '92vw',
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

        {/* Identity — username + password side by side */}
        <div style={twoCol}>
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
          <div>
            <div style={fieldLabel}>
              Password
              {/* Show the "optional" hint only in edit mode. */}
              {isEdit && (
                <span style={{
                  fontFamily: MONO, fontSize: 9, color: 'var(--onyx-text-mute)',
                  marginLeft: 8, letterSpacing: '0.04em', textTransform: 'none', fontWeight: 400,
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
        </div>

        {/* Email — full width */}
        <div>
          <div style={fieldLabel}>Email <span style={{ textTransform: 'none', letterSpacing: '0.04em', fontWeight: 400 }}>(optional)</span></div>
          <input
            style={fieldInput}
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="email@example.com"
            spellCheck={false}
          />
        </div>

        {/* Account type + enable, side by side */}
        <div style={twoCol}>
          <div>
            <div style={fieldLabel}>Account type</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Pill active={userType === 'user'} onClick={() => setUserType('user')}>user</Pill>
              <Pill active={userType === 'admin'} onClick={() => setUserType('admin')}>admin</Pill>
            </div>
          </div>
          <div>
            <div style={fieldLabel}>Enabled</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 30 }}>
              <PermToggle on={enable} onChange={setEnable} />
              <span style={{ fontSize: 12, color: 'var(--onyx-text-dim)' }}>{enable ? 'Account active' : 'Account disabled'}</span>
            </div>
          </div>
        </div>

        {/* ── Permissions (shown for both add + edit) — two columns of toggles ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 8, borderTop: '1px solid var(--onyx-line)' }}>
          <div style={fieldLabel}>Permissions</div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 28, rowGap: 13 }}>
            <PermRow label="Can Download"                on={canDownload}        onChange={setCanDownload} />
            <PermRow label="Can Update"                  on={canUpdate}          onChange={setCanUpdate} />
            <PermRow label="Can Delete"                  on={canDelete}          onChange={setCanDelete} />
            <PermRow label="Can Upload"                  on={canUpload}          onChange={setCanUpload} />
            <PermRow label="Can Create Ereader"          on={canCreateEreader}   onChange={setCanCreateEreader} />
            <PermRow label="Can Access Explicit Content" on={accessExplicit}     onChange={setAccessExplicit} />
            <PermRow label="Can Access All Libraries"    on={accessAllLibraries} onChange={setAccessAllLibraries} />
            <PermRow label="Can Access All Tags"         on={accessAllTags}      onChange={setAccessAllTags} />
          </div>

          {/* Library picker — shown when access-all is off (full width, 2-col list). */}
          {!accessAllLibraries && (
            <div style={pickerBox}>
              <div style={fieldLabel}>Accessible libraries</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px 20px', maxHeight: 150, overflowY: 'auto' }}>
                {libraries.length === 0 && <div style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--onyx-text-mute)' }}>No libraries found.</div>}
                {libraries.map(lib => (
                  <label key={lib.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--onyx-text-dim)', cursor: 'pointer' }}>
                    <input type="checkbox" style={{ accentColor: 'var(--onyx-accent)' }} checked={librariesAccessible.includes(lib.id)} onChange={() => setLibrariesAccessible(prev => toggleInArray(prev, lib.id))} />
                    {lib.name}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Tag picker — shown when access-all is off: inclusive/exclusive mode
              plus the selectable tag chips. */}
          {!accessAllTags && (
            <div style={pickerBox}>
              <div style={fieldLabel}>Accessible tags</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Pill active={!tagsExclusive} onClick={() => setTagsExclusive(false)}>only selected</Pill>
                <Pill active={tagsExclusive} onClick={() => setTagsExclusive(true)}>all except</Pill>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 150, overflowY: 'auto' }}>
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
