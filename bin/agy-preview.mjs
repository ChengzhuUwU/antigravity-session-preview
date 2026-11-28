#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PreviewAuthManager } from '../server/auth.mjs';
import { defaultInstallRoot, runPluginUpdate } from '../server/plugin-update.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(HERE, '..');
const SERVER_ENTRY = join(PLUGIN_ROOT, 'server', 'app.mjs');
const RUNTIME_DIR = join(homedir(), '.gemini', 'cache', 'agy-session-preview');
const SERVER_JSON = join(RUNTIME_DIR, 'server.json');
const LEGACY_SERVER_JSON = join(homedir(), '.gemini', 'cache', 'agy-markdown-preview', 'server.json');
const SERVER_LOG = join(RUNTIME_DIR, 'server.log');

const DEFAULT_PORT = 19420;

function printHelp() {
  console.log(`Usage: agy-preview [file] [options]
       agy-preview password <set <pwd> | cancel | clear | disable | activate [pwd] | print>

Options:
  -c, --conv <id>              Preview a specific Antigravity conversation ID
  -f, --file <path>            Preview and live-watch a Markdown / PDF / Video / JSONL file
  -t, --title <title>          Custom title for file or stdin preview
  -m, --mode <mode>            Parse mode: auto | markdown | stream-json (default: auto)
  -p, --port <port>            Preferred local server port (default: 19420)
      --host <host>            Bind host address (default: 127.0.0.1; use 0.0.0.0 on servers)
      --flavor <name>          Antigravity flavor (default: antigravity-cli)
      --stdin                  Read Markdown, CLI text, or stream-json from stdin
      --open                   Open or focus preview window (enabled by default)
      --focus                  Force-switch existing preview window immediately without prompt
      --no-open                Start/sync server without opening a window
      --new-window             Always open a new standalone app window
      --foreground             Keep server in foreground (used by daemon mode)
      --status                 Show running background preview server status
      --restart                Restart the background preview server in place
      --stop                   Stop the background preview server
      update, --update         Download the latest GitHub release and replace the installed plugin

Password Security (for remote / shared servers, disabled by default):
      --set-password <pwd>     Set and immediately activate frontend password protection
      --cancel-password        Cancel and clear the stored password (alias: --clear-password)
      --disable-password       Temporarily deactivate password check (keeps saved password)
      --activate-password [pw] Activate password protection (uses saved password, [pw], or generates one)
      --print-password         Print current password status and plaintext password
  -h, --help                   Show this help message`);
}

