// Library form model — the FormState shape and its Library/LibrarySettings
// conversions, plus small pure helpers shared across the libraries pane.
// Moved verbatim out of LibrariesSection.tsx (God-File Decomposition roadmap, L3/L7).
import type { Library, LibrarySettings } from '../../../api/abs';

export function relativeTime(ms: number | null): string {
  if (ms === null) return 'Never';
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const ICON_EMOJI: Record<string, string> = {
  database: '🗄️', book: '📖', audiobook: '📚', podcast: '🎙️',
  music: '🎵', comic: '💬', manga: '🀄', paper: '📄',
  magazine: '📰', pirate: '☠️', 'crystal-ball': '🔮', alien: '👽',
  astronaut: '🧑‍🚀', cat: '🐱', dog: '🐶', heart: '❤️', star: '⭐', moon: '🌙',
};
export function iconEmoji(slug: string | null | undefined): string {
  return (slug && ICON_EMOJI[slug]) ?? '📚';
}

// ── Form types ────────────────────────────────────────────────────────────────

export interface FormState {
  name: string;
  mediaType: 'book' | 'podcast';
  icon: string;
  provider: string;
  folders: string[];
  watcherEnabled: boolean;
  audiobooksOnly: boolean;
  hideSingleBookSeries: boolean;
  autoScanCron: string;
  markFinishedPercent: string;
  markFinishedRemaining: string;
}

export const DEFAULT_FORM: FormState = {
  name: '',
  mediaType: 'book',
  icon: 'database',
  provider: 'google',
  folders: [''],
  watcherEnabled: true,
  audiobooksOnly: false,
  hideSingleBookSeries: false,
  autoScanCron: '',
  markFinishedPercent: '100',
  markFinishedRemaining: '10',
};

export function libraryToForm(lib: Library): FormState {
  const s = lib.settings;
  return {
    name: lib.name,
    mediaType: lib.mediaType === 'podcast' ? 'podcast' : 'book',
    icon: lib.icon ?? 'database',
    provider: lib.provider ?? (lib.mediaType === 'podcast' ? 'itunes' : 'google'),
    folders: lib.folders.length ? lib.folders.map(f => f.fullPath) : [''],
    watcherEnabled: s?.disableWatcher !== true,
    audiobooksOnly: s?.audiobooksOnly ?? false,
    hideSingleBookSeries: s?.hideSingleBookSeries ?? false,
    autoScanCron: s?.autoScanCronExpression ?? '',
    markFinishedPercent: String(s?.markAsFinishedPercentComplete ?? 100),
    markFinishedRemaining: String(s?.markAsFinishedTimeRemaining ?? 10),
  };
}

export function formToSettings(form: FormState): LibrarySettings {
  return {
    coverAspectRatio: null,
    disableWatcher: !form.watcherEnabled,
    autoScanCronExpression: form.autoScanCron.trim() || null,
    audiobooksOnly: form.audiobooksOnly,
    hideSingleBookSeries: form.hideSingleBookSeries,
    onlyShowLaterBooksInContinueSeries: null,
    skipMatchingMediaWithAsin: null,
    skipMatchingMediaWithIsbn: null,
    metadataPrecedence: null,
    markAsFinishedPercentComplete: parseFloat(form.markFinishedPercent) || null,
    markAsFinishedTimeRemaining: parseFloat(form.markFinishedRemaining) || null,
    podcastSearchRegion: null,
    epubsAllowScriptedContent: null,
  };
}
