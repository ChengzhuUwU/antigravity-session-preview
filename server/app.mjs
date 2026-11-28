import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { closeSync, createReadStream, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, watch, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TranscriptReader,
  detectFlavors,
  getConversationRunState,
  getGeminiRoot,
  getRollingUsageStats,
  listArtifacts,
  listBtwCommands,
  listConversations,
  resolveConversationDir,
  resolveTranscriptPath,
} from './transcript.mjs';
import { CustomPreviewStore } from './custom-preview.mjs';
import { PreviewAuthManager } from './auth.mjs';
import { convertOfficeFileToPdfCached, resolveCachedOfficePdfByName } from './office-convert.mjs';
import { resolveNativeFilePicker, runNativeFilePicker } from './file-picker.mjs';
import { SavedTurnStore } from './saved-turns.mjs';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const PUBLIC_DIR = resolve(HERE, '..', 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.ogv': 'video/ogg',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.opus': 'audio/opus',
  '.weba': 'audio/webm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif']);
const PDF_EXTS = new Set(['.pdf']);
const DOCX_EXTS = new Set(['.docx']);
const DOC_LEGACY_EXTS = new Set(['.doc']);
const XLSX_EXTS = new Set(['.xlsx', '.xls', '.ods']);
const PPTX_EXTS = new Set(['.pptx', '.ppt']);
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogv', '.mkv', '.avi']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.flac', '.ogg', '.oga', '.m4a', '.aac', '.opus', '.weba']);
const CSV_EXTS = new Set(['.csv', '.tsv']);
const MARKDOWN_EXTS = new Set(['.md', '.markdown', '.mdx']);
const TEXT_CODE_EXTS = new Set([
  '.py', '.pyi', '.ipynb', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.c', '.cc', '.cpp', '.cxx', '.h', '.hpp', '.cu', '.cuh',
  '.rs', '.go', '.java', '.kt', '.kts', '.scala', '.cs', '.swift', '.rb', '.php', '.lua',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  '.json', '.jsonl', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.properties',
  '.xml', '.html', '.htm', '.css', '.scss', '.less', '.vue', '.svelte',
  '.sql', '.graphql', '.proto', '.cmake', '.gradle', '.dockerfile', '.makefile',
  '.txt', '.log', '.tex', '.bib', '.rst', '.gitignore', '.editorconfig',
]);

const EXT_TO_LANG = {
  '.py': 'python', '.pyi': 'python',
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript',
  '.c': 'c', '.h': 'c', '.cc': 'cpp', '.cpp': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.cu': 'cpp',
  '.rs': 'rust', '.go': 'go', '.java': 'java', '.kt': 'kotlin', '.cs': 'csharp',
  '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash', '.ps1': 'powershell', '.bat': 'dos', '.cmd': 'dos',
  '.json': 'json', '.jsonl': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'ini', '.ini': 'ini',
  '.xml': 'xml', '.html': 'xml', '.css': 'css', '.scss': 'scss', '.sql': 'sql',
  '.cmake': 'cmake', '.tex': 'latex', '.md': 'markdown', '.csv': 'plaintext', '.tsv': 'plaintext',
};

const BLOCKED_PATH_SEGMENTS = [
  /[\\/]\.ssh(?:[\\/]|$)/i,
  /[\\/]\.gnupg(?:[\\/]|$)/i,
  /[\\/]\.aws(?:[\\/]|$)/i,
  /[\\/]windows[\\/]system32(?:[\\/]|$)/i,
  /^\/etc\/(?:shadow|passwd|sudoers)/i,
];

function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

function readJsonBody(req, maxBytes = 10 * 1024 * 1024) {
  return new Promise((resolveBody, rejectBody) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        rejectBody(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8').trim();
      if (!raw) return resolveBody({});
      try {
        resolveBody(JSON.parse(raw));
      } catch (err) {
        rejectBody(err);
      }
    });
    req.on('error', rejectBody);
  });
}

function normalizeIncomingFilePath(raw) {
  if (!raw || typeof raw !== 'string') return { filePart: '', hashPart: '' };
  let cleaned = raw.trim();
  let hashPart = '';
  const hashIdx = cleaned.indexOf('#');
  if (hashIdx !== -1) {
    hashPart = cleaned.slice(hashIdx + 1);
    cleaned = cleaned.slice(0, hashIdx);
  }
  const qIdx = cleaned.indexOf('?');
  if (qIdx !== -1) {
    cleaned = cleaned.slice(0, qIdx);
  }

  if (cleaned.startsWith('file://')) {
    try {
      const u = new URL(cleaned);
      let p = decodeURIComponent(u.pathname);
      if (process.platform === 'win32' && /^\/[a-zA-Z]:/.test(p)) {
        p = p.slice(1);
      }
      cleaned = p;
    } catch {
      cleaned = decodeURIComponent(cleaned.replace(/^file:\/\/\/?/, ''));
    }
  } else {
    try {
      cleaned = decodeURIComponent(cleaned);
    } catch {
      // Keep raw if percent sign is literal
    }
  }
  if (process.platform === 'win32' && /^\/[a-zA-Z]:/.test(cleaned)) {
    cleaned = cleaned.slice(1);
  }
  return { filePart: cleaned, hashPart };
}

const SKIP_SEARCH_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'target', 'out', '.venv', 'venv', '__pycache__', '.pytest_cache',
]);

function findBareFileUnderRoot(rootDir, bareName) {
  const lowerTarget = bareName.toLowerCase();
  const queue = [{ dir: rootDir, depth: 0 }];
  const deadline = Date.now() + 80;
  let visited = 0;

  while (queue.length > 0 && visited < 350 && Date.now() < deadline) {
    const { dir, depth } = queue.shift();
    visited++;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.isFile() && ent.name.toLowerCase() === lowerTarget) {
        return join(dir, ent.name);
      }
      if (ent.isDirectory() && depth < 4 && !SKIP_SEARCH_DIRS.has(ent.name) && !ent.name.startsWith('.')) {
        queue.push({ dir: join(dir, ent.name), depth: depth + 1 });
      }
    }
  }
  return '';
}

export function resolveSafeFilePath(rawPath, baseDir = '', { allowDirectory = false } = {}) {
  const { filePart, hashPart } = normalizeIncomingFilePath(rawPath);
  if (!filePart) return { error: 'Empty path', status: 400 };

  const candidates = [];
  let resolvedCleanBase = '';
  const winDriveAbsolute = /^[a-zA-Z]:[\\/]/.test(filePart);
  if (isAbsolute(filePart) || winDriveAbsolute) {
    candidates.push(resolve(filePart));
  } else if (baseDir && typeof baseDir === 'string') {
    const cleanBase = normalizeIncomingFilePath(baseDir).filePart;
    if (cleanBase) {
      resolvedCleanBase = resolve(cleanBase);
      candidates.push(resolve(resolvedCleanBase, filePart));

      let anc = resolvedCleanBase;
      for (let i = 0; i < 3; i++) {
        const parent = dirname(anc);
        if (!parent || parent === anc) break;
        anc = parent;
        if (existsSync(join(anc, '.git'))) {
          candidates.push(resolve(anc, filePart));
          break;
        }
      }
    }
  }

  if (candidates.length === 0) {
    return { error: `Cannot resolve relative path without base directory: ${filePart}`, status: 400 };
  }

  let chosen = candidates.find((c) => existsSync(c)) || '';

  if (!chosen && resolvedCleanBase && !/[\\/]/.test(filePart) && existsSync(resolvedCleanBase)) {
    chosen = findBareFileUnderRoot(resolvedCleanBase, filePart);
  }

  if (!chosen) {
    chosen = candidates[0];
  }

  for (const blockedRe of BLOCKED_PATH_SEGMENTS) {
    if (blockedRe.test(chosen)) {
      return { error: 'Access denied: restricted system or credential path', status: 403 };
    }
  }

  if (!existsSync(chosen)) {
    return { error: `File not found: ${chosen}`, status: 404, resolvedPath: chosen };
  }

  try {
    const st = statSync(chosen);
    if (st.isDirectory()) {
      if (allowDirectory) {
        return { resolvedPath: chosen, hashPart, isDirectory: true, status: 200 };
      }
      const readme = ['README.md', 'readme.md', 'index.md'].map((n) => join(chosen, n)).find((p) => existsSync(p));
      if (readme) {
        chosen = readme;
      } else {
        return { error: `Target is a directory: ${chosen}`, status: 400 };
      }
    }
  } catch (err) {
    return { error: err.message, status: 500 };
  }

  return { resolvedPath: chosen, hashPart, isDirectory: false, status: 200 };
}

