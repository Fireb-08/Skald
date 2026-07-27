// Per-book playback speed (Auto-Rewind & Per-Book Speed roadmap, Phase 4).
//
// One slow narrator shouldn't force you to re-pick 1.25× every time you open
// their book, and shouldn't make every *other* book 1.25× either. Each item
// remembers its own rate, falling back to the global default.
//
// Storage: `onyx.playback.speedByItem` is a new key holding `{ [itemId]: rate }`.
// `onyx.playback.speed` keeps its existing meaning as the global default and is
// never written by per-book changes — only by the Settings control.

const MAP_KEY = 'onyx.playback.speedByItem';
const GLOBAL_KEY = 'onyx.playback.speed';
const ENABLED_KEY = 'onyx.playback.perBookSpeed';

/** LibVLC accepts a wide range; these bounds just reject nonsense from storage. */
const MIN_RATE = 0.25;
const MAX_RATE = 5;

function isUsableRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_RATE && value <= MAX_RATE;
}

/** Whether per-book memory is on. Default on — the feature is only useful if it
 *  works without being found first, and turning it off restores global-only
 *  behaviour exactly. */
export function perBookSpeedEnabled(): boolean {
  try {
    const raw = localStorage.getItem(ENABLED_KEY);
    return raw === null ? true : JSON.parse(raw) !== false;
  } catch {
    return true;
  }
}

/** The Settings → Playback default, used whenever an item has no remembered rate. */
export function globalDefaultSpeed(): number {
  try {
    const raw = localStorage.getItem(GLOBAL_KEY);
    if (raw === null) return 1;
    // Stored as a display string ("1.25") by the settings segment.
    const parsed = parseFloat(JSON.parse(raw) as string);
    return isUsableRate(parsed) ? parsed : 1;
  } catch {
    return 1;
  }
}

function readMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    // Drop unusable entries rather than handing a bad rate to LibVLC later.
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(([, v]) => isUsableRate(v)),
    ) as Record<string, number>;
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, number>): void {
  try {
    localStorage.setItem(MAP_KEY, JSON.stringify(map));
  } catch {
    // Storage full or unavailable — losing a remembered speed is not worth
    // failing a playback action over.
  }
}

/** The rate to play `itemId` at.
 *
 *  `itemId` is always the **library item**, so a podcast's episodes all share
 *  one speed: you adjust for the host's delivery, not for a given episode. */
export function speedForItem(itemId: string | undefined | null): number {
  if (!itemId || !perBookSpeedEnabled()) return globalDefaultSpeed();
  const remembered = readMap()[itemId];
  return isUsableRate(remembered) ? remembered : globalDefaultSpeed();
}

/** Whether this item has its own remembered rate (as opposed to inheriting the
 *  global default). Used to describe the source in diagnostics. */
export function hasRememberedSpeed(itemId: string | undefined | null): boolean {
  if (!itemId || !perBookSpeedEnabled()) return false;
  return isUsableRate(readMap()[itemId]);
}

/** Record the rate the listener chose for this item.
 *
 *  A no-op when the feature is off, so the map cannot quietly accumulate entries
 *  that would spring to life if the toggle were later switched on. */
export function rememberSpeed(itemId: string | undefined | null, rate: number): void {
  if (!itemId || !perBookSpeedEnabled() || !isUsableRate(rate)) return;
  const map = readMap();
  if (map[itemId] === rate) return;
  map[itemId] = rate;
  writeMap(map);
}

/** Forget every remembered rate. Leaves the global default untouched — the
 *  reset is for the per-book layer, not for the Settings choice. */
export function clearAllPerBookSpeeds(): void {
  try {
    localStorage.removeItem(MAP_KEY);
  } catch {
    // Nothing useful to do; the next read simply returns the existing map.
  }
}

/** How many items currently have a remembered rate — lets the Settings action
 *  say what it is about to discard. */
export function rememberedSpeedCount(): number {
  return Object.keys(readMap()).length;
}
