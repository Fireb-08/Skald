const PREFIX = 'onyx.library.lastRefresh';

export function freshnessKey(serverUrl: string, libraryId: string): string {
  return `${PREFIX}.${encodeURIComponent(serverUrl)}.${encodeURIComponent(libraryId)}`;
}

export function readLastRefresh(serverUrl: string, libraryId: string): number | null {
  const value = Number(localStorage.getItem(freshnessKey(serverUrl, libraryId)));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function writeLastRefresh(serverUrl: string, libraryId: string, timestamp = Date.now()): number {
  localStorage.setItem(freshnessKey(serverUrl, libraryId), String(timestamp));
  return timestamp;
}
