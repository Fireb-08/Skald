// GreetingPane — shown in the left "In focus" slot of the Library screen
// before anything is playing. Same Glass card footprint (width 360, padding 28)
// as FocusPanel, so it slots in without disturbing the layout.
//
// Composition, top → bottom:
//   · gold hairline at the top edge
//   · live date eyebrow (mono)
//   · time-aware greeting with the user's name (serif)
//   · Your stats / Library stats segmented toggle (persisted to localStorage)
//   · stats body — scrolls within the pane
//   · footer strip — In library / In progress / Finished (always present, local data)

import { useState, useEffect } from 'react';
import type { OnyxState } from '../../state/onyx';
import { bookAuthor } from '../../state/onyx';
import type { UserStats, LibraryStats } from '../../api/abs';
import { getUserStats, getLibraryStats } from '../../api/abs';
import Glass from '../chrome/Glass';

// Font stacks match the rest of the app (FocusPanel.tsx constants).
const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const MONO  = "'JetBrains Mono', ui-monospace, monospace";

// ── Date / time helpers ────────────────────────────────────────────────────

// Format a Date as "YYYY-MM-DD" using LOCAL time so it matches ABS date keys
// which are also local-time based, not UTC.
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Build the last-7-days sparkline data from the ABS "days" map.
// Returns oldest-first (index 0 = 6 days ago, index 6 = today).
function buildLast7(days: Record<string, number>): Array<{ d: string; m: number }> {
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - 6 + i); // 6 days ago → today
    const key   = localDateKey(date);
    // ABS stores day totals in milliseconds — divide by 60,000 for whole minutes
    const mins  = Math.round((days[key] ?? 0) / 60_000); // ms → minutes
    // "Mon", "Tue", etc. — slice to 3 chars for consistency.
    const label = date.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 3);
    return { d: label, m: mins };
  });
}

