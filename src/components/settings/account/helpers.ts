// Pure helpers shared by AccountSection and its user-management widgets.
// Moved verbatim out of AccountSection.tsx (God-File Decomposition roadmap, L3/L7).

/** Returns a human-readable relative time string for a Unix-ms timestamp.
 *  Returns "Never" when the timestamp is null (user has never signed in). */
export function relativeTime(ms: number | null): string {
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
export function formatDate(ms: number | null): string {
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
export const USER_PALETTE = [
  '#d4a64a', '#c96442', '#7aa86a', '#5a8fc4', '#a86a8e', '#52b2cc',
  '#b8893f', '#6cc0a0', '#9b7fd0', '#d98f6a', '#5fa9b8', '#cf6f8f',
];

export function loadColorMap(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(USER_COLOR_KEY) ?? '{}') as Record<string, string>; }
  catch { return {}; }
}
export function saveColorMap(map: Record<string, string>): void {
  localStorage.setItem(USER_COLOR_KEY, JSON.stringify(map));
}
export function randomColor(): string {
  return USER_PALETTE[Math.floor(Math.random() * USER_PALETTE.length)];
}
