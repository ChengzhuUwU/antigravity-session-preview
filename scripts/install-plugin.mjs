import { existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyPluginPayload, defaultInstallRoot, installCliShim } from '../server/plugin-update.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const TARGET = defaultInstallRoot();
const LEGACY_TARGET = join(homedir(), '.gemini', 'config', 'plugins', 'agy-markdown-preview');
const USER_BIN = join(homedir(), '.local', 'bin');

if (process.argv.includes('--uninstall')) {
  for (const dir of [TARGET, LEGACY_TARGET]) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
      console.log(`[install-plugin] Removed ${dir}`);
    }
  }
  for (const shim of ['agy-preview.cmd', 'agy-preview']) {
    const p = join(USER_BIN, shim);
    if (existsSync(p)) rmSync(p, { force: true });
  }
  process.exit(0);
}

if (!existsSync(join(ROOT, 'public', 'vendor', 'marked.min.js'))) {
  console.error('[install-plugin] public/vendor/ missing. Run `npm run sync-vendor` first.');
  process.exit(1);
}

copyPluginPayload(ROOT, TARGET);
installCliShim(TARGET, USER_BIN);

if (existsSync(LEGACY_TARGET)) {
  try {
    rmSync(LEGACY_TARGET, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 });
    console.log(`[install-plugin] Removed legacy plugin directory ${LEGACY_TARGET}`);
  } catch (err) {
    console.warn(`[install-plugin] Could not fully remove legacy directory (${err.code || err.message}); close active sidecars and re-run if needed.`);
  }
}

console.log(`[install-plugin] Installed agy-session-preview to ${TARGET}`);
console.log(`[install-plugin] Installed CLI command 'agy-preview' to ${USER_BIN}`);
