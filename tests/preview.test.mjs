import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get as httpGet, request as httpRequest } from 'node:http';
import {
  TranscriptReader,
  buildNormalizedView,
  normalizeToolArgs,
  scheduleLabelFromPrompt,
  unquoteToolArg,
} from '../server/transcript.mjs';
import {
  CustomPreviewStore,
  locateDroppedFileOnDisk,
  migrateLegacyDataDirIfNeeded,
  parseRawInput,
  stripAnsi,
} from '../server/custom-preview.mjs';
import { PreviewAuthManager } from '../server/auth.mjs';
import { classifyFile, resolveSafeFilePath, startStandaloneServer } from '../server/app.mjs';
import {
  buildPickerLaunch,
  cleanPickedPath,
  interpretPickerOutput,
  pickerCandidates,
  resolveNativeFilePicker,
  runNativeFilePicker,
} from '../server/file-picker.mjs';
import { createSidebarOrder, noteSidebarRoster, sortGroupsBySidebarOrder } from '../public/js/sidebar-order.js';
import { SavedTurnStore } from '../server/saved-turns.mjs';
import {
  compareVersions,
  decideUpdate,
  runPluginUpdate,
  tagArchiveUrl,
} from '../server/plugin-update.mjs';
import { defaultHeuristicMeasureText, optimizeTableColumnWidths } from '../public/js/table-layout.js';
import { folderShowsUnread, nextConversationReadState } from '../public/js/read-state.js';
import {
  classifyHref,
  computeAdaptiveInlineMermaidSize,
  isCodeFilePath,
  isPreviewableFilePath,
  anchorProbe,
  escapeApproxTildes,
  locateAnchorProbe,
  normalizeAnchorText,
  outlineLeadLabel,
  renderMarkdownHtml,
} from '../public/js/markdown.js';
import { buildBtwSavedTurn, btwForkConversationId, formatPromptPlainText, formatResponsePlainText, formatTurnPlainText, isLongUserPrompt } from '../public/js/transcript-view.js';
import { execFileSync } from 'node:child_process';

test('unquoteToolArg and normalizeToolArgs handle JSON-quoted and plain strings', () => {
  assert.equal(unquoteToolArg('"C:\\\\Users\\\\foo.txt"'), 'C:\\Users\\foo.txt');
  assert.equal(unquoteToolArg('plain-text'), 'plain-text');
  const norm = normalizeToolArgs({ Path: '"src/app.js"', WaitMsBeforeAsync: 5000 });
  assert.equal(norm.Path, 'src/app.js');
  assert.equal(norm.WaitMsBeforeAsync, 5000);
});

test('buildNormalizedView marks intermediate vs final markdown and extracts targetFile + diffs', () => {
  const view = buildNormalizedView([
    {
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      created_at: '2026-11-24T10:00:00Z',
      content: '<USER_REQUEST>\nFix @[train.py]\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\n@[train.py] is a [File]:\nE:\\proj\\train.py\n</ADDITIONAL_METADATA>',
    },
    {
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-11-24T10:00:01Z',
      thinking: 'Inspecting train.py first.',
      content: 'Checking train.py before editing...',
      tool_calls: [
        {
          name: 'edit_file',
          args: { Path: '"E:\\\\proj\\\\train.py"', Target: '"oldLine()"', Replacement: '"newLine()"' },
        },
      ],
    },
    {
      step_index: 2,
      source: 'MODEL',
      type: 'GENERIC',
      status: 'DONE',
      created_at: '2026-11-24T10:00:02Z',
      content: 'Created At: 2026-11-24T10:00:01Z\nCompleted At: 2026-11-24T10:00:03Z\nMade 1 replacement.',
    },
    {
      step_index: 3,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-11-24T10:00:04Z',
      thinking: 'All checks passed.',
      content: 'Updated `train.py` cleanly.',
    },
  ]);

  assert.equal(view.turns.length, 1);
  const turn = view.turns[0];
  assert.equal(turn.user.request, 'Fix @[train.py]');
  assert.equal(turn.user.metadataBlocks.length, 1);

  const mdItems = turn.items.filter((i) => i.kind === 'markdown');
  assert.equal(mdItems.length, 2);
  assert.equal(mdItems[0].intermediate, true);
  assert.equal(mdItems[1].intermediate, false);

  const tg = turn.items.find((i) => i.kind === 'tool_group');
  assert.equal(tg.tools[0].targetFile, 'E:\\proj\\train.py');
  assert.equal(tg.tools[0].diff.before, 'oldLine()');
  assert.equal(tg.tools[0].durationMs, 2000);
  assert.equal(turn.stats.durationMs, 2000);
});

test('classifyHref and isCodeFilePath identify relative docs, Python files, conversation://, anchors, and external links', () => {
  assert.equal(classifyHref('#install').kind, 'anchor');
  assert.equal(classifyHref('https://example.com/a').kind, 'external');
  assert.equal(classifyHref('javascript:alert(1)').kind, 'unsafe');

  const convLink = classifyHref('conversation://fc6930db-d01d-441e-896b-9a9f0f7405f3');
  assert.equal(convLink.kind, 'conversation');
  assert.equal(convLink.convId, 'fc6930db-d01d-441e-896b-9a9f0f7405f3');

  const relDoc = classifyHref('packages/core/README.md');
  assert.equal(relDoc.kind, 'local');
  assert.equal(relDoc.isCode, false);
  assert.equal(relDoc.isPreviewable, true);
  assert.equal(isPreviewableFilePath('assets/diagram.png'), true);
  assert.equal(isPreviewableFilePath('docs/paper.pdf'), true);
  assert.equal(isPreviewableFilePath('rollouts/episode_01.mp4'), true);
  assert.equal(isPreviewableFilePath('audio/narration.mp3'), true);
  assert.equal(isPreviewableFilePath('metrics/ablation.csv'), true);
  assert.equal(isPreviewableFilePath('packages/core'), true);
  assert.equal(isPreviewableFilePath('weights/model.pt'), false);
  assert.equal(isPreviewableFilePath('archive/bundle.zip'), false);

  const pyFile = classifyHref('packages/core/router.py#L10-L25');
  assert.equal(pyFile.kind, 'local');
  assert.equal(pyFile.isCode, true);
  assert.equal(isCodeFilePath('E:\\Projects\\demo\\model.py'), true);
});