function parseArgs(argv) {
  const opts = {
    conv: process.env.ANTIGRAVITY_CONVERSATION_ID || '',
    flavor: 'antigravity-cli',
    file: '',
    title: '',
    mode: 'auto',
    host: '',
    open: true,
    explicitOpen: false,
    explicitTarget: false,
    focus: false,
    newWindow: false,
    foreground: false,
    restart: false,
    stop: false,
    status: false,
    update: false,
    stdin: false,
    help: false,
    port: 0,
    passwordCmd: '',
    passwordVal: '',
  };

  if (argv[0] === 'update') {
    opts.update = true;
    return opts;
  }

  if (argv[0] === 'password' || argv[0] === 'auth') {
    const sub = (argv[1] || 'print').toLowerCase();
    if (sub === 'set') {
      opts.passwordCmd = 'set';
      opts.passwordVal = argv[2] || '';
    } else if (sub === 'cancel' || sub === 'clear' || sub === 'unset' || sub === 'remove') {
      opts.passwordCmd = 'clear';
    } else if (sub === 'disable' || sub === 'off' || sub === 'deactivate') {
      opts.passwordCmd = 'disable';
    } else if (sub === 'activate' || sub === 'enable' || sub === 'on') {
      opts.passwordCmd = 'activate';
      opts.passwordVal = argv[2] && !argv[2].startsWith('-') ? argv[2] : '';
    } else if (sub === 'print' || sub === 'show' || sub === 'status' || sub === 'get') {
      opts.passwordCmd = 'print';
    } else {
      opts.help = true;
    }
    return opts;
  }

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--conv' || a === '-c') {
      opts.conv = argv[++i] || '';
      opts.explicitTarget = true;
    } else if (a === '--flavor') opts.flavor = argv[++i] || 'antigravity-cli';
    else if (a === '--file' || a === '-f') {
      opts.file = argv[++i] || '';
      opts.explicitTarget = true;
    } else if (a === '--title' || a === '-t') opts.title = argv[++i] || '';
    else if (a === '--mode' || a === '-m') opts.mode = argv[++i] || 'auto';
    else if (a === '--port' || a === '-p') opts.port = Number(argv[++i]) || 0;
    else if (a === '--host') opts.host = argv[++i] || '';
    else if (a === '--open') {
      opts.open = true;
      opts.explicitOpen = true;
    } else if (a === '--focus') {
      opts.open = true;
      opts.explicitOpen = true;
      opts.focus = true;
    } else if (a === '--no-open') opts.open = false;
    else if (a === '--new-window') opts.newWindow = true;
    else if (a === '--foreground') opts.foreground = true;
    else if (a === '--restart') opts.restart = true;
    else if (a === '--stop') opts.stop = true;
    else if (a === '--status') opts.status = true;
    else if (a === '--update') opts.update = true;
    else if (a === '--stdin') {
      opts.stdin = true;
      opts.explicitTarget = true;
    } else if (a === '--set-password') {
      opts.passwordCmd = 'set';
      opts.passwordVal = argv[++i] || '';
    } else if (a === '--cancel-password' || a === '--clear-password' || a === '--unset-password') {
      opts.passwordCmd = 'clear';
    } else if (a === '--disable-password') {
      opts.passwordCmd = 'disable';
    } else if (a === '--activate-password' || a === '--enable-password') {
      opts.passwordCmd = 'activate';
      if (argv[i + 1] && !argv[i + 1].startsWith('-')) {
        opts.passwordVal = argv[++i];
      }
    } else if (a === '--print-password' || a === '--show-password') {
      opts.passwordCmd = 'print';
    } else if (!a.startsWith('-') && !opts.file) {
      opts.file = a;
      opts.explicitTarget = true;
    }
  }
  return opts;
}

function httpJson(port, path, method = 'GET', body = null, timeoutMs = 1500, cliToken = '') {
  return new Promise((resolveReq, rejectReq) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = {};
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (cliToken) {
      headers['X-Preview-Cli-Token'] = cliToken;
    }
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        timeout: timeoutMs,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          try {
            resolveReq({ status: res.statusCode, data: JSON.parse(text) });
          } catch {
            resolveReq({ status: res.statusCode, data: text });
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error('Request timed out'));
    });
    req.on('error', rejectReq);
    if (payload) req.write(payload);
    req.end();
  });
}

function findPreferredOrFreePort(preferred = DEFAULT_PORT, host = '127.0.0.1') {
  return new Promise((resolvePort, rejectPort) => {
    const tryListen = (portToTry) => {
      const srv = createNetServer();
      srv.unref();
      srv.once('error', (err) => {
        if (portToTry !== 0) {
          tryListen(0);
        } else {
          rejectPort(err);
        }
      });
      srv.listen(portToTry, host, () => {
        const { port } = srv.address();
        srv.close(() => resolvePort(port));
      });
    };
    tryListen(preferred);
  });
}

async function getRunningServer() {
  for (const lockFile of [SERVER_JSON, LEGACY_SERVER_JSON]) {
    if (!existsSync(lockFile)) continue;
    try {
      const info = JSON.parse(readFileSync(lockFile, 'utf-8'));
      if (!info?.port) continue;
      const res = await httpJson(info.port, '/api/health', 'GET', null, 500);
      if (res.status === 200 && res.data?.ok) {
        return {
          ...info,
          clients: res.data.clients || 0,
          authRequired: Boolean(res.data.authRequired),
        };
      }
    } catch {
      // Stale lock file
    }
  }
  return null;
}