// Count consecutive listening days ending today (the streak).
function computeStreak(days: Record<string, number>): number {
  let streak = 0;
  const d = new Date();
  while ((days[localDateKey(d)] ?? 0) > 0) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

// Format listening seconds as a compact string: "9 min" or "3h 3m".
function fmtListeningTime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(m, 1)} min`;
}

// Format a "YYYY-MM-DD" date string as a human-readable relative label.
function relativeDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  // Treat the date as local midnight to avoid UTC-offset day shifts.
  const local = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const diffMs   = Date.now() - local.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  return `${diffDays} days ago`;
}

// ── Top-authors derived from local library ─────────────────────────────────
// ABS's /api/libraries/{id}/stats does not include per-author item counts,
// so we compute them from the already-loaded library items instead.
function topAuthorsFromLibrary(
  library: OnyxState['library'],
): Array<{ label: string; value: number }> {
  const map: Record<string, number> = {};
  library.forEach(item => {
    const a = bookAuthor(item);
    if (a && a !== 'Unknown Author') map[a] = (map[a] ?? 0) + 1;
  });
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, value]) => ({ label, value }));
}

// ── Shared presentational sub-components ──────────────────────────────────

// Section subheading — mono, small, muted, uppercase.
function SubHead({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: MONO,
      fontSize: 9.5,
      letterSpacing: '0.16em',
      textTransform: 'uppercase',
      color: 'var(--onyx-text-mute)',
    }}>
      {children}
    </div>
  );
}

// Large serif number + tiny mono label — used in the hero row of each page.
function BigStat({ value, label, w }: { value: string | number; label: string; w?: number }) {
  return (
    <div style={{ width: w, flexShrink: w ? 0 : undefined }}>
      {/* Number in serif 26/500 */}
      <div style={{ fontFamily: SERIF, fontSize: 26, fontWeight: 500, lineHeight: 1, color: 'var(--onyx-text)' }}>
        {value}
      </div>
      {/* Label in mono 9 uppercase */}
      <div style={{ marginTop: 4, fontFamily: MONO, fontSize: 9, color: 'var(--onyx-text-mute)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        {label}
      </div>
    </div>
  );
}

// Medium serif number + unit + mono label — used in the 4-up row below the sparkline.
function MiniStat({ value, unit, label }: { value: string | number; unit: string; label: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      {/* Number + unit baseline-aligned */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
        <span style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 500, color: 'var(--onyx-text)' }}>{value}</span>
        <span style={{ fontFamily: MONO, fontSize: 8.5, color: 'var(--onyx-text-mute)' }}>{unit}</span>
      </div>
      {/* Label below */}
      <div style={{ fontFamily: MONO, fontSize: 8.5, color: 'var(--onyx-text-mute)', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}

// 7-bar sparkline chart. Spec: height = max(4, round(m/max*88))px; zero = 2px stub.
function SparkBars({ data }: { data: Array<{ d: string; m: number }> }) {
  // Guard against all-zero data (max would be 0, causing NaN division).
  const max = Math.max(...data.map(d => d.m), 1);

  return (
    <div style={{ marginTop: 12, display: 'flex', alignItems: 'flex-end', gap: 8, height: 96 }}>
      {data.map((d, i) => {
        // Zero days render a 2px stub; non-zero bars scale to 88px maximum.
        const h     = d.m === 0 ? 2 : Math.max(4, Math.round((d.m / max) * 88));
        const isMax = d.m > 0 && d.m === max; // the tallest bar gets a glow
        return (
          <div
            key={i}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}
          >
            {/* Value label above bar — accent color on the max bar, muted otherwise */}
            <div style={{ fontFamily: MONO, fontSize: 8.5, color: isMax ? 'var(--onyx-accent)' : 'var(--onyx-text-mute)', height: 12, textAlign: 'center' }}>
              {d.m > 0 ? d.m : ''}
            </div>
            {/* Bar — gradient for non-zero, translucent stub for zero */}
            <div style={{
              width: '100%',
              height: h,
              borderRadius: 3,
              background: d.m === 0
                ? 'rgba(255,255,255,0.08)'
                : 'linear-gradient(180deg, var(--onyx-accent-bright), var(--onyx-accent))',
              boxShadow: isMax ? '0 0 12px var(--onyx-accent-edge)' : 'none',
            }} />
            {/* Day abbreviation below bar */}
            <div style={{ fontFamily: MONO, fontSize: 8.5, color: 'var(--onyx-text-mute)', letterSpacing: '0.04em' }}>
              {d.d}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Ranked bar row — used for both Top genres (no rank number) and Top authors (with rank).
// The filled track uses a gold gradient; rank number sits in a 14px mono gutter when present.
function RankBar({
  rank,
  label,
  display,
  pct,
}: {
  rank?: number;
  label: string;
  display: string | number;
  pct: number;
}) {
  return (
    <div>
      {/* Label row: optional rank, ellipsized label, right-aligned value */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5 }}>
        {rank != null && (
          <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--onyx-text-mute)', width: 14, flexShrink: 0 }}>
            {rank}
          </span>
        )}
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--onyx-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-accent)', flexShrink: 0 }}>
          {display}
        </span>
      </div>
      {/* Track bar — indented under label when a rank number is present */}
      <div style={{ height: 5, background: 'rgba(255,255,255,0.07)', borderRadius: 3, overflow: 'hidden', marginLeft: rank != null ? 22 : 0 }}>
        {/* Fill: dark-gold → accent left-to-right; minimum 4% so hairline bars stay visible */}
        <div style={{
          width: `${Math.max(4, pct)}%`,
          height: '100%',
          // accentDeep approximated via the r/g/b CSS vars at half opacity.
          background: 'linear-gradient(90deg, rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.5), var(--onyx-accent))',
          borderRadius: 3,
        }} />
      </div>
    </div>
  );
}

// Footer stat — mono label + serif number, always visible at the bottom of the pane.
function GreetStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      {/* Uppercase mono label */}
      <div style={{ fontFamily: MONO, fontSize: 9, color: 'var(--onyx-text-mute)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
        {label}
      </div>
      {/* Serif value */}
      <div style={{ marginTop: 3, fontFamily: SERIF, fontSize: 22, fontWeight: 500, color: 'var(--onyx-text)' }}>
        {value}
      </div>
    </div>
  );
}

// ── Your stats page ────────────────────────────────────────────────────────

function UserStatsPage({ stats, loading }: { stats: UserStats | null; loading: boolean }) {
  const ph = loading ? '…' : '—'; // placeholder value while fetching

  // Derive sparkline data from the ABS days map (empty map → all-zero bars).
  const last7       = buildLast7(stats?.days ?? {});
  const weekMinutes = last7.reduce((s, d) => s + d.m, 0);
  const dailyAvg    = Math.round(weekMinutes / 7);
  const bestDay     = Math.max(...last7.map(d => d.m), 0);
  const streak      = stats ? computeStreak(stats.days) : 0;

  // Show up to 3 recent sessions; the ABS endpoint returns them newest-first.
  const recentSessions = stats?.recentSessions.slice(0, 3) ?? [];

  return (
    // gap: 28 gives sections more breathing room across the available pane height.
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

      {/* Hero trio: Minutes · Days listened · Finished */}
      <div style={{ display: 'flex', gap: 24 }}>
        <BigStat
          // ABS returns totalTime in milliseconds — divide by 60,000 to get minutes
          value={stats ? Math.round((stats.totalTime ?? 0) / 60_000).toLocaleString() : ph}
          label="Minutes"
        />
        <BigStat value={stats ? stats.numDaysListened : ph} label="Days listened" />
        <BigStat value={stats ? stats.numBooksFinished : ph} label="Finished" />
      </div>

      {/* 7-day sparkline */}
      <div>
        <SubHead>Minutes listening · last 7 days</SubHead>
        <SparkBars data={last7} />
        {/* 4-up summary row below the sparkline */}
        <div style={{ display: 'flex', gap: 0, marginTop: 14 }}>
          <MiniStat value={loading ? ph : weekMinutes} unit="min" label="This week" />
          <MiniStat value={loading ? ph : dailyAvg}    unit="min" label="Daily avg" />
          <MiniStat value={loading ? ph : bestDay}     unit="min" label="Best day" />
          <MiniStat value={loading ? ph : streak} unit={streak === 1 ? 'day' : 'days'} label="Streak" />
        </div>
      </div>

      {/* Recent sessions */}
      <div>
        <SubHead>Recent sessions</SubHead>
        <div style={{ marginTop: 6 }}>
          {loading ? (
            // Subtle loading placeholder — one muted line of text
            <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', padding: '8px 0' }}>
              Loading…
            </div>
          ) : recentSessions.length === 0 ? (
            <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', padding: '8px 0' }}>
              No recent sessions.
            </div>
          ) : (
            recentSessions.map((r, i) => (
              <div
                key={r.id}
                style={{
                  display: 'flex', alignItems: 'baseline', gap: 10, padding: '7px 0',
                  // Divider line between rows; first row has none
                  borderTop: i === 0 ? 'none' : '1px solid var(--onyx-line)',
                }}
              >
                {/* Left: title + relative date */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--onyx-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.displayTitle ?? 'Unknown'}
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 9, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 1 }}>
                    {relativeDate(r.date)}
                  </div>
                </div>
                {/* Right: session duration in accent mono */}
                <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--onyx-accent)', flexShrink: 0 }}>
                  {fmtListeningTime(r.timeListening)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── Library stats page ─────────────────────────────────────────────────────

function LibraryStatsPage({
  stats,
  loading,
  library,
}: {
  stats: LibraryStats | null;
  loading: boolean;
  library: OnyxState['library'];
}) {
  const ph = loading ? '…' : '—';

  // ABS returns totalDuration in milliseconds — divide by 3,600,000 (ms → hours)
  const hours = stats ? Math.round((stats.totalDuration ?? 0) / 3_600_000).toLocaleString() : ph; // ms → hours
  // GiB: 1_073_741_824 = 2^30 bytes per gibibyte (matches how storage tools report audio sizes).
  const sizeGb = stats ? ((stats.totalAudioFilesSize ?? 0) / 1_073_741_824).toFixed(1) : ph; // bytes → GiB, one decimal

  // Top genres: compute pct relative to total items so bars are meaningful.
  const topGenres = (stats?.genres ?? []).slice(0, 4).map(g => ({
    label: g.genre,
    pct: stats && stats.totalItems > 0
      ? Math.round((g.count / stats.totalItems) * 100)
      : 0,
  }));

  // Top authors: derived from the local library (ABS stats endpoint omits author counts).
  const topAuthors   = topAuthorsFromLibrary(library);
  const maxAuthorVal = topAuthors[0]?.value ?? 1; // avoid division by zero

  return (
    // gap: 28 gives sections more breathing room across the available pane height.
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

      {/* Hero quad: Hours · Authors · Tracks · GB */}
      {/* Widths tuned to fit the four numbers in one row at 360px. */}
      <div style={{ display: 'flex', gap: 12 }}>
        <BigStat value={loading ? ph : hours}                           label="Hours"   w={74} />
        <BigStat value={stats ? stats.totalAuthors   : ph}              label="Authors" w={56} />
        <BigStat value={stats ? stats.numAudioTracks : ph}              label="Tracks"  w={56} />
        <BigStat value={loading ? ph : sizeGb}                         label="GB"      w={58} />
      </div>

      {/* Top genres — ranked bars without a rank number */}
      {topGenres.length > 0 && (
        <div>
          <SubHead>Top genres</SubHead>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 11 }}>
            {topGenres.map((g, i) => (
              <RankBar key={i} label={g.label} display={`${g.pct}%`} pct={g.pct} />
            ))}
          </div>
        </div>
      )}

      {/* Top authors — ranked bars with 1-based rank number in gutter */}
      {topAuthors.length > 0 && (
        <div>
          <SubHead>Top authors</SubHead>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 11 }}>
            {topAuthors.map((a, i) => (
              <RankBar
                key={i}
                rank={i + 1}
                label={a.label}
                display={a.value}
                // Bar width is proportional to the top author's count.
                pct={(a.value / maxAuthorVal) * 100}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export interface GreetingPaneProps {
  st: OnyxState;
  name: string;
}

export default function GreetingPane({ st, name }: GreetingPaneProps) {
  // Toggle state — persisted to localStorage so the user's choice survives reloads.
  const [page, setPage] = useState<'user' | 'library'>(
    () => (localStorage.getItem('onyx.greeting.tab') as 'user' | 'library') ?? 'user',
  );

  // Remote stats payloads — null while loading, filled after fetch completes.
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [libStats,  setLibStats]  = useState<LibraryStats | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [loadingLib,  setLoadingLib]  = useState(true);

  // ── Greeting / date derived from the real clock ──────────────────────────
  const now = new Date();
  const hr  = now.getHours();
  // Time-aware greeting: night < 5, morning < 12, afternoon < 17, evening < 21.
  const greeting =
    hr < 5  ? 'Still up'       :
    hr < 12 ? 'Good morning'   :
    hr < 17 ? 'Good afternoon' :
    hr < 21 ? 'Good evening'   : 'Still up';
  // "TUESDAY, JUNE 2" — locale-formatted and uppercased.
  const dateLine = now.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  }).toUpperCase();

  // ── Footer counts — derived locally, no server call needed ────────────────
  const inProg = st.library.filter(b => {
    const p = st.mediaProgress.find(mp => mp.libraryItemId === b.id);
    // In progress: any listening started but not yet finished (< 98% threshold).
    return p && p.progress > 0 && p.progress < 0.98;
  }).length;
  const finished = st.library.filter(b => {
    const p = st.mediaProgress.find(mp => mp.libraryItemId === b.id);
    // Finished: 98% or more progress (matches ABS server's own threshold).
    return p && p.progress >= 0.98;
  }).length;

  // ── Fetch both payloads on mount ─────────────────────────────────────────
  useEffect(() => {
    if (!st.serverUrl) return;
    let cancelled = false;

    // User stats: GET /api/me/listening-stats
    setLoadingUser(true);
    getUserStats(st.serverUrl)
      .then(s => { if (!cancelled) { setUserStats(s); setLoadingUser(false); } })
      .catch(e => {
        console.error('[GreetingPane] getUserStats failed:', e);
        if (!cancelled) setLoadingUser(false);
      });

    // Library stats: GET /api/libraries/{id}/stats — needs the library ID.
    const libId = st.currentLibraryId;
    if (libId) {
      setLoadingLib(true);
      getLibraryStats(st.serverUrl, libId)
        .then(s => { if (!cancelled) { setLibStats(s); setLoadingLib(false); } })
        .catch(e => {
          console.error('[GreetingPane] getLibraryStats failed:', e);
          if (!cancelled) setLoadingLib(false);
        });
    } else {
      // No library ID yet (edge case) — stop the spinner immediately.
      setLoadingLib(false);
    }

    return () => { cancelled = true; };
    // Re-fetch if the server URL or library changes (e.g., after reconnect).
  }, [st.serverUrl, st.currentLibraryId]);

  // Persist tab choice then update local state.
  const switchPage = (p: 'user' | 'library') => {
    localStorage.setItem('onyx.greeting.tab', p);
    setPage(p);
  };

  return (
    <Glass
      translucent={st.translucent}
      style={{
        width: 360,
        padding: 28,
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        position: 'relative',
        overflow: 'hidden',
        height: '100%', // fill the left column so content is spread across the full height
        boxSizing: 'border-box', // include padding in the 100% height; without this, padding adds 56 px of overflow and clips the footer
      }}
    >
      {/* Gold hairline along the top edge — echoes the player chrome */}
      <div style={{
        position: 'absolute', top: 0, left: 22, right: 22, height: 1,
        background: 'linear-gradient(90deg, transparent, var(--onyx-accent-edge), transparent)',
      }} />

      {/* Date eyebrow — mono 10px, uppercase, muted */}
      <div style={{
        fontFamily: MONO,
        fontSize: 10,
        letterSpacing: '0.18em',
        color: 'var(--onyx-text-mute)',
        textTransform: 'uppercase',
      }}>
        {dateLine}
      </div>

      {/* Greeting — serif 30px/500, two lines, gold period after name */}
      <div style={{
        marginTop: 12,
        fontFamily: SERIF,
        fontSize: 30,
        fontWeight: 500,
        lineHeight: 1.08,
        letterSpacing: '-0.015em',
        color: 'var(--onyx-text)',
      }}>
        {greeting},<br />{name}<span style={{ color: 'var(--onyx-accent)' }}>.</span>
      </div>

      {/* Segmented toggle — Your stats / Library stats */}
      <div style={{
        marginTop: 28, // increased from 18 to spread sections across available height
        display: 'flex',
        padding: 3,
        gap: 3,
        background: 'var(--onyx-glass)',
        border: '1px solid var(--onyx-glass-edge)',
        borderRadius: 10,
      }}>
        {([ { id: 'user', label: 'Your stats' }, { id: 'library', label: 'Library stats' } ] as const).map(t => {
          const active = page === t.id;
          return (
            <button
              key={t.id}
              onClick={() => switchPage(t.id)}
              style={{
                flex: 1,
                padding: '8px 0',
                borderRadius: 7,
                cursor: 'pointer',
                border: 'none',
                fontFamily: 'inherit',
                fontSize: 12,
                fontWeight: active ? 600 : 500,
                letterSpacing: '0.01em',
                // Active: dimmed gold background + inset ring; inactive: transparent.
                background: active ? 'var(--onyx-accent-dim)' : 'transparent',
                boxShadow: active ? 'inset 0 0 0 1px var(--onyx-accent-edge)' : 'none',
                color: active ? 'var(--onyx-accent)' : 'var(--onyx-text-dim)',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Stats body — flex:1 + overflow:auto so it scrolls without pushing the footer */}
      <div style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        marginTop: 28, // increased from 18 to spread sections across available height
        // Slight negative margin + padding trick keeps the scrollbar flush with the card edge.
        marginRight: -6,
        paddingRight: 6,
      }}>
        {page === 'user'
          ? <UserStatsPage stats={userStats} loading={loadingUser} />
          : <LibraryStatsPage stats={libStats} loading={loadingLib} library={st.library} />
        }
      </div>

      {/* Footer strip — always present, derived from local library state */}
      <div style={{
        marginTop: 'auto', // anchors footer to the bottom when content is short; paddingTop provides separation
        paddingTop: 18,
        borderTop: '1px solid var(--onyx-line)',
        display: 'flex',
        gap: 28,
      }}>
        {/* Total items in the loaded library */}
        <GreetStat label="In library" value={st.library.length} />
        {/* Items with 0 < progress < 0.98 */}
        <GreetStat label="In progress" value={inProg} />
        {/* Items with progress ≥ 0.98 */}
        <GreetStat label="Finished" value={finished} />
      </div>
    </Glass>
  );
}
