import { getLang, t } from './i18n.js';
import { escapeHtml, isPreviewableFilePath, outlineLeadLabel, renderMarkdownHtml, enhanceMarkdownDom } from './markdown.js';
import { APPLE_SPINNER_SVG } from './doc-viewers.js';

const CHEVRON_SVG = `<svg class="chevron-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5L10.5 8 6 12.5"/></svg>`;

export function formatCompactTokens(n) {
  if (!n || n <= 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatDuration(ms) {
  if (ms == null || ms <= 0) return '';
  if (ms < 1000) return `${ms}ms`;
  const sec = (ms / 1000).toFixed(ms < 10000 ? 1 : 0);
  return `${sec}s`;
}

const LONG_PROMPT_LINES = 8;
const LONG_PROMPT_CHARS = 480;

export function isLongUserPrompt(text) {
  const value = String(text || '');
  if (!value.trim()) return false;
  const lines = value.split(/\r?\n/).length;
  return lines > LONG_PROMPT_LINES || value.length > LONG_PROMPT_CHARS;
}

function collectModelPlainParts(turn) {
  const parts = [];
  for (const item of turn?.items || []) {
    if (item.kind === 'markdown' && !item.intermediate) {
      const text = String(item.text || '').trim();
      if (text) parts.push(text);
    } else if (item.kind === 'decision') {
      const plan = String(item.planMarkdown || '').trim();
      if (plan) parts.push(plan);
      const questions = Array.isArray(item.questions) ? item.questions : [];
      const block = questions.map((q) => {
        const options = Array.isArray(q.options) ? q.options.filter(Boolean) : [];
        const opts = options.length ? `\n${options.map((opt) => `- ${opt}`).join('\n')}` : '';
        return `${q.question || ''}${opts}`.trim();
      }).filter(Boolean).join('\n\n');
      if (block) parts.push(block);
      const answer = String(item.rawAnswer || '').trim();
      if (answer) parts.push(answer);
    }
  }
  return parts;
}

export function formatPromptPlainText(turn) {
  return String(turn?.user?.request || '').trim();
}

/** A /btw side question stored in the same shape as a saved conversation turn. */
export function buildBtwSavedTurn({ question, answer, noteId, toolCount, durationText, status, createdAt } = {}) {
  const items = [];
  const answerText = String(answer || '').trim();
  if (answerText) {
    items.push({
      kind: 'markdown',
      id: 'btw-answer',
      intermediate: false,
      text: answerText,
    });
  }
  return {
    id: noteId || 'btw-saved',
    index: null,
    kind: 'btw',
    scheduleLabel: '/btw',
    createdAt: createdAt || new Date().toISOString(),
    user: {
      request: String(question || '/btw'),
      mentions: [],
      metadataBlocks: [],
    },
    items,
    stats: {
      thinkingCount: 0,
      toolCount: Number(toolCount) || 0,
      errorCount: 0,
      tokensIn: 0,
      tokensOut: 0,
    },
    btw: {
      noteId: noteId || '',
      toolCount: Number(toolCount) || 0,
      durationText: durationText || '',
      status: status || '',
    },
  };
}

export function btwForkConversationId(noteId) {
  const match = String(noteId || '').match(/^btw-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return match ? match[1] : '';
}

export function formatResponsePlainText(turn) {
  return collectModelPlainParts(turn).join('\n\n');
}

/** Plain-text transcript of one turn: user request plus the visible model reply. */
export function formatTurnPlainText(turn, labels = {}) {
  const userLabel = labels.userLabel || 'User';
  const modelLabel = labels.modelLabel || 'Assistant';
  const request = formatPromptPlainText(turn);
  const response = formatResponsePlainText(turn);
  const blocks = [userLabel];
  if (request) blocks.push(request);
  if (response) {
    blocks.push(modelLabel);
    blocks.push(response);
  }
  return blocks.join('\n\n');
}

function copyWithTextarea(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.left = '0';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.focus();
  area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  area.remove();
  return ok;
}

async function writeClipboardText(text) {
  // Must run before the first await so the click gesture can still drive copy.
  if (copyWithTextarea(text)) return true;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function syncCopyButton(btn, label, tip, text) {
  if (!btn) return;
  btn.title = tip;
  btn.hidden = !text;
  if (!btn.dataset.busy) btn.textContent = label;
}

function turnBadgeText(turn) {
  if (turn?.kind === 'schedule' && turn.scheduleLabel) return turn.scheduleLabel;
  if (turn?.index != null) return t('youTurnBadge', { index: turn.index });
  return '';
}

function rememberTurnCopy(turnEl, turn) {
  if (!turnEl) return;
  turnEl._savedTurn = turn;
  turnEl._copyPromptText = formatPromptPlainText(turn);
  turnEl._copyResponseText = formatResponsePlainText(turn);
  const card = turnEl.querySelector(':scope > .user-card');
  syncCopyButton(card?.querySelector('[data-action="copy-prompt"]'), t('copyPromptBtn'), t('copyPromptTip'), turnEl._copyPromptText);
  syncCopyButton(card?.querySelector('[data-action="copy-response"]'), t('copyResponseBtn'), t('copyResponseTip'), turnEl._copyResponseText);
  const badge = turnEl.querySelector(':scope > .user-card .user-badge');
  const badgeText = turnBadgeText(turn);
  if (badge && badgeText) badge.textContent = badgeText;
  const foldBtn = turnEl.querySelector(':scope > .user-card [data-action="toggle-user-prompt"]');
  if (foldBtn) {
    const open = turnEl.querySelector(':scope > .user-card')?.dataset.promptOpen === 'true';
    foldBtn.textContent = open ? t('showLessPrompt') : t('showMorePrompt');
  }
}

function cleanTocSnippet(text, maxChars = 16) {
  if (!text || typeof text !== 'string') return '';
  const singleLine = text
    .replace(/@\[(.*?)\]/g, '$1')
    .replace(/[#>*`~_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!singleLine) return '';
  return singleLine.length > maxChars ? `${singleLine.slice(0, maxChars)}…` : singleLine;
}

function plainNodeText(node) {
  if (!node) return '';
  const clone = node.cloneNode(true);
  clone.querySelectorAll('button, .open-sidebar-pill, .katex-mathml, script, style, svg').forEach((n) => n.remove());
  return (clone.textContent || '').replace(/\s+/g, ' ').trim();
}

function readableOutlineSource(root) {
  if (!root) return '';
  const nodes = root.querySelectorAll('p, li, blockquote, td, th');
  for (const node of nodes) {
    if (node.closest('details, .thinking-body, pre, svg, .mermaid')) continue;
    const text = plainNodeText(node);
    if (text) return text;
  }
  const pre = root.querySelector('pre');
  if (pre && !pre.closest('details, .thinking-body')) {
    const text = plainNodeText(pre);
    if (text) return text;
  }
  if (root.closest && root.querySelector('details, .thinking-body')) {
    const clone = root.cloneNode(true);
    clone.querySelectorAll('details, .thinking-body').forEach((n) => n.remove());
    return plainNodeText(clone);
  }
  return plainNodeText(root);
}

function assignOutlineAnchor(el, preferred, seenIds) {
  let id = el.id && !seenIds.has(el.id) ? el.id : (preferred || 'md-lead');
  let unique = id;
  let n = 2;
  const taken = (candidate) => {
    if (seenIds.has(candidate)) return true;
    if (typeof document === 'undefined') return false;
    const existing = document.getElementById(candidate);
    return Boolean(existing && existing !== el);
  };
  while (taken(unique)) unique = `${id}-${n++}`;
  el.id = unique;
  el.dataset.outlineLead = '1';
  el.classList.add('outline-lead-anchor');
  seenIds.add(unique);
  return unique;
}

function clearLeadAnchor(el) {
  if (!el) return;
  el.classList.remove('outline-lead-anchor');
  if (el.dataset.outlineLead === '1') {
    el.removeAttribute('id');
    delete el.dataset.outlineLead;
  }
}

/** When a Markdown block has no headings, outline it from the opening words. */
export function appendLeadOutlineItem(items, root, { anchorId, level = 2, seenIds }) {
  if (!root) return false;
  if (root.querySelector('h1, h2, h3, h4, h5, h6')) {
    clearLeadAnchor(root);
    return false;
  }
  const raw = readableOutlineSource(root);
  const label = outlineLeadLabel(raw);
  if (!label) {
    clearLeadAnchor(root);
    return false;
  }
  const id = assignOutlineAnchor(root, anchorId, seenIds);
  const fullTitle = raw.length > 180 ? `${raw.slice(0, 180).replace(/\s+\S*$/, '') || raw.slice(0, 180)}…` : raw;
  items.push({ id, label, fullTitle, level, isTurn: false });
  return true;
}

function computeLineDiff(before, after) {
  const oldLines = String(before ?? '').split(/\r?\n/);
  const newLines = String(after ?? '').split(/\r?\n/);
  const maxShow = 120;
  const out = [];
  for (let i = 0; i < Math.min(oldLines.length, maxShow); i++) {
    out.push({ type: 'del', text: oldLines[i] });
  }
  if (oldLines.length > maxShow) {
    out.push({ type: 'del', text: `… (${oldLines.length - maxShow} more deleted lines)` });
  }
  for (let i = 0; i < Math.min(newLines.length, maxShow); i++) {
    out.push({ type: 'add', text: newLines[i] });
  }
  if (newLines.length > maxShow) {
    out.push({ type: 'add', text: `… (${newLines.length - maxShow} more added lines)` });
  }
  return out;
}

function summarizeToolGroup(tools) {
  const counts = new Map();
  let errors = 0;
  let running = 0;
  let waiting = 0;
  let canceled = 0;
  for (const t of tools) {
    counts.set(t.name, (counts.get(t.name) || 0) + 1);
    if (t.status === 'error') errors++;
    if (t.status === 'waiting') waiting++;
    else if (t.status === 'canceled') canceled++;
    else if (t.status === 'running' || t.status === 'pending') running++;
  }
  const parts = Array.from(counts.entries())
    .slice(0, 3)
    .map(([name, cnt]) => (cnt > 1 ? `${name} ×${cnt}` : name));
  if (counts.size > 3) parts.push(`+${counts.size - 3} more`);
  return {
    label: `${tools.length} tool ${tools.length === 1 ? 'call' : 'calls'} · ${parts.join(', ')}`,
    errors,
    running,
    waiting,
    canceled,
  };
}

function renderToolDetailHtml(tool, baseDir) {
  const parts = [];
  if (tool.diff) {
    const diffLines = computeLineDiff(tool.diff.before, tool.diff.after);
    parts.push(`<div class="tool-section-label">${tool.diff.isNewFile ? 'Write File' : 'Edit Diff'} · ${escapeHtml(tool.diff.path)}</div>`);
    parts.push(`<div class="diff-box">${diffLines.map((l) => `<div class="diff-line ${l.type}">${l.type === 'add' ? '+' : '-'} ${escapeHtml(l.text)}</div>`).join('')}</div>`);
  } else if (tool.args && Object.keys(tool.args).length > 0) {
    parts.push(`<div class="tool-section-label">Arguments</div>`);
    parts.push(`<pre class="tool-pre">${escapeHtml(JSON.stringify(tool.args, null, 2))}</pre>`);
  }

  if (tool.errorMsg) {
    parts.push(`<div class="tool-section-label" style="color:var(--error);">Error</div>`);
    parts.push(`<pre class="tool-pre" style="border-color:rgba(194,59,59,0.35);color:var(--error);">${escapeHtml(tool.errorMsg)}</pre>`);
  }

  if (tool.outputPreview && tool.outputPreview.text) {
    const truncNote = tool.outputPreview.truncated
      ? ` <span style="color:var(--text-faint);">(showing ${tool.outputPreview.text.length} / ${tool.outputPreview.totalLength} chars)</span>`
      : '';
    parts.push(`<div class="tool-section-label">Output${truncNote}</div>`);
    parts.push(`<pre class="tool-pre" data-tool-output-pre="true">${escapeHtml(tool.outputPreview.text)}</pre>`);
    if (tool.outputPreview.truncated && tool.resultStepIndex != null) {
      parts.push(`<div><button type="button" class="code-mini-btn" data-action="load-full-step" data-step="${tool.resultStepIndex}">${escapeHtml(t('loadFullOutputBtn'))}</button></div>`);
    }
  }

  const extras = [];
  if (tool.subagentId) {
    extras.push(`<button type="button" class="open-sidebar-pill" data-open-conv="${escapeHtml(tool.subagentId)}">${escapeHtml(t('viewSubagentBtn'))}</button>`);
  }
  if (tool.targetFile) {
    extras.push(`<button type="button" class="open-sidebar-pill" data-local-href="${escapeHtml(tool.targetFile)}" data-base-dir="${escapeHtml(baseDir)}" data-preview-mode="sidebar">${escapeHtml(t('openInSidebar'))}</button>`);
  }
  if (tool.spooledPath) {
    extras.push(`<button type="button" class="code-mini-btn" data-local-href="${escapeHtml(tool.spooledPath)}" data-base-dir="${escapeHtml(baseDir)}" data-preview-mode="popup">${escapeHtml(t('openSpooledBtn'))}</button>`);
  }
  if (tool.taskLogPath) {
    extras.push(`<button type="button" class="code-mini-btn" data-local-href="${escapeHtml(tool.taskLogPath)}" data-base-dir="${escapeHtml(baseDir)}" data-preview-mode="popup">${escapeHtml(t('viewTaskLogBtn'))}</button>`);
  }
  if (extras.length > 0) {
    parts.push(`<div style="display:flex;gap:6px;flex-wrap:wrap;">${extras.join('')}</div>`);
  }

  return parts.join('') || '<div style="font-size:0.76rem;color:var(--text-faint);">No additional details recorded.</div>';
}

function buildProcessItemNode(item, { theme, baseDir, expandedState }) {
  if (item.kind === 'thinking') {
    const open = expandedState.has(item.id);
    const card = document.createElement('div');
    card.className = 'disclosure-card thinking-card';
    card.dataset.open = String(open);
    card.dataset.disclosureKey = item.id;
    const statusSuffix = item.status === 'RUNNING' ? t('thinkingNowSuffix') : '';
    card.innerHTML = `
      <button type="button" class="disclosure-trigger" data-action="toggle-disclosure">
        ${CHEVON_ICON()}
        <span class="thinking-label">${escapeHtml(t('thoughtLabel'))}${escapeHtml(statusSuffix)}</span>
        <span class="thinking-preview">${escapeHtml(item.firstLine || `${item.wordCount} words`)}</span>
        <span style="font-size:0.71rem;color:var(--text-faint);flex-shrink:0;">${item.wordCount}w</span>
      </button>
      <div class="thinking-body assistant-markdown">${open ? renderMarkdownHtml(item.text, { baseDir }) : ''}</div>
    `;
    card._lazyContent = () => renderMarkdownHtml(item.text, { baseDir });
    if (open) {
      const body = card.querySelector('.thinking-body');
      body.dataset.hydrated = 'true';
      enhanceMarkdownDom(body, theme);
    }
    return card;
  }

  if (item.kind === 'tool_group') {
    const groupOpen = expandedState.has(item.id);
    const summary = summarizeToolGroup(item.tools);
    const card = document.createElement('div');
    card.className = 'tool-group-card';
    card.dataset.open = String(groupOpen);
    card.dataset.disclosureKey = item.id;

    const badges = [];
    if (summary.waiting > 0) badges.push(`<span class="tool-status-pill waiting">waiting</span>`);
    if (summary.running > 0) badges.push(`<span class="tool-status-pill running">running</span>`);
    if (summary.canceled > 0) badges.push(`<span class="tool-status-pill canceled">${summary.canceled > 1 ? `${summary.canceled} ` : ''}${escapeHtml(t('canceledPill'))}</span>`);
    if (summary.errors > 0) badges.push(`<span class="tool-status-pill error">${summary.errors} failed</span>`);
    if (summary.waiting === 0 && summary.running === 0 && summary.canceled === 0 && summary.errors === 0) badges.push(`<span class="tool-status-pill done">done</span>`);

    const rowsHtml = item.tools.map((tool) => {
      const rowOpen = expandedState.has(tool.id);
      const dur = formatDuration(tool.durationMs);
      const statusLabel = tool.status === 'error'
        ? 'error'
        : (tool.status === 'waiting'
            ? 'waiting'
            : (tool.status === 'canceled'
                ? t('canceledPill')
                : (tool.status === 'running' || tool.status === 'pending' ? 'running' : (dur || 'ok'))));
      const showSidebarBtn = Boolean(tool.targetFile && isPreviewableFilePath(tool.targetFile));
      let actionBtnHtml = '';
      if (tool.subagentId) {
        actionBtnHtml = `<button type="button" class="open-sidebar-pill" data-open-conv="${escapeHtml(tool.subagentId)}">${escapeHtml(t('viewSubagentBtn'))}</button>`;
      } else if (showSidebarBtn) {
        actionBtnHtml = `<button type="button" class="open-sidebar-pill" data-local-href="${escapeHtml(tool.targetFile)}" data-base-dir="${escapeHtml(baseDir)}" data-preview-mode="sidebar" title="${escapeHtml(t('openInSidebarTip', { path: tool.targetFile }))}">${escapeHtml(t('openInSidebar'))}</button>`;
      }

      return `<div class="tool-row" data-open="${rowOpen}" data-disclosure-key="${tool.id}">
        <div class="tool-row-header-wrap">
          <button type="button" class="tool-row-trigger" data-action="toggle-tool-row">
            <span class="tool-row-main">
              ${CHEVRON_SVG}
              <span class="tool-name-pill">${escapeHtml(tool.name)}</span>
              <span class="tool-target-text">${escapeHtml(tool.summary || '')}</span>
            </span>
            <span class="tool-status-pill ${tool.status}">${escapeHtml(statusLabel)}</span>
          </button>
          ${actionBtnHtml}
        </div>
        <div class="tool-row-detail">${rowOpen ? renderToolDetailHtml(tool, baseDir) : ''}</div>
      </div>`;
    }).join('');

    card.innerHTML = `
      <button type="button" class="tool-group-trigger" data-action="toggle-tool-group">
        <span class="tool-group-left">
          ${CHEVRON_SVG}
          <span class="tool-group-summary">${escapeHtml(summary.label)}</span>
        </span>
        <span class="tool-group-badges">${badges.join('')}</span>
      </button>
      <div class="tool-group-list">${rowsHtml}</div>
    `;

    card.querySelectorAll('.tool-row').forEach((rowEl, idx) => {
      const t = item.tools[idx];
      rowEl._lazyContent = () => renderToolDetailHtml(t, baseDir);
      if (expandedState.has(t.id)) {
        const d = rowEl.querySelector('.tool-row-detail');
        if (d) d.dataset.hydrated = 'true';
      }
    });

    return card;
  }

  if (item.kind === 'markdown') {
    // Intermediate progress note emitted mid-execution before final reply
    const noteEl = document.createElement('div');
    noteEl.className = 'process-intermediate-note assistant-markdown';
    noteEl.innerHTML = renderMarkdownHtml(item.text, { baseDir });
    enhanceMarkdownDom(noteEl, theme);
    return noteEl;
  }

  if (item.kind === 'error') {
    const errEl = document.createElement('div');
    errEl.className = 'notice-banner error';
    errEl.textContent = item.text;
    return errEl;
  }

  if (item.kind === 'system') {
    const open = expandedState.has(item.id);
    const card = document.createElement('div');
    card.className = 'disclosure-card thinking-card';
    card.dataset.open = String(open);
    card.dataset.disclosureKey = item.id;
    card.innerHTML = `
      <button type="button" class="disclosure-trigger" data-action="toggle-disclosure">
        ${CHEVRON_SVG}
        <span class="thinking-label">${escapeHtml(item.title)}</span>
        <span class="thinking-preview">System context</span>
      </button>
      <div class="thinking-body assistant-markdown">${open ? renderMarkdownHtml(item.text, { baseDir }) : ''}</div>
    `;
    card._lazyContent = () => renderMarkdownHtml(item.text, { baseDir });
    if (open) {
      const body = card.querySelector('.thinking-body');
      body.dataset.hydrated = 'true';
      enhanceMarkdownDom(body, theme);
    }
    return card;
  }

  return null;
}

function CHEVON_ICON() {
  return CHEVRON_SVG;
}

function summarizeProcessItems(processItems, stats, isTurnRunning, isTurnInterrupted = false) {
  const parts = [];
  const thoughts = stats?.thinkingCount || 0;
  const tools = stats?.toolCount || 0;
  const dur = formatDuration(stats?.durationMs || 0);
  if (thoughts > 0) parts.push(`${thoughts} ${thoughts === 1 ? 'thought' : 'thoughts'}`);
  if (tools > 0) parts.push(`${tools} tool ${tools === 1 ? 'call' : 'calls'}`);
  if (dur) parts.push(dur);
  if (parts.length === 0) {
    parts.push(`${processItems.length} ${processItems.length === 1 ? 'step' : 'steps'}`);
  }
  const prefix = isTurnRunning
    ? t('workingPrefix')
    : (isTurnInterrupted ? t('interruptedPrefix') : t('execProcessPrefix'));
  return `${prefix} · ${parts.join(' · ')}`;
}

function balanceStreamingCodeFence(mdSlice) {
  const fences = mdSlice.match(/^(?:```+|~~~+)/gm);
  if (fences && fences.length % 2 === 1) {
    const lastFence = fences[fences.length - 1];
    const ch = lastFence[0];
    return `${mdSlice}\n${ch.repeat(lastFence.length)}`;
  }
  return mdSlice;
}

function streamMarkdownIntoNode(mdEl, fullText, { baseDir, theme /* , instant = false, onStreamTick = null */ } = {}) {
  const safeText = String(fullText ?? '');
  mdEl._streamTarget = safeText;
  mdEl.dataset.rawLen = String(safeText.length);

  // Instant clean render (progressive client-side typewriter streaming commented out per user preference)
  if (mdEl._streamTimer) {
    clearTimeout(mdEl._streamTimer);
    mdEl._streamTimer = null;
  }
  mdEl._streamRevealed = safeText.length;
  mdEl.classList.remove('is-streaming-md');
  mdEl.innerHTML = renderMarkdownHtml(safeText, { baseDir });
  enhanceMarkdownDom(mdEl, theme);

  /*
  if (instant || safeText.length === 0) {
    ...
  }
  // Progressive frame-by-frame typewriter reveal (disabled for now):
  // const frameMs = 30;
  // const totalUnrevealed = Math.max(1, safeText.length - (mdEl._streamRevealed || 0));
  // const targetDurationMs = Math.min(3600, Math.max(650, totalUnrevealed * 1.75));
  // const charsPerFrame = Math.max(6, Math.ceil(totalUnrevealed / Math.max(1, targetDurationMs / frameMs)));
  */
}

function processItemSignature(pItem) {
  if (!pItem) return '';
  if (pItem.kind === 'thinking') {
    return `think:${pItem.id}:${pItem.status || ''}:${(pItem.text || '').length}`;
  }
  if (pItem.kind === 'tool_group') {
    return `tg:${pItem.id}:${(pItem.tools || []).map((tl) => `${tl.id}:${tl.status}:${tl.durationMs || 0}:${tl.outputPreview?.totalLength || 0}`).join('|')}`;
  }
  return `${pItem.kind}:${pItem.id || ''}:${(pItem.text || '').length}`;
}

function renderPlanStepsCardHtml(planSteps, isTurnInterrupted = false) {
  if (!planSteps?.steps?.length) return '';
  const { steps, doneCount = 0, totalCount = steps.length, activeTitle = '' } = planSteps;
  const pct = Math.min(100, Math.round((doneCount / Math.max(1, totalCount)) * 100));
  const allDone = doneCount >= totalCount;

  const statusPill = allDone
    ? `<span class="tool-status-pill done">✓ ${escapeHtml(t('stepsAllDone'))}</span>`
    : (isTurnInterrupted
        ? `<span class="tool-status-pill canceled">${escapeHtml(t('canceledPill'))} · ${pct}%</span>`
        : `<span class="tool-status-pill running">${pct}%</span>`);

  const rowsHtml = steps.map((st) => {
    const status = st.status || 'pending';
    const icon = status === 'done' ? '✓'
      : status === 'in_progress' ? '●'
      : status === 'failed' ? '✕'
      : status === 'skipped' ? '–'
      : '○';
    return `<div class="step-check-row status-${escapeHtml(status)}">
      <span class="step-check-icon">${icon}</span>
      <span class="step-check-title">${escapeHtml(st.title)}</span>
    </div>`;
  }).join('');

  return `
    <div class="turn-steps-header">
      <div class="turn-steps-header-left">
        <span class="turn-steps-glyph">⠿</span>
        <strong>${escapeHtml(t('stepsCardTitle'))}</strong>
        <span class="turn-steps-count">${escapeHtml(t('stepsProgressBadge', { done: doneCount, total: totalCount }))}</span>
        ${!allDone && activeTitle ? `<span class="turn-steps-active-hint">· ${escapeHtml(activeTitle)}</span>` : ''}
      </div>
      ${statusPill}
    </div>
    <div class="steps-progress-track">
      <div class="steps-progress-fill${allDone ? ' all-done' : ''}" style="width:${pct}%"></div>
    </div>
    <div class="turn-steps-list">${rowsHtml}</div>
  `;
}

function splitRecommendedOption(rawOption) {
  const text = String(rawOption ?? '').trim();
  const m = text.match(/^\(\s*(?:Recommended|推荐)\s*\)\s*(.*)$/i);
  if (m) {
    return { isRecommended: true, label: m[1].trim() || text };
  }
  return { isRecommended: false, label: text };
}

function isDecisionOptionSelected(rawOpt, cleanLabel, answerText) {
  if (!answerText) return false;
  const normAns = answerText.trim();
  const normRaw = String(rawOpt || '').trim();
  if (!normAns || !normRaw) return false;
  if (normAns === normRaw || (cleanLabel && normAns === cleanLabel)) return true;
  return normAns.includes(normRaw) || (cleanLabel && cleanLabel.length >= 6 && normAns.includes(cleanLabel));
}

function buildDecisionCardElement(item, { baseDir, theme }) {
  const card = document.createElement('div');
  const isWaiting = item.status === 'waiting';
  const isCanceled = item.status === 'canceled';
  const stateCls = isWaiting ? 'is-waiting' : (isCanceled ? 'is-canceled' : 'is-answered');
  card.className = `decision-card ${stateCls}`;
  card.id = item.id;
  card.dataset.decisionId = item.id;

  const isPlan = item.decisionType === 'approve_plan';
  const headerTitle = isPlan
    ? t(isWaiting ? 'decisionPlanTitle' : 'decisionPlanAnsweredTitle')
    : t(isWaiting ? 'decisionRequiredTitle' : (isCanceled ? 'decisionCanceledTitle' : 'decisionAnsweredTitle'));

  const durStr = !isWaiting && item.durationMs ? formatDuration(item.durationMs) : '';
  const durBadge = durStr ? `<span class="decision-wait-dur">${escapeHtml(durStr)}</span>` : '';
  const statusPillHtml = isWaiting
    ? `<span class="tool-status-pill waiting">${escapeHtml(t('waitingDecisionPhase'))}</span>`
    : (isCanceled
        ? `<span class="tool-status-pill error">${escapeHtml(t('decisionCanceledBadge'))}</span>`
        : `${durBadge}<span class="tool-status-pill done">✓ ${escapeHtml(t('stepsAllDone'))}</span>`);

  const leadIconHtml = isWaiting
    ? `<span class="status-dot decision-waiting"></span>`
    : (isCanceled
        ? `<span class="decision-status-glyph canceled">✕</span>`
        : `<span class="decision-status-glyph answered">✓</span>`);

  const qList = Array.isArray(item.questions) ? item.questions : [];
  const countBadge = !isPlan && qList.length > 1
    ? `<span class="turn-steps-count">${qList.length}</span>`
    : '';

  const terminalHintHtml = isWaiting
    ? `<div class="decision-terminal-hint">${escapeHtml(t('decisionTerminalHint'))}</div>`
    : '';

  let bodyHtml = '';
  if (isPlan) {
    const planHtml = item.planMarkdown ? renderMarkdownHtml(item.planMarkdown, { baseDir }) : '';
    if (isWaiting) {
      bodyHtml = planHtml
        ? `<div class="decision-plan-preview assistant-markdown">${planHtml}</div>`
        : '';
    } else {
      const summaryReply = (item.rawAnswer || '').trim();
      const replyBox = summaryReply
        ? `<div class="decision-selected-box"><span class="decision-selected-tag">✓</span><span class="decision-selected-val">${escapeHtml(summaryReply)}</span></div>`
        : '';
      const planFold = planHtml
        ? `<details class="decision-options-fold"><summary>${escapeHtml(t('decisionPlanToggle'))}</summary><div class="decision-plan-preview assistant-markdown">${planHtml}</div></details>`
        : '';
      bodyHtml = `${replyBox}${planFold}`;
    }
  } else {
    bodyHtml = qList.map((q, idx) => {
      const qNum = q.index || idx + 1;
      const modeBadge = `<span class="decision-select-mode">${escapeHtml(t(q.isMultiSelect ? 'decisionMultiSelect' : 'decisionSingleChoice'))}</span>`;
      const qHeader = `
        <div class="decision-q-header">
          <div class="decision-q-title-wrap">
            ${qList.length > 1 ? `<span class="decision-q-num">Q${qNum}</span>` : ''}
            <span class="decision-q-text">${escapeHtml(q.question)}</span>
          </div>
          ${modeBadge}
        </div>
      `;

      const opts = Array.isArray(q.options) ? q.options : [];
      if (isWaiting) {
        const optsHtml = opts.map((rawOpt, oIdx) => {
          const { isRecommended, label } = splitRecommendedOption(rawOpt);
          return `<div class="decision-option-row ${isRecommended ? 'recommended' : ''}">
            <span class="decision-opt-idx">${oIdx + 1}</span>
            <div class="decision-opt-content">
              ${isRecommended ? `<span class="decision-rec-pill">${escapeHtml(t('decisionRecommendedBadge'))}</span>` : ''}
              <span>${escapeHtml(label)}</span>
            </div>
          </div>`;
        }).join('');
        return `<div class="decision-question-block">${qHeader}${optsHtml ? `<div class="decision-options-list">${optsHtml}</div>` : ''}</div>`;
      }

      const ansText = item.answers?.[qNum] ?? (qList.length === 1 ? (item.rawAnswer || '').trim() : '');
      const cleanAns = splitRecommendedOption(ansText);
      const selectedHtml = ansText
        ? `<div class="decision-selected-box">
            <span class="decision-selected-tag">✓ ${escapeHtml(t('decisionSelectedLabel'))}</span>
            <span class="decision-selected-val">
              ${cleanAns.isRecommended ? `<span class="decision-rec-pill">${escapeHtml(t('decisionRecommendedBadge'))}</span> ` : ''}${escapeHtml(cleanAns.label)}
            </span>
          </div>`
        : (item.errorMsg
            ? `<div class="notice-banner error" style="padding:6px 10px;font-size:0.78rem;">${escapeHtml(item.errorMsg)}</div>`
            : '');

      let optionsFoldHtml = '';
      if (opts.length > 0) {
        const foldRows = opts.map((rawOpt, oIdx) => {
          const { isRecommended, label } = splitRecommendedOption(rawOpt);
          const chosen = isDecisionOptionSelected(rawOpt, label, ansText);
          return `<div class="decision-option-row compact ${chosen ? 'chosen' : ''}">
            <span class="decision-opt-idx">${chosen ? '✓' : oIdx + 1}</span>
            <div class="decision-opt-content">
              ${isRecommended ? `<span class="decision-rec-pill">${escapeHtml(t('decisionRecommendedBadge'))}</span>` : ''}
              <span>${escapeHtml(label)}</span>
            </div>
          </div>`;
        }).join('');
        optionsFoldHtml = `<details class="decision-options-fold">
          <summary>${escapeHtml(t('decisionShowOptions', { count: opts.length }))}</summary>
          <div class="decision-options-list">${foldRows}</div>
        </details>`;
      }

      return `<div class="decision-question-block">${qHeader}${selectedHtml}${optionsFoldHtml}</div>`;
    }).join('');
  }

  card.innerHTML = `
    <div class="decision-card-header">
      <div class="decision-card-header-left">
        ${leadIconHtml}
        <strong>${escapeHtml(headerTitle)}</strong>
        ${countBadge}
      </div>
      <div class="decision-card-header-right">
        ${statusPillHtml}
      </div>
    </div>
    ${terminalHintHtml}
    <div class="decision-card-body">${bodyHtml}</div>
  `;

  if (isPlan && item.planMarkdown) {
    card.querySelectorAll('.decision-plan-preview').forEach((node) => enhanceMarkdownDom(node, theme));
  }
  return card;
}

function surfaceItemKey(item) {
  return item.kind === 'decision' ? item.id : `md-${item.stepIndex}`;
}

function surfaceItemSignature(item) {
  if (item.kind === 'decision') {
    return `dec:${item.id}:${item.status}:${item.durationMs || 0}:${(item.rawAnswer || '').length}:${item.errorMsg || ''}:${getLang()}`;
  }
  return `md:${item.stepIndex}:${(item.text || '').length}:${getLang()}`;
}

function findRunningToolName(turn) {
  if (!turn?.items) return '';
  for (let i = turn.items.length - 1; i >= 0; i--) {
    const it = turn.items[i];
    if (it.kind === 'tool_group' && Array.isArray(it.tools)) {
      for (let j = it.tools.length - 1; j >= 0; j--) {
        const tl = it.tools[j];
        if (tl.status === 'running' || tl.status === 'pending') return tl.name || '';
      }
    }
  }
  return '';
}

function renderLiveStreamFooterHtml(isTurnRunning, hookState, liveTaskLog, turnRunningSinceMs = 0, isWaitingDecision = false, activeToolName = '') {
  if (!isTurnRunning && !isWaitingDecision) return '';
  let statusText = t('streamingBadge');
  if (isWaitingDecision) {
    statusText = t('waitingDecisionFooter');
  } else if (hookState?.phase === 'running_tool') {
    statusText = t('runningToolPhase', { tool: hookState.toolName || activeToolName || 'tool' });
  } else if (hookState?.phase === 'thinking' || hookState?.phase === 'between_steps') {
    statusText = t('thinkingPhase');
  } else if (activeToolName) {
    statusText = t('runningToolPhase', { tool: activeToolName });
  } else if (liveTaskLog?.text) {
    statusText = t('runningToolPhase', { tool: 'run_command' });
  }
  const elapsedSec = turnRunningSinceMs > 0 ? Math.max(0, Math.floor((Date.now() - turnRunningSinceMs) / 1000)) : 0;
  const elapsedStr = elapsedSec > 0 ? `${elapsedSec}s` : '';
  const logHtml = !isWaitingDecision && liveTaskLog?.text
    ? `<div class="live-task-stream-box">
        <div class="tool-section-label">${escapeHtml(t('liveTaskOutputLabel'))} · ${escapeHtml(liveTaskLog.filename || '')}</div>
        <pre class="tool-pre live-task-stream-pre">${escapeHtml(liveTaskLog.text)}</pre>
      </div>`
    : '';
  const indicatorGraphic = isWaitingDecision
    ? `<span class="status-dot decision-waiting"></span>`
    : APPLE_SPINNER_SVG;
  return `<div class="live-stream-footer${isWaitingDecision ? ' waiting-decision' : ''}">
    <div class="live-stream-indicator">
      ${indicatorGraphic}
      <span>${escapeHtml(statusText)}</span>
      <span class="live-stream-elapsed" data-stream-since="${turnRunningSinceMs || Date.now()}">${escapeHtml(elapsedStr)}</span>
    </div>
    ${logHtml}
  </div>`;
}

function buildTurnElement(turn, { theme, baseDir, expandedState, isTurnRunning, isTurnWaitingDecision = false, hookState = null, liveTaskLog = null, isLiveUpdate = false, onStreamTick = null, turnRunningSinceMs = 0 }) {
  const el = document.createElement('section');
  el.className = 'turn-block';
  el.id = turn.id;
  el.dataset.turnId = turn.id;
  const isTurnInterrupted = Boolean(turn.interrupted && !isTurnRunning && !isTurnWaitingDecision);
  const liveSig = (isTurnRunning || isTurnWaitingDecision)
    ? `${isTurnWaitingDecision ? 'wait' : (hookState?.phase || '')}:${hookState?.toolName || ''}:${liveTaskLog?.size || 0}`
    : '';
  const stateTag = isTurnWaitingDecision ? 'wait' : (isTurnRunning ? 'run' : (isTurnInterrupted ? 'canceled' : 'done'));
  el.dataset.signature = `${turnSignature(turn)}:${stateTag}:${liveSig}:${baseDir}:${getLang()}`;

  const promptText = turn.user?.request || '';
  el.dataset.promptPreview = turn.kind === 'schedule' ? '' : cleanTocSnippet(promptText, 18);
  el.dataset.promptFull = promptText.replace(/\s+/g, ' ').trim().slice(0, 140);
  if (turn.kind === 'schedule' && turn.scheduleLabel) {
    el.dataset.turnKind = 'schedule';
    el.dataset.scheduleLabel = turn.scheduleLabel;
  }

  if (turn.user) {
    // 1. Clean minimal User Input Card (metadata moved outside below!)
    const userCard = document.createElement('div');
    userCard.className = 'user-card';

    const timeStr = turn.createdAt ? new Date(turn.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const longPrompt = isLongUserPrompt(promptText);
    const promptOpen = longPrompt && expandedState.has(`${turn.id}:user-prompt`);
    if (longPrompt) userCard.dataset.promptOpen = String(Boolean(promptOpen));
    let mentionsHtml = '';
    if (turn.user.mentions?.length) {
      mentionsHtml = `<div class="mention-row">${turn.user.mentions.map((m) => {
        const sideBtn = isPreviewableFilePath(m.path)
          ? `<button type="button" class="open-sidebar-pill" data-local-href="${escapeHtml(m.path)}" data-base-dir="${escapeHtml(baseDir)}" data-preview-mode="sidebar" title="${escapeHtml(t('openInSidebarTip', { path: m.path }))}">${escapeHtml(t('openInSidebar'))}</button>`
          : '';
        return `<span class="code-link-group"><button type="button" class="mention-chip" data-local-href="${escapeHtml(m.path)}" data-base-dir="${escapeHtml(baseDir)}" data-preview-mode="popup" title="${escapeHtml(m.path)}">@${escapeHtml(m.label)}</button>${sideBtn}</span>`;
      }).join('')}</div>`;
    }

    const foldBtn = longPrompt
      ? `<button type="button" class="user-prompt-toggle" data-action="toggle-user-prompt">${escapeHtml(promptOpen ? t('showLessPrompt') : t('showMorePrompt'))}</button>`
      : '';
    userCard.innerHTML = `
      <div class="user-card-header">
        <span class="user-badge">${escapeHtml(turnBadgeText(turn))}</span>
        <span class="user-card-tools">
          <button type="button" class="code-mini-btn" data-action="save-turn" title="${escapeHtml(t('saveTurnTip'))}">${escapeHtml(t('saveTurnBtn'))}</button>
          <button type="button" class="code-mini-btn" data-action="copy-prompt" title="${escapeHtml(t('copyPromptTip'))}" ${promptText.trim() ? '' : 'hidden'}>${escapeHtml(t('copyPromptBtn'))}</button>
          <button type="button" class="code-mini-btn" data-action="copy-response" title="${escapeHtml(t('copyResponseTip'))}" hidden>${escapeHtml(t('copyResponseBtn'))}</button>
          <span class="user-card-time">${escapeHtml(timeStr)}</span>
        </span>
      </div>
      <div class="user-prompt-text">${escapeHtml(promptText || '(empty input)')}</div>
      ${foldBtn}
      ${mentionsHtml}
    `;
    el.appendChild(userCard);

    // 2. Additional Metadata placed cleanly OUTSIDE and underneath the User Card
    if (turn.user.metadataBlocks?.length) {
      const metaWrap = document.createElement('div');
      metaWrap.className = 'user-meta-outside';
      const metaKey = `${turn.id}:user-meta`;
      const open = expandedState.has(metaKey);
      const labels = turn.user.metadataBlocks.map((m) => m.label).join(' · ');

      const card = document.createElement('div');
      card.className = 'disclosure-card user-meta-card';
      card.dataset.open = String(open);
      card.dataset.disclosureKey = metaKey;

      const buildMetaBody = () => turn.user.metadataBlocks.map((mb) =>
        `<div class="meta-subblock"><div class="tool-section-label">${escapeHtml(mb.label)}</div><pre class="tool-pre">${escapeHtml(mb.content)}</pre></div>`
      ).join('');

      card.innerHTML = `
        <button type="button" class="disclosure-trigger meta-trigger" data-action="toggle-disclosure">
          ${CHEVRON_SVG}
          <span class="thinking-preview">${escapeHtml(labels)}</span>
        </button>
        <div class="thinking-body">${open ? buildMetaBody() : ''}</div>
      `;
      card._lazyContent = buildMetaBody;
      if (open) card.querySelector('.thinking-body').dataset.hydrated = 'true';
      metaWrap.appendChild(card);
      el.appendChild(metaWrap);
    }
  }

  // Partition turn items into High-Level Execution Process vs Surface Items (Final Markdown + User Decision Cards)
  const processItems = [];
  const surfaceItems = [];
  for (const item of turn.items) {
    if ((item.kind === 'markdown' && !item.intermediate) || item.kind === 'decision') {
      surfaceItems.push(item);
    } else {
      processItems.push(item);
    }
  }

  // 2.5 Live Plan Steps Checklist Card (rendered prominently above Execution process!)
  if (turn.planSteps?.steps?.length > 0) {
    const stepsCard = document.createElement('div');
    stepsCard.className = 'turn-steps-card';
    stepsCard.dataset.stepsSig = `${JSON.stringify(turn.planSteps.steps)}:${isTurnInterrupted ? '1' : '0'}`;
    stepsCard.innerHTML = renderPlanStepsCardHtml(turn.planSteps, isTurnInterrupted);
    el.appendChild(stepsCard);
  }

  // 3. High-Level Collapsible Execution Process Container (collapsed by default!)
  if (processItems.length > 0) {
    const procKey = `${turn.id}:process`;
    const procOpen = expandedState.has(procKey);
    const procCard = document.createElement('div');
    procCard.className = `process-fold-card${isTurnRunning ? ' running' : ''}${isTurnInterrupted ? ' interrupted' : ''}`;
    procCard.dataset.open = String(procOpen);
    procCard.dataset.disclosureKey = procKey;

    const procLabel = summarizeProcessItems(processItems, turn.stats, isTurnRunning, isTurnInterrupted);
    const errCount = turn.stats?.errorCount || 0;
    const badges = [];
    if (isTurnWaitingDecision) badges.push(`<span class="tool-status-pill waiting">waiting</span>`);
    else if (isTurnRunning) badges.push(`<span class="tool-status-pill running">running</span>`);
    else if (isTurnInterrupted) badges.push(`<span class="tool-status-pill canceled">${escapeHtml(t('canceledPill'))}</span>`);
    if (errCount > 0) badges.push(`<span class="tool-status-pill error">${errCount} ${errCount === 1 ? 'error' : 'errors'}</span>`);

    procCard.innerHTML = `
      <button type="button" class="process-fold-trigger" data-action="toggle-process">
        <span class="tool-group-left">
          ${CHEVRON_SVG}
          <span class="process-fold-title">${escapeHtml(procLabel)}</span>
        </span>
        <span class="tool-group-badges">${badges.join('')}</span>
      </button>
      <div class="process-fold-body"></div>
    `;

    const bodyEl = procCard.querySelector('.process-fold-body');
    const populateProcessChildren = () => {
      patchProcessBodyInPlace(bodyEl, processItems, { theme, baseDir, expandedState, isLiveUpdate: false, onStreamTick });
      bodyEl.dataset.hydrated = 'true';
    };

    procCard._hydrateProcess = populateProcessChildren;
    if (procOpen) {
      populateProcessChildren();
    }
    el.appendChild(procCard);
  }

  // 4. Surface Items: User Decision Cards & Final Assistant Markdown Responses in chronological order
  for (let i = 0; i < surfaceItems.length; i++) {
    const item = surfaceItems[i];
    const sKey = surfaceItemKey(item);
    if (item.kind === 'decision') {
      const decEl = buildDecisionCardElement(item, { baseDir, theme });
      decEl.dataset.surfaceKey = sKey;
      decEl.dataset.surfaceSig = surfaceItemSignature(item);
      el.appendChild(decEl);
    } else {
      const mdEl = document.createElement('div');
      mdEl.className = 'assistant-markdown';
      mdEl.dataset.surfaceKey = sKey;
      mdEl.dataset.stepIndex = String(item.stepIndex);
      const animateThis = Boolean(isLiveUpdate && i === surfaceItems.length - 1);
      streamMarkdownIntoNode(mdEl, item.text, { baseDir, theme, instant: !animateThis, onStreamTick });
      mdEl.dataset.surfaceSig = surfaceItemSignature(item);
      el.appendChild(mdEl);
    }
  }

  const showInterruptedBanner = isTurnInterrupted
    && !surfaceItems.some((it) => it.kind === 'markdown')
    && (turn.stats?.errorCount || 0) === 0;
  if (showInterruptedBanner) {
    const intBanner = document.createElement('div');
    intBanner.className = 'turn-interrupted-banner';
    intBanner.textContent = t('turnInterruptedNotice');
    el.appendChild(intBanner);
  }

  if (isTurnRunning || isTurnWaitingDecision) {
    const streamWrap = document.createElement('div');
    streamWrap.className = 'live-stream-slot';
    const activeToolName = findRunningToolName(turn);
    streamWrap.innerHTML = renderLiveStreamFooterHtml(isTurnRunning, hookState, liveTaskLog, turnRunningSinceMs, isTurnWaitingDecision, activeToolName);
    const pre = streamWrap.querySelector('.live-task-stream-pre');
    if (pre) pre.scrollTop = pre.scrollHeight;
    el.appendChild(streamWrap);
  }

  rememberTurnCopy(el, turn);
  return el;
}

function patchProcessBodyInPlace(bodyEl, processItems, { theme, baseDir, expandedState, isLiveUpdate = false, onStreamTick = null }) {
  if (!bodyEl) return;
  const existingById = new Map();
  Array.from(bodyEl.children).forEach((child) => {
    if (child.dataset.procItemId) {
      existingById.set(child.dataset.procItemId, child);
    }
  });

  const keepIds = new Set(processItems.map((it) => it.id));
  for (const [id, node] of existingById.entries()) {
    if (!keepIds.has(id)) node.remove();
  }

  let prevCursor = null;
  for (let idx = 0; idx < processItems.length; idx++) {
    const pItem = processItems[idx];
    const sig = processItemSignature(pItem);
    const existing = existingById.get(pItem.id);

    if (existing && existing.dataset.procItemSig === sig) {
      prevCursor = existing;
      continue;
    }

    if (existing && pItem.kind === 'markdown') {
      existing.dataset.procItemSig = sig;
      streamMarkdownIntoNode(existing, pItem.text, {
        baseDir,
        theme,
        instant: !isLiveUpdate,
        onStreamTick,
      });
      prevCursor = existing;
      continue;
    }

    const fresh = buildProcessItemNode(pItem, { theme, baseDir, expandedState });
    if (!fresh) continue;
    fresh.dataset.procItemId = pItem.id;
    fresh.dataset.procItemSig = sig;

    if (pItem.kind === 'markdown' && isLiveUpdate && idx === processItems.length - 1 && !existing) {
      fresh.innerHTML = '';
      streamMarkdownIntoNode(fresh, pItem.text, { baseDir, theme, instant: false, onStreamTick });
    }

    if (existing) {
      existing.replaceWith(fresh);
    } else if (prevCursor && prevCursor.parentElement === bodyEl) {
      prevCursor.after(fresh);
    } else {
      bodyEl.appendChild(fresh);
    }
    prevCursor = fresh;
  }
}

function patchTurnElementInPlace(existingEl, turn, { theme, baseDir, expandedState, isTurnRunning, isTurnWaitingDecision = false, hookState, liveTaskLog, sig, isLiveUpdate = false, onStreamTick = null, turnRunningSinceMs = 0 }) {
  existingEl.dataset.signature = sig;
  rememberTurnCopy(existingEl, turn);
  const isTurnInterrupted = Boolean(turn.interrupted && !isTurnRunning && !isTurnWaitingDecision);

  const processItems = [];
  const surfaceItems = [];
  for (const item of turn.items) {
    if ((item.kind === 'markdown' && !item.intermediate) || item.kind === 'decision') surfaceItems.push(item);
    else processItems.push(item);
  }

  const userAnchor = existingEl.querySelector(':scope > .user-meta-outside') || existingEl.querySelector(':scope > .user-card');

  // 0. Update or insert Live Plan Steps Checklist card in place
  let stepsCard = existingEl.querySelector(':scope > .turn-steps-card');
  if (turn.planSteps?.steps?.length > 0) {
    const nextStepsSig = `${JSON.stringify(turn.planSteps.steps)}:${isTurnInterrupted ? '1' : '0'}`;
    if (!stepsCard) {
      stepsCard = document.createElement('div');
      stepsCard.className = 'turn-steps-card';
      stepsCard.dataset.stepsSig = nextStepsSig;
      stepsCard.innerHTML = renderPlanStepsCardHtml(turn.planSteps, isTurnInterrupted);
      if (userAnchor) userAnchor.after(stepsCard);
      else existingEl.prepend(stepsCard);
    } else if (stepsCard.dataset.stepsSig !== nextStepsSig) {
      stepsCard.dataset.stepsSig = nextStepsSig;
      stepsCard.innerHTML = renderPlanStepsCardHtml(turn.planSteps, isTurnInterrupted);
    }
  } else if (stepsCard) {
    stepsCard.remove();
    stepsCard = null;
  }

  const anchorBeforeProcess = stepsCard || userAnchor;

  // 1. Update or insert collapsible Execution Process card WITHOUT collapsing or clearing unchanged children!
  let procCard = existingEl.querySelector(':scope > .process-fold-card');
  if (processItems.length > 0) {
    const procKey = `${turn.id}:process`;
    const procOpen = expandedState.has(procKey);
    const procLabel = summarizeProcessItems(processItems, turn.stats, isTurnRunning, isTurnInterrupted);
    const errCount = turn.stats?.errorCount || 0;
    const badges = [];
    if (isTurnWaitingDecision) badges.push(`<span class="tool-status-pill waiting">waiting</span>`);
    else if (isTurnRunning) badges.push(`<span class="tool-status-pill running">running</span>`);
    else if (isTurnInterrupted) badges.push(`<span class="tool-status-pill canceled">${escapeHtml(t('canceledPill'))}</span>`);
    if (errCount > 0) badges.push(`<span class="tool-status-pill error">${errCount} ${errCount === 1 ? 'error' : 'errors'}</span>`);

    if (!procCard) {
      procCard = document.createElement('div');
      procCard.className = `process-fold-card${isTurnRunning ? ' running' : ''}${isTurnInterrupted ? ' interrupted' : ''}`;
      procCard.dataset.open = String(procOpen);
      procCard.dataset.disclosureKey = procKey;
      procCard.innerHTML = `
        <button type="button" class="process-fold-trigger" data-action="toggle-process">
          <span class="tool-group-left">
            ${CHEVRON_SVG}
            <span class="process-fold-title">${escapeHtml(procLabel)}</span>
          </span>
          <span class="tool-group-badges">${badges.join('')}</span>
        </button>
        <div class="process-fold-body"></div>
      `;
      if (anchorBeforeProcess) anchorBeforeProcess.after(procCard);
      else existingEl.prepend(procCard);
    } else {
      procCard.classList.toggle('running', Boolean(isTurnRunning));
      procCard.classList.toggle('interrupted', isTurnInterrupted);
      procCard.dataset.open = String(procOpen);
      const titleEl = procCard.querySelector(':scope > .process-fold-trigger .process-fold-title');
      if (titleEl && titleEl.textContent !== procLabel) titleEl.textContent = procLabel;
      const badgeWrap = procCard.querySelector(':scope > .process-fold-trigger .tool-group-badges');
      const nextBadgesHtml = badges.join('');
      if (badgeWrap && badgeWrap.innerHTML !== nextBadgesHtml) badgeWrap.innerHTML = nextBadgesHtml;
    }

    const bodyEl = procCard.querySelector(':scope > .process-fold-body');
    procCard._hydrateProcess = () => {
      patchProcessBodyInPlace(bodyEl, processItems, { theme, baseDir, expandedState, isLiveUpdate: false, onStreamTick });
      bodyEl.dataset.hydrated = 'true';
    };
    if (procOpen && bodyEl) {
      patchProcessBodyInPlace(bodyEl, processItems, { theme, baseDir, expandedState, isLiveUpdate, onStreamTick });
      bodyEl.dataset.hydrated = 'true';
    } else if (bodyEl) {
      delete bodyEl.dataset.hydrated;
    }
  } else if (procCard) {
    procCard.remove();
    procCard = null;
  }

  // 2. Incrementally update Surface Items (Decision Cards + Assistant Markdown) in chronological order
  const existingSurfaceByKey = new Map();
  existingEl.querySelectorAll(':scope > [data-surface-key]').forEach((node) => {
    existingSurfaceByKey.set(node.dataset.surfaceKey, node);
  });

  const keepKeys = new Set(surfaceItems.map(surfaceItemKey));
  for (const [sKey, node] of existingSurfaceByKey.entries()) {
    if (!keepKeys.has(sKey)) node.remove();
  }

  let prevSurfaceAnchor = procCard || anchorBeforeProcess || null;
  const tailSlotBefore = existingEl.querySelector(':scope > .turn-interrupted-banner') || existingEl.querySelector(':scope > .live-stream-slot');

  const placeAfterAnchor = (node) => {
    if (prevSurfaceAnchor && prevSurfaceAnchor.parentElement === existingEl) {
      if (prevSurfaceAnchor.nextElementSibling !== node) {
        prevSurfaceAnchor.after(node);
      }
    } else if (tailSlotBefore) {
      existingEl.insertBefore(node, tailSlotBefore);
    } else {
      existingEl.appendChild(node);
    }
    prevSurfaceAnchor = node;
  };

  for (let i = 0; i < surfaceItems.length; i++) {
    const item = surfaceItems[i];
    const sKey = surfaceItemKey(item);
    const nextSig = surfaceItemSignature(item);
    let node = existingSurfaceByKey.get(sKey);

    if (item.kind === 'decision') {
      if (!node || node.dataset.surfaceSig !== nextSig) {
        const freshDec = buildDecisionCardElement(item, { baseDir, theme });
        freshDec.dataset.surfaceKey = sKey;
        freshDec.dataset.surfaceSig = nextSig;
        if (node) node.replaceWith(freshDec);
        node = freshDec;
      }
      placeAfterAnchor(node);
    } else {
      const shouldAnimate = Boolean(isLiveUpdate && i === surfaceItems.length - 1);
      if (!node) {
        node = document.createElement('div');
        node.className = 'assistant-markdown';
        node.dataset.surfaceKey = sKey;
        node.dataset.stepIndex = String(item.stepIndex);
        streamMarkdownIntoNode(node, item.text, { baseDir, theme, instant: !shouldAnimate, onStreamTick });
        node.dataset.surfaceSig = nextSig;
      } else if (node.dataset.surfaceSig !== nextSig) {
        streamMarkdownIntoNode(node, item.text, { baseDir, theme, instant: !shouldAnimate, onStreamTick });
        node.dataset.surfaceSig = nextSig;
      }
      placeAfterAnchor(node);
    }
  }

  // 2.8 Update or remove Interrupted Turn notice banner
  const showInterruptedBanner = isTurnInterrupted
    && !surfaceItems.some((it) => it.kind === 'markdown')
    && (turn.stats?.errorCount || 0) === 0;
  let intBanner = existingEl.querySelector(':scope > .turn-interrupted-banner');
  if (showInterruptedBanner) {
    if (!intBanner) {
      intBanner = document.createElement('div');
      intBanner.className = 'turn-interrupted-banner';
      const streamSlotExisting = existingEl.querySelector(':scope > .live-stream-slot');
      if (streamSlotExisting) existingEl.insertBefore(intBanner, streamSlotExisting);
      else existingEl.appendChild(intBanner);
    }
    intBanner.textContent = t('turnInterruptedNotice');
  } else if (intBanner) {
    intBanner.remove();
  }

  // 3. Update live execution / waiting-decision status & active command log tail
  let streamSlot = existingEl.querySelector(':scope > .live-stream-slot');
  if (isTurnRunning || isTurnWaitingDecision) {
    if (!streamSlot) {
      streamSlot = document.createElement('div');
      streamSlot.className = 'live-stream-slot';
      existingEl.appendChild(streamSlot);
    }
    const activeToolName = findRunningToolName(turn);
    streamSlot.innerHTML = renderLiveStreamFooterHtml(isTurnRunning, hookState, liveTaskLog, turnRunningSinceMs, isTurnWaitingDecision, activeToolName);
    const pre = streamSlot.querySelector('.live-task-stream-pre');
    if (pre) pre.scrollTop = pre.scrollHeight;
  } else if (streamSlot) {
    streamSlot.remove();
  }
}

function turnSignature(turn) {
  const lastItem = turn.items[turn.items.length - 1];
  const lastTextLen = lastItem?.text?.length || lastItem?.tools?.length || (lastItem?.rawAnswer || '').length || 0;
  const stepsSig = turn.planSteps?.steps ? JSON.stringify(turn.planSteps.steps) : '';
  const decisionsSig = turn.items
    .filter((it) => it.kind === 'decision')
    .map((d) => `${d.id}:${d.status}:${(d.rawAnswer || '').length}`)
    .join(',');
  return `${turn.items.length}:${turn.interrupted ? 'int' : ''}:${turn.stats.thinkingCount}:${turn.stats.toolCount}:${turn.stats.errorCount}:${lastTextLen}:${lastItem?.status || ''}:${stepsSig}:${decisionsSig}:${JSON.stringify(lastItem?.tools?.map((t) => `${t.status}:${t.durationMs}`) || [])}`;
}

export function renderCliInsightsHtml(tab, view, cliInsights, artifacts, baseDir) {
  const s = view?.summary || {};
  const ctx = s.contextWindow || {};
  const cats = ctx.categories || {};

  if (tab === 'context') {
    const limit = Math.max(1, ctx.limit || 1_000_000);
    const sysCells = Math.round(((cats.systemOverhead || 0) / limit) * 100);
    const userCells = Math.round(((cats.userMessages || 0) / limit) * 100);
    const agentCells = Math.round(((cats.agentResponses || 0) / limit) * 100);
    const toolCells = Math.round(((cats.toolCalls || 0) / limit) * 100);
    const cells = [];
    const pushCells = (cls, count) => {
      for (let i = 0; i < count && cells.length < 100; i++) cells.push(`<span class="ctx-cell ${cls}"></span>`);
    };
    pushCells('sys', sysCells);
    pushCells('user', userCells);
    pushCells('agent', agentCells);
    pushCells('tool', toolCells);
    if ((ctx.used || 0) > 0 && cells.length === 0) cells.push(`<span class="ctx-cell agent"></span>`);
    while (cells.length < 100) cells.push(`<span class="ctx-cell free"></span>`);

    const pct = ((ctx.usageRatio || 0) * 100).toFixed(1);
    const cachePct = ((ctx.cacheHitRatio || 0) * 100).toFixed(1);

    const artifactsHtml = (artifacts || []).length > 0
      ? `<div style="border-top:1px solid var(--border);padding-top:10px;display:flex;flex-direction:column;gap:6px;">
          <div class="tool-section-label">${escapeHtml(t('ctxTrackedArtifacts', { count: artifacts.length }))}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            ${artifacts.map((a) => `<span class="code-link-group"><a href="#" class="local-file-link" style="font-size:0.78rem;" data-local-href="${escapeHtml(a.path)}" data-base-dir="${escapeHtml(baseDir)}" data-preview-mode="popup">${escapeHtml(a.filename)}</a><button type="button" class="open-sidebar-pill" data-local-href="${escapeHtml(a.path)}" data-base-dir="${escapeHtml(baseDir)}" data-preview-mode="sidebar">${escapeHtml(t('openInSidebar'))}</button></span>`).join('')}
          </div>
        </div>`
      : '';

    return `
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:0.8rem;">
        <div><strong>${escapeHtml(t('ctxActiveModel'))}</strong> <code>${escapeHtml(ctx.model || 'N/A')}</code> · <strong>${formatCompactTokens(ctx.used)}</strong> / ${formatCompactTokens(ctx.limit)} tokens (${pct}%)</div>
        <div style="color:var(--text-muted);">${escapeHtml(t('ctxPromptCache'))} <strong>${cachePct}%</strong> (${formatCompactTokens(ctx.latestCacheRead)} ${escapeHtml(t('ctxCachedWord'))} · ${formatCompactTokens(ctx.latestUncachedInput)} ${escapeHtml(t('ctxNewWord'))})</div>
      </div>
      <div class="context-layout">
        <div class="context-grid-wrap">
          <div class="context-grid-10x10" title="100 cells = ${formatCompactTokens(ctx.limit)} context window">${cells.join('')}</div>
          <span style="font-size:0.69rem;color:var(--text-faint);text-align:center;">${escapeHtml(t('ctxCellHint', { tokens: formatCompactTokens(Math.round(limit / 100)) }))}</span>
        </div>
        <div class="context-breakdown-table">
          <div class="ctx-row"><span><span class="ctx-dot" style="background:#7b8494;"></span>${escapeHtml(t('ctxRowSys'))}</span><strong>${formatCompactTokens(cats.systemOverhead)}</strong></div>
          <div class="ctx-row"><span><span class="ctx-dot" style="background:var(--info);"></span>${escapeHtml(t('ctxRowUser'))}</span><strong>${formatCompactTokens(cats.userMessages)}</strong></div>
          <div class="ctx-row"><span><span class="ctx-dot" style="background:var(--accent);"></span>${escapeHtml(t('ctxRowAgent'))}</span><strong>${formatCompactTokens(cats.agentResponses)}</strong></div>
          <div class="ctx-row"><span><span class="ctx-dot" style="background:var(--warning);"></span>${escapeHtml(t('ctxRowTools'))}</span><strong>${formatCompactTokens(cats.toolCalls)}</strong></div>
          <div class="ctx-row"><span><span class="ctx-dot" style="border:1px solid var(--border-strong);background:var(--bg-surface);"></span>${escapeHtml(t('ctxRowFree'))}</span><strong>${formatCompactTokens(cats.freeSpace)}</strong></div>
          ${ctx.checkpointCount ? `<div class="ctx-row"><span>${escapeHtml(t('ctxRowCheckpoints', { count: ctx.checkpointCount }))}</span><strong>${formatCompactTokens(ctx.checkpointBufferTokens)} buffer</strong></div>` : ''}
        </div>
      </div>
      ${artifactsHtml}
    `;
  }

  if (tab === 'usage') {
    const gu = cliInsights?.globalUsage || {};
    const w5 = gu.window5h || { total: {}, families: [] };
    const w7 = gu.window7d || { total: {}, families: [] };
    const models = s.modelBreakdown || [];

    const renderWinCard = (label, win) => {
      const fams = (win.families || []).map((f) =>
        `<div style="display:flex;justify-content:space-between;font-size:0.75rem;"><span>${escapeHtml(f.family)} (${f.calls} calls)</span><strong>${formatCompactTokens(f.totalTokens)}</strong></div>`
      ).join('') || `<div style="font-size:0.75rem;color:var(--text-faint);">—</div>`;
      return `<div class="usage-window-card">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span class="tool-section-label">${escapeHtml(label)}</span>
          <span style="font-size:0.72rem;color:var(--text-muted);">${win.total?.sessions || 0} sessions · ${win.total?.calls || 0} calls</span>
        </div>
        <div style="font-size:1.02rem;font-weight:650;color:var(--text-main);">${formatCompactTokens(win.total?.totalTokens || 0)} <span style="font-size:0.74rem;font-weight:400;color:var(--text-muted);">tokens (${formatCompactTokens(win.total?.outputTokens || 0)} out)</span></div>
        ${fams}
      </div>`;
    };

    const rows = models.map((m) => `
      <tr>
        <td><code>${escapeHtml(m.model)}</code></td>
        <td>${m.calls}</td>
        <td>${formatCompactTokens(m.inputTokens)}</td>
        <td>${formatCompactTokens(m.cacheReadTokens)} (${(m.cacheHitRate * 100).toFixed(0)}%)</td>
        <td>${formatCompactTokens(m.outputTokens)}</td>
        <td><strong>${formatCompactTokens(m.totalTokens)}</strong></td>
      </tr>
    `).join('') || `<tr><td colspan="6" style="color:var(--text-faint);">—</td></tr>`;

    return `
      <div class="usage-window-grid">
        ${renderWinCard(t('usageWin5h'), w5)}
        ${renderWinCard(t('usageWin7d'), w7)}
      </div>
      <div class="tool-section-label" style="margin-top:4px;">${escapeHtml(t('usagePerModel'))}</div>
      <div class="table-wrap" style="border:1px solid var(--border);border-radius:8px;">
        <table style="width:100%;border-collapse:collapse;font-size:0.78rem;">
          <thead>
            <tr style="background:var(--bg-sidebar);text-align:left;">
              <th style="padding:6px 10px;border-bottom:1px solid var(--border);">Model</th>
              <th style="padding:6px 10px;border-bottom:1px solid var(--border);">Calls</th>
              <th style="padding:6px 10px;border-bottom:1px solid var(--border);">Uncached In</th>
              <th style="padding:6px 10px;border-bottom:1px solid var(--border);">Cache Read</th>
              <th style="padding:6px 10px;border-bottom:1px solid var(--border);">Output</th>
              <th style="padding:6px 10px;border-bottom:1px solid var(--border);">Total</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="font-size:0.73rem;color:var(--text-faint);">${t('usageTip')}</div>
    `;
  }

  // tab === 'btw'
  const cmds = (cliInsights?.btwCommands || []).filter((c) => c.isQuery);
  const notes = cliInsights?.btwNotes || [];

  const cmdItemsHtml = cmds.map((c) => {
    const tStr = c.timestamp ? new Date(c.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    const matchedNote = notes.find((n) => n.question === c.question);
    const metaBadges = [];
    if (c.status === 'answered' || matchedNote) metaBadges.push(`<span class="tool-status-pill done">answered</span>`);
    const tCount = matchedNote?.toolCount ?? c.toolCalls;
    if (tCount != null) metaBadges.push(`<span style="font-size:0.7rem;color:var(--text-faint);">${tCount} tools</span>`);
    if (c.durationText) metaBadges.push(`<span style="font-size:0.7rem;color:var(--text-faint);">${escapeHtml(c.durationText)}</span>`);
    if (tStr) metaBadges.push(`<span style="font-size:0.7rem;color:var(--text-faint);">${escapeHtml(tStr)}</span>`);

    return `<div class="btw-item-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">
        <div style="display:flex;align-items:baseline;gap:6px;flex:1;min-width:200px;">
          <span class="tool-name-pill" style="color:var(--accent);border-color:var(--accent-border);background:var(--accent-soft);">/btw</span>
          <span style="font-size:0.86rem;font-weight:600;color:var(--text-main);line-height:1.45;">${escapeHtml(c.question)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
          ${metaBadges.join('')}
          <button type="button" class="code-mini-btn" data-action="save-btw-turn" data-btw-question="${escapeHtml(c.question)}" data-btw-note-id="${escapeHtml(matchedNote?.id || '')}" title="${escapeHtml(t('saveBtwTip'))}">${escapeHtml(t('saveTurnBtn'))}</button>
          ${!matchedNote ? `<button type="button" class="code-mini-btn" data-action="prefill-btw-question" data-question="${escapeHtml(c.question)}">${escapeHtml(t('btwAttachBtn'))}</button>` : `<button type="button" class="code-mini-btn" data-action="delete-btw-note" data-note-id="${escapeHtml(matchedNote.id)}">✕</button>`}
        </div>
      </div>
      ${matchedNote
        ? `<div class="assistant-markdown" style="font-size:0.88rem;padding-top:8px;border-top:1px solid var(--border);">${renderMarkdownHtml(matchedNote.answer, { baseDir })}</div>`
        : `<div style="font-size:0.74rem;color:var(--text-faint);">${t('btwAutoHint')}</div>`}
    </div>`;
  }).join('');

  const standaloneNotesHtml = notes
    .filter((n) => !cmds.some((c) => c.question === n.question))
    .map((n) => `<div class="btw-item-card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div style="display:flex;align-items:baseline;gap:6px;">
          <span class="tool-name-pill" style="color:var(--accent);border-color:var(--accent-border);background:var(--accent-soft);">/btw</span>
          <strong style="font-size:0.85rem;">${escapeHtml(n.question || 'Saved Side Answer')}</strong>
        </div>
        <button type="button" class="code-mini-btn" data-action="save-btw-turn" data-btw-question="${escapeHtml(n.question || '')}" data-btw-note-id="${escapeHtml(n.id)}" title="${escapeHtml(t('saveBtwTip'))}">${escapeHtml(t('saveTurnBtn'))}</button>
        <button type="button" class="code-mini-btn" data-action="delete-btw-note" data-note-id="${escapeHtml(n.id)}">✕</button>
      </div>
      <div class="assistant-markdown" style="font-size:0.88rem;padding-top:8px;border-top:1px solid var(--border);">${renderMarkdownHtml(n.answer, { baseDir })}</div>
    </div>`).join('');

  return `
    ${cmdItemsHtml || standaloneNotesHtml ? (cmdItemsHtml + standaloneNotesHtml) : `<div style="font-size:0.8rem;color:var(--text-muted);">${t('btwEmpty')}</div>`}
    <details data-btw-manual-details style="margin-top:2px;">
      <summary style="cursor:pointer;font-size:0.76rem;color:var(--accent);font-weight:600;user-select:none;">${t('btwManualSummary')}</summary>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px;">
        <input type="text" class="input-sm" data-btw-q-input placeholder="${escapeHtml(t('btwQuestionPlaceholder'))}">
        <textarea class="paste-area" style="min-height:84px;" data-btw-a-input placeholder="${escapeHtml(t('btwAnswerPlaceholder'))}"></textarea>
        <div style="display:flex;justify-content:flex-end;gap:6px;">
          <button type="button" class="code-mini-btn" data-action="paste-clipboard-btw">${escapeHtml(t('btwPasteClipBtn'))}</button>
          <button type="button" class="pill-btn primary" data-action="save-btw-note">${escapeHtml(t('btwSaveBtn'))}</button>
        </div>
      </div>
    </details>
  `;
}

export class TranscriptRenderer {
  constructor(container, { theme = 'light', onLoadFullStep, onTocChanged, onSaveTurn, onSaveBtwTurn, onSaveBtwNote, onDeleteBtwNote, onStreamTick } = {}) {
    this.container = container;
    this.theme = theme;
    this.baseDir = '';
    this.onLoadFullStep = onLoadFullStep;
    this.onTocChanged = onTocChanged;
    this.onSaveTurn = onSaveTurn || null;
    this.onSaveBtwTurn = onSaveBtwTurn || null;
    this.onSaveBtwNote = onSaveBtwNote;
    this.onDeleteBtwNote = onDeleteBtwNote;
    this.onStreamTick = onStreamTick || null;
    this.expandedState = new Set();
    this.turnRunningSince = new Map();
    this.activeCliTab = null; // null | 'btw' | 'context' | 'usage'
    this.windowLimit = 35;
    this.currentConversationId = null;
    this.lastView = null;
    this.lastIsRunning = false;
    this._bindEvents();
    this._startElapsedTicker();
  }

  _startElapsedTicker() {
    this._elapsedTimer = setInterval(() => {
      if (!this.container?.isConnected) return;
      this.container.querySelectorAll('[data-stream-since]').forEach((node) => {
        const since = Number(node.dataset.streamSince) || 0;
        if (since > 0) {
          const sec = Math.max(0, Math.floor((Date.now() - since) / 1000));
          node.textContent = sec > 0 ? `${sec}s` : '';
        }
      });
    }, 1000);
  }

  setTheme(theme) {
    this.theme = theme;
  }

  setBaseDir(baseDir) {
    this.baseDir = baseDir || '';
  }

  _bindEvents() {
    this.container.addEventListener('click', async (e) => {
      if (e.target.closest('[data-local-href], [data-open-conv]')) {
        return; // Handled by attachCodeCardInteractions
      }

      const saveBtn = e.target.closest('[data-action="save-turn"]');
      if (saveBtn) {
        const turnEl = saveBtn.closest('.turn-block');
        const turn = turnEl?._savedTurn
          || this.lastView?.turns?.find((item) => item.id === turnEl?.dataset.turnId);
        if (!turn || typeof this.onSaveTurn !== 'function') return;
        saveBtn.dataset.busy = '1';
        saveBtn.textContent = t('savingTurnBtn');
        try {
          const ok = await this.onSaveTurn(turn);
          saveBtn.textContent = ok ? t('savedTurnBtn') : t('saveTurnBtn');
        } catch {
          saveBtn.textContent = t('saveTurnBtn');
        }
        setTimeout(() => {
          delete saveBtn.dataset.busy;
          if (saveBtn.isConnected) saveBtn.textContent = t('saveTurnBtn');
        }, 1400);
        return;
      }

      const copyBtn = e.target.closest('[data-action="copy-prompt"], [data-action="copy-response"]');
      if (copyBtn) {
        const turnEl = copyBtn.closest('.turn-block');
        const copyingPrompt = copyBtn.dataset.action === 'copy-prompt';
        const text = copyingPrompt ? turnEl?._copyPromptText : turnEl?._copyResponseText;
        if (!text) return;
        const ok = await writeClipboardText(text);
        if (ok) {
          const restoreLabel = copyingPrompt ? t('copyPromptBtn') : t('copyResponseBtn');
          copyBtn.dataset.busy = '1';
          copyBtn.textContent = t('copiedBtn');
          setTimeout(() => {
            delete copyBtn.dataset.busy;
            copyBtn.textContent = restoreLabel;
          }, 1300);
        }
        return;
      }

      const promptToggle = e.target.closest('[data-action="toggle-user-prompt"]');
      if (promptToggle) {
        const card = promptToggle.closest('.user-card');
        const turnEl = promptToggle.closest('.turn-block');
        if (!card || !turnEl) return;
        const key = `${turnEl.dataset.turnId}:user-prompt`;
        const nextOpen = card.dataset.promptOpen !== 'true';
        card.dataset.promptOpen = String(nextOpen);
        promptToggle.textContent = nextOpen ? t('showLessPrompt') : t('showMorePrompt');
        if (nextOpen) this.expandedState.add(key);
        else this.expandedState.delete(key);
        return;
      }

      const cliTabBtn = e.target.closest('[data-cli-tab]');
      if (cliTabBtn) {
        const nextTab = cliTabBtn.dataset.cliTab;
        if (cliTabBtn.classList.contains('cli-cmd-pill') && this.activeCliTab === nextTab) {
          this.activeCliTab = null;
        } else {
          this.activeCliTab = nextTab;
        }
        this._rerenderCurrent();
        return;
      }

      if (e.target.closest('[data-action="close-cli-insights"]')) {
        this.activeCliTab = null;
        this._rerenderCurrent();
        return;
      }

      const saveBtw = e.target.closest('[data-action="save-btw-turn"]');
      if (saveBtw && this.onSaveBtwTurn) {
        const ok = await this.onSaveBtwTurn({
          question: saveBtw.dataset.btwQuestion || '',
          noteId: saveBtw.dataset.btwNoteId || '',
        });
        if (ok) {
          saveBtw.textContent = t('savedTurnBtn');
          setTimeout(() => {
            if (saveBtw.isConnected) saveBtw.textContent = t('saveTurnBtn');
          }, 1400);
        }
        return;
      }

      const prefillBtw = e.target.closest('[data-action="prefill-btw-question"]');
      if (prefillBtw) {
        const card = this.container.querySelector('.cli-insights-card');
        const det = card?.querySelector('details');
        if (det) det.open = true;
        const qIn = card?.querySelector('[data-btw-q-input]');
        const aIn = card?.querySelector('[data-btw-a-input]');
        if (qIn) qIn.value = prefillBtw.dataset.question || '';
        try {
          const clip = await navigator.clipboard.readText();
          if (clip && aIn && !aIn.value) aIn.value = clip;
        } catch {}
        aIn?.focus();
        return;
      }

      if (e.target.closest('[data-action="paste-clipboard-btw"]')) {
        const aIn = this.container.querySelector('[data-btw-a-input]');
        try {
          const clip = await navigator.clipboard.readText();
          if (clip && aIn) aIn.value = clip;
        } catch {}
        return;
      }

      if (e.target.closest('[data-action="save-btw-note"]')) {
        const q = this.container.querySelector('[data-btw-q-input]')?.value || '';
        const a = this.container.querySelector('[data-btw-a-input]')?.value || '';
        if (a.trim() && this.onSaveBtwNote) {
          await this.onSaveBtwNote(q, a);
        }
        return;
      }

      const delBtw = e.target.closest('[data-action="delete-btw-note"]');
      if (delBtw && this.onDeleteBtwNote) {
        await this.onDeleteBtwNote(delBtw.dataset.noteId);
        return;
      }

      const procTrigger = e.target.closest('[data-action="toggle-process"]');
      if (procTrigger) {
        const card = procTrigger.closest('.process-fold-card');
        if (!card) return;
        const key = card.dataset.disclosureKey;
        const nextOpen = card.dataset.open !== 'true';
        card.dataset.open = String(nextOpen);
        if (nextOpen) {
          this.expandedState.add(key);
          const body = card.querySelector(':scope > .process-fold-body');
          if (body && !body.dataset.hydrated && card._hydrateProcess) {
            card._hydrateProcess();
          }
        } else {
          this.expandedState.delete(key);
        }
        return;
      }

      const disclosureTrigger = e.target.closest('[data-action="toggle-disclosure"]');
      if (disclosureTrigger) {
        const card = disclosureTrigger.closest('[data-disclosure-key]');
        if (!card) return;
        const nextOpen = card.dataset.open !== 'true';
        card.dataset.open = String(nextOpen);
        if (nextOpen) {
          this.expandedState.add(card.dataset.disclosureKey);
          const body = card.querySelector(':scope > .thinking-body');
          if (body && !body.dataset.hydrated && card._lazyContent) {
            body.innerHTML = card._lazyContent();
            body.dataset.hydrated = 'true';
            enhanceMarkdownDom(body, this.theme);
          }
        } else {
          this.expandedState.delete(card.dataset.disclosureKey);
        }
        return;
      }

      const groupTrigger = e.target.closest('[data-action="toggle-tool-group"]');
      if (groupTrigger) {
        const card = groupTrigger.closest('.tool-group-card');
        if (!card) return;
        const nextOpen = card.dataset.open !== 'true';
        card.dataset.open = String(nextOpen);
        if (nextOpen) this.expandedState.add(card.dataset.disclosureKey);
        else this.expandedState.delete(card.dataset.disclosureKey);
        return;
      }

      const rowTrigger = e.target.closest('[data-action="toggle-tool-row"]');
      if (rowTrigger) {
        const row = rowTrigger.closest('.tool-row');
        if (!row) return;
        const nextOpen = row.dataset.open !== 'true';
        row.dataset.open = String(nextOpen);
        if (nextOpen) {
          this.expandedState.add(row.dataset.disclosureKey);
          const detail = row.querySelector(':scope > .tool-row-detail');
          if (detail && !detail.dataset.hydrated && row._lazyContent) {
            detail.innerHTML = row._lazyContent();
            detail.dataset.hydrated = 'true';
          }
        } else {
          this.expandedState.delete(row.dataset.disclosureKey);
        }
        return;
      }

      const loadMoreBtn = e.target.closest('[data-action="load-earlier-turns"]');
      if (loadMoreBtn) {
        this.windowLimit += 40;
        this._rerenderCurrent();
        return;
      }

      const loadFullBtn = e.target.closest('[data-action="load-full-step"]');
      if (loadFullBtn && this.onLoadFullStep) {
        const stepIdx = Number(loadFullBtn.dataset.step);
        const pre = loadFullBtn.closest('.tool-row-detail')?.querySelector('[data-tool-output-pre]');
        loadFullBtn.disabled = true;
        loadFullBtn.textContent = 'Loading…';
        try {
          const full = await this.onLoadFullStep(stepIdx);
          if (pre && full?.content != null) {
            pre.textContent = full.content;
          }
          loadFullBtn.remove();
        } catch {
          loadFullBtn.textContent = 'Retry load';
          loadFullBtn.disabled = false;
        }
      }
    });
  }

  expandAll() {
    this.container.querySelectorAll('.process-fold-card').forEach((procCard) => {
      procCard.dataset.open = 'true';
      if (procCard.dataset.disclosureKey) this.expandedState.add(procCard.dataset.disclosureKey);
      const body = procCard.querySelector(':scope > .process-fold-body');
      if (body && !body.dataset.hydrated && procCard._hydrateProcess) {
        procCard._hydrateProcess();
      }
    });
    this.container.querySelectorAll('.disclosure-card, .tool-group-card, .tool-row').forEach((node) => {
      node.dataset.open = 'true';
      if (node.dataset.disclosureKey) this.expandedState.add(node.dataset.disclosureKey);
      const body = node.querySelector(':scope > .thinking-body, :scope > .tool-row-detail');
      if (body && !body.dataset.hydrated && node._lazyContent) {
        body.innerHTML = node._lazyContent();
        body.dataset.hydrated = 'true';
        enhanceMarkdownDom(body, this.theme);
      }
    });
  }

  collapseAll() {
    this.expandedState.clear();
    this.container.querySelectorAll('.process-fold-card, .disclosure-card, .tool-group-card, .tool-row').forEach((node) => {
      node.dataset.open = 'false';
    });
  }

  _rerenderCurrent() {
    if (!this.lastView) return;
    this.render(this.currentConversationId, this.lastView, {
      isRunning: this.lastIsRunning,
      hookState: this.lastHookState,
      liveTaskLog: this.lastLiveTaskLog,
      baseDir: this.baseDir,
      subagents: this.lastSubagents,
      parentSession: this.lastParentSession,
      cliInsights: this.lastCliInsights,
      artifacts: this.lastArtifacts,
    });
  }

  expandWindowForSearch() {
    const total = this.lastView?.turns?.length || 0;
    if (total > this.windowLimit) {
      this.windowLimit = total;
      this._rerenderCurrent();
    }
  }

  render(convId, view, { isRunning = false, isLiveUpdate = false, hookState = null, liveTaskLog = null, baseDir, subagents = [], parentSession = null, cliInsights = null, artifacts = [] } = {}) {
    if (baseDir !== undefined) this.baseDir = baseDir || '';
    this.lastSubagents = subagents;
    this.lastParentSession = parentSession;
    this.lastHookState = hookState;
    this.lastLiveTaskLog = liveTaskLog;
    if (cliInsights !== null) this.lastCliInsights = cliInsights;
    if (artifacts) this.lastArtifacts = artifacts;
    if (convId !== this.currentConversationId) {
      this.currentConversationId = convId;
      this.expandedState.clear();
      this.turnRunningSince.clear();
      this.activeCliTab = null;
      this.windowLimit = 35;
      this.container.innerHTML = '';
    }
    this.lastView = view;
    this.lastIsRunning = isRunning;

    const turns = view?.turns || [];
    if (turns.length === 0) {
      this.container.innerHTML = `<div class="empty-state"><strong>Empty conversation</strong><span>Waiting for the first message or tool output…</span></div>`;
      this.onTocChanged?.([]);
      return;
    }

    const startIdx = Math.max(0, turns.length - this.windowLimit);
    const visibleTurns = turns.slice(startIdx);
    const lastTurn = turns[turns.length - 1];

    const isWaitingSummary = view?.summary?.activeStatus === 'waiting_decision';
    const isCanceledSummary = view?.summary?.activeStatus === 'canceled';
    const hookStopped = hookState?.phase === 'stopped';

    // Track elapsed start time for the actively running / waiting-decision turn (NEVER forcibly collapse user-expanded process cards!)
    for (const turn of visibleTurns) {
      const tailItem = turn.items[turn.items.length - 1];
      const endedWithFinalReply = Boolean(tailItem?.kind === 'markdown' && !tailItem.intermediate && view?.summary?.activeStatus !== 'running');
      const turnWaiting = Boolean(turn.id === lastTurn?.id && isWaitingSummary);
      const turnRunning = Boolean(
        turn.id === lastTurn?.id &&
        !turnWaiting &&
        !isCanceledSummary &&
        !hookStopped &&
        (isRunning || view?.summary?.activeStatus === 'running') &&
        !endedWithFinalReply
      );
      if (turnRunning || turnWaiting) {
        if (!this.turnRunningSince.has(turn.id)) {
          const decCreatedMs = turnWaiting && view?.summary?.pendingDecision?.createdAt
            ? (Date.parse(view.summary.pendingDecision.createdAt) || Date.now())
            : 0;
          this.turnRunningSince.set(turn.id, decCreatedMs || hookState?.updatedAt || Date.now());
        }
      } else {
        this.turnRunningSince.delete(turn.id);
      }
    }

    let ribbon = this.container.querySelector(':scope > .session-ribbon');
    if (!ribbon) {
      ribbon = document.createElement('div');
      ribbon.className = 'session-ribbon';
      this.container.prepend(ribbon);
    }
    const s = view.summary || {};
    const totalTokens = (s.totalInputTokens || 0) + (s.totalCacheReadTokens || 0) + (s.totalOutputTokens || 0);
    const parentLinkHtml = parentSession
      ? `<button type="button" class="open-sidebar-pill" data-open-conv="${escapeHtml(parentSession.id)}">${escapeHtml(t('parentBtn', { title: parentSession.title.slice(0, 32) }))}</button>`
      : '';
    const workspaceFolderBtnHtml = this.baseDir
      ? `<button type="button" class="code-mini-btn" data-reveal-workspace="${escapeHtml(this.baseDir)}" title="${escapeHtml(t('openFolderTip'))}">${escapeHtml(t('openFolderBtn'))}</button>`
      : '';
    ribbon.innerHTML = `
      <div class="ribbon-stats">
        ${parentLinkHtml}
        <span class="ribbon-stat"><strong>${s.totalTurns || 0}</strong> ${escapeHtml(t('turnsStat'))}</span>
        <span class="ribbon-stat"><strong>${s.totalSteps || 0}</strong> ${escapeHtml(t('stepsStat'))}</span>
        <span class="ribbon-stat"><strong>${s.totalToolCalls || 0}</strong> ${escapeHtml(t('toolsStat'))}</span>
        ${subagents.length > 0 ? `<span class="ribbon-stat"><strong>${subagents.length}</strong> ${escapeHtml(t('subagentsStat'))}</span>` : ''}
        ${s.totalErrors ? `<span class="ribbon-stat" style="color:var(--error);"><strong>${s.totalErrors}</strong> ${escapeHtml(t('errorsStat'))}</span>` : ''}
        ${totalTokens > 0 ? `<span class="ribbon-stat"><strong>${formatCompactTokens(totalTokens)}</strong> ${escapeHtml(t('tokensStat'))}</span>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:0.72rem;color:var(--text-faint);">${escapeHtml(t('autoCollapsedNote'))}</span>
        ${workspaceFolderBtnHtml}
      </div>
    `;

    // Subagents collapsible overview card inside Session Preview (collapsed by default!)
    let subBanner = this.container.querySelector(':scope > .subagents-preview-card');
    if (subagents.length > 0) {
      const subKey = `${convId}:subagents-banner`;
      const subOpen = this.expandedState.has(subKey);
      if (!subBanner) {
        subBanner = document.createElement('div');
        subBanner.className = 'process-fold-card subagents-preview-card';
        ribbon.after(subBanner);
      }
      subBanner.dataset.open = String(subOpen);
      subBanner.dataset.disclosureKey = subKey;
      subBanner.innerHTML = `
        <button type="button" class="process-fold-trigger" data-action="toggle-process">
          <span class="tool-group-left">
            ${CHEVRON_SVG}
            <span class="process-fold-title">${escapeHtml(t('subagentsBannerTitle', { count: subagents.length }))}</span>
          </span>
          <span class="tool-status-pill done">${subagents.length}</span>
        </button>
        <div class="process-fold-body" data-hydrated="true">
          ${subagents.map((sub) => `
            <div class="subagent-inline-item">
              <div style="min-width:0;flex:1;">
                <div style="font-size:0.8rem;font-weight:550;color:var(--text-main);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(sub.title)}</div>
                <div style="font-size:0.71rem;color:var(--text-faint);">${escapeHtml(sub.agentName || 'subagent')} · ${sub.stepCount || 0} ${escapeHtml(t('stepsStat'))} · ${escapeHtml(sub.id.slice(0, 8))}</div>
              </div>
              <button type="button" class="open-sidebar-pill" data-open-conv="${escapeHtml(sub.id)}">${escapeHtml(t('openSubagentBtn'))}</button>
            </div>
          `).join('')}
        </div>
      `;
    } else if (subBanner) {
      subBanner.remove();
    }

    const anchorAfterRibbon = subBanner && subBanner.parentElement ? subBanner : ribbon;
    let loadBtn = this.container.querySelector(':scope > .load-earlier-btn');
    if (startIdx > 0) {
      if (!loadBtn) {
        loadBtn = document.createElement('button');
        loadBtn.type = 'button';
        loadBtn.className = 'load-earlier-btn';
        loadBtn.dataset.action = 'load-earlier-turns';
        anchorAfterRibbon.after(loadBtn);
      }
      loadBtn.textContent = t('showEarlierTurns', { count: startIdx });
    } else if (loadBtn) {
      loadBtn.remove();
    }

    const existingById = new Map();
    this.container.querySelectorAll(':scope > .turn-block').forEach((node) => {
      existingById.set(node.dataset.turnId, node);
    });

    const visibleIds = new Set(visibleTurns.map((t) => t.id));
    for (const [id, node] of existingById.entries()) {
      if (!visibleIds.has(id)) node.remove();
    }

    for (const turn of visibleTurns) {
      const tailItem = turn.items[turn.items.length - 1];
      const endedWithFinalReply = Boolean(tailItem?.kind === 'markdown' && !tailItem.intermediate && view?.summary?.activeStatus !== 'running');
      const isTurnWaitingDecision = Boolean(turn.id === lastTurn?.id && isWaitingSummary);
      const isTurnRunning = Boolean(
        turn.id === lastTurn?.id &&
        !isTurnWaitingDecision &&
        !isCanceledSummary &&
        !hookStopped &&
        (isRunning || view?.summary?.activeStatus === 'running') &&
        !endedWithFinalReply
      );
      const isTurnInterrupted = Boolean(turn.interrupted && !isTurnRunning && !isTurnWaitingDecision);
      const liveSig = (isTurnRunning || isTurnWaitingDecision)
        ? `${isTurnWaitingDecision ? 'wait' : (hookState?.phase || '')}:${hookState?.toolName || ''}:${liveTaskLog?.size || 0}`
        : '';
      const stateTag = isTurnWaitingDecision ? 'wait' : (isTurnRunning ? 'run' : (isTurnInterrupted ? 'canceled' : 'done'));
      const sig = `${turnSignature(turn)}:${stateTag}:${liveSig}:${this.baseDir}:${getLang()}`;
      const existing = existingById.get(turn.id);
      if (existing && existing.dataset.signature === sig) {
        continue;
      }
      const turnRunningSinceMs = this.turnRunningSince.get(turn.id) || 0;
      const animateTurn = Boolean(isLiveUpdate && turn.id === lastTurn?.id);
      if (existing) {
        patchTurnElementInPlace(existing, turn, {
          theme: this.theme,
          baseDir: this.baseDir,
          expandedState: this.expandedState,
          isTurnRunning,
          isTurnWaitingDecision,
          hookState,
          liveTaskLog,
          sig,
          isLiveUpdate: animateTurn,
          onStreamTick: this.onStreamTick,
          turnRunningSinceMs,
        });
      } else {
        const freshNode = buildTurnElement(turn, {
          theme: this.theme,
          baseDir: this.baseDir,
          expandedState: this.expandedState,
          isTurnRunning,
          isTurnWaitingDecision,
          hookState,
          liveTaskLog,
          isLiveUpdate: animateTurn,
          onStreamTick: this.onStreamTick,
          turnRunningSinceMs,
        });
        this.container.appendChild(freshNode);
      }
    }

    this.onTocChanged?.(this.extractToc());
  }

  extractToc() {
    const items = [];
    const seenIds = new Set();
    let headingIdx = 0;
    this.container.querySelectorAll('.turn-block').forEach((turnEl) => {
      const badge = turnEl.querySelector('.user-badge')?.textContent || turnEl.id;
      const scheduleLabel = turnEl.dataset.scheduleLabel || '';
      const snippet = turnEl.dataset.promptPreview || '';
      const fullTitle = scheduleLabel
        ? (turnEl.dataset.promptFull ? `${scheduleLabel}: ${turnEl.dataset.promptFull}` : scheduleLabel)
        : (turnEl.dataset.promptFull ? `${badge}: ${turnEl.dataset.promptFull}` : badge);
      const label = scheduleLabel || (snippet ? `${badge} · ${snippet}` : badge);
      seenIds.add(turnEl.id);
      items.push({ id: turnEl.id, label, fullTitle, level: 0, isTurn: true });
      turnEl.querySelectorAll(':scope > .assistant-markdown').forEach((mdEl, mdIdx) => {
        const headings = mdEl.querySelectorAll('h1, h2, h3, h4, h5, h6');
        if (!headings.length) {
          appendLeadOutlineItem(items, mdEl, {
            anchorId: `${turnEl.id}-lead-${mdEl.dataset.stepIndex || mdIdx}`,
            level: 2,
            seenIds,
          });
          return;
        }
        clearLeadAnchor(mdEl);
        headings.forEach((h) => {
          if (!h.id || seenIds.has(h.id)) {
            const baseSlug = h.id || `hd-${++headingIdx}`;
            h.id = `${turnEl.id}-${baseSlug}`;
          }
          seenIds.add(h.id);
          const level = Math.min(3, Number(h.tagName.slice(1)) || 1);
          const txt = h.textContent.trim();
          items.push({ id: h.id, label: txt, fullTitle: txt, level, isTurn: false });
        });
      });
    });
    return items;
  }
}
