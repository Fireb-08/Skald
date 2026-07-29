import { describe, it, expect } from 'vitest';
import { offlinePodcastItems, offlinePodcastItem } from './offlinePodcasts';
import { bookGenre, bookDur, bookAuthor } from '../state/bookHelpers';
import type { DownloadRecord } from '../api/abs';

// Minimal media view for asserting the synthetic podcast items.
type PodMedia = { metadata: { title: string; author?: string | null }; episodes: Array<{ id?: string; guid?: string; title: string; publishedAt?: number }>; numEpisodes: number };
const media = (i: { media: unknown }) => i.media as PodMedia;

const ep = (itemId: string, episodeId: string, over: Partial<DownloadRecord> = {}): DownloadRecord => ({
  itemId, episodeId, title: `${episodeId} title`, author: 'The Podcast',
  filePath: `C:/dl/${itemId}/${episodeId}.mp3`, fileSize: 100, downloadedAt: 1_000, ...over,
});
const book = (itemId: string): DownloadRecord => ({
  itemId, title: 'A Book', author: 'Author',
  filePath: `C:/dl/${itemId}.m4b`, fileSize: 999, downloadedAt: 5,
});

describe('offlinePodcastItems', () => {
  it('builds one podcast item per podcast, excluding books, newest episode first', () => {
    const items = offlinePodcastItems([
      ep('pod-a', 'a1', { downloadedAt: 10 }),
      book('some-book'),                       // excluded (no episodeId)
      ep('pod-a', 'a2', { downloadedAt: 20 }),
      ep('pod-b', 'b1'),
    ]);

    expect(items.map(i => i.id).sort()).toEqual(['pod-a', 'pod-b']);
    const a = media(items.find(i => i.id === 'pod-a')!);
    expect(a.metadata.title).toBe('The Podcast');
    expect(a.numEpisodes).toBe(2);
    // Newest download first.
    expect(a.episodes.map(e => e.id)).toEqual(['a2', 'a1']);
    // guid mirrors the episode id so episodeKey() is stable with no enclosure/pubDate.
    expect(a.episodes[0].guid).toBe('a2');
    // With no captured publish date, the download time backfills the row date.
    expect(a.episodes[1].publishedAt).toBe(10);
  });

  it('orders by the captured episode publish date, not the download time', () => {
    // e-late was downloaded first but published later — it must sort ahead of
    // e-early, and each row shows its real publish date.
    const [item] = offlinePodcastItems([
      ep('pod', 'e-late', { downloadedAt: 10, publishedAt: 2000 }),
      ep('pod', 'e-early', { downloadedAt: 20, publishedAt: 1000 }),
    ]);
    const m = media(item);
    expect(m.episodes.map(e => e.id)).toEqual(['e-late', 'e-early']); // newest publish first
    expect(m.episodes[0].publishedAt).toBe(2000);
    expect(m.episodes[1].publishedAt).toBe(1000);
  });

  it('marks the synthetic items as podcasts so the shelf routes them to detail', () => {
    const [item] = offlinePodcastItems([ep('pod', 'e1')]);
    expect((item as { mediaType?: string }).mediaType).toBe('podcast');
  });

  // Regression: the shelf renders bookGenre()/bookDur() per tile, and an item
  // with no genres array crashed the whole shelf (black screen). The synthetic
  // items must carry safe defaults so those helpers never throw.
  it('render helpers do not throw on the synthetic items', () => {
    const [item] = offlinePodcastItems([ep('pod', 'e1')]);
    expect(() => bookGenre(item)).not.toThrow();
    expect(bookGenre(item)).toBe('');
    expect(() => bookDur(item)).not.toThrow();
  });

  it('surfaces the captured podcast author as the byline, never "Unknown Author"', () => {
    // Captured author → shown via bookAuthor (podcast-aware, reads metadata.author).
    const [withAuthor] = offlinePodcastItems([ep('pod', 'e1', { podcastAuthor: 'Jane Doe' })]);
    expect(media(withAuthor).metadata.author).toBe('Jane Doe');
    expect(bookAuthor(withAuthor)).toBe('Jane Doe');
    // No captured author (e.g. downloaded before the field existed) → empty byline,
    // NOT the book fallback "Unknown Author".
    const [noAuthor] = offlinePodcastItems([ep('pod2', 'e1')]);
    expect(bookAuthor(noAuthor)).toBe('');
  });
});

describe('offlinePodcastItem', () => {
  it('returns the single item for a podcast with downloads, null otherwise', () => {
    const downloads = [ep('pod', 'e1'), book('bk')];
    expect(offlinePodcastItem('pod', downloads)?.id).toBe('pod');
    expect(offlinePodcastItem('missing', downloads)).toBeNull();
    // A book id is not a podcast entry.
    expect(offlinePodcastItem('bk', downloads)).toBeNull();
  });
});
