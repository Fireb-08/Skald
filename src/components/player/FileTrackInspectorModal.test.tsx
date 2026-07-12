import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn(async () => null) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock('@tauri-apps/plugin-log', () => ({
  info: vi.fn(async () => {}), warn: vi.fn(async () => {}), error: vi.fn(async () => {}),
  debug: vi.fn(async () => {}), attachConsole: vi.fn(async () => () => {}),
}));

import { buildFileTree } from './FileTrackInspectorModal';
import type { LibraryFile } from '../../api/abs';

const file = (ino: string, relPath: string): LibraryFile => ({
  ino,
  fileType: 'audio',
  metadata: { filename: relPath.split(/[\\/]/).pop()!, relPath, size: 100 },
});

describe('buildFileTree', () => {
  it('preserves nested item-relative folders and sorts them naturally', () => {
    const tree = buildFileTree([
      file('3', 'Disc 10/03.mp3'),
      file('1', 'Disc 2/01.mp3'),
      file('2', 'Disc 2/02.mp3'),
    ]);
    expect(tree.map(node => node.name)).toEqual(['Disc 2', 'Disc 10']);
    expect(tree[0].files.map(entry => entry.metadata.filename)).toEqual(['01.mp3', '02.mp3']);
  });

  it('normalizes Windows separators and keeps root files visible', () => {
    const tree = buildFileTree([file('1', 'Part A\\01.m4b'), file('2', 'cover.jpg')]);
    expect(tree[0].path).toBe('Part A');
    expect(tree[0].files[0].metadata.filename).toBe('01.m4b');
    expect(tree[1].files[0].metadata.filename).toBe('cover.jpg');
  });
});