test('buildNormalizedView extracts subagentId and computes /context + /usage telemetry', () => {
  const subUuid = '12345678-aaaa-bbbb-cccc-1234567890ab';
  const view = buildNormalizedView([
    { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', content: 'Delegate research' },
    {
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      model: 'gemini-4-carbon-high',
      input_tokens: 4000,
      cache_read_tokens: 96000,
      output_tokens: 1500,
      tool_calls: [{ name: 'invoke_subagent', args: { TypeName: 'research', Role: 'Explorer', Prompt: 'Scan repo' } }],
    },
    {
      step_index: 2,
      source: 'MODEL',
      type: 'GENERIC',
      status: 'DONE',
      content: `Created At: 2026-11-24T10:00:00Z\nCompleted At: 2026-11-24T10:00:01Z\n{"conversationId":"${subUuid}"}`,
    },
  ]);
  const tg = view.turns[0].items.find((i) => i.kind === 'tool_group');
  assert.equal(tg.tools[0].subagentId, subUuid);
  assert.equal(view.summary.contextWindow.model, 'gemini-4-carbon-high');
  assert.equal(view.summary.contextWindow.used, 101500);
  assert.equal(view.summary.modelBreakdown[0].calls, 1);
  assert.equal(view.summary.modelBreakdown[0].totalTokens, 101500);
});

test('resolveSafeFilePath, locateDroppedFileOnDisk, and CustomPreviewStore resolve dropped files, relative links, bare files, and manage docs', () => {
  const root = mkdtempSync(join(tmpdir(), 'amp-rel-'));
  try {
    mkdirSync(join(root, 'engine', 'planner'), { recursive: true });
    const readmeText = '# Aurora Hybrid Search\n[Sub](engine/README.md)\n[Planner](query_planner.py#L10-L20)\n![pic](engine/pic.svg)';
    writeFileSync(join(root, 'README.md'), readmeText);
    writeFileSync(join(root, 'engine', 'README.md'), '# Sub README');
    writeFileSync(join(root, 'engine', 'router.py'), 'print("ok")\n');
    writeFileSync(join(root, 'engine', 'planner', 'query_planner.py'), 'class QueryPlanner:\n    pass\n');
    writeFileSync(join(root, 'engine', 'pic.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');

    // 1. Single-line pasted path auto-loads file and sets baseDir
    const store = new CustomPreviewStore({ persistPath: '' });
    const doc = store.createOrUpdate({ content: `"${join(root, 'README.md')}"` });
    assert.equal(doc.filePath, join(root, 'README.md'));
    assert.equal(doc.baseDir, root);

    // 2. Dragged file without browser filePath resolves true source folder on disk!
    const storeDrop = new CustomPreviewStore({ persistPath: '' });
    const dropped = storeDrop.createOrUpdate({
      title: 'README.md',
      droppedFilename: 'README.md',
      content: readmeText,
      extraRoots: [root],
    });
    assert.equal(locateDroppedFileOnDisk('README.md', readmeText, [root]), join(root, 'README.md'));
    assert.equal(dropped.filePath, join(root, 'README.md'));
    assert.equal(dropped.baseDir, root);

    // 3. Relative link + line anchor resolution
    const resolvedSub = resolveSafeFilePath('engine/router.py#L1-L5', dropped.baseDir);
    assert.equal(resolvedSub.status, 200);
    assert.equal(resolvedSub.resolvedPath, join(root, 'engine', 'router.py'));
    assert.equal(resolvedSub.hashPart, 'L1-L5');

    // 4. Bare filename inside nested project subdirectory (e.g. `query_planner.py#L10-L20`)
    const resolvedBare = resolveSafeFilePath('query_planner.py#L10-L20', dropped.baseDir);
    assert.equal(resolvedBare.status, 200);
    assert.equal(resolvedBare.resolvedPath, join(root, 'engine', 'planner', 'query_planner.py'));
    assert.equal(resolvedBare.hashPart, 'L10-L20');

    // 5. Directory link resolves to README.md inside directory
    const resolvedDir = resolveSafeFilePath('engine', dropped.baseDir);
    assert.equal(resolvedDir.status, 200);
    assert.equal(resolvedDir.resolvedPath, join(root, 'engine', 'README.md'));

    // 6. Docs/Clips management & disk persistence across restarts: excerpt, rename, reorder, delete
    const persistFile = join(root, 'store-data', 'docs-store.json');
    const persistedStore1 = new CustomPreviewStore({ persistPath: persistFile });
    const pDoc1 = persistedStore1.createOrUpdate({ filePath: join(root, 'README.md') });
    const pClip2 = persistedStore1.createOrUpdate({ title: 'Inline Clip', content: '# Saved Inline\nPersists across restarts!' });
    persistedStore1.reorder([pDoc1.id, pClip2.id]);
    persistedStore1.updateMeta(pClip2.id, { title: 'Renamed Inline Clip' });

    // Reload in a brand-new store instance pointing to the same persistPath
    const persistedStore2 = new CustomPreviewStore({ persistPath: persistFile });
    const reloadedList = persistedStore2.list();
    assert.deepEqual(reloadedList.map((x) => x.id), [pDoc1.id, pClip2.id]);
    assert.equal(persistedStore2.get(pClip2.id).title, 'Renamed Inline Clip');
    assert.match(persistedStore2.get(pClip2.id).rawText, /Persists across restarts!/);
    assert.equal(persistedStore2.delete(pClip2.id), true);
    assert.equal(new CustomPreviewStore({ persistPath: persistFile }).list().length, 1);

    // 7. Blocked system path rejected
    const blocked = resolveSafeFilePath('C:\\Windows\\System32\\drivers\\etc\\hosts');
    assert.equal(blocked.status, 403);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('TranscriptReader reads incrementally when JSONL grows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'amp-test-'));
  const file = join(dir, 'transcript_full.jsonl');
  try {
    writeFileSync(
      file,
      JSON.stringify({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', content: 'Hi' }) + '\n'
    );
    const reader = new TranscriptReader();
    const first = reader.read(file);
    assert.equal(first.rawSteps.length, 1);

    appendFileSync(
      file,
      JSON.stringify({ step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', content: 'Hello!' }) + '\n'
    );
    const second = reader.read(file);
    assert.equal(second.rawSteps.length, 2);
    assert.equal(second.view.turns[0].items[0].text, 'Hello!');

    // A /rewind replaces the file head. The replacement can be larger than the
    // cached byte offset, so this must not append onto the pre-rewind steps.
    const rewound = JSON.stringify({
      step_index: 40,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      content: `after rewind ${'x'.repeat(400)}`,
    }) + '\n';
    writeFileSync(file, rewound);
    const third = reader.read(file);
    assert.equal(third.rawSteps.length, 1);
    assert.equal(third.rawSteps[0].step_index, 40);
    assert.match(third.rawSteps[0].content, /^after rewind/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseRawInput strips ANSI and parses stream-json NDJSON cleanly', () => {
  assert.equal(stripAnsi('\x1b[32mOK\x1b[0m done'), 'OK done');

  const ndjson = [
    JSON.stringify({ type: 'user', content: 'Explain X' }),
    JSON.stringify({ type: 'thinking', thinking: 'Step 1...' }),
    JSON.stringify({ type: 'tool_use', name: 'read_file', input: { Path: 'a.md' } }),
    JSON.stringify({ type: 'tool_result', content: 'hello world' }),
    JSON.stringify({ type: 'text', text: '# Heading\n\nAnswer' }),
  ].join('\n');

  const parsed = parseRawInput(ndjson, 'auto', 'Stream Test');
  assert.equal(parsed.mode, 'transcript');
  assert.equal(parsed.view.turns.length, 1);
});

test('Standalone server serves file-info, raw-file images, SSE hook stream, and blocks restricted paths', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'amp-srv-'));
  writeFileSync(join(tmp, 'demo.py'), 'x = 1\ny = 2\n');
  writeFileSync(join(tmp, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>');

  const { server, port, engine } = await startStandaloneServer({
    port: 0,
    storePersistPath: join(tmp, 'docs-store.json'),
    authPersistPath: join(tmp, 'auth-config.json'),
  });
  try {
    // Test Docs/Clips HTTP management routes (POST, PATCH, reorder, DELETE)
    const createRes = await fetch(`http://127.0.0.1:${port}/api/previews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Doc 1', content: '# Hello Doc 1' }),
    });
    assert.equal(createRes.status, 200);
    const createdDoc = await createRes.json();

    const patchRes = await fetch(`http://127.0.0.1:${port}/api/previews/${createdDoc.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Doc 1 Updated', baseDir: tmp }),
    });
    assert.equal(patchRes.status, 200);
    const patchedDoc = await patchRes.json();
    assert.equal(patchedDoc.title, 'Doc 1 Updated');
    assert.equal(patchedDoc.baseDir, tmp);

    const listRes = await fetch(`http://127.0.0.1:${port}/api/previews`);
    const listData = await listRes.json();
    assert.equal(listData.previews.length, 1);
    assert.match(listData.previews[0].excerpt, /Hello Doc 1/);

    const delRes = await fetch(`http://127.0.0.1:${port}/api/previews/${createdDoc.id}`, { method: 'DELETE' });
    assert.equal(delRes.status, 200);

    // Test reveal-in-folder (dryRun) + security check + /btw notes API
    const revOk = await fetch(`http://127.0.0.1:${port}/api/reveal-in-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'demo.py', base: tmp, dryRun: true }),
    });
    assert.equal(revOk.status, 200);
    const revData = await revOk.json();
    assert.equal(revData.folder, tmp);

    const revBlocked = await fetch(`http://127.0.0.1:${port}/api/reveal-in-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'C:\\Windows\\System32\\drivers\\etc\\hosts', dryRun: true }),
    });
    assert.equal(revBlocked.status, 403);

    const btwRes = await fetch(`http://127.0.0.1:${port}/api/conversations/test-conv/btw-notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Where is retry?', answer: 'In `client.ts` line 42.' }),
    });
    assert.equal(btwRes.status, 200);
    const btwData = await btwRes.json();
    assert.equal(btwData.notes.length, 1);
    const fiRes = await fetch(`http://127.0.0.1:${port}/api/file-info?path=${encodeURIComponent('demo.py#L2')}&base=${encodeURIComponent(tmp)}`);
    assert.equal(fiRes.status, 200);
    const fi = await fiRes.json();
    assert.equal(fi.kind, 'code');
    assert.equal(fi.lang, 'python');
    assert.equal(fi.hash, 'L2');
    assert.match(fi.content, /x = 1/);

    const imgRes = await fetch(`http://127.0.0.1:${port}/api/raw-file?path=icon.svg&base=${encodeURIComponent(tmp)}`);
    assert.equal(imgRes.status, 200);
    assert.match(imgRes.headers.get('content-type') || '', /image\/svg\+xml/);

    const unsafeRes = await fetch(`http://127.0.0.1:${port}/api/file-info?path=C:\\Windows\\System32\\drivers\\etc\\hosts`);
    assert.equal(unsafeRes.status, 403);

    const pickerRes = await fetch(`http://127.0.0.1:${port}/api/file-picker`);
    assert.equal(pickerRes.status, 200);
    const pickerInfo = await pickerRes.json();
    assert.equal(typeof pickerInfo.available, 'boolean');
    if (process.platform === 'win32') {
      assert.equal(pickerInfo.available, true);
      assert.equal(pickerInfo.provider, 'powershell');
    } else if (process.platform === 'darwin') {
      assert.equal(pickerInfo.available, true);
      assert.equal(pickerInfo.provider, 'osascript');
    }

    await new Promise((resolveSse, rejectSse) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          rejectSse(new Error('SSE hook event timeout'));
        }
      }, 3000);
      const sseReq = httpGet(`http://127.0.0.1:${port}/api/events?conv=test-conv`, (res) => {
        let buf = '';
        res.on('error', () => {});
        res.on('data', (chunk) => {
          if (settled) return;
          buf += chunk.toString('utf-8');
          if (buf.includes('event: connected') && !buf.includes('__hook_sent__')) {
            buf += '__hook_sent__';
            const postReq = httpRequest(
              {
                hostname: '127.0.0.1',
                port,
                path: '/api/hook-event',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
              },
              (pr) => pr.resume()
            );
            postReq.on('error', () => {});
            postReq.end(JSON.stringify({ conversationId: 'test-conv', hookEventName: 'PreInvocation' }));
          }
          if (buf.includes('event: hook') && buf.includes('"phase":"thinking"')) {
            settled = true;
            clearTimeout(timer);
            res.destroy();
            sseReq.destroy();
            resolveSse();
          }
        });
      });
      sseReq.on('error', (e) => {
        if (!settled && e.code !== 'ECONNRESET') {
          settled = true;
          clearTimeout(timer);
          rejectSse(e);
        }
      });
    });
  } finally {
    engine.close();
    await new Promise((r) => server.close(r));
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('migrateLegacyDataDirIfNeeded copies legacy agy-markdown-preview docs, clips, and btw-notes non-destructively', () => {
  const root = mkdtempSync(join(tmpdir(), 'amp-mig-'));
  try {
    const legacyDir = join(root, 'agy-markdown-preview');
    const targetDir = join(root, 'agy-session-preview');
    mkdirSync(join(legacyDir, 'clips'), { recursive: true });
    writeFileSync(join(legacyDir, 'docs-store.json'), JSON.stringify({ counter: 2, items: [{ id: 'doc-1', title: 'Old' }] }));
    writeFileSync(join(legacyDir, 'clips', 'doc-1.txt'), '# Migrated Clip');
    writeFileSync(join(legacyDir, 'btw-notes.json'), JSON.stringify({ c1: [{ id: 'btw-1', question: 'Q', answer: 'A' }] }));

    assert.equal(migrateLegacyDataDirIfNeeded(targetDir, legacyDir), true);
    assert.equal(existsSync(join(targetDir, 'docs-store.json')), true);
    assert.equal(readFileSync(join(targetDir, 'clips', 'doc-1.txt'), 'utf-8'), '# Migrated Clip');
    assert.match(readFileSync(join(targetDir, 'btw-notes.json'), 'utf-8'), /btw-1/);

    // Subsequent run must not overwrite newer files in targetDir
    writeFileSync(join(targetDir, 'btw-notes.json'), JSON.stringify({ c1: [{ id: 'btw-2', question: 'New', answer: 'B' }] }));
    assert.equal(migrateLegacyDataDirIfNeeded(targetDir, legacyDir), false);
    assert.match(readFileSync(join(targetDir, 'btw-notes.json'), 'utf-8'), /btw-2/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('PreviewAuthManager & CLI password subcommands support set, print, disable, activate, cancel, and HTTP session cookies', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'amp-auth-'));
  const authPath = join(tmp, 'auth-config.json');
  const storePath = join(tmp, 'docs-store.json');

  const cliEntry = join(process.cwd(), 'bin', 'agy-preview.mjs');
  const runCli = (args) => JSON.parse(execFileSync(process.execPath, [cliEntry, ...args], {
    env: { ...process.env, AGY_PREVIEW_DATA_DIR: tmp },
    encoding: 'utf-8',
  }));

  const initialPrint = runCli(['password', 'print']);
  assert.equal(initialPrint.authRequired, false);
  assert.equal(initialPrint.password, '(none)');

  const afterSet = runCli(['--set-password', 'MyServerPass#42']);
  assert.equal(afterSet.enabled, true);
  assert.equal(afterSet.authRequired, true);

  const printed = runCli(['--print-password']);
  assert.equal(printed.password, 'MyServerPass#42');
  assert.equal(printed.authRequired, true);

  const afterDisable = runCli(['password', 'disable']);
  assert.equal(afterDisable.enabled, false);
  assert.equal(afterDisable.hasPassword, true);
  assert.equal(afterDisable.authRequired, false);

  const afterActivate = runCli(['password', 'activate']);
  assert.equal(afterActivate.enabled, true);
  assert.equal(afterActivate.authRequired, true);
  assert.equal(afterActivate.password, 'MyServerPass#42');

  const afterCancel = runCli(['password', 'cancel']);
  assert.equal(afterCancel.enabled, false);
  assert.equal(afterCancel.hasPassword, false);
  assert.equal(afterCancel.authRequired, false);

  const autoGen = runCli(['--activate-password']);
  assert.equal(autoGen.generated, true);
  assert.equal(autoGen.password.length, 12);

  const authMgr = new PreviewAuthManager({ persistPath: authPath });
  authMgr.setPassword('TopSecret99');

  const { server, port, engine } = await startStandaloneServer({
    port: 0,
    storePersistPath: storePath,
    authPersistPath: authPath,
  });

  try {
    const indexRes = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(indexRes.status, 200);
    const statusRes = await fetch(`http://127.0.0.1:${port}/api/auth/status`);
    const statusJson = await statusRes.json();
    assert.equal(statusJson.authRequired, true);
    assert.equal(statusJson.authenticated, false);
    assert.equal('password' in statusJson, false);

    const unauthRes = await fetch(`http://127.0.0.1:${port}/api/previews`);
    assert.equal(unauthRes.status, 401);

    const cliBypassRes = await fetch(`http://127.0.0.1:${port}/api/previews`, {
      headers: { 'X-Preview-Cli-Token': engine.authManager.getCliToken() },
    });
    assert.equal(cliBypassRes.status, 200);

    const badLogin = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' }),
    });
    assert.equal(badLogin.status, 401);

    const okLogin = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'TopSecret99' }),
    });
    assert.equal(okLogin.status, 200);
    const cookieHeader = (okLogin.headers.get('set-cookie') || '').split(';')[0];
    assert.match(cookieHeader, /^amp_session=/);

    const authedRes = await fetch(`http://127.0.0.1:${port}/api/previews`, {
      headers: { Cookie: cookieHeader },
    });
    assert.equal(authedRes.status, 200);
  } finally {
    engine.close();
    await new Promise((r) => server.close(r));
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('Rich media previews (PDF, Video HTTP Range 206, Audio, CSV) and directory reveal work end-to-end', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'amp-media-'));
  const subFolderNoReadme = join(tmp, 'plain-dir');
  mkdirSync(subFolderNoReadme, { recursive: true });
  writeFileSync(join(tmp, 'paper.pdf'), Buffer.from('%PDF-1.7\nfake-pdf-payload'));
  writeFileSync(join(tmp, 'rollout.mp4'), Buffer.from('0123456789ABCDEF'));
  writeFileSync(join(tmp, 'clip.mp3'), Buffer.from('ID3-audio-bytes'));
  writeFileSync(join(tmp, 'bench.csv'), 'model,score\n"Gemini 4",99.2\n');

  assert.equal(classifyFile('paper.pdf').kind, 'pdf');
  assert.equal(classifyFile('rollout.mp4').kind, 'video');
  assert.equal(classifyFile('clip.mp3').kind, 'audio');
  assert.equal(classifyFile('bench.csv').kind, 'csv');

  const { Marked } = await import('marked');
  globalThis.window = { marked: { Marked } };
  const mdHtml = renderMarkdownHtml('![demo](rollout.mp4)\n\n![voice](clip.mp3)', { baseDir: tmp });
  delete globalThis.window;
  assert.match(mdHtml, /<video\b[^>]*class="md-video"/);
  assert.match(mdHtml, /<audio\b[^>]*class="md-audio"/);

  const { server, port, engine } = await startStandaloneServer({
    port: 0,
    storePersistPath: join(tmp, 'docs-store.json'),
    authPersistPath: join(tmp, 'auth-config.json'),
  });

  try {
    const pdfInfo = await (await fetch(`http://127.0.0.1:${port}/api/file-info?path=paper.pdf%23page=3&base=${encodeURIComponent(tmp)}`)).json();
    assert.equal(pdfInfo.kind, 'pdf');
    assert.equal(pdfInfo.hash, 'page=3');
    assert.equal(pdfInfo.content, undefined);

    const pdfDocRes = await fetch(`http://127.0.0.1:${port}/api/previews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: join(tmp, 'paper.pdf') }),
    });
    assert.equal(pdfDocRes.status, 200);
    const pdfDoc = await pdfDocRes.json();
    assert.equal(pdfDoc.parsed.mode, 'media');
    assert.equal(pdfDoc.parsed.mediaKind, 'pdf');
    assert.equal(pdfDoc.rawText, '');

    const rangeRes = await fetch(`http://127.0.0.1:${port}/api/raw-file?path=rollout.mp4&base=${encodeURIComponent(tmp)}`, {
      headers: { Range: 'bytes=4-9' },
    });
    assert.equal(rangeRes.status, 206);
    assert.equal(rangeRes.headers.get('content-range'), 'bytes 4-9/16');
    assert.equal(rangeRes.headers.get('accept-ranges'), 'bytes');
    assert.equal(await rangeRes.text(), '456789');

    const badRangeRes = await fetch(`http://127.0.0.1:${port}/api/raw-file?path=rollout.mp4&base=${encodeURIComponent(tmp)}`, {
      headers: { Range: 'bytes=100-200' },
    });
    assert.equal(badRangeRes.status, 416);

    const dirReveal = await fetch(`http://127.0.0.1:${port}/api/reveal-in-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: subFolderNoReadme, dryRun: true }),
    });
    assert.equal(dirReveal.status, 200);
    const dirRevealJson = await dirReveal.json();
    assert.equal(dirRevealJson.isDirectory, true);
    assert.equal(dirRevealJson.folder, subFolderNoReadme);
  } finally {
    engine.close();
    await new Promise((r) => server.close(r));
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('computeAdaptiveInlineMermaidSize fills horizontal space while guarding extreme aspect ratios', () => {
  // Wide flowchart LR (1450x480) inside 792px column -> fills 100% of available width
  const wide = computeAdaptiveInlineMermaidSize(1450, 480, 792, 900);
  assert.equal(wide.width, 792);
  assert.equal(wide.height, Math.round(480 * (792 / 1450)));

  // Medium diagram (480x260) inside 792px Normal column & 1050px Wide column -> scales up to fill 100% width
  const medNormal = computeAdaptiveInlineMermaidSize(480, 260, 792, 900);
  assert.equal(medNormal.width, 792);
  const medWide = computeAdaptiveInlineMermaidSize(480, 260, 1050, 900);
  assert.equal(medWide.width, 1050);

  // Tiny 2-node diagram (180x50) inside 1050px column -> capped at 2.6x so text stays balanced
  const tiny = computeAdaptiveInlineMermaidSize(180, 50, 1050, 900);
  assert.equal(tiny.width, Math.round(180 * 2.6));

  // Very tall vertical flowchart (360x1000) -> upscaled moderately without 3-screen height explosion
  const tall = computeAdaptiveInlineMermaidSize(360, 1000, 1050, 900);
  assert.ok(tall.width >= 450 && tall.width < 1050);
  assert.ok(tall.height <= 1250);
});

test('Pinned sessions API persists star order and folder-entries API lists directory contents safely', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'amp-pins-'));
  const subDir = join(tmp, 'workspace-a');
  mkdirSync(subDir, { recursive: true });
  writeFileSync(join(subDir, 'notes.md'), '# Notes');
  writeFileSync(join(subDir, 'solver.py'), 'print(1)');

  const { server, port, engine } = await startStandaloneServer({
    port: 0,
    storePersistPath: join(tmp, 'docs-store.json'),
    authPersistPath: join(tmp, 'auth-config.json'),
  });

  try {
    // 1. Pin two sessions and verify LIFO top ordering & disk persistence
    const pin1 = await (await fetch(`http://127.0.0.1:${port}/api/pinned-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'conv-alpha', pinned: true }),
    })).json();
    assert.deepEqual(pin1.pinnedIds, ['conv-alpha']);

    const pin2 = await (await fetch(`http://127.0.0.1:${port}/api/pinned-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'conv-beta', pinned: true }),
    })).json();
    assert.deepEqual(pin2.pinnedIds, ['conv-beta', 'conv-alpha']);

    // Verify GET /api/conversations includes pinnedIds
    const convRes = await (await fetch(`http://127.0.0.1:${port}/api/conversations`)).json();
    assert.deepEqual(convRes.pinnedIds, ['conv-beta', 'conv-alpha']);

    // Unpin conv-alpha
    const unpin = await (await fetch(`http://127.0.0.1:${port}/api/pinned-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'conv-alpha', pinned: false }),
    })).json();
    assert.deepEqual(unpin.pinnedIds, ['conv-beta']);
    assert.equal(existsSync(join(tmp, 'pinned-sessions.json')), true);

    // 2. Folder entries endpoint highlights target file and blocks restricted system paths
    const folderRes = await fetch(
      `http://127.0.0.1:${port}/api/folder-entries?path=${encodeURIComponent(join(subDir, 'solver.py'))}`
    );
    assert.equal(folderRes.status, 200);
    const folderJson = await folderRes.json();
    assert.equal(folderJson.folder, subDir);
    const solverRow = folderJson.entries.find((e) => e.name === 'solver.py');
    assert.ok(solverRow);
    assert.equal(solverRow.isSelected, true);

    const blockedFolder = await fetch(
      `http://127.0.0.1:${port}/api/folder-entries?path=${encodeURIComponent('C:\\Windows\\System32')}`
    );
    assert.equal(blockedFolder.status, 403);
  } finally {
    engine.close();
    await new Promise((r) => server.close(r));
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('buildNormalizedView extracts live update_steps checklist and marks in-flight queued tools as running', () => {
  const steps = [
    { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', content: 'Ship release' },
    {
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      content: 'Updating docs first.',
      tool_calls: [
        {
          name: 'update_steps',
          args: {
            steps: [
              { title: 'Update version & changelog', status: 'in_progress' },
              { title: 'Pack & push tag', status: 'pending' },
            ],
          },
        },
        { name: 'edit_file', args: { Path: 'CHANGELOG.md', Target: 'a', Replacement: 'b' } },
      ],
    },
    // Only update_steps result has arrived so far; edit_file is still executing!
    { step_index: 2, source: 'MODEL', type: 'GENERIC', status: 'DONE', content: 'OK' },
  ];

  const viewMidStep = buildNormalizedView(steps);
  assert.equal(viewMidStep.summary.activeStatus, 'running');
  const turn = viewMidStep.turns[0];
  assert.ok(turn.planSteps);
  assert.equal(turn.planSteps.doneCount, 0);
  assert.equal(turn.planSteps.totalCount, 2);
  assert.equal(turn.planSteps.activeTitle, 'Update version & changelog');
  const tg = turn.items.find((it) => it.kind === 'tool_group');
  assert.equal(tg.tools[0].status, 'done');
  assert.equal(tg.tools[1].status, 'running');

  // Now finish edit_file and emit second update_steps marking step 1 done & step 2 in_progress
  steps.push(
    { step_index: 3, source: 'MODEL', type: 'GENERIC', status: 'DONE', content: 'Edited' },
    {
      step_index: 4,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      content: '',
      tool_calls: [
        {
          name: 'update_steps',
          args: {
            steps: [
              { title: 'Update version & changelog', status: 'done' },
              { title: 'Pack & push tag', status: 'in_progress' },
            ],
          },
        },
      ],
    },
    { step_index: 5, source: 'MODEL', type: 'GENERIC', status: 'DONE', content: 'OK' }
  );

  const viewNext = buildNormalizedView(steps);
  assert.equal(viewNext.turns[0].planSteps.doneCount, 1);
  assert.equal(viewNext.turns[0].planSteps.activeTitle, 'Pack & push tag');
});

test('Live hook events enrich /api/conversations active status and hookState in real time', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'amp-live-conv-'));
  const { server, port, engine } = await startStandaloneServer({
    port: 0,
    storePersistPath: join(tmp, 'docs-store.json'),
    authPersistPath: join(tmp, 'auth-config.json'),
  });

  try {
    const initial = await (await fetch(`http://127.0.0.1:${port}/api/conversations`)).json();
    if (initial.conversations.length > 0) {
      const targetId = initial.conversations[0].id;
      await fetch(`http://127.0.0.1:${port}/api/hook-event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: targetId, hookEventName: 'PreToolUse', toolCall: { name: 'run_command' } }),
      });

      const during = await (await fetch(`http://127.0.0.1:${port}/api/conversations`)).json();
      const activeItem = during.conversations.find((c) => c.id === targetId);
      assert.equal(activeItem.active, true);
      assert.equal(activeItem.hookState?.phase, 'running_tool');
      assert.equal(activeItem.hookState?.toolName, 'run_command');

      await fetch(`http://127.0.0.1:${port}/api/hook-event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: targetId, hookEventName: 'Stop' }),
      });

      const afterStop = await (await fetch(`http://127.0.0.1:${port}/api/conversations`)).json();
      const stoppedItem = afterStop.conversations.find((c) => c.id === targetId);
      assert.equal(stoppedItem.hookState?.phase, 'stopped');
    }
  } finally {
    engine.close();
    await new Promise((r) => server.close(r));
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('Office suite (.docx, .xlsx, .pptx) & custom PDF.js vendor bundles work end-to-end offline', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'amp-office-'));
  const XLSX = (await import('xlsx')).default || (await import('xlsx'));
  const JSZip = (await import('jszip')).default || (await import('jszip'));
  const { APPLE_SPINNER_SVG } = await import('../public/js/doc-viewers.js');

  assert.match(APPLE_SPINNER_SVG, /class="apple-spinner"/);

  // 1. Verify markdown link previewability & server file classification
  for (const rel of ['docs/spec.docx', 'docs/legacy.doc', 'metrics/table.xlsx', 'metrics/old.xls', 'metrics/sheet.ods', 'slides/talk.pptx', 'slides/old.ppt']) {
    assert.equal(isPreviewableFilePath(rel), true, `${rel} should be previewable`);
  }
  assert.equal(classifyFile('spec.docx').kind, 'docx');
  assert.equal(classifyFile('legacy.doc').kind, 'doc');
  assert.equal(classifyFile('table.xlsx').kind, 'xlsx');
  assert.equal(classifyFile('old.xls').kind, 'xlsx');
  assert.equal(classifyFile('sheet.ods').kind, 'xlsx');
  assert.equal(classifyFile('talk.pptx').kind, 'pptx');
  assert.equal(classifyFile('old.ppt').kind, 'pptx');

  // 2. Generate real .xlsx, .docx, and .pptx files in temp directory
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Model', 'Score'],
    ['Antigravity', 99.8],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Benchmarks');
  writeFileSync(join(tmp, 'bench.xlsx'), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));

  const docxZip = new JSZip();
  docxZip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
  docxZip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello Word</w:t></w:r></w:p></w:body></w:document>');
  writeFileSync(join(tmp, 'report.docx'), await docxZip.generateAsync({ type: 'nodebuffer' }));

  const pptxZip = new JSZip();
  pptxZip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
  pptxZip.file('ppt/presentation.xml', '<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldSz cx="12192000" cy="6858000"/></p:presentation>');
  pptxZip.file('ppt/slides/slide1.xml', '<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="8000000" cy="1500000"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>Slide 1 Title</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>');
  writeFileSync(join(tmp, 'deck.pptx'), await pptxZip.generateAsync({ type: 'nodebuffer' }));

  const { server, port, engine } = await startStandaloneServer({
    port: 0,
    storePersistPath: join(tmp, 'docs-store.json'),
    authPersistPath: join(tmp, 'auth-config.json'),
  });

  try {
    // 3. Verify offline vendor bundles are served cleanly
    for (const asset of ['pdf.min.mjs', 'pdf.worker.min.mjs', 'jszip.min.js', 'docx-preview.min.js', 'xlsx.full.min.js']) {
      const vRes = await fetch(`http://127.0.0.1:${port}/vendor/${asset}`, { method: 'HEAD' });
      assert.equal(vRes.status, 200, `/vendor/${asset} must be served offline`);
    }

    // 4. Verify /api/file-info, /api/previews, and /api/raw-file for .docx, .xlsx, .pptx
    for (const [fname, expectedKind, mimeSubstr] of [
      ['report.docx', 'docx', 'wordprocessingml'],
      ['bench.xlsx', 'xlsx', 'spreadsheetml'],
      ['deck.pptx', 'pptx', 'presentationml'],
    ]) {
      const fi = await (await fetch(`http://127.0.0.1:${port}/api/file-info?path=${fname}&base=${encodeURIComponent(tmp)}`)).json();
      assert.equal(fi.kind, expectedKind);
      assert.equal(fi.content, undefined);

      const prevDoc = await (await fetch(`http://127.0.0.1:${port}/api/previews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: join(tmp, fname) }),
      })).json();
      assert.equal(prevDoc.parsed.mode, 'media');
      assert.equal(prevDoc.parsed.mediaKind, expectedKind);
      assert.equal(prevDoc.rawText, '');

      const rawRes = await fetch(`http://127.0.0.1:${port}/api/raw-file?path=${fname}&base=${encodeURIComponent(tmp)}`);
      assert.equal(rawRes.status, 200);
      assert.match(rawRes.headers.get('content-type') || '', new RegExp(mimeSubstr));
    }

    // 5. Verify /api/office-to-pdf security guard on restricted paths
    const blockedConv = await fetch(`http://127.0.0.1:${port}/api/office-to-pdf?path=${encodeURIComponent('C:\\Windows\\System32\\drivers\\etc\\hosts')}`);
    assert.equal(blockedConv.status, 403);

    // 6. Verify multi-candidate named Custom RGB palettes API persists and sanitizes entries
    const putPalRes = await (await fetch(`http://127.0.0.1:${port}/api/custom-palettes`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        palettes: [
          { id: 'custom-nord', name: 'Nord Frost', lightBg: '#f4f7fb', darkBg: '#161b24', accent: '#4c82d6' },
          { id: 'custom-rose', name: 'Warm Rose', lightBg: '#fdf6f7', darkBg: '#1c1316', accent: '#d95b78' },
          { id: 'invalid-id', name: 'Ignored', lightBg: '#ffffff', darkBg: '#000000', accent: '#ff0000' },
        ],
      }),
    })).json();
    assert.equal(putPalRes.ok, true);
    assert.equal(putPalRes.palettes.length, 2);
    assert.equal(putPalRes.palettes[0].name, 'Nord Frost');

    const getPalRes = await (await fetch(`http://127.0.0.1:${port}/api/custom-palettes`)).json();
    assert.equal(getPalRes.palettes.length, 2);
    assert.equal(getPalRes.palettes[1].name, 'Warm Rose');
    assert.equal(existsSync(join(tmp, 'custom-palettes.json')), true);
  } finally {
    engine.close();
    await new Promise((r) => server.close(r));
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('Focus SSE endpoint resolves titles and distinguishes non-intrusive prompt (force: false) vs explicit --focus (force: true)', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'amp-focus-'));
  const { server, port, engine } = await startStandaloneServer({
    port: 0,
    storePersistPath: join(tmp, 'docs-store.json'),
    authPersistPath: join(tmp, 'auth-config.json'),
  });

  try {
    // 1. CLI --help exposes --focus flag and bilingual i18n keys exist
    const cliHelp = execFileSync(process.execPath, [join(process.cwd(), 'bin', 'agy-preview.mjs'), '--help'], {
      encoding: 'utf-8',
    });
    assert.match(cliHelp, /--focus\b/);
    assert.match(cliHelp, /--restart\b/);

    const { setLang, t } = await import('../public/js/i18n.js');
    setLang('en');
    assert.match(t('focusPromptDoc', { title: 'Spec.md' }), /Spec\.md/);
    assert.equal(t('focusSwitchBtn'), 'Switch');
    setLang('zh');
    assert.match(t('focusPromptSession', { title: '调试任务' }), /调试任务/);
    assert.equal(t('focusSwitchBtn'), '切换查看');
    setLang('en');

    // 2. Create a custom preview doc and verify SSE focus event resolves title & force flag
    const createdDoc = await (await fetch(`http://127.0.0.1:${port}/api/previews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Architecture Notes', content: '# Arch' }),
    })).json();

    const receivedFocusEvents = [];
    await new Promise((resolveSse, rejectSse) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          rejectSse(new Error('SSE focus event timeout'));
        }
      }, 3000);

      const sseReq = httpGet(`http://127.0.0.1:${port}/api/events?preview=${encodeURIComponent(createdDoc.id)}`, (res) => {
        let buf = '';
        res.on('error', () => {});
        res.on('data', async (chunk) => {
          if (settled) return;
          buf += chunk.toString('utf-8');
          if (buf.includes('event: connected') && !buf.includes('__focus_triggered__')) {
            buf += '__focus_triggered__';
            await fetch(`http://127.0.0.1:${port}/api/focus`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ previewId: createdDoc.id }),
            });
            await fetch(`http://127.0.0.1:${port}/api/focus`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ conversationId: 'abcdef12-3456-7890', force: true }),
            });
          }
          const matches = [...buf.matchAll(/event: focus\ndata: ([^\n]+)\n/g)];
          if (matches.length >= 2) {
            for (const m of matches) {
              receivedFocusEvents.push(JSON.parse(m[1]));
            }
            settled = true;
            clearTimeout(timer);
            res.destroy();
            sseReq.destroy();
            resolveSse();
          }
        });
      });
      sseReq.on('error', (e) => {
        if (!settled && e.code !== 'ECONNRESET') {
          settled = true;
          clearTimeout(timer);
          rejectSse(e);
        }
      });
    });

    assert.equal(receivedFocusEvents.length, 2);
    assert.equal(receivedFocusEvents[0].previewId, createdDoc.id);
    assert.equal(receivedFocusEvents[0].title, 'Architecture Notes');
    assert.equal(receivedFocusEvents[0].force, false);

    assert.equal(receivedFocusEvents[1].conversationId, 'abcdef12-3456-7890');
    assert.match(receivedFocusEvents[1].title, /abcdef12/);
    assert.equal(receivedFocusEvents[1].force, true);
  } finally {
    engine.close();
    await new Promise((r) => server.close(r));
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('buildNormalizedView surfaces ask_question and exit_plan_mode as waiting_decision while pending and parses multi-question answers when resolved', async () => {
  const steps = [
    {
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      created_at: '2026-11-26T02:50:00Z',
      content: 'Provision GPU and launch fine-tuning',
    },
    {
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-11-26T02:52:32Z',
      thinking: 'A100 returned 503; asking user which GPU and task subset to run.',
      content: 'A100 is temporarily out of stock in the current region. Please choose a fallback GPU:',
      tool_calls: [
        {
          name: 'ask_question',
          args: {
            questions: [
              {
                question: 'How would you like to switch GPUs?',
                options: [
                  '(Recommended) Request single H100 (80GB HBM3)',
                  'Request single G4 (96GB GDDR7)',
                ],
                is_multi_select: false,
              },
              {
                question: 'Confirm the training task scope:',
                options: [
                  '(Recommended) RoboTwin 2.0 3 tasks',
                  'LIBERO + RoboTwin 2 tasks',
                ],
                is_multi_select: false,
              },
            ],
          },
        },
      ],
    },
  ];

  // 1. While waiting for user response: must be waiting_decision (never stuck as generic running!)
  const waitingView = buildNormalizedView(steps);
  assert.equal(waitingView.summary.activeStatus, 'waiting_decision');
  assert.ok(waitingView.summary.pendingDecision);
  assert.equal(waitingView.summary.pendingDecision.decisionType, 'ask_question');
  assert.equal(waitingView.summary.pendingDecision.questionCount, 2);
  assert.match(waitingView.summary.pendingDecision.title, /switch GPUs/);

  const turnWaiting = waitingView.turns[0];
  const leadMd = turnWaiting.items.find((it) => it.kind === 'markdown');
  assert.equal(leadMd.intermediate, false, 'Markdown paired with ask_question must remain visible outside Execution process');

  const decWaiting = turnWaiting.items.find((it) => it.kind === 'decision');
  assert.ok(decWaiting);
  assert.equal(decWaiting.status, 'waiting');
  assert.equal(decWaiting.questions.length, 2);

  // 2. User submits answers (GENERIC step) and agent continues with another tool call in the same turn
  steps.push({
    step_index: 2,
    source: 'MODEL',
    type: 'GENERIC',
    status: 'DONE',
    created_at: '2026-11-26T02:52:51Z',
    content: 'Created At: 2026-11-26T10:52:51+08:00\nCompleted At: 2026-11-26T10:55:22+08:00\nA1: (Recommended) Request single H100 (80GB HBM3)\nA2: LIBERO + RoboTwin 2 tasks',
  });

  const answeredView = buildNormalizedView(steps);
  assert.equal(answeredView.summary.activeStatus, 'idle');
  assert.equal(answeredView.summary.pendingDecision, null);
  const decAnswered = answeredView.turns[0].items.find((it) => it.kind === 'decision');
  assert.equal(decAnswered.status, 'answered');
  assert.equal(decAnswered.durationMs, 151000);
  assert.equal(decAnswered.answers[1], '(Recommended) Request single H100 (80GB HBM3)');
  assert.equal(decAnswered.answers[2], 'LIBERO + RoboTwin 2 tasks');

  // 3. Even if further tool calls run later in the same turn, leadMd before ask_question stays visible
  steps.push({
    step_index: 3,
    source: 'MODEL',
    type: 'PLANNER_RESPONSE',
    status: 'DONE',
    created_at: '2026-11-26T02:55:23Z',
    tool_calls: [{ name: 'exit_plan_mode', args: { plan: '# Rollout Plan\n\n- Step A\n- Step B' } }],
  });

  const planWaitingView = buildNormalizedView(steps);
  assert.equal(planWaitingView.summary.activeStatus, 'waiting_decision');
  assert.equal(planWaitingView.summary.pendingDecision.decisionType, 'approve_plan');
  assert.equal(planWaitingView.summary.pendingDecision.title, 'Rollout Plan');
  assert.equal(planWaitingView.turns[0].items.find((it) => it.kind === 'markdown').intermediate, false);

  const { setLang, t } = await import('../public/js/i18n.js');
  setLang('zh');
  assert.match(t('waitingDecisionPhase'), /等待/);
  assert.match(t('decisionRequiredTitle'), /决策/);
  setLang('en');
});

test('Interrupted turns mark unexecuted queued tools as canceled, invalidate TranscriptReader cache on stop, and use non-streaming execution copy', async () => {
  const { TranscriptReader } = await import('../server/transcript.mjs');
  const { setLang, t } = await import('../public/js/i18n.js');

  // 1. Verify bilingual execution & live command output labels avoid conflicting "streaming / 流式" terminology
  setLang('en');
  assert.doesNotMatch(t('streamingBadge'), /stream/i);
  assert.doesNotMatch(t('liveTaskOutputLabel'), /stream/i);
  assert.match(t('interruptedPrefix'), /interrupted/i);
  assert.match(t('turnInterruptedNotice'), /interrupted/i);
  assert.match(t('collapseSidebarTip'), /Collapse Sidebar/);
  assert.match(t('expandSidebarTip'), /Expand Sidebar/);

  setLang('zh');
  assert.doesNotMatch(t('streamingBadge'), /流式/);
  assert.doesNotMatch(t('liveTaskOutputLabel'), /流式/);
  assert.match(t('interruptedPrefix'), /中断/);
  assert.match(t('canceledPill'), /中断/);
  assert.match(t('turnInterruptedNotice'), /中断/);
  assert.match(t('collapseSidebarTip'), /收起侧边/);
  assert.match(t('expandSidebarTip'), /展开侧边/);
  setLang('en');

  // Verify left-sidebar collapse button replaces static "S" badge and pairs with topbar expand button
  const indexHtml = readFileSync(join(process.cwd(), 'public', 'index.html'), 'utf-8');
  assert.match(indexHtml, /id="sidebar-collapse-btn"/);
  assert.match(indexHtml, /id="sidebar-toggle-btn"/);
  assert.doesNotMatch(indexHtml, /<span class="brand-dot">S<\/span>/);
  const stylesCss = readFileSync(join(process.cwd(), 'public', 'styles.css'), 'utf-8');
  assert.match(stylesCss, /\.sidebar:not\(\.collapsed\)\s*~\s*\.main-workspace\s+#sidebar-toggle-btn/);

  // 2. Simulate a multi-tool batch interrupted after 3 of 5 tools complete (mirrors Google AI Ultra Colab Guide)
  const steps = [
    {
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      created_at: '2026-11-26T02:32:00Z',
      content: 'Check remote Colab GPU quota and plan fine-tuning',
    },
    {
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-11-26T02:33:06Z',
      thinking: 'Checking Colab config and searching docs.',
      content: '',
      tool_calls: [
        { name: 'read_file', args: { Path: 'colab.json' } },
        { name: 'read_file', args: { Path: 'train.py' } },
        { name: 'run_command', args: { CommandLine: 'colab status', toolSummary: 'Check Colab status' } },
        { name: 'search_web', args: { query: 'LIBERO fine-tuning' } },
        { name: 'search_web', args: { query: 'RoboTwin 2.0 tasks' } },
      ],
    },
    { step_index: 2, source: 'MODEL', type: 'GENERIC', status: 'DONE', content: '{"tier":"ultra"}' },
    { step_index: 3, source: 'MODEL', type: 'GENERIC', status: 'DONE', content: 'def main(): pass' },
    { step_index: 4, source: 'MODEL', type: 'GENERIC', status: 'DONE', content: 'Connected: A100' },
  ];

  // While live, unconsumed tools are running
  const liveView = buildNormalizedView(steps, { sessionStopped: false });
  assert.equal(liveView.summary.activeStatus, 'running');
  assert.equal(Boolean(liveView.turns[0].interrupted), false);
  const liveTools = liveView.turns[0].items.find((it) => it.kind === 'tool_group').tools;
  assert.deepEqual(liveTools.map((tl) => tl.status), ['done', 'done', 'done', 'running', 'running']);

  // Once session stops / user cancels, unexecuted tools flip to canceled and turn is marked interrupted
  const stoppedView = buildNormalizedView(steps, { sessionStopped: true, userCanceled: true });
  assert.equal(stoppedView.summary.activeStatus, 'canceled');
  assert.equal(stoppedView.summary.pendingDecision, null);
  assert.equal(stoppedView.turns[0].interrupted, true);
  const stoppedTools = stoppedView.turns[0].items.find((it) => it.kind === 'tool_group').tools;
  assert.deepEqual(stoppedTools.map((tl) => tl.status), ['done', 'done', 'done', 'canceled', 'canceled']);

  // 3. TranscriptReader must recompute cached view when sessionStopped flips even though file size/mtime did not change
  const tmp = mkdtempSync(join(tmpdir(), 'amp-canceled-'));
  try {
    const tPath = join(tmp, 'transcript_full.jsonl');
    writeFileSync(tPath, `${steps.map((s) => JSON.stringify(s)).join('\n')}\n`, 'utf-8');
    const reader = new TranscriptReader();

    const firstRead = reader.read(tPath, { sessionStopped: false });
    assert.equal(firstRead.view.summary.activeStatus, 'running');

    const secondRead = reader.read(tPath, { sessionStopped: true, userCanceled: true });
    assert.equal(secondRead.view.summary.activeStatus, 'canceled');
    assert.equal(secondRead.view.turns[0].interrupted, true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  // 4. If user starts a follow-up turn after an interrupted turn, Turn #1 stays marked interrupted/canceled
  const continuedSteps = [
    ...steps,
    {
      step_index: 5,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      created_at: '2026-11-26T02:35:00Z',
      content: 'Switch to 2 tasks only',
    },
    {
      step_index: 6,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-11-26T02:35:10Z',
      content: 'Here is the updated 2-task plan.',
    },
  ];
  const continuedView = buildNormalizedView(continuedSteps, { sessionStopped: true });
  assert.equal(continuedView.summary.activeStatus, 'idle');
  assert.equal(continuedView.turns[0].interrupted, true);
  assert.deepEqual(
    continuedView.turns[0].items.find((it) => it.kind === 'tool_group').tools.map((tl) => tl.status),
    ['done', 'done', 'done', 'canceled', 'canceled']
  );
  assert.equal(Boolean(continuedView.turns[1].interrupted), false);
});

test('viewport anchor phrase survives rendered and source text', () => {
  const rendered = 'step 3000 (17 ep, loss=0.0012) 40.0% → step 5999 (34 ep, loss=0.0003) 75.0%';
  const at = rendered.indexOf('40.0%');
  const probe = anchorProbe(rendered, at + 2);
  assert.match(probe, /40\.0%/);
  assert.match(probe, /step 5999/);
  const source = '（~17 ep, `loss=0.0012`）**40.0%** → `step 5999`（~34 ep, `loss=0.0003`）**75.0%**';
  const found = locateAnchorProbe(normalizeAnchorText(source), probe);
  assert.ok(found >= 0);
  assert.equal(normalizeAnchorText(source).slice(found, found + 5), '40.0%');
});

test('approximation tildes stay literal and only ~~text~~ is strikethrough', () => {
  assert.equal(escapeApproxTildes('~17 ep, ~34 ep'), '\\~17 ep, \\~34 ep');
  assert.equal(escapeApproxTildes('keep ~~gone~~'), 'keep ~~gone~~');
  assert.equal(escapeApproxTildes('already \\~17'), 'already \\~17');

  const code = readFileSync(new URL('../public/vendor/marked.min.js', import.meta.url), 'utf8');
  const sandbox = { console, module: { exports: {} }, exports: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(code, sandbox, { filename: 'marked.min.js' });
  const markedApi = sandbox.module.exports;
  globalThis.window = { marked: markedApi.marked ? markedApi : markedApi };

  const html = renderMarkdownHtml('`step 3000`（~17 ep, `loss=0.0012`）**40.0%** → `step 5999`（~34 ep, `loss=0.0003`）**75.0%**');
  assert.equal(html.includes('<del>'), false);
  assert.match(html, /~17 ep/);
  assert.match(html, /40\.0%/);
  assert.match(html, /~34 ep/);

  const struck = renderMarkdownHtml('keep ~~gone~~ please');
  assert.match(struck, /<del>gone<\/del>/);
});

test('outlineLeadLabel uses the opening words when prose has no heading', () => {
  assert.equal(outlineLeadLabel(''), '');
  assert.equal(outlineLeadLabel('   '), '');
  assert.equal(outlineLeadLabel('Ship it'), 'Ship it');
  assert.equal(outlineLeadLabel('发布完成。'), '发布完成');

  const chinese = outlineLeadLabel('已完成本版本同步、提交推送与 v0.4.1 Release 发布：后续还有说明');
  assert.equal(chinese, '已完成本版本同步、提交推送与…');

  const english = outlineLeadLabel('Please review the navigation fallback for unstructured replies today');
  assert.equal(english, 'Please review the navigation…');
});

test('formatTurnPlainText copies the user request and final model reply, and long prompts fold', () => {
  assert.equal(isLongUserPrompt('短问题'), false);
  assert.equal(isLongUserPrompt('x'.repeat(223)), false);
  assert.equal(isLongUserPrompt('line\n'.repeat(76)), true);
  assert.equal(isLongUserPrompt('x'.repeat(500)), true);

  const text = formatTurnPlainText({
    index: 9,
    user: { request: '第一行\n第二行' },
    items: [
      { kind: 'markdown', intermediate: true, text: 'intermediate tool chatter' },
      { kind: 'markdown', intermediate: false, text: '最终回复' },
      {
        kind: 'decision',
        decisionType: 'ask_question',
        questions: [{ question: '继续吗？', options: ['是', '否'] }],
        rawAnswer: '',
      },
    ],
  }, { userLabel: 'You · Turn #9', modelLabel: 'Assistant' });

  assert.match(text, /^You · Turn #9\n\n第一行\n第二行/);
  assert.equal(text.includes('intermediate tool chatter'), false);
  assert.match(text, /Assistant\n\n最终回复/);
  assert.match(text, /继续吗？\n- 是\n- 否/);

  const turn = {
    user: { request: '第一行\n第二行' },
    items: [
      { kind: 'markdown', intermediate: true, text: 'intermediate tool chatter' },
      { kind: 'markdown', intermediate: false, text: '最终回复' },
    ],
  };
  assert.equal(formatPromptPlainText(turn), '第一行\n第二行');
  assert.equal(formatResponsePlainText(turn), '最终回复');
  assert.equal(formatResponsePlainText({ user: { request: 'only prompt' }, items: [] }), '');
});

test('buildNormalizedView gives each /schedule wakeup its own turn', () => {
  assert.equal(scheduleLabelFromPrompt('[定时巡检 #2 / +11h] 再检查', 9), '定时巡检 #2');
  assert.equal(scheduleLabelFromPrompt('check the GPU', 3), '定时巡检 #3');

  const prompt1 = '[定时巡检 #1 / +1h] 检查训练';
  const prompt2 = '[定时巡检 #2 / +11h] 再检查一次';
  const steps = [
    {
      step_index: 1,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      created_at: '2026-11-26T09:00:00Z',
      content: '<USER_REQUEST>请你过 1 小时检查训练</USER_REQUEST>',
    },
    {
      step_index: 2,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-11-26T09:00:01Z',
      thinking: 'Set two timers.',
      content: '',
      tool_calls: [
        { name: 'schedule', args: { DurationSeconds: '3600', Prompt: prompt1 } },
        { name: 'schedule', args: { DurationSeconds: '39600', Prompt: prompt2 } },
      ],
    },
    {
      step_index: 3,
      source: 'MODEL',
      type: 'GENERIC',
      status: 'DONE',
      created_at: '2026-11-26T09:00:02Z',
      content: 'Tool is running as a background task with task id: conv/task-11\nTask Description: Timer: 1h, Prompt: [定时巡检 #1 / +1h] 检查训练',
    },
    {
      step_index: 4,
      source: 'MODEL',
      type: 'GENERIC',
      status: 'DONE',
      created_at: '2026-11-26T09:00:02Z',
      content: 'Tool is running as a background task with task id: conv/task-12\nTask Description: Timer: 11h, Prompt: [定时巡检 #2 / +11h] 再检查一次',
    },
    {
      step_index: 5,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-11-26T09:00:03Z',
      content: '两次定时巡检已设好',
    },
    {
      step_index: 6,
      source: 'SYSTEM',
      type: 'SYSTEM_MESSAGE',
      status: 'DONE',
      created_at: '2026-11-26T10:00:00Z',
      content: `The following is a <SYSTEM_MESSAGE> not actually sent by the user.\n\n<SYSTEM_MESSAGE>\n[Message] timestamp=2026-11-26T10:00:00Z sender=conv/task-11 priority=MESSAGE_PRIORITY_HIGH content=${prompt1}\n</SYSTEM_MESSAGE>`,
    },
    {
      step_index: 7,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-11-26T10:00:01Z',
      thinking: 'Checking now.',
      content: '正在拉取第 1 次巡检',
      tool_calls: [{ name: 'run_command', args: { CommandLine: 'colab sessions' } }],
    },
    {
      step_index: 8,
      source: 'MODEL',
      type: 'GENERIC',
      status: 'DONE',
      created_at: '2026-11-26T10:00:02Z',
      content: 'Command exited with code 0.\nCommand output:\nok',
    },
    {
      step_index: 9,
      source: 'SYSTEM',
      type: 'SYSTEM_MESSAGE',
      status: 'DONE',
      created_at: '2026-11-26T10:00:03Z',
      content: '<SYSTEM_MESSAGE>\nTask id "conv/task-11" finished with result: Command exited with code 0.\n</SYSTEM_MESSAGE>',
    },
    {
      step_index: 10,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-11-26T10:00:04Z',
      content: '### 定时巡检 #1 状态汇报\n\n一切正常',
    },
    {
      step_index: 11,
      source: 'SYSTEM',
      type: 'SYSTEM_MESSAGE',
      status: 'DONE',
      created_at: '2026-11-26T20:00:00Z',
      content: `<SYSTEM_MESSAGE>\n[Message] timestamp=2026-11-26T20:00:00Z sender=conv/task-12 priority=MESSAGE_PRIORITY_HIGH content=${prompt2}\n</SYSTEM_MESSAGE>`,
    },
    {
      step_index: 12,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-11-26T20:00:04Z',
      content: '### 定时巡检 #2 状态汇报\n\nTask 1 已完成',
    },
  ];

  const view = buildNormalizedView(steps);
  assert.equal(view.turns.length, 3);
  assert.equal(view.turns[0].index, 1);
  assert.equal(view.turns[0].kind, undefined);
  assert.equal(view.turns[0].user.request, '请你过 1 小时检查训练');
  const setupMd = view.turns[0].items.filter((item) => item.kind === 'markdown');
  assert.equal(setupMd.at(-1).intermediate, false);
  assert.match(setupMd.at(-1).text, /已设好/);

  assert.equal(view.turns[1].kind, 'schedule');
  assert.equal(view.turns[1].scheduleLabel, '定时巡检 #1');
  assert.equal(view.turns[1].user.request, prompt1);
  const report1 = view.turns[1].items.filter((item) => item.kind === 'markdown');
  assert.equal(report1[0].intermediate, true);
  assert.equal(report1[1].intermediate, false);
  assert.match(report1[1].text, /状态汇报/);
  assert.equal(view.turns[1].items.some((item) => item.kind === 'system' && /定时巡检 #1/.test(item.text)), false);
  assert.equal(view.turns[1].items.some((item) => item.kind === 'system' && /finished with result/.test(item.text)), true);

  assert.equal(view.turns[2].kind, 'schedule');
  assert.equal(view.turns[2].scheduleLabel, '定时巡检 #2');
  assert.equal(view.turns[2].items.find((item) => item.kind === 'markdown').intermediate, false);

  const followed = buildNormalizedView([
    ...steps,
    {
      step_index: 13,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      created_at: '2026-11-26T21:00:00Z',
      content: '<USER_REQUEST>收敛情况怎么样了</USER_REQUEST>',
    },
    {
      step_index: 14,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-11-26T21:00:01Z',
      content: '收敛正常',
    },
  ]);
  assert.equal(followed.turns[3].index, 2);
  assert.equal(followed.turns[3].kind, undefined);
  assert.equal(followed.turns[3].user.request, '收敛情况怎么样了');
  assert.equal(followed.turns[3].items.find((item) => item.kind === 'markdown').intermediate, false);

  const orphan = buildNormalizedView([
    {
      step_index: 1,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      created_at: '2026-11-26T09:00:00Z',
      content: '<USER_REQUEST>看看进度</USER_REQUEST>',
    },
    {
      step_index: 2,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-11-26T09:00:01Z',
      content: '进度正常',
    },
    {
      step_index: 3,
      source: 'SYSTEM',
      type: 'SYSTEM_MESSAGE',
      status: 'DONE',
      created_at: '2026-11-26T18:00:00Z',
      content: '<SYSTEM_MESSAGE>\n[Message] sender=conv/task-9 priority=MESSAGE_PRIORITY_HIGH content=[定时巡检 #4 / +16h] 晨间汇总\n</SYSTEM_MESSAGE>',
    },
    {
      step_index: 4,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-11-26T18:00:04Z',
      content: '晨间汇总：已完成',
    },
  ]);
  assert.equal(orphan.turns.length, 2);
  assert.equal(orphan.turns[0].items.find((item) => item.kind === 'markdown').intermediate, false);
  assert.equal(orphan.turns[1].scheduleLabel, '定时巡检 #4');
  assert.equal(orphan.turns[1].user.request, '[定时巡检 #4 / +16h] 晨间汇总');
});

function sidebarGroup(key, sessions) {
  const latestUpdatedAt = sessions.reduce((max, item) => Math.max(max, item.updatedAt || 0), 0);
  return { key, label: key, latestUpdatedAt, items: sessions.map((item) => ({ ...item })) };
}

function sidebarKeys(groups, order) {
  return sortGroupsBySidebarOrder(groups, order).map((group) => ({
    key: group.key,
    ids: group.items.map((item) => item.id),
  }));
}

test('sidebar order stays fixed after open and new projects insert at the top', () => {
  const order = createSidebarOrder();
  const opened = [
    sidebarGroup('A', [{ id: 'x', updatedAt: 300 }, { id: 'x2', updatedAt: 100 }]),
    sidebarGroup('B', [{ id: 'y', updatedAt: 200 }]),
    sidebarGroup('Unassigned', [{ id: 'u', updatedAt: 9999 }]),
  ];
  noteSidebarRoster(opened, order);
  assert.deepEqual(sidebarKeys(opened, order), [
    { key: 'A', ids: ['x', 'x2'] },
    { key: 'B', ids: ['y'] },
    { key: 'Unassigned', ids: ['u'] },
  ]);

  const racing = [
    sidebarGroup('B', [{ id: 'y', updatedAt: 5000 }]),
    sidebarGroup('A', [{ id: 'x2', updatedAt: 4000 }, { id: 'x', updatedAt: 300 }]),
    sidebarGroup('Unassigned', [{ id: 'u', updatedAt: 9999 }]),
  ];
  noteSidebarRoster(racing, order);
  assert.deepEqual(sidebarKeys(racing, order), [
    { key: 'A', ids: ['x', 'x2'] },
    { key: 'B', ids: ['y'] },
    { key: 'Unassigned', ids: ['u'] },
  ]);

  const withNewProject = [
    ...racing,
    sidebarGroup('C', [{ id: 'z', updatedAt: 1 }]),
  ];
  noteSidebarRoster(withNewProject, order);
  assert.deepEqual(sidebarKeys(withNewProject, order).map((group) => group.key), ['C', 'A', 'B', 'Unassigned']);

  const withNewSession = [
    sidebarGroup('C', [{ id: 'z', updatedAt: 1 }]),
    sidebarGroup('A', [{ id: 'x3', updatedAt: 8000 }, { id: 'x', updatedAt: 300 }, { id: 'x2', updatedAt: 4000 }]),
    sidebarGroup('B', [{ id: 'y', updatedAt: 5000 }]),
    sidebarGroup('Unassigned', [{ id: 'u', updatedAt: 9999 }]),
  ];
  noteSidebarRoster(withNewSession, order);
  assert.deepEqual(sidebarKeys(withNewSession, order), [
    { key: 'C', ids: ['z'] },
    { key: 'A', ids: ['x', 'x2', 'x3'] },
    { key: 'B', ids: ['y'] },
    { key: 'Unassigned', ids: ['u'] },
  ]);

  noteSidebarRoster([], order);
  assert.deepEqual(order.projects, ['C', 'A', 'B', 'Unassigned']);
});

test('reading a session clears it, and a finished run does not light the project again', () => {
  const now = 1_700_000_000_000;
  const watched = nextConversationReadState({
    steps: 852,
    running: true,
    viewed: true,
    prevSeen: 800,
    wasUnread: true,
    now,
  });
  assert.equal(watched.unread, false);
  assert.equal(watched.seen, 852);
  assert.equal(watched.trackRunning, true);

  const stoppedAfterReading = nextConversationReadState({
    steps: 852,
    running: false,
    viewed: false,
    wasRunning: true,
    prevSeen: watched.seen,
    wasUnread: false,
    now,
  });
  assert.equal(stoppedAfterReading.unread, false);
  assert.equal(stoppedAfterReading.seen, 852);

  const grewAfterLeaving = nextConversationReadState({
    steps: 860,
    running: false,
    viewed: false,
    wasRunning: true,
    prevSeen: 852,
    wasUnread: false,
    now,
  });
  assert.equal(grewAfterLeaving.unread, true);
  assert.equal(grewAfterLeaving.seen, 852);

  const staleBadge = nextConversationReadState({
    steps: 498,
    running: false,
    viewed: false,
    wasRunning: false,
    prevSeen: 498,
    wasUnread: true,
    now,
  });
  assert.equal(staleBadge.unread, false);

  const fresh = nextConversationReadState({
    steps: 12,
    running: false,
    viewed: false,
    prevSeen: undefined,
    wasUnread: false,
    updatedAt: now - 60_000,
    now,
  });
  assert.equal(fresh.unread, true);
  assert.equal(fresh.seen, 0);
  const freshStillUnread = nextConversationReadState({
    steps: 12,
    running: false,
    viewed: false,
    prevSeen: fresh.seen,
    wasUnread: true,
    updatedAt: now - 60_000,
    now,
  });
  assert.equal(freshStillUnread.unread, true);
  assert.equal(freshStillUnread.seen, 0);

  const oldArrival = nextConversationReadState({
    steps: 40,
    running: false,
    viewed: false,
    prevSeen: undefined,
    wasUnread: false,
    updatedAt: now - 6 * 60 * 1000,
    now,
  });
  assert.equal(oldArrival.unread, false);
  assert.equal(oldArrival.seen, 40);
});

test('project highlight follows visible sessions, not hidden older ones or collapsed subagents', () => {
  const unreadIds = new Set(['recent', 'older', 'sub']);
  const sessions = [
    { id: 'recent' },
    { id: 'older' },
    { id: 'sub' },
  ];
  assert.equal(folderShowsUnread(sessions, {
    unreadIds,
    runningIds: [],
    activeId: '',
    countableIds: ['recent'],
  }), true);
  assert.equal(folderShowsUnread(sessions, {
    unreadIds,
    runningIds: [],
    activeId: 'recent',
    countableIds: ['recent'],
  }), false);
  assert.equal(folderShowsUnread(sessions, {
    unreadIds,
    runningIds: [],
    activeId: '',
    countableIds: ['visible-read'],
  }), false);
  assert.equal(folderShowsUnread(sessions, {
    unreadIds,
    runningIds: ['recent'],
    activeId: '',
    countableIds: ['recent'],
  }), false);
});

test('fit columns wrap one long cell instead of letting it set the column', () => {
  const longNote = 'pick up the black bowl between the plate and the ramekin and place it on the plate';
  const layout = optimizeTableColumnWidths([
    [
      { text: 'suite', isHeader: true },
      { text: 'id', isHeader: true },
      { text: 'instruction', isHeader: true },
      { text: 'rate', isHeader: true },
    ],
    ['spatial', 'T00', longNote, '90% (9/10)'],
    ['spatial', 'T01', 'pick up the black bowl next to the ramekin and place it on the plate', '100% (10/10)'],
    ['spatial', 'T04', 'pick up the black bowl in the top drawer of the wooden cabinet and place it on the plate', '60% (6/10)'],
    ['spatial', 'T09', 'pick up the black bowl on the wooden cabinet and place it on the plate', '100% (10/10)'],
  ], {
    maxTableWidth: 760,
    fontSize: 14,
    lineHeight: 22,
    cellHorizontalPadding: 24,
    compactness: 0.12,
  });

  const natural = defaultHeuristicMeasureText(longNote, 14);
  const [suite, id, instruction, rate] = layout.columnContentWidths;
  assert.ok(layout.totalTableWidth <= 760 + 1, `table wider than pane: ${layout.totalTableWidth}`);
  assert.equal(layout.requiresHorizontalScroll, false);
  assert.ok(instruction < natural, `instruction ${instruction} exceeded natural ${natural}`);
  assert.ok(instruction > 280, `instruction ${instruction} stayed too narrow`);
  assert.ok(suite < 100 && id < 70, `short columns grew: ${layout.columnContentWidths.join(',')}`);
  assert.ok(rate < instruction * 0.35, `rate ${rate} tracked the long instruction ${instruction}`);
});

test('uniform table columns stay near each other instead of collapsing to the minimum', () => {
  const layout = optimizeTableColumnWidths([
    ['alpha', 'bravo', 'charlie'],
    ['alpha', 'bravo', 'charlie'],
    ['alpha', 'bravo', 'charlie'],
  ], {
    maxTableWidth: 900,
    fontSize: 14,
    lineHeight: 22,
    cellHorizontalPadding: 24,
  });
  const widths = layout.columnContentWidths;
  const natural = ['alpha', 'bravo', 'charlie'].map((word) => defaultHeuristicMeasureText(word, 14));
  widths.forEach((width, index) => {
    assert.ok(width > natural[index] * 0.8, `column ${index} crushed to ${width}, natural ${natural[index].toFixed(1)}`);
    assert.ok(width < natural[index] * 1.45, `column ${index} stretched to ${width}, natural ${natural[index].toFixed(1)}`);
  });
  assert.equal(layout.outlierCells.length, 0);
});

test('agy-preview update installs a newer release and leaves unrelated files out', async () => {
  assert.equal(compareVersions('0.4.2', '0.4.3'), -1);
  assert.equal(compareVersions('v0.4.3', '0.4.3'), 0);
  assert.equal(decideUpdate('0.4.2', '0.4.3'), 'upgrade');
  assert.equal(decideUpdate('0.4.3', '0.4.3'), 'current');
  assert.equal(decideUpdate('0.4.4', '0.4.3'), 'ahead');
  assert.match(tagArchiveUrl('v0.4.3'), /\/archive\/refs\/tags\/v0\.4\.3\.tar\.gz$/);

  const root = mkdtempSync(join(tmpdir(), 'agy-update-'));
  const srcParent = join(root, 'src-parent');
  const src = join(srcParent, 'antigravity-session-preview-9.9.9');
  const install = join(root, 'install');
  const binDir = join(root, 'bin');
  const archive = join(root, 'release.tar.gz');
  try {
    mkdirSync(join(src, 'scripts'), { recursive: true });
    mkdirSync(join(src, 'public', 'js'), { recursive: true });
    mkdirSync(join(src, 'tests'), { recursive: true });
    writeFileSync(join(src, 'plugin.json'), JSON.stringify({ version: '9.9.9' }));
    writeFileSync(join(src, 'scripts', 'hook-sync.mjs'), 'export const hook = true;\n');
    writeFileSync(join(src, 'public', 'js', 'app.js'), 'export const fresh = true;\n');
    writeFileSync(join(src, 'tests', 'secret.txt'), 'do not install');
    mkdirSync(join(install, 'public', 'js'), { recursive: true });
    writeFileSync(join(install, 'plugin.json'), JSON.stringify({ version: '0.1.0' }));
    writeFileSync(join(install, 'public', 'js', 'stale.js'), 'old');
    execFileSync('tar', ['-czf', archive, '-C', srcParent, 'antigravity-session-preview-9.9.9']);
    const bytes = readFileSync(archive);
    const result = await runPluginUpdate({
      installRoot: install,
      binDir,
      fetchImpl: async (url) => {
        if (String(url).includes('api.github.com')) {
          return { ok: true, status: 200, json: async () => ({ tag_name: 'v9.9.9' }) };
        }
        return { ok: true, status: 200, arrayBuffer: async () => bytes };
      },
    });
    assert.equal(result.action, 'upgrade');
    assert.equal(result.localVersion, '0.1.0');
    assert.equal(result.remoteVersion, '9.9.9');
    assert.match(readFileSync(join(install, 'plugin.json'), 'utf-8'), /9\.9\.9/);
    assert.match(readFileSync(join(install, 'public', 'js', 'app.js'), 'utf-8'), /fresh/);
    assert.equal(existsSync(join(install, 'scripts', 'hook-sync.mjs')), true);
    assert.equal(existsSync(join(install, 'public', 'js', 'stale.js')), false);
    assert.equal(existsSync(join(install, 'tests', 'secret.txt')), false);
    assert.equal(existsSync(join(binDir, 'agy-preview')), true);

    const same = await runPluginUpdate({
      installRoot: install,
      binDir,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ tag_name: 'v9.9.9' }) }),
    });
    assert.equal(same.action, 'current');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a saved /btw keeps the question, answer, and fork id', () => {
  const turn = buildBtwSavedTurn({
    question: 'Why did the last edit fail?',
    answer: 'The selector missed the button.',
    noteId: 'btw-11111111-2222-4333-8444-555555555555',
    toolCount: 3,
    durationText: '12s',
    status: 'success',
  });
  assert.equal(turn.scheduleLabel, '/btw');
  assert.equal(turn.user.request, 'Why did the last edit fail?');
  assert.equal(turn.items[0].text, 'The selector missed the button.');
  assert.equal(turn.stats.toolCount, 3);
  assert.equal(btwForkConversationId(turn.btw.noteId), '11111111-2222-4333-8444-555555555555');
  assert.equal(btwForkConversationId('btw-1700000000000-ab12'), '');
});

test('saved turns keep the full interaction and can be listed again', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-saved-turns-'));
  try {
    const store = new SavedTurnStore({ dir });
    const summary = store.create({
      conversationId: 'conv-1',
      flavor: 'antigravity-cli',
      conversationTitle: 'Poster edits',
      projectName: 'ChengzhuUwU.github.io',
      turn: {
        id: 'turn-4',
        index: 2,
        user: { request: 'Fix the poster spacing', mentions: [], metadataBlocks: [] },
        items: [
          { kind: 'thinking', text: 'Looking at the layout.' },
          {
            kind: 'tool_group',
            tools: [{ name: 'view_file', args: { Path: 'poster.html' }, outputPreview: { text: '<main>', truncated: false, totalLength: 6 } }],
          },
          { kind: 'markdown', intermediate: false, text: 'Updated the spacing.' },
        ],
      },
    });
    assert.match(summary.id, /^st-/);
    assert.equal(summary.promptPreview, 'Fix the poster spacing');
    assert.equal(store.list().length, 1);

    const loaded = store.get(summary.id);
    assert.equal(loaded.turn.items[1].tools[0].name, 'view_file');
    assert.equal(loaded.turn.items[1].tools[0].args.Path, 'poster.html');
    assert.equal(loaded.turn.items[2].text, 'Updated the spacing.');
    assert.equal(loaded.conversationTitle, 'Poster edits');

    const again = new SavedTurnStore({ dir });
    assert.equal(again.list()[0].id, summary.id);
    assert.equal(again.delete(summary.id), true);
    assert.equal(again.list().length, 0);
    assert.equal(again.get(summary.id), null);
    assert.throws(() => again.delete('../index'), /invalid saved turn id/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('native file picker chooses the OS dialog and hides a missing Linux tool', async () => {
  assert.deepEqual(pickerCandidates('win32').map((item) => item.id), ['powershell']);
  assert.deepEqual(pickerCandidates('darwin').map((item) => item.id), ['osascript']);
  assert.deepEqual(pickerCandidates('linux').map((item) => item.id), ['zenity', 'kdialog', 'qarma', 'yad']);
  assert.deepEqual(pickerCandidates('freebsd'), []);

  const powershell = buildPickerLaunch('powershell');
  assert.equal(powershell.command, 'powershell.exe');
  assert.ok(powershell.args.includes('-STA'));
  assert.match(powershell.args.at(-1), /OpenFileDialog/);

  const mac = buildPickerLaunch('osascript');
  assert.equal(mac.command, 'osascript');
  assert.match(mac.args[1], /choose file/);

  const kde = buildPickerLaunch('kdialog');
  assert.equal(kde.args[0], '--title');
  assert.ok(kde.args.includes('--getopenfilename'));

  assert.equal(cleanPickedPath('  "/tmp/a.md"\n'), '/tmp/a.md');
  assert.deepEqual(interpretPickerOutput({ code: 1, stdout: '' }), { available: true, canceled: true, path: '' });
  assert.deepEqual(interpretPickerOutput({ code: -1, stdout: '', errorCode: 'ENOENT' }), { available: false, canceled: false, path: '' });

  const none = await resolveNativeFilePicker('linux', async () => false);
  assert.equal(none, null);
  const kdeOnly = await resolveNativeFilePicker('linux', async (command) => command === 'kdialog');
  assert.equal(kdeOnly.id, 'kdialog');

  function scriptedSpawn(stdout, code) {
    return () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = { resume() {} };
      queueMicrotask(() => {
        if (stdout) child.stdout.emit('data', Buffer.from(stdout));
        child.emit('close', code);
      });
      return child;
    };
  }

  const picked = await runNativeFilePicker({
    platform: 'linux',
    exists: async (command) => command === 'zenity',
    spawnImpl: scriptedSpawn('/home/me/notes.md\n', 0),
  });
  assert.equal(picked.provider, 'zenity');
  assert.equal(picked.path, '/home/me/notes.md');
  assert.equal(picked.canceled, false);

  const canceled = await runNativeFilePicker({
    platform: 'darwin',
    exists: async () => true,
    spawnImpl: scriptedSpawn('', 1),
  });
  assert.equal(canceled.canceled, true);
  assert.equal(canceled.path, '');
});
