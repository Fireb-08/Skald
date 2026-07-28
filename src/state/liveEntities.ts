// liveEntities — the socket-driven change feed for collections, playlists,
// series and authors (Socket Event Coverage roadmap, Phase 3).
//
// Why a feed rather than shared state. The library items live in useOnyxState
// because the shelf, the player and half a dozen panes all read them. These four
// do not: CollectionsView, PlaylistsView, SeriesView and ShelfHeader each fetch
// their own list on mount and hold it in local state. Lifting those caches into
// useOnyxState to make them patchable would be a far larger change than the
// events warrant, so the events are published here instead and the views
// subscribe while they are mounted.
//
// That lands the roadmap's "invalidate lazily" requirement for free, by
// architecture rather than by a flag: a view that is not mounted has no
// subscription and therefore triggers no fetch, and it re-fetches on its next
// mount anyway. Only what someone is actually looking at is ever refreshed.
import { useEffect, useRef } from 'react';
import { log } from '../lib/log';

/** The entity families ABS emits `_added` / `_updated` / `_removed` events for. */
export type EntityKind = 'collection' | 'playlist' | 'series' | 'author';
export type EntityOp = 'added' | 'updated' | 'removed';

/**
 * One normalized change. `object` is the entity when ABS sent the whole thing
 * and `null` when it sent only an identifier — the distinction consumers need
 * to decide between patching in place and re-fetching, and the reason it is
 * resolved here once rather than at each subscriber.
 */
export interface EntityChange<T = unknown> {
  kind: EntityKind;
  op: EntityOp;
  id: string;
  object: T | null;
}

/**
 * Fields that carry no information beyond identity. A payload consisting only
 * of these is a *thin* one: ABS is naming what changed, not describing it.
 *
 * This is what makes the added/updated/removed payload zoo tractable. Verified
 * shapes at ABS v2.36.0: collections and playlists always send the full expanded
 * object (removals included), `series_removed` sends `{ id, libraryId }`, and
 * `author_removed` sends *either* the full author (AuthorController) or
 * `{ id, libraryId }` (ApiRouter, BookScanner) depending on which code path
 * deleted it. Rather than encode that per-event, the payload is asked what it
 * is — which stays correct if a future ABS release fattens or thins one.
 */
const IDENTITY_ONLY_KEYS = new Set(['id', 'libraryId']);

/**
 * Normalize a raw forwarded payload into a change, or `null` if it is unusable.
 *
 * An unparseable or id-less payload is dropped rather than guessed at: every
 * consumer keys on `id`, and inventing one would corrupt a cache far more
 * quietly than missing an update does.
 */
export function parseEntityChange<T = unknown>(
  kind: EntityKind,
  op: EntityOp,
  raw: string,
): EntityChange<T> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : '';
  if (!id) return null;

  const carriesDetail = Object.keys(record).some(key => !IDENTITY_ONLY_KEYS.has(key));
  return { kind, op, id, object: carriesDetail ? (parsed as T) : null };
}

// ── List reducers ─────────────────────────────────────────────────────────────
// Shared by the socket feed and by the views' own edit handlers, so a change
// applies identically whichever way it arrived — which is the point: a remote
// edit and a local one differ only in where the object came from.
//
// Both return the *same array reference* when nothing changed, so a redelivered
// event costs a setState call and no re-render.

/** Replace the entry with this id, or append it if the list does not hold one. */
export function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const at = list.findIndex(entry => entry.id === item.id);
  if (at < 0) return [...list, item];
  if (list[at] === item) return list;
  const next = list.slice();
  next[at] = item;
  return next;
}

/** Drop the entry with this id. */
export function removeById<T extends { id: string }>(list: T[], id: string): T[] {
  return list.some(entry => entry.id === id) ? list.filter(entry => entry.id !== id) : list;
}

// ── Subscription registry ─────────────────────────────────────────────────────
// Module-level rather than a React context: the publisher is the always-mounted
// live-sync effect and the subscribers are leaf views that mount and unmount
// freely, so threading a provider between them would buy nothing.

type Listener = (change: EntityChange) => void;

const listeners = new Map<EntityKind, Set<Listener>>();

/** Broadcast a change to whatever is currently listening for that kind. */
export function publishEntityChange(change: EntityChange): void {
  const forKind = listeners.get(change.kind);
  if (!forKind?.size) return;
  // Snapshot before iterating: a handler that unsubscribes (a view unmounting
  // in response to a removal) would otherwise mutate the set mid-iteration.
  for (const listener of [...forKind]) {
    try {
      listener(change);
    } catch (error) {
      // One bad subscriber must not cost the others their update.
      log.error('sync', 'live entity subscriber failed', {
        kind: change.kind,
        op: change.op,
        err: String(error),
      });
    }
  }
}

function subscribe(kind: EntityKind, listener: Listener): () => void {
  const forKind = listeners.get(kind) ?? new Set<Listener>();
  forKind.add(listener);
  listeners.set(kind, forKind);
  return () => {
    forKind.delete(listener);
    if (!forKind.size) listeners.delete(kind);
  };
}

/** Test seam — the registry is module state and would otherwise leak across tests. */
export function resetEntityListeners(): void {
  listeners.clear();
}

// ── Coalescing ────────────────────────────────────────────────────────────────

/**
 * How long to wait before acting on an invalidation. A library scan emits its
 * changes in a burst — a hundred items can produce a hundred events in well
 * under a second — and re-fetching per event would answer a busy server with a
 * request storm. 250 ms is short enough to read as instant and long enough to
 * collapse a burst into one fetch.
 */
export const INVALIDATION_WINDOW_MS = 250;

/**
 * Collapse any number of `schedule()` calls within `windowMs` into a single
 * `fire()`. The window restarts on each call, so a sustained burst fires once
 * after it ends rather than repeatedly during it.
 */
export function createCoalescer(windowMs: number, fire: () => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule() {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fire();
      }, windowMs);
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

/**
 * Apply changes to a locally-held cache as they arrive. For kinds whose payload
 * carries the whole object, so nothing needs re-fetching.
 *
 * The handler is held in a ref, so a view can pass an inline closure over its
 * current state without re-subscribing on every render.
 */
export function useEntityChanges<T = unknown>(
  kind: EntityKind,
  handler: (change: EntityChange<T>) => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(
    () => subscribe(kind, change => handlerRef.current(change as EntityChange<T>)),
    [kind],
  );
}

/**
 * Re-fetch when this kind changes, coalescing bursts. For kinds whose payload is
 * too thin to patch from — the view has to ask the server what it now looks like.
 */
export function useEntityInvalidation(
  kind: EntityKind,
  refetch: () => void,
  windowMs: number = INVALIDATION_WINDOW_MS,
): void {
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  useEffect(() => {
    const coalescer = createCoalescer(windowMs, () => refetchRef.current());
    const unsubscribe = subscribe(kind, () => coalescer.schedule());
    // Cancel on unmount: a fetch that lands after the view is gone is pure cost,
    // and its setState would warn.
    return () => {
      unsubscribe();
      coalescer.cancel();
    };
  }, [kind, windowMs]);
}
