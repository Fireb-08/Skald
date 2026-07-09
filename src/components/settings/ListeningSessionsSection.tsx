// ListeningSessionsSection — shown under Settings → Playback → Sessions.
//
// Two Glass cards stacked vertically:
//   1. Listening Sessions — paginated historical table with user filter (admin)
//      and per-row delete (admin).
//   2. Open Listening Sessions — currently active sessions from GET /api/users/online
//      (openSessions field), auto-refreshed every 30 s.

import { useState, useEffect, useCallback } from 'react'; // useMemo removed — sort is now server-side
import type { OnyxState } from '../../state/onyx';
import { SERIF, MONO } from './shared';
import ConfirmDialog from '../ui/ConfirmDialog';
import {
  getListeningSessions,
  deleteSession,
  getAllUsers,
  getOpenSessions, // new: fetches open sessions from GET /api/users/online → openSessions
} from '../../api/abs';
import type { ListeningSession, AdminUser } from '../../api/abs';
import { log } from '../../lib/log';

// ── Sort value extractor ────────────────────────────────────────────────────

// Returns the value used for sorting a session by the given column key.
// Handles nested fields (device client name, cross-endpoint username) that
// cannot be reached by simple dynamic property access.
function getSortVal(s: ListeningSession, key: string): string | number {
  switch (key) {
    case 'displayTitle':  return s.displayTitle ?? '';             // ITEM column
    case 'username':      return s.username ?? s.user?.username ?? ''; // USER — flat or nested
    case 'device':        return s.deviceInfo?.clientName ?? '';   // DEVICE INFO column
    case 'timeListening': return s.timeListening ?? 0;             // TIME LISTENED
    case 'currentTime':   return s.currentTime ?? 0;              // LAST TIME (position)
    case 'updatedAt':     return s.updatedAt ?? 0;                // LAST UPDATE
    default:              return '';
  }
}

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
// When onClick is supplied the cell is sortable: a ▲/▼ indicator shows on the active column.
function TH({
  children,
  w,
  onClick,  // supplied for sortable columns; omitted for non-sortable (delete, actions)
  active,   // true when this column is the current sort key
  dir,      // current sort direction — drives the ▲/▼ indicator
}: {
  children?: React.ReactNode;
  w?: number;
  onClick?: () => void;
  active?: boolean;
  dir?: 'asc' | 'desc';
}) {
  return (
    <th
      onClick={onClick}
      style={{
        fontFamily: MONO,
        fontSize: 9,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: active ? 'var(--onyx-accent)' : 'var(--onyx-text-mute)', // accent on active column
        fontWeight: active ? 600 : 400, // bold on active column
        textAlign: 'left',
        padding: '0 12px 10px 0',
        whiteSpace: 'nowrap',
        width: w,
        cursor: onClick ? 'pointer' : undefined, // pointer cursor when sortable
        userSelect: 'none', // prevent text selection on rapid double-clicks
      }}
    >
      {children}
      {/* Sort direction arrow — only shown on the active sort column */}
      {active && (
        <span style={{ marginLeft: 4, fontSize: 8 }}>
          {dir === 'asc' ? '▲' : '▼'}
        </span>
      )}
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
            {/* Prefer flat username (per-user endpoints), fall back to the nested user object
                (GET /api/sessions), then the first 8 chars of userId as a last resort. */}
            {session.username ?? session.user?.username ?? session.userId.slice(0, 8)}
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
  const isAdmin = st.isAdmin;

  // ── Historical sessions state ───────────────────────────────────────────
  const [sessions, setSessions]           = useState<ListeningSession[]>([]);
  const [total, setTotal]                 = useState(0);
  const [numPages, setNumPages]           = useState(1);
  const [page, setPage]                   = useState(0); // 0-indexed, matches ABS
  const [itemsPerPage, setItemsPerPage]   = useState(10);
  // Filter selection — three states:
  //   null     → All Users (admin only, default for admins) → GET /api/sessions
  //   '__me__' → own sessions → GET /api/me/listening-sessions
  //   '<id>'   → specific user (admin only) → GET /api/users/{id}/listening-sessions
  // Defaults to null (All Users) so admins see cross-user data immediately on mount.
  const [filterUserId, setFilterUserId]   = useState<string | null>(null);
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

  // ── Sort state ────────────────────────────────────────────────────────────
  // Tracks which column is sorted and in which direction.
  // Default: sort by LAST UPDATE descending so newest sessions appear first.
  const [sortKey, setSortKey] = useState<string>('updatedAt'); // active sort column key
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc'); // active sort direction

  // Maps frontend sort keys to the ABS server sort field names it accepts.
  // null means the field is not top-level on the session object and cannot be
  // sorted server-side — those columns fall back to client-side sorting of the
  // current page only (noted in the relevant TH onClick handler).
  const SERVER_SORT_FIELDS: Record<string, string | null> = {
    displayTitle:  'displayTitle',  // session title — server-sortable
    username:      'userId',        // ABS sorts by userId; alphabetical by name is client-only
    device:        null,            // deviceInfo.clientName is nested — not server-sortable
    timeListening: 'timeListening', // seconds listened — server-sortable
    currentTime:   'currentTime',   // playback position — server-sortable
    updatedAt:     'updatedAt',     // last update timestamp — server-sortable
  };

  // ── Fetch helpers ────────────────────────────────────────────────────────

  // Fetch a page of historical sessions. Wrapped in useCallback so it can be
  // called from effects and from pagination controls without stale closures.
  // sk/sd (sort key/direction) are passed as parameters rather than captured in
  // the closure so the callback identity stays stable and doesn't force effect re-runs.
  const loadSessions = useCallback(async (
    uid: string | null,     // null = All Users; '__me__' = own; '<id>' = specific user
    pg: number,
    perPage: number,
    sk: string,             // active sort column key (e.g. 'updatedAt', 'device')
    sd: 'asc' | 'desc',    // active sort direction
  ) => {
    if (!st?.serverUrl) return; // optional chaining: safe when st is transiently undefined
    setLoading(true);
    setError('');
    try {
      // Non-admin users always fetch their own sessions regardless of uid.
      const effectiveUid = isAdmin ? uid : '__me__';

      // Look up whether this column has a server-side sort field.
      // null means the field is nested/derived and must be sorted client-side.
      const serverField = SERVER_SORT_FIELDS[sk] ?? null; // null = no server sort for this column

      const res = await getListeningSessions(
        st.serverUrl,
        effectiveUid,
        pg,
        perPage,
        serverField ?? undefined,          // undefined omits the sort param entirely
        serverField ? sd === 'desc' : undefined, // only send desc when server sort applies
      );

      // For columns with a server sort field, the response is already ordered correctly.
      // For client-only columns (currently 'device'), sort the current page client-side.
      // Note: client-side sort only applies to the visible page, not the full dataset.
      const result = serverField
        ? res.sessions
        : [...res.sessions].sort((a, b) => {
            const av = getSortVal(a, sk); // extract comparable value for row a
            const bv = getSortVal(b, sk); // extract comparable value for row b
            if (typeof av === 'number' && typeof bv === 'number') {
              return sd === 'asc' ? av - bv : bv - av; // numeric comparison
            }
            const as = String(av).toLowerCase();
            const bs = String(bv).toLowerCase();
            return sd === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as); // string comparison
          });

      setSessions(result); // already sorted (server or client fallback)
      setTotal(res.total);
      // numPages from the server may be 0 when there are no sessions — clamp to 1.
      setNumPages(Math.max(1, res.numPages));
    } catch (e) {
      setError(typeof e === 'string' ? e : (e as Error)?.message ?? 'Failed to load sessions.');
    } finally {
      setLoading(false);
    }
  }, [st?.serverUrl]); // dep array: serverUrl is the key lifecycle trigger; sk/sd are params

  // Fetch currently active sessions from GET /api/users/online → openSessions.
  // This is the authoritative real-time source — no proxy filtering needed.
  const loadOpenSessions = useCallback(async () => {
    if (!st?.serverUrl) return; // optional chaining: safe when st is transiently undefined
    setOpenLoading(true);
    try {
      // getOpenSessions calls GET /api/users/online and returns the openSessions array directly.
      // This replaces the old 5-minute updatedAt proxy which could miss long sessions.
      const sessions = await getOpenSessions(st.serverUrl); // st defined: guard passed
      setOpenSessions(sessions); // all currently active sessions across all users
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
    getAllUsers(st.serverUrl).then(setAllUsers).catch(e => log.error('playback', 'getAllUsers for session filter failed', { err: String(e) })); // st defined: guard passed
  }, [isAdmin, st?.serverUrl]); // dep array: optional chaining on st

  // Reload historical sessions whenever filter, page, page size, or sort changes.
  // sortKey/sortDir are now in the dep array so any sort change triggers a refetch
  // with the new ordering applied server-side to the full dataset.
  useEffect(() => {
    loadSessions(filterUserId, page, itemsPerPage, sortKey, sortDir); // pass current sort
  }, [loadSessions, filterUserId, page, itemsPerPage, sortKey, sortDir]); // sortKey/Dir added

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
      // Refresh both lists after a successful deletion, preserving the active sort.
      await Promise.all([
        loadSessions(filterUserId, page, itemsPerPage, sortKey, sortDir), // preserve active sort
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

          {/* Admin-only filter dropdown — not shown to non-admins */}
          {isAdmin && (
            <select
              // null (All Users) maps to the empty-string option value.
              value={filterUserId ?? ''}
              onChange={e => {
                // Reset to page 0 whenever the user filter changes.
                setPage(0);
                const val = e.target.value;
                // '' → null (All Users); any other string passes through as-is.
                setFilterUserId(val === '' ? null : val);
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
              {/* All Users — default for admins; maps to null → GET /api/sessions */}
              <option value="">All Users</option>
              {/* My sessions — '__me__' sentinel → GET /api/me/listening-sessions */}
              <option value="__me__">My sessions</option>
              {/* Per-user options — specific user ID → GET /api/users/{id}/listening-sessions */}
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
          {/* handleSort: toggle direction when clicking the active column; switch+reset when
              clicking a different column. Always resets to page 1 since the full dataset
              reorders server-side, so the current page content changes entirely. */}
          {(() => {
            const handleSort = (key: string, defaultDir: 'asc' | 'desc' = 'desc') => {
              if (sortKey === key) {
                setSortDir(d => d === 'asc' ? 'desc' : 'asc'); // toggle direction on active column
              } else {
                setSortKey(key);        // switch to new column
                setSortDir(defaultDir); // sensible default for this column type
              }
              setPage(0); // always reset to page 1 — entire dataset order changes
            };
            return (
          <table style={tableStyle}>
            <thead>
              <tr>
                {/* Each sortable header is clickable; active/dir drive the ▲/▼ indicator */}
                <TH onClick={() => handleSort('displayTitle', 'desc')} active={sortKey === 'displayTitle'} dir={sortDir}>Item</TH>
                {/* USER column only visible to admins; sorts by userId server-side */}
                {isAdmin && <TH w={90} onClick={() => handleSort('username', 'asc')} active={sortKey === 'username'} dir={sortDir}>User</TH>}
                {/* DEVICE sorts client-side only — deviceInfo.clientName is not a top-level field */}
                <TH w={120} onClick={() => handleSort('device', 'asc')} active={sortKey === 'device'} dir={sortDir}>Device</TH>
                <TH w={80} onClick={() => handleSort('timeListening', 'desc')} active={sortKey === 'timeListening'} dir={sortDir}>Listened</TH>
                <TH w={80} onClick={() => handleSort('currentTime', 'desc')} active={sortKey === 'currentTime'} dir={sortDir}>Position</TH>
                <TH w={80} onClick={() => handleSort('updatedAt', 'desc')} active={sortKey === 'updatedAt'} dir={sortDir}>Updated</TH>
                {/* Delete column header — not sortable */}
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
                // Render sessions directly — server has already applied the sort order.
                // The 'device' column is sorted client-side inside loadSessions.
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
            ); // close the IIFE return
          })()} {/* close the IIFE — allows handleSort to close over setSortKey/setSortDir/setPage/sortKey */}
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
