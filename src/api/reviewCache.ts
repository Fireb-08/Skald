import type { LibraryItem } from './abs';

export interface OLRatings {
  average: number | null;
  count: number | null;
}

export interface OLShelves {
  wantToRead: number | null;
  reading: number | null;
  alreadyRead: number | null;
}

export interface ReviewData {
  olWorkKey: string | null;
  olRatings: OLRatings | null;
  olShelves: OLShelves | null;
  googleRating: number | null;
  googleCount: number | null;
  googleLink: string | null;
  hardcoverRating: number | null;
  hardcoverCount: number | null;
  hardcoverLink: string | null;
}

interface CacheEntry {
  data: ReviewData;
  fetchedAt: number;
}

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_ENTRIES = 200;
const STORAGE_KEY = 'skald.reviewCache';

const cache = new Map<string, CacheEntry>();

// Load from localStorage on module init.
try {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const entries = JSON.parse(stored) as [string, CacheEntry][];
    for (const [key, entry] of entries) {
      cache.set(key, entry);
    }
  }
} catch {
  // Ignore parse errors — start with empty cache.
}

export function getCachedReview(itemId: string): ReviewData | null {
  const entry = cache.get(itemId);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > TTL_MS) return null;
  return entry.data;
}

export function setCachedReview(itemId: string, data: ReviewData): void {
  cache.set(itemId, { data, fetchedAt: Date.now() });
  persist();
}

function persist(): void {
  try {
    let entries = [...cache.entries()];
    // Cap size — evict oldest entries first.
    if (entries.length > MAX_ENTRIES) {
      entries.sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
      entries = entries.slice(entries.length - MAX_ENTRIES);
      cache.clear();
      for (const [k, v] of entries) cache.set(k, v);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Ignore storage errors (e.g. quota exceeded).
  }
}

// ── Hardcover ─────────────────────────────────────────────────────────────────

export async function fetchHardcoverData(
  title: string,
  author: string,
  isbn?: string,
): Promise<{ rating: number | null; count: number | null; link: string | null }> {
  const query = isbn ? isbn : `${title} ${author}`;
  try {
    const res = await fetch('https://api.hardcover.app/v1/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query SearchBook($query: String!) { search(query: $query, query_type: "Book", per_page: 1) { results } }`,
        variables: { query },
      }),
    });
    const json = await res.json() as { data?: { search?: { results?: unknown } } };
    const raw = json?.data?.search?.results;
    const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { hits?: { document?: Record<string, unknown> }[] } | null;
    const hit = parsed?.hits?.[0]?.document ?? null;
    if (!hit) return { rating: null, count: null, link: null };
    const rating = typeof hit.rating === 'number' ? hit.rating : null;
    const count = typeof hit.ratings_count === 'number' ? hit.ratings_count : null;
    const slug = typeof hit.slug === 'string' ? hit.slug : null;
    const link = slug ? `https://hardcover.app/books/${slug}` : null;
    return { rating, count, link };
  } catch {
    return { rating: null, count: null, link: null };
  }
}

// ── Prefetch helpers ──────────────────────────────────────────────────────────

function itemTitle(item: LibraryItem): string {
  return item.media.metadata.title ?? item.id;
}

function itemAuthor(item: LibraryItem): string {
  const a = item.media.metadata.authorName;
  if (!a) return '';
  if (typeof a === 'string') return a;
  if (Array.isArray(a)) return (a as { name: string }[]).map(x => x.name).join(', ');
  return (a as { name: string }).name;
}

