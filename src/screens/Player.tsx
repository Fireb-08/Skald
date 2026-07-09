import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  playAudio, pauseAudio,
  seekAudio, setSpeed as setAudioSpeed, setVolume as setAudioVolume,
  createBookmark, getMe, fetchItem,
  recordStopPoint, getStopPoints,
  asPodcastItem, downloadEpisodes, downloadLocalEpisode, getLocalPodcastItems,
  addLocalBookmark, getLocalBookmarks,
} from '../api/abs';
import type { LocalStopPoint } from '../api/abs';
import { sanitizeHtml } from '../lib/sanitize';
import { log } from '../lib/log';

// Shared boundary logger for the screen's fire-and-forget transport/IO calls.
const logErr = (e: unknown) => log.error('playback', 'player command failed', { err: String(e) });
import type { CSSProperties } from 'react';
import type { OnyxState } from '../state/onyx';
import {
  SPEEDS, chapterAt, chapterStart, fmtTime, fmtRemaining,
  bookTitle, bookAuthor, bookSeries, bookNarrator, bookDur, bookChapters,
} from '../state/onyx';
import Glass from '../components/chrome/Glass';
import Cover from '../components/Cover';
import Icon from '../components/Icon';
import Waveform from '../components/Waveform';
import VolumeControl from '../components/chrome/VolumeControl';
import DeviceSelector from '../components/chrome/DeviceSelector';
import { getCachedReview, setCachedReview } from '../api/reviewCache';
import { resolvePodcastImage, cachedPodcastImage, episodeKey } from '../lib/podcastCover';
import type { OLRatings, OLShelves } from '../api/reviewCache';
import MiniPlayer from '../components/player/MiniPlayer';
// Canonical play function — all "start this book" paths route through here
// for consistent resume-from-saved-position and UI-sync behaviour.
// togglePlayback is used by the local playback branch to pause/resume
// without touching session state.
import { playBook, playEpisode, togglePlayback, resumePlayback } from '../api/playbook';
import { skipSeconds } from '../lib/playbackPrefs';

const SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const MONO = "'JetBrains Mono', ui-monospace, monospace";

type SleepMode = null | number | 'chapter';

const SLEEP_OPTIONS: { id: SleepMode; label: string }[] = [
  { id: null,      label: 'Off'            },
  { id: 5,         label: '5 minutes'      },
  { id: 15,        label: '15 minutes'     },
  { id: 30,        label: '30 minutes'     },
  { id: 60,        label: '1 hour'         },
  { id: 'chapter', label: 'End of chapter' },
];

const transportBtn = (): CSSProperties => ({
  width: 44, height: 44, borderRadius: 10,
  background: 'var(--onyx-glass)', border: '1px solid var(--onyx-glass-edge)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: 'var(--onyx-text)', cursor: 'pointer', padding: 0,
});

const transportBtnSmall = (): CSSProperties => ({
  width: 40, height: 40, borderRadius: 10,
  background: 'var(--onyx-glass)', border: '1px solid var(--onyx-glass-edge)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: 'var(--onyx-text-dim)', cursor: 'pointer', padding: 0,
});

export interface PlayerProps {
  st: OnyxState;
}

