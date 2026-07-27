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

  const play = useCallback((target: UpNextTarget) => {
    const current = stRef.current;
    const started = target.kind === 'book'
      ? playBook(current, target.item.id)
      : playEpisode(current, target.item.id, target.episode);
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

      const { target, miss } = await resolveUpNext(current, payload.itemId, episodeId);
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
    };
  }, [play]);

  // Mirrored so accept/decline can clear the prompt *and* read what it was
  // without a side effect inside a state updater — which React is free to call
  // twice, and which would open two sessions for one accepted book.
  const promptRef = useRef<UpNextPrompt | null>(null);
  promptRef.current = prompt;

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