export function classifyFile(filePath) {
  const ext = extname(filePath).toLowerCase();
  const base = basename(filePath).toLowerCase();
  if (MARKDOWN_EXTS.has(ext)) return { kind: 'markdown', ext, lang: 'markdown' };
  if (IMAGE_EXTS.has(ext)) return { kind: 'image', ext, lang: '' };
  if (PDF_EXTS.has(ext)) return { kind: 'pdf', ext, lang: '' };
  if (DOCX_EXTS.has(ext)) return { kind: 'docx', ext, lang: '' };
  if (DOC_LEGACY_EXTS.has(ext)) return { kind: 'doc', ext, lang: '' };
  if (XLSX_EXTS.has(ext)) return { kind: 'xlsx', ext, lang: '' };
  if (PPTX_EXTS.has(ext)) return { kind: 'pptx', ext, lang: '' };
  if (VIDEO_EXTS.has(ext)) return { kind: 'video', ext, lang: '' };
  if (AUDIO_EXTS.has(ext)) return { kind: 'audio', ext, lang: '' };
  if (CSV_EXTS.has(ext)) return { kind: 'csv', ext, lang: ext === '.tsv' ? 'tsv' : 'csv' };
  if (TEXT_CODE_EXTS.has(ext) || ['dockerfile', 'makefile', 'cmakelists.txt', 'license', 'readme'].includes(base)) {
    return { kind: 'code', ext, lang: EXT_TO_LANG[ext] || (base === 'cmakelists.txt' ? 'cmake' : 'plaintext') };
  }
  return { kind: 'unknown', ext, lang: EXT_TO_LANG[ext] || 'plaintext' };
}

export function spawnAppWindow(url) {
  const winCandidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  const macCandidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ];
  const candidates = process.platform === 'win32' ? winCandidates : (process.platform === 'darwin' ? macCandidates : []);
  const browser = candidates.find((p) => existsSync(p)) || '';

  if (browser) {
    const child = spawn(browser, [`--app=${url}`, '--new-window'], { detached: true, stdio: 'ignore' });
    child.unref();
    return { launchedWith: browser, mode: 'app-window' };
  }
  if (process.platform === 'win32') {
    const child = spawn('cmd', ['/c', 'start', '', url], { detached: true, windowsHide: true, stdio: 'ignore' });
    child.unref();
    return { launchedWith: 'default-browser', mode: 'browser' };
  }
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  const child = spawn(opener, [url], { detached: true, stdio: 'ignore' });
  child.unref();
  return { launchedWith: opener, mode: 'browser' };
}

function parseByteRangeHeader(rangeHeader, totalSize) {
  if (!rangeHeader || typeof rangeHeader !== 'string' || !rangeHeader.startsWith('bytes=')) {
    return null;
  }
  if (totalSize <= 0) return { invalid: true };
  const spec = rangeHeader.slice(6).split(',')[0].trim();
  const dashIdx = spec.indexOf('-');
  if (dashIdx === -1) return { invalid: true };

  const startStr = spec.slice(0, dashIdx).trim();
  const endStr = spec.slice(dashIdx + 1).trim();

  let start;
  let end;
  if (startStr === '') {
    const suffixLen = Number(endStr);
    if (!Number.isFinite(suffixLen) || suffixLen <= 0) return { invalid: true };
    start = Math.max(0, totalSize - suffixLen);
    end = totalSize - 1;
  } else {
    start = Number(startStr);
    end = endStr === '' ? totalSize - 1 : Number(endStr);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= totalSize) {
      return { invalid: true };
    }
    end = Math.min(totalSize - 1, end);
    if (end < start) return { invalid: true };
  }
  return { start, end };
}

function normalizeComparePath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function buildDirectoryListing(folderPath, highlightPath = '') {
  const normHighlight = normalizeComparePath(highlightPath);
  const rawEntries = readdirSync(folderPath, { withFileTypes: true }).slice(0, 350);
  const entries = [];
  for (const ent of rawEntries) {
    const fullPath = join(folderPath, ent.name);
    let isDir = ent.isDirectory();
    let size = 0;
    try {
      const st = statSync(fullPath);
      isDir = st.isDirectory();
      size = isDir ? 0 : st.size;
    } catch {}
    const kind = isDir ? 'directory' : classifyFile(fullPath).kind;
    entries.push({
      name: ent.name,
      path: fullPath,
      isDirectory: isDir,
      size,
      kind,
      isSelected: Boolean(normHighlight && normalizeComparePath(fullPath) === normHighlight),
    });
  }
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
  const parent = dirname(folderPath);
  return {
    folder: folderPath,
    parentFolder: parent && parent !== folderPath ? parent : '',
    entries,
  };
}

async function revealOnWindowsExplorer(targetPath, isDirectory) {
  const winPath = targetPath.replace(/\//g, '\\');
  const folderPath = isDirectory ? winPath : dirname(winPath);
  const normExpectedFolder = normalizeComparePath(folderPath);

  try {
    const explorerArg = isDirectory ? `"${winPath}"` : `/select,"${winPath}"`;
    const ex = spawn('explorer.exe', [explorerArg], {
      windowsVerbatimArguments: true,
      detached: true,
      stdio: 'ignore',
    });
    ex.on('error', () => {});
    ex.unref();
  } catch {}

  await new Promise((r) => setTimeout(r, 420));

  // Verify via Shell.Application whether Desktop Explorer opened the folder (and bring to front)
  const checkPs = [
    `$target = $env:AMP_CHECK_FOLDER`,
    `$opened = $false`,
    `try {`,
    `  $sh = New-Object -ComObject Shell.Application`,
    `  foreach ($w in @($sh.Windows())) {`,
    `    $u = [string]$w.LocationURL`,
    `    if (-not $u) { continue }`,
    `    $p = ([uri]$u).LocalPath.Replace('\\', '/').TrimEnd('/').ToLowerInvariant()`,
    `    if ($p -eq $target) {`,
    `      $opened = $true`,
    `      try { (New-Object -ComObject WScript.Shell).AppActivate([string]$w.LocationName) | Out-Null } catch {}`,
    `      break`,
    `    }`,
    `  }`,
    `} catch {}`,
    `if ($opened) { Write-Output 'OPENED' } else { Write-Output 'BLOCKED' }`,
  ].join('; ');

  const status = await new Promise((resolveCheck) => {
    let out = '';
    let settled = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      resolveCheck(val);
    };
    const timer = setTimeout(() => done('BLOCKED'), 1500);
    try {
      const child = spawn('powershell.exe', ['-NoProfile', '-Command', checkPs], {
        windowsHide: true,
        env: { ...process.env, AMP_CHECK_FOLDER: normExpectedFolder },
      });
      child.stdout.on('data', (c) => { out += c.toString('utf-8'); });
      child.on('error', () => { clearTimeout(timer); done('BLOCKED'); });
      child.on('close', () => { clearTimeout(timer); done(out.trim()); });
    } catch {
      clearTimeout(timer);
      done('BLOCKED');
    }
  });

  return status.includes('OPENED');
}

