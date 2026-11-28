import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export const RELEASE_REPO = 'ChengzhuUwU/antigravity-session-preview';
export const PLUGIN_INCLUDE_FILES = ['plugin.json', 'hooks.json', 'README.md', 'LICENSE'];
export const PLUGIN_INCLUDE_DIRS = ['assets', 'bin', 'public', 'server', 'sidecars', 'skills'];

export function defaultInstallRoot() {
  return join(homedir(), '.gemini', 'config', 'plugins', 'agy-session-preview');
}

export function readPluginVersion(root) {
  try {
    const raw = JSON.parse(readFileSync(join(root, 'plugin.json'), 'utf-8'));
    return String(raw.version || '').trim();
  } catch {
    return '';
  }
}

export function parseVersion(value) {
  const match = String(value || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** 1 when a is newer, -1 when b is newer, 0 when equal. */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

export function decideUpdate(localVersion, remoteVersion) {
  if (!parseVersion(remoteVersion)) return 'unknown';
  if (!parseVersion(localVersion)) return 'upgrade';
  const order = compareVersions(localVersion, remoteVersion);
  if (order < 0) return 'upgrade';
  if (order > 0) return 'ahead';
  return 'current';
}

export function latestReleaseApiUrl(repo = RELEASE_REPO) {
  return `https://api.github.com/repos/${repo}/releases/latest`;
}

export function tagArchiveUrl(tag, repo = RELEASE_REPO) {
  const safeTag = String(tag || '').trim();
  return `https://github.com/${repo}/archive/refs/tags/${encodeURIComponent(safeTag)}.tar.gz`;
}

export function copyPluginPayload(sourceRoot, targetRoot) {
  mkdirSync(targetRoot, { recursive: true });
  for (const file of PLUGIN_INCLUDE_FILES) {
    const src = join(sourceRoot, file);
    if (existsSync(src)) cpSync(src, join(targetRoot, file), { force: true });
  }
  for (const dir of PLUGIN_INCLUDE_DIRS) {
    const src = join(sourceRoot, dir);
    if (!existsSync(src)) continue;
    const dst = join(targetRoot, dir);
    rmSync(dst, { recursive: true, force: true });
    cpSync(src, dst, { recursive: true });
  }
  const hook = join(sourceRoot, 'scripts', 'hook-sync.mjs');
  if (existsSync(hook)) {
    mkdirSync(join(targetRoot, 'scripts'), { recursive: true });
    cpSync(hook, join(targetRoot, 'scripts', 'hook-sync.mjs'), { force: true });
  }
}

export function installCliShim(installRoot, binDir = join(homedir(), '.local', 'bin')) {
  mkdirSync(binDir, { recursive: true });
  const installedEntry = join(installRoot, 'bin', 'agy-preview.mjs');
  if (process.platform === 'win32') {
    writeFileSync(join(binDir, 'agy-preview.cmd'), `@echo off\r\nnode "${installedEntry}" %*\r\n`, 'utf-8');
  }
  const shPath = join(binDir, 'agy-preview');
  writeFileSync(shPath, `#!/usr/bin/env sh\nexec node "${installedEntry.replace(/\\/g, '/')}" "$@"\n`, 'utf-8');
  try { chmodSync(shPath, 0o755); } catch {}
  return binDir;
}

function findPluginRoot(dir) {
  if (existsSync(join(dir, 'plugin.json'))) return dir;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = join(dir, entry.name);
    if (existsSync(join(child, 'plugin.json'))) return child;
  }
  throw new Error('Downloaded release does not contain plugin.json');
}

function extractTarGz(archivePath, destDir) {
  mkdirSync(destDir, { recursive: true });
  const result = spawnSync('tar', ['-xzf', archivePath, '-C', destDir], { encoding: 'utf-8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'Could not unpack the release archive (tar is required)');
  }
}

async function readRelease(fetchImpl, repo) {
  const response = await fetchImpl(latestReleaseApiUrl(repo), {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'agy-session-preview',
    },
  });
  if (!response?.ok) {
    throw new Error(`Could not read the latest release (HTTP ${response?.status || 'network'})`);
  }
  const body = await response.json();
  const tag = String(body.tag_name || '').trim();
  const version = tag.replace(/^v/i, '');
  if (!parseVersion(version)) throw new Error(`Latest release tag is not a version: ${tag || '(missing)'}`);
  return { tag, version };
}

/**
 * Replace the installed plugin with the latest GitHub release.
 * User data under the OS data directory is not touched.
 */
export async function runPluginUpdate({
  installRoot = defaultInstallRoot(),
  binDir,
  repo = RELEASE_REPO,
  fetchImpl = globalThis.fetch,
  onProgress,
  beforeReplace,
  afterReplace,
} = {}) {
  const localVersion = readPluginVersion(installRoot);
  const remote = await readRelease(fetchImpl, repo);
  const action = decideUpdate(localVersion, remote.version);
  if (action !== 'upgrade') {
    return { action, localVersion, remoteVersion: remote.version, tag: remote.tag, installRoot };
  }
  onProgress?.(`Downloading ${remote.tag}…`);

  const archiveResponse = await fetchImpl(tagArchiveUrl(remote.tag, repo), {
    headers: { 'User-Agent': 'agy-session-preview' },
  });
  if (!archiveResponse?.ok) {
    throw new Error(`Could not download ${remote.tag} (HTTP ${archiveResponse?.status || 'network'})`);
  }
  const bytes = Buffer.from(await archiveResponse.arrayBuffer());
  const work = join(tmpdir(), `agy-preview-update-${process.pid}-${Date.now()}`);
  const archivePath = join(work, 'release.tar.gz');
  const extracted = join(work, 'src');
  mkdirSync(work, { recursive: true });
  try {
    writeFileSync(archivePath, bytes);
    extractTarGz(archivePath, extracted);
    const sourceRoot = findPluginRoot(extracted);
    const packedVersion = readPluginVersion(sourceRoot);
    if (compareVersions(packedVersion, remote.version) !== 0) {
      throw new Error(`Release ${remote.tag} unpacked as ${packedVersion || 'an unknown version'}`);
    }
    await beforeReplace?.();
    const staging = `${installRoot}.update-${process.pid}`;
    const backup = `${installRoot}.bak-${process.pid}`;
    rmSync(staging, { recursive: true, force: true });
    copyPluginPayload(sourceRoot, staging);
    try {
      if (existsSync(installRoot)) renameSync(installRoot, backup);
      renameSync(staging, installRoot);
      rmSync(backup, { recursive: true, force: true });
    } catch {
      if (!existsSync(installRoot) && existsSync(backup)) {
        try { renameSync(backup, installRoot); } catch {}
      }
      copyPluginPayload(sourceRoot, installRoot);
      rmSync(staging, { recursive: true, force: true });
    }
    installCliShim(installRoot, binDir);
    await afterReplace?.();
    return { action: 'upgrade', localVersion, remoteVersion: remote.version, tag: remote.tag, installRoot };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
