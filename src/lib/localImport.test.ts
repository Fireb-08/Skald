import { describe, expect, it } from 'vitest';
import type { IngestOutcome, ScannedItem } from '../api/abs';
import { newQuarantineItems, summarizeImport } from './localImport';

const outcome = (targetPath: string, kind = 'quarantined'): IngestOutcome => ({
  title: 'Book', outcome: kind, targetPath, message: '',
});

describe('local import helpers', () => {
  it('selects only quarantine items created by the current run', () => {
    const current = { sourcePath: 'C:/Books/_Unidentified/New Book' } as ScannedItem;
    const older = { sourcePath: 'C:\\Books\\_Unidentified\\Older Book' } as ScannedItem;
    expect(newQuarantineItems([outcome('C:\\Books\\_Unidentified\\New Book\\')], [older, current])).toEqual([current]);
  });

  it('counts matched quarantines as added without losing failures', () => {
    const outcomes = [outcome('a', 'filed'), outcome('b'), outcome('c'), outcome('', 'error')];
    expect(summarizeImport(outcomes, 1)).toEqual({ added: 2, needsAttention: 1, failed: 1 });
  });
});
