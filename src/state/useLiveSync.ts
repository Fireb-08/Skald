// useLiveSync — the socket-driven live-sync effect cluster, composed into
// useOnyxState. Moved verbatim out of onyx.ts (God-File Decomposition roadmap,
// L3/L7): the progress-updated listener (self-echo guard + reconciliation),
// the three library-item listeners, the reconnect/authenticated resync pair,
// the background-task stream, recoverable session-write warnings, and the
// fatal sync-failed watchdog toast (review H5).
//
// The effects read playback/library state exclusively through the refs in
// LiveSyncDeps — that was already their design inside onyx.ts (so socket
// listeners never re-subscribe on every position tick), which is what makes
// this seam clean: the hook needs the refs and stable setters, nothing else.
import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { listen } from '@tauri-apps/api/event';
import type {
  LibraryItem, MediaProgress, Task, DownloadRecord, Library, UserPermissions,
  Collection, Playlist,
} from '../api/abs';
import { getMe, getOfflineProgressCount, markServerDeleted } from '../api/abs';
import { log } from '../lib/log';
import { ALL_LIBRARIES_ID } from '../lib/allLibraries';
import { patchLibraryItems } from './bookHelpers';
import { parseEntityChange, publishEntityChange, useEntityChanges, type EntityKind, type EntityOp } from './liveEntities';
// Type-only, so it erases at build time and no import cycle exists with onyx.ts
// (which imports this hook).
import type { ContextFilter } from './onyx';

export interface LiveSyncDeps {
  serverUrl: string;
  authToken: string;
  // Shared React state rather than a one-time localStorage read, so toggling
  // live sync immediately installs or removes every socket-driven listener.
  liveSyncEnabled: boolean;
  // Live refs — kept current by useOnyxState's every-render sync effect.
  currentBookIdRef: RefObject<string>;
  currentEpisodeIdRef: RefObject<string | null>;
  playingRef: RefObject<boolean>;
  sessionIdRef: RefObject<string>;
  sessionReadyRef: RefObject<boolean>;
  currentLibraryIdRef: RefObject<string>;
  librariesRef: RefObject<Library[]>;
  isOfflineRef: RefObject<boolean>;
  // The shelf's active collection/playlist filter. Read through a ref because the
  // reconciler below is installed once and must see the current filter, not the
  // one that existed when it subscribed.
  contextFilterRef: RefObject<ContextFilter | null>;
  // Stable setters / callbacks from useOnyxState.
  setMediaProgress: Dispatch<SetStateAction<MediaProgress[]>>;
  setPosition: Dispatch<SetStateAction<number>>;
  setSyncConflict: Dispatch<SetStateAction<PlaybackSyncConflict | null>>;
  setSyncHealth: Dispatch<SetStateAction<SyncHealth>>;
  setLibraryRaw: Dispatch<SetStateAction<LibraryItem[]>>;
  setCurrentBookId: Dispatch<SetStateAction<string>>;
  setFocusedBookId: Dispatch<SetStateAction<string | null>>;
  setDownloads: Dispatch<SetStateAction<DownloadRecord[]>>;
  setTasks: Dispatch<SetStateAction<Task[]>>;
  setToast: (t: { message: string; type: 'success' | 'error' | 'info' } | null) => void;
  recordActivity: (entry: { category: 'sync'; outcome: 'success' | 'error' | 'info'; message: string }) => void;
  surfaceCorruptPersistenceNotices: () => Promise<void>;
  setUploadPerm: (v: boolean) => void;
  setContextFilter: (filter: ContextFilter | null) => void;
  // Resolves false when the ABS library list could not be fetched — the access
  // reconciler needs that to know a retry is still owed.
  refreshLibrary: () => Promise<boolean>;
  applyServerProgress: (serverProgress: MediaProgress[]) => void;
  // ABS pushes the whole browser-shaped user record on `user_updated`, so the
  // permission set and account type can be applied without a /api/me round-trip.
  applyUserRecord: (record: LiveUserRecord) => void;
}

/**
 * The parts of ABS's `user_updated` payload (`User.toOldJSONForBrowser()`) that
 * Skald acts on. The real payload also carries `token` — the pre-2.26 non-expiring
 * one — plus the full mediaProgress and bookmark arrays; all three are
 * deliberately absent here. The keyring is the only place a token belongs, and
 * progress arrives on its own event.
 */
export interface LiveUserRecord {
  id: string;
  username?: string;
  type?: string;
  permissions?: UserPermissions | null;
  librariesAccessible?: string[];
}

