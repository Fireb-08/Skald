import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// AppImage's dependency scan copies libvlc/libvlccore but not VLC's dynamically
// loaded modules. Stage the matching host plugin tree as a Tauri resource so the
// packaged core never falls through to an absent or version-mismatched host VLC.
const candidates = [
  '/usr/lib/vlc/plugins',
  '/usr/lib/x86_64-linux-gnu/vlc/plugins',
  '/usr/lib64/vlc/plugins',
];
const source = candidates.find(existsSync);
if (!source) {
  throw new Error(
    `VLC plugin directory not found; checked: ${candidates.join(', ')}. Install the VLC development/runtime package before building.`,
  );
}

const destination = resolve('src-tauri/linux-runtime/plugins');
rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
cpSync(source, destination, { recursive: true, dereference: true });
writeFileSync(join(destination, 'placeholder.txt'), 'Replaced by matching VLC modules during Linux release builds.\n');

const modules = readdirSync(destination, { recursive: true })
  .filter((entry) => String(entry).endsWith('.so')).length;
if (modules === 0) {
  throw new Error(`No VLC plugin modules were staged from ${source}`);
}

process.stdout.write(`Staged ${modules} VLC plugin modules from ${source} to ${join('src-tauri', 'linux-runtime', 'plugins')}\n`);