async function ensureServerRunning(preferredPort = 0, foreground = false, preferredHost = '') {
  const existing = await getRunningServer();
  if (existing && (!preferredHost || existing.host === preferredHost)) {
    return { ...existing, reused: true };
  }
  if (existing && preferredHost && existing.host !== preferredHost) {
    try { process.kill(existing.pid); } catch {}
    for (const lockFile of [SERVER_JSON, LEGACY_SERVER_JSON]) {
      if (existsSync(lockFile)) rmSync(lockFile, { force: true });
    }
  }

  mkdirSync(RUNTIME_DIR, { recursive: true });
  const bindHost = preferredHost || '127.0.0.1';
  const targetPort = await findPreferredOrFreePort(preferredPort || DEFAULT_PORT, bindHost);

  if (foreground) {
    const { startStandaloneServer } = await import('../server/app.mjs');
    const started = await startStandaloneServer({ port: targetPort, host: bindHost });
    const info = { pid: process.pid, port: started.port, host: bindHost, startedAt: new Date().toISOString() };
    writeFileSync(SERVER_JSON, JSON.stringify(info, null, 2), 'utf-8');
    const cleanup = () => {
      try {
        if (existsSync(SERVER_JSON)) {
          const cur = JSON.parse(readFileSync(SERVER_JSON, 'utf-8'));
          if (cur.pid === process.pid) rmSync(SERVER_JSON, { force: true });
        }
      } catch {}
      started.engine.close();
      process.exit(0);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    return { ...info, clients: 0, reused: false, inProcess: true };
  }

  const logFd = openSync(SERVER_LOG, 'a');
  const spawnArgs = [SERVER_ENTRY, '--port', String(targetPort), '--host', bindHost];
  const child = spawn(process.execPath, spawnArgs, {
    cwd: PLUGIN_ROOT,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  closeSync(logFd);

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const res = await httpJson(targetPort, '/api/health', 'GET', null, 400);
      if (res.status === 200 && res.data?.ok) {
        const info = { pid: child.pid, port: targetPort, host: bindHost, startedAt: new Date().toISOString() };
        writeFileSync(SERVER_JSON, JSON.stringify(info, null, 2), 'utf-8');
        return { ...info, clients: 0, reused: false };
      }
    } catch {
      await new Promise((r) => setTimeout(r, 80));
    }
  }
  throw new Error(`Timed out waiting for preview server on port ${targetPort}`);
}

function findAppBrowser() {
  if (process.platform === 'win32') {
    const candidates = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ];
    return candidates.find((p) => existsSync(p)) || '';
  }
  if (process.platform === 'darwin') {
    const candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
    return candidates.find((p) => existsSync(p)) || '';
  }
  return '';
}

