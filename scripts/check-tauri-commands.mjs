// check-tauri-commands.mjs — mechanical consistency check between the three
// places a Tauri command must agree (Testing Suite plan, Phase 1):
//   1. `#[tauri::command]` functions in src-tauri/src/*.rs
//   2. the generate_handler![...] registration list in lib.rs
//   3. `invoke('name', ...)` call sites in the frontend
//
// Failures caught: a frontend invoke with no registered handler (runtime
// "command not found"), and a registered name with no annotated function
// (compile error normally, but this also catches typos in conditional cfg
// blocks). Annotated-but-unregistered commands are listed as warnings only.
//
// Runs via `pnpm verify:commands`; exits 1 on any error.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rustDir = join(root, 'src-tauri', 'src');
const frontDir = join(root, 'src');

function walk(dir, exts, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, exts, out);
    else if (exts.some(e => entry.name.endsWith(e))) out.push(p);
  }
  return out;
}

// 1. Annotated command functions.
const annotated = new Set();
for (const file of walk(rustDir, ['.rs'])) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/#\[tauri::command\]\s*(?:pub(?:\(crate\))?\s+)?(?:async\s+)?fn\s+(\w+)/g)) {
    annotated.add(m[1]);
  }
}

// 2. Registered handlers (names after the last `::` in the handler list).
const libSrc = readFileSync(join(rustDir, 'lib.rs'), 'utf8');
const handlerBlock = libSrc.match(/generate_handler!\[([\s\S]*?)\]/);
if (!handlerBlock) {
  console.error('check-tauri-commands: no generate_handler![...] block found in lib.rs');
  process.exit(1);
}
// Strip // comments first (the block is annotated), then take only
// module-qualified entries (`commands::foo`) — every registration is one.
const handlerList = handlerBlock[1].replace(/\/\/[^\n]*/g, '');
const registered = new Set(
  [...handlerList.matchAll(/([A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)+)/g)]
    .map(m => m[1].split('::').pop()),
);

// 3. Frontend invoke call sites (string-literal command names only).
const invoked = new Set();
for (const file of walk(frontDir, ['.ts', '.tsx'])) {
  if (file.includes(`${join('src', 'test')}`) || file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/invoke(?:<[^>]*>)?\(\s*['"`]([\w-]+)['"`]/g)) {
    invoked.add(m[1]);
  }
}

let failed = false;

const invokedUnregistered = [...invoked].filter(n => !registered.has(n));
if (invokedUnregistered.length) {
  failed = true;
  console.error(`ERROR — frontend invokes with no registered handler (${invokedUnregistered.length}):`);
  for (const n of invokedUnregistered.sort()) console.error(`  ${n}`);
}

const registeredUnannotated = [...registered].filter(n => !annotated.has(n));
if (registeredUnannotated.length) {
  failed = true;
  console.error(`ERROR — registered handlers with no #[tauri::command] fn (${registeredUnannotated.length}):`);
  for (const n of registeredUnannotated.sort()) console.error(`  ${n}`);
}

const annotatedUnregistered = [...annotated].filter(n => !registered.has(n));
if (annotatedUnregistered.length) {
  console.warn(`warning — #[tauri::command] fns never registered (${annotatedUnregistered.length}): ${annotatedUnregistered.sort().join(', ')}`);
}

console.log(
  `check-tauri-commands: ${annotated.size} annotated, ${registered.size} registered, ${invoked.size} invoked — ${failed ? 'FAILED' : 'OK'}`,
);
process.exit(failed ? 1 : 0);