async function fetchReviewData(
  item: LibraryItem,
  apiKey: string,
  opts: { enableOpenLibrary?: boolean; enableHardcover?: boolean } = {},
): Promise<ReviewData> {
  const { enableOpenLibrary = true, enableHardcover = true } = opts;
  const meta = item.media?.metadata;
  const isbn = meta?.isbn13 || meta?.isbn10 || meta?.isbn;

  // ── Open Library ────────────────────────────────────────────────────────────
  let olWorkKey: string | null = null;
  let olRatings: OLRatings | null = null;
  let olShelves: OLShelves | null = null;

  if (enableOpenLibrary) {
    let rawWorkId: string | null = null;
    if (isbn) {
      const res  = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
      const data = await res.json() as Record<string, { works?: { key: string }[] }>;
      rawWorkId  = data[`ISBN:${isbn}`]?.works?.[0]?.key ?? null;
    }
    if (!rawWorkId) {
      const res  = await fetch(`https://openlibrary.org/search.json?title=${encodeURIComponent(itemTitle(item))}&author=${encodeURIComponent(itemAuthor(item))}&limit=1`);
      const data = await res.json() as { docs?: { key: string }[] };
      rawWorkId  = data.docs?.[0]?.key ?? null;
    }
    if (rawWorkId) {
      olWorkKey = rawWorkId.replace(/^\/works\//, '');
      const [ratRes, shRes] = await Promise.all([
        fetch(`https://openlibrary.org/works/${olWorkKey}/ratings.json`),
        fetch(`https://openlibrary.org/works/${olWorkKey}/bookshelves.json`),
      ]);
      const [ratData, shData] = await Promise.all([
        ratRes.json() as Promise<{ summary?: { average: number; count: number } }>,
        shRes.json()  as Promise<{ counts?: { want_to_read: number; currently_reading: number; already_read: number } }>,
      ]);
      olRatings = { average: ratData.summary?.average ?? null, count: ratData.summary?.count ?? null };
      olShelves = { wantToRead: shData.counts?.want_to_read ?? null, reading: shData.counts?.currently_reading ?? null, alreadyRead: shData.counts?.already_read ?? null };
    }
  }

  // ── Google Books ─────────────────────────────────────────────────────────────
  let googleRating: number | null = null;
  let googleCount:  number | null = null;
  let googleLink:   string | null = null;

  if (apiKey) {
    try {
      const q    = isbn ? `isbn:${isbn}` : `intitle:${encodeURIComponent(itemTitle(item))}+inauthor:${encodeURIComponent(itemAuthor(item))}`;
      const res  = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=1&key=${apiKey}`);
      const data = await res.json() as { items?: { volumeInfo: { averageRating?: number; ratingsCount?: number; canonicalVolumeLink?: string; infoLink?: string } }[] };
      const info = data.items?.[0]?.volumeInfo ?? null;
      if (info) {
        googleRating = info.averageRating ?? null;
        googleCount  = info.ratingsCount  ?? null;
        googleLink   = info.canonicalVolumeLink ?? info.infoLink ?? null;
      }
    } catch {
      // Google Books failure is non-fatal.
    }
  }

  // ── Hardcover ────────────────────────────────────────────────────────────────
  let hardcoverRating: number | null = null;
  let hardcoverCount:  number | null = null;
  let hardcoverLink:   string | null = null;

  if (enableHardcover) {
    const hc = await fetchHardcoverData(itemTitle(item), itemAuthor(item), isbn ?? undefined);
    hardcoverRating = hc.rating;
    hardcoverCount  = hc.count;
    hardcoverLink   = hc.link;
  }

  return { olWorkKey, olRatings, olShelves, googleRating, googleCount, googleLink, hardcoverRating, hardcoverCount, hardcoverLink };
}

/**
 * Sequentially prefetches review data for all items not already in the cache,
 * writing results to the cache after each fetch. No React state is touched.
 * Returns a cancel function; call it on component unmount to stop the queue.
 */
export function prefetchReviews(
  items: LibraryItem[],
  _serverUrl: string,
  enableOpenLibrary = true,
  enableHardcover = true,
): () => void {
  const queue = items.filter(item => getCachedReview(item.id) === null);
  if (queue.length === 0) return () => {};

  const apiKey = localStorage.getItem('skald.googleBooksApiKey') ?? '';
  const opts = { enableOpenLibrary, enableHardcover };
  let cancelled = false;
  let timerId: ReturnType<typeof setTimeout> | null = null;

  const processNext = (remaining: LibraryItem[]) => {
    if (cancelled || remaining.length === 0) return;
    const [head, ...tail] = remaining;

    fetchReviewData(head, apiKey, opts)
      .then(data => { if (!cancelled) setCachedReview(head.id, data); })
      .catch(() => { /* silently skip failures */ })
      .finally(() => {
        if (!cancelled) timerId = setTimeout(() => processNext(tail), 200);
      });
  };

  processNext(queue);

  return () => {
    cancelled = true;
    if (timerId !== null) clearTimeout(timerId);
  };
}