function launchStandaloneWindow(url) {
  const browser = findAppBrowser();
  if (browser) {
    const child = spawn(browser, [`--app=${url}`, '--new-window'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return { launchedWith: browser, mode: 'app-window' };
  }

  if (process.platform === 'win32') {
    const child = spawn('cmd', ['/c', 'start', '', url], {
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    });
    child.unref();
    return { launchedWith: 'default-browser', mode: 'browser' };
  }

  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  const child = spawn(opener, [url], { detached: true, stdio: 'ignore' });
  child.unref();
  return { launchedWith: opener, mode: 'browser' };
}

function readStdinAll() {
  return new Promise((resolveRead) => {
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolveRead(Buffer.concat(chunks).toString('utf-8')));
  });
}

async function handlePasswordCommand(opts, authManager) {
  const cliToken = authManager.getCliToken();
  const notifyRunningServer = async () => {
    const running = await getRunningServer();
    if (running?.port) {
      await httpJson(running.port, '/api/auth/reload', 'POST', {}, 800, cliToken).catch(() => {});
    }
  };

  if (opts.passwordCmd === 'set') {
    const status = authManager.setPassword(opts.passwordVal);
    await notifyRunningServer();
    console.log(JSON.stringify({
      ok: true,
      action: 'set',
      enabled: status.enabled,
      authRequired: status.authRequired,
      message: 'Frontend password set and activated.',
    }, null, 2));
    return;
  }

  if (opts.passwordCmd === 'clear') {
    const status = authManager.clearPassword();
    await notifyRunningServer();
    console.log(JSON.stringify({
      ok: true,
      action: 'cancel',
      enabled: status.enabled,
      hasPassword: status.hasPassword,
      authRequired: status.authRequired,
      message: 'Frontend password canceled and cleared.',
    }, null, 2));
    return;
  }

  if (opts.passwordCmd === 'disable') {
    const status = authManager.disablePassword();
    await notifyRunningServer();
    console.log(JSON.stringify({
      ok: true,
      action: 'disable',
      enabled: status.enabled,
      hasPassword: status.hasPassword,
      authRequired: status.authRequired,
      message: 'Frontend password protection deactivated (stored password retained; use --activate-password to re-enable).',
    }, null, 2));
    return;
  }

  if (opts.passwordCmd === 'activate') {
    const res = authManager.activatePassword(opts.passwordVal);
    await notifyRunningServer();
    console.log(JSON.stringify({
      ok: true,
      action: 'activate',
      enabled: res.enabled,
      authRequired: res.authRequired,
      generated: res.generated,
      password: res.password,
      message: res.generated
        ? 'Generated and activated a new random frontend password.'
        : 'Frontend password protection activated.',
    }, null, 2));
    return;
  }

  if (opts.passwordCmd === 'print') {
    const info = authManager.printPasswordInfo();
    console.log(JSON.stringify({
      ok: true,
      action: 'print',
      enabled: info.enabled,
      hasPassword: info.hasPassword,
      authRequired: info.authRequired,
      password: info.password || '(none)',
      configPath: info.configPath,
    }, null, 2));
  }
}

async function stopRunningServer() {
  const running = await getRunningServer();
  if (running?.pid) {
    try { process.kill(running.pid); } catch {}
  }
  for (const lockFile of [SERVER_JSON, LEGACY_SERVER_JSON]) {
    if (existsSync(lockFile)) rmSync(lockFile, { force: true });
  }
  if (running) await new Promise((r) => setTimeout(r, 200));
  return running;
}

async function startInstalledServer(installRoot, port, host) {
  const entry = join(installRoot, 'server', 'app.mjs');
  const bindHost = host || '127.0.0.1';
  const targetPort = port || DEFAULT_PORT;
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const logFd = openSync(SERVER_LOG, 'a');
  const child = spawn(process.execPath, [entry, '--port', String(targetPort), '--host', bindHost], {
    cwd: installRoot,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  closeSync(logFd);
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const res = await httpJson(targetPort, '/api/health', 'GET', null, 400);
      if (res.status === 200 && res.data?.ok) {
        const info = { pid: child.pid, port: targetPort, host: bindHost, startedAt: new Date().toISOString() };
        writeFileSync(SERVER_JSON, JSON.stringify(info, null, 2), 'utf-8');
        return info;
      }
    } catch {
      await new Promise((r) => setTimeout(r, 80));
    }
  }
  throw new Error(`Updated files are in place, but the preview server did not restart on port ${targetPort}`);
}

async function handleUpdate() {
  const installRoot = defaultInstallRoot();
  let previous = null;
  const result = await runPluginUpdate({
    installRoot,
    onProgress: (message) => console.log(message),
    beforeReplace: async () => {
      previous = await stopRunningServer();
    },
    afterReplace: async () => {
      if (!previous) return;
      await startInstalledServer(installRoot, previous.port, previous.host);
    },
  });
  if (result.action === 'current') {
    console.log(`Session Preview ${result.localVersion} is already the latest release.`);
    return;
  }
  if (result.action === 'ahead') {
    console.log(`Installed Session Preview ${result.localVersion} is newer than the latest release ${result.tag}. Nothing was changed.`);
    return;
  }
  const from = result.localVersion || 'not installed';
  console.log(`Session Preview ${from} → ${result.remoteVersion}`);
  console.log(`Installed to ${result.installRoot}`);
  if (previous) console.log('Restarted the preview server. Refresh the window if it did not reload.');
  else console.log('Run agy-preview to open the updated preview.');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    printHelp();
    return;
  }

  if (opts.update) {
    await handleUpdate();
    return;
  }

  const authManager = new PreviewAuthManager();

  if (opts.passwordCmd) {
    await handlePasswordCommand(opts, authManager);
    return;
  }

  if (opts.stop || opts.restart) {
    const running = await getRunningServer();
    if (running?.pid) {
      try { process.kill(running.pid); } catch {}
    }
    for (const lockFile of [SERVER_JSON, LEGACY_SERVER_JSON]) {
      if (existsSync(lockFile)) rmSync(lockFile, { force: true });
    }
    if (opts.stop) {
      console.log(JSON.stringify({ stopped: true }));
      return;
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  if (opts.status) {
    const running = await getRunningServer();
    const authStatus = authManager.getStatus();
    console.log(JSON.stringify({
      running: Boolean(running),
      ...(running || {}),
      passwordAuth: authStatus,
    }));
    return;
  }

  const cliToken = authManager.getCliToken();
  const serverInfo = await ensureServerRunning(opts.port, opts.foreground, opts.host);

  // `--restart` without explicit `--open` or target restarts the daemon in place without opening/hijacking windows
  if (opts.restart && !opts.explicitOpen && !opts.explicitTarget) {
    const authStatus = authManager.getStatus();
    console.log(JSON.stringify({
      ok: true,
      restarted: true,
      host: serverInfo.host || '127.0.0.1',
      port: serverInfo.port,
      pid: serverInfo.pid,
      authRequired: authStatus.authRequired,
    }));
    return;
  }

  let targetUrl = `http://127.0.0.1:${serverInfo.port}/`;
  const focusPayload = { force: Boolean(opts.focus) };

  if (opts.file) {
    const absFile = resolve(opts.file);
    const created = await httpJson(serverInfo.port, '/api/previews', 'POST', {
      filePath: absFile,
      title: opts.title,
      mode: opts.mode,
    }, 2000, cliToken);
    if (created.status !== 200) {
      throw new Error(created.data?.error || `Failed to load file ${absFile}`);
    }
    targetUrl += `?preview=${encodeURIComponent(created.data.id)}`;
    focusPayload.previewId = created.data.id;
    focusPayload.title = created.data.title || '';
  } else if (opts.stdin || (!process.stdin.isTTY && !opts.conv)) {
    // Progressive live streaming from stdin into Preview UI via SSE
    const streamId = `stdin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const streamTitle = opts.title || 'CLI Stream Output';
    let buffer = '';
    let createdEntry = null;
    let windowOpened = false;
    let windowResultStream = { mode: 'already-open' };
    let flushTimer = null;
    let pushing = false;
    let pendingPush = false;

    const pushBuffer = async () => {
      if (!buffer.trim()) return;
      if (pushing) {
        pendingPush = true;
        return;
      }
      pushing = true;
      try {
        const res = await httpJson(serverInfo.port, '/api/previews', 'POST', {
          id: streamId,
          content: buffer,
          title: streamTitle,
          mode: opts.mode,
        }, 3000, cliToken);
        if (res.status === 200 && res.data) {
          createdEntry = res.data;
          if (!windowOpened && opts.open) {
            windowOpened = true;
            const streamUrl = `http://127.0.0.1:${serverInfo.port}/?preview=${encodeURIComponent(createdEntry.id)}`;
            if (!opts.newWindow && serverInfo.clients > 0) {
              await httpJson(serverInfo.port, '/api/focus', 'POST', {
                previewId: createdEntry.id,
                title: createdEntry.title || streamTitle,
                force: Boolean(opts.focus),
              }, 1500, cliToken).catch(() => {});
              windowResultStream = { mode: opts.focus ? 'focused-existing-window' : 'notified-existing-window', clients: serverInfo.clients };
            } else if (serverInfo.reused) {
              const resp = await httpJson(serverInfo.port, '/api/focus', 'POST', { openWindow: true, url: streamUrl }, 1500, cliToken).catch(() => null);
              windowResultStream = resp?.data?.window || launchStandaloneWindow(streamUrl);
            } else {
              windowResultStream = launchStandaloneWindow(streamUrl);
            }
          }
        }
      } finally {
        pushing = false;
        if (pendingPush) {
          pendingPush = false;
          await pushBuffer();
        }
      }
    };

    await new Promise((resolveStdin) => {
      process.stdin.on('data', (chunk) => {
        buffer += chunk.toString('utf-8');
        if (!createdEntry && buffer.trim()) {
          pushBuffer().catch(() => {});
        } else if (!flushTimer) {
          flushTimer = setTimeout(() => {
            flushTimer = null;
            pushBuffer().catch(() => {});
          }, 180);
        }
      });
      process.stdin.on('end', async () => {
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        await pushBuffer().catch(() => {});
        resolveStdin();
      });
      process.stdin.on('error', () => resolveStdin());
    });

    if (createdEntry) {
      targetUrl += `?preview=${encodeURIComponent(createdEntry.id)}`;
      const authStatus = authManager.getStatus();
      console.log(JSON.stringify({
        ok: true,
        url: targetUrl,
        host: serverInfo.host || '127.0.0.1',
        port: serverInfo.port,
        pid: serverInfo.pid,
        authRequired: authStatus.authRequired,
        window: windowResultStream,
      }));
      return;
    }
  } else if (opts.conv) {
    targetUrl += `?conv=${encodeURIComponent(opts.conv)}&flavor=${encodeURIComponent(opts.flavor)}`;
    focusPayload.conversationId = opts.conv;
    focusPayload.flavor = opts.flavor;
  }

  let windowResult = { mode: 'already-open' };
  if (opts.open) {
    if (!opts.newWindow && serverInfo.clients > 0 && (focusPayload.conversationId || focusPayload.previewId)) {
      await httpJson(serverInfo.port, '/api/focus', 'POST', focusPayload, 1500, cliToken).catch(() => {});
      windowResult = { mode: opts.focus ? 'focused-existing-window' : 'notified-existing-window', clients: serverInfo.clients };
    } else if (serverInfo.reused) {
      const resp = await httpJson(serverInfo.port, '/api/focus', 'POST', { openWindow: true, url: targetUrl }, 1500, cliToken).catch(() => null);
      windowResult = resp?.data?.window || launchStandaloneWindow(targetUrl);
    } else {
      windowResult = launchStandaloneWindow(targetUrl);
    }
  }

  const authStatus = authManager.getStatus();
  const out = {
    ok: true,
    url: targetUrl,
    host: serverInfo.host || '127.0.0.1',
    port: serverInfo.port,
    pid: serverInfo.pid,
    authRequired: authStatus.authRequired,
    window: windowResult,
  };
  if (out.host !== '127.0.0.1' && out.host !== 'localhost' && !authStatus.authRequired) {
    out.securityNotice = 'Server is bound to a non-loopback address without password protection. Run `agy-preview password set <pwd>` to secure remote access.';
  }
  console.log(JSON.stringify(out));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
});
