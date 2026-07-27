// Auto-play-next wiring (Auto-Play Next roadmap, Phase 4): turns the backend's
// `playback-ended` announcement into either a prompt or a play.
//
// It lives in a hook rather than in useOnyxState because starting playback means
// going through playBook/playEpisode with an assembled OnyxState — the same path
// every play button uses. Advancing must never take a shortcut around it: those
// helpers are what close the finished session before opening the next one, and a
// hand-rolled advance is how a client ends up with two open sessions on the
// server for one listener.
import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { OnyxState } from '../state/onyx';
import type { UpNextTarget } from '../state/upNextTarget';
import { resolveUpNext } from '../state/upNextTarget';
import { playBook, playEpisode } from '../api/playbook';
import { upNextCountdownSeconds, upNextMode } from '../lib/upNextPrefs';
import { log } from '../lib/log';

export interface UpNextPrompt {
  target: UpNextTarget;
  /** Seconds the panel counts down before playing. */
  seconds: number;
}

export interface UseUpNext {
  /** Non-null while the "Up next" panel is asking. */
  prompt: UpNextPrompt | null;
  /** Start the prompted item now (countdown elapsed, or "Play now"). */
  accept: () => void;
  /** Dismiss without playing. */
  decline: () => void;
}

/** Human label for logs and toasts. */
function describe(target: UpNextTarget): string {
  return target.kind === 'book'
    ? target.item.media?.metadata?.title ?? target.item.id
    : target.episode.title;
}

export function useUpNext(st: OnyxState): UseUpNext {
  const [prompt, setPrompt] = useState<UpNextPrompt | null>(null);

  // The event listener is mounted once, so it reads live state through a ref
  // rather than closing over the first render's copy — the finished book's
  // series, progress, and offline status all change during a listening session.
  const stRef = useRef(st);
  stRef.current = st;

  // Mirrored so accept/decline can clear the prompt *and* read what it was
  // without a side effect inside a state updater — which React is free to call
  // twice, and which would open two sessions for one accepted book.
  const promptRef = useRef<UpNextPrompt | null>(null);
  promptRef.current = prompt;

  // Every end event runs under a generation. Resolving a book's successor can
  // take a server round-trip (series cache miss), and a prompt sits on screen
  // for its whole countdown — in either window the listener can start something
  // else, and continuing then would take the audio away from the choice they
  // just made. Invalidating bumps the generation so an in-flight resolution
  // returns to a superseded token, and drops any visible prompt with it.
  const generationRef = useRef(0);
  const invalidate = useCallback(() => {
    generationRef.current += 1;
    if (promptRef.current) {
      promptRef.current = null;
      setPrompt(null);
    }
  }, []);

  // What is loaded right now. `playback-ended` does not change it, so a change
  // means something *else* started: a manual play, or the advance we started
  // ourselves (whose prompt is already resolved by the time this fires).
  const identity = `${st.currentBookId ?? ''}|${st.currentEpisodeId ?? ''}`;
  const identityRef = useRef(identity);
  useEffect(() => {
    if (identityRef.current === identity) return;
    identityRef.current = identity;
    invalidate();
  }, [identity, invalidate]);

  const play = useCallback((target: UpNextTarget) => {
    const current = stRef.current;
    const started = target.kind === 'book'
      ? playBook(current, target.item.id)
      // The resolved item, not its id: for a server podcast it is the expanded
      // show, and passing it on is what lets the advance after this one resolve.
      : playEpisode(current, target.item, target.episode);
    started.catch(error =>
      log.error('playback', 'advance to the next item failed', {
        itemId: target.item.id,
        err: String(error),
      }));
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    listen<{ itemId: string; episodeId: string | null }>('playback-ended', async ({ payload }) => {
      const current = stRef.current;
      const episodeId = payload.episodeId ?? null;
      const mode = upNextMode(episodeId ? 'podcast' : 'book');
      if (mode === 'off') {
        log.info('playback', 'advance declined by setting', { itemId: payload.itemId, episodeId });
        return;
      }

      // A second end event supersedes this one; so does anything the listener
      // starts while the resolution is in flight.
      invalidate();
      const generation = generationRef.current;

      const { target, miss } = await resolveUpNext(current, payload.itemId, episodeId);

      // Both halves matter: the generation catches a newer event or a load that
      // has already been rendered, and the identity check catches one that
      // started in the last few milliseconds and has not re-rendered yet.
      const after = stRef.current;
      const stillOnEndedItem =
        after.currentBookId === payload.itemId && (after.currentEpisodeId ?? null) === episodeId;
      if (generationRef.current !== generation || !stillOnEndedItem) {
        log.info('playback', 'advance abandoned — the listener started something else', {
          itemId: payload.itemId,
          episodeId,
          nowPlaying: after.currentBookId,
        });
        return;
      }

      if (!target) {
        log.info('playback', 'nothing up next', { itemId: payload.itemId, episodeId, reason: miss });
        if (miss === 'series-end' || miss === 'feed-end') {
          stRef.current.setToast({
            message: miss === 'series-end' ? 'That was the last book in the series' : 'No more episodes',
            type: 'info',
          });
        }
        return;
      }

      log.info('playback', 'advance resolved', {
        from: payload.itemId,
        to: target.kind === 'book' ? target.item.id : target.episode.id,
        kind: target.kind,
        mode,
      });

      if (mode === 'auto') {
        // Auto still says what happened — audio changing with no explanation is
        // the thing that makes continuation feel like a malfunction.
        stRef.current.setToast({ message: `Up next: ${describe(target)}`, type: 'info' });
        play(target);
        return;
      }
      setPrompt({ target, seconds: upNextCountdownSeconds() });
    }).then(fn => {
      // The effect can be torn down before listen() resolves (StrictMode
      // double-mount); detach immediately in that case rather than leaking.
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
      // A resolution still in flight belongs to a hook that no longer exists;
      // let it return to a superseded generation rather than prompting into an
      // unmounted tree.
      generationRef.current += 1;
    };
  }, [invalidate, play]);

  const resolvePrompt = useCallback(() => {
    const current = promptRef.current;
    promptRef.current = null;
    setPrompt(null);
    return current;
  }, []);

  const accept = useCallback(() => {
    const current = resolvePrompt();
    if (current) play(current.target);
  }, [play, resolvePrompt]);

  const decline = useCallback(() => {
    const current = resolvePrompt();
    if (!current) return;
    log.info('playback', 'advance cancelled by listener', {
      to: current.target.kind === 'book' ? current.target.item.id : current.target.episode.id,
    });
  }, [resolvePrompt]);

  return { prompt, accept, decline };
}