export default function Player({ st }: PlayerProps) {
  // Metadata derives from the focused book; playback position/state stays on currentBook.
  const b = st.focusedBook ?? st.currentBook;
  if (!b) return null;

  const isFocusedDifferent = st.focusedBookId !== null && st.focusedBookId !== st.currentBookId;

  // Podcast-aware presentation. `b` is a minified library item (no episodes[]),
  // so the playing episode's metadata comes from st.currentEpisode (set by
  // playEpisode). Episode notes stand in for the book synopsis.
  const isPodcast = b.mediaType === 'podcast';
  const ep = isPodcast ? st.currentEpisode : null;
  // Feed artwork fallback for the cover when the ABS server cover is missing.
  // Stored items may carry imageUrl or the raw-feed `image` key; older ones have
  // neither, so podcastFeedImg (resolved below) backfills from the live feed.
  const podcastMeta = isPodcast ? (asPodcastItem(b).media.metadata as unknown as Record<string, unknown>) : undefined;
  const podcastImageUrl = isPodcast
    ? ((podcastMeta?.imageUrl as string) || (podcastMeta?.image as string) || undefined)
    : undefined;
  // A podcast episode selected from the feed that isn't downloaded yet: it has no
  // ABS episode id, so there's no session to play — the player offers Download.
  const episodePending = isPodcast && !!st.currentEpisode && !st.currentEpisodeId;
  const detailLabel = isPodcast ? 'Description' : 'Synopsis';
  // Descriptions are remote HTML (ABS metadata / arbitrary podcast RSS) headed
  // for dangerouslySetInnerHTML — sanitize down to basic formatting first.
  // Memoized because the player re-renders on every 1 Hz playback tick.
  const rawDescription = isPodcast
    ? (ep?.description || b.media?.metadata?.description || '')
    : (b.media?.metadata?.description || '');
  const descriptionHtml = React.useMemo(() => sanitizeHtml(rawDescription), [rawDescription]);
  const noDescText = isPodcast ? 'No description available.' : 'No synopsis available.';

  // Chapters are locked when the focused book differs from the playing book,
  // OR when playback has not yet started (position is 0 and not playing).
  // This prevents the chapter list from highlighting chapter 1 before the
  // user has pressed play.
  const chaptersLocked = isFocusedDifferent || (!st.playing && st.position === 0);

  // Fetched chapters for the focused book when it differs from the playing book.
  // Library-list items don't include chapter data, so we fetch the full item.
  const [fetchedFocusedChapters, setFetchedFocusedChapters] = useState(bookChapters(b));

  useEffect(() => {
    const fid = st.focusedBookId;
    if (!fid) return;
    if (fid === st.currentBookId && st.currentBookChapters.length > 0) {
      setFetchedFocusedChapters(st.currentBookChapters);
      return;
    }
    // Local-library items already carry their chapters from the scan — read them
    // straight from the catalog item instead of the server-bound fetchItem path
    // (which would reject with no server). Mirrors onyx's currentBookChapters effect.
    const localItem = st.library.find(it => it.id === fid);
    if (localItem?.localPath) {
      setFetchedFocusedChapters(bookChapters(localItem));
      return;
    }
    let cancelled = false;
    fetchItem(st.serverUrl, fid)
      .then(item => { if (!cancelled) setFetchedFocusedChapters(bookChapters(item)); })
      .catch(logErr);
    return () => { cancelled = true; };
  }, [st.focusedBookId, st.library]); // eslint-disable-line react-hooks/exhaustive-deps

  // Podcast episodes carry their own optional chapters (same {start,end,title}
  // shape as books) on the episode object, not on the item. Map them into the
  // onyx Chapter shape so the existing chapter machinery (list, waveform,
  // timer, scrub, prev/next) works for episodes that provide chapters.
  const episodeChapters = (isPodcast && ep?.chapters)
    ? ep.chapters.map((c, i) => ({ n: i + 1, t: c.title, dur: (c.end ?? 0) - (c.start ?? 0) }))
    : [];
  // Chapters for the chapter list come from the focused book (fetched on demand).
  // For the waveform scrubber we use the playing item's chapters (episode chapters
  // for podcasts, currentBookChapters for books) so position maps correctly.
  const chapters = isPodcast ? episodeChapters : st.currentBookChapters; // waveform/position only
  const displayChapters = isFocusedDifferent
    ? fetchedFocusedChapters
    : chapters;
  const { idx: chIdx, local: chLocal, chapter: curCh } = chapterAt(chapters, st.position);
  // Items without a chapter timeline (podcast episodes that ship no chapters)
  // drive the transport in absolute time: position within the whole episode
  // rather than within a chapter. dispLocal/dispTotal feed timer/waveform/scrub.
  const hasChapters = chapters.length > 0;
  const dispLocal = hasChapters ? chLocal : st.position;
  const dispTotal = hasChapters ? curCh.dur : st.bookSecs;

  // When viewing a non-playing book, use saved media progress to determine
  // which chapters have been completed and which is the current position.
  const focusedProgress = isFocusedDifferent
    ? st.mediaProgress.find(p => p.libraryItemId === st.focusedBookId)
    : null;
  // Saved playback position for the focused book (0 if never started)
  const focusedPosition = focusedProgress?.currentTime ?? 0;
  // Find the chapter the focused book is paused at, using the same
  // cumulative-duration logic as chapterAt() — reuses the same helper
  // to stay consistent with how the live chapter index is derived.
  const focusedChIdx = isFocusedDifferent
    ? chapterAt(displayChapters, focusedPosition).idx
    : chIdx;

  const autoPlayNext = localStorage.getItem('onyx.playback.autoPlayNext') !== 'false';
  const raw = localStorage.getItem('onyx.playback.sleepDefault') ?? '"Off"';
  const sleepDefault = JSON.parse(raw) as string;

  const playerBookmarks = st.bookmarks.filter(bm => bm.libraryItemId === (st.focusedBookId ?? st.currentBookId));

  // ── Local stop-point log ───────────────────────────────────────────────────
  // Tab switcher state for the bookmarks panel.
  const [bookmarkTab, setBookmarkTab] = useState<'bookmarks' | 'local'>('bookmarks');
  // Stop points loaded from disk for the currently focused book.
  const [stopPoints, setStopPoints] = useState<LocalStopPoint[]>([]);

  // Stable callback — records the current position for the current book.
  // Deps include currentBookId and position so the closure stays fresh.
  const recordStop = useCallback(() => {
    if (st.currentBookId && st.position > 0) {
      recordStopPoint(st.currentBookId, st.position).catch(logErr);
    }
  }, [st.currentBookId, st.position]);

  // Record a stop point when playback pauses (playing transitions true→false).
  useEffect(() => {
    if (!st.playing) recordStop();
  }, [st.playing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Record a stop point when the active book changes so the previous book's
  // position is captured before the player resets to the new book.
  // posRef always holds the most recent position even across renders.
  const posRef = useRef(0);
  posRef.current = st.position;
  const prevBookIdRef = useRef('');
  useEffect(() => {
    if (prevBookIdRef.current && prevBookIdRef.current !== st.currentBookId) {
      // The book just switched — save where we were in the previous book.
      if (posRef.current > 0) {
        recordStopPoint(prevBookIdRef.current, posRef.current).catch(logErr);
      }
    }
    prevBookIdRef.current = st.currentBookId;
  }, [st.currentBookId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load stop points from disk when the Local Play tab is open or the focused book changes.
  const focusId = st.focusedBookId ?? st.currentBookId;
  useEffect(() => {
    if (!focusId || bookmarkTab !== 'local') return;
    getStopPoints(focusId).then(setStopPoints).catch(logErr);
  }, [focusId, bookmarkTab]);

  // A local-library item has no server — bookmarks go to the catalog instead.
  // Key off the focused book (what's on screen), not the playing book, so in
  // split mode bookmarks load/add against the book the user is viewing.
  const isLocalItem = !!st.library.find(b => b.id === focusId)?.localPath;

  // Load a local item's catalog bookmarks into shared state so they render in the
  // same list as server bookmarks (playerBookmarks filters by libraryItemId).
  useEffect(() => {
    if (!isLocalItem || !focusId) return;
    getLocalBookmarks(focusId)
      .then(bms => {
        const others = st.bookmarks.filter(b => b.libraryItemId !== focusId);
        st.setBookmarks([...others, ...bms]);
      })
      .catch(err => log.error('playback', 'local bookmark load failed', { err: String(err) }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLocalItem, focusId]);

  const addBookmark = async () => {
    try {
      const title = curCh.t
        ? `${curCh.t} — ${fmtTime(st.position)}`
        : fmtTime(st.position);
      if (isLocalItem) {
        await addLocalBookmark(focusId, title, st.position);
        const bms = await getLocalBookmarks(focusId);
        const others = st.bookmarks.filter(b => b.libraryItemId !== focusId);
        st.setBookmarks([...others, ...bms]);
      } else {
        await createBookmark(st.serverUrl, focusId, st.position, title);
        const me = await getMe(st.serverUrl);
        st.setBookmarks(me.bookmarks);
      }
    } catch (err) {
      log.error('playback', 'bookmark create failed', { err: String(err) });
    }
  };

  // undefined = not fetched yet, null = fetched but not found, string = OL work key
  const [olWorkKey, setOlWorkKey] = useState<string | null | undefined>(undefined);
  const [olRatings, setOlRatings] = useState<OLRatings | null>(null);
  const [olShelves, setOlShelves] = useState<OLShelves | null>(null);

  // Backfill the podcast cover from the live feed when the item carries no image.
  const [podcastFeedImg, setPodcastFeedImg] = useState<string | undefined>(
    () => (isPodcast ? cachedPodcastImage(b.id) : undefined),
  );
  useEffect(() => {
    if (!isPodcast || podcastImageUrl) return;
    const cached = cachedPodcastImage(b.id);
    if (cached) { setPodcastFeedImg(cached); return; }
    const feedUrl = podcastMeta?.feedUrl as string | undefined;
    if (!feedUrl) return;
    resolvePodcastImage(st.serverUrl, b.id, feedUrl).then(u => { if (u) setPodcastFeedImg(u); });
  }, [isPodcast, b.id, podcastImageUrl, podcastMeta, st.serverUrl]);

  // Download-then-play for a pending (undownloaded) episode: queue the download,
  // poll the item until the episode lands with an id, then start playback.
  const [dlState, setDlState] = useState<'idle' | 'downloading'>('idle');
  const downloadAndPlay = async () => {
    const ep = st.currentEpisode;
    const pid = st.currentBookId;
    if (!ep || !pid) return;
    const key = episodeKey(ep);
    setDlState('downloading');

    // ── Local podcast: the download command resolves when the file lands, so we
    // re-list the podcast's episodes and play the now-downloaded match directly. ──
    if (st.activeLibrary?.source === 'local') {
      try {
        await downloadLocalEpisode(pid, ep);
        const items = await getLocalPodcastItems(st.currentLibraryId);
        const eps = items.find(i => i.id === pid)
          ? asPodcastItem(items.find(i => i.id === pid)!).media.episodes ?? []
          : [];
        const match = eps.find(e => episodeKey(e) === key) ?? eps.find(e => e.title === ep.title);
        setDlState('idle');
        if (match?.id) {
          await st.refreshLibrary().catch(() => {});
          // Surface a post-download play failure — the user just watched the
          // download succeed, so a silent no-op reads as a dead play button.
          await playEpisode(st, pid, match).catch(err => {
            log.error('playback', 'play after local episode download failed', { itemId: pid, err: String(err) });
            st.setToast({ message: 'Downloaded, but playback could not start — tap the episode to retry', type: 'error' });
          });
        } else {
          st.setToast({ message: 'Downloaded — open the episode to play', type: 'info' });
        }
      } catch (e) {
        log.error('downloads', 'local episode download failed', { err: String(e) });
        st.setToast({ message: 'Download failed', type: 'error' });
        setDlState('idle');
      }
      return;
    }

    try {
      await downloadEpisodes(st.serverUrl, pid, [ep]);
    } catch (e) {
      log.error('downloads', 'episode download failed', { err: String(e) });
      st.setToast({ message: 'Download failed', type: 'error' });
      setDlState('idle');
      return;
    }
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const item = await fetchItem(st.serverUrl, pid);
        const eps = asPodcastItem(item).media.episodes ?? [];
        const match = eps.find(e => episodeKey(e) === key) ?? eps.find(e => e.title === ep.title);
        if (match?.id) {
          setDlState('idle');
          // Same visibility rule as the local branch: a failed auto-play after
          // a visible download must tell the user, not just the console.
          await playEpisode(st, pid, match).catch(err => {
            log.error('playback', 'play after episode download failed', { itemId: pid, err: String(err) });
            st.setToast({ message: 'Downloaded, but playback could not start — tap the episode to retry', type: 'error' });
          });
          return;
        }
      } catch { /* keep polling */ }
    }
    setDlState('idle');
    st.setToast({ message: 'Download is taking a while — it will appear once finished', type: 'info' });
  };

  useEffect(() => {
    setOlWorkKey(undefined);
    setOlRatings(null);
    setOlShelves(null);
    if (!b) return;
    // Open Library is book-only — skip the lookup entirely for podcasts.
    if (isPodcast) return;

    // Serve from cache immediately if fresh — no network request.
    const cached = getCachedReview(b.id);
    if (cached) {
      if (st.enableOpenLibrary) {
        setOlWorkKey(cached.olWorkKey);
        setOlRatings(cached.olRatings);
        setOlShelves(cached.olShelves);
      }
      return;
    }

    // Cache miss — fetch Open Library.
    let cancelled = false;

    (async () => {
      try {
        const meta = b.media?.metadata;
        const isbn = meta?.isbn13 || meta?.isbn10 || meta?.isbn;

        let olKey: string | null = null;
        let olRat: OLRatings | null = null;
        let olSh: OLShelves | null = null;

        if (st.enableOpenLibrary) {
          let rawWorkId: string | null = null;
          if (isbn) {
            const res = await fetch(
              `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`,
            );
            const data = await res.json();
            rawWorkId = data[`ISBN:${isbn}`]?.works?.[0]?.key ?? null;
          }
          if (!rawWorkId) {
            const res = await fetch(
              `https://openlibrary.org/search.json?title=${encodeURIComponent(bookTitle(b))}&author=${encodeURIComponent(bookAuthor(b))}&limit=1`,
            );
            const data = await res.json();
            rawWorkId = data.docs?.[0]?.key ?? null;
          }
          if (rawWorkId) {
            olKey = rawWorkId.replace(/^\/works\//, '');
            const [ratRes, shRes] = await Promise.all([
              fetch(`https://openlibrary.org/works/${olKey}/ratings.json`),
              fetch(`https://openlibrary.org/works/${olKey}/bookshelves.json`),
            ]);
            const [ratData, shData] = await Promise.all([ratRes.json(), shRes.json()]);
            olRat = { average: ratData.summary?.average ?? null, count: ratData.summary?.count ?? null };
            olSh  = { wantToRead: shData.counts?.want_to_read ?? null, reading: shData.counts?.currently_reading ?? null, alreadyRead: shData.counts?.already_read ?? null };
          }
        }

        if (cancelled) return;

        if (st.enableOpenLibrary) {
          setOlWorkKey(olKey);
          setOlRatings(olRat);
          setOlShelves(olSh);
        }

        setCachedReview(b.id, { olWorkKey: olKey, olRatings: olRat, olShelves: olSh });
      } catch (e) {
        log.error('metadata', 'Open Library review fetch failed', { err: String(e) });
        if (!cancelled) setOlWorkKey(null);
      }
    })();
    return () => { cancelled = true; };
  }, [st.currentBookId, st.enableOpenLibrary]); // eslint-disable-line react-hooks/exhaustive-deps

  function parseSleepDefault(raw: string): SleepMode {
    if (raw === '15m') return 15;
    if (raw === '30m') return 30;
    if (raw === '1h') return 60;
    if (raw === 'End of chapter') return 'chapter';
    return null;
  }
  const [sleepMode, setSleepMode] = useState<SleepMode>(parseSleepDefault(sleepDefault));
  const [sleepRemain, setSleepRemain] = useState(0);
  const [sleepOpen, setSleepOpen] = useState(false);

  // Preview card animation state
  const [showTransport, setShowTransport] = useState(false);
  const [btnOut, setBtnOut] = useState(false);
  const [btnMounted, setBtnMounted] = useState(true);
  const [contentVisible, setContentVisible] = useState(false);
  const sleepRef = useRef<HTMLDivElement>(null);
  const chapterAtStart = useRef(chIdx);
  const prevChIdxRef = useRef(chIdx);

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(900);
  // Width actually available to the right-hand panes (measured on the bottom row),
  // which is the correct signal for the 3-columns-vs-1-tabbed-pane decision —
  // independent of the left column width and the interface-scale transform.
  const bottomRowRef = useRef<HTMLDivElement>(null);
  const [paneAreaWidth, setPaneAreaWidth] = useState(900);

  const leftColRef = useRef<HTMLDivElement>(null);
  const [leftColumnWidth, setLeftColumnWidth] = useState(480);

  const isMiniPlayerVisible = isFocusedDifferent && !!st.currentBookId;
  const maxCoverRatio = isMiniPlayerVisible ? 0.35 : 0.40;
  const maxByHeight = Math.max(120, Math.round(containerHeight * maxCoverRatio));
  const maxByWidth  = Math.max(120, Math.round(leftColumnWidth * 0.85));
  const coverSize   = Math.min(maxByHeight, maxByWidth, leftColumnWidth);

  // Compact mode: reduce transport bar chrome when the window is too short for
  // the full layout. At 600px the waveform, buttons, and spacing are halved.
  const isCompact = containerHeight < 600;

  // Pane layout: three side-by-side panes need horizontal room, so the collapse
  // to a single tabbed pane is driven by the pane-area WIDTH (not height). Below
  // ~780px (≈ three readable ~250px panes + gaps) the bottom row becomes one
  // tabbed pane and the synopsis moves to a tab; above it, three columns show and
  // the synopsis renders inline in the left column.
  const panesStacked = paneAreaWidth < 780;

  // Active pane in the compact single-column carousel — only used when isCompact.
  // Defaults to chapters as that is the most-used panel during playback. The
  // Synopsis lives here as its own pane (rather than a left-column flyout).
  const [activePane, setActivePane] = useState<'details' | 'chapters' | 'bookmarks' | 'synopsis'>('chapters');

  // ── Chapter-list auto-scroll ──────────────────────────────────────────────
  // The currently-playing (or focused) chapter, mirroring rowChIdx in the list.
  const activeChapterIdx = isFocusedDifferent ? focusedChIdx : chaptersLocked ? -1 : chIdx;
  const chapterListRef = useRef<HTMLDivElement>(null);
  const activeChapterRef = useRef<HTMLButtonElement>(null);
  // Keep the active chapter centred in its scroll container as progress advances
  // (and when the panel first becomes visible). Scrolls only the list container,
  // never the window — re-runs only when the chapter index changes, not per tick.
  useEffect(() => {
    const chaptersVisible = !panesStacked || activePane === 'chapters';
    if (!chaptersVisible || activeChapterIdx < 0) return;
    const container = chapterListRef.current;
    const el = activeChapterRef.current;
    if (!container || !el) return;
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    // El top relative to the container's scrollable content, then centre it.
    const offsetWithin = eRect.top - cRect.top + container.scrollTop;
    const target = offsetWithin - container.clientHeight / 2 + el.clientHeight / 2;
    container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }, [activeChapterIdx, activePane, panesStacked]);

  const waveformRef = useRef<HTMLDivElement>(null);
  const [waveWidth, setWaveWidth] = useState(600);

  const transportRef = useRef<HTMLDivElement>(null);
  const [transportWidth, setTransportWidth] = useState(700);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      setContainerHeight(entries[0].contentRect.height);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Measure the pane area (the right-hand bottom row) to drive panesStacked.
  useEffect(() => {
    if (!bottomRowRef.current) return;
    const ro = new ResizeObserver(entries => {
      setPaneAreaWidth(entries[0].contentRect.width);
    });
    ro.observe(bottomRowRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!leftColRef.current) return;
    const ro = new ResizeObserver(entries => {
      setLeftColumnWidth(entries[0].contentRect.width);
    });
    ro.observe(leftColRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!waveformRef.current) return;
    const ro = new ResizeObserver(entries => {
      setWaveWidth(entries[0].contentRect.width);
    });
    ro.observe(waveformRef.current);
    return () => ro.disconnect();
  }, []);

  // When the waveform container mounts after preview card expansion,
  // the empty-deps effect above has already run and won't re-fire.
  // This effect takes a fresh measurement when showTransport becomes true.
  useEffect(() => {
    if (!showTransport || !waveformRef.current) return;
    setWaveWidth(waveformRef.current.getBoundingClientRect().width || 600);
  }, [showTransport]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!transportRef.current) return;
    const ro = new ResizeObserver(entries => {
      setTransportWidth(entries[0].contentRect.width);
    });
    ro.observe(transportRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (typeof sleepMode === 'number') setSleepRemain(sleepMode * 60);
    if (sleepMode === 'chapter') chapterAtStart.current = chIdx;
  }, [sleepMode]); // chIdx intentionally excluded

  useEffect(() => {
    if (typeof sleepMode !== 'number' || !st.playing) return;
    const t = setInterval(() => {
      setSleepRemain(r => {
        if (r <= 1) {
          pauseAudio().catch(logErr);
          st.setPlaying(false);
          setSleepMode(null);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [sleepMode, st.playing]);

  useEffect(() => {
    if (sleepMode === 'chapter' && chIdx !== chapterAtStart.current) {
      pauseAudio().catch(logErr);
      st.setPlaying(false);
      setSleepMode(null);
    }
  }, [chIdx]); // sleepMode/setPlaying excluded intentionally

  useEffect(() => {
    if (chIdx > prevChIdxRef.current && st.playing && !autoPlayNext) {
      pauseAudio().catch(logErr);
      st.setPlaying(false);
    }
    prevChIdxRef.current = chIdx;
  }, [chIdx]); // st.playing/autoPlayNext read at effect fire time; chIdx is the trigger

  useEffect(() => {
    if (!sleepOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!sleepRef.current?.contains(e.target as Node)) setSleepOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [sleepOpen]);

  // Keep backend volume in sync with the UI slider.
  useEffect(() => {
    setAudioVolume(Math.round(st.volume * 100)).catch(() => {});
  }, [st.volume]);

  // Reset preview animation when the user focuses a new book.
  useEffect(() => {
    setShowTransport(false);
    setBtnOut(false);
    setBtnMounted(true);
    setContentVisible(false);
  }, [st.focusedBookId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fade transport contents in 300ms after the card starts expanding.
  useEffect(() => {
    if (!showTransport) { setContentVisible(false); return; }
    const t = setTimeout(() => setContentVisible(true), 300);
    return () => clearTimeout(t);
  }, [showTransport]);


  const sleepLabel: string | null = sleepMode == null
    ? null
    : sleepMode === 'chapter'
      ? 'End of chapter'
      : `${Math.floor(sleepRemain / 60)}:${String(sleepRemain % 60).padStart(2, '0')}`;

  const onScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    // Chapterless items scrub across the whole episode; chaptered items scrub
    // within the current chapter (the waveform represents one chapter).
    const target = hasChapters
      ? chapterStart(chapters, chIdx) + frac * curCh.dur
      : frac * st.bookSecs;
    seekAudio(target).catch(logErr);
    // Optimistic position update — without it the waveform/time display lags
    // one playback tick (~1s) behind the seek (other seek paths do the same).
    st.setPosition(target);
  };

  const bSeries = bookSeries(b);

  const handlePlayPause = async () => {
    try {
      // Viewing a different book than the one playing — start the focused book
      // via the canonical loader (routes local/server correctly and resumes
      // from its saved position). This must precede the local short-circuit
      // below, otherwise Play would merely toggle the already-playing book.
      if (isFocusedDifferent) {
        await playBook(st, st.focusedBookId!);
        return;
      }

      // Local playback mode (same book) — no session management needed.
      // Call audio commands directly, same as the MiniPlayer toggle.
      // Without this branch, the !st.sessionReady check below would fire
      // (we never set sessionReady=true for local files) and call playBook
      // again, restarting the file from the beginning instead of pausing.
      if (st.isLocalPlayback) {
        await togglePlayback(st);
        return;
      }

      if (!st.sessionReady) {
        // Fallback: preload didn't arm a session (e.g. cold launch edge case).
        // Start the current/focused book with proper resume logic.
        await playBook(st, st.focusedBookId ?? st.currentBookId);
      } else if (st.playing) {
        // Session already open and playing — just pause.
        await pauseAudio();
      } else {
        // Session already open but paused — resume (applies auto-rewind-on-resume).
        await resumePlayback(st);
      }
    } catch (err) {
      log.error('playback', 'play/pause failed', { err: String(err) });
    }
  };

  const handlePlayFocused = async () => {
    // Animate the button out and expand the transport bar.
    setBtnOut(true);
    // Expand the card after 50ms to allow the button exit animation to begin first.
    setTimeout(() => setShowTransport(true), 50);
    // Remove the button from the DOM after the exit animation completes (300ms).
    setTimeout(() => setBtnMounted(false), 300);

    // Start the focused book through the canonical loader: it routes local vs
    // server playback, resolves the catalog/server resume position, plays the
    // right file, and sets currentBookId/focusedBookId/position itself. Replaces
    // the old state-only mutation that relied on a follow-up Play (which on
    // local toggled the previous audio and discarded the saved resume point).
    try {
      await playBook(st, st.focusedBookId!);
    } catch (err) {
      log.error('playback', 'play focused failed', { err: String(err) });
    }
  };

  // Responsive title size — shrink longer titles (and in short windows) so the
  // heading fits the left column instead of clipping.
  const displayTitle = isPodcast ? (ep?.title || bookTitle(b)) : bookTitle(b);
  let titleFontSize = isPodcast ? 30 : 48;
  if (displayTitle.length > 42) titleFontSize = isPodcast ? 22 : 30;
  else if (displayTitle.length > 28) titleFontSize = isPodcast ? 26 : 38;
  if (containerHeight < 620) titleFontSize = Math.min(titleFontSize, isPodcast ? 24 : 34);

  // ── Bookmarks timeline-rail helpers ──
  // "Jun 14, 2026 · 5:36 PM" style stamp for local entries.
  const fmtStamp = (ms: number) => {
    const d = new Date(ms);
    return `${d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  };
  // Chapter ({ n, t }) at an absolute position within a given chapter set.
  // Saved bookmarks belong to the focused book (displayChapters); local stop
  // points were recorded against the playing book (chapters).
  const chapterAtPos = (pos: number, chs: typeof displayChapters) => (chs.length ? chapterAt(chs, pos).chapter : null);
  // One row of the timeline rail: a connecting line + dot, then time/label/meta.
  const railRow = (opts: { keyId: string; time: string; label: string; italic: boolean; meta?: string; accent: boolean; isLast: boolean; onClick: () => void }) => (
    <button key={opts.keyId} onClick={opts.onClick} style={{ display: 'flex', gap: 14, width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', color: 'inherit', padding: 0 }}>
      {/* Rail: vertical connector (omitted on the last row) + the dot */}
      <div style={{ position: 'relative', width: 14, flexShrink: 0, alignSelf: 'stretch', display: 'flex', justifyContent: 'center' }}>
        {!opts.isLast && <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 14, bottom: -2, width: 1, background: 'var(--onyx-line)' }} />}
        <div style={{ position: 'absolute', top: 4, width: 9, height: 9, borderRadius: '50%', background: opts.accent ? 'var(--onyx-accent)' : 'var(--onyx-text-mute)', boxShadow: opts.accent ? '0 0 8px var(--onyx-accent)' : 'none' }} />
      </div>
      {/* Content */}
      <div style={{ flex: 1, minWidth: 0, paddingBottom: 18 }}>
        <div style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, color: 'var(--onyx-accent)' }}>{opts.time}</div>
        <div style={{ fontFamily: SERIF, fontStyle: opts.italic ? 'italic' : 'normal', fontSize: 14, color: 'var(--onyx-text)', lineHeight: 1.3, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis' }}>{opts.label}</div>
        {opts.meta && <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.04em', marginTop: 5 }}>{opts.meta}</div>}
      </div>
    </button>
  );

  return (
    <div ref={containerRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '12px 32px 24px', minHeight: 0, width: '100%', maxWidth: '100%', overflow: 'hidden', position: 'relative' }}>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: isCompact ? 8 : 18, /* Reduced in compact mode — volume/device controls move to transport bar */ fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--onyx-text-mute)' }}>
        <button onClick={() => st.setScreen('library')} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'var(--onyx-text-dim)', cursor: 'pointer', padding: 4, fontFamily: 'inherit', fontSize: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit' }}>
          <Icon name="chevron-left" size={12} /> Library
        </button>
        <span>·</span>
        <span>{bSeries}</span>
        {/* Volume and device controls — hidden in compact mode, they move to the transport bar */}
        {!isCompact && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, textTransform: 'none', letterSpacing: 'normal' }}>
            <VolumeControl st={st} />
            <DeviceSelector st={st} />
          </div>
        )}
      </div>

      <div style={{ flex: 1, display: 'flex', gap: 32, alignItems: 'stretch', minHeight: 0, overflow: 'hidden' }}>

        <div ref={leftColRef} style={{ minWidth: 0, maxWidth: 360, flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', minHeight: 0 }}>
          <div style={{ position: 'absolute', inset: '5% 5% 0 5%', borderRadius: 24, background: 'radial-gradient(50% 50% at 50% 50%, rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.28), transparent 70%)', filter: 'blur(60px)', zIndex: 0 }} />
          <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: coverSize, aspectRatio: '1 / 1', overflow: 'hidden' }}>
            <Cover item={b} size={coverSize} fill serverUrl={st.serverUrl} fallbackImageUrl={podcastImageUrl ?? podcastFeedImg} style={{ transition: 'width 0.3s ease, height 0.3s ease' }} />
          </div>
          <div style={{ marginTop: 32, textAlign: 'center', position: 'relative', zIndex: 1, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, width: '100%' }}>
            <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--onyx-accent)', marginBottom: 8 }}>{isPodcast ? 'Podcast' : bSeries}</div>
            <div style={{ fontFamily: SERIF, fontSize: titleFontSize, fontWeight: 500, lineHeight: 1.05, letterSpacing: '-0.02em', transition: 'font-size 0.2s ease' }}>{displayTitle}</div>
            {isPodcast ? (
              // For an episode, the "show" is the podcast title; author filtering
              // is book-only so this line is plain text.
              <div style={{ marginTop: 10, fontSize: 16, color: 'var(--onyx-text-dim)' }}>{bookTitle(b)}</div>
            ) : (
              <>
                <div style={{ marginTop: 10, fontSize: 16, color: 'var(--onyx-text-dim)' }}>
                  by{' '}
                  <span
                    onClick={() => { st.setContextFilter({ kind: 'author', value: bookAuthor(b) }); st.setShelfTab('library'); st.setScreen('library'); }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.textDecorationColor = 'var(--onyx-text-dim)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.textDecorationColor = 'transparent'; }}
                    style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'transparent', transition: 'text-decoration-color 0.15s' }}
                  >{bookAuthor(b)}</span>
                </div>
                <div style={{ marginTop: 2, fontSize: 13, color: 'var(--onyx-text-mute)' }}>
                  {bookNarrator(b) && <>
                    narrated by{' '}
                    <span
                      onClick={() => { st.setContextFilter({ kind: 'narrator', value: bookNarrator(b) }); st.setShelfTab('library'); st.setScreen('library'); }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.textDecorationColor = 'var(--onyx-text-mute)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.textDecorationColor = 'transparent'; }}
                      style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'transparent', transition: 'text-decoration-color 0.15s' }}
                    >{bookNarrator(b)}</span>
                  </>}
                </div>
              </>
            )}

            {/* Synopsis — inline in the left column on large windows. On small
                (compact) windows it moves to its own right-hand pane instead (see
                the bottom-row tabs), so it never competes with the MiniPlayer. */}
            {!panesStacked && (
              <div style={{ marginTop: 24, width: '100%', textAlign: 'left', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--onyx-text-mute)', marginBottom: 8 }}>
                  {detailLabel}
                </div>
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  {descriptionHtml ? (
                    <div
                      className="onyx-selectable"
                      style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--onyx-text-dim)' }}
                      dangerouslySetInnerHTML={{ __html: descriptionHtml }}
                    />
                  ) : (
                    <div style={{ fontSize: 13, color: 'var(--onyx-text-mute)', fontStyle: 'italic' }}>
                      {noDescText}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          {/* In-flow at the column bottom — full width, never overlaps the title/synopsis. */}
          <MiniPlayer st={st} />
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>

          <Glass translucent={st.translucent} style={{
            padding: (isFocusedDifferent && !showTransport) ? '14px 26px' : 26,
            maxHeight: (isFocusedDifferent && !showTransport) ? 68 : 700,
            overflow: 'hidden',
            transition: 'max-height 350ms ease-out, padding 300ms ease-out',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: (isFocusedDifferent && !showTransport) ? 'center' : 'flex-start',
          }}>
            {/* Pending podcast episode — offer download, then auto-play. */}
            {episodePending && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, minHeight: 160, textAlign: 'center' }}>
                <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--onyx-text-mute)' }}>
                  Episode not downloaded
                </div>
                <button
                  onClick={downloadAndPlay}
                  disabled={dlState === 'downloading'}
                  style={{
                    minWidth: 220, padding: '11px 18px', borderRadius: 8, border: 'none',
                    cursor: dlState === 'downloading' ? 'default' : 'pointer',
                    background: dlState === 'downloading' ? 'var(--onyx-line)' : 'var(--onyx-accent)',
                    color: dlState === 'downloading' ? 'var(--onyx-text-mute)' : 'var(--onyx-bg)',
                    fontFamily: MONO, fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  }}
                >
                  <Icon name={dlState === 'downloading' ? 'dot' : 'play'} size={13} />
                  {dlState === 'downloading' ? 'Downloading…' : 'Download episode'}
                </button>
                {dlState === 'downloading' && (
                  <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.04em' }}>
                    Fetching from the feed — playback starts automatically.
                  </div>
                )}
              </div>
            )}
            {/* Preview: Play this book button */}
            {!episodePending && isFocusedDifferent && btnMounted && (
              <div style={{
                display: 'flex', justifyContent: 'center', alignItems: 'center',
                transform: btnOut ? 'translateY(40px)' : 'translateY(0)',
                opacity: btnOut ? 0 : 1,
                transition: 'transform 300ms ease-in, opacity 300ms ease-in',
              }}>
                <button
                  onClick={handlePlayFocused}
                  style={{
                    width: 280, padding: '11px 0',
                    background: 'var(--onyx-accent)', border: 'none', borderRadius: 8,
                    color: 'var(--onyx-bg)', cursor: 'pointer',
                    fontFamily: MONO, fontSize: 12, fontWeight: 600,
                    letterSpacing: '0.08em', textTransform: 'uppercase' as const,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  }}
                >
                  <Icon name="play" size={13} /> Play this book
                </button>
              </div>
            )}
            {/* Full transport: live or post-expansion */}
            {!episodePending && (!isFocusedDifferent || showTransport) && (
              <div style={{
                opacity: (isFocusedDifferent && showTransport) ? (contentVisible ? 1 : 0) : 1,
                transition: 'opacity 250ms ease-in',
              }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 22 }}>
                <div style={{ minWidth: 0 }}>
                  {/* Eyebrow always visible — tells the user what will play when they press the button */}
                  <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--onyx-text-mute)' }}>Now playing · {bookTitle(st.currentBook ?? b)}</div>
                  {/* Only show chapter title once playback has started — before that,
                      nothing is technically playing so showing a chapter would be misleading. */}
                  {(st.playing || st.position > 0) && (
                    <div style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 500, marginTop: 4, letterSpacing: '-0.005em' }}>{curCh.t}</div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontFamily: MONO, fontSize: 11, color: 'var(--onyx-text-dim)' }}>
                  <span style={{ fontSize: 14, color: 'var(--onyx-text)', fontWeight: 500 }}>{fmtTime(dispLocal)}</span>
                  <span style={{ color: 'var(--onyx-text-mute)' }}>/</span>
                  <span>{fmtTime(dispTotal)}</span>
                </div>
              </div>

              <div ref={waveformRef} onClick={onScrub} style={{ cursor: 'pointer', position: 'relative', width: '100%', flex: 1, minWidth: 0 }}>
                <Waveform width={waveWidth} height={isCompact ? 36 : 72} progress={dispTotal > 0 ? dispLocal / dispTotal : 0} color="var(--onyx-accent)" dim="rgba(255,255,255,0.15)" bars={140} flat />
              </div>

              <div ref={transportRef} style={{ marginTop: isCompact ? 6 : 22, display: 'flex', alignItems: 'center', justifyContent: 'space-between', minWidth: 0, overflow: 'visible' }}>

              {/* Left group — speed pills normally; volume control in compact (speed recovers when window grows) */}
              {isCompact ? (
                // Compact: volume slider replaces the speed pills to reclaim horizontal space.
                <VolumeControl st={st} compact style={{ flex: '0 0 auto', minWidth: 0, maxWidth: 120 }} />
              ) : null}
              <div style={{ flex: '0 0 auto', minWidth: isCompact ? 0 : 160, display: isCompact ? 'none' : 'flex', gap: 6 }}>
                {transportWidth >= 620 && !isCompact ? (
                  SPEEDS.map(s => (
                    <button key={s} onClick={() => { st.setSpeed(s); setAudioSpeed(parseFloat(s)).catch(logErr); }} style={{
                      padding: '7px 12px', borderRadius: 6, fontFamily: MONO, fontSize: 11,
                      background: s === st.speed ? 'var(--onyx-accent-dim)' : 'transparent',
                      color: s === st.speed ? 'var(--onyx-accent)' : 'var(--onyx-text-dim)',
                      border: `1px solid ${s === st.speed ? 'var(--onyx-accent-edge)' : 'var(--onyx-glass-edge)'}`,
                      fontWeight: s === st.speed ? 600 : 400,
                      cursor: 'pointer',
                    }}>{s}×</button>
                  ))
                ) : (
                  <select
                    value={st.speed}
                    onChange={e => { st.setSpeed(e.target.value); setAudioSpeed(parseFloat(e.target.value)).catch(logErr); }}
                    style={{
                      height: 44,
                      borderRadius: 10,
                      background: 'var(--onyx-glass)',
                      border: '1px solid var(--onyx-glass-edge)',
                      color: 'var(--onyx-text)',
                      fontFamily: 'inherit',
                      fontSize: 12,
                      flexShrink: 1,
                      minWidth: 48,
                      paddingLeft: 8,
                      paddingRight: 8,
                      cursor: 'pointer',
                      outline: 'none',
                    }}
                  >
                    {SPEEDS.map(s => <option key={s} value={s}>{s}×</option>)}
                  </select>
                )}
              </div>

              {/* Center group — primary transport controls; flex: 1 with centered content
                  ensures play/pause/skip always sit at the geometric center of the row */}
              <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 14 }}>
                <button onClick={() => seekAudio(Math.max(0, st.position - skipSeconds())).catch(logErr)} title={`Back ${skipSeconds()}s`} style={isCompact ? { ...transportBtn(), width: 28, height: 28 } : transportBtn()}>
                  <Icon name="skip-back" size={isCompact ? 14 : 20} />
                </button>
                <button
                  onClick={handlePlayPause}
                  title={st.playing ? 'Pause (space)' : 'Play (space)'}
                  style={{ width: isCompact ? 36 : 64, height: isCompact ? 36 : 64, borderRadius: isCompact ? 18 : 32, background: 'var(--onyx-accent)', color: 'var(--onyx-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: 'none', boxShadow: '0 12px 32px rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.4)' }}
                >
                  <span style={{ display: 'inline-flex', marginLeft: st.playing ? 0 : 3 }}>
                    <Icon name={st.playing ? 'pause' : 'play'} size={isCompact ? 15 : 26} />
                  </span>
                </button>
                <button onClick={() => seekAudio(Math.min(st.bookSecs, st.position + skipSeconds())).catch(logErr)} title={`Forward ${skipSeconds()}s`} style={isCompact ? { ...transportBtn(), width: 28, height: 28 } : transportBtn()}>
                  <Icon name="skip-forward" size={isCompact ? 14 : 20} />
                </button>
              </div>

              {/* Right group — device selector (compact only) + bookmark + sleep timer; visible in both compact and full modes */}
              <div style={{ flex: '0 0 auto', minWidth: isCompact ? 0 : 160, display: 'flex' /* Visible in both compact and full modes */, justifyContent: 'flex-end', gap: 8 }}>
                {isCompact && (
                  /* In compact mode, device selector moves here to sit left of bookmark/sleep */
                  <DeviceSelector st={st} compact style={{ flex: '0 0 auto', minWidth: 0, maxWidth: 120 }} />
                )}
                <button onClick={addBookmark} style={isCompact ? { ...transportBtnSmall(), width: 28, height: 28 } : transportBtnSmall()} title="Bookmark this moment">
                  <Icon name="bookmark" size={isCompact ? 11 : 15} />
                </button>
                <div ref={sleepRef} style={{ position: 'relative', zIndex: 200 }}>
                  <button
                    onClick={() => setSleepOpen(o => !o)}
                    title={sleepLabel ? `Sleep timer: ${sleepLabel}` : 'Sleep timer'}
                    style={{
                      ...transportBtnSmall(),
                      background: sleepMode != null ? 'var(--onyx-accent-dim)' : 'var(--onyx-glass)',
                      border: `1px solid ${sleepMode != null ? 'var(--onyx-accent-edge)' : 'var(--onyx-glass-edge)'}`,
                      color: sleepMode != null ? 'var(--onyx-accent)' : 'var(--onyx-text-dim)',
                      width: sleepMode != null ? 'auto' : (isCompact ? 28 : 40),
                      height: isCompact ? 28 : 40,
                      padding: sleepMode != null ? '0 10px' : 0,
                      gap: 6,
                    }}
                  >
                    <Icon name="sleep" size={15} />
                    {sleepMode != null && (
                      <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>{sleepLabel}</span>
                    )}
                  </button>
                  {sleepOpen && (
                    <div style={{ position: 'absolute', bottom: 'calc(100% + 8px)', right: 0, background: 'var(--onyx-panel2)', border: '1px solid var(--onyx-line)', borderRadius: 10, boxShadow: '0 16px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(var(--onyx-accent-r),var(--onyx-accent-g),var(--onyx-accent-b),0.08)', padding: 6, zIndex: 300, minWidth: 170 }}>
                      <div style={{ fontFamily: MONO, fontSize: 9, color: 'var(--onyx-text-mute)', letterSpacing: '0.12em', padding: '6px 8px 4px', textTransform: 'uppercase' }}>Sleep Timer</div>
                      {SLEEP_OPTIONS.map(opt => {
                        const active = sleepMode === opt.id;
                        return (
                          <button key={String(opt.id)} onClick={() => { setSleepMode(opt.id); setSleepOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 6, background: active ? 'var(--onyx-accent-dim)' : 'transparent', border: 'none', width: '100%', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                            <span style={{ flex: 1, fontSize: 12.5, color: active ? 'var(--onyx-accent)' : 'var(--onyx-text)', fontWeight: active ? 600 : 400 }}>{opt.label}</span>
                            {active && <span style={{ display: 'inline-flex', color: 'var(--onyx-accent)' }}><Icon name="check" size={11} /></span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
            </div>
            )}
          </Glass>

          {/* Bottom row — three columns when wide enough, single tabbed pane when narrow */}
          <div ref={bottomRowRef} style={{ flex: 1, display: 'flex', flexDirection: panesStacked ? 'column' : 'row', gap: panesStacked ? 0 : 18, minHeight: 0, overflow: 'hidden' }}>

            {/* Stacked-only pill tab strip — switches the single visible pane */}
            {panesStacked && (
              <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexShrink: 0 }}>
                {(['details', 'chapters', 'bookmarks', 'synopsis'] as const).map(pane => (
                  <button
                    key={pane}
                    onClick={() => setActivePane(pane)}
                    style={{
                      // Active pill: gold tint; inactive: ghost
                      background: activePane === pane ? 'var(--onyx-accent-dim)' : 'transparent',
                      border: `1px solid ${activePane === pane ? 'var(--onyx-accent-edge)' : 'var(--onyx-glass-edge)'}`,
                      borderRadius: 999,
                      color: activePane === pane ? 'var(--onyx-accent)' : 'var(--onyx-text-mute)',
                      fontFamily: MONO,
                      fontSize: 10,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase' as const,
                      padding: '3px 12px',
                      cursor: 'pointer',
                    }}
                  >
                    {pane === 'synopsis' ? detailLabel : pane[0].toUpperCase() + pane.slice(1)}
                  </button>
                ))}
              </div>
            )}

            {/* ── Details panel — hidden in compact mode unless selected ── */}
            <Glass translucent={st.translucent} style={{ flex: 1, minWidth: 0, padding: 20, display: !panesStacked || activePane === 'details' ? 'flex' : 'none', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
              <div style={{ fontFamily: SERIF, fontSize: 16, fontWeight: 500, marginBottom: 14 }}>Details</div>
              <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 0, marginRight: -8, paddingRight: 8 }}>
                {(() => {
                  const meta = b.media?.metadata;
                  // For a podcast, progress is keyed on (item, episode); for a
                  // book, on the item alone.
                  const prog = st.mediaProgress.find(p =>
                    p.libraryItemId === st.currentBookId &&
                    (isPodcast ? p.episodeId === st.currentEpisodeId : true));
                  const dash = '—';
                  const detailRow = (label: string, value: React.ReactNode) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '7px 0', borderBottom: '1px solid var(--onyx-line)', gap: 12 }}>
                      <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--onyx-text-mute)', flexShrink: 0, paddingTop: 1 }}>{label}</div>
                      <div style={{ fontSize: 12.5, color: 'var(--onyx-text-dim)', textAlign: 'right', minWidth: 0 }}>{value ?? dash}</div>
                    </div>
                  );
                  const tags = b.media?.tags ?? [];
                  const genres = meta?.genres?.filter(Boolean) ?? [];

                  const sectionHead = (label: string, mt = 0) => (
                    <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--onyx-text-mute)', marginTop: mt, marginBottom: 4, paddingBottom: 4 }}>{label}</div>
                  );
                  const listeningRows = prog ? (
                    <>
                      {detailRow('Progress',
                        <span style={{ color: prog.isFinished ? 'var(--onyx-accent)' : 'var(--onyx-text-dim)' }}>
                          {Math.round(prog.progress * 100)}%{prog.isFinished && ' ✓'}
                        </span>
                      )}
                      {detailRow('Listened',   fmtTime(prog.currentTime))}
                      {detailRow('Remaining',  fmtRemaining(Math.max(0, prog.duration - prog.currentTime)))}
                      {detailRow('Last played', new Date(prog.lastUpdate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }))}
                    </>
                  ) : (
                    <div style={{ padding: '12px 0', fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em' }}>Not started</div>
                  );

                  // ── Podcast / episode details ──────────────────────────────
                  if (isPodcast) {
                    const pMeta = asPodcastItem(b).media.metadata;
                    const pGenres = (pMeta?.genres ?? []).filter(Boolean);
                    const epDur = ep?.duration ?? st.bookSecs ?? 0;
                    const pub = ep?.publishedAt ? new Date(ep.publishedAt) : ep?.pubDate ? new Date(ep.pubDate) : null;
                    const epNum = [ep?.season ? `S${ep.season}` : '', ep?.episode ? `E${ep.episode}` : ''].filter(Boolean).join(' ');
                    return (
                      <>
                        {sectionHead('Podcast')}
                        {detailRow('Author',   pMeta?.author   || dash)}
                        {detailRow('Genre',    pGenres.join(', ') || dash)}
                        {detailRow('Language', pMeta?.language || dash)}
                        {pMeta?.explicit !== undefined && detailRow('Explicit', pMeta.explicit ? 'Yes' : 'No')}

                        {sectionHead('Episode', 16)}
                        {ep?.title && detailRow('Title', ep.title)}
                        {pub && !isNaN(pub.getTime()) && detailRow('Published', pub.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }))}
                        {epNum && detailRow('Number', epNum)}
                        {detailRow('Duration', epDur > 0 ? fmtRemaining(epDur) : dash)}

                        {sectionHead('Listening', 16)}
                        {listeningRows}
                      </>
                    );
                  }

                  return (
                    <>
                      {/* Book details */}
                      <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--onyx-text-mute)', marginBottom: 4, paddingBottom: 4 }}>Book</div>
                      {detailRow('Publisher',  meta?.publisher    || dash)}
                      {detailRow('Genre',      genres.join(', ')  || dash)}
                      {detailRow('Year',       meta?.publishedYear || dash)}
                      {detailRow('Language',   meta?.language      || dash)}
                      {detailRow('Duration',   bookDur(b))}
                      {tags.length > 0 && detailRow('Tags',
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'flex-end' }}>
                          {tags.map(t => (
                            <span key={t} style={{ padding: '1px 7px', borderRadius: 999, background: 'var(--onyx-glass)', border: '1px solid var(--onyx-glass-edge)', fontFamily: MONO, fontSize: 9, color: 'var(--onyx-text-dim)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{t}</span>
                          ))}
                        </div>
                      )}

                      {/* Listening stats */}
                      <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--onyx-text-mute)', marginTop: 16, marginBottom: 4, paddingBottom: 4 }}>Listening</div>
                      {prog ? (
                        <>
                          {detailRow('Progress',
                            <span style={{ color: prog.isFinished ? 'var(--onyx-accent)' : 'var(--onyx-text-dim)' }}>
                              {Math.round(prog.progress * 100)}%{prog.isFinished && ' ✓'}
                            </span>
                          )}
                          {detailRow('Listened',   fmtTime(prog.currentTime))}
                          {detailRow('Remaining',  fmtRemaining(Math.max(0, prog.duration - prog.currentTime)))}
                          {detailRow('Last played', new Date(prog.lastUpdate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }))}
                        </>
                      ) : (
                        <div style={{ padding: '12px 0', fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em' }}>Not started</div>
                      )}

                      {/* Open Library */}
                      {olWorkKey !== undefined && (
                        <>
                          <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--onyx-text-mute)', marginTop: 16, marginBottom: 4, paddingBottom: 4 }}>Open Library</div>
                          {olWorkKey === null ? (
                            <div style={{ padding: '8px 0', fontSize: 12, color: 'var(--onyx-text-mute)', fontStyle: 'italic' }}>No data found</div>
                          ) : (
                            <>
                              <div style={{ padding: '8px 0', borderBottom: '1px solid var(--onyx-line)', fontSize: 12.5, color: 'var(--onyx-text-dim)' }}>
                                {olRatings?.average != null
                                  ? `${olRatings.average.toFixed(1)} / 5`
                                  : '—'}
                                {olRatings?.count != null
                                  ? <span style={{ color: 'var(--onyx-text-mute)', fontFamily: MONO, fontSize: 10 }}>{' '}· {olRatings.count.toLocaleString()} ratings</span>
                                  : null}
                              </div>
                              {olShelves && (
                                <div style={{ padding: '8px 0', borderBottom: '1px solid var(--onyx-line)', fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.04em', lineHeight: 1.8 }}>
                                  <div>Want to read: <span style={{ color: 'var(--onyx-text-dim)' }}>{olShelves.wantToRead?.toLocaleString() ?? '—'}</span></div>
                                  <div>Reading: <span style={{ color: 'var(--onyx-text-dim)' }}>{olShelves.reading?.toLocaleString() ?? '—'}</span></div>
                                  <div>Read: <span style={{ color: 'var(--onyx-text-dim)' }}>{olShelves.alreadyRead?.toLocaleString() ?? '—'}</span></div>
                                </div>
                              )}
                              <a
                                href={`https://openlibrary.org/works/${olWorkKey}`}
                                target="_blank"
                                rel="noreferrer"
                                style={{ display: 'inline-block', marginTop: 10, fontFamily: MONO, fontSize: 10, color: 'var(--onyx-accent)', letterSpacing: '0.06em', textTransform: 'uppercase', textDecoration: 'none' }}
                              >
                                View on Open Library ↗
                              </a>
                            </>
                          )}
                        </>
                      )}

                    </>
                  );
                })()}
              </div>
            </Glass>

            {/* ── Chapters panel — hidden in compact mode unless selected ── */}
            <Glass translucent={st.translucent} style={{ flex: 1, minWidth: 0, padding: 20, display: !panesStacked || activePane === 'chapters' ? 'flex' : 'none', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
                <div style={{ fontFamily: SERIF, fontSize: 16, fontWeight: 500 }}>Chapters</div>
                {/* Use bookSecs (not bookDur(b)) so chapterless podcast episodes
                    show the episode duration instead of NaNm. */}
                <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.08em' }}>{displayChapters.length} · {fmtRemaining(st.bookSecs)} total</div>
              </div>
              {/* Podcast episodes carry no chapter markers in this model. */}
              {isPodcast && displayChapters.length === 0 && (
                <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em', marginBottom: 8 }}>
                  No chapters for this episode
                </div>
              )}
              {/* Contextual hint above the list — message varies by lock reason */}
              {isFocusedDifferent && (
                <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em', marginBottom: 8 }}>
                  Press Play to enable chapter navigation
                </div>
              )}
              {/* Not yet started: same book but position is 0 and not playing */}
              {!isFocusedDifferent && !st.playing && st.position === 0 && (
                <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.06em', marginBottom: 8 }}>
                  Press play to begin
                </div>
              )}
              <div ref={chapterListRef} style={{ flex: 1, overflow: 'auto', marginRight: -8, paddingRight: 8 }}>
                {displayChapters.map((c, i) => {
                  // Use focusedChIdx for focused non-playing book, -1 (no highlight)
                  // when not yet started, or live chIdx during active playback.
                  const rowChIdx = isFocusedDifferent ? focusedChIdx
                    : chaptersLocked ? -1
                    : chIdx;
                  const state = i < rowChIdx ? 'done' : i === rowChIdx ? 'playing' : 'next';
                  return (
                    <button key={c.n} ref={i === activeChapterIdx ? activeChapterRef : null} onClick={async () => {
                      const pos = chapterStart(displayChapters, i);
                      if (!st.focusedBookId || st.focusedBookId === st.currentBookId) {
                        // Seek to the selected chapter's start position
                        await seekAudio(pos).catch(logErr);
                        st.setPosition(pos);

                        // If the book was paused, start playback from the selected chapter.
                        // playAudio() tells LibVLC to begin streaming; setPlaying(true) updates
                        // the UI optimistically before the playback-tick event confirms it.
                        if (!st.playing) {
                          await playAudio().catch(logErr);
                          st.setPlaying(true);
                        }
                      } else {
                        // Different book — start playback at the selected chapter
                        // position via the canonical function (pos is the override).
                        await playBook(st, st.focusedBookId!, pos);
                      }
                    }} style={{
                      display: 'flex', alignItems: 'center', padding: '8px 12px', borderRadius: 8, gap: 12,
                      background: state === 'playing' ? 'var(--onyx-accent-dim)' : 'transparent',
                      border: `1px solid ${state === 'playing' ? 'var(--onyx-accent-edge)' : 'transparent'}`,
                      marginBottom: 2, width: '100%', fontFamily: 'inherit', textAlign: 'left',
                      // Dim and block interaction when chapters are locked (different book
                      // or playback not yet started) — navigation only works when playing.
                      cursor: chaptersLocked ? 'default' : 'pointer',
                      opacity: chaptersLocked ? 0.45 : 1,
                      pointerEvents: chaptersLocked ? 'none' : 'auto',
                    }}>
                      <div style={{ fontFamily: MONO, fontSize: 11, color: state === 'playing' ? 'var(--onyx-accent)' : 'var(--onyx-text-mute)', width: 22 }}>{String(c.n).padStart(2, '0')}</div>
                      <div style={{ flex: 1, fontSize: 13, fontWeight: state === 'playing' ? 600 : 400, color: state === 'done' ? 'var(--onyx-text-mute)' : 'var(--onyx-text)' }}>{c.t}</div>
                      <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)' }}>{fmtTime(c.dur)}</div>
                      {state === 'done' && <span style={{ display: 'inline-flex', color: 'var(--onyx-text-mute)' }}><Icon name="check" size={11} /></span>}
                      {state === 'playing' && <div style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--onyx-accent)', boxShadow: '0 0 12px var(--onyx-accent)' }} />}
                      {state === 'next' && <div style={{ width: 6, height: 6 }} />}
                    </button>
                  );
                })}
              </div>
            </Glass>

            {/* ── Bookmarks panel — hidden in compact mode unless selected ── */}
            <Glass translucent={st.translucent} style={{ flex: 1, minWidth: 0, padding: 20, display: !panesStacked || activePane === 'bookmarks' ? 'flex' : 'none', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>

              {/* ── Panel header: title + tab switcher + add button ── */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div style={{ fontFamily: SERIF, fontSize: 16, fontWeight: 500 }}>Bookmarks</div>

                {/* Tab switcher — pill toggles between server bookmarks and local stop points */}
                <div style={{ display: 'flex', borderRadius: 999, border: '1px solid var(--onyx-line)', overflow: 'hidden', marginLeft: 4 }}>
                  {(['bookmarks', 'local'] as const).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setBookmarkTab(tab)}
                      style={{
                        background: bookmarkTab === tab ? 'var(--onyx-accent-dim)' : 'transparent',
                        border: 'none',
                        color: bookmarkTab === tab ? 'var(--onyx-accent)' : 'var(--onyx-text-mute)',
                        fontFamily: MONO,
                        fontSize: 9,
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase' as const,
                        padding: '3px 10px',
                        cursor: 'pointer',
                      }}
                    >
                      {tab === 'bookmarks' ? 'Saved' : 'Local'}
                    </button>
                  ))}
                </div>

                {/* Count badge — shows relevant count for the active tab */}
                <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.08em' }}>
                  {bookmarkTab === 'bookmarks' ? playerBookmarks.length : stopPoints.length}
                </div>

                {/* Add-bookmark button — only shown on the Saved tab */}
                {bookmarkTab === 'bookmarks' && (
                  <button onClick={addBookmark} style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 10, color: 'var(--onyx-accent)', letterSpacing: '0.06em', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }} title="Bookmark current moment">
                    <Icon name="plus" size={11} /> ADD HERE
                  </button>
                )}
              </div>

              {/* ── Tab content ── */}
              <div style={{ flex: 1, overflow: 'auto', marginRight: -8, paddingRight: 8 }}>

                {bookmarkTab === 'bookmarks' ? (
                  // ── Saved bookmarks (server) — timeline rail; label = bookmark
                  //    title, meta = chapter. Gold dot when labelled, muted if not. ──
                  playerBookmarks.length === 0 ? (
                    <div style={{ padding: '24px 0', textAlign: 'center', fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.08em' }}>
                      No bookmarks yet
                    </div>
                  ) : playerBookmarks.map((bm, i) => {
                    const ch = chapterAtPos(bm.time, displayChapters);
                    const meta = ch ? `Ch. ${ch.n}${ch.t ? ` · ${ch.t}` : ''}` : undefined;
                    return railRow({
                      keyId: `${bm.time}-${i}`,
                      time: fmtTime(bm.time),
                      label: bm.title || 'Untitled',
                      italic: true,
                      meta,
                      accent: !!bm.title,
                      isLast: i === playerBookmarks.length - 1,
                      onClick: () => seekAudio(bm.time).catch(logErr),
                    });
                  })
                ) : (
                  // ── Local Play — stop points; label = the chapter the stamp was
                  //    at, meta = when it was recorded. ──
                  stopPoints.length === 0 ? (
                    <div style={{ padding: '24px 0', textAlign: 'center', fontFamily: MONO, fontSize: 10, color: 'var(--onyx-text-mute)', letterSpacing: '0.08em' }}>
                      No local history yet
                    </div>
                  ) : stopPoints.map((point, i) => {
                    const ch = chapterAtPos(point.position, chapters);
                    const label = ch ? (ch.t || `Chapter ${ch.n}`) : 'Unknown chapter';
                    return railRow({
                      keyId: `${point.recordedAt}-${i}`,
                      time: fmtTime(point.position),
                      label,
                      italic: false,
                      meta: fmtStamp(point.recordedAt),
                      accent: !!ch,
                      isLast: i === stopPoints.length - 1,
                      onClick: () => {
                        seekAudio(point.position).catch(logErr);
                        st.setPosition(point.position);
                      },
                    });
                  })
                )}
              </div>
            </Glass>

            {/* ── Synopsis panel — compact-only tab; on large windows the synopsis
                renders inline in the left column instead, so this stays hidden. ── */}
            <Glass translucent={st.translucent} style={{ flex: 1, minWidth: 0, padding: 20, display: panesStacked && activePane === 'synopsis' ? 'flex' : 'none', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
              <div style={{ fontFamily: SERIF, fontSize: 16, fontWeight: 500, marginBottom: 12 }}>{detailLabel}</div>
              <div style={{ flex: 1, overflowY: 'auto', marginRight: -8, paddingRight: 8 }}>
                {descriptionHtml ? (
                  <div
                    className="onyx-selectable"
                    style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--onyx-text-dim)' }}
                    dangerouslySetInnerHTML={{ __html: descriptionHtml }}
                  />
                ) : (
                  <div style={{ fontSize: 13, color: 'var(--onyx-text-mute)', fontStyle: 'italic' }}>{noDescText}</div>
                )}
              </div>
            </Glass>

          </div>
        </div>
      </div>
    </div>
  );
}