/**
 * One library-access refresh: the access set a `user_updated` payload carried, and
 * the loaded ABS library ids it was judged against. The pair travels together
 * because a refresh is decided from both, and because what a refresh actually
 * loaded can only be told from the loaded ids afterwards — never from the set that
 * triggered it (the server may have moved on by the time the request runs).
 */
interface AccessAttempt {
  pushed: string;
  loaded: string;
}

export interface PlaybackSyncConflict {
  libraryItemId: string;
  episodeId: string | null;
  currentTime: number;
  deviceDescription: string;
  sessionId: string;
  receivedAt: number;
}

export interface SyncHealth {
  lastSuccessfulServerSync: number | null;
  queuedUpdates: number;
  degraded: boolean;
}

export function useLiveSync({
  serverUrl,
  authToken,
  liveSyncEnabled,
  currentBookIdRef,
  currentEpisodeIdRef,
  playingRef,
  sessionIdRef,
  sessionReadyRef,
  currentLibraryIdRef,
  librariesRef,
  isOfflineRef,
  setMediaProgress,
  setPosition,
  setSyncConflict,
  setSyncHealth,
  setLibraryRaw,
  setCurrentBookId,
  setFocusedBookId,
  setDownloads,
  setTasks,
  setToast,
  recordActivity,
  surfaceCorruptPersistenceNotices,
  setUploadPerm,
  setContextFilter,
  refreshLibrary,
  applyServerProgress,
  applyUserRecord,
  contextFilterRef,
}: LiveSyncDeps): void {
  const refreshQueuedCount = () => {
    getOfflineProgressCount()
      .then(queuedUpdates => setSyncHealth(previous => ({ ...previous, queuedUpdates })))
      .catch(error => log.warn('sync', 'offline progress queue count failed', { err: String(error) }));
  };

  // Subscribe to progress-updated events forwarded from the Rust socket layer.
  // Re-arms when auth context or the live preference changes, so a runtime
  // enable starts reconciliation immediately and a disable tears it down.
  useEffect(() => {
    if (!liveSyncEnabled || !serverUrl || !authToken) return;

    let unlisten: (() => void) | undefined;
    let disposed = false;

    listen<string>('progress-updated', event => {
      try {
        // ABS may send the progress record directly or wrapped in { data: {...} }.
        const raw = JSON.parse(event.payload) as Record<string, unknown>;
        const update = ((raw.data ?? raw) as Partial<MediaProgress> & {
          libraryItemId: string;
          currentTime: number;
        });
        const eventSessionId = typeof raw.sessionId === 'string' ? raw.sessionId : '';
        const deviceDescription = typeof raw.deviceDescription === 'string' && raw.deviceDescription.trim()
          ? raw.deviceDescription.trim()
          : 'another device';

        // ── Self-echo guard ───────────────────────────────────────────────────
        // Skald syncs its own playback position to the server on the shared cadence.
        // Those writes echo back here as progress-updated events. If we applied
        // the echo to the live transport position, it would yank the playhead
        // backwards on every sync cycle. The guard detects this case by checking
        // whether the update is for the book/episode we are actively playing
        // right now. Podcast episodes share their parent's libraryItemId, so the
        // episodeId must match too — otherwise an echo for a sibling episode
        // would be treated as ours (and vice versa).
        const isForCurrentPlayback =
          update.libraryItemId === currentBookIdRef.current &&
          (update.episodeId ?? null) === (currentEpisodeIdRef.current ?? null);
        const isActivelyPlayingThisBook = isForCurrentPlayback && playingRef.current;
        const activeSessionId = sessionReadyRef.current ? sessionIdRef.current : '';
        const isOwnSessionEcho = !!eventSessionId && !!activeSessionId && eventSessionId === activeSessionId;
        const isOtherSession = !!eventSessionId && !!activeSessionId && eventSessionId !== activeSessionId;

        // ── Stored progress reconciliation (always runs) ──────────────────────
        // Pick it up, library cover overlays, and the progress bar for
        // non-playing books all read from mediaProgress. Keep it accurate
        // even for the actively-playing book so the UI is correct on pause.
        // Match on the (libraryItemId, episodeId) composite key — the same
        // pattern as mergeProgress — so one podcast episode's progress never
        // overwrites a sibling episode's row.
        setMediaProgress((prev: MediaProgress[]) => {
          const idx = prev.findIndex(p =>
            p.libraryItemId === update.libraryItemId &&
            (p.episodeId ?? null) === (update.episodeId ?? null));
          if (idx >= 0) {
            // Update existing record without mutating the original array.
            const copy = [...prev];
            copy[idx] = { ...copy[idx], ...update };
            return copy;
          }
          // New record — append so newly-started books show in Pick it up.
          return [...prev, update as MediaProgress];
        });

        // Preserve ABS's wrapper identity. Our own echo updates stored progress
        // but never moves transport; a different session for the loaded item is
        // a user decision, even while Skald is paused.
        if (isForCurrentPlayback && isOwnSessionEcho) return;
        if (isForCurrentPlayback && isOtherSession) {
          log.info('sync', 'cross-device playback conflict detected', {
            itemId: update.libraryItemId,
            episodeId: update.episodeId ?? null,
            sessionId: eventSessionId,
            deviceDescription,
            currentTime: update.currentTime,
          });
          setSyncConflict({
            libraryItemId: update.libraryItemId,
            episodeId: update.episodeId ?? null,
            currentTime: update.currentTime,
            deviceDescription,
            sessionId: eventSessionId,
            receivedAt: Date.now(),
          });
          return;
        }

        // ── Live transport position (only when safe to update) ────────────────
        // If this update is for the focused book but we are NOT actively playing
        // it, advance the position so the player UI reflects the remote device's
        // current position. If we ARE playing, leave the transport alone.
        if (!isActivelyPlayingThisBook && isForCurrentPlayback) {
          setPosition(update.currentTime);
        }
      } catch (e) {
        log.error('sync', 'live progress parse failed', { err: String(e) });
      }
    }).then(fn => { if (disposed) fn(); else unlisten = fn; });

    // Tear down the listener on unmount or when auth context changes so stale
    // subscriptions do not accumulate across login/logout cycles.
    return () => { disposed = true; unlisten?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSyncEnabled, serverUrl, authToken]);

  // ── Live library sync ──────────────────────────────────────────────────────
  // Subscribe to library item events forwarded from the Rust socket layer.
  // Active only when live sync is enabled. Uses the same setup/teardown
  // lifecycle as the progress listener above.
  useEffect(() => {
    if (!liveSyncEnabled || !serverUrl || !authToken) return;

    // One unlisten handle per listener — each is torn down individually.
    let unlistenAdded:   (() => void) | undefined;
    let unlistenUpdated: (() => void) | undefined;
    let unlistenRemoved: (() => void) | undefined;
    let unlistenBatchAdded:   (() => void) | undefined;
    let unlistenBatchUpdated: (() => void) | undefined;
    let disposed = false;
    const shelfAcceptsLibrary = (libraryId: string) => {
      if (libraryId === currentLibraryIdRef.current) return true;
      return currentLibraryIdRef.current === ALL_LIBRARIES_ID
        && librariesRef.current.some(library => library.id === libraryId && library.source !== 'local' && library.mediaType !== 'podcast');
    };

    // item_added — a new book arrived; append it to the shelf after normalising
    // author/narrator fields with patchLibraryItems so it matches the rest.
    // Idempotent by id: ABS can emit item_added more than once for a single new
    // item (the folder watcher scans it in and a subsequent scan re-emits; the
    // socket can also redeliver on reconnect), and an upload's item is not yet
    // on the shelf. Without this guard a repeat event appended a duplicate that
    // only cleared on a fresh fetch (relaunch). If the id is already present,
    // merge instead — same semantics as item_updated.
    const applyItemAdded = (raw: LibraryItem) => {
      // Only process items that belong to the currently loaded library.
      if (!shelfAcceptsLibrary(raw.libraryId)) return;
      const item = patchLibraryItems([raw])[0];
      setLibraryRaw(prev => prev.some(b => b.id === item.id)
        ? prev.map(b => b.id === item.id ? { ...b, ...item } : b)
        : [...prev, item]);
    };

    // item_updated — metadata, cover, or chapters changed; merge the new
    // data over the existing record so the shelf reflects it immediately.
    const applyItemUpdated = (raw: LibraryItem) => {
      if (!shelfAcceptsLibrary(raw.libraryId)) return;
      const item = patchLibraryItems([raw])[0];
      setLibraryRaw(prev => prev.map(b => b.id === item.id ? { ...b, ...item } : b));
    };

    listen<string>('library-item-added', event => {
      try {
        applyItemAdded(JSON.parse(event.payload) as LibraryItem);
      } catch (e) { log.error('sync', 'library-item-added parse failed', { err: String(e) }); }
    }).then(fn => { if (disposed) fn(); else unlistenAdded = fn; });

    listen<string>('library-item-updated', event => {
      try {
        applyItemUpdated(JSON.parse(event.payload) as LibraryItem);
      } catch (e) { log.error('sync', 'library-item-updated parse failed', { err: String(e) }); }
    }).then(fn => { if (disposed) fn(); else unlistenUpdated = fn; });

    // items_added / items_updated — the batch forms, emitted by library scans
    // and by any edit touching many items at once (an author rename, a batch
    // metadata update). ABS sends an ARRAY of exactly the single-item shape
    // (SocketAuthority.libraryItemsEmitter maps toOldJSONExpanded over the
    // items the recipient may access), so each element routes through the
    // handler above rather than through a parallel implementation that would
    // drift from it. Order-independent: every element is applied by id.
    const applyBatch = (rawPayload: string, apply: (item: LibraryItem) => void, what: string) => {
      try {
        const parsed = JSON.parse(rawPayload);
        // Defensive: a future ABS release sending a bare object here would
        // otherwise be silently dropped by a `.forEach` on a non-array.
        const items = (Array.isArray(parsed) ? parsed : [parsed]) as LibraryItem[];
        log.debug('sync', 'batch library event applied', { what, count: items.length });
        for (const item of items) apply(item);
      } catch (e) { log.error('sync', `${what} parse failed`, { err: String(e) }); }
    };

    listen<string>('library-items-added', event =>
      applyBatch(event.payload, applyItemAdded, 'library-items-added'),
    ).then(fn => { if (disposed) fn(); else unlistenBatchAdded = fn; });

    listen<string>('library-items-updated', event =>
      applyBatch(event.payload, applyItemUpdated, 'library-items-updated'),
    ).then(fn => { if (disposed) fn(); else unlistenBatchUpdated = fn; });

    // item_removed — book deleted from the server; remove it from the shelf and
    // clear any focused/current references so the player doesn't try to play a ghost.
    // If the book has a local download, flag it as server-deleted rather than
    // deleting the file — the user retains offline playback, badge changes to amber !.
    listen<string>('library-item-removed', event => {
      try {
        const payload = JSON.parse(event.payload) as { id: string; libraryId: string };
        if (!shelfAcceptsLibrary(payload.libraryId)) return;
        setLibraryRaw(prev => prev.filter(b => b.id !== payload.id));
        // Clear currentBookId if the removed item was the one queued to play.
        setCurrentBookId(prev => prev === payload.id ? '' : prev);
        // Clear focusedBookId if the removed item was focused in the shelf.
        setFocusedBookId(prev => prev === payload.id ? null : prev);
        // If the book has a local download, mark it server-deleted rather than removing.
        // Using a functional update reads the latest state without a stale-closure risk.
        setDownloads(prev => {
          if (!prev.some(d => d.itemId === payload.id)) return prev; // not downloaded — no change
          // Persist the flag to disk so it survives a reload.
          markServerDeleted(payload.id).catch(e =>
            log.error('downloads', 'mark server-deleted failed', { err: String(e) })
          );
          // Update local state immediately so the badge updates without a disk round-trip.
          return prev.map(d =>
            d.itemId === payload.id ? { ...d, serverDeleted: true } : d
          );
        });
      } catch (e) { log.error('sync', 'library-item-removed parse failed', { err: String(e) }); }
    }).then(fn => { if (disposed) fn(); else unlistenRemoved = fn; });

    // Tear down every listener together on unmount or auth context change.
    return () => {
      disposed = true;
      unlistenAdded?.();
      unlistenUpdated?.();
      unlistenRemoved?.();
      unlistenBatchAdded?.();
      unlistenBatchUpdated?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSyncEnabled, serverUrl, authToken]);

  // ── Live entity sync (collections · playlists · series · authors) ──────────
  // These four are not held in shared state — each view fetches its own list on
  // mount — so the events are normalized and published on the liveEntities feed
  // for whichever views are currently mounted. See that module for why.
  //
  // Audience differs per family and is worth remembering when reading a bug
  // report: collection/series/author events are broadcast to every client, but
  // playlist events reach only the playlist's owner, so "my playlist did not
  // update on the other machine" and "someone else's playlist did not appear"
  // are entirely different questions — the second is ABS behaving as designed.
  useEffect(() => {
    if (!liveSyncEnabled || !serverUrl || !authToken) return;

    const kinds: EntityKind[] = ['collection', 'playlist', 'series', 'author'];
    const ops: EntityOp[] = ['added', 'updated', 'removed'];
    const unlisteners: (() => void)[] = [];
    let disposed = false;

    for (const kind of kinds) {
      for (const op of ops) {
        // `collection` + `added` → the `collection-added` Tauri event emitted by
        // socket.rs's FORWARDED_EVENTS table.
        listen<string>(`${kind}-${op}`, event => {
          const change = parseEntityChange(kind, op, event.payload);
          if (!change) {
            log.warn('sync', 'live entity event dropped', { kind, op });
            return;
          }
          publishEntityChange(change);
        }).then(fn => { if (disposed) fn(); else unlisteners.push(fn); });
      }
    }

    return () => { disposed = true; unlisteners.forEach(fn => fn()); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSyncEnabled, serverUrl, authToken]);

  // ── The shelf's active collection/playlist filter ──────────────────────────
  // Opening a collection or playlist puts its book ids in the shared
  // `contextFilter` and switches to the library tab — which UNMOUNTS the view
  // that fetched it, because Library renders one shelf tab at a time. So the
  // filtered shelf, the surface most in need of a live update, is exactly the
  // state in which CollectionsView/PlaylistsView are gone.
  //
  // The filter is shared state, so it needs an owner that outlives the tab: this
  // one, subscribed here in the always-mounted hook. The views keep applying
  // changes to their own lists and to the filter as well — that path still has to
  // work with live sync switched off, and applying the same object twice is
  // idempotent.
  useEntityChanges<Collection>('collection', change => {
    const filter = contextFilterRef.current;
    // Match on id, never on `value`: that is the display name, and a rename is
    // one of the changes this exists to handle.
    if (filter?.kind !== 'collection' || filter.collectionId !== change.id) return;
    if (change.op === 'removed') {
      log.info('sync', 'active collection filter cleared — removed on the server', { id: change.id });
      setContextFilter(null);
      setToast({ message: `Collection “${filter.value}” was deleted on the server.`, type: 'info' });
      return;
    }
    if (!change.object) return;
    setContextFilter({
      ...filter,
      value: change.object.name,
      bookIds: (change.object.books ?? []).map(b => b.id),
    });
  });

  useEntityChanges<Playlist>('playlist', change => {
    const filter = contextFilterRef.current;
    if (filter?.kind !== 'playlist' || filter.playlistId !== change.id) return;
    if (change.op === 'removed') {
      log.info('sync', 'active playlist filter cleared — removed on the server', { id: change.id });
      setContextFilter(null);
      setToast({ message: `Playlist “${filter.value}” was deleted on the server.`, type: 'info' });
      return;
    }
    if (!change.object) return;
    // bookIds is also the play order for a playlist shelf, so a remote reorder
    // has to land here or the shelf keeps showing the old sequence.
    setContextFilter({
      ...filter,
      value: change.object.name,
      bookIds: change.object.items.map(item => item.libraryItemId),
    });
  });

  // ── This user's account changed ────────────────────────────────────────────
  // ABS sends `user_updated` only to the affected user, carrying the whole
  // browser-shaped record. Permissions and account type are applied straight
  // from it — no /api/me round-trip — which is what makes an admin revoking a
  // permission take effect here without a restart.
  //
  // Library access is the exception: `librariesAccessible` names ids, and the
  // libraries themselves still have to be fetched, so a change there triggers
  // the same full refresh a reconnect does.
  //
  // Deciding whether access *changed* needs a baseline, and the loaded ABS
  // library list is one: `GET /api/libraries` returns only what the user may
  // access (`LibraryController.findAll` filters on `librariesAccessible`), so the
  // ids already on hand are the accessible set. That matters because
  // `user_updated` is **not** rare — ABS emits it on every media-progress write
  // and every bookmark change (`MeController`) — so there are two failure modes
  // to avoid at once: refreshing on every payload would refetch the library
  // during playback every thirty seconds, and learning the baseline from the
  // first payload would swallow the very event that reports the change, since a
  // session with no playback yet has received no earlier one.
  useEffect(() => {
    if (!liveSyncEnabled || !serverUrl || !authToken) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    // **There is deliberately no "reconciled for set X" marker.** A refresh does not
    // fetch a requested access set — it fetches whatever the server has when the
    // request runs — so its result can never be attributed to the payload that
    // triggered it. A marker recording that attribution lies whenever access moves
    // again mid-request, and then suppresses the payload that reports the move: a
    // refresh queued for C but executed after a revert to B loads B while claiming C,
    // and the next genuine change to C is dismissed as already done, leaving the
    // shelf on B. What a refresh *did* load is instead read back from the loaded
    // library list, which is ground truth (see the decision below).
    //
    // An attempt that reached the server, paired with the loaded ids it was decided
    // against. Its only job is to stop a set that permanently disagrees with the
    // server — a deleted library still listed in the account, say — from refreshing
    // on every payload for the rest of the session. Recorded on success only, so a
    // failed refresh is still retried by the next payload.
    let settledAttempt: AccessAttempt | undefined;
    // The attempt being fetched right now, which deduplicates the burst of payloads a
    // progress sync produces while that request is outstanding.
    let refreshingNow: AccessAttempt | undefined;
    // The newest attempt waiting its turn. Refreshes are serialized rather than run
    // concurrently: two overlapping `refreshLibrary()` calls race on the very state
    // they both write — the library list and its items — so the one that happens to
    // finish last becomes authoritative, which need not be the newest access set.
    // Queueing also keeps a set that arrives mid-refresh from being mistaken for a
    // duplicate of the one in flight, which is how a third payload could otherwise
    // start a second request for a set already being fetched.
    let queuedNext: AccessAttempt | undefined;
    let draining = false;

    // Drain the queue one refresh at a time, newest attempt last.
    const reconcileAccess = async (attempt: AccessAttempt) => {
      queuedNext = attempt;
      if (draining) return;
      draining = true;
      try {
        while (queuedNext !== undefined && !disposed) {
          const next = queuedNext;
          queuedNext = undefined;
          refreshingNow = next;
          try {
            if (await refreshLibrary()) settledAttempt = next;
            else log.warn('sync', 'library access refresh could not reach the server — will retry');
          } finally {
            refreshingNow = undefined;
          }
        }
      } finally {
        draining = false;
      }
    };
    // The access set the previous payload carried — recorded for *every* payload,
    // including the ones ignored below, because arrival order is the only evidence
    // ABS gives that access has moved (the payload carries no revision).
    let lastPushedAccess: string | undefined;

    listen<string>('user-updated', event => {
      try {
        const raw = JSON.parse(event.payload) as Record<string, unknown>;
        const id = typeof raw.id === 'string' ? raw.id : '';
        if (!id) return;
        const librariesAccessible = Array.isArray(raw.librariesAccessible)
          ? (raw.librariesAccessible as string[])
          : undefined;
        // Never carry `token` or the progress/bookmark arrays out of this
        // payload — the keyring owns the credential and progress has its own
        // event. Narrowing to LiveUserRecord here is what enforces that.
        applyUserRecord({
          id,
          username: typeof raw.username === 'string' ? raw.username : undefined,
          type: typeof raw.type === 'string' ? raw.type : undefined,
          permissions: (raw.permissions ?? null) as LiveUserRecord['permissions'],
          librariesAccessible,
        });
        log.info('sync', 'account updated by the server', {
          userId: id,
          accountType: typeof raw.type === 'string' ? raw.type : null,
        });

        if (!librariesAccessible) return;
        const fingerprint = [...librariesAccessible].sort().join(',');
        const previous = lastPushedAccess;
        lastPushedAccess = fingerprint;
        // Being fetched right now, or already waiting its turn.
        if (fingerprint === refreshingNow?.pushed || fingerprint === queuedNext?.pushed) return;

        const loaded = (librariesRef.current ?? [])
          .filter(library => library.source !== 'local')
          .map(library => library.id)
          .sort()
          .join(',');
        // Nothing loaded yet: an initial load is in flight and will produce the
        // right set on its own, so there is nothing to compare or correct.
        if (!loaded) return;

        // Two independent reasons to refresh, because neither covers the other:
        //
        //  · the pushed set disagrees with what is loaded — ground truth, and the
        //    only test available for the first payload of a session; and
        //  · the pushed set differs from the one the previous payload carried, which
        //    is the only evidence that access has *moved*. It is what catches a
        //    change back to a set already loaded — nothing in ground truth
        //    distinguishes that from a redelivery, and the payload carries no
        //    revision to consult.
        //
        // An empty list means unrestricted, which no id set can be compared against
        // (the ids we hold are already everything this account can see), so there
        // only the second test can speak — which is also why a first-ever payload of
        // `[]` refreshes nothing: with no previous set, nothing proves access widened,
        // and refreshing on spec would reload the shelf on the first progress tick of
        // every full-access session.
        const disagrees = librariesAccessible.length > 0 && fingerprint !== loaded;
        const announcesChange = previous !== undefined && fingerprint !== previous;
        if (!disagrees && !announcesChange) return;
        // Already asked the server for exactly this, against exactly this loaded
        // state, and the two still disagree: that discrepancy is the server's to
        // resolve, not ours to re-request every thirty seconds.
        if (settledAttempt?.pushed === fingerprint && settledAttempt.loaded === loaded) return;

        log.info('sync', 'library access changed — refreshing libraries', {
          accessible: librariesAccessible.length || 'all',
        });
        void reconcileAccess({ pushed: fingerprint, loaded });
      } catch (e) { log.error('sync', 'user-updated parse failed', { err: String(e) }); }
    }).then(fn => { if (disposed) fn(); else unlisten = fn; });

    return () => { disposed = true; unlisten?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSyncEnabled, serverUrl, authToken]);

  // ── Reconnect resync ───────────────────────────────────────────────────────
  // When the socket reconnects after a drop, events that fired during the
  // disconnection window are lost — the ABS server does not replay them.
  // Perform a full refresh of library and media progress so the UI reflects
  // the current server state rather than a potentially stale snapshot.
  useEffect(() => {
    if (!liveSyncEnabled || !serverUrl || !authToken) return;

    let unlistenReconnect: (() => void) | undefined;
    let unlistenAuth: (() => void) | undefined;
    let disposed = false;

    const resync = async () => {
      try {
        // Refresh the library — re-fetches all items (clears the OFFLINE flag on
        // success) so additions/edits/deletions during the outage are reflected.
        await refreshLibrary();
        // Re-fetch /api/me to get the latest mediaProgress array so Pick it up
        // and cover progress overlays are correct without waiting for events.
        const me = await getMe(serverUrl);
        applyServerProgress(me.mediaProgress);
        // Permissions may have been edited during the outage — refresh the gate.
        setUploadPerm(!!me.permissions?.upload);
      } catch (e) {
        log.error('sync', 'resync after reconnect failed', { err: String(e) });
      }
    };

    // Reconnect after a drop — events fired during the outage were lost, so
    // always resync to reflect current server state.
    listen('socket-reconnected', () => { void resync(); }).then(fn => { if (disposed) fn(); else unlistenReconnect = fn; });

    // First successful auth — fires when the socket connects (including the first
    // connect after an offline launch, where socket-reconnected does NOT fire).
    // Only resync when we're actually offline so normal online launches don't
    // trigger a redundant full library refetch right after the initial load.
    listen('socket-authenticated', () => { if (isOfflineRef.current) void resync(); }).then(fn => { if (disposed) fn(); else unlistenAuth = fn; });

    return () => { disposed = true; unlistenReconnect?.(); unlistenAuth?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSyncEnabled, serverUrl, authToken]);

  // ── Background-task stream ──────────────────────────────────────────────────
  // Maintain the task list from ABS task_started / task_finished socket events.
  // Lives here (always mounted) rather than in the Scheduled Tasks panel so the
  // list stays current even when that pane is closed. Requires live sync to be
  // connected; the panel still seeds via GET /api/tasks on mount as a fallback.
  useEffect(() => {
    if (!liveSyncEnabled || !serverUrl || !authToken) return;
    let unStart: (() => void) | undefined;
    let unFinish: (() => void) | undefined;
    let unProgress: (() => void) | undefined;
    let disposed = false;

    // Upsert a task by id and cap growth: keep all running tasks plus the 25
    // most-recently-finished so the list cannot grow without bound.
    const upsert = (t: Task) => setTasks(prev => {
      const others = prev.filter(x => x.id !== t.id);
      const merged = [t, ...others];
      const running = merged.filter(x => !x.isFinished);
      const finished = merged
        .filter(x => x.isFinished)
        .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
        .slice(0, 25);
      return [...running, ...finished];
    });

    const handle = (raw: string) => {
      try { upsert(JSON.parse(raw) as Task); } catch { /* ignore malformed task payload */ }
    };

    listen<string>('task-started',  e => handle(e.payload)).then(fn => { if (disposed) fn(); else unStart = fn; });
    listen<string>('task-finished', e => handle(e.payload)).then(fn => { if (disposed) fn(); else unFinish = fn; });

    // task_progress carries `{ libraryItemId, progress }` — despite the name it
    // is NOT a Task and has no task id, so it is joined to the buffer on
    // `data.libraryItemId`, which the encode/embed actions put there. Verified
    // against AbMergeManager.js and AudioMetadataManager.js at ABS v2.36.0.
    //
    // Admin-only on the server side: a non-admin sees a task start and finish
    // with no progress in between, which is the server's decision, not a bug.
    // A progress event for an unknown item is dropped rather than synthesising a
    // task — the id is not in the payload to synthesise one with, and a phantom
    // row in the monitor is worse than a missing progress bar.
    listen<string>('task-progress', e => {
      try {
        const { libraryItemId, progress } = JSON.parse(e.payload) as {
          libraryItemId?: string;
          progress?: number;
        };
        if (!libraryItemId || typeof progress !== 'number' || !Number.isFinite(progress)) return;
        setTasks(prev => prev.map(t =>
          !t.isFinished && t.data?.libraryItemId === libraryItemId
            // Clamp: the encode/embed emitters scale their raw ffmpeg progress by
            // a fraction of the whole job, and a rounding overshoot must not hand
            // the progress bar a width above 100%.
            ? { ...t, progress: Math.max(0, Math.min(100, progress)) }
            : t));
      } catch { /* ignore malformed progress payload */ }
    }).then(fn => { if (disposed) fn(); else unProgress = fn; });

    return () => { disposed = true; unStart?.(); unFinish?.(); unProgress?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSyncEnabled, serverUrl, authToken]);

  // Session progress writes happen in Rust and may fail even while Socket.IO
  // remains healthy. These local events are therefore always observed and are
  // deliberately distinct from sync-failed, which means the tracking task
  // itself died. Failed positions have already been queued locally by Rust;
  // the UI warns without interrupting playback, then confirms recovery.
  useEffect(() => {
    let unlistenWarning: (() => void) | undefined;
    let unlistenRestored: (() => void) | undefined;
    let unlistenSuccess: (() => void) | undefined;
    let unlistenFlushed: (() => void) | undefined;
    let unlistenConflict: (() => void) | undefined;
    let disposed = false;

    refreshQueuedCount();

    listen<{ at: number; currentTime: number; reason: string }>('session-sync-success', event => {
      setSyncHealth(previous => ({
        ...previous,
        lastSuccessfulServerSync: event.payload.at,
        degraded: false,
      }));
      refreshQueuedCount();
    }).then(fn => { if (disposed) fn(); else unlistenSuccess = fn; });

    listen<{ currentTime: number; queued: boolean }>('session-sync-warning', event => {
      log.warn('sync', 'session progress sync failed', {
        currentTime: event.payload.currentTime,
        queuedLocally: event.payload.queued,
      });
      setToast({
        message: event.payload.queued
          ? 'Progress sync is temporarily offline — your position was saved locally.'
          : 'Progress sync failed and your position could not be saved locally.',
        type: event.payload.queued ? 'info' : 'error',
      });
      recordActivity({
        category: 'sync',
        outcome: 'error',
        message: event.payload.queued
          ? 'Progress sync interrupted — position saved locally'
          : 'Progress sync interrupted — local fallback failed',
      });
      setSyncHealth(previous => ({ ...previous, degraded: true }));
      refreshQueuedCount();
      // The fallback write reads the offline queue and may have been the first
      // operation to discover that its persistence file was corrupt.
      void surfaceCorruptPersistenceNotices();
    }).then(fn => { if (disposed) fn(); else unlistenWarning = fn; });

    listen<{ currentTime: number }>('session-sync-restored', event => {
      log.info('sync', 'session progress sync restored', { currentTime: event.payload.currentTime });
      setToast({ message: 'Progress sync restored', type: 'success' });
      recordActivity({ category: 'sync', outcome: 'success', message: 'Progress sync restored' });
      setSyncHealth(previous => ({ ...previous, degraded: false }));
      refreshQueuedCount();
    }).then(fn => { if (disposed) fn(); else unlistenRestored = fn; });

    listen<{ flushed: number; queued: number }>('offline-progress-flushed', event => {
      setSyncHealth(previous => ({ ...previous, queuedUpdates: event.payload.queued }));
    }).then(fn => { if (disposed) fn(); else unlistenFlushed = fn; });

    listen<{
      itemId: string;
      episodeId?: string | null;
      localCurrentTime: number;
      serverCurrentTime: number | null;
    }>('offline-sync-conflict', event => {
      log.warn('sync', 'offline progress conflict preserved ABS position', event.payload);
      // Reconciliation is bookkeeping only. It must never seek the loaded
      // transport: playback position changes are reserved for session startup
      // or an explicit user choice in the cross-device conflict dialog.
      setToast({
        message: 'ABS had newer progress. Skald kept the server position and saved the local stop point as a backup.',
        type: 'info',
      });
      recordActivity({
        category: 'sync',
        outcome: 'info',
        message: 'ABS progress won an offline conflict; local stop point retained',
      });
      refreshQueuedCount();
    }).then(fn => { if (disposed) fn(); else unlistenConflict = fn; });

    return () => {
      disposed = true;
      unlistenSuccess?.();
      unlistenWarning?.();
      unlistenRestored?.();
      unlistenFlushed?.();
      unlistenConflict?.();
    };
  // Stable setters/callbacks; local backend events do not depend on socket auth.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A playback tick/sync task panicked in the backend (review H5): progress
  // tracking has stopped for this session. Rare by design — the watcher only
  // fires on a genuine panic — so one concise toast plus the structured log
  // entry is the whole surface; restarting playback respawns the tasks.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen<{ task: string }>('sync-failed', e => {
      log.error('sync', 'playback task died — progress tracking stopped', { task: e.payload.task });
      setToast({
        message: 'Progress tracking stopped unexpectedly — restart playback to resume it.',
        type: 'error',
      });
    }).then(fn => { if (disposed) fn(); else unlisten = fn; });
    return () => { disposed = true; unlisten?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
