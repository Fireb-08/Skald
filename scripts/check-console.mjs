// check-console.mjs — regression gate for the structured-logging sweep
// (Structured Logging Sweep roadmap, Phase 2): frontend source must not call
// console.* directly. Diagnostics go through log.{debug,info,warn,error}
// (src/lib/log.ts) so they are categorised, redacted, and land in skald.log +
// the Settings → Logs → Skald viewer. Plain console.log remains fine as
// throwaway scaffolding during development — this gate is what enforces
// stripping it before commit.
//
// Excluded: test files, src/test/ helpers, and log.ts itself (its emit path
// legitimately mirrors to the console via the plugin's attachConsole).
// A new legitimate exclusion goes in EXCLUDE below with a comment — do not
// weaken the match pattern instead.
//
// Runs via `pnpm verify:console`; exits 1 on any offender.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const frontDir = join(root, 'src');

// Repo-relative paths (posix separators) exempt from the gate.
const EXCLUDE = [
  'src/lib/log.ts', // the logging framework itself
];

function walk(dir, exts, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, exts, out);
    else if (exts.some(e => entry.name.endsWith(e))) out.push(p);
  }
  return out;
}

// Matches both call sites (console.error(...)) and bare references passed as
// callbacks (.catch(console.error)) — the sweep removed both forms.
const CONSOLE_RE = /\bconsole\.(log|warn|error|info|debug|trace)\b/;

const offenders = [];
for (const file of walk(frontDir, ['.ts', '.tsx'])) {
  const rel = relative(root, file).split(sep).join('/');
  if (rel.startsWith('src/test/') || rel.endsWith('.test.ts') || rel.endsWith('.test.tsx')) continue;
  if (EXCLUDE.includes(rel)) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    // Skip line comments — prose may mention "the console".
    const code = line.replace(/\/\/.*$/, '');
    if (CONSOLE_RE.test(code)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
  });
}

if (offenders.length) {
  console.error(`ERROR — direct console.* in frontend source (${offenders.length}); use log.* from src/lib/log.ts:`);
  for (const o of offenders) console.error(`  ${o}`);
}
console.log(`check-console: ${offenders.length} offender(s) — ${offenders.length ? 'FAILED' : 'OK'}`);
process.exit(offenders.length ? 1 : 0);
