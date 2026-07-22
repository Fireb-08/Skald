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
import type { LibraryItem, MediaProgress, Task, DownloadRecord, Library } from '../api/abs';
import { getMe, markServerDeleted } from '../api/abs';
import { log } from '../lib/log';
import { ALL_LIBRARIES_ID } from '../lib/allLibraries';
import { patchLibraryItems } from './bookHelpers';

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
  // Stable setters / callbacks from useOnyxState.
  setMediaProgress: Dispatch<SetStateAction<MediaProgress[]>>;
  setPosition: Dispatch<SetStateAction<number>>;
  setSyncConflict: Dispatch<SetStateAction<PlaybackSyncConflict | null>>;
  setLibraryRaw: Dispatch<SetStateAction<LibraryItem[]>>;
  setCurrentBookId: Dispatch<SetStateAction<string>>;
  setFocusedBookId: Dispatch<SetStateAction<string | null>>;
  setDownloads: Dispatch<SetStateAction<DownloadRecord[]>>;
  setTasks: Dispatch<SetStateAction<Task[]>>;
  setToast: (t: { message: string; type: 'success' | 'error' | 'info' } | null) => void;
  recordActivity: (entry: { category: 'sync'; outcome: 'success' | 'error' | 'info'; message: string }) => void;
  surfaceCorruptPersistenceNotices: () => Promise<void>;
  setUploadPerm: (v: boolean) => void;
  refreshLibrary: () => Promise<void>;
  applyServerProgress: (serverProgress: MediaProgress[]) => void;
}

export interface PlaybackSyncConflict {
  libraryItemId: string;
  episodeId: string | null;
  currentTime: number;
  deviceDescription: string;
  sessionId: string;
  receivedAt: number;
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
  setLibraryRaw,
  setCurrentBookId,
  setFocusedBookId,
  setDownloads,
  setTasks,
  setToast,
  recordActivity,
  surfaceCorruptPersistenceNotices,
  setUploadPerm,
  refreshLibrary,
  applyServerProgress,
}: LiveSyncDeps): void {
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
        // Skald syncs its own playback position to the server every 30 seconds.
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

    // Three separate unlisten handles — each listener is torn down individually.
    let unlistenAdded:   (() => void) | undefined;
    let unlistenUpdated: (() => void) | undefined;
    let unlistenRemoved: (() => void) | undefined;
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
    listen<string>('library-item-added', event => {
      try {
        const raw  = JSON.parse(event.payload) as LibraryItem;
        // Only process items that belong to the currently loaded library.
        if (!shelfAcceptsLibrary(raw.libraryId)) return;
        const item = patchLibraryItems([raw])[0];
        setLibraryRaw(prev => prev.some(b => b.id === item.id)
          ? prev.map(b => b.id === item.id ? { ...b, ...item } : b)
          : [...prev, item]);
      } catch (e) { log.error('sync', 'library-item-added parse failed', { err: String(e) }); }
    }).then(fn => { if (disposed) fn(); else unlistenAdded = fn; });

    // item_updated — metadata, cover, or chapters changed; merge the new
    // data over the existing record so the shelf reflects it immediately.
    listen<string>('library-item-updated', event => {
      try {
        const raw  = JSON.parse(event.payload) as LibraryItem;
        if (!shelfAcceptsLibrary(raw.libraryId)) return;
        const item = patchLibraryItems([raw])[0];
        setLibraryRaw(prev => prev.map(b => b.id === item.id ? { ...b, ...item } : b));
      } catch (e) { log.error('sync', 'library-item-updated parse failed', { err: String(e) }); }
    }).then(fn => { if (disposed) fn(); else unlistenUpdated = fn; });

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

    // Tear down all three listeners together on unmount or auth context change.
    return () => {
      disposed = true;
      unlistenAdded?.();
      unlistenUpdated?.();
      unlistenRemoved?.();
    };
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

    return () => { disposed = true; unStart?.(); unFinish?.(); };
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
    let disposed = false;

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
      // The fallback write reads the offline queue and may have been the first
      // operation to discover that its persistence file was corrupt.
      void surfaceCorruptPersistenceNotices();
    }).then(fn => { if (disposed) fn(); else unlistenWarning = fn; });

    listen<{ currentTime: number }>('session-sync-restored', event => {
      log.info('sync', 'session progress sync restored', { currentTime: event.payload.currentTime });
      setToast({ message: 'Progress sync restored', type: 'success' });
      recordActivity({ category: 'sync', outcome: 'success', message: 'Progress sync restored' });
    }).then(fn => { if (disposed) fn(); else unlistenRestored = fn; });

    return () => {
      disposed = true;
      unlistenWarning?.();
      unlistenRestored?.();
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
