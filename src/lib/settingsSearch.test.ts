import { describe, expect, it } from 'vitest';
import { matchesSettingsSearch } from './settingsSearch';

describe('settings search aliases', () => {
  it.each([
    ['Appearance', 'appearance', ['theme', 'accent', 'scale'], 'theme'],
    ['Playback', 'playback', ['sleep timer', 'skip', 'speed'], 'sleep timer'],
    ['Server', 'server', ['sync', 'socket'], 'sync socket'],
    ['Downloads', 'downloads', ['offline', 'folder'], 'download folder'],
  ])('finds task language for %s', (label, id, aliases, query) => {
    expect(matchesSettingsSearch(label, id, aliases, query)).toBe(true);
  });

  it('requires every query term to match', () => {
    expect(matchesSettingsSearch('Downloads', 'downloads', ['offline', 'folder'], 'download theme')).toBe(false);
  });
});