function readActiveTaskLogTail(convDir) {
  if (!convDir) return null;
  const now = Date.now();
  let newest = null;

  const tasksDir = join(convDir, '.system_generated', 'tasks');
  if (existsSync(tasksDir)) {
    try {
      for (const name of readdirSync(tasksDir)) {
        if (!name.endsWith('.log')) continue;
        const full = join(tasksDir, name);
        try {
          const st = statSync(full);
          if (!st.isFile() || st.size === 0 || now - st.mtimeMs > 25000) continue;
          if (!newest || st.mtimeMs > newest.mtimeMs) {
            newest = { name, full, size: st.size, mtimeMs: st.mtimeMs };
          }
        } catch {}
      }
    } catch {}
  }

  const stepsDir = join(convDir, '.system_generated', 'steps');
  if (existsSync(stepsDir)) {
    try {
      const stepDirs = readdirSync(stepsDir)
        .filter((d) => /^\d+$/.test(d))
        .sort((a, b) => Number(b) - Number(a))
        .slice(0, 4);
      for (const sd of stepDirs) {
        const outFile = join(stepsDir, sd, 'output.txt');
        if (!existsSync(outFile)) continue;
        try {
          const st = statSync(outFile);
          if (!st.isFile() || st.size === 0 || now - st.mtimeMs > 25000) continue;
          if (!newest || st.mtimeMs > newest.mtimeMs) {
            newest = { name: `step-${sd}/output.txt`, full: outFile, size: st.size, mtimeMs: st.mtimeMs };
          }
        } catch {}
      }
    } catch {}
  }

  if (!newest) return null;
  try {
    const maxBytes = 6400;
    const readLen = Math.min(newest.size, maxBytes);
    const startOffset = newest.size - readLen;
    const buf = Buffer.alloc(readLen);
    const fd = openSync(newest.full, 'r');
    try {
      readSync(fd, buf, 0, readLen, startOffset);
    } finally {
      try { closeSync(fd); } catch {}
    }
    let text = buf.toString('utf-8');
    if (startOffset > 0) {
      const nl = text.indexOf('\n');
      if (nl !== -1 && nl < 200) text = text.slice(nl + 1);
    }
    return {
      filename: newest.name,
      path: newest.full,
      size: newest.size,
      updatedAt: newest.mtimeMs,
      text: text.trimEnd(),
    };
  } catch {
    return null;
  }
}

