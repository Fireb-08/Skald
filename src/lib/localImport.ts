import type { IngestOutcome, ScannedItem } from '../api/abs';

function normalizedPath(path: string): string {
  return path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

/** Match only quarantine items created by the current ingest run. */
export function newQuarantineItems(outcomes: IngestOutcome[], items: ScannedItem[]): ScannedItem[] {
  const targets = new Set(
    outcomes
      .filter(outcome => outcome.outcome === 'quarantined' && outcome.targetPath)
      .map(outcome => normalizedPath(outcome.targetPath)),
  );
  return items.filter(item => targets.has(normalizedPath(item.sourcePath)));
}

export interface ImportSummary {
  added: number;
  needsAttention: number;
  failed: number;
}

/** Convert low-level ingest outcomes into the shared user-facing result counts. */
export function summarizeImport(outcomes: IngestOutcome[], matched: number): ImportSummary {
  const filed = outcomes.filter(outcome => outcome.outcome === 'filed').length;
  const quarantined = outcomes.filter(outcome => outcome.outcome === 'quarantined').length;
  return {
    added: filed + matched,
    needsAttention: Math.max(0, quarantined - matched),
    failed: outcomes.filter(outcome => outcome.outcome === 'error').length,
  };
}
