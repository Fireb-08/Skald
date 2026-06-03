// ListeningSessionsSection — shown under Settings → Playback → Sessions.
//
// Two Glass cards stacked vertically:
//   1. Listening Sessions — paginated historical table with user filter (admin)
//      and per-row delete (admin).
//   2. Open Listening Sessions — sessions updated within the last 5 minutes,
//      auto-refreshed every 30 s. (ABS has no dedicated open-sessions endpoint;
//      recency of updatedAt is used as a proxy for an active/open session.)

import { useState, useEffect, useCallback } from 'react';
import type { OnyxState } from '../../state/onyx';
import { SERIF, MONO } from './shared';
import ConfirmDialog from '../ui/ConfirmDialog';
import {
  getListeningSessions,
  deleteSession,
  getAllUsers,
} from '../../api/abs';
import type { ListeningSession, AdminUser } from '../../api/abs';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Format seconds as "Xh Ym" or "Xm" for the Time Listened column. */
function fmtDuration(secs: number | null): string {
  if (secs === null || secs <= 0) return '—';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.round(secs)}s`;
}

/** Format seconds as "H:MM:SS" for the Last Time (position) column. */
function fmtTimecode(secs: number | null): string {
  if (secs === null || secs < 0) return '—';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Human-readable relative time from a Unix-ms timestamp. */
function relativeTime(ms: number | null): string {
  if (ms === null) return '—';
  const diff = Date.now() - ms;
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Convert ABS playMethod integer to a short label. */
function fmtPlayMethod(method: number | null): string {
  switch (method) {
    case 0: return 'Direct';
    case 1: return 'Stream';
    case 2: return 'Transcode';
    case 3: return 'Local';
    default: return '—';
  }
}

// ── Sub-components ──────────────────────────────────────────────────────────

// Feather-style trash SVG for the delete row button (matches AccountSection).
const TrashIcon = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

// Column header cell — mono, uppercase, muted.
function TH({ children, w }: { children?: React.ReactNode; w?: number }) {
  return (
    <th style={{
      fontFamily: MONO,
      fontSize: 9,
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      color: 'var(--onyx-text-mute)',
      fontWeight: 400,
      textAlign: 'left',
      padding: '0 12px 10px 0',
      whiteSpace: 'nowrap',
      width: w,
    }}>
      {children}
    </th>
  );
}

// Data cell — consistent padding, clipping.
function TD({
  children,
  muted,
}: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <td style={{
      padding: '10px 12px 10px 0',
      borderTop: '1px solid var(--onyx-line)',
      fontSize: 13,
      color: muted ? 'var(--onyx-text-mute)' : 'var(--onyx-text)',
      verticalAlign: 'top',
      maxWidth: 0, // allows text-overflow inside a table cell
    }}>
      {children}
    </td>
  );
}

// One row in the sessions table.
function SessionRow({
  session,
  showUser,
  showDelete,
  onDelete,
}: {
  session: ListeningSession;
  showUser: boolean;     // only admin sees the USER column
  showDelete: boolean;   // only admin sees the delete button
  onDelete: () => void;
}) {
  return (
    <tr>
      {/* ITEM: title + author in muted subtext */}
      <TD>
        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {session.displayTitle ?? '—'}
        </div>
        {session.author && (
          // Muted author line below title
          <div style={{ fontFamily: MONO, fontSize: 9, color: 'var(--onyx-text-mute)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {session.author}
          </div>
        )}
      </TD>

      {/* USER — admin only */}
      {showUser && (
        <TD muted>
          <span style={{ fontFamily: MONO, fontSize: 11 }}>
            {session.username ?? session.userId.slice(0, 8)}
          </span>
        </TD>
      )}

      {/* DEVICE INFO: client name + method */}
      <TD muted>
        <div style={{ fontFamily: MONO, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {session.deviceInfo?.clientName ?? '—'}
        </div>
        <div style={{ fontFamily: MONO, fontSize: 9, color: 'var(--onyx-text-mute)', marginTop: 2 }}>
          {fmtPlayMethod(session.playMethod)}
        </div>
      </TD>

      {/* TIME LISTENED */}
      <TD muted>
        <span style={{ fontFamily: MONO, fontSize: 12 }}>
          {fmtDuration(session.timeListening)}
        </span>
      </TD>

      {/* LAST TIME (playback position) */}
      <TD muted>
        <span style={{ fontFamily: MONO, fontSize: 12 }}>
          {fmtTimecode(session.currentTime)}
        </span>
      </TD>

      {/* LAST UPDATE */}
      <TD muted>
        <span style={{ fontFamily: MONO, fontSize: 11 }}>
          {relativeTime(session.updatedAt)}
        </span>
      </TD>

      {/* DELETE — admin only */}
      {showDelete && (
        <td style={{ padding: '10px 0', borderTop: '1px solid var(--onyx-line)', verticalAlign: 'top' }}>
          <button
            onClick={onDelete}
            title="Delete session"
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              border: 'none',
              background: 'transparent',
              color: '#e8716a', // danger red — matches AccountSection
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
            }}
          >
            {TrashIcon}
          </button>
        </td>
      )}
    </tr>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export interface ListeningSessionsSectionProps {
  st: OnyxState;
}

export default function ListeningSessionsSection({ st }: ListeningSessionsSectionProps) {
  // Admin gate — drives the user-filter dropdown and the delete button.
  // st?.user?.type uses optional chaining on st itself to survive HMR transient renders
  // where st may be undefined before the parent has re-rendered with valid props.
  const isAdmin = st?.user?.type === 'admin' || st?.user?.type === 'root';

  // ── Historical sessions state ───────────────────────────────────────────
  const [sessions, setSessions]           = useState<ListeningSession[]>([]);
  const [total, setTotal]                 = useState(0);
  const [numPages, setNumPages]           = useState(1);
  const [page, setPage]                   = useState(0); // 0-indexed, matches ABS
  const [itemsPerPage, setItemsPerPage]   = useState(10);
  // Admin-only: filter by a specific user. undefined = own sessions.
  const [filterUserId, setFilterUserId]   = useState<string | undefined>(undefined);
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState('');

  // Confirm dialog state for session deletion.
  const [deleteTarget, setDeleteTarget]   = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  // Admin-only: full user list for the filter dropdown.
  const [allUsers, setAllUsers]           = useState<AdminUser[]>([]);

  // ── Open sessions state ─────────────────────────────────────────────────
  const [openSessions, setOpenSessions]   = useState<ListeningSession[]>([]);
  const [openLoading, setOpenLoading]     = useState(false);

  // ── Fetch helpers ────────────────────────────────────────────────────────

  // Fetch a page of historical sessions. Wrapped in useCallback so it can be
  // called from effects and from pagination controls without stale closures.
  const loadSessions = useCallback(async (
    uid: string | undefined,
    pg: number,
    perPage: number,
  ) => {
    if (!st?.serverUrl) return; // optional chaining: safe when st is transiently undefined
    setLoading(true);
    setError('');
    try {
      const res = await getListeningSessions(st.serverUrl, uid, pg, perPage); // st defined: guard passed
      setSessions(res.sessions);
      setTotal(res.total);
      // numPages from the server may be 0 when there are no sessions — clamp to 1.
      setNumPages(Math.max(1, res.numPages));
    } catch (e) {
      setError(typeof e === 'string' ? e : (e as Error)?.message ?? 'Failed to load sessions.');
    } finally {
      setLoading(false);
    }
  }, [st?.serverUrl]); // dep array: optional chaining prevents crash when st is undefined

  // Fetch open sessions — page 0, large page to capture all recent activity —
  // then filter client-side to sessions updated within the last 5 minutes.
  // This is a proxy because ABS has no dedicated open-sessions endpoint.
  const loadOpenSessions = useCallback(async () => {
    if (!st?.serverUrl) return; // optional chaining: safe when st is transiently undefined
    setOpenLoading(true);
    try {
      // Fetch a generous page so we don't miss recently active sessions.
      const res = await getListeningSessions(st.serverUrl, undefined, 0, 50); // st defined: guard passed
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000; // 5-minute recency window
      // A session is considered "open" if its updatedAt is within the last 5 minutes.
      const open = res.sessions.filter(s => s.updatedAt !== null && s.updatedAt > fiveMinutesAgo);
      setOpenSessions(open);
    } catch {
      // Open sessions are best-effort; silently ignore errors to avoid cluttering the UI.
    } finally {
      setOpenLoading(false);
    }
  }, [st?.serverUrl]); // dep array: optional chaining prevents crash when st is undefined

  // ── Effects ──────────────────────────────────────────────────────────────

  // Load admin user list once on mount — needed for the filter dropdown.
  useEffect(() => {
    if (!isAdmin || !st?.serverUrl) return; // optional chaining: safe when st is transiently undefined
    getAllUsers(st.serverUrl).then(setAllUsers).catch(console.error); // st defined: guard passed
  }, [isAdmin, st?.serverUrl]); // dep array: optional chaining on st

  // Reload historical sessions whenever filter, page, or page size changes.
  useEffect(() => {
    loadSessions(filterUserId, page, itemsPerPage);
  }, [loadSessions, filterUserId, page, itemsPerPage]);

  // Load open sessions on mount and refresh every 30 seconds automatically.
  useEffect(() => {
    loadOpenSessions();
    const timer = setInterval(loadOpenSessions, 30_000); // 30-second auto-refresh
    return () => clearInterval(timer); // clean up on unmount
  }, [loadOpenSessions]);

  // Guard against rendering before auth state is loaded — st.user is null on
  // first render when the app starts without a stored session token. All hooks
  // above have already been called unconditionally (required by React's rules of
  // hooks), so this early return is safe here after all useState/useCallback/useEffect.
  if (!st?.user) {
    return (
      <div style={{ color: 'var(--onyx-text-mute)', fontSize: 13, padding: 24 }}>
        Loading…
      </div>
    );
  }

  // ── Delete handler ────────────────────────────────────────────────────────

  async function handleDeleteConfirmed() {
    if (!deleteTarget || !st.serverUrl) return;
    setDeletePending(true);
    try {
      await deleteSession(st.serverUrl, deleteTarget);
      // Refresh both lists after a successful deletion.
      await Promise.all([
        loadSessions(filterUserId, page, itemsPerPage),
        loadOpenSessions(),
      ]);
    } catch (e) {
      setError(typeof e === 'string' ? e : (e as Error)?.message ?? 'Delete failed.');
    } finally {
      setDeletePending(false);
      setDeleteTarget(null);
    }
  }

  // ── Table shared styles ────────────────────────────────────────────────────

  const tableStyle: React.CSSProperties = {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

      {/* ── Card 1: Historical listening sessions ─────────────────────────── */}
      <div>
        {/* Card header: title + admin user-filter dropdown */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 500 }}>
            Listening Sessions
          </div>

          {/* Admin-only filter dropdown — lets admins view any user's sessions */}
          {isAdmin && allUsers.length > 0 && (
            <select
              value={filterUserId ?? ''}
              onChange={e => {
                // Reset to page 0 when the user filter changes.
                setPage(0);
                setFilterUserId(e.target.value || undefined);
              }}
              style={{
                padding: '6px 10px',
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid var(--onyx-glass-edge)',
                borderRadius: 7,
                color: 'var(--onyx-text)',
                fontFamily: MONO,
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              {/* Default: own sessions (no user_id filter) */}
              <option value="">My sessions</option>
              {allUsers.map(u => (
                <option key={u.id} value={u.id}>{u.username}</option>
              ))}
            </select>
          )}
        </div>

        {/* Error banner */}
        {error && (
          <div style={{ fontFamily: MONO, fontSize: 11, color: '#e8716a', marginBottom: 12 }}>
            {error}
          </div>
        )}

        {/* Sessions table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <TH>Item</TH>
                {/* USER column only visible to admins */}
                {isAdmin && <TH w={90}>User</TH>}
                <TH w={120}>Device</TH>
                <TH w={80}>Listened</TH>
                <TH w={80}>Position</TH>
                <TH w={80}>Updated</TH>
                {/* Delete column header — admin only */}
                {isAdmin && <TH w={32}></TH>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                // Loading placeholder row
                <tr>
                  <td colSpan={isAdmin ? 7 : 5} style={{ padding: '18px 0', fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)' }}>
                    Loading…
                  </td>
                </tr>
              ) : sessions.length === 0 ? (
                // Empty state
                <tr>
                  <td colSpan={isAdmin ? 7 : 5} style={{ padding: '18px 0', fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)' }}>
                    No sessions found.
                  </td>
                </tr>
              ) : (
                sessions.map(s => (
                  <SessionRow
                    key={s.id}
                    session={s}
                    showUser={isAdmin}
                    showDelete={isAdmin}
                    // Clicking delete opens the confirmation dialog.
                    onDelete={() => setDeleteTarget(s.id)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 14, fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)' }}>
          {/* Rows-per-page selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>Rows per page:</span>
            <select
              value={itemsPerPage}
              onChange={e => {
                // Reset to page 0 when the page size changes.
                setPage(0);
                setItemsPerPage(Number(e.target.value));
              }}
              style={{
                padding: '4px 8px',
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid var(--onyx-glass-edge)',
                borderRadius: 5,
                color: 'var(--onyx-text)',
                fontFamily: MONO,
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
          </div>

          {/* Page indicator */}
          <span>Page {page + 1} of {numPages}</span>
          <span style={{ color: 'var(--onyx-text-mute)', fontSize: 10 }}>({total} total)</span>

          {/* Prev / Next buttons */}
          <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              style={{
                padding: '5px 12px',
                background: 'transparent',
                border: '1px solid var(--onyx-glass-edge)',
                borderRadius: 6,
                color: page === 0 ? 'var(--onyx-text-mute)' : 'var(--onyx-text)',
                fontFamily: MONO,
                fontSize: 10,
                cursor: page === 0 ? 'default' : 'pointer',
                opacity: page === 0 ? 0.4 : 1,
              }}
            >
              ← Prev
            </button>
            <button
              onClick={() => setPage(p => Math.min(numPages - 1, p + 1))}
              disabled={page >= numPages - 1}
              style={{
                padding: '5px 12px',
                background: 'transparent',
                border: '1px solid var(--onyx-glass-edge)',
                borderRadius: 6,
                color: page >= numPages - 1 ? 'var(--onyx-text-mute)' : 'var(--onyx-text)',
                fontFamily: MONO,
                fontSize: 10,
                cursor: page >= numPages - 1 ? 'default' : 'pointer',
                opacity: page >= numPages - 1 ? 0.4 : 1,
              }}
            >
              Next →
            </button>
          </div>
        </div>
      </div>

      {/* ── Card 2: Open listening sessions ─────────────────────────────────── */}
      <div style={{ paddingTop: 24, borderTop: '1px solid var(--onyx-line)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 18 }}>
          <div style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 500 }}>
            Open Listening Sessions
          </div>
          {/* Auto-refresh indicator */}
          <span style={{ fontFamily: MONO, fontSize: 9, color: 'var(--onyx-text-mute)', letterSpacing: '0.08em' }}>
            refreshes every 30s
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <TH>Item</TH>
                {isAdmin && <TH w={90}>User</TH>}
                <TH w={120}>Device</TH>
                <TH w={80}>Listened</TH>
                <TH w={80}>Position</TH>
                <TH w={80}>Updated</TH>
                {/* No delete in the open sessions panel — admins can delete via the history table */}
              </tr>
            </thead>
            <tbody>
              {openLoading ? (
                <tr>
                  <td colSpan={isAdmin ? 6 : 5} style={{ padding: '18px 0', fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)' }}>
                    Loading…
                  </td>
                </tr>
              ) : openSessions.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 6 : 5} style={{ padding: '18px 0', fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-mute)' }}>
                    No open sessions detected in the last 5 minutes.
                  </td>
                </tr>
              ) : (
                openSessions.map(s => (
                  <SessionRow
                    key={s.id}
                    session={s}
                    showUser={isAdmin}
                    showDelete={false} // no delete from the open sessions panel
                    onDelete={() => {}} // no-op — showDelete=false hides the button
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete confirmation dialog — rendered at the top level so it overlays everything */}
      {deleteTarget && (
        <ConfirmDialog
          title="Delete session?"
          message="This will permanently remove the session record from the server. This cannot be undone."
          confirmLabel={deletePending ? 'Deleting…' : 'Delete'}
          danger
          onConfirm={handleDeleteConfirmed}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