export function createPreviewEngine({
  onExtraRoute,
  tokenValidator,
  storePersistPath,
  authPersistPath,
} = {}) {
  const reader = new TranscriptReader();
  const customStore = new CustomPreviewStore(storePersistPath !== undefined ? { persistPath: storePersistPath } : {});
  const authManager = new PreviewAuthManager(authPersistPath !== undefined ? { persistPath: authPersistPath } : {});
  const btwNotesPath = customStore.persistPath ? join(dirname(customStore.persistPath), 'btw-notes.json') : '';
  const pinnedSessionsPath = customStore.persistPath ? join(dirname(customStore.persistPath), 'pinned-sessions.json') : '';
  const customPalettesPath = customStore.persistPath ? join(dirname(customStore.persistPath), 'custom-palettes.json') : '';
  const savedTurns = new SavedTurnStore({
    dir: customStore.persistPath ? join(dirname(customStore.persistPath), 'saved-turns') : '',
  });
  const btwNotesByConv = new Map();
  let btwNotesMtimeMs = 0;
  let pinnedSessionIds = [];
  let pinnedMtimeMs = 0;
  let customPalettesList = [];
  let customPalettesMtimeMs = 0;

  const sanitizeCustomPalettes = (arr) => {
    if (!Array.isArray(arr)) return [];
    const hexRe = /^#[0-9a-fA-F]{6}$/;
    const seen = new Set();
    const out = [];
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue;
      const id = String(item.id || '').trim();
      if (!/^custom-[a-zA-Z0-9_-]{1,40}$/.test(id) || seen.has(id)) continue;
      const lightBg = String(item.lightBg || '').trim().toLowerCase();
      const darkBg = String(item.darkBg || '').trim().toLowerCase();
      const accent = String(item.accent || '').trim().toLowerCase();
      if (!hexRe.test(lightBg) || !hexRe.test(darkBg) || !hexRe.test(accent)) continue;
      const name = String(item.name || '').trim().slice(0, 40) || 'Custom';
      seen.add(id);
      out.push({ id, name, lightBg, darkBg, accent });
      if (out.length >= 50) break;
    }
    return out;
  };

  const loadCustomPalettesFromDisk = () => {
    if (!customPalettesPath || !existsSync(customPalettesPath)) return;
    try {
      const st = statSync(customPalettesPath);
      if (st.mtimeMs <= customPalettesMtimeMs + 1) return;
      const parsed = JSON.parse(readFileSync(customPalettesPath, 'utf-8'));
      customPalettesList = sanitizeCustomPalettes(parsed);
      customPalettesMtimeMs = st.mtimeMs;
    } catch {}
  };
  loadCustomPalettesFromDisk();

  const saveCustomPalettesToDisk = () => {
    if (!customPalettesPath) return;
    try {
      mkdirSync(dirname(customPalettesPath), { recursive: true });
      writeFileSync(customPalettesPath, JSON.stringify(customPalettesList, null, 2), 'utf-8');
      customPalettesMtimeMs = statSync(customPalettesPath).mtimeMs;
    } catch {}
  };

  const loadPinnedFromDisk = () => {
    if (!pinnedSessionsPath || !existsSync(pinnedSessionsPath)) return;
    try {
      const st = statSync(pinnedSessionsPath);
      if (st.mtimeMs <= pinnedMtimeMs + 1) return;
      const arr = JSON.parse(readFileSync(pinnedSessionsPath, 'utf-8'));
      if (Array.isArray(arr)) {
        pinnedSessionIds = Array.from(new Set(arr.filter((x) => typeof x === 'string' && x.trim())));
      }
      pinnedMtimeMs = st.mtimeMs;
    } catch {}
  };
  loadPinnedFromDisk();

  const savePinnedToDisk = () => {
    if (!pinnedSessionsPath) return;
    try {
      mkdirSync(dirname(pinnedSessionsPath), { recursive: true });
      writeFileSync(pinnedSessionsPath, JSON.stringify(pinnedSessionIds, null, 2), 'utf-8');
      pinnedMtimeMs = statSync(pinnedSessionsPath).mtimeMs;
    } catch {}
  };

  const loadBtwNotesFromDisk = () => {
    if (!btwNotesPath || !existsSync(btwNotesPath)) return;
    try {
      const st = statSync(btwNotesPath);
      if (st.mtimeMs <= btwNotesMtimeMs + 1) return;
      const savedBtw = JSON.parse(readFileSync(btwNotesPath, 'utf-8'));
      btwNotesByConv.clear();
      if (savedBtw && typeof savedBtw === 'object') {
        for (const [cid, arr] of Object.entries(savedBtw)) {
          if (Array.isArray(arr)) btwNotesByConv.set(cid, arr);
        }
      }
      btwNotesMtimeMs = st.mtimeMs;
    } catch {}
  };
  loadBtwNotesFromDisk();

  const saveBtwNotes = () => {
    if (!btwNotesPath) return;
    try {
      mkdirSync(dirname(btwNotesPath), { recursive: true });
      writeFileSync(btwNotesPath, JSON.stringify(Object.fromEntries(btwNotesByConv), null, 2), 'utf-8');
      btwNotesMtimeMs = statSync(btwNotesPath).mtimeMs;
    } catch {}
  };

  const sseClients = new Set();
  const watchers = new Map();
  const liveHookStates = new Map();
  const liveConvRuntime = new Map(); // convId -> { stepCount, activeStatus, updatedAt }
  const runStateCache = new Map(); // `${flavor}:${convId}` -> { checkedAt, state }
  const serverBootId = `${process.pid}-${Date.now()}`;

  function isHookPhaseRunning(hs) {
    if (!hs || !hs.phase) return false;
    if (hs.phase === 'stopped' || hs.phase === 'idle' || hs.phase === 'started') return false;
    const maxAge = (hs.phase === 'tool_done' || hs.phase === 'between_steps') ? 30000 : 75000;
    if (Date.now() - (hs.updatedAt || 0) > maxAge) return false;
    return hs.phase === 'thinking' || hs.phase === 'running_tool' || hs.phase === 'tool_done' || hs.phase === 'between_steps';
  }

  function getCachedRunState(convId, flavor = 'antigravity-cli') {
    const key = `${flavor || 'antigravity-cli'}:${convId}`;
    const now = Date.now();
    const cached = runStateCache.get(key);
    if (cached && now - cached.checkedAt < 850) {
      return cached.state;
    }
    const state = getConversationRunState(convId, flavor || 'antigravity-cli');
    runStateCache.set(key, { checkedAt: now, state });
    if (runStateCache.size > 128) {
      const oldest = runStateCache.keys().next().value;
      runStateCache.delete(oldest);
    }
    return state;
  }

  function invalidateRunStateCache(convId = '', flavor = '') {
    if (!convId && !flavor) {
      runStateCache.clear();
      return;
    }
    for (const k of runStateCache.keys()) {
      if ((convId && k.endsWith(`:${convId}`)) || (flavor && k.startsWith(`${flavor}:`))) {
        runStateCache.delete(k);
      }
    }
  }

  function computeRuntimeReadOpts(convId, flavor, tPathMtimeMs, taskTail) {
    const hs = liveHookStates.get(convId) || null;
    const hookRunning = isHookPhaseRunning(hs);
    const hookStopped = Boolean(
      hs &&
      hs.phase === 'stopped' &&
      (hs.updatedAt || 0) >= (tPathMtimeMs || 0) - 2000
    );
    const userCanceled = Boolean(hookStopped && hs.terminationReason === 'USER_CANCELED');
    let dbConfirmedIdle = false;
    if (!hookStopped && !hookRunning && !taskTail && tPathMtimeMs > 0 && Date.now() - tPathMtimeMs > 2500) {
      const dbState = getCachedRunState(convId, flavor || 'antigravity-cli');
      if (dbState.found && !dbState.active) {
        dbConfirmedIdle = true;
      }
    }
    return {
      sessionStopped: hookStopped || dbConfirmedIdle,
      userCanceled,
      hasActiveTaskLog: Boolean(taskTail),
    };
  }

  function enrichConversationsWithLiveState(convs) {
    const now = Date.now();
    const enriched = convs.map((c) => {
      const hs = liveHookStates.get(c.id) || null;
      const rt = liveConvRuntime.get(c.id) || null;
      const hookActive = isHookPhaseRunning(hs);
      const hookRecentlyStopped = Boolean(hs && hs.phase === 'stopped' && now - (hs.updatedAt || 0) < 15000);
      const rtStopped = Boolean(
        rt &&
        (rt.activeStatus === 'canceled' || rt.activeStatus === 'idle') &&
        (rt.updatedAt || 0) >= (c.updatedAt || 0)
      );
      const rtActive = Boolean(
        rt &&
        (rt.activeStatus === 'running' || rt.activeStatus === 'waiting_decision') &&
        now - (rt.updatedAt || 0) < (rt.activeStatus === 'waiting_decision' ? 3600000 : 45000)
      );
      const active = hookActive || rtActive || (c.active && !hookRecentlyStopped && !rtStopped);
      const waitingDecision = hookRecentlyStopped
        ? null
        : (rt?.activeStatus === 'waiting_decision'
            ? rt.pendingDecision
            : (rt && rt.activeStatus && rt.activeStatus !== 'waiting_decision' && (rt.updatedAt || 0) >= (c.updatedAt || 0)
                ? null
                : (c.waitingDecision || null)));
      const stepCount = Math.max(c.stepCount || 0, rt?.stepCount || 0);
      const updatedAt = Math.max(c.updatedAt || 0, hs?.updatedAt || 0, rt?.updatedAt || 0);
      return {
        ...c,
        active,
        waitingDecision,
        stepCount,
        updatedAt,
        hookState: hs && now - (hs.updatedAt || 0) < 90000 ? hs : null,
      };
    });
    enriched.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return enriched;
  }

  function broadcastEvent(eventName, payload, filterFn = null) {
    const frame = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of sseClients) {
      if (filterFn && !filterFn(client)) continue;
      try {
        client.res.write(frame);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  function ensureTranscriptWatch(convId, flavorHint) {
    const resolved = resolveConversationDir(convId, flavorHint);
    if (!resolved) return null;
    const tPath = resolveTranscriptPath(resolved.dir);
    if (!tPath) return null;

    if (!watchers.has(tPath)) {
      let timer = null;
      const emitUpdate = () => {
        try {
          const st = existsSync(tPath) ? statSync(tPath) : null;
          const taskTail = readActiveTaskLogTail(resolved.dir);
          const readOpts = computeRuntimeReadOpts(convId, resolved.flavor, st?.mtimeMs || 0, taskTail);
          const { view, updatedAt } = reader.read(tPath, readOpts);
          broadcastEvent(
            'transcript',
            {
              conversationId: convId,
              flavor: resolved.flavor,
              updatedAt,
              view,
              hookState: liveHookStates.get(convId) || null,
              liveTaskLog: taskTail,
            },
            (c) => !c.convId || c.convId === convId
          );
        } catch {}
      };

      try {
        const watcher = watch(tPath, { persistent: false }, () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(emitUpdate, 90);
        });
        watcher.on('error', () => {
          if (timer) clearTimeout(timer);
          watchers.delete(tPath);
          try { watcher.close(); } catch {}
        });
        watchers.set(tPath, { watcher, timer, kind: 'transcript', convId });
      } catch {}
    }
    return { ...resolved, transcriptPath: tPath };
  }

  function ensureCustomFileWatch(previewId, filePath) {
    if (!filePath || watchers.has(filePath)) return;
    let timer = null;
    try {
      const watcher = watch(filePath, { persistent: false }, () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          const refreshed = customStore.refreshFromFile(previewId);
          if (refreshed) {
            broadcastEvent(
              'custom-preview',
              refreshed,
              (c) => !c.previewId || c.previewId === previewId
            );
          }
        }, 120);
      });
      watcher.on('error', () => {
        if (timer) clearTimeout(timer);
        watchers.delete(filePath);
        try { watcher.close(); } catch {}
      });
      watchers.set(filePath, { watcher, timer, kind: 'custom', previewId });
    } catch {}
  }

  const heartbeat = setInterval(() => {
    for (const client of sseClients) {
      try {
        client.res.write(': ping\n\n');
      } catch {
        sseClients.delete(client);
      }
    }
  }, 15000);
  heartbeat.unref?.();

  // Sub-second live streaming poller (active only when >=1 SSE client is connected; overcomes Windows fs.watch buffering)
  const streamSnapshots = new Map(); // convId -> { tPath, size, mtimeMs, taskSig }
  const dbMtimeSnapshots = new Map(); // flavor -> mtimeMs
  let streamTickCount = 0;

  const streamPoller = setInterval(() => {
    if (sseClients.size === 0) return;
    streamTickCount++;

    const watchedConvs = new Map();
    for (const c of sseClients) {
      if (c.convId && !watchedConvs.has(c.convId)) {
        watchedConvs.set(c.convId, c.flavorHint);
      }
    }

    for (const [convId, flavorHint] of watchedConvs.entries()) {
      try {
        const resolved = resolveConversationDir(convId, flavorHint);
        if (!resolved) continue;
        const tPath = resolveTranscriptPath(resolved.dir);
        if (!tPath || !existsSync(tPath)) continue;

        const st = statSync(tPath);
        const hookState = liveHookStates.get(convId) || null;
        const taskTail = readActiveTaskLogTail(resolved.dir);
        const taskSig = taskTail ? `${taskTail.filename}:${taskTail.size}` : '';
        const readOpts = computeRuntimeReadOpts(convId, resolved.flavor, st.mtimeMs, taskTail);

        const prev = streamSnapshots.get(convId);
        if (
          prev &&
          prev.tPath === tPath &&
          prev.size === st.size &&
          prev.mtimeMs === st.mtimeMs &&
          prev.taskSig === taskSig &&
          prev.sessionStopped === readOpts.sessionStopped &&
          prev.userCanceled === readOpts.userCanceled
        ) {
          continue;
        }

        streamSnapshots.set(convId, {
          tPath,
          size: st.size,
          mtimeMs: st.mtimeMs,
          taskSig,
          sessionStopped: readOpts.sessionStopped,
          userCanceled: readOpts.userCanceled,
        });
        const { view, updatedAt } = reader.read(tPath, readOpts);
        const mergedUpdatedAt = Math.max(updatedAt, taskTail?.updatedAt || 0, readOpts.sessionStopped ? Date.now() : 0);
        liveConvRuntime.set(convId, {
          stepCount: view?.summary?.totalSteps || 0,
          activeStatus: view?.summary?.activeStatus || 'idle',
          pendingDecision: view?.summary?.pendingDecision || null,
          updatedAt: mergedUpdatedAt,
        });
        broadcastEvent(
          'transcript',
          {
            conversationId: convId,
            flavor: resolved.flavor,
            updatedAt: mergedUpdatedAt,
            view,
            hookState,
            liveTaskLog: taskTail,
          },
          (c) => !c.convId || c.convId === convId
        );
      } catch {}
    }

    // Check conversation_summaries.db + WAL + SHM every ~900ms so left sidebar session status stays live
    if (streamTickCount % 5 === 0) {
      for (const flavor of detectFlavors()) {
        try {
          const dbBase = join(getGeminiRoot(), flavor, 'conversation_summaries.db');
          if (!existsSync(dbBase)) continue;
          const sigParts = [];
          for (const f of [dbBase, `${dbBase}-wal`, `${dbBase}-shm`]) {
            if (existsSync(f)) {
              const fst = statSync(f);
              sigParts.push(`${Math.round(fst.mtimeMs)}:${fst.size}`);
            }
          }
          const nextDbSig = sigParts.join('|');
          const prevDbSig = dbMtimeSnapshots.get(flavor);
          if (prevDbSig !== undefined && nextDbSig !== prevDbSig) {
            invalidateRunStateCache('', flavor);
            broadcastEvent('conversations-updated', { flavor, updatedAt: Date.now() });
          }
          dbMtimeSnapshots.set(flavor, nextDbSig);
        } catch {}
      }
    }
  }, 180);
  streamPoller.unref?.();

  async function handleRequest(req, res) {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const pathname = url.pathname;

    if (onExtraRoute) {
      const handled = await onExtraRoute(req, res, url);
      if (handled) return;
    }

    if (req.method !== 'GET' && tokenValidator && !tokenValidator(req, url)) {
      return sendJson(res, 401, { error: 'Unauthorized: invalid sidecar token' });
    }

    const authStatus = authManager.getStatus();

    if (req.method === 'GET' && pathname === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        pid: process.pid,
        clients: sseClients.size,
        authRequired: authStatus.authRequired,
      });
    }

    if (req.method === 'GET' && pathname === '/api/auth/status') {
      const isAuthed = Boolean(tokenValidator) || authManager.isRequestAuthenticated(req, url);
      return sendJson(res, 200, {
        authRequired: authStatus.authRequired,
        enabled: authStatus.enabled,
        hasPassword: authStatus.hasPassword,
        authenticated: isAuthed,
      });
    }

    if (req.method === 'POST' && pathname === '/api/auth/login') {
      const remoteKey = req.socket?.remoteAddress || 'local';
      const limitCheck = authManager.checkRateLimit(remoteKey);
      if (!limitCheck.allowed) {
        return sendJson(res, 429, { error: `Too many login attempts. Retry in ${limitCheck.retryAfterSec}s.` });
      }
      try {
        const body = await readJsonBody(req, 16 * 1024);
        const ok = authManager.verifyPassword(body.password || '');
        authManager.recordLoginAttempt(remoteKey, ok);
        if (!ok) {
          return sendJson(res, 401, { error: 'Invalid password', authenticated: false });
        }
        const sessionToken = authManager.createSessionToken();
        return sendJson(
          res,
          200,
          { ok: true, authenticated: true, token: sessionToken },
          { 'Set-Cookie': authManager.buildSetCookieHeader(sessionToken) }
        );
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    if (req.method === 'POST' && pathname === '/api/auth/logout') {
      return sendJson(
        res,
        200,
        { ok: true, authenticated: false },
        { 'Set-Cookie': authManager.buildClearCookieHeader() }
      );
    }

    // Enforce password authentication on all remaining /api/* routes in standalone mode
    if (pathname.startsWith('/api/') && !tokenValidator) {
      if (!authManager.isRequestAuthenticated(req, url)) {
        return sendJson(res, 401, { error: 'Authentication required', authRequired: true });
      }
    }

    if (req.method === 'POST' && pathname === '/api/auth/reload') {
      authManager.syncFromDisk();
      const updated = authManager.getStatus();
      broadcastEvent('auth', { authRequired: updated.authRequired });
      if (updated.authRequired) {
        for (const client of sseClients) {
          try { client.res.end(); } catch {}
        }
        sseClients.clear();
      }
      return sendJson(res, 200, { ok: true, ...updated });
    }

    if (req.method === 'GET' && pathname === '/api/flavors') {
      return sendJson(res, 200, { flavors: detectFlavors() });
    }

    if (req.method === 'GET' && pathname === '/api/conversations') {
      loadPinnedFromDisk();
      const flavor = url.searchParams.get('flavor') || 'antigravity-cli';
      const limit = Math.min(2000, Math.max(10, Number(url.searchParams.get('limit')) || 1000));
      return sendJson(res, 200, {
        flavor,
        conversations: enrichConversationsWithLiveState(listConversations(flavor, limit)),
        pinnedIds: pinnedSessionIds,
      });
    }

    if (pathname === '/api/pinned-sessions') {
      loadPinnedFromDisk();
      if (req.method === 'GET') {
        return sendJson(res, 200, { pinnedIds: pinnedSessionIds });
      }
      if (req.method === 'POST') {
        try {
          const body = await readJsonBody(req);
          const convId = String(body.conversationId || '').trim();
          if (!convId) return sendJson(res, 400, { error: 'conversationId is required' });
          const isCurrentlyPinned = pinnedSessionIds.includes(convId);
          const nextPinned = typeof body.pinned === 'boolean' ? body.pinned : !isCurrentlyPinned;
          if (nextPinned) {
            pinnedSessionIds = [convId, ...pinnedSessionIds.filter((id) => id !== convId)];
          } else {
            pinnedSessionIds = pinnedSessionIds.filter((id) => id !== convId);
          }
          savePinnedToDisk();
          broadcastEvent('pinned-sessions', { pinnedIds: pinnedSessionIds });
          return sendJson(res, 200, { ok: true, pinned: nextPinned, pinnedIds: pinnedSessionIds });
        } catch (err) {
          return sendJson(res, 400, { error: err.message });
        }
      }
    }

    if (pathname === '/api/saved-turns' || pathname.startsWith('/api/saved-turns/')) {
      const savedId = pathname === '/api/saved-turns' ? '' : decodeURIComponent(pathname.slice('/api/saved-turns/'.length));
      if (req.method === 'GET' && !savedId) {
        return sendJson(res, 200, { turns: savedTurns.list() });
      }
      if (req.method === 'GET' && savedId) {
        try {
          const record = savedTurns.get(savedId);
          if (!record) return sendJson(res, 404, { error: 'Saved turn not found' });
          return sendJson(res, 200, record);
        } catch (err) {
          return sendJson(res, 400, { error: err.message });
        }
      }
      if (req.method === 'POST' && !savedId) {
        try {
          const body = await readJsonBody(req);
          const summary = savedTurns.create(body);
          return sendJson(res, 200, summary);
        } catch (err) {
          return sendJson(res, 400, { error: err.message });
        }
      }
      if (req.method === 'DELETE' && savedId) {
        try {
          savedTurns.delete(savedId);
          return sendJson(res, 200, { ok: true });
        } catch (err) {
          return sendJson(res, 400, { error: err.message });
        }
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    if (pathname === '/api/custom-palettes') {
      loadCustomPalettesFromDisk();
      if (req.method === 'GET') {
        return sendJson(res, 200, { palettes: customPalettesList });
      }
      if (req.method === 'PUT' || req.method === 'POST') {
        try {
          const body = await readJsonBody(req);
          customPalettesList = sanitizeCustomPalettes(body.palettes);
          saveCustomPalettesToDisk();
          broadcastEvent('custom-palettes', { palettes: customPalettesList });
          return sendJson(res, 200, { ok: true, palettes: customPalettesList });
        } catch (err) {
          return sendJson(res, 400, { error: err.message });
        }
      }
    }

    const viewMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/view$/);
    if (req.method === 'GET' && viewMatch) {
      const convId = decodeURIComponent(viewMatch[1]);
      const flavorHint = url.searchParams.get('flavor') || undefined;
      const resolved = resolveConversationDir(convId, flavorHint);
      if (!resolved) {
        return sendJson(res, 404, { error: `Conversation not found: ${convId}` });
      }
      const tPath = resolveTranscriptPath(resolved.dir);
      const liveTaskLog = readActiveTaskLogTail(resolved.dir);
      let tStat = null;
      if (tPath && existsSync(tPath)) {
        try { tStat = statSync(tPath); } catch {}
      }
      const readOpts = computeRuntimeReadOpts(convId, resolved.flavor, tStat?.mtimeMs || 0, liveTaskLog);
      const { view, updatedAt } = reader.read(tPath, readOpts);
      const artifacts = listArtifacts(resolved.dir);
      const allConvs = listConversations(resolved.flavor, 1000);
      const catalogEntry = allConvs.find((c) => c.id === convId);
      const subagents = allConvs.filter((c) => c.parentConversationId === convId);
      const parentSession = catalogEntry?.parentConversationId
        ? allConvs.find((c) => c.id === catalogEntry.parentConversationId) || { id: catalogEntry.parentConversationId, title: 'Parent Session' }
        : null;
      loadBtwNotesFromDisk();
      ensureTranscriptWatch(convId, resolved.flavor);
      liveConvRuntime.set(convId, {
        stepCount: view?.summary?.totalSteps || 0,
        activeStatus: view?.summary?.activeStatus || 'idle',
        pendingDecision: view?.summary?.pendingDecision || null,
        updatedAt: Math.max(updatedAt, liveTaskLog?.updatedAt || 0),
      });
      if (tPath && tStat) {
        streamSnapshots.set(convId, {
          tPath,
          size: tStat.size,
          mtimeMs: tStat.mtimeMs,
          taskSig: liveTaskLog ? `${liveTaskLog.filename}:${liveTaskLog.size}` : '',
          sessionStopped: readOpts.sessionStopped,
          userCanceled: readOpts.userCanceled,
        });
      }
      return sendJson(res, 200, {
        conversationId: convId,
        flavor: resolved.flavor,
        transcriptPath: tPath,
        baseDir: catalogEntry?.workspaceUri || resolved.dir,
        artifactDir: resolved.dir,
        projectName: catalogEntry?.projectName || '',
        subagents,
        parentSession,
        cliInsights: {
          btwCommands: listBtwCommands(convId, resolved.flavor),
          btwNotes: btwNotesByConv.get(convId) || [],
          globalUsage: getRollingUsageStats(resolved.flavor),
        },
        updatedAt,
        view,
        artifacts,
        hookState: liveHookStates.get(convId) || null,
        liveTaskLog,
      });
    }

    const btwNotesMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/btw-notes(?:\/([^/]+))?$/);
    if (btwNotesMatch) {
      const convId = decodeURIComponent(btwNotesMatch[1]);
      const noteId = btwNotesMatch[2] ? decodeURIComponent(btwNotesMatch[2]) : '';
      if (req.method === 'POST') {
        try {
          const body = await readJsonBody(req);
          const answer = String(body.answer || '').trim();
          if (!answer) return sendJson(res, 400, { error: 'Answer text is empty' });
          const notes = btwNotesByConv.get(convId) || [];
          const note = {
            id: `btw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            question: String(body.question || '').trim(),
            answer,
            createdAt: Date.now(),
          };
          notes.push(note);
          btwNotesByConv.set(convId, notes);
          saveBtwNotes();
          return sendJson(res, 200, { ok: true, notes });
        } catch (err) {
          return sendJson(res, 400, { error: err.message });
        }
      }
      if (req.method === 'DELETE' && noteId) {
        const notes = (btwNotesByConv.get(convId) || []).filter((n) => n.id !== noteId);
        btwNotesByConv.set(convId, notes);
        saveBtwNotes();
        return sendJson(res, 200, { ok: true, notes });
      }
    }

    const stepMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/steps\/(\d+)$/);
    if (req.method === 'GET' && stepMatch) {
      const convId = decodeURIComponent(stepMatch[1]);
      const stepIndex = Number(stepMatch[2]);
      const flavorHint = url.searchParams.get('flavor') || undefined;
      const resolved = resolveConversationDir(convId, flavorHint);
      if (!resolved) return sendJson(res, 404, { error: 'Conversation not found' });
      const tPath = resolveTranscriptPath(resolved.dir);
      const stepData = reader.getStepOutput(tPath, stepIndex);
      if (!stepData) return sendJson(res, 404, { error: 'Step not found' });
      return sendJson(res, 200, stepData);
    }

    // Reveal target file (or its parent directory) in the native OS file manager, with verified fallback directory listing
    if (req.method === 'POST' && pathname === '/api/reveal-in-folder') {
      try {
        const body = await readJsonBody(req);
        const check = resolveSafeFilePath(body.path || '', body.base || '', { allowDirectory: true });
        if (check.error) {
          return sendJson(res, check.status || 400, { error: check.error });
        }
        const resolvedPath = check.resolvedPath;
        const folderPath = check.isDirectory ? resolvedPath : dirname(resolvedPath);
        if (body.dryRun) {
          return sendJson(res, 200, { ok: true, openedInOs: true, path: resolvedPath, folder: folderPath, isDirectory: Boolean(check.isDirectory) });
        }

        let openedInOs = true;
        if (process.platform === 'win32') {
          openedInOs = await revealOnWindowsExplorer(resolvedPath, Boolean(check.isDirectory));
        } else if (process.platform === 'darwin') {
          const args = check.isDirectory ? [resolvedPath] : ['-R', resolvedPath];
          const child = spawn('open', args, { detached: true, stdio: 'ignore' });
          child.on('error', () => {});
          child.unref();
        } else {
          if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
            openedInOs = false;
          } else {
            const child = spawn('xdg-open', [folderPath], { detached: true, stdio: 'ignore' });
            child.on('error', () => {});
            child.unref();
          }
        }

        const listing = !openedInOs ? buildDirectoryListing(folderPath, check.isDirectory ? '' : resolvedPath) : null;
        return sendJson(res, 200, {
          ok: true,
          openedInOs,
          path: resolvedPath,
          folder: folderPath,
          isDirectory: Boolean(check.isDirectory),
          ...(listing || {}),
        });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    // Browse directory entries directly inside Preview UI (used by In-App Folder View fallback)
    if (req.method === 'GET' && pathname === '/api/folder-entries') {
      const targetPath = url.searchParams.get('path') || '';
      const baseDir = url.searchParams.get('base') || '';
      const highlight = url.searchParams.get('select') || '';
      const check = resolveSafeFilePath(targetPath, baseDir, { allowDirectory: true });
      if (check.error) {
        return sendJson(res, check.status || 400, { error: check.error });
      }
      const folderPath = check.isDirectory ? check.resolvedPath : dirname(check.resolvedPath);
      const selectedFile = highlight || (check.isDirectory ? '' : check.resolvedPath);
      try {
        return sendJson(res, 200, {
          ok: true,
          path: check.resolvedPath,
          ...buildDirectoryListing(folderPath, selectedFile),
        });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    // Rich file metadata + content endpoint for Popup Modal & Side Preview Pane
    if (req.method === 'GET' && pathname === '/api/file-info') {
      const targetPath = url.searchParams.get('path') || '';
      const baseDir = url.searchParams.get('base') || '';
      const check = resolveSafeFilePath(targetPath, baseDir);
      if (check.error) {
        return sendJson(res, check.status || 400, { error: check.error, resolvedPath: check.resolvedPath || '' });
      }
      try {
        const st = statSync(check.resolvedPath);
        const info = classifyFile(check.resolvedPath);
        const rawUrl = `/api/raw-file?path=${encodeURIComponent(check.resolvedPath)}`;
        const result = {
          path: check.resolvedPath,
          filename: basename(check.resolvedPath),
          baseDir: dirname(check.resolvedPath),
          hash: check.hashPart || '',
          size: st.size,
          kind: info.kind,
          lang: info.lang,
          ext: info.ext,
          rawUrl,
        };
        if (['image', 'pdf', 'docx', 'doc', 'xlsx', 'pptx', 'video', 'audio'].includes(info.kind)) {
          return sendJson(res, 200, result);
        }
        if (st.size <= 2 * 1024 * 1024) {
          const buf = readFileSync(check.resolvedPath);
          const isBinary = buf.subarray(0, Math.min(buf.length, 4096)).includes(0);
          if (!isBinary) {
            result.kind = info.kind === 'unknown' ? 'code' : info.kind;
            result.content = buf.toString('utf-8');
          } else {
            result.kind = 'binary';
          }
        } else {
          result.truncated = true;
          const buf = readFileSync(check.resolvedPath).subarray(0, 512 * 1024);
          const isBinary = buf.subarray(0, Math.min(buf.length, 4096)).includes(0);
          if (!isBinary) {
            result.kind = info.kind === 'unknown' ? 'code' : info.kind;
            result.content = buf.toString('utf-8');
          } else {
            result.kind = 'binary';
          }
        }
        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    // Convert Office (.pptx, .ppt, .doc, .docx) to cached PDF when LibreOffice or MS Office COM is available
    if (req.method === 'GET' && pathname === '/api/office-to-pdf') {
      const targetPath = url.searchParams.get('path') || '';
      const baseDir = url.searchParams.get('base') || '';
      const check = resolveSafeFilePath(targetPath, baseDir);
      if (check.error) {
        return sendJson(res, check.status || 400, { error: check.error });
      }
      try {
        const resConv = await convertOfficeFileToPdfCached(check.resolvedPath);
        if (resConv.converted && resConv.cacheFileName) {
          return sendJson(res, 200, {
            ok: true,
            converted: true,
            converter: resConv.converter,
            pdfUrl: `/api/office-pdf-cache/${encodeURIComponent(resConv.cacheFileName)}`,
          });
        }
        return sendJson(res, 200, { ok: true, converted: false, reason: resConv.reason || 'Unavailable' });
      } catch (err) {
        return sendJson(res, 200, { ok: true, converted: false, reason: err.message });
      }
    }

    const officeCacheMatch = pathname.match(/^\/api\/office-pdf-cache\/([a-f0-9]{40}\.pdf)$/i);
    if ((req.method === 'GET' || req.method === 'HEAD') && officeCacheMatch) {
      const pdfFile = resolveCachedOfficePdfByName(officeCacheMatch[1]);
      if (!pdfFile) return sendJson(res, 404, { error: 'Cached PDF not found' });
      const st = statSync(pdfFile);
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Length': st.size,
        'Cache-Control': 'private, max-age=3600',
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      const stream = createReadStream(pdfFile);
      req.on('close', () => stream.destroy());
      stream.pipe(res);
      return;
    }

    // Streaming raw file & media endpoint with HTTP Range (206 Partial Content) support for video/audio/PDF
    if ((req.method === 'GET' || req.method === 'HEAD') && (pathname === '/api/raw-file' || pathname === '/api/file')) {
      const targetPath = url.searchParams.get('path') || '';
      const baseDir = url.searchParams.get('base') || '';
      const check = resolveSafeFilePath(targetPath, baseDir);
      if (check.error) {
        return sendJson(res, check.status || 400, { error: check.error });
      }
      try {
        const st = statSync(check.resolvedPath);
        const totalSize = st.size;
        const ext = extname(check.resolvedPath).toLowerCase();
        const contentType = pathname === '/api/file'
          ? 'text/plain; charset=utf-8'
          : (MIME_TYPES[ext] || 'application/octet-stream');
        const encodedName = encodeURIComponent(basename(check.resolvedPath));
        const baseHeaders = {
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache',
          'Content-Disposition': `inline; filename*=UTF-8''${encodedName}`,
        };

        const rangeReq = parseByteRangeHeader(req.headers.range, totalSize);
        if (rangeReq?.invalid) {
          res.writeHead(416, {
            ...baseHeaders,
            'Content-Range': `bytes */${totalSize}`,
          });
          res.end();
          return;
        }

        if (rangeReq) {
          const { start, end } = rangeReq;
          const chunkLen = end - start + 1;
          res.writeHead(206, {
            ...baseHeaders,
            'Content-Range': `bytes ${start}-${end}/${totalSize}`,
            'Content-Length': chunkLen,
          });
          if (req.method === 'HEAD') {
            res.end();
            return;
          }
          const stream = createReadStream(check.resolvedPath, { start, end });
          req.on('close', () => stream.destroy());
          stream.on('error', () => { if (!res.headersSent) res.writeHead(500); res.end(); });
          stream.pipe(res);
          return;
        }

        res.writeHead(200, {
          ...baseHeaders,
          'Content-Length': totalSize,
        });
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        const stream = createReadStream(check.resolvedPath);
        req.on('close', () => stream.destroy());
        stream.on('error', () => { if (!res.headersSent) res.writeHead(500); res.end(); });
        stream.pipe(res);
        return;
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (req.method === 'GET' && pathname === '/api/previews') {
      return sendJson(res, 200, {
        previews: customStore.list(),
        storagePath: customStore.persistPath || '',
      });
    }

    if (req.method === 'POST' && pathname === '/api/previews') {
      try {
        const body = await readJsonBody(req);
        const entry = customStore.createOrUpdate({
          id: body.id,
          title: body.title,
          filePath: body.filePath,
          droppedFilename: body.droppedFilename || '',
          baseDir: body.baseDir || '',
          mode: body.mode || 'auto',
          content: body.content,
        });
        if (entry.filePath) {
          ensureCustomFileWatch(entry.id, entry.filePath);
        }
        broadcastEvent('custom-preview', entry);
        return sendJson(res, 200, entry);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    if (req.method === 'POST' && pathname === '/api/previews/reorder') {
      try {
        const body = await readJsonBody(req);
        customStore.reorder(body.orderedIds || []);
        return sendJson(res, 200, { ok: true, previews: customStore.list() });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    if (req.method === 'GET' && pathname === '/api/file-picker') {
      const picker = await resolveNativeFilePicker();
      return sendJson(res, 200, {
        available: Boolean(picker),
        provider: picker?.id || '',
      });
    }

    // Native OS file picker. Node has no dialog of its own:
    // Windows PowerShell, macOS osascript, Linux zenity / kdialog / qarma / yad.
    if (req.method === 'POST' && pathname === '/api/pick-file') {
      try {
        const picked = await runNativeFilePicker();
        if (!picked.available) {
          return sendJson(res, 200, { available: false, canceled: false, provider: '' });
        }
        if (!picked.path) {
          return sendJson(res, 200, { available: true, canceled: true, provider: picked.provider });
        }
        const entry = customStore.createOrUpdate({ filePath: picked.path });
        ensureCustomFileWatch(entry.id, entry.filePath);
        broadcastEvent('custom-preview', entry);
        return sendJson(res, 200, { available: true, canceled: false, provider: picked.provider, entry });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    const previewItemMatch = pathname.match(/^\/api\/previews\/([^/]+)$/);
    if (previewItemMatch) {
      const id = decodeURIComponent(previewItemMatch[1]);
      if (req.method === 'GET') {
        const refreshed = customStore.refreshFromFile(id) || customStore.get(id);
        if (!refreshed) return sendJson(res, 404, { error: 'Preview not found' });
        if (refreshed.filePath) ensureCustomFileWatch(refreshed.id, refreshed.filePath);
        return sendJson(res, 200, refreshed);
      }
      if (req.method === 'PATCH') {
        try {
          const body = await readJsonBody(req);
          const updated = customStore.updateMeta(id, body);
          if (!updated) return sendJson(res, 404, { error: 'Preview not found' });
          broadcastEvent('custom-preview', updated);
          return sendJson(res, 200, updated);
        } catch (err) {
          return sendJson(res, 400, { error: err.message });
        }
      }
      if (req.method === 'DELETE') {
        const entry = customStore.get(id);
        if (entry?.filePath && watchers.has(entry.filePath)) {
          const w = watchers.get(entry.filePath);
          if (w.timer) clearTimeout(w.timer);
          try { w.watcher.close(); } catch {}
          watchers.delete(entry.filePath);
        }
        const ok = customStore.delete(id);
        return sendJson(res, ok ? 200 : 404, { ok });
      }
    }

    if (req.method === 'POST' && pathname === '/api/hook-event') {
      try {
        const payload = await readJsonBody(req, 1024 * 1024);
        const convId = payload.conversationId || '';
        const hookEventName = payload.hookEventName || '';
        const toolName = payload.toolCall?.name || '';

        if (convId && hookEventName === 'BtwCaptured') {
          loadBtwNotesFromDisk();
          broadcastEvent('btw-updated', {
            conversationId: convId,
            btwNotes: btwNotesByConv.get(convId) || [],
          });
          return sendJson(res, 200, { ok: true });
        }

        if (convId) {
          let phase = 'idle';
          if (hookEventName === 'PreInvocation') phase = 'thinking';
          else if (hookEventName === 'PreToolUse') phase = 'running_tool';
          else if (hookEventName === 'PostToolUse') phase = 'tool_done';
          else if (hookEventName === 'PostInvocation') phase = 'between_steps';
          else if (hookEventName === 'Stop') phase = 'stopped';
          else if (hookEventName === 'SessionStart') phase = 'started';

          const hookState = {
            phase,
            hookEventName,
            toolName,
            terminationReason: payload.terminationReason || '',
            error: payload.error || '',
            updatedAt: Date.now(),
          };
          invalidateRunStateCache(convId);
          liveHookStates.set(convId, hookState);
          broadcastEvent('hook', { conversationId: convId, hookState });

          const resolved = resolveConversationDir(convId);
          const tPath = payload.transcriptPath || (resolved ? resolveTranscriptPath(resolved.dir) : null);
          if (tPath && existsSync(tPath)) {
            const st = statSync(tPath);
            const taskTail = resolved ? readActiveTaskLogTail(resolved.dir) : null;
            const flavor = resolved?.flavor || 'antigravity-cli';
            const readOpts = computeRuntimeReadOpts(convId, flavor, st.mtimeMs, taskTail);
            const { view, updatedAt } = reader.read(tPath, readOpts);
            streamSnapshots.set(convId, {
              tPath,
              size: st.size,
              mtimeMs: st.mtimeMs,
              taskSig: taskTail ? `${taskTail.filename}:${taskTail.size}` : '',
              sessionStopped: readOpts.sessionStopped,
              userCanceled: readOpts.userCanceled,
            });
            liveConvRuntime.set(convId, {
              stepCount: view?.summary?.totalSteps || 0,
              activeStatus: view?.summary?.activeStatus || 'idle',
              pendingDecision: view?.summary?.pendingDecision || null,
              updatedAt: Math.max(updatedAt, hookState.updatedAt),
            });
            broadcastEvent(
              'transcript',
              { conversationId: convId, flavor, updatedAt, view, hookState, liveTaskLog: taskTail },
              (c) => !c.convId || c.convId === convId
            );
          }
        }
        return sendJson(res, 200, { ok: true });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    if (req.method === 'POST' && pathname === '/api/focus') {
      try {
        const body = await readJsonBody(req);
        if (body.openWindow && typeof body.url === 'string' && body.url.startsWith('http://127.0.0.1:')) {
          const launched = spawnAppWindow(body.url);
          return sendJson(res, 200, { ok: true, window: launched, clients: sseClients.size });
        }
        let resolvedTitle = typeof body.title === 'string' ? body.title.trim() : '';
        if (!resolvedTitle && body.previewId) {
          resolvedTitle = customStore.get(body.previewId)?.title || '';
        } else if (!resolvedTitle && body.conversationId) {
          const flv = body.flavor || 'antigravity-cli';
          const found = listConversations(flv, 400).find((c) => c.id === body.conversationId);
          resolvedTitle = found?.title || `Session ${String(body.conversationId).slice(0, 8)}`;
        }
        const focusEvent = {
          ...body,
          title: resolvedTitle,
          force: Boolean(body.force),
        };
        broadcastEvent('focus', focusEvent);
        return sendJson(res, 200, { ok: true, clients: sseClients.size, focus: focusEvent });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    if (req.method === 'GET' && pathname === '/api/events') {
      const convId = url.searchParams.get('conv') || '';
      const previewId = url.searchParams.get('preview') || '';
      const flavorHint = url.searchParams.get('flavor') || undefined;
      if (convId) ensureTranscriptWatch(convId, flavorHint);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });
      res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, bootId: serverBootId, convId, previewId })}\n\n`);

      const client = { res, convId, previewId, flavorHint };
      sseClients.add(client);
      req.on('close', () => {
        sseClients.delete(client);
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/preload.js') {
      return sendText(res, 200, 'window.__standalonePreviewMode = true;', 'application/javascript; charset=utf-8');
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      const relPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const fullPath = resolve(PUBLIC_DIR, relPath);
      if (!fullPath.startsWith(PUBLIC_DIR)) {
        return sendText(res, 403, 'Forbidden');
      }
      if (existsSync(fullPath)) {
        const st = statSync(fullPath);
        if (st.isFile()) {
          const ext = extname(fullPath).toLowerCase();
          res.writeHead(200, {
            'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
            'Content-Length': st.size,
            'Cache-Control': 'no-store',
          });
          if (req.method === 'HEAD') {
            res.end();
            return;
          }
          const stream = createReadStream(fullPath);
          req.on('close', () => stream.destroy());
          stream.pipe(res);
          return;
        }
      }
      return sendText(res, 404, 'Not Found');
    }

    return sendJson(res, 405, { error: 'Method Not Allowed' });
  }

  function close() {
    clearInterval(heartbeat);
    clearInterval(streamPoller);
    for (const entry of watchers.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      try { entry.watcher.close(); } catch {}
    }
    watchers.clear();
    for (const client of sseClients) {
      try { client.res.end(); } catch {}
    }
    sseClients.clear();
  }

  return { handleRequest, close, customStore, authManager, reader };
}

export function startStandaloneServer({
  port = 0,
  host = '127.0.0.1',
  storePersistPath,
  authPersistPath,
} = {}) {
  const engine = createPreviewEngine({ storePersistPath, authPersistPath });
  const server = createServer((req, res) => {
    engine.handleRequest(req, res).catch((err) => {
      if (!res.headersSent) {
        sendJson(res, 500, { error: err.message });
      }
    });
  });

  return new Promise((resolveStart, rejectStart) => {
    server.on('error', rejectStart);
    server.listen(port, host, () => {
      const addr = server.address();
      resolveStart({ server, port: addr.port, host, engine });
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const portArgIdx = process.argv.indexOf('--port');
  const hostArgIdx = process.argv.indexOf('--host');
  const port = portArgIdx !== -1 ? Number(process.argv[portArgIdx + 1]) || 0 : (Number(process.env.PREVIEW_PORT) || 0);
  const host = hostArgIdx !== -1 ? (process.argv[hostArgIdx + 1] || '127.0.0.1') : (process.env.PREVIEW_HOST || '127.0.0.1');
  const { port: boundPort } = await startStandaloneServer({ port, host });
  console.log(`[agy-session-preview] listening on http://${host}:${boundPort}`);
}
