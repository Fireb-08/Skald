// Admin create/edit user modal, including the access-control (permissions)
// editor from cluster H.
// Moved verbatim out of AccountSection.tsx (God-File Decomposition roadmap, L3/L7).
import { useState } from 'react';
import { SERIF, MONO, Pill } from '../shared';
import type { AdminUser, UserPermissions } from '../../../api/abs';
import { useModalFocus } from '../../../hooks/useModalFocus';
import { errorMessage } from '../../../lib/presentError';
import { log } from '../../../lib/log';

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
export default function UserModal({
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
  const dialogRef = useModalFocus<HTMLFormElement>(onCancel, !pending);

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
      log.warn('auth', 'user account mutation failed', { isEdit, err: String(err) });
      setError(errorMessage(err, { operation: 'save' }));
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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-modal-title"
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
        <div id="user-modal-title" style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 500, color: 'var(--onyx-text)' }}>
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
