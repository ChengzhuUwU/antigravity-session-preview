import { applyStaticI18n, getLang, setLang, t } from './i18n.js';
import {
  escapeHtml,
  slugifyHeading,
  anchorProbe,
  isAnchorMarkup,
  locateAnchorProbe,
  renderMarkdownHtml,
  enhanceMarkdownDom,
  attachCodeCardInteractions,
  bindPanZoomViewport,
  downloadSvgElement,
  rethemeMermaidDiagrams,
  relayoutMarkdownTables,
} from './markdown.js';
import {
  APPLE_SPINNER_SVG,
  renderCustomPdfViewer,
  renderWordViewer,
  renderSpreadsheetViewer,
  renderPresentationViewer,
} from './doc-viewers.js';
import { TranscriptRenderer, appendLeadOutlineItem, buildBtwSavedTurn, btwForkConversationId, formatCompactTokens, renderCliInsightsHtml } from './transcript-view.js';
import { createSidebarOrder, noteSidebarRoster, sortGroupsBySidebarOrder } from './sidebar-order.js';
import { folderShowsUnread, nextConversationReadState } from './read-state.js';

const isSidecar = Boolean(window.sidecar && typeof window.sidecar.fetch === 'function');
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const CHEVRON_SVG = `<svg class="chevron-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5L10.5 8 6 12.5"/></svg>`;

const THEME_PALETTES = [
  { id: 'parchment', lightBg: '#faf9f5', darkBg: '#141413', accent: '#c96442' },
  { id: 'lavender', lightBg: '#f8f6fc', darkBg: '#14121b', accent: '#7c5cbf' },
  { id: 'sakura', lightBg: '#fcf6f8', darkBg: '#191215', accent: '#c9597a' },
  { id: 'matcha', lightBg: '#f5f9f6', darkBg: '#111714', accent: '#3b825f' },
  { id: 'glacier', lightBg: '#f4f8fc', darkBg: '#11161d', accent: '#3874b5' },
  { id: 'amber', lightBg: '#fcf8f2', darkBg: '#181410', accent: '#b87328' },
  { id: 'celadon', lightBg: '#f3f9f9', darkBg: '#101718', accent: '#298088' },
  { id: 'slate', lightBg: '#f8f9fa', darkBg: '#121316', accent: '#475569' },
];

const DEFAULT_CUSTOM_COLORS = {
  lightBg: '#f5f7fc',
  darkBg: '#131722',
  accent: '#3b6df6',
};

const DEFAULT_FONT_SIZE = 15;
const MIN_FONT_SIZE = 12;
const MAX_FONT_SIZE = 24;

const LATIN_FONTS = [
  { id: 'sans', i18nKey: 'fontSans', previewStack: 'var(--latin-sans), var(--cjk-sans)' },
  { id: 'serif', i18nKey: 'fontSerif', previewStack: 'var(--latin-serif), var(--cjk-serif)' },
  { id: 'times', i18nKey: 'fontTimes', previewStack: 'var(--latin-times), var(--cjk-songti)' },
];

const CJK_FONTS = [
  { id: 'sans', i18nKey: 'fontCjkSans', previewStack: 'var(--cjk-sans)' },
  { id: 'serif', i18nKey: 'fontCjkSerif', previewStack: 'var(--cjk-serif)' },
  { id: 'songti', i18nKey: 'fontSongti', previewStack: 'var(--cjk-songti)' },
  { id: 'kaiti', i18nKey: 'fontKaiti', previewStack: 'var(--cjk-kaiti)' },
  { id: 'fangsong', i18nKey: 'fontFangsong', previewStack: 'var(--cjk-fangsong)' },
];

function isValidHex(str) {
  return typeof str === 'string' && /^#[0-9a-fA-F]{6}$/.test(str.trim());
}

function isCustomPaletteId(id) {
  return typeof id === 'string' && id.startsWith('custom-');
}

function sanitizeClientCustomPalettes(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id || '').trim();
    if (!isCustomPaletteId(id) || seen.has(id)) continue;
    const lightBg = isValidHex(item.lightBg) ? item.lightBg.trim().toLowerCase() : DEFAULT_CUSTOM_COLORS.lightBg;
    const darkBg = isValidHex(item.darkBg) ? item.darkBg.trim().toLowerCase() : DEFAULT_CUSTOM_COLORS.darkBg;
    const accent = isValidHex(item.accent) ? item.accent.trim().toLowerCase() : DEFAULT_CUSTOM_COLORS.accent;
    const name = String(item.name || '').trim().slice(0, 40) || 'Custom';
    seen.add(id);
    out.push({ id, name, lightBg, darkBg, accent });
  }
  return out;
}

function loadCustomPalettes() {
  try {
    const rawList = localStorage.getItem('amp-custom-palettes-v1');
    if (rawList !== null) {
      return sanitizeClientCustomPalettes(JSON.parse(rawList));
    }
    // Seamless one-time migration from legacy single-slot `amp-custom-rgb`
    const legacyRaw = localStorage.getItem('amp-custom-rgb');
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw);
      const migrated = sanitizeClientCustomPalettes([
        {
          id: 'custom-1',
          name: getLang() === 'zh' ? '自定义配色 1' : 'Custom 1',
          lightBg: legacy?.lightBg,
          darkBg: legacy?.darkBg,
          accent: legacy?.accent,
        },
      ]);
      localStorage.setItem('amp-custom-palettes-v1', JSON.stringify(migrated));
      if (localStorage.getItem('amp-palette') === 'custom' && migrated.length > 0) {
        localStorage.setItem('amp-palette', migrated[0].id);
      }
      return migrated;
    }
  } catch {}
  return [];
}

function loadInitialFontSize() {
  const n = Number(localStorage.getItem('amp-font-size'));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_FONT_SIZE;
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(n)));
}

function loadInitialTypography() {
  const rawProse = localStorage.getItem('amp-prose') || 'sans';
  let rawCjk = localStorage.getItem('amp-prose-cjk') || '';
  if (rawCjk === 'hei') rawCjk = 'sans';
  let latin = rawProse;
  if (['songti', 'kaiti', 'fangsong'].includes(rawProse)) {
    latin = 'times';
    if (!rawCjk) rawCjk = rawProse;
  }
  if (!LATIN_FONTS.some((f) => f.id === latin)) latin = 'sans';
  const cjk = CJK_FONTS.some((f) => f.id === rawCjk) ? rawCjk : 'sans';
  return { latin, cjk };
}

function clampByte(n) {
  const v = Math.round(Number(n) || 0);
  return Math.max(0, Math.min(255, v));
}

function hexToRgb(hex) {
  const clean = String(hex || '').replace('#', '').trim();
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16) || 0,
      g: parseInt(clean[1] + clean[1], 16) || 0,
      b: parseInt(clean[2] + clean[2], 16) || 0,
    };
  }
  return {
    r: parseInt(clean.slice(0, 2), 16) || 0,
    g: parseInt(clean.slice(2, 4), 16) || 0,
    b: parseInt(clean.slice(4, 6), 16) || 0,
  };
}

function rgbToHex(r, g, b) {
  const to2 = (v) => clampByte(v).toString(16).padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

function mixRgb(c1, c2, ratioC2) {
  const w = Math.max(0, Math.min(1, ratioC2));
  return {
    r: clampByte(c1.r * (1 - w) + c2.r * w),
    g: clampByte(c1.g * (1 - w) + c2.g * w),
    b: clampByte(c1.b * (1 - w) + c2.b * w),
  };
}

function rgbLuminance({ r, g, b }) {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

const CUSTOM_CSS_PROPS = [
  '--bg-canvas', '--bg-sidebar', '--bg-surface', '--bg-subtle', '--bg-hover',
  '--bg-code', '--bg-code-header', '--border', '--border-strong',
  '--text-main', '--text-muted', '--text-faint', '--accent', '--accent-hover',
];

function clearCustomPaletteCssVars() {
  const rootStyle = document.documentElement.style;
  for (const prop of CUSTOM_CSS_PROPS) {
    rootStyle.removeProperty(prop);
  }
}

function applyCustomPaletteCssVars(bgHex, accentHex) {
  const bg = hexToRgb(bgHex);
  const acc = hexToRgb(accentHex);
  const lum = rgbLuminance(bg);
  const isDarkSurface = lum < 0.46;
  const white = { r: 255, g: 255, b: 255 };
  const black = { r: 16, g: 18, b: 22 };
  const rootStyle = document.documentElement.style;

  if (!isDarkSurface) {
    const tintedDark = mixRgb({ r: 28, g: 30, b: 36 }, acc, 0.08);
    const shadeTarget = mixRgb(black, acc, 0.14);
    rootStyle.setProperty('--bg-canvas', rgbToHex(bg.r, bg.g, bg.b));
    rootStyle.setProperty('--bg-surface', rgbToHex(...Object.values(mixRgb(bg, white, 0.72))));
    rootStyle.setProperty('--bg-sidebar', rgbToHex(...Object.values(mixRgb(bg, shadeTarget, 0.045))));
    rootStyle.setProperty('--bg-subtle', rgbToHex(...Object.values(mixRgb(bg, shadeTarget, 0.075))));
    rootStyle.setProperty('--bg-hover', rgbToHex(...Object.values(mixRgb(bg, shadeTarget, 0.12))));
    rootStyle.setProperty('--bg-code', rgbToHex(...Object.values(mixRgb(bg, shadeTarget, 0.035))));
    rootStyle.setProperty('--bg-code-header', rgbToHex(...Object.values(mixRgb(bg, shadeTarget, 0.08))));
    rootStyle.setProperty('--border', rgbToHex(...Object.values(mixRgb(bg, shadeTarget, 0.13))));
    rootStyle.setProperty('--border-strong', rgbToHex(...Object.values(mixRgb(bg, shadeTarget, 0.22))));
    rootStyle.setProperty('--text-main', rgbToHex(tintedDark.r, tintedDark.g, tintedDark.b));
    rootStyle.setProperty('--text-muted', rgbToHex(...Object.values(mixRgb(tintedDark, bg, 0.34))));
    rootStyle.setProperty('--text-faint', rgbToHex(...Object.values(mixRgb(tintedDark, bg, 0.56))));
    rootStyle.setProperty('--accent', rgbToHex(acc.r, acc.g, acc.b));
    rootStyle.setProperty('--accent-hover', rgbToHex(...Object.values(mixRgb(acc, black, 0.14))));
  } else {
    const crispLight = mixRgb({ r: 240, g: 242, b: 246 }, acc, 0.06);
    const liftTarget = mixRgb(white, acc, 0.12);
    rootStyle.setProperty('--bg-canvas', rgbToHex(bg.r, bg.g, bg.b));
    rootStyle.setProperty('--bg-sidebar', rgbToHex(...Object.values(mixRgb(bg, liftTarget, 0.045))));
    rootStyle.setProperty('--bg-surface', rgbToHex(...Object.values(mixRgb(bg, liftTarget, 0.08))));
    rootStyle.setProperty('--bg-subtle', rgbToHex(...Object.values(mixRgb(bg, liftTarget, 0.115))));
    rootStyle.setProperty('--bg-hover', rgbToHex(...Object.values(mixRgb(bg, liftTarget, 0.165))));
    rootStyle.setProperty('--bg-code', rgbToHex(...Object.values(mixRgb(bg, liftTarget, 0.03))));
    rootStyle.setProperty('--bg-code-header', rgbToHex(...Object.values(mixRgb(bg, liftTarget, 0.065))));
    rootStyle.setProperty('--border', rgbToHex(...Object.values(mixRgb(bg, liftTarget, 0.13))));
    rootStyle.setProperty('--border-strong', rgbToHex(...Object.values(mixRgb(bg, liftTarget, 0.22))));
    rootStyle.setProperty('--text-main', rgbToHex(crispLight.r, crispLight.g, crispLight.b));
    rootStyle.setProperty('--text-muted', rgbToHex(...Object.values(mixRgb(crispLight, bg, 0.32))));
    rootStyle.setProperty('--text-faint', rgbToHex(...Object.values(mixRgb(crispLight, bg, 0.54))));
    rootStyle.setProperty('--accent', rgbToHex(acc.r, acc.g, acc.b));
    rootStyle.setProperty('--accent-hover', rgbToHex(...Object.values(mixRgb(acc, white, 0.16))));
  }
  return isDarkSurface ? 'dark' : 'light';
}

function initialThemeMode() {
  const saved = localStorage.getItem('amp-theme');
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function loadCachedPinnedIds() {
  try {
    const arr = JSON.parse(localStorage.getItem('amp-pinned-sessions') || '[]');
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string' && x) : [];
  } catch {
    return [];
  }
}

function loadSessionReadState() {
  try {
    const raw = JSON.parse(localStorage.getItem('amp-session-read-state-v1') || 'null');
    if (raw && raw.initialized && typeof raw.seenSteps === 'object' && raw.seenSteps !== null) {
      return {
        initialized: true,
        seenSteps: { ...raw.seenSteps },
        unreadIds: new Set(Array.isArray(raw.unreadIds) ? raw.unreadIds.filter(Boolean) : []),
      };
    }
  } catch {}
  return { initialized: false, seenSteps: {}, unreadIds: new Set() };
}

const initialReadState = loadSessionReadState();
const initialCustomPalettes = loadCustomPalettes();
const rawSavedPalette = localStorage.getItem('amp-palette') || 'parchment';
const resolvedInitialPalette = rawSavedPalette === 'custom'
  ? (initialCustomPalettes[0]?.id || 'parchment')
  : rawSavedPalette;

const initialTypography = loadInitialTypography();

const state = {
  mode: 'sessions', // 'sessions' | 'docs'
  flavor: localStorage.getItem('amp-flavor') || 'antigravity-cli',
  availableFlavors: [],
  sidebarSource: 'sessions', // 'sessions' | 'saved-turns'
  savedTurns: [],
  activeSavedTurnId: null,
  theme: initialThemeMode(), // 'light' | 'dark'
  palette: resolvedInitialPalette, // 8 presets | 'custom-<id>'
  customPalettes: initialCustomPalettes,
  rgbActiveSlot: 'bg', // 'bg' | 'accent'
  renamingPaletteId: null,
  fontSize: loadInitialFontSize(),
  openFontPicker: null, // null | 'latin' | 'cjk'
  width: localStorage.getItem('amp-width') || 'normal',
  tables: localStorage.getItem('amp-tables') || 'compact',
  prose: initialTypography.latin,
  proseCjk: initialTypography.cjk,
  autoFollow: true,
  activeConvId: null,
  activePreviewId: localStorage.getItem('amp-last-preview') || null,
  currentBaseDir: '',
  docsStoragePath: '',
  conversations: [],
  readStateInitialized: initialReadState.initialized,
  seenSessionSteps: initialReadState.seenSteps,
  unreadConvIds: initialReadState.unreadIds,
  prevRunningIds: new Set(),
  pinnedIds: loadCachedPinnedIds(),
  pinnedGroupOpen: true,
  allProjectKeys: [],
  anyProjectOpen: true,
  customPreviews: [],
  projectExpanded: new Map(),
  showOlderInProject: new Set(),
  expandedSubagentGroups: new Set(),
  docsManageMode: false,
  renamingDocId: null,
  dragDocId: null,
  currentViewData: null,
  currentCustomDoc: null,
  eventSource: null,
  findHits: [],
  findIndex: -1,
  sideHistory: [],
  sideHistoryIdx: -1,
  sideCurrent: null,
  popupCurrent: null,
  sideByConv: new Map(),
  cliToolByConv: new Map(),
  activeCliToolTab: null,
  authRequired: false,
  authenticated: true,
  serverBootId: null,
  navSeq: 0,
  popupReqSeq: 0,
  sideReqSeq: 0,
  sidebarPointerInside: false,
  sidebarMouseDown: false,
  sidebarDirtyWhileHovered: false,
  sidebarOrder: createSidebarOrder(),
  filePickerAvailable: true,
  mdSource: localStorage.getItem('amp-md-source') === '1',
  pendingFocusTarget: null,
  pendingDecisionAlert: null,
  seenDecisionKeys: (() => {
    try {
      const arr = JSON.parse(sessionStorage.getItem('amp-seen-decisions-v1') || '[]');
      return new Set(Array.isArray(arr) ? arr.filter(Boolean) : []);
    } catch {
      return new Set();
    }
  })(),
};

const el = (id) => document.getElementById(id);

let toastTimer = null;
let toastHoverPaused = false;

function hideToast() {
  const node = el('app-toast');
  if (!node) return;
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  state.pendingFocusTarget = null;
  state.pendingDecisionAlert = null;
  node.classList.remove('error', 'actionable', 'decision-alert');
  node.classList.add('hidden');
}

function showToast(msg, isError = false) {
  const node = el('app-toast');
  if (!node) return;
  state.pendingFocusTarget = null;
  state.pendingDecisionAlert = null;
  node.classList.remove('actionable', 'decision-alert', 'hidden');
  node.textContent = msg;
  node.classList.toggle('error', Boolean(isError));
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastTimer = null;
    node.classList.add('hidden');
  }, 3200);
}

function scheduleSwitchToastAutoHide(delayMs = 9500) {
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastTimer = null;
    if (toastHoverPaused) return;
    hideToast();
  }, delayMs);
}

function showSwitchPromptToast(target) {
  const node = el('app-toast');
  if (!node || !target) return;
  state.pendingFocusTarget = target;
  state.pendingDecisionAlert = null;
  const isDoc = Boolean(target.previewId);
  const resolvedTitle = (target.title || '').trim() || (
    isDoc
      ? (state.customPreviews.find((d) => d.id === target.previewId)?.title || target.previewId)
      : (state.conversations.find((c) => c.id === target.conversationId)?.title || String(target.conversationId || '').slice(0, 8))
  );
  const msgText = isDoc
    ? t('focusPromptDoc', { title: resolvedTitle })
    : t('focusPromptSession', { title: resolvedTitle });

  node.classList.remove('error', 'decision-alert', 'hidden');
  node.classList.add('actionable');
  node.innerHTML = `
    <div class="toast-switch-row">
      <span class="toast-switch-text" title="${escapeHtml(msgText)}">${escapeHtml(msgText)}</span>
      <span class="toast-switch-actions">
        <button type="button" class="pill-btn primary" style="height:25px;padding:0 9px;font-size:0.73rem;" data-toast-switch>${escapeHtml(t('focusSwitchBtn'))}</button>
        <button type="button" class="icon-btn sm" data-toast-dismiss title="${escapeHtml(t('focusDismissTip'))}">✕</button>
      </span>
    </div>
  `;
  scheduleSwitchToastAutoHide(9500);
}

function saveSeenDecisionKeys() {
  try {
    const arr = Array.from(state.seenDecisionKeys).slice(-80);
    sessionStorage.setItem('amp-seen-decisions-v1', JSON.stringify(arr));
  } catch {}
}

function scrollToDecisionCard(decisionId = '') {
  requestAnimationFrame(() => {
    const col = el('reader-column');
    if (!col) return;
    const card = (decisionId && col.querySelector(`[data-decision-id="${CSS.escape(decisionId)}"]`)) ||
      col.querySelector('.decision-card.is-waiting') ||
      col.querySelector('.decision-card:last-of-type');
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('pulse-focus');
      setTimeout(() => card.classList.remove('pulse-focus'), 1800);
    }
  });
}

function showDecisionPromptToast(alertInfo) {
  const node = el('app-toast');
  if (!node || !alertInfo) return;
  state.pendingFocusTarget = null;
  state.pendingDecisionAlert = alertInfo;

  const isCurrent = state.mode === 'sessions' && state.activeConvId === alertInfo.convId;
  const snippet = (alertInfo.questionTitle || '').replace(/\s+/g, ' ').trim().slice(0, 72) || t('decisionRequiredTitle');
  const sessionTitle = (alertInfo.sessionTitle || '').trim() || alertInfo.convId.slice(0, 8);
  const msgText = isCurrent
    ? t('decisionToastCurrent', { title: snippet })
    : t('decisionToastBackground', { session: sessionTitle, title: snippet });
  const btnLabel = isCurrent ? t('decisionJumpBtn') : t('decisionViewSessionBtn');

  node.classList.remove('error', 'hidden');
  node.classList.add('actionable', 'decision-alert');
  node.innerHTML = `
    <div class="toast-switch-row">
      <span class="toast-switch-text" title="${escapeHtml(msgText)}">${escapeHtml(msgText)}</span>
      <span class="toast-switch-actions">
        <button type="button" class="pill-btn warning-btn" style="height:25px;padding:0 9px;font-size:0.73rem;" data-toast-decision>${escapeHtml(btnLabel)}</button>
        <button type="button" class="icon-btn sm" data-toast-dismiss title="${escapeHtml(t('focusDismissTip'))}">✕</button>
      </span>
    </div>
  `;
  scheduleSwitchToastAutoHide(16000);
}

function syncWindowTitleIndicator() {
  const activeWaiting = state.mode === 'sessions' && state.currentViewData?.view?.summary?.activeStatus === 'waiting_decision';
  const anySidebarWaiting = state.conversations.some((c) => isConvWaitingDecision(c));
  const needsPrefix = activeWaiting || anySidebarWaiting;
  const baseTitle = 'Antigravity Session Preview';
  const nextTitle = needsPrefix ? `⏳ ${baseTitle}` : baseTitle;
  if (document.title !== nextTitle) {
    document.title = nextTitle;
  }
}

function evaluateDecisionAlerts() {
  syncWindowTitleIndicator();

  // Auto-dismiss existing decision toast if its conversation is no longer waiting for a decision
  if (state.pendingDecisionAlert) {
    const { convId } = state.pendingDecisionAlert;
    const activeStillWaiting = state.mode === 'sessions' &&
      state.activeConvId === convId &&
      state.currentViewData?.view?.summary?.activeStatus === 'waiting_decision';
    const convObj = state.conversations.find((c) => c.id === convId);
    const sidebarStillWaiting = isConvWaitingDecision(convObj);
    if (!activeStillWaiting && !sidebarStillWaiting) {
      hideToast();
    }
  }

  // 1. Check currently open session first
  if (state.mode === 'sessions' && state.activeConvId && state.currentViewData?.view?.summary?.activeStatus === 'waiting_decision') {
    const pd = state.currentViewData.view.summary.pendingDecision;
    if (pd) {
      const alertKey = `${state.activeConvId}:${pd.stepIndex}`;
      if (!state.seenDecisionKeys.has(alertKey)) {
        state.seenDecisionKeys.add(alertKey);
        saveSeenDecisionKeys();
        const meta = state.conversations.find((c) => c.id === state.activeConvId);
        showDecisionPromptToast({
          convId: state.activeConvId,
          stepIndex: pd.stepIndex,
          decisionId: pd.id || '',
          sessionTitle: meta?.title || '',
          questionTitle: pd.title || '',
        });
        return;
      }
    }
  }

  // 2. Check background sessions in sidebar
  for (const c of state.conversations) {
    if (!isConvWaitingDecision(c) || !c.waitingDecision) continue;
    const pd = c.waitingDecision;
    const alertKey = `${c.id}:${pd.stepIndex ?? 'wait'}`;
    if (!state.seenDecisionKeys.has(alertKey)) {
      state.seenDecisionKeys.add(alertKey);
      saveSeenDecisionKeys();
      showDecisionPromptToast({
        convId: c.id,
        stepIndex: pd.stepIndex ?? 0,
        decisionId: pd.id || '',
        sessionTitle: c.title || '',
        questionTitle: pd.title || '',
      });
      return;
    }
  }
}

function persistNavigationState({ mode, convId, previewId } = {}) {
  try {
    if (mode) {
      sessionStorage.setItem('amp-tab-mode', mode);
      localStorage.setItem('amp-mode', mode);
    }
    if (convId) {
      sessionStorage.setItem('amp-tab-conv', convId);
      localStorage.setItem('amp-last-conv', convId);
    }
    if (previewId) {
      sessionStorage.setItem('amp-tab-preview', previewId);
      localStorage.setItem('amp-last-preview', previewId);
    }
  } catch {}
}

function pickDefaultConversationId() {
  if (!Array.isArray(state.conversations) || state.conversations.length === 0) return '';
  let tabConv = '';
  let savedConv = '';
  try { tabConv = sessionStorage.getItem('amp-tab-conv') || ''; } catch {}
  try { savedConv = localStorage.getItem('amp-last-conv') || ''; } catch {}
  if (tabConv && state.conversations.some((c) => c.id === tabConv)) return tabConv;
  if (savedConv && state.conversations.some((c) => c.id === savedConv)) return savedConv;
  const latestRoot = state.conversations.find((c) => !c.isSubagent);
  return latestRoot?.id || state.conversations[0]?.id || '';
}

async function apiFetch(url, opts = {}) {
  const res = await (isSidecar ? window.sidecar.fetch(url, opts) : fetch(url, opts));
  if (res.status === 401 && !String(url).startsWith('/api/auth/login')) {
    const clone = res.clone();
    try {
      const body = await clone.json();
      if (body?.authRequired) {
        showAuthLockOverlay();
      }
    } catch {}
  }
  return res;
}

function getActiveCustomPalette() {
  if (!isCustomPaletteId(state.palette)) return null;
  return state.customPalettes.find((p) => p.id === state.palette) || null;
}

function getPaletteColorsFor(palObj) {
  if (!palObj) return DEFAULT_CUSTOM_COLORS;
  return {
    bgHex: state.theme === 'dark' ? palObj.darkBg : palObj.lightBg,
    accentHex: palObj.accent,
  };
}

let customPaletteSyncTimer = null;
function saveCustomPalettes({ syncServer = true } = {}) {
  try {
    localStorage.setItem('amp-custom-palettes-v1', JSON.stringify(state.customPalettes));
  } catch {}
  if (!syncServer) return;
  if (customPaletteSyncTimer) clearTimeout(customPaletteSyncTimer);
  customPaletteSyncTimer = setTimeout(() => {
    apiFetch('/api/custom-palettes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ palettes: state.customPalettes }),
    }).catch(() => {});
  }, 200);
}

async function loadServerCustomPalettes() {
  try {
    const res = await apiFetch('/api/custom-palettes');
    if (!res.ok) return;
    const data = await res.json();
    const serverList = sanitizeClientCustomPalettes(data.palettes);
    if (serverList.length > 0) {
      state.customPalettes = serverList;
      saveCustomPalettes({ syncServer: false });
      applyAppearance();
    } else if (state.customPalettes.length > 0) {
      // Push migrated local palettes to server once
      saveCustomPalettes({ syncServer: true });
    }
  } catch {}
}

function createNewCustomPalette() {
  let seedLight = DEFAULT_CUSTOM_COLORS.lightBg;
  let seedDark = DEFAULT_CUSTOM_COLORS.darkBg;
  let seedAccent = DEFAULT_CUSTOM_COLORS.accent;

  const activeCustom = getActiveCustomPalette();
  if (activeCustom) {
    seedLight = activeCustom.lightBg;
    seedDark = activeCustom.darkBg;
    seedAccent = activeCustom.accent;
  } else if (state.palette !== 'parchment' || state.customPalettes.length > 0) {
    const preset = THEME_PALETTES.find((p) => p.id === state.palette);
    if (preset) {
      seedLight = preset.lightBg;
      seedDark = preset.darkBg;
      seedAccent = preset.accent;
    }
  }

  const nextNum = state.customPalettes.length + 1;
  const candidate = {
    id: `custom-${Date.now().toString(36)}-${nextNum}`,
    name: t('defaultCustomName', { n: nextNum }),
    lightBg: seedLight,
    darkBg: seedDark,
    accent: seedAccent,
  };
  state.customPalettes.push(candidate);
  state.palette = candidate.id;
  state.renamingPaletteId = null;
  localStorage.setItem('amp-palette', candidate.id);
  saveCustomPalettes();
  applyAppearance();
}

function commitPaletteRename(palId, rawName) {
  state.renamingPaletteId = null;
  const target = state.customPalettes.find((p) => p.id === palId);
  if (target && rawName && rawName.trim()) {
    target.name = rawName.trim().slice(0, 40);
    saveCustomPalettes();
  }
  renderPrefsMenu();
}

function deleteCustomPalette(palId) {
  const idx = state.customPalettes.findIndex((p) => p.id === palId);
  if (idx === -1) return;
  state.customPalettes.splice(idx, 1);
  if (state.renamingPaletteId === palId) state.renamingPaletteId = null;
  if (state.palette === palId) {
    const fallback = state.customPalettes[Math.max(0, idx - 1)]?.id || 'parchment';
    state.palette = fallback;
    localStorage.setItem('amp-palette', fallback);
  }
  saveCustomPalettes();
  applyAppearance();
}

function resolvedTheme() {
  const activeCustom = getActiveCustomPalette();
  if (activeCustom) {
    const { bgHex } = getPaletteColorsFor(activeCustom);
    const lum = rgbLuminance(hexToRgb(bgHex));
    return lum < 0.46 ? 'dark' : 'light';
  }
  return state.theme === 'dark' ? 'dark' : 'light';
}

function renderRgbPanelHtml(palObj) {
  const { bgHex, accentHex: accHex } = getPaletteColorsFor(palObj);
  const activeSlot = state.rgbActiveSlot === 'accent' ? 'accent' : 'bg';
  const currentHex = activeSlot === 'accent' ? accHex : bgHex;
  const rgb = hexToRgb(currentHex);

  return `
    <div class="rgb-panel" data-rgb-panel="${escapeHtml(palObj.id)}">
      <div class="rgb-panel-header">
        <span>${escapeHtml(palObj.name)} · RGB</span>
        <button type="button" class="code-mini-btn" data-rgb-reset title="${escapeHtml(t('rgbResetTip'))}">${escapeHtml(t('rgbResetBtn'))}</button>
      </div>
      <div class="rgb-slot-tabs">
        <button type="button" class="rgb-slot-tab ${activeSlot === 'bg' ? 'active' : ''}" data-rgb-slot="bg">
          <span class="rgb-mini-dot" data-rgb-dot-bg style="background:${escapeHtml(bgHex)};"></span>
          <span>${escapeHtml(t('rgbBgSlot'))}</span>
        </button>
        <button type="button" class="rgb-slot-tab ${activeSlot === 'accent' ? 'active' : ''}" data-rgb-slot="accent">
          <span class="rgb-mini-dot" data-rgb-dot-accent style="background:${escapeHtml(accHex)};"></span>
          <span>${escapeHtml(t('rgbAccentSlot'))}</span>
        </button>
      </div>
      <div class="rgb-hex-row">
        <input type="color" class="rgb-color-picker" data-rgb-picker value="${escapeHtml(currentHex)}">
        <input type="text" class="rgb-hex-input" data-rgb-hex value="${escapeHtml(currentHex)}" maxlength="7" spellcheck="false">
      </div>
      <div class="rgb-slider-row">
        <span>R</span>
        <input type="range" class="rgb-range" min="0" max="255" value="${rgb.r}" data-rgb-channel="r">
        <input type="number" class="rgb-num-input" min="0" max="255" value="${rgb.r}" data-rgb-num="r">
      </div>
      <div class="rgb-slider-row">
        <span>G</span>
        <input type="range" class="rgb-range" min="0" max="255" value="${rgb.g}" data-rgb-channel="g">
        <input type="number" class="rgb-num-input" min="0" max="255" value="${rgb.g}" data-rgb-num="g">
      </div>
      <div class="rgb-slider-row">
        <span>B</span>
        <input type="range" class="rgb-range" min="0" max="255" value="${rgb.b}" data-rgb-channel="b">
        <input type="number" class="rgb-num-input" min="0" max="255" value="${rgb.b}" data-rgb-num="b">
      </div>
    </div>
  `;
}

function renderPrefsMenu() {
  const menu = el('prefs-menu');
  if (!menu) return;
  const isDark = state.theme === 'dark';
  const lang = getLang();

  const langSegHtml = `
    <div class="prefs-control-row">
      <span class="prefs-control-label">${escapeHtml(t('secLanguage'))}</span>
      <div class="prefs-seg-group">
        <button type="button" class="prefs-seg-btn ${lang === 'en' ? 'active' : ''}" data-pref-lang="en">English</button>
        <button type="button" class="prefs-seg-btn ${lang === 'zh' ? 'active' : ''}" data-pref-lang="zh">简体中文</button>
      </div>
    </div>
  `;

  const activeLatinObj = LATIN_FONTS.find((f) => f.id === state.prose) || LATIN_FONTS[0];
  const activeCjkObj = CJK_FONTS.find((f) => f.id === state.proseCjk) || CJK_FONTS[0];
  const isZhSplit = lang === 'zh';
  const latinOpen = state.openFontPicker === 'latin';
  const cjkOpen = isZhSplit && state.openFontPicker === 'cjk';

  const latinPickerHtml = `
    <div class="prefs-control-row">
      <span class="prefs-control-label">${escapeHtml(t(isZhSplit ? 'lblLatinFont' : 'lblFont'))}</span>
      <button type="button" class="prefs-expand-trigger ${latinOpen ? 'open' : ''}" data-toggle-font-picker="latin">
        <span style="font-family:${activeLatinObj.previewStack};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(t(activeLatinObj.i18nKey))}</span>
        <span class="prefs-expand-chevron">${latinOpen ? '▴' : '▾'}</span>
      </button>
    </div>
    ${latinOpen ? `
      <div class="font-picker-panel" data-font-picker-panel="latin">
        ${LATIN_FONTS.map((f) => {
          const active = state.prose === f.id;
          return `<button type="button" class="theme-menu-item font-option-item ${active ? 'active' : ''}" data-pref-prose="${f.id}">
            <span style="font-family:${f.previewStack};">${escapeHtml(t(f.i18nKey))}</span>
            <span>${active ? '✓' : ''}</span>
          </button>`;
        }).join('')}
      </div>
    ` : ''}
  `;

  const cjkPickerHtml = isZhSplit ? `
    <div class="prefs-control-row">
      <span class="prefs-control-label">${escapeHtml(t('lblCjkFont'))}</span>
      <button type="button" class="prefs-expand-trigger ${cjkOpen ? 'open' : ''}" data-toggle-font-picker="cjk">
        <span style="font-family:${activeCjkObj.previewStack};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(t(activeCjkObj.i18nKey))}</span>
        <span class="prefs-expand-chevron">${cjkOpen ? '▴' : '▾'}</span>
      </button>
    </div>
    ${cjkOpen ? `
      <div class="font-picker-panel" data-font-picker-panel="cjk">
        ${CJK_FONTS.map((f) => {
          const active = state.proseCjk === f.id;
          return `<button type="button" class="theme-menu-item font-option-item ${active ? 'active' : ''}" data-pref-prose-cjk="${f.id}">
            <span style="font-family:${f.previewStack};">${escapeHtml(t(f.i18nKey))}</span>
            <span>${active ? '✓' : ''}</span>
          </button>`;
        }).join('')}
      </div>
    ` : ''}
  ` : '';

  const typoRowsHtml = `
    <div class="prefs-control-row">
      <span class="prefs-control-label">${escapeHtml(t('lblFontSize'))}</span>
      <div class="font-size-stepper">
        <button type="button" class="prefs-step-btn" data-font-size-delta="-1" ${state.fontSize <= MIN_FONT_SIZE ? 'disabled' : ''} title="${escapeHtml(t('fontSizeDecTip'))}">−</button>
        <span class="font-size-readout" data-font-size-label>${state.fontSize}px</span>
        <button type="button" class="prefs-step-btn" data-font-size-delta="1" ${state.fontSize >= MAX_FONT_SIZE ? 'disabled' : ''} title="${escapeHtml(t('fontSizeIncTip'))}">+</button>
        <button type="button" class="prefs-step-btn reset" data-font-size-reset ${state.fontSize === DEFAULT_FONT_SIZE ? 'disabled' : ''} title="${escapeHtml(t('fontSizeResetTip'))}">↺</button>
      </div>
    </div>
    ${latinPickerHtml}
    ${cjkPickerHtml}
    <div class="prefs-control-row">
      <span class="prefs-control-label">${escapeHtml(t('lblWidth'))}</span>
      <div class="prefs-seg-group">
        <button type="button" class="prefs-seg-btn ${state.width === 'normal' ? 'active' : ''}" data-pref-width="normal">${escapeHtml(t('widthNormal'))}</button>
        <button type="button" class="prefs-seg-btn ${state.width === 'wide' ? 'active' : ''}" data-pref-width="wide">${escapeHtml(t('widthWide'))}</button>
      </div>
    </div>
    <div class="prefs-control-row">
      <span class="prefs-control-label">${escapeHtml(t('lblTables'))}</span>
      <div class="prefs-seg-group">
        <button type="button" class="prefs-seg-btn ${state.tables === 'compact' ? 'active' : ''}" data-pref-tables="compact">${escapeHtml(t('tablesFit'))}</button>
        <button type="button" class="prefs-seg-btn ${state.tables === 'expand' ? 'active' : ''}" data-pref-tables="expand">${escapeHtml(t('tablesExpand'))}</button>
      </div>
    </div>
  `;

  const modeItemsHtml = [
    { id: 'light', label: t('modeLight') },
    { id: 'dark', label: t('modeDark') },
  ].map((m) => {
    const active = state.theme === m.id;
    return `<button type="button" class="theme-menu-item ${active ? 'active' : ''}" data-theme-mode="${m.id}">
      <span>${escapeHtml(m.label)}</span>
      <span>${active ? '✓' : ''}</span>
    </button>`;
  }).join('');

  const paletteItemsHtml = THEME_PALETTES.map((p) => {
    const active = state.palette === p.id;
    const bgHex = isDark ? p.darkBg : p.lightBg;
    const grad = `linear-gradient(135deg, ${bgHex} 50%, ${p.accent} 50%)`;
    return `<button type="button" class="theme-menu-item ${active ? 'active' : ''}" data-theme-palette="${p.id}">
      <span class="theme-menu-item-left">
        <span class="palette-dual-swatch" style="background:${grad};"></span>
        <span>${escapeHtml(t(`pal_${p.id}`))}</span>
      </span>
      <span>${active ? '✓' : ''}</span>
    </button>`;
  }).join('');

  const customCandidatesHtml = state.customPalettes.map((cp) => {
    const active = state.palette === cp.id;
    const { bgHex, accentHex } = getPaletteColorsFor(cp);
    const grad = `linear-gradient(135deg, ${bgHex} 50%, ${accentHex} 50%)`;
    if (state.renamingPaletteId === cp.id) {
      return `
        <div class="palette-rename-row">
          <span class="palette-dual-swatch" style="background:${grad};"></span>
          <input type="text" class="palette-rename-input" data-palette-rename-input="${escapeHtml(cp.id)}" value="${escapeHtml(cp.name)}" maxlength="40">
        </div>
        ${active ? renderRgbPanelHtml(cp) : ''}
      `;
    }
    return `
      <div class="custom-palette-row ${active ? 'active' : ''}">
        <button type="button" class="custom-palette-select-btn" data-theme-palette="${escapeHtml(cp.id)}">
          <span class="theme-menu-item-left">
            <span class="palette-dual-swatch" data-custom-swatch="${escapeHtml(cp.id)}" style="background:${grad};"></span>
            <span class="custom-palette-name">${escapeHtml(cp.name)}</span>
          </span>
          <span>${active ? '✓' : ''}</span>
        </button>
        <span class="palette-row-actions">
          <button type="button" class="palette-mini-action" data-rename-palette="${escapeHtml(cp.id)}" title="${escapeHtml(t('renamePaletteTip'))}">✎</button>
          <button type="button" class="palette-mini-action danger" data-delete-palette="${escapeHtml(cp.id)}" title="${escapeHtml(t('deletePaletteTip'))}">✕</button>
        </span>
      </div>
      ${active ? renderRgbPanelHtml(cp) : ''}
    `;
  }).join('');

  const addCustomBtnHtml = `<button type="button" class="add-custom-palette-btn" data-add-custom-palette>${escapeHtml(t('addCustomPaletteBtn'))}</button>`;

  menu.innerHTML = `
    ${langSegHtml}
    <div class="theme-menu-divider"></div>
    <div class="theme-menu-section-label">${escapeHtml(t('secTypography'))}</div>
    ${typoRowsHtml}
    <div class="theme-menu-divider"></div>
    <div class="theme-menu-section-label">${escapeHtml(t('secMode'))}</div>
    ${modeItemsHtml}
    <div class="theme-menu-divider"></div>
    <div class="theme-menu-section-label">${escapeHtml(t('secPalette'))}</div>
    ${paletteItemsHtml}
    ${customCandidatesHtml}
    ${addCustomBtnHtml}
  `;

  if (state.renamingPaletteId) {
    const inp = menu.querySelector(`[data-palette-rename-input="${CSS.escape(state.renamingPaletteId)}"]`);
    if (inp) {
      inp.focus();
      inp.select();
    }
  }
}

function applyAppearance({ rebuildMenu = true } = {}) {
  const activeCustom = getActiveCustomPalette();
  const isPreset = THEME_PALETTES.some((p) => p.id === state.palette);
  if (!activeCustom && !isPreset) {
    state.palette = state.customPalettes[0]?.id || 'parchment';
  }
  const currentCustom = getActiveCustomPalette();

  let effectiveTheme = state.theme === 'dark' ? 'dark' : 'light';
  if (currentCustom) {
    const { bgHex, accentHex } = getPaletteColorsFor(currentCustom);
    effectiveTheme = applyCustomPaletteCssVars(bgHex, accentHex);
  } else {
    clearCustomPaletteCssVars();
  }

  if (!LATIN_FONTS.some((f) => f.id === state.prose)) {
    state.prose = 'sans';
  }
  if (!CJK_FONTS.some((f) => f.id === state.proseCjk)) {
    state.proseCjk = 'sans';
  }
  const effectiveCjk = getLang() === 'zh'
    ? state.proseCjk
    : (state.prose === 'sans' ? 'sans' : 'serif');

  state.fontSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(state.fontSize || DEFAULT_FONT_SIZE)));
  document.documentElement.style.setProperty('--reader-scale', (state.fontSize / DEFAULT_FONT_SIZE).toFixed(4));

  document.documentElement.setAttribute('data-theme', effectiveTheme);
  document.documentElement.setAttribute('data-palette', currentCustom ? 'custom' : state.palette);
  document.documentElement.setAttribute('data-width', state.width);
  document.documentElement.setAttribute('data-tables', state.tables);
  document.documentElement.setAttribute('data-prose', state.prose);
  document.documentElement.setAttribute('data-prose-cjk', effectiveCjk);

  const hljsLight = el('hljs-light-css');
  const hljsDark = el('hljs-dark-css');
  if (hljsLight && hljsDark) {
    hljsLight.disabled = effectiveTheme === 'dark';
    hljsDark.disabled = effectiveTheme !== 'dark';
  }

  const swatchEl = el('prefs-btn-swatch');
  if (swatchEl) {
    if (currentCustom) {
      const { bgHex, accentHex } = getPaletteColorsFor(currentCustom);
      swatchEl.style.background = `linear-gradient(135deg, ${bgHex} 50%, ${accentHex} 50%)`;
    } else {
      const palObj = THEME_PALETTES.find((p) => p.id === state.palette) || THEME_PALETTES[0];
      const bgHex = effectiveTheme === 'dark' ? palObj.darkBg : palObj.lightBg;
      swatchEl.style.background = `linear-gradient(135deg, ${bgHex} 50%, ${palObj.accent} 50%)`;
    }
  }
  const prefsLabel = el('prefs-btn-label');
  if (prefsLabel) {
    prefsLabel.textContent = t('prefsBtn');
  }
  if (rebuildMenu) {
    renderPrefsMenu();
  }
  transcriptRenderer?.setTheme(effectiveTheme);
  rethemeMermaidDiagrams(effectiveTheme);
  const tableLayoutSig = `${state.tables}|${state.fontSize}|${state.width}|${state.prose}|${effectiveCjk}`;
  if (tableLayoutSig !== state.tableLayoutSig) {
    state.tableLayoutSig = tableLayoutSig;
    relayoutMarkdownTables(document, { force: true });
  }
}

function syncRgbControlsInPlace(nextHex) {
  const menu = el('prefs-menu');
  const activeCustom = getActiveCustomPalette();
  if (!menu || !activeCustom) return;
  const rgb = hexToRgb(nextHex);
  const { bgHex, accentHex: accHex } = getPaletteColorsFor(activeCustom);
  const picker = menu.querySelector('[data-rgb-picker]');
  const hexIn = menu.querySelector('[data-rgb-hex]');
  if (picker && picker.value.toLowerCase() !== nextHex.toLowerCase()) picker.value = nextHex;
  if (hexIn && document.activeElement !== hexIn) hexIn.value = nextHex;
  for (const ch of ['r', 'g', 'b']) {
    const rangeEl = menu.querySelector(`[data-rgb-channel="${ch}"]`);
    const numEl = menu.querySelector(`[data-rgb-num="${ch}"]`);
    if (rangeEl) rangeEl.value = String(rgb[ch]);
    if (numEl && document.activeElement !== numEl) numEl.value = String(rgb[ch]);
  }
  const dotBg = menu.querySelector('[data-rgb-dot-bg]');
  const dotAcc = menu.querySelector('[data-rgb-dot-accent]');
  const rowSwatch = menu.querySelector(`[data-custom-swatch="${CSS.escape(activeCustom.id)}"]`);
  if (dotBg) dotBg.style.background = bgHex;
  if (dotAcc) dotAcc.style.background = accHex;
  if (rowSwatch) rowSwatch.style.background = `linear-gradient(135deg, ${bgHex} 50%, ${accHex} 50%)`;
}

function applyCustomSlotColorLive(nextHex) {
  if (!isValidHex(nextHex)) return;
  const activeCustom = getActiveCustomPalette();
  if (!activeCustom) return;
  const normalized = nextHex.toLowerCase();
  if (state.rgbActiveSlot === 'accent') {
    activeCustom.accent = normalized;
  } else if (state.theme === 'dark') {
    activeCustom.darkBg = normalized;
  } else {
    activeCustom.lightBg = normalized;
  }
  saveCustomPalettes();
  applyAppearance({ rebuildMenu: false });
  syncRgbControlsInPlace(normalized);
}

function applyLanguage(nextLang) {
  setLang(nextLang);
  applyStaticI18n();
  const manageBtn = el('docs-manage-btn');
  if (manageBtn) {
    manageBtn.textContent = state.docsManageMode ? t('manageDoneBtn') : t('manageBtn');
  }
  const popupWrap = el('popup-wrap-btn');
  if (popupWrap) {
    popupWrap.textContent = el('popup-code-view')?.classList.contains('wrapped') ? t('unwrapBtn') : t('wrapBtn');
  }
  const sideWrap = el('side-wrap-btn');
  if (sideWrap) {
    sideWrap.textContent = el('side-code-view')?.classList.contains('wrapped') ? t('unwrapBtn') : t('wrapBtn');
  }
  const maxBtn = el('mmd-modal-maximize');
  if (maxBtn) {
    const isMax = el('mermaid-modal-panel')?.classList.contains('maximized');
    maxBtn.textContent = isMax ? t('mmdRestoreBtn') : t('mmdMaximizeBtn');
  }
  applyAppearance();
  syncFlavorSelect();
  updatePinSessionButton();
  if (state.eventSource) {
    applyHookPhase(state.currentViewData?.hookState);
  }
  renderSidebarList();
  renderCliToolsDrawer();

  if (state.mode === 'sessions' && transcriptRenderer?.lastView) {
    transcriptRenderer._rerenderCurrent();
  } else   if (state.mode === 'docs') {
    if (state.currentCustomDoc) {
      const docAnchor = captureViewportAnchor(el('reader-scroll'), document.querySelector('#reader-column [data-md-stage]'));
      renderCustomPreview(state.currentCustomDoc);
      restoreViewportAnchor(el('reader-scroll'), document.querySelector('#reader-column [data-md-stage]'), docAnchor);
    } else {
      el('doc-title').textContent = t('tabDocs');
      el('reader-column').innerHTML = `<div class="empty-state"><strong>${escapeHtml(t('docsEmptyTitle'))}</strong><span>${t(state.filePickerAvailable ? 'docsEmptyHint' : 'docsEmptyHintNoPicker')}</span></div>`;
    }
  }
  if (state.sideCurrent && !el('side-preview-pane')?.classList.contains('hidden')) {
    if (state.sideCurrent.kind === 'directory') {
      browseFolderInPreview(state.sideCurrent.path, '', 'sidebar');
    } else {
      const sideBody = el('side-preview-body');
      sideBody._pendingMdAnchor = captureViewportAnchor(sideBody, sideBody?.querySelector('[data-md-stage]'));
      populatePreviewBody(sideBody, state.sideCurrent, 'side-code-view');
    }
  }
  if (state.popupCurrent && !el('file-preview-modal')?.classList.contains('hidden')) {
    if (state.popupCurrent.kind === 'directory') {
      browseFolderInPreview(state.popupCurrent.path, '', 'popup');
    } else {
      const popupBody = el('popup-preview-body');
      popupBody._pendingMdAnchor = captureViewportAnchor(popupBody, popupBody?.querySelector('[data-md-stage]'));
      populatePreviewBody(popupBody, state.popupCurrent, 'popup-code-view');
    }
  }
  if (state.pendingFocusTarget && !el('app-toast')?.classList.contains('hidden')) {
    showSwitchPromptToast(state.pendingFocusTarget);
  } else if (state.pendingDecisionAlert && !el('app-toast')?.classList.contains('hidden')) {
    showDecisionPromptToast(state.pendingDecisionAlert);
  }
}

let transcriptRenderer = null;
let hoverTimer = null;

/* -------------------------------------------------------------------------
 * Password Authentication UI
 * ------------------------------------------------------------------------- */

function updateAuthLockButton() {
  el('lock-session-btn')?.classList.toggle('hidden', !state.authRequired || isSidecar);
}

function showAuthLockOverlay(errMsg = '') {
  state.authenticated = false;
  const overlay = el('auth-lock-overlay');
  const errEl = el('auth-lock-error');
  const input = el('auth-password-input');
  if (errEl) {
    errEl.textContent = errMsg || '';
    errEl.classList.toggle('hidden', !errMsg);
  }
  overlay?.classList.remove('hidden');
  setTimeout(() => input?.focus(), 40);
}

function hideAuthLockOverlay() {
  state.authenticated = true;
  el('auth-lock-overlay')?.classList.add('hidden');
  el('auth-lock-error')?.classList.add('hidden');
  const input = el('auth-password-input');
  if (input) input.value = '';
}

async function checkAuthStatus() {
  if (isSidecar) return { authRequired: false, authenticated: true };
  try {
    const res = await fetch('/api/auth/status');
    if (!res.ok) return { authRequired: false, authenticated: true };
    const data = await res.json();
    state.authRequired = Boolean(data.authRequired);
    state.authenticated = Boolean(data.authenticated);
    updateAuthLockButton();
    return data;
  } catch {
    return { authRequired: false, authenticated: true };
  }
}

function setLiveBadge(text, kind = 'idle') {
  const pill = el('live-pill');
  if (!pill) return;
  pill.textContent = text;
  pill.className = 'live-pill';
  if (kind === 'live') pill.classList.add('live');
  else if (kind === 'active') pill.classList.add('active-phase');
  else if (kind === 'decision') pill.classList.add('waiting-decision');
}

function formatCompactDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const now = new Date();
  const locale = getLang() === 'zh' ? 'zh-CN' : 'en-US';
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  }
  const diffDays = Math.floor((Date.now() - ms) / (24 * 3600 * 1000));
  if (diffDays < 7) {
    if (getLang() === 'zh') {
      return diffDays === 0 ? '今天' : `${diffDays}天前`;
    }
    return diffDays === 0 ? 'Today' : `${diffDays}d ago`;
  }
  return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

function renderToc(items) {
  const list = el('toc-list');
  if (!list) return;
  if (!items || items.length === 0) {
    list.innerHTML = `<div style="font-size:0.75rem;color:var(--text-faint);padding:4px 6px;">${escapeHtml(t('noOutline'))}</div>`;
    return;
  }
  list.innerHTML = items.map((it) =>
    `<button type="button" class="toc-link ${it.isTurn ? 'turn-item' : `level-${it.level}`}" data-target-id="${escapeHtml(it.id)}" title="${escapeHtml(it.fullTitle || it.label)}">${escapeHtml(it.label)}</button>`
  ).join('');
}

function syncFlavorSelect() {
  const select = el('flavor-select');
  if (!select) return;
  const flavors = state.availableFlavors.length ? state.availableFlavors : [state.flavor].filter(Boolean);
  const options = flavors.map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`);
  options.push(`<option value="__saved_turns__">${escapeHtml(t('savedTurnsOption'))}</option>`);
  select.innerHTML = options.join('');
  select.value = state.sidebarSource === 'saved-turns' ? '__saved_turns__' : state.flavor;
}

async function loadFlavors() {
  try {
    const res = await apiFetch('/api/flavors');
    if (!res.ok) return;
    const { flavors } = await res.json();
    if (!flavors?.length) return;
    state.availableFlavors = flavors;
    if (!flavors.includes(state.flavor)) state.flavor = flavors[0];
    syncFlavorSelect();
  } catch {}
}

function syncSavedTurnsChrome() {
  const saved = state.mode === 'sessions' && state.sidebarSource === 'saved-turns';
  el('toggle-all-projects-btn')?.classList.toggle('hidden', saved);
}

function updatePinSessionButton() {
  const btn = el('pin-session-btn');
  if (!btn) return;
  const visible = state.mode === 'sessions' && Boolean(state.activeConvId);
  btn.classList.toggle('hidden', !visible);
  if (!visible) return;
  const isPinned = state.pinnedIds.includes(state.activeConvId);
  btn.classList.toggle('pinned', isPinned);
  btn.textContent = isPinned ? '★' : '☆';
  btn.title = isPinned ? t('unpinSessionTip') : t('pinSessionTip');
}

async function togglePinSession(convId) {
  if (!convId) return;
  const wasPinned = state.pinnedIds.includes(convId);
  const nextPinned = !wasPinned;
  state.pinnedIds = nextPinned
    ? [convId, ...state.pinnedIds.filter((id) => id !== convId)]
    : state.pinnedIds.filter((id) => id !== convId);
  try { localStorage.setItem('amp-pinned-sessions', JSON.stringify(state.pinnedIds)); } catch {}
  updatePinSessionButton();
  renderSidebarList();

  try {
    const res = await apiFetch('/api/pinned-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: convId, pinned: nextPinned }),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.pinnedIds)) {
        state.pinnedIds = data.pinnedIds;
        try { localStorage.setItem('amp-pinned-sessions', JSON.stringify(state.pinnedIds)); } catch {}
        updatePinSessionButton();
        renderSidebarList();
      }
    }
  } catch {}
}

function saveSessionReadState() {
  try {
    localStorage.setItem('amp-session-read-state-v1', JSON.stringify({
      initialized: state.readStateInitialized,
      seenSteps: state.seenSessionSteps,
      unreadIds: Array.from(state.unreadConvIds),
    }));
  } catch {}
}

function reconcileSessionReadState(convs) {
  if (!Array.isArray(convs)) return;
  if (!state.readStateInitialized) {
    for (const c of convs) {
      if (!c?.id) continue;
      state.seenSessionSteps[c.id] = c.stepCount || 0;
      if (isConvActivelyRunning(c)) {
        state.prevRunningIds.add(c.id);
      }
    }
    state.readStateInitialized = true;
    saveSessionReadState();
    return;
  }

  let changed = false;
  const now = Date.now();
  for (const c of convs) {
    if (!c?.id) continue;
    if (applyConversationReadState(c, now)) changed = true;
  }

  if (changed) {
    saveSessionReadState();
  }
}

function applyConversationReadState(c, now = Date.now()) {
  const id = c.id;
  const hadSeen = Object.prototype.hasOwnProperty.call(state.seenSessionSteps, id);
  const next = nextConversationReadState({
    steps: c.stepCount || 0,
    running: isConvActivelyRunning(c),
    viewed: state.mode === 'sessions' && state.activeConvId === id,
    wasRunning: state.prevRunningIds.has(id),
    prevSeen: hadSeen ? state.seenSessionSteps[id] : undefined,
    wasUnread: state.unreadConvIds.has(id),
    updatedAt: c.updatedAt || 0,
    now,
  });

  if (next.trackRunning) state.prevRunningIds.add(id);
  else state.prevRunningIds.delete(id);

  let changed = false;
  if (next.unread) {
    if (!state.unreadConvIds.has(id)) {
      state.unreadConvIds.add(id);
      changed = true;
    }
  } else if (state.unreadConvIds.delete(id)) {
    changed = true;
  }
  if (next.seen !== undefined && state.seenSessionSteps[id] !== next.seen) {
    state.seenSessionSteps[id] = next.seen;
    changed = true;
  }
  return changed;
}

function sessionIsUnreadHighlight(c) {
  if (!c?.id) return false;
  return folderShowsUnread([c], {
    unreadIds: state.unreadConvIds,
    runningIds: isConvActivelyRunning(c) ? [c.id] : [],
    activeId: state.mode === 'sessions' ? (state.activeConvId || '') : '',
    countableIds: [c.id],
  });
}

function unreadStatusDotHtml() {
  return `<span class="status-dot unread-completed" title="${escapeHtml(t('unreadBadge'))}"></span>`;
}

function acknowledgeOpenSession() {
  if (state.mode === 'sessions' && state.activeConvId) {
    markConversationAsRead(state.activeConvId);
  }
}

function markConversationAsRead(convId, knownStepCount = null) {
  if (!convId) return;
  let changed = state.unreadConvIds.delete(convId);
  const meta = state.conversations.find((c) => c.id === convId);
  const steps = Math.max(state.seenSessionSteps[convId] || 0, meta?.stepCount || 0, knownStepCount || 0);
  if (state.seenSessionSteps[convId] !== steps) {
    state.seenSessionSteps[convId] = steps;
    changed = true;
  }
  if (changed) {
    saveSessionReadState();
  }
}

let bgSidebarRenderTimer = null;
function scheduleBackgroundSidebarRender() {
  if (state.sidebarPointerInside || state.sidebarMouseDown || state.renamingDocId) {
    state.sidebarDirtyWhileHovered = true;
    return;
  }
  if (bgSidebarRenderTimer) return;
  bgSidebarRenderTimer = setTimeout(() => {
    bgSidebarRenderTimer = null;
    if (state.sidebarPointerInside || state.sidebarMouseDown || state.renamingDocId) {
      state.sidebarDirtyWhileHovered = true;
      return;
    }
    renderSidebarList();
  }, 90);
}

async function loadConversations({ fromBackground = false } = {}) {
  try {
    const res = await apiFetch(`/api/conversations?flavor=${encodeURIComponent(state.flavor)}`);
    if (!res.ok) return;
    const data = await res.json();
    state.conversations = data.conversations || [];
    reconcileSessionReadState(state.conversations);
    if (Array.isArray(data.pinnedIds)) {
      state.pinnedIds = data.pinnedIds;
      try { localStorage.setItem('amp-pinned-sessions', JSON.stringify(state.pinnedIds)); } catch {}
    }
    updatePinSessionButton();
    evaluateDecisionAlerts();
    if (state.mode === 'sessions') {
      if (fromBackground) scheduleBackgroundSidebarRender();
      else renderSidebarList();
    }
  } catch {}
}

async function loadCustomPreviews({ fromBackground = false } = {}) {
  try {
    const res = await apiFetch('/api/previews');
    if (!res.ok) return;
    const data = await res.json();
    state.customPreviews = data.previews || [];
    if (data.storagePath) state.docsStoragePath = data.storagePath;
    if (state.mode === 'docs') {
      if (fromBackground) scheduleBackgroundSidebarRender();
      else renderSidebarList();
    }
  } catch {}
}

function resolveProjectLabel(c) {
  if (c.projectName && c.projectName.trim()) return c.projectName.trim();
  if (c.workspaceUri && c.workspaceUri.trim()) {
    const parts = c.workspaceUri.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return 'Unassigned';
}

function isConvWaitingDecision(c) {
  if (!c) return false;
  if (c.hookState?.phase === 'stopped' && Date.now() - (c.hookState.updatedAt || 0) < 15000) return false;
  return Boolean(c.waitingDecision);
}

function isConvActivelyRunning(c) {
  if (!c) return false;
  if (isConvWaitingDecision(c)) return true;
  if (isHookActivelyRunning(c.hookState)) return true;
  if (c.hookState?.phase === 'stopped' && Date.now() - (c.hookState.updatedAt || 0) < 15000) return false;
  return Boolean(c.active);
}

function formatSidebarLiveStatus(c) {
  if (isConvWaitingDecision(c)) {
    return `⏳ ${t('sidebarDecisionBadge')}`;
  }
  if (!isConvActivelyRunning(c)) return '';
  const hs = c.hookState;
  if (hs?.phase === 'thinking' || hs?.phase === 'between_steps') {
    return t('thinkingPhase');
  }
  if (hs?.phase === 'running_tool' || hs?.phase === 'tool_done') {
    return hs.toolName ? t('runningToolPhase', { tool: hs.toolName }) : t('sidebarRunningBadge');
  }
  return t('sidebarRunningBadge');
}

function patchConversationSidebarState(convId, { hookState, stepCount, activeStatus, pendingDecision, updatedAt } = {}) {
  if (!convId) return;
  const idx = state.conversations.findIndex((c) => c.id === convId);
  if (idx === -1) {
    loadConversations({ fromBackground: true });
    return;
  }
  const cur = state.conversations[idx];
  const nextHook = hookState !== undefined ? hookState : cur.hookState;
  const hookRunning = isHookActivelyRunning(nextHook);
  const hookStopped = nextHook?.phase === 'stopped';
  const nextActive = hookRunning || activeStatus === 'running' || activeStatus === 'waiting_decision' || (cur.active && !hookStopped && activeStatus !== 'idle' && activeStatus !== 'canceled');
  const nextSteps = stepCount != null ? Math.max(cur.stepCount || 0, stepCount) : cur.stepCount;
  const nextUpdated = Math.max(cur.updatedAt || 0, updatedAt || 0, nextHook?.updatedAt || 0);

  let nextWaitingDecision = cur.waitingDecision || null;
  if (activeStatus === 'waiting_decision') {
    nextWaitingDecision = pendingDecision || cur.waitingDecision || { title: '' };
  } else if (activeStatus && activeStatus !== 'waiting_decision') {
    nextWaitingDecision = null;
  } else if (hookStopped || nextHook?.hookEventName === 'PostToolUse') {
    nextWaitingDecision = null;
  }

  state.conversations[idx] = {
    ...cur,
    hookState: nextHook,
    active: nextActive,
    waitingDecision: nextWaitingDecision,
    stepCount: nextSteps,
    updatedAt: nextUpdated,
  };
  reconcileSessionReadState([state.conversations[idx]]);
  evaluateDecisionAlerts();
  if (state.mode === 'sessions') {
    scheduleBackgroundSidebarRender();
  }
}

function renderSessionButtonHtml(c, { showProjectPill = false } = {}) {
  const active = c.id === state.activeConvId ? 'active' : '';
  const sub = c.isSubagent ? 'is-subagent' : '';
  const waitingDec = isConvWaitingDecision(c);
  const runningNow = !waitingDec && isConvActivelyRunning(c);
  const isUnreadCompleted = sessionIsUnreadHighlight(c);
  const itemStateCls = waitingDec
    ? 'is-waiting-decision'
    : (runningNow
        ? 'is-running-session'
        : (isUnreadCompleted ? 'is-unread-completed' : ''));
  const indicatorHtml = waitingDec
    ? `<span class="status-dot decision-waiting"></span>`
    : (runningNow
        ? APPLE_SPINNER_SVG
        : `<span class="status-dot ${isUnreadCompleted ? 'unread-completed' : 'idle-read'}"></span>`);
  const timeStr = formatCompactDate(c.updatedAt);
  const isPinned = state.pinnedIds.includes(c.id);
  const starTip = isPinned ? t('unpinSessionTip') : t('pinSessionTip');
  const liveLabel = formatSidebarLiveStatus(c);
  const statusPillHtml = waitingDec
    ? `<span class="session-decision-pill">${escapeHtml(liveLabel)}</span>`
    : (runningNow && liveLabel
        ? `<span class="session-live-status-pill">${escapeHtml(liveLabel)}</span>`
        : (isUnreadCompleted
            ? `<span class="session-unread-pill">${escapeHtml(t('unreadBadge'))}</span>`
            : ''));
  const projBadge = showProjectPill
    ? `<span class="session-project-pill">${escapeHtml(resolveProjectLabel(c))}</span>`
    : `<span>${escapeHtml(c.id.slice(0, 8))}${c.stepCount ? ` · ${c.stepCount} ${escapeHtml(t('stepsStat'))}` : ''}</span>`;
  return `<button type="button" class="session-item ${active} ${sub} ${itemStateCls}" data-conv-id="${escapeHtml(c.id)}" title="${escapeHtml(c.title)}">
    <div class="session-title-line">
      ${indicatorHtml}
      <span class="session-title-text">${escapeHtml(c.title)}</span>
      <span class="session-star-action ${isPinned ? 'pinned' : ''}" data-pin-conv="${escapeHtml(c.id)}" title="${escapeHtml(starTip)}">${isPinned ? '★' : '☆'}</span>
    </div>
    <div class="session-meta-line">
      <span class="session-meta-left">${statusPillHtml}${projBadge}</span>
      <span>${escapeHtml(timeStr)}</span>
    </div>
  </button>`;
}

function hideDocHoverPopover() {
  if (hoverTimer) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
  el('doc-hover-popover')?.classList.add('hidden');
}

function showDocHoverPopover(docId, cardEl) {
  if (state.docsManageMode || state.renamingDocId) return;
  const doc = state.customPreviews.find((d) => d.id === docId);
  if (!doc) return;
  const pop = el('doc-hover-popover');
  const sidebar = el('sidebar');
  if (!pop || !sidebar) return;

  el('doc-hover-title').textContent = doc.title;
  el('doc-hover-path').textContent = doc.filePath || doc.baseDir || doc.mode || 'Inline Clip';
  const bodyEl = el('doc-hover-body');
  bodyEl.innerHTML = doc.excerpt
    ? renderMarkdownHtml(doc.excerpt, { baseDir: doc.baseDir || '' })
    : `<span style="color:var(--text-faint);">(Empty document)</span>`;
  enhanceMarkdownDom(bodyEl, resolvedTheme());

  pop.classList.remove('hidden');
  const sideRect = sidebar.getBoundingClientRect();
  const cardRect = cardEl.getBoundingClientRect();
  const popHeight = Math.min(420, pop.offsetHeight || 320);
  const top = Math.max(12, Math.min(window.innerHeight - popHeight - 12, cardRect.top));
  pop.style.left = `${Math.round(sideRect.right + 10)}px`;
  pop.style.top = `${Math.round(top)}px`;
}

function groupConversations(list) {
  const groupsMap = new Map();
  for (const c of list || []) {
    const projectLabel = resolveProjectLabel(c);
    let grp = groupsMap.get(projectLabel);
    if (!grp) {
      grp = { key: projectLabel, label: projectLabel, workspaceUri: c.workspaceUri || '', latestUpdatedAt: 0, items: [] };
      groupsMap.set(projectLabel, grp);
    }
    if (!grp.workspaceUri && c.workspaceUri) grp.workspaceUri = c.workspaceUri;
    grp.items.push(c);
    if ((c.updatedAt || 0) > grp.latestUpdatedAt) grp.latestUpdatedAt = c.updatedAt || 0;
  }
  return Array.from(groupsMap.values());
}

function renderSavedTurnsSidebar(container, query) {
  syncSavedTurnsChrome();
  const turns = state.savedTurns.filter((item) => {
    if (!query) return true;
    const hay = `${item.promptPreview || ''} ${item.conversationTitle || ''} ${item.projectName || ''} ${item.scheduleLabel || ''}`.toLowerCase();
    return hay.includes(query);
  });
  if (turns.length === 0) {
    container.innerHTML = `<div style="padding:16px 10px;font-size:0.78rem;color:var(--text-faint);">${escapeHtml(t('savedTurnsEmpty'))}</div>`;
    return;
  }
  container.innerHTML = turns.map((item) => {
    const active = item.id === state.activeSavedTurnId ? 'active' : '';
    const title = item.promptPreview || item.scheduleLabel || t('savedTurnsEmptyTitle');
    const from = item.conversationTitle || item.projectName || '';
    const turnLabel = item.scheduleLabel || (item.turnIndex != null ? `#${item.turnIndex}` : '');
    const metaLeft = [turnLabel, from].filter(Boolean).join(' · ');
    return `<button type="button" class="session-item ${active}" data-saved-turn="${escapeHtml(item.id)}" title="${escapeHtml(title)}">
      <div class="session-title-line">
        <span class="session-title-text">${escapeHtml(title)}</span>
        <span class="session-star-action saved-turn-remove" data-delete-saved-turn="${escapeHtml(item.id)}" title="${escapeHtml(t('removeSavedTurn'))}">×</span>
      </div>
      <div class="session-meta-line">
        <span class="session-meta-left"><span>${escapeHtml(metaLeft)}</span></span>
        <span>${escapeHtml(formatCompactDate(item.savedAt))}</span>
      </div>
    </button>`;
  }).join('');
}

function renderSidebarList() {
  state.sidebarDirtyWhileHovered = false;
  if (bgSidebarRenderTimer) {
    clearTimeout(bgSidebarRenderTimer);
    bgSidebarRenderTimer = null;
  }
  hideDocHoverPopover();
  const container = el('session-list');
  if (!container) return;
  const query = (el('sidebar-search')?.value || '').trim().toLowerCase();

  if (state.mode === 'docs') {
    const filtered = state.customPreviews.filter((p) =>
      !query ||
      p.title.toLowerCase().includes(query) ||
      (p.filePath || '').toLowerCase().includes(query) ||
      (p.excerpt || '').toLowerCase().includes(query)
    );
    if (filtered.length === 0) {
      container.innerHTML = `<div style="padding:16px 10px;font-size:0.78rem;color:var(--text-faint);">${t(state.filePickerAvailable ? 'noDocsYet' : 'noDocsYetNoPicker')}</div>`;
      return;
    }

    const storageFooterHtml = state.docsStoragePath
      ? `<div style="margin-top:auto;padding:10px 6px 4px;font-size:0.68rem;color:var(--text-faint);border-top:1px dashed var(--border);word-break:break-all;" title="${escapeHtml(state.docsStoragePath)}">${escapeHtml(t('savedIn'))} <code>${escapeHtml(state.docsStoragePath)}</code></div>`
      : '';

    container.innerHTML = filtered.map((doc) => {
      const active = doc.id === state.activePreviewId ? 'active' : '';
      const timeStr = formatCompactDate(doc.updatedAt);
      const isRenaming = state.renamingDocId === doc.id;
      const draggableAttr = state.docsManageMode && !isRenaming ? 'draggable="true"' : '';

      const dragHandleHtml = state.docsManageMode
        ? `<span class="doc-drag-handle" title="Drag to reorder">⠿</span>`
        : '';

      const mainInnerHtml = isRenaming
        ? `<input type="text" class="doc-rename-input" data-rename-input="${escapeHtml(doc.id)}" value="${escapeHtml(doc.title)}">`
        : `<div class="session-title-line">
            <span class="session-title-text">${escapeHtml(doc.title)}</span>
          </div>
          <div class="session-meta-line">
            <span class="session-project-pill">${escapeHtml(doc.baseDir ? doc.baseDir.split(/[\\/]/).pop() : doc.mode)}</span>
            <span>${escapeHtml(timeStr)}</span>
          </div>`;

      const manageBtnsHtml = state.docsManageMode && !isRenaming
        ? `<div class="doc-manage-actions">
            <button type="button" class="doc-action-btn" data-doc-rename="${escapeHtml(doc.id)}" title="Rename">✎</button>
            <button type="button" class="doc-action-btn danger" data-doc-delete="${escapeHtml(doc.id)}" title="Delete">🗑</button>
          </div>`
        : '';

      return `<div class="doc-item-card ${active}" data-doc-card="${escapeHtml(doc.id)}" ${draggableAttr}>
        ${dragHandleHtml}
        <div class="doc-item-main" data-preview-id="${escapeHtml(doc.id)}">${mainInnerHtml}</div>
        ${manageBtnsHtml}
      </div>`;
    }).join('') + (state.docsManageMode ? storageFooterHtml : '');

    if (state.renamingDocId) {
      const inp = container.querySelector(`[data-rename-input="${CSS.escape(state.renamingDocId)}"]`);
      if (inp) {
        inp.focus();
        inp.select();
      }
    }
    return;
  }

  if (state.sidebarSource === 'saved-turns') {
    renderSavedTurnsSidebar(container, query);
    return;
  }
  syncSavedTurnsChrome();

  const filtered = state.conversations.filter((c) => {
    if (!query) return true;
    const proj = resolveProjectLabel(c).toLowerCase();
    return (
      c.title.toLowerCase().includes(query) ||
      c.id.toLowerCase().includes(query) ||
      proj.includes(query) ||
      (c.preview || '').toLowerCase().includes(query) ||
      (c.userSearchText || '').toLowerCase().includes(query)
    );
  });

  noteSidebarRoster(groupConversations(state.conversations), state.sidebarOrder);

  if (filtered.length === 0) {
    container.innerHTML = `<div style="padding:16px 10px;font-size:0.78rem;color:var(--text-faint);">${escapeHtml(t('noSessionsMatch'))}</div>`;
    return;
  }

  const sortedGroups = sortGroupsBySidebarOrder(groupConversations(filtered), state.sidebarOrder);

  const cutoffMs = Date.now() - THREE_DAYS_MS;

  const byId = new Map(filtered.map((c) => [c.id, c]));
  const pinnedConvs = state.pinnedIds.map((id) => byId.get(id)).filter(Boolean);
  const pinnedOpen = query ? true : state.pinnedGroupOpen;
  const pinnedHasDecision = pinnedConvs.some(isConvWaitingDecision);
  const pinnedHasRunning = !pinnedHasDecision && pinnedConvs.some(isConvActivelyRunning);
  const pinnedHasUnread = pinnedConvs.some(sessionIsUnreadHighlight);
  const pinnedStatusHtml = pinnedHasDecision
    ? `<span class="status-dot decision-waiting" title="${escapeHtml(t('waitingDecisionPhase'))}"></span>`
    : (pinnedHasRunning
        ? `<span class="folder-status-wrap" title="${escapeHtml(t('sidebarRunningBadge'))}">${APPLE_SPINNER_SVG}</span>`
        : (pinnedHasUnread ? `<span class="status-dot unread-completed" title="${escapeHtml(t('unreadBadge'))}"></span>` : ''));
  const pinnedSectionHtml = pinnedConvs.length > 0
    ? `<div class="project-folder pinned-folder" data-open="${pinnedOpen}">
        <button type="button" class="project-folder-header" data-toggle-pinned-group>
          <span class="project-folder-left">
            ${CHEVRON_SVG}
            <span class="project-folder-name">${escapeHtml(t('pinnedHeader'))}</span>
            ${pinnedStatusHtml}
          </span>
          <span class="project-folder-meta">
            <span class="project-folder-count">${pinnedConvs.length}</span>
          </span>
        </button>
        <div class="project-folder-body">
          ${pinnedConvs.map((c) => renderSessionButtonHtml(c, { showProjectPill: true })).join('')}
        </div>
      </div>`
    : '';

  state.allProjectKeys = sortedGroups.map((g) => g.key);
  let anyOpen = false;

  const projectsHtml = sortedGroups.map((grp) => {
    const activeWithin3d = grp.latestUpdatedAt >= cutoffMs;
    const containsActiveConv = grp.items.some((s) => s.id === state.activeConvId);

    const isOpen = query
      ? true
      : (state.projectExpanded.has(grp.key)
          ? state.projectExpanded.get(grp.key)
          : (activeWithin3d || containsActiveConv));
    if (isOpen) anyOpen = true;

    const rootAll = grp.items.filter((s) => !s.isSubagent);
    const subAll = grp.items.filter((s) => s.isSubagent);
    const subsByParent = new Map();
    const rootIdSet = new Set(rootAll.map((r) => r.id));
    const orphanSubs = [];

    for (const sub of subAll) {
      if (sub.parentConversationId && rootIdSet.has(sub.parentConversationId)) {
        const list = subsByParent.get(sub.parentConversationId) || [];
        list.push(sub);
        subsByParent.set(sub.parentConversationId, list);
      } else {
        orphanSubs.push(sub);
      }
    }

    const recentRoots = rootAll.filter((s) => (s.updatedAt || 0) >= cutoffMs || s.id === state.activeConvId);
    const olderRoots = rootAll.filter((s) => (s.updatedAt || 0) < cutoffMs && s.id !== state.activeConvId);

    const showAllRoots = Boolean(query) || state.showOlderInProject.has(grp.key) || recentRoots.length === 0;
    const visibleRoots = showAllRoots ? rootAll : recentRoots;
    const hiddenRootCount = showAllRoots ? 0 : olderRoots.length;

    const countable = [];
    const rowsHtml = visibleRoots.map((rootConv) => {
      countable.push(rootConv);
      const childSubs = subsByParent.get(rootConv.id) || [];
      let subHtml = '';
      if (childSubs.length > 0) {
        const subGroupKey = `parent:${rootConv.id}`;
        const subExpanded = Boolean(query) || state.expandedSubagentGroups.has(subGroupKey) || childSubs.some((s) => s.id === state.activeConvId);
        if (subExpanded) countable.push(...childSubs);
        const subHasUnread = childSubs.some(sessionIsUnreadHighlight);
        const subUnit = childSubs.length === 1 ? t('subagentUnit') : t('subagentsUnit');
        subHtml = `<button type="button" class="subagent-group-toggle${subHasUnread ? ' has-unread' : ''}" data-toggle-subagents="${escapeHtml(subGroupKey)}">
            <span>${subExpanded ? '▾' : '▸'} ${childSubs.length} ${escapeHtml(subUnit)}</span>
            ${subHasUnread ? unreadStatusDotHtml() : ''}
          </button>
          ${subExpanded ? childSubs.map(renderSessionButtonHtml).join('') : ''}`;
      }
      return renderSessionButtonHtml(rootConv) + subHtml;
    }).join('');

    let orphanHtml = '';
    if (orphanSubs.length > 0) {
      const orphanKey = `orphan:${grp.key}`;
      const orphanOpen = Boolean(query) || state.expandedSubagentGroups.has(orphanKey) || orphanSubs.some((s) => s.id === state.activeConvId);
      if (orphanOpen) countable.push(...orphanSubs);
      const orphanHasUnread = orphanSubs.some(sessionIsUnreadHighlight);
      const orphanUnit = orphanSubs.length === 1 ? t('standaloneSubagentUnit') : t('standaloneSubagentsUnit');
      orphanHtml = `<button type="button" class="subagent-group-toggle${orphanHasUnread ? ' has-unread' : ''}" data-toggle-subagents="${escapeHtml(orphanKey)}">
          <span>${orphanOpen ? '▾' : '▸'} ${orphanSubs.length} ${escapeHtml(orphanUnit)}</span>
          ${orphanHasUnread ? unreadStatusDotHtml() : ''}
        </button>
        ${orphanOpen ? orphanSubs.map(renderSessionButtonHtml).join('') : ''}`;
    }

    const olderHasUnread = olderRoots.some(sessionIsUnreadHighlight);
    const olderBtnHtml = hiddenRootCount > 0
      ? `<button type="button" class="show-older-sessions-btn${olderHasUnread ? ' has-unread' : ''}" data-show-older-project="${escapeHtml(grp.key)}">${olderHasUnread ? unreadStatusDotHtml() : ''}${escapeHtml(t('olderSessionsBtn', { count: hiddenRootCount, unit: hiddenRootCount === 1 ? t('sessionUnit') : t('sessionsUnit') }))}</button>`
      : '';

    const displayCount = rootAll.length || grp.items.length;
    const folderTooltip = grp.workspaceUri ? `${grp.label} (${grp.workspaceUri})` : grp.label;
    const groupHasDecision = grp.items.some(isConvWaitingDecision);
    const groupHasRunning = !groupHasDecision && grp.items.some(isConvActivelyRunning);
    const groupHasUnread = folderShowsUnread(countable, {
      unreadIds: state.unreadConvIds,
      runningIds: countable.filter(isConvActivelyRunning).map((s) => s.id),
      activeId: state.mode === 'sessions' ? (state.activeConvId || '') : '',
      countableIds: countable.map((s) => s.id),
    });
    const groupRunningDot = groupHasDecision
      ? `<span class="status-dot decision-waiting" title="${escapeHtml(t('waitingDecisionPhase'))}"></span>`
      : (groupHasRunning
          ? `<span class="folder-status-wrap" title="${escapeHtml(t('sidebarRunningBadge'))}">${APPLE_SPINNER_SVG}</span>`
          : (groupHasUnread ? `<span class="status-dot unread-completed" title="${escapeHtml(t('unreadBadge'))}"></span>` : ''));

    return `<div class="project-folder" data-project-key="${escapeHtml(grp.key)}" data-open="${isOpen}">
      <button type="button" class="project-folder-header" data-toggle-project="${escapeHtml(grp.key)}" title="${escapeHtml(folderTooltip)}">
        <span class="project-folder-left">
          ${CHEVRON_SVG}
          <span class="project-folder-name">${escapeHtml(grp.label)}</span>
          ${groupRunningDot}
        </span>
        <span class="project-folder-meta">
          <span>${escapeHtml(formatCompactDate(grp.latestUpdatedAt))}</span>
          <span class="project-folder-count">${displayCount}</span>
        </span>
      </button>
      <div class="project-folder-body">
        ${rowsHtml}
        ${orphanHtml}
        ${olderBtnHtml}
      </div>
    </div>`;
  }).join('');

  state.anyProjectOpen = anyOpen;
  const collapseBtn = el('toggle-all-projects-btn');
  if (collapseBtn) {
    const listExpanded = anyOpen || state.showOlderInProject.size > 0;
    collapseBtn.textContent = listExpanded ? t('collapseProjectsBtn') : t('expandProjectsBtn');
  }
  const prevSidebarScroll = container.scrollTop;
  container.innerHTML = pinnedSectionHtml + projectsHtml;
  container.scrollTop = prevSidebarScroll;
}

function isHookActivelyRunning(hookState) {
  if (!hookState || !hookState.phase) return false;
  if (hookState.phase === 'stopped' || hookState.phase === 'idle' || hookState.phase === 'started') return false;
  const maxAge = (hookState.phase === 'tool_done' || hookState.phase === 'between_steps') ? 30000 : 75000;
  if (Date.now() - (hookState.updatedAt || 0) > maxAge) return false;
  return (
    hookState.phase === 'thinking' ||
    hookState.phase === 'running_tool' ||
    hookState.phase === 'tool_done' ||
    hookState.phase === 'between_steps'
  );
}

function connectSSE({ convId = '', previewId = '' } = {}) {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
  const qs = new URLSearchParams();
  if (convId) qs.set('conv', convId);
  if (previewId) qs.set('preview', previewId);
  if (state.flavor) qs.set('flavor', state.flavor);

  const es = new EventSource(`/api/events?${qs.toString()}`);
  state.eventSource = es;

  es.addEventListener('connected', (ev) => {
    setLiveBadge(t('liveSync'), 'live');
    try {
      const info = JSON.parse(ev.data || '{}');
      if (info.bootId) {
        if (state.serverBootId && state.serverBootId !== info.bootId) {
          // Server was restarted with updated code -> reload SPA modules automatically (especially helpful in --app window!)
          window.location.reload();
          return;
        }
        state.serverBootId = info.bootId;
      }
    } catch {}
  });

  es.addEventListener('auth', async () => {
    const auth = await checkAuthStatus();
    if (auth.authRequired && !auth.authenticated) {
      es.close();
      showAuthLockOverlay();
    }
  });

  es.addEventListener('transcript', (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.conversationId) {
        patchConversationSidebarState(data.conversationId, {
          hookState: data.hookState,
          stepCount: data.view?.summary?.totalSteps,
          activeStatus: data.view?.summary?.activeStatus,
          pendingDecision: data.view?.summary?.pendingDecision || null,
          updatedAt: data.updatedAt,
        });
      }
      if (data.conversationId && data.conversationId === state.activeConvId && state.mode === 'sessions') {
        state.currentViewData = { ...state.currentViewData, ...data };
        applyHookPhase(data.hookState, data.view?.summary);
        evaluateDecisionAlerts();
        const scrollEl = el('reader-scroll');
        const nearBottom = scrollEl ? (scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 160) : false;
        transcriptRenderer.render(data.conversationId, data.view, {
          isRunning: isHookActivelyRunning(data.hookState),
          isLiveUpdate: true,
          hookState: data.hookState || null,
          liveTaskLog: data.liveTaskLog || null,
          baseDir: state.currentBaseDir,
          subagents: state.currentViewData.subagents || [],
          parentSession: state.currentViewData.parentSession || null,
          cliInsights: state.currentViewData.cliInsights || null,
          artifacts: state.currentViewData.artifacts || [],
        });
        if (state.autoFollow && nearBottom && scrollEl) {
          scrollEl.scrollTop = scrollEl.scrollHeight;
        }
        renderCliToolsDrawer();
      }
    } catch {}
  });

  es.addEventListener('conversations-updated', () => {
    loadConversations({ fromBackground: true });
  });

  es.addEventListener('pinned-sessions', (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (Array.isArray(data.pinnedIds)) {
        state.pinnedIds = data.pinnedIds;
        try { localStorage.setItem('amp-pinned-sessions', JSON.stringify(state.pinnedIds)); } catch {}
        updatePinSessionButton();
        if (state.mode === 'sessions') scheduleBackgroundSidebarRender();
      }
    } catch {}
  });

  es.addEventListener('custom-palettes', (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (Array.isArray(data.palettes)) {
        state.customPalettes = sanitizeClientCustomPalettes(data.palettes);
        saveCustomPalettes({ syncServer: false });
        applyAppearance();
      }
    } catch {}
  });

  es.addEventListener('btw-updated', (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.conversationId === state.activeConvId && state.currentViewData?.cliInsights) {
        state.currentViewData.cliInsights.btwNotes = data.btwNotes || [];
        if (state.mode === 'sessions') renderCliToolsDrawer();
      }
    } catch {}
  });

  es.addEventListener('hook', (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.conversationId) {
        patchConversationSidebarState(data.conversationId, {
          hookState: data.hookState,
          updatedAt: data.hookState?.updatedAt || Date.now(),
        });
      }
      if (data.conversationId === state.activeConvId) {
        if (state.currentViewData) state.currentViewData.hookState = data.hookState;
        if (state.mode === 'sessions') {
          applyHookPhase(data.hookState);
          if (state.currentViewData?.view) {
            const scrollEl = el('reader-scroll');
            const nearBottom = scrollEl ? (scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 160) : false;
            transcriptRenderer.render(state.activeConvId, state.currentViewData.view, {
              isRunning: isHookActivelyRunning(data.hookState),
              isLiveUpdate: true,
              hookState: data.hookState || null,
              liveTaskLog: state.currentViewData.liveTaskLog || null,
              baseDir: state.currentBaseDir,
              subagents: state.currentViewData.subagents || [],
              parentSession: state.currentViewData.parentSession || null,
              cliInsights: state.currentViewData.cliInsights || null,
              artifacts: state.currentViewData.artifacts || [],
            });
            if (state.autoFollow && nearBottom && scrollEl) {
              scrollEl.scrollTop = scrollEl.scrollHeight;
            }
          }
        }
      }
      loadConversations({ fromBackground: true });
    } catch {}
  });

  es.addEventListener('custom-preview', (ev) => {
    try {
      const doc = JSON.parse(ev.data);
      loadCustomPreviews({ fromBackground: true });
      if (doc.id === state.activePreviewId && state.mode === 'docs') {
        const scrollEl = el('reader-scroll');
        const nearBottom = scrollEl ? (scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 160) : false;
        renderCustomPreview(doc);
        if (state.autoFollow && nearBottom && scrollEl) {
          scrollEl.scrollTop = scrollEl.scrollHeight;
        }
      }
    } catch {}
  });

  es.addEventListener('focus', (ev) => {
    try {
      const target = JSON.parse(ev.data);
      if (!target || (!target.previewId && !target.conversationId)) return;

      const hasActivePage = Boolean(
        (state.mode === 'sessions' && state.activeConvId) ||
        (state.mode === 'docs' && state.activePreviewId)
      );
      const samePreview = Boolean(target.previewId && state.mode === 'docs' && state.activePreviewId === target.previewId);
      const sameConv = Boolean(target.conversationId && state.mode === 'sessions' && state.activeConvId === target.conversationId);

      if (samePreview) {
        openCustomPreview(target.previewId, { preserveScroll: true });
        return;
      }
      if (sameConv) {
        if (target.flavor) state.flavor = target.flavor;
        openConversation(target.conversationId, { scrollToLatestUser: false });
        return;
      }

      if (target.force || !hasActivePage) {
        hideToast();
        if (target.previewId) {
          openCustomPreview(target.previewId);
        } else if (target.conversationId) {
          if (target.flavor) state.flavor = target.flavor;
          openConversation(target.conversationId);
        }
        return;
      }

      if (target.previewId) loadCustomPreviews({ fromBackground: true });
      else loadConversations({ fromBackground: true });
      showSwitchPromptToast(target);
    } catch {}
  });

  es.onerror = async () => {
    setLiveBadge(t('reconnecting'), 'idle');
    const auth = await checkAuthStatus();
    if (auth.authRequired && !auth.authenticated) {
      es.close();
      showAuthLockOverlay();
    }
  };
}

function applyHookPhase(hookState, viewSummary = undefined) {
  const summary = viewSummary !== undefined ? viewSummary : state.currentViewData?.view?.summary;
  if (state.mode === 'sessions' && summary?.activeStatus === 'waiting_decision') {
    setLiveBadge(t('waitingDecisionPhase'), 'decision');
    return;
  }
  if (
    state.mode === 'sessions' &&
    (summary?.activeStatus === 'canceled' || hookState?.terminationReason === 'USER_CANCELED') &&
    hookState?.phase === 'stopped' &&
    Date.now() - (hookState.updatedAt || 0) < 30000
  ) {
    setLiveBadge(t('stoppedCanceledPhase'), 'idle');
    return;
  }
  if (!hookState || !hookState.phase || summary?.activeStatus === 'canceled') {
    setLiveBadge(t('liveSync'), 'live');
    return;
  }
  const ageMs = Date.now() - (hookState.updatedAt || 0);
  if (ageMs > 60000 && hookState.phase !== 'stopped') {
    setLiveBadge(t('liveSync'), 'live');
    return;
  }
  if (hookState.phase === 'thinking') {
    setLiveBadge(t('thinkingPhase'), 'active');
  } else if (hookState.phase === 'running_tool') {
    setLiveBadge(t('runningToolPhase', { tool: hookState.toolName || 'tool' }), 'active');
  } else if (hookState.phase === 'tool_done') {
    setLiveBadge(t('toolDonePhase', { tool: hookState.toolName || 'tool' }), 'live');
  } else {
    setLiveBadge(t('liveSync'), 'live');
  }
}

function syncUrlState(paramsObj) {
  if (isSidecar || window.location.protocol === 'plugin:') return;
  try {
    const qs = new URLSearchParams(paramsObj);
    window.history.replaceState(null, '', `${window.location.pathname}?${qs.toString()}`);
  } catch {}
}

function scrollToLastUserTurn() {
  requestAnimationFrame(() => {
    const column = el('reader-column');
    const turns = column?.querySelectorAll('.turn-block');
    if (!turns || turns.length === 0) return;
    let target = null;
    for (let i = turns.length - 1; i >= 0; i--) {
      const uc = turns[i].querySelector('.user-card');
      if (uc) {
        target = uc;
        break;
      }
    }
    (target || turns[turns.length - 1])?.scrollIntoView({ behavior: 'instant', block: 'start' });
  });
}

function renderFolderListingIntoContainer(bodyEl, listingData, targetMode = 'sidebar') {
  if (!bodyEl || !listingData) return;
  const folder = listingData.folder || '';
  const parentFolder = listingData.parentFolder || '';
  const entries = listingData.entries || [];

  const iconForKind = (ent) => {
    if (ent.isDirectory) return '📁';
    if (ent.kind === 'markdown') return '📝';
    if (ent.kind === 'pdf') return '📕';
    if (ent.kind === 'docx' || ent.kind === 'doc') return '📘';
    if (ent.kind === 'xlsx') return '📗';
    if (ent.kind === 'pptx') return '📙';
    if (ent.kind === 'video') return '🎬';
    if (ent.kind === 'audio') return '🎵';
    if (ent.kind === 'image') return '🖼';
    if (ent.kind === 'csv') return '📊';
    if (ent.kind === 'code') return '📄';
    return '📦';
  };

  const rowsHtml = entries.length > 0
    ? entries.map((ent) => `
        <button type="button" class="folder-entry-row ${ent.isSelected ? 'selected' : ''}" data-folder-ent-path="${escapeHtml(ent.path)}" data-folder-ent-dir="${ent.isDirectory ? '1' : '0'}">
          <span class="folder-entry-left">
            <span>${iconForKind(ent)}</span>
            <span class="folder-entry-name">${escapeHtml(ent.name)}${ent.isDirectory ? '/' : ''}</span>
          </span>
          <span class="folder-entry-size">${ent.isDirectory ? '' : escapeHtml(formatFileSize(ent.size))}</span>
        </button>
      `).join('')
    : `<div style="padding:14px 8px;font-size:0.8rem;color:var(--text-faint);">${escapeHtml(t('emptyFolderHint'))}</div>`;

  bodyEl.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px;">
      <div class="media-toolbar">
        <code style="font-size:0.73rem;word-break:break-all;flex:1;">${escapeHtml(folder)}</code>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          ${parentFolder ? `<button type="button" class="code-mini-btn" data-folder-nav="${escapeHtml(parentFolder)}">${escapeHtml(t('parentFolderBtn'))}</button>` : ''}
          <button type="button" class="code-mini-btn" data-copy-folder-path="${escapeHtml(folder)}">${escapeHtml(t('copyPathBtn'))}</button>
        </div>
      </div>
      <div class="folder-browser-list">${rowsHtml}</div>
    </div>
  `;

  bodyEl.querySelector('[data-copy-folder-path]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    try {
      await navigator.clipboard.writeText(btn.dataset.copyFolderPath || '');
      btn.textContent = t('pathCopiedShort');
      setTimeout(() => { btn.textContent = t('copyPathBtn'); }, 1300);
    } catch {}
  });

  bodyEl.querySelector('[data-folder-nav]')?.addEventListener('click', (e) => {
    browseFolderInPreview(e.currentTarget.dataset.folderNav, '', targetMode);
  });

  bodyEl.querySelectorAll('[data-folder-ent-path]').forEach((row) => {
    row.addEventListener('click', () => {
      const p = row.dataset.folderEntPath;
      if (row.dataset.folderEntDir === '1') {
        browseFolderInPreview(p, '', targetMode);
      } else if (targetMode === 'popup') {
        openInPopupModal(p, folder);
      } else {
        openInSidePreview(p, folder);
      }
    });
  });

  requestAnimationFrame(() => {
    bodyEl.querySelector('.folder-entry-row.selected')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

async function browseFolderInPreview(folderPath, selectFile = '', targetMode = 'sidebar', preloadedData = null) {
  const reqId = targetMode === 'popup' ? ++state.popupReqSeq : ++state.sideReqSeq;
  let data = preloadedData;
  if (!data) {
    const qs = new URLSearchParams({ path: folderPath });
    if (selectFile) qs.set('select', selectFile);
    const res = await apiFetch(`/api/folder-entries?${qs.toString()}`);
    if (targetMode === 'popup' ? reqId !== state.popupReqSeq : reqId !== state.sideReqSeq) return;
    if (!res.ok) return;
    data = await res.json();
    if (targetMode === 'popup' ? reqId !== state.popupReqSeq : reqId !== state.sideReqSeq) return;
  }
  const leafName = (data.folder || folderPath).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || folderPath;
  if (targetMode === 'popup') {
    const modal = el('file-preview-modal');
    modal?.classList.remove('hidden');
    state.popupCurrent = { path: data.folder, rawHref: data.folder, baseDir: data.folder, kind: 'directory' };
    el('popup-preview-title').textContent = t('folderViewTitle', { name: leafName });
    el('popup-preview-path').textContent = data.folder;
    el('popup-wrap-btn')?.classList.add('hidden');
    el('popup-copy-btn')?.classList.add('hidden');
    renderFolderListingIntoContainer(el('popup-preview-body'), data, 'popup');
  } else {
    el('side-preview-pane')?.classList.remove('hidden');
    el('side-resizer')?.classList.remove('hidden');
    state.sideCurrent = { path: data.folder, rawHref: data.folder, baseDir: data.folder, kind: 'directory' };
    el('side-preview-title').textContent = t('folderViewTitle', { name: leafName });
    el('side-preview-path').textContent = data.folder;
    el('side-promote-btn')?.classList.add('hidden');
    el('side-wrap-btn')?.classList.add('hidden');
    el('side-copy-btn')?.classList.add('hidden');
    renderFolderListingIntoContainer(el('side-preview-body'), data, 'sidebar');
  }
}

async function revealInFolder(rawPath, baseDir = '', triggerBtn = null) {
  const effectivePath = (rawPath || '').trim() || (baseDir || '').trim() || state.currentBaseDir || '';
  if (!effectivePath) return;
  try {
    const res = await apiFetch('/api/reveal-in-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: effectivePath, base: baseDir || state.currentBaseDir || '' }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(t('openFolderErr', { error: err.error || `HTTP ${res.status}` }), true);
      return;
    }
    const data = await res.json();
    if (data.openedInOs === false) {
      if (data.folder) {
        try { await navigator.clipboard.writeText(data.folder); } catch {}
      }
      const inPopup = Boolean(triggerBtn?.closest('#file-preview-modal'));
      await browseFolderInPreview(data.folder, data.isDirectory ? '' : data.path, inPopup ? 'popup' : 'sidebar', data);
      showToast(t('pathCopiedToast'));
      return;
    }
    if (triggerBtn) {
      const prev = triggerBtn.textContent;
      triggerBtn.textContent = t('folderOpenedBtn');
      setTimeout(() => { triggerBtn.textContent = t('openFolderBtn') || prev; }, 1300);
    }
  } catch (err) {
    showToast(t('openFolderErr', { error: err.message }), true);
  }
}

async function loadSavedTurns() {
  try {
    const res = await apiFetch('/api/saved-turns');
    if (!res.ok) return;
    const data = await res.json();
    state.savedTurns = Array.isArray(data.turns) ? data.turns : [];
  } catch {}
  if (state.mode === 'sessions' && state.sidebarSource === 'saved-turns') renderSidebarList();
}

async function saveBtwInteraction(source = {}) {
  const question = String(source.question || '').trim();
  const noteId = String(source.noteId || '');
  const notes = state.currentViewData?.cliInsights?.btwNotes || [];
  const commands = state.currentViewData?.cliInsights?.btwCommands || [];
  const note = notes.find((item) => noteId && item.id === noteId) || notes.find((item) => question && item.question === question);
  const command = commands.find((item) => question && item.question === question);
  const fallback = buildBtwSavedTurn({
    question: question || note?.question || '',
    answer: note?.answer || '',
    noteId: note?.id || noteId,
    toolCount: note?.toolCount ?? command?.toolCalls,
    durationText: command?.durationText || '',
    status: command?.status || '',
    createdAt: note?.createdAt || command?.timestamp || Date.now(),
  });
  let turn = fallback;
  const forkId = btwForkConversationId(note?.id || noteId);
  if (forkId) {
    try {
      const res = await apiFetch(`/api/conversations/${encodeURIComponent(forkId)}/view?flavor=${encodeURIComponent(state.flavor)}`);
      if (res.ok) {
        const data = await res.json();
        const turns = data.view?.turns || [];
        const forkTurn = turns.find((item) => question && String(item.user?.request || '').includes(question)) || turns[turns.length - 1];
        if (forkTurn) {
          turn = JSON.parse(JSON.stringify(forkTurn));
          turn.kind = 'btw';
          turn.scheduleLabel = '/btw';
          const hasFinal = (turn.items || []).some((item) => item.kind === 'markdown' && !item.intermediate && item.text);
          if (!hasFinal && fallback.items[0]) turn.items = [...(turn.items || []), fallback.items[0]];
          if (!turn.user?.request) turn.user = fallback.user;
        }
      }
    } catch {}
  }
  return saveCurrentTurn(turn);
}

async function saveCurrentTurn(turn) {
  if (!turn) return false;
  let payloadTurn;
  try {
    payloadTurn = JSON.parse(JSON.stringify(turn));
  } catch {
    showToast(t('saveTurnFail'), true);
    return false;
  }
  const meta = state.conversations.find((c) => c.id === state.activeConvId);
  try {
    const res = await apiFetch('/api/saved-turns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: state.activeConvId || '',
        flavor: state.flavor,
        conversationTitle: meta?.title || el('doc-title')?.textContent || '',
        projectName: meta ? resolveProjectLabel(meta) : '',
        turn: payloadTurn,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const summary = await res.json();
    state.savedTurns = [summary, ...state.savedTurns.filter((item) => item.id !== summary.id)];
    showToast(t('savedTurnToast'));
    return true;
  } catch {
    showToast(t('saveTurnFail'), true);
    return false;
  }
}

async function openSavedTurn(id) {
  if (!id) return;
  const reqId = ++state.navSeq;
  state.mode = 'sessions';
  state.sidebarSource = 'saved-turns';
  state.activeSavedTurnId = id;
  state.activeConvId = null;
  syncFlavorSelect();
  updateModeButtons();
  updatePinSessionButton();
  renderSidebarList();
  try {
    const res = await apiFetch(`/api/saved-turns/${encodeURIComponent(id)}`);
    if (reqId !== state.navSeq || state.activeSavedTurnId !== id) return;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const record = await res.json();
    if (reqId !== state.navSeq || state.activeSavedTurnId !== id) return;
    const turn = record.turn;
    el('doc-title').textContent = record.promptPreview || record.conversationTitle || t('savedTurnsEmptyTitle');
    state.currentBaseDir = '';
    transcriptRenderer.render(`saved:${record.id}`, {
      turns: turn ? [turn] : [],
      summary: {
        totalTurns: 1,
        totalSteps: turn?.items?.length || 0,
        activeStatus: 'idle',
        totalInputTokens: turn?.stats?.tokensIn || 0,
        totalOutputTokens: turn?.stats?.tokensOut || 0,
        totalCacheReadTokens: 0,
      },
    }, { baseDir: '' });
    renderToc([]);
  } catch (err) {
    if (reqId !== state.navSeq || state.activeSavedTurnId !== id) return;
    el('reader-column').innerHTML = `<div class="notice-banner error">${escapeHtml(err.message)}</div>`;
  }
}

async function deleteSavedTurn(id) {
  if (!id) return;
  try {
    const res = await apiFetch(`/api/saved-turns/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) return;
  } catch {
    return;
  }
  state.savedTurns = state.savedTurns.filter((item) => item.id !== id);
  if (state.activeSavedTurnId === id) {
    state.activeSavedTurnId = null;
    el('doc-title').textContent = t('savedTurnsEmptyTitle');
    el('reader-column').innerHTML = `<div class="empty-state"><strong>${escapeHtml(t('savedTurnsEmptyTitle'))}</strong><span>${escapeHtml(t('savedTurnsEmpty'))}</span></div>`;
    renderToc([]);
  }
  renderSidebarList();
}

async function openConversation(convId, { scrollToLatestUser = true } = {}) {
  if (!convId) return;
  state.activeSavedTurnId = null;
  const reqId = ++state.navSeq;
  const prevConvId = state.activeConvId;
  if (state.mode === 'sessions' && prevConvId && prevConvId !== convId) {
    markConversationAsRead(prevConvId);
    stashConversationChrome(prevConvId);
  }
  state.mode = 'sessions';
  state.activeConvId = convId;
  if (prevConvId !== convId) restoreConversationChrome(convId);
  if (scrollToLatestUser) state.autoFollow = true;
  markConversationAsRead(convId);
  persistNavigationState({ mode: 'sessions', convId });
  syncUrlState({ conv: convId, flavor: state.flavor });
  updateModeButtons();
  updatePinSessionButton();

  const meta = state.conversations.find((c) => c.id === convId);
  el('doc-title').textContent = meta?.title || `Session ${convId.slice(0, 8)}`;
  renderSidebarList();

  try {
    const res = await apiFetch(`/api/conversations/${encodeURIComponent(convId)}/view?flavor=${encodeURIComponent(state.flavor)}`);
    if (reqId !== state.navSeq || state.mode !== 'sessions' || state.activeConvId !== convId) return;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (reqId !== state.navSeq || state.mode !== 'sessions' || state.activeConvId !== convId) return;
    state.currentViewData = data;
    markConversationAsRead(convId, data.view?.summary?.totalSteps || 0);
    const freshMeta = state.conversations.find((c) => c.id === convId) || meta;
    state.currentBaseDir = data.baseDir || freshMeta?.workspaceUri || '';
    if (data.flavor && data.flavor !== state.flavor) {
      state.flavor = data.flavor;
      localStorage.setItem('amp-flavor', state.flavor);
      const flavorSel = el('flavor-select');
      if (flavorSel && Array.from(flavorSel.options).some((o) => o.value === data.flavor)) {
        flavorSel.value = data.flavor;
      }
      syncUrlState({ conv: convId, flavor: state.flavor });
      loadConversations();
    }
    if (freshMeta?.title) el('doc-title').textContent = freshMeta.title;
    patchConversationSidebarState(convId, {
      hookState: data.hookState,
      stepCount: data.view?.summary?.totalSteps,
      activeStatus: data.view?.summary?.activeStatus,
      pendingDecision: data.view?.summary?.pendingDecision || null,
      updatedAt: data.updatedAt,
    });
    applyHookPhase(data.hookState, data.view?.summary);
    transcriptRenderer.render(convId, data.view, {
      isRunning: isHookActivelyRunning(data.hookState),
      hookState: data.hookState || null,
      liveTaskLog: data.liveTaskLog || null,
      baseDir: state.currentBaseDir,
      subagents: data.subagents || [],
      parentSession: data.parentSession || null,
      cliInsights: data.cliInsights || null,
      artifacts: data.artifacts || [],
    });
    if (scrollToLatestUser) {
      if (data.view?.summary?.activeStatus === 'waiting_decision') {
        scrollToDecisionCard(data.view?.summary?.pendingDecision?.id || '');
      } else {
        scrollToLastUserTurn();
      }
    }
    evaluateDecisionAlerts();
    renderCliToolsDrawer();
    connectSSE({ convId });
  } catch (err) {
    if (reqId !== state.navSeq || state.mode !== 'sessions' || state.activeConvId !== convId) return;
    el('reader-column').innerHTML = `<div class="notice-banner error">Failed to load conversation: ${escapeHtml(err.message)}</div>`;
  }
}

/* -------------------------------------------------------------------------
 * Shared File & Rich Media Renderer (Popup Modal, Side Pane, and Main Stage)
 * ------------------------------------------------------------------------- */

function parseLineRangeHash(hashStr) {
  if (!hashStr) return null;
  const m = hashStr.match(/^L(\d+)(?:-L?(\d+))?$/i);
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2] ? Number(m[2]) : start;
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

function parseDelimitedTable(rawText, delimiter = ',') {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = String(rawText || '').replace(/\r\n/g, '\n');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows;
}

function formatFileSize(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function renderCodeWithLineNumbers(content, lang, lineRange, viewId = 'side-code-view') {
  let highlightedLines;
  if (window.hljs && lang && window.hljs.getLanguage(lang)) {
    try {
      const res = window.hljs.highlight(content, { language: lang, ignoreIllegals: true });
      highlightedLines = res.value.split('\n');
    } catch {
      highlightedLines = content.split('\n').map(escapeHtml);
    }
  } else if (window.hljs) {
    try {
      const res = window.hljs.highlightAuto(content.slice(0, 60000));
      highlightedLines = content.length <= 60000 ? res.value.split('\n') : content.split('\n').map(escapeHtml);
    } catch {
      highlightedLines = content.split('\n').map(escapeHtml);
    }
  } else {
    highlightedLines = content.split('\n').map(escapeHtml);
  }

  const rowsHtml = highlightedLines.map((lineHtml, i) => {
    const ln = i + 1;
    const isHit = lineRange && ln >= lineRange.start && ln <= lineRange.end;
    return `<tr class="side-code-row${isHit ? ' highlighted' : ''}" data-ln="${ln}">
      <td class="side-code-ln">${ln}</td>
      <td class="side-code-line-text">${lineHtml || ' '}</td>
    </tr>`;
  }).join('');

  return `<div id="${viewId}" class="side-code-view"><table class="side-code-table"><tbody>${rowsHtml}</tbody></table></div>`;
}

function bindMediaStageControls(bodyEl) {
  const mediaEl = bodyEl.querySelector('video, audio');
  if (mediaEl) {
    bodyEl.querySelectorAll('[data-media-rate]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const rate = Number(btn.dataset.mediaRate) || 1;
        mediaEl.playbackRate = rate;
        bodyEl.querySelectorAll('[data-media-rate]').forEach((b) => b.classList.toggle('active', b === btn));
      });
    });
    const loopBtn = bodyEl.querySelector('[data-media-loop]');
    loopBtn?.addEventListener('click', () => {
      mediaEl.loop = !mediaEl.loop;
      loopBtn.classList.toggle('active', mediaEl.loop);
    });
  }

  bodyEl.querySelector('[data-reveal-path]')?.addEventListener('click', (e) => {
    revealInFolder(e.currentTarget.dataset.revealPath, '', e.currentTarget);
  });

  const csvWrap = bodyEl.querySelector('[data-csv-stage]');
  if (csvWrap) {
    const tablePane = csvWrap.querySelector('[data-csv-table-pane]');
    const rawPane = csvWrap.querySelector('[data-csv-raw-pane]');
    csvWrap.querySelector('[data-csv-mode="table"]')?.addEventListener('click', (e) => {
      tablePane?.classList.remove('hidden');
      rawPane?.classList.add('hidden');
      csvWrap.querySelectorAll('[data-csv-mode]').forEach((b) => b.classList.toggle('active', b === e.currentTarget));
    });
    csvWrap.querySelector('[data-csv-mode="raw"]')?.addEventListener('click', (e) => {
      tablePane?.classList.add('hidden');
      rawPane?.classList.remove('hidden');
      csvWrap.querySelectorAll('[data-csv-mode]').forEach((b) => b.classList.toggle('active', b === e.currentTarget));
    });
  }
}

function markdownViewToggleInnerHtml() {
  const source = state.mdSource;
  return `<button type="button" class="prefs-seg-btn ${source ? '' : 'active'}" data-md-view="rendered">${escapeHtml(t('mdViewRendered'))}</button><button type="button" class="prefs-seg-btn ${source ? 'active' : ''}" data-md-view="source">${escapeHtml(t('mdViewSource'))}</button>`;
}

function syncMarkdownViewControls() {
  const html = markdownViewToggleInnerHtml();
  const tip = t('mdViewTip');
  document.querySelectorAll('[data-md-view-toggle]').forEach((node) => {
    node.title = tip;
    node.innerHTML = html;
  });
  const showSide = Boolean(el('side-preview-body')?.querySelector('[data-md-stage]'));
  el('side-md-view')?.classList.toggle('hidden', !showSide);
  const showPopup = Boolean(el('popup-preview-body')?.querySelector('[data-md-stage]'));
  el('popup-md-view')?.classList.toggle('hidden', !showPopup);
}

function collectHeadingToc(container, idPrefix) {
  const toc = [];
  const seenIds = new Set();
  let hIdx = 0;
  const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
  if (!headings.length) {
    appendLeadOutlineItem(toc, container, { anchorId: `${idPrefix}-lead`, level: 1, seenIds });
    return toc;
  }
  headings.forEach((h) => {
    if (!h.id || seenIds.has(h.id)) h.id = `${idPrefix}-h-${++hIdx}`;
    seenIds.add(h.id);
    const txt = h.textContent.trim();
    const level = Math.min(3, Number(h.tagName.slice(1)) || 1);
    toc.push({ id: h.id, label: txt, fullTitle: txt, level, isTurn: false });
  });
  return toc;
}

function buildMarkdownSource(markdown, idPrefix) {
  const pre = document.createElement('pre');
  pre.className = 'md-source-view';
  const toc = [];
  const lines = String(markdown ?? '').split('\n');
  let inFence = false;
  lines.forEach((line, index) => {
    if (index > 0) pre.appendChild(document.createTextNode('\n'));
    const fence = line.trim().match(/^(```+|~~~+)/);
    if (fence) inFence = !inFence;
    const heading = !inFence && line.match(/^(#{1,6})[ \t]+(.+?)\s*#*\s*$/);
    if (heading) {
      const span = document.createElement('span');
      span.id = `${idPrefix}-src-${toc.length + 1}`;
      span.textContent = line;
      pre.appendChild(span);
      const label = heading[2].replace(/[*_`~]/g, '').trim();
      toc.push({
        id: span.id,
        label,
        fullTitle: label,
        level: Math.min(3, heading[1].length),
        isTurn: false,
      });
    } else {
      pre.appendChild(document.createTextNode(line));
    }
  });
  if (!toc.length) {
    appendLeadOutlineItem(toc, pre, { anchorId: `${idPrefix}-src-lead`, level: 1, seenIds: new Set() });
  }
  return { node: pre, toc };
}

function renderMarkdownInto(host) {
  const markdown = host._mdSource || '';
  const baseDir = host._mdBaseDir || '';
  const sourceMode = state.mdSource;
  host.innerHTML = '';
  if (sourceMode) {
    const built = buildMarkdownSource(markdown, host._mdPrefix || 'md');
    host.appendChild(built.node);
    return built.toc;
  }

  const article = document.createElement('article');
  article.className = 'assistant-markdown';
  let md = markdown;
  const thinkBlocks = [];
  if (host._mdExtractThink) {
    md = md.replace(/<(think|thinking|thought)>([\s\S]*?)<\/\1>/gi, (_, __, inner) => {
      const idx = thinkBlocks.length;
      thinkBlocks.push(inner.trim());
      return `\n\n<div data-think-slot="${idx}"></div>\n\n`;
    });
  }
  article.innerHTML = renderMarkdownHtml(md, { baseDir });
  article.querySelectorAll('[data-think-slot]').forEach((slot) => {
    const text = thinkBlocks[Number(slot.dataset.thinkSlot)] || '';
    const details = document.createElement('details');
    details.className = 'disclosure-card thinking-card';
    details.innerHTML = `<summary class="disclosure-trigger" style="list-style:none;">
      <span class="thinking-label">${escapeHtml(t('thoughtLabel'))}</span>
      <span class="thinking-preview">${escapeHtml(text.split(/\r?\n/)[0] || '')}</span>
    </summary><div class="thinking-body assistant-markdown" style="display:block;">${renderMarkdownHtml(text, { baseDir })}</div>`;
    slot.replaceWith(details);
  });
  enhanceMarkdownDom(article, resolvedTheme());
  host.appendChild(article);
  return collectHeadingToc(article, host._mdPrefix || 'md');
}

function caretAtPoint(x, y) {
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    if (pos?.offsetNode) return { node: pos.offsetNode, offset: pos.offset };
  }
  if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(x, y);
    if (range) return { node: range.startContainer, offset: range.startOffset };
  }
  return null;
}

function textOffsetInRoot(root, node, offset) {
  if (!root || !node || !root.contains(node)) return null;
  let target = node;
  let targetOffset = offset;
  if (target.nodeType !== Node.TEXT_NODE) {
    const el = target.nodeType === Node.ELEMENT_NODE ? target : target.parentElement;
    const first = el ? document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode() : null;
    if (!first) return null;
    target = first;
    targetOffset = 0;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let count = 0;
  let current = walker.nextNode();
  while (current) {
    if (current === target) return count + Math.max(0, Math.min(targetOffset, current.nodeValue.length));
    count += current.nodeValue.length;
    current = walker.nextNode();
  }
  return null;
}

function captureViewportAnchor(scrollEl, contentEl) {
  if (!scrollEl || !contentEl) return null;
  const max = Math.max(1, scrollEl.scrollHeight - scrollEl.clientHeight);
  const ratio = scrollEl.scrollTop / max;
  const view = scrollEl.getBoundingClientRect();
  const content = contentEl.getBoundingClientRect();
  const x = Math.min(Math.max(content.left + 28, view.left + 12), view.right - 12);
  const y = view.top + view.height / 2;
  let offset = null;
  for (const dy of [0, -36, 36, -84, 84]) {
    const hit = caretAtPoint(x, y + dy);
    offset = hit ? textOffsetInRoot(contentEl, hit.node, hit.offset) : null;
    if (offset != null) break;
  }
  const probe = offset == null ? '' : anchorProbe(contentEl.textContent || '', offset);
  return { probe, ratio };
}

function normalizedIndexMap(root) {
  const entries = [];
  let norm = '';
  let lastSpace = true;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const value = node.nodeValue || '';
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (isAnchorMarkup(ch)) continue;
      if (/\s/.test(ch)) {
        if (lastSpace) continue;
        norm += ' ';
        entries.push({ node, offset: i });
        lastSpace = true;
        continue;
      }
      norm += ch;
      entries.push({ node, offset: i });
      lastSpace = false;
    }
    node = walker.nextNode();
  }
  let start = 0;
  while (start < norm.length && norm[start] === ' ') start += 1;
  let end = norm.length;
  while (end > start && norm[end - 1] === ' ') end -= 1;
  return { norm: norm.slice(start, end), entries: entries.slice(start, end) };
}

function scrollDomPointToCenter(scrollEl, node, offset) {
  if (!scrollEl || !node || node.nodeType !== Node.TEXT_NODE) return;
  const range = document.createRange();
  const safe = Math.max(0, Math.min(offset, node.nodeValue.length));
  range.setStart(node, safe);
  range.collapse(true);
  const rect = range.getClientRects()[0] || range.getBoundingClientRect();
  if (!rect) return;
  const view = scrollEl.getBoundingClientRect();
  const delta = (rect.top + Math.max(rect.height, 1) / 2) - (view.top + view.height / 2);
  const previous = scrollEl.style.scrollBehavior;
  scrollEl.style.scrollBehavior = 'auto';
  scrollEl.scrollTop += delta;
  scrollEl.style.scrollBehavior = previous;
}

function restoreViewportAnchor(scrollEl, contentEl, anchor) {
  if (!scrollEl || !contentEl || !anchor) return;
  const apply = () => {
    const mapped = normalizedIndexMap(contentEl);
    const at = locateAnchorProbe(mapped.norm, anchor.probe);
    const entry = at >= 0 ? mapped.entries[Math.min(at, mapped.entries.length - 1)] : null;
    if (entry) {
      scrollDomPointToCenter(scrollEl, entry.node, entry.offset);
      return;
    }
    const max = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
    const previous = scrollEl.style.scrollBehavior;
    scrollEl.style.scrollBehavior = 'auto';
    scrollEl.scrollTop = (anchor.ratio || 0) * max;
    scrollEl.style.scrollBehavior = previous;
  };
  apply();
  requestAnimationFrame(apply);
  contentEl.querySelectorAll('img').forEach((img) => {
    if (!img.complete) img.addEventListener('load', apply, { once: true });
  });
}

function listMarkdownSurfaces() {
  const surfaces = [];
  const main = document.querySelector('#reader-column [data-md-stage]');
  if (main) surfaces.push({ host: main, scrollEl: el('reader-scroll'), updateToc: true });
  const side = el('side-preview-body')?.querySelector('[data-md-stage]');
  if (side) surfaces.push({ host: side, scrollEl: el('side-preview-body'), updateToc: false });
  const popup = el('popup-preview-body')?.querySelector('[data-md-stage]');
  if (popup) surfaces.push({ host: popup, scrollEl: el('popup-preview-body'), updateToc: false });
  return surfaces;
}

function setMarkdownSourceMode(source) {
  const next = Boolean(source);
  if (next === state.mdSource) return;
  const surfaces = listMarkdownSurfaces();
  const anchors = surfaces.map((item) => captureViewportAnchor(item.scrollEl, item.host));
  state.mdSource = next;
  try { localStorage.setItem('amp-md-source', next ? '1' : '0'); } catch {}
  surfaces.forEach((item, index) => {
    const toc = renderMarkdownInto(item.host);
    if (item.updateToc) renderToc(toc);
    restoreViewportAnchor(item.scrollEl, item.host, anchors[index]);
  });
  syncMarkdownViewControls();
}

function populatePreviewBody(bodyEl, info, codeViewId) {
  try {
    populatePreviewBodyNow(bodyEl, info, codeViewId);
  } finally {
    if (!bodyEl?.querySelector('[data-md-stage]')) syncMarkdownViewControls();
  }
}

function populatePreviewBodyNow(bodyEl, info, codeViewId) {
  if (info.kind === 'image') {
    bodyEl.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:12px;">
      <img src="${escapeHtml(info.rawUrl)}" alt="${escapeHtml(info.filename)}" class="md-image" data-zoomable="true" style="max-height:74vh;">
      <span style="font-size:0.75rem;color:var(--text-faint);">${escapeHtml(formatFileSize(info.size))}</span>
    </div>`;
    return;
  }

  if (info.kind === 'pdf') {
    renderCustomPdfViewer(bodyEl, {
      rawUrl: info.rawUrl,
      sizeText: formatFileSize(info.size),
      hash: info.hash || '',
      apiFetch,
    });
    return;
  }

  if (info.kind === 'docx' || info.kind === 'doc') {
    renderWordViewer(bodyEl, {
      rawUrl: info.rawUrl,
      filePath: info.path || '',
      baseDir: info.baseDir || '',
      ext: info.ext || (info.kind === 'doc' ? '.doc' : '.docx'),
      sizeText: formatFileSize(info.size),
      apiFetch,
    });
    return;
  }

  if (info.kind === 'xlsx') {
    renderSpreadsheetViewer(bodyEl, {
      rawUrl: info.rawUrl,
      ext: info.ext || '.xlsx',
      sizeText: formatFileSize(info.size),
      apiFetch,
    });
    return;
  }

  if (info.kind === 'pptx') {
    renderPresentationViewer(bodyEl, {
      rawUrl: info.rawUrl,
      filePath: info.path || '',
      baseDir: info.baseDir || '',
      ext: info.ext || '.pptx',
      sizeText: formatFileSize(info.size),
      apiFetch,
    });
    return;
  }

  if (info.kind === 'video') {
    const speeds = [0.5, 1, 1.25, 1.5, 2];
    bodyEl.innerHTML = `<div class="media-preview-stage">
      <div class="media-toolbar">
        <span>${escapeHtml((info.ext || 'video').toUpperCase().replace('.', ''))} · ${escapeHtml(formatFileSize(info.size))}</span>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span>${escapeHtml(t('mediaSpeedLabel'))}:</span>
          <div class="prefs-seg-group">
            ${speeds.map((s) => `<button type="button" class="prefs-seg-btn ${s === 1 ? 'active' : ''}" data-media-rate="${s}">${s}×</button>`).join('')}
          </div>
          <button type="button" class="prefs-seg-btn" data-media-loop style="border:1px solid var(--border);">${escapeHtml(t('mediaLoopBtn'))}</button>
        </div>
      </div>
      <div class="media-video-box">
        <video class="media-video-player" src="${escapeHtml(info.rawUrl)}" controls playsinline preload="metadata"></video>
      </div>
    </div>`;
    bindMediaStageControls(bodyEl);
    return;
  }

  if (info.kind === 'audio') {
    const speeds = [0.75, 1, 1.25, 1.5, 2];
    bodyEl.innerHTML = `<div class="media-preview-stage">
      <div class="media-audio-card">
        <strong style="font-size:0.92rem;color:var(--text-main);">🎵 ${escapeHtml(info.filename)}</strong>
        <span style="font-size:0.75rem;color:var(--text-faint);">${escapeHtml(formatFileSize(info.size))}</span>
        <audio class="media-audio-player" src="${escapeHtml(info.rawUrl)}" controls preload="metadata"></audio>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span style="font-size:0.74rem;color:var(--text-muted);">${escapeHtml(t('mediaSpeedLabel'))}:</span>
          <div class="prefs-seg-group">
            ${speeds.map((s) => `<button type="button" class="prefs-seg-btn ${s === 1 ? 'active' : ''}" data-media-rate="${s}">${s}×</button>`).join('')}
          </div>
          <button type="button" class="prefs-seg-btn" data-media-loop style="border:1px solid var(--border);">${escapeHtml(t('mediaLoopBtn'))}</button>
        </div>
      </div>
    </div>`;
    bindMediaStageControls(bodyEl);
    return;
  }

  if (info.kind === 'csv') {
    const delim = info.ext === '.tsv' ? '\t' : ',';
    const allRows = parseDelimitedTable(info.content || '', delim);
    const maxRows = 400;
    const shownRows = allRows.slice(0, maxRows);
    const header = shownRows[0] || [];
    const bodyRows = shownRows.slice(1);
    const truncNote = allRows.length > maxRows
      ? ` · ${escapeHtml(t('csvTruncatedHint', { shown: maxRows, total: allRows.length }))}`
      : '';
    const theadHtml = header.length
      ? `<thead><tr>${header.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>`
      : '';
    const tbodyHtml = bodyRows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('');

    bodyEl.innerHTML = `<div data-csv-stage style="display:flex;flex-direction:column;gap:10px;">
      <div class="media-toolbar">
        <span>${escapeHtml(t('csvMeta', { rows: Math.max(0, allRows.length - 1), cols: header.length }))}${truncNote}</span>
        <div class="prefs-seg-group">
          <button type="button" class="prefs-seg-btn active" data-csv-mode="table">${escapeHtml(t('csvTableBtn'))}</button>
          <button type="button" class="prefs-seg-btn" data-csv-mode="raw">${escapeHtml(t('csvRawBtn'))}</button>
        </div>
      </div>
      <div data-csv-table-pane class="assistant-markdown">
        <div class="table-card expanded"><div class="table-wrap"><table>${theadHtml}<tbody>${tbodyHtml}</tbody></table></div></div>
      </div>
      <div data-csv-raw-pane class="hidden">${renderCodeWithLineNumbers(info.content || '', 'plaintext', null, codeViewId)}</div>
    </div>`;
    bindMediaStageControls(bodyEl);
    return;
  }

  if (info.kind === 'markdown') {
    const stage = document.createElement('div');
    stage.dataset.mdStage = '1';
    stage._mdSource = info.content || '';
    stage._mdBaseDir = info.baseDir || '';
    stage._mdPrefix = bodyEl.id === 'side-preview-body' ? 'side' : (bodyEl.id === 'popup-preview-body' ? 'pop' : 'doc');
    stage._mdExtractThink = false;
    const pendingAnchor = bodyEl._pendingMdAnchor || null;
    delete bodyEl._pendingMdAnchor;
    bodyEl.innerHTML = '';
    bodyEl.appendChild(stage);
    renderMarkdownInto(stage);
    syncMarkdownViewControls();
    if (pendingAnchor) {
      restoreViewportAnchor(bodyEl, stage, pendingAnchor);
    } else {
      bodyEl.scrollTop = 0;
      if (!state.mdSource && info.hash) {
        const decoded = decodeURIComponent(info.hash);
        const target = stage.querySelector(`#${CSS.escape(decoded)}`) || stage.querySelector(`#${CSS.escape(slugifyHeading(decoded))}`);
        requestAnimationFrame(() => target?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      }
    }
    return;
  }

  if (info.kind === 'code') {
    const lineRange = parseLineRangeHash(info.hash);
    bodyEl.innerHTML = renderCodeWithLineNumbers(info.content || '', info.lang, lineRange, codeViewId);
    if (lineRange) {
      requestAnimationFrame(() => {
        const firstHit = bodyEl.querySelector(`.side-code-row[data-ln="${lineRange.start}"]`);
        firstHit?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    } else {
      bodyEl.scrollTop = 0;
    }
    return;
  }

  bodyEl.innerHTML = `<div class="notice-banner" style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
    <span>${escapeHtml(t('binaryFileNotice', { size: (info.size / 1024).toFixed(1) }))} <code>${escapeHtml(info.path)}</code></span>
    <button type="button" class="code-mini-btn" data-reveal-path="${escapeHtml(info.path)}" title="${escapeHtml(t('openFolderTip'))}">${escapeHtml(t('openFolderBtn'))}</button>
  </div>`;
  bindMediaStageControls(bodyEl);
}

function renderCustomPreview(doc) {
  state.currentCustomDoc = doc;
  state.currentBaseDir = doc.baseDir || '';
  el('doc-title').textContent = doc.title || t('brandTitle');
  const column = el('reader-column');

  if (doc.parsed?.mode === 'transcript' && doc.parsed.view) {
    transcriptRenderer.render(doc.id, doc.parsed.view, { baseDir: state.currentBaseDir });
    return;
  }

  column.innerHTML = '';

  const baseBanner = document.createElement('div');
  baseBanner.className = 'session-ribbon';
  baseBanner.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">
      <span style="font-weight:600;flex-shrink:0;">${escapeHtml(t('baseDirLabel'))}</span>
      <input id="doc-basedir-input" class="input-sm" type="text" value="${escapeHtml(state.currentBaseDir)}" placeholder="${escapeHtml(t('baseDirPlaceholder'))}" style="flex:1;">
      <button id="doc-basedir-apply" class="code-mini-btn" type="button">${escapeHtml(t('applyBtn'))}</button>
      ${(doc.filePath || state.currentBaseDir) ? `<button id="doc-basedir-reveal" class="code-mini-btn" type="button" title="${escapeHtml(t('openFolderTip'))}">${escapeHtml(t('openFolderBtn'))}</button>` : ''}
    </div>
  `;
  baseBanner.querySelector('#doc-basedir-reveal')?.addEventListener('click', (e) => {
    revealInFolder(doc.filePath || state.currentBaseDir, state.currentBaseDir, e.currentTarget);
  });
  baseBanner.querySelector('#doc-basedir-apply')?.addEventListener('click', async () => {
    const newBase = baseBanner.querySelector('#doc-basedir-input')?.value.trim() || '';
    const res = await apiFetch(`/api/previews/${encodeURIComponent(doc.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseDir: newBase }),
    });
    if (res.ok) {
      const updated = await res.json();
      await loadCustomPreviews();
      renderCustomPreview(updated);
    }
  });
  column.appendChild(baseBanner);

  if ((doc.parsed?.mode === 'media' || doc.parsed?.mode === 'csv') && doc.filePath) {
    const mediaStage = document.createElement('div');
    column.appendChild(mediaStage);
    populatePreviewBody(mediaStage, {
      path: doc.filePath,
      filename: doc.title || doc.filePath.split(/[\\/]/).pop(),
      baseDir: state.currentBaseDir,
      hash: '',
      size: doc.parsed.size || (doc.rawText ? doc.rawText.length : 0),
      kind: doc.parsed.mediaKind || 'csv',
      ext: doc.parsed.ext || (doc.filePath.includes('.') ? `.${doc.filePath.split('.').pop().toLowerCase()}` : ''),
      rawUrl: `/api/raw-file?path=${encodeURIComponent(doc.filePath)}`,
      content: doc.rawText || '',
    }, 'main-csv-code-view');
    renderToc([]);
    return;
  }

  const stage = document.createElement('div');
  stage.dataset.mdStage = '1';
  stage._mdSource = doc.parsed?.markdown ?? doc.rawText ?? '';
  stage._mdBaseDir = state.currentBaseDir;
  stage._mdPrefix = 'doc';
  stage._mdExtractThink = true;
  column.appendChild(stage);
  const viewToggle = document.createElement('div');
  viewToggle.id = 'doc-md-view';
  viewToggle.className = 'prefs-seg-group';
  viewToggle.dataset.mdViewToggle = 'doc';
  viewToggle.style.marginLeft = 'auto';
  baseBanner.querySelector('div')?.appendChild(viewToggle);
  renderToc(renderMarkdownInto(stage));
  syncMarkdownViewControls();
}

function showEmptyDocsStage() {
  ++state.navSeq;
  acknowledgeOpenSession();
  state.mode = 'docs';
  state.activePreviewId = null;
  state.currentCustomDoc = null;
  persistNavigationState({ mode: 'docs' });
  syncUrlState({ mode: 'docs' });
  setLiveBadge(t('liveSync'), 'live');
  updateModeButtons();
  renderSidebarList();
  el('doc-title').textContent = t('tabDocs');
  el('reader-column').innerHTML = `<div class="empty-state"><strong>${escapeHtml(t('docsEmptyTitle'))}</strong><span>${t(state.filePickerAvailable ? 'docsEmptyHint' : 'docsEmptyHintNoPicker')}</span></div>`;
  renderToc([]);
  connectSSE();
}

async function openCustomPreview(previewId, { preserveScroll = false } = {}) {
  if (!previewId) return;
  const reqId = ++state.navSeq;
  acknowledgeOpenSession();
  state.mode = 'docs';
  state.activePreviewId = previewId;
  persistNavigationState({ mode: 'docs', previewId });
  syncUrlState({ preview: previewId });
  setLiveBadge(t('liveSync'), 'live');
  updateModeButtons();
  renderSidebarList();

  try {
    const res = await apiFetch(`/api/previews/${encodeURIComponent(previewId)}`);
    if (reqId !== state.navSeq || state.mode !== 'docs' || state.activePreviewId !== previewId) return;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const doc = await res.json();
    if (reqId !== state.navSeq || state.mode !== 'docs' || state.activePreviewId !== previewId) return;
    const scrollEl = el('reader-scroll');
    const prevScroll = preserveScroll && scrollEl ? scrollEl.scrollTop : 0;
    renderCustomPreview(doc);
    if (scrollEl) {
      scrollEl.scrollTop = preserveScroll ? prevScroll : 0;
    }
    connectSSE({ previewId });
  } catch (err) {
    if (reqId !== state.navSeq || state.mode !== 'docs' || state.activePreviewId !== previewId) return;
    el('reader-column').innerHTML = `<div class="notice-banner error">Failed to load preview: ${escapeHtml(err.message)}</div>`;
  }
}

async function fetchFileInfo(rawHref, baseDir) {
  const effectiveBase = baseDir || state.currentBaseDir || '';
  const qs = new URLSearchParams({ path: rawHref });
  if (effectiveBase) qs.set('base', effectiveBase);
  const res = await apiFetch(`/api/file-info?${qs.toString()}`);
  const info = await res.json();
  if (!res.ok) {
    throw new Error(info.error || `Failed to open (${res.status})`);
  }
  return info;
}

/* 1. Popup Preview Modal */
async function openInPopupModal(rawHref, baseDir = '') {
  const modal = el('file-preview-modal');
  const body = el('popup-preview-body');
  if (!modal || !body) return;

  const reqId = ++state.popupReqSeq;
  modal.classList.remove('hidden');
  state.popupCurrent = { rawHref, baseDir: baseDir || state.currentBaseDir || '' };
  el('popup-preview-title').textContent = rawHref.split(/[\\/]/).pop() || t('loadingPreview');
  el('popup-preview-path').textContent = rawHref;
  body.innerHTML = `<div style="color:var(--text-faint);font-size:0.82rem;">${escapeHtml(t('loadingPreview'))}</div>`;

  try {
    const info = await fetchFileInfo(rawHref, baseDir);
    if (reqId !== state.popupReqSeq) return;
    state.popupCurrent = { ...info, rawHref };
    el('popup-preview-title').textContent = info.filename;
    el('popup-preview-path').textContent = info.path + (info.hash ? `#${info.hash}` : '');
    const isBinaryViewer = ['pdf', 'docx', 'doc', 'xlsx', 'pptx', 'video', 'audio', 'image'].includes(info.kind);
    el('popup-wrap-btn')?.classList.toggle('hidden', info.kind !== 'code');
    el('popup-copy-btn')?.classList.toggle('hidden', isBinaryViewer);
    populatePreviewBody(body, info, 'popup-code-view');
  } catch (err) {
    if (reqId !== state.popupReqSeq) return;
    body.innerHTML = `<div class="notice-banner error">${escapeHtml(err.message)}</div>`;
  }
}

/* 2. Right Split Side Preview Pane */
function updateSideNavButtons() {
  const backBtn = el('side-back-btn');
  const fwdBtn = el('side-fwd-btn');
  if (backBtn) backBtn.disabled = state.sideHistoryIdx <= 0;
  if (fwdBtn) fwdBtn.disabled = state.sideHistoryIdx >= state.sideHistory.length - 1;
}

async function openInSidePreview(rawHref, baseDir = '', { pushHistory = true } = {}) {
  const pane = el('side-preview-pane');
  const resizer = el('side-resizer');
  const body = el('side-preview-body');
  if (!pane || !body) return;

  const reqId = ++state.sideReqSeq;
  pane.classList.remove('hidden');
  resizer?.classList.remove('hidden');
  state.sideCurrent = { rawHref, baseDir: baseDir || state.currentBaseDir || '' };
  el('side-preview-title').textContent = rawHref.split(/[\\/]/).pop() || t('loadingPreview');
  el('side-preview-path').textContent = rawHref;
  body.innerHTML = `<div style="color:var(--text-faint);font-size:0.82rem;">${escapeHtml(t('loadingPreview'))}</div>`;

  try {
    const info = await fetchFileInfo(rawHref, baseDir);
    if (reqId !== state.sideReqSeq) return;
    state.sideCurrent = { ...info, rawHref };
    if (pushHistory) {
      state.sideHistory = state.sideHistory.slice(0, state.sideHistoryIdx + 1);
      state.sideHistory.push({ rawHref: info.path + (info.hash ? `#${info.hash}` : ''), baseDir: info.baseDir });
      state.sideHistoryIdx = state.sideHistory.length - 1;
    }
    updateSideNavButtons();

    el('side-preview-title').textContent = info.filename;
    el('side-preview-path').textContent = info.path;
    el('side-preview-path').title = info.path;

    const promotable = ['markdown', 'pdf', 'docx', 'doc', 'xlsx', 'pptx', 'video', 'audio', 'csv'].includes(info.kind);
    const isBinaryViewer = ['pdf', 'docx', 'doc', 'xlsx', 'pptx', 'video', 'audio', 'image'].includes(info.kind);
    el('side-promote-btn')?.classList.toggle('hidden', !promotable);
    el('side-wrap-btn')?.classList.toggle('hidden', info.kind !== 'code');
    el('side-copy-btn')?.classList.toggle('hidden', isBinaryViewer);

    populatePreviewBody(body, info, 'side-code-view');
  } catch (err) {
    if (reqId !== state.sideReqSeq) return;
    body.innerHTML = `<div class="notice-banner error">${escapeHtml(err.message)}</div>`;
  }
}

function closeSidePreview() {
  state.sideReqSeq += 1;
  el('side-preview-pane')?.classList.add('hidden');
  el('side-resizer')?.classList.add('hidden');
  state.sideCurrent = null;
}

function snapshotSideChrome() {
  const paneOpen = Boolean(state.sideCurrent) && !el('side-preview-pane')?.classList.contains('hidden');
  return {
    open: paneOpen,
    history: state.sideHistory.map((item) => ({ ...item })),
    historyIdx: state.sideHistoryIdx,
    current: paneOpen ? {
      rawHref: state.sideCurrent.rawHref || state.sideCurrent.path || '',
      baseDir: state.sideCurrent.baseDir || '',
      path: state.sideCurrent.path || '',
      kind: state.sideCurrent.kind || '',
    } : null,
  };
}

function stashConversationChrome(convId) {
  if (!convId) return;
  state.sideByConv.set(convId, snapshotSideChrome());
  state.cliToolByConv.set(convId, state.activeCliToolTab || null);
}

function clearLiveSidePreview() {
  closeSidePreview();
  state.sideHistory = [];
  state.sideHistoryIdx = -1;
  updateSideNavButtons();
}

function restoreConversationChrome(convId) {
  state.activeCliToolTab = state.cliToolByConv.get(convId) || null;
  el('tools-menu')?.classList.add('hidden');
  el('tools-btn')?.classList.toggle('active', Boolean(state.activeCliToolTab));
  el('cli-tools-drawer')?.classList.add('hidden');

  const saved = state.sideByConv.get(convId);
  if (!saved?.open || !saved.current) {
    clearLiveSidePreview();
    return;
  }
  state.sideHistory = saved.history.map((item) => ({ ...item }));
  state.sideHistoryIdx = Number.isInteger(saved.historyIdx) ? saved.historyIdx : -1;
  updateSideNavButtons();
  const cur = saved.current;
  if (cur.kind === 'directory') {
    const folder = cur.path || cur.rawHref;
    state.sideCurrent = { path: folder, rawHref: folder, baseDir: folder, kind: 'directory' };
    el('side-preview-pane')?.classList.remove('hidden');
    el('side-resizer')?.classList.remove('hidden');
    browseFolderInPreview(folder, '', 'sidebar');
  } else if (cur.rawHref || cur.path) {
    openInSidePreview(cur.rawHref || cur.path, cur.baseDir || '', { pushHistory: false });
  } else {
    clearLiveSidePreview();
  }
}

function openZoomImage(src, alt) {
  const modal = el('image-modal');
  const img = el('image-modal-img');
  const cap = el('image-modal-caption');
  if (!modal || !img) return;
  img.src = src;
  img.alt = alt || '';
  if (cap) cap.textContent = alt || '';
  modal.classList.remove('hidden');
}

/* -------------------------------------------------------------------------
 * Larger & User-Resizable Mermaid Fullscreen Modal
 * ------------------------------------------------------------------------- */

function applySavedMermaidModalSize() {
  const panel = el('mermaid-modal-panel');
  if (!panel || panel.classList.contains('maximized')) return;
  try {
    const saved = JSON.parse(localStorage.getItem('amp-mmd-modal-size') || 'null');
    if (saved && saved.w >= 460 && saved.h >= 320) {
      panel.style.width = `${Math.min(window.innerWidth - 12, saved.w)}px`;
      panel.style.height = `${Math.min(window.innerHeight - 12, saved.h)}px`;
    } else {
      panel.style.width = '';
      panel.style.height = '';
    }
  } catch {
    panel.style.width = '';
    panel.style.height = '';
  }
}

function getMermaidModalNatSize(svg) {
  const dataW = Number(svg?.dataset?.natW || 0);
  const dataH = Number(svg?.dataset?.natH || 0);
  if (dataW > 0 && dataH > 0) return { natW: dataW, natH: dataH };
  const vb = (svg?.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  const natW = vb.length === 4 && vb[2] > 0 ? vb[2] : (svg?.clientWidth || 600);
  const natH = vb.length === 4 && vb[3] > 0 ? vb[3] : (svg?.clientHeight || 400);
  return { natW, natH };
}

let mermaidModalFitMode = 'auto'; // 'auto' | 'width' | 'screen' | 'manual'
let isAutoFittingModal = false;

function fitMermaidModalByMode(mode = mermaidModalFitMode) {
  const viewport = el('mermaid-modal-viewport');
  const svg = el('mermaid-modal-canvas')?.querySelector('svg');
  const ctrl = viewport?._panZoomCtrl;
  if (!viewport || !svg || !ctrl) return;
  if (mode === 'manual') return;
  mermaidModalFitMode = mode;

  const vRect = viewport.getBoundingClientRect();
  if (vRect.width <= 0 || vRect.height <= 0) return;
  const { natW, natH } = getMermaidModalNatSize(svg);
  const padX = 36;
  const padY = 36;
  const widthScale = Math.min(4.0, (vRect.width - padX) / natW);
  const screenScale = Math.min(3.8, (vRect.width - padX) / natW, (vRect.height - padY) / natH);

  let targetScale = screenScale;
  if (mode === 'width') {
    targetScale = widthScale;
  } else if (mode === 'auto') {
    // Prefer filling horizontal space unless doing so overflows height severely
    if (screenScale >= widthScale * 0.65) {
      targetScale = screenScale;
    } else {
      targetScale = Math.min(widthScale, 2.4, Math.max(screenScale, (vRect.height * 1.65) / natH));
    }
  }

  const scaledH = natH * targetScale;
  const topAlignTy = scaledH > vRect.height - padY
    ? Math.round((scaledH - vRect.height) / 2 + 18)
    : 0;
  isAutoFittingModal = true;
  try {
    ctrl.setTransform(targetScale, 0, topAlignTy);
  } finally {
    isAutoFittingModal = false;
  }
}

function fitMermaidModalToScreen() {
  fitMermaidModalByMode('screen');
}

function fitMermaidModalToWidth() {
  fitMermaidModalByMode('width');
}

function openFullscreenMermaid(svgEl) {
  const modal = el('mermaid-modal');
  const viewport = el('mermaid-modal-viewport');
  const canvas = el('mermaid-modal-canvas');
  const resetBtn = el('mmd-modal-zoom-reset');
  if (!modal || !viewport || !canvas || !svgEl) return;

  applySavedMermaidModalSize();

  const cloned = svgEl.cloneNode(true);
  cloned.style.maxWidth = 'none';
  cloned.style.maxHeight = 'none';
  const { natW, natH } = getMermaidModalNatSize(cloned);
  cloned.dataset.natW = String(natW);
  cloned.dataset.natH = String(natH);
  cloned.style.width = `${natW}px`;
  cloned.style.height = `${natH}px`;

  canvas.innerHTML = '';
  canvas.appendChild(cloned);
  modal.classList.remove('hidden');

  bindPanZoomViewport(viewport, canvas, {
    wheelRequiresModifier: false,
    onScaleChange: (s) => {
      if (!isAutoFittingModal) mermaidModalFitMode = 'manual';
      if (resetBtn) resetBtn.textContent = `${Math.round(s * 100)}%`;
    },
  });

  requestAnimationFrame(() => {
    fitMermaidModalByMode('auto');
  });
}

function initMermaidModalResizer() {
  const panel = el('mermaid-modal-panel');
  const maxBtn = el('mmd-modal-maximize');
  if (!panel) return;

  let activeDir = '';
  let startX = 0;
  let startY = 0;
  let startW = 0;
  let startH = 0;

  panel.querySelectorAll('[data-mmd-resize]').forEach((handle) => {
    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (panel.classList.contains('maximized')) {
        panel.classList.remove('maximized');
        if (maxBtn) maxBtn.textContent = t('mmdMaximizeBtn');
      }
      const rect = panel.getBoundingClientRect();
      activeDir = handle.dataset.mmdResize;
      startX = e.clientX;
      startY = e.clientY;
      startW = rect.width;
      startH = rect.height;
      document.body.style.userSelect = 'none';
    });

    if (handle.dataset.mmdResize === 'se') {
      handle.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        localStorage.removeItem('amp-mmd-modal-size');
        panel.classList.remove('maximized');
        panel.style.width = '';
        panel.style.height = '';
        if (maxBtn) maxBtn.textContent = t('mmdMaximizeBtn');
        requestAnimationFrame(() => fitMermaidModalByMode('auto'));
      });
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (!activeDir) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    let nextW = startW;
    let nextH = startH;

    if (activeDir.includes('e')) nextW = startW + dx * 2;
    if (activeDir.includes('w')) nextW = startW - dx * 2;
    if (activeDir.includes('s')) nextH = startH + dy * 2;
    if (activeDir.includes('n')) nextH = startH - dy * 2;

    nextW = Math.max(460, Math.min(window.innerWidth - 8, nextW));
    nextH = Math.max(320, Math.min(window.innerHeight - 8, nextH));

    panel.style.width = `${Math.round(nextW)}px`;
    panel.style.height = `${Math.round(nextH)}px`;
    fitMermaidModalByMode();
  });

  window.addEventListener('mouseup', () => {
    if (!activeDir) return;
    activeDir = '';
    document.body.style.userSelect = '';
    const rect = panel.getBoundingClientRect();
    localStorage.setItem('amp-mmd-modal-size', JSON.stringify({ w: Math.round(rect.width), h: Math.round(rect.height) }));
  });

  maxBtn?.addEventListener('click', () => {
    const isMax = panel.classList.toggle('maximized');
    maxBtn.textContent = isMax ? t('mmdRestoreBtn') : t('mmdMaximizeBtn');
    if (!isMax) applySavedMermaidModalSize();
    requestAnimationFrame(() => fitMermaidModalByMode());
  });
}

function renderToolsMenu() {
  const menu = el('tools-menu');
  const toolsBtn = el('tools-btn');
  if (!menu) return;
  const view = state.currentViewData?.view;
  const cli = state.currentViewData?.cliInsights;
  const s = view?.summary || {};
  const ctxPct = s.contextWindow?.limit ? `${((s.contextWindow.usageRatio || 0) * 100).toFixed(1)}%` : '';
  const btwCount = ((cli?.btwCommands || []).filter((c) => c.isQuery).length) +
    ((cli?.btwNotes || []).filter((n) => !(cli?.btwCommands || []).some((c) => c.question === n.question)).length);
  const totalTok = (s.totalInputTokens || 0) + (s.totalCacheReadTokens || 0) + (s.totalOutputTokens || 0);

  const items = [
    { id: 'btw', cmd: '/btw', desc: t('cmdBtwDesc'), badge: btwCount > 0 ? String(btwCount) : '' },
    { id: 'context', cmd: '/context', desc: t('cmdContextDesc'), badge: ctxPct },
    { id: 'usage', cmd: '/usage', desc: t('cmdUsageDesc'), badge: totalTok > 0 ? formatCompactTokens(totalTok) : '' },
  ];

  menu.innerHTML = `
    <div class="theme-menu-section-label">${escapeHtml(t('secSessionCmds'))}</div>
    ${items.map((it) => {
      const active = state.activeCliToolTab === it.id;
      return `<button type="button" class="theme-menu-item ${active ? 'active' : ''}" data-open-cli-tool="${it.id}">
        <span class="theme-menu-item-left">
          <code style="font-size:0.75rem;">${it.cmd}</code>
          <span style="font-size:0.74rem;color:var(--text-muted);">${escapeHtml(it.desc)}</span>
        </span>
        <span style="font-size:0.71rem;color:var(--text-faint);font-family:var(--font-mono);">${escapeHtml(it.badge)}</span>
      </button>`;
    }).join('')}
  `;

  if (toolsBtn) {
    toolsBtn.classList.toggle('active', Boolean(state.activeCliToolTab));
  }
}

function renderCliToolsDrawer() {
  const drawer = el('cli-tools-drawer');
  renderToolsMenu();
  if (!drawer) return;
  const viewConvId = state.currentViewData?.conversationId || '';
  const viewMatches = !viewConvId || viewConvId === state.activeConvId;
  if (state.mode !== 'sessions' || !state.activeCliToolTab || !state.currentViewData?.view || !viewMatches) {
    drawer.classList.add('hidden');
    return;
  }

  drawer.classList.remove('hidden');
  const tab = state.activeCliToolTab;
  const bodyHtml = renderCliInsightsHtml(
    tab,
    state.currentViewData.view,
    state.currentViewData.cliInsights,
    state.currentViewData.artifacts,
    state.currentBaseDir
  );

  drawer.innerHTML = `
    <div class="cli-tools-drawer-inner">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding-bottom:6px;border-bottom:1px solid var(--border);">
        <div class="cli-insights-tabs">
          <button type="button" class="cli-tab-btn ${tab === 'btw' ? 'active' : ''}" data-drawer-cli-tab="btw">/btw</button>
          <button type="button" class="cli-tab-btn ${tab === 'context' ? 'active' : ''}" data-drawer-cli-tab="context">/context</button>
          <button type="button" class="cli-tab-btn ${tab === 'usage' ? 'active' : ''}" data-drawer-cli-tab="usage">/usage</button>
        </div>
        <button type="button" class="icon-btn sm" data-close-cli-drawer title="Close tools panel (Esc)">✕</button>
      </div>
      ${bodyHtml}
    </div>
  `;
  enhanceMarkdownDom(drawer, resolvedTheme());
}

function updateModeButtons() {
  const isSessions = state.mode === 'sessions';
  el('mode-sessions-btn')?.classList.toggle('active', isSessions);
  el('mode-docs-btn')?.classList.toggle('active', !isSessions);
  el('flavor-controls-row')?.classList.toggle('hidden', !isSessions);
  el('docs-controls-row')?.classList.toggle('hidden', isSessions);
  el('tools-dropdown-wrap')?.classList.toggle('hidden', !isSessions);
  updatePinSessionButton();
  if (!isSessions) {
    el('cli-tools-drawer')?.classList.add('hidden');
  } else {
    renderCliToolsDrawer();
  }
}

function exportCurrentMarkdown() {
  let mdOut = '';
  let filename = 'antigravity-session-preview.md';

  if (state.mode === 'docs' && state.currentCustomDoc) {
    mdOut = state.currentCustomDoc.rawText || '';
    filename = `${(state.currentCustomDoc.title || 'preview').replace(/[^a-zA-Z0-9._-]+/g, '_')}.md`;
  } else if (state.currentViewData?.view?.turns) {
    const title = el('doc-title')?.textContent || 'Conversation';
    filename = `${title.slice(0, 40).replace(/[^a-zA-Z0-9._-]+/g, '_')}.md`;
    const chunks = [`# ${title}\n`];
    for (const turn of state.currentViewData.view.turns) {
      if (turn.kind === 'schedule') {
        chunks.push(`## ${turn.scheduleLabel || '定时巡检'}\n\n${turn.user?.request || ''}\n`);
      } else if (turn.user?.request) {
        chunks.push(`## Turn ${turn.index} — User\n\n${turn.user.request}\n`);
      }
      for (const item of turn.items) {
        if (item.kind === 'markdown' && !item.intermediate) {
          chunks.push(`${item.text}\n`);
        } else if (item.kind === 'thinking') {
          chunks.push(`<details>\n<summary>Thought (${item.wordCount} words)</summary>\n\n${item.text}\n\n</details>\n`);
        } else if (item.kind === 'tool_group') {
          const names = item.tools.map((t) => `- \`${t.name}\` ${t.summary || ''}`).join('\n');
          chunks.push(`<details>\n<summary>Tools (${item.tools.length})</summary>\n\n${names}\n\n</details>\n`);
        }
      }
    }
    mdOut = chunks.join('\n');
  }

  if (!mdOut) return;
  const blob = new Blob([mdOut], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function clearFindHighlights() {
  el('reader-column')?.querySelectorAll('mark.find-hit').forEach((m) => {
    m.replaceWith(document.createTextNode(m.textContent));
  });
  state.findHits = [];
  state.findIndex = -1;
  if (el('find-count')) el('find-count').textContent = '';
}

function runFindInPage(query) {
  clearFindHighlights();
  if (!query || query.length < 2) return;
  if (state.mode === 'sessions') {
    transcriptRenderer?.expandWindowForSearch();
  }
  const root = el('reader-column');
  if (!root) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const matches = [];
  const lowerQ = query.toLowerCase();
  let node;
  while ((node = walker.nextNode())) {
    if (!node.nodeValue || !node.parentElement) continue;
    if (node.parentElement.closest('script, style, .katex')) continue;
    const idx = node.nodeValue.toLowerCase().indexOf(lowerQ);
    if (idx !== -1) matches.push({ node, idx });
  }

  for (const { node: textNode, idx } of matches.slice(0, 250)) {
    const val = textNode.nodeValue;
    const frag = document.createDocumentFragment();
    frag.appendChild(document.createTextNode(val.slice(0, idx)));
    const mark = document.createElement('mark');
    mark.className = 'find-hit';
    mark.textContent = val.slice(idx, idx + query.length);
    frag.appendChild(mark);
    frag.appendChild(document.createTextNode(val.slice(idx + query.length)));
    textNode.replaceWith(frag);
    state.findHits.push(mark);
  }

  if (state.findHits.length > 0) {
    jumpToFindHit(0);
  } else if (el('find-count')) {
    el('find-count').textContent = '0 matches';
  }
}

function jumpToFindHit(nextIdx) {
  if (!state.findHits.length) return;
  state.findHits.forEach((h) => h.classList.remove('current'));
  state.findIndex = (nextIdx + state.findHits.length) % state.findHits.length;
  const hit = state.findHits[state.findIndex];
  hit.classList.add('current');
  let collapsed = hit.closest('[data-open="false"]');
  while (collapsed) {
    collapsed.dataset.open = 'true';
    collapsed = collapsed.parentElement?.closest('[data-open="false"]');
  }
  hit.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (el('find-count')) {
    el('find-count').textContent = `${state.findIndex + 1} / ${state.findHits.length}`;
  }
}

async function manualSync() {
  const btn = el('sync-btn');
  if (btn) btn.textContent = t('syncingBtn');
  await loadConversations();
  await loadCustomPreviews();
  if (state.mode === 'sessions' && state.activeConvId) {
    await openConversation(state.activeConvId, { scrollToLatestUser: false });
  } else if (state.mode === 'docs' && state.activePreviewId) {
    await openCustomPreview(state.activePreviewId, { preserveScroll: true });
  }
  if (btn) btn.textContent = t('syncBtn');
}

async function submitCustomPreview({ id, title, content, mode, filePath, droppedFilename, baseDir }) {
  const res = await apiFetch('/api/previews', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, title, content, mode, filePath, droppedFilename, baseDir }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed' }));
    showToast(err.error || 'Failed to render preview', true);
    return;
  }
  const doc = await res.json();
  await loadCustomPreviews();
  await openCustomPreview(doc.id);
}

function applyFilePickerAvailability() {
  const hide = state.filePickerAvailable === false;
  el('docs-browse-btn')?.classList.toggle('hidden', hide);
  el('paste-browse-btn')?.classList.toggle('hidden', hide);
}

async function refreshFilePickerAvailability() {
  try {
    const res = await apiFetch('/api/file-picker');
    if (!res.ok) return;
    const data = await res.json();
    state.filePickerAvailable = Boolean(data.available);
  } catch {
    return;
  }
  applyFilePickerAvailability();
  if (state.mode === 'docs') renderSidebarList();
}

async function pickNativeFile() {
  try {
    const res = await apiFetch('/api/pick-file', { method: 'POST' });
    if (!res.ok) return;
    const data = await res.json();
    if (data.available === false) {
      state.filePickerAvailable = false;
      applyFilePickerAvailability();
      showToast(t('pickerUnavailable'), true);
      if (state.mode === 'docs') renderSidebarList();
      return;
    }
    if (!data.canceled && data.entry) {
      el('paste-modal')?.classList.add('hidden');
      await loadCustomPreviews();
      await openCustomPreview(data.entry.id);
    }
  } catch {}
}

function initSidePaneResizer() {
  const resizer = el('side-resizer');
  if (!resizer) return;
  let dragging = false;

  resizer.addEventListener('mousedown', (e) => {
    dragging = true;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const tocEl = el('toc-drawer');
    const tocW = tocEl && !tocEl.classList.contains('hidden') ? tocEl.offsetWidth : 0;
    const newW = Math.max(300, Math.min(window.innerWidth * 0.65, window.innerWidth - e.clientX - tocW));
    document.documentElement.style.setProperty('--side-preview-width', `${Math.round(newW)}px`);
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
}

async function commitDocRename(docId, newTitle) {
  state.renamingDocId = null;
  if (newTitle && newTitle.trim()) {
    await apiFetch(`/api/previews/${encodeURIComponent(docId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle.trim() }),
    });
    await loadCustomPreviews();
    if (state.activePreviewId === docId) {
      el('doc-title').textContent = newTitle.trim();
    }
  } else {
    renderSidebarList();
  }
}

async function loadInitialWorkspaceContent() {
  const params = new URLSearchParams(window.location.search);
  const urlConv = params.get('conv') || '';
  const urlPreview = params.get('preview') || '';
  const urlMode = params.get('mode') || '';
  const urlFlavor = params.get('flavor') || '';
  if (urlFlavor) state.flavor = urlFlavor;

  await loadFlavors();
  await Promise.all([loadConversations(), loadCustomPreviews(), loadServerCustomPalettes(), refreshFilePickerAvailability()]);

  let tabMode = '';
  let tabConv = '';
  let tabPreview = '';
  try {
    tabMode = sessionStorage.getItem('amp-tab-mode') || '';
    tabConv = sessionStorage.getItem('amp-tab-conv') || '';
    tabPreview = sessionStorage.getItem('amp-tab-preview') || '';
  } catch {}

  const sidecarDefaultConv = isSidecar ? (window.sidecar?.conversationId || '') : '';
  const savedPreview = tabPreview || localStorage.getItem('amp-last-preview') || '';
  const resolveValidDocId = (preferredId = '') => {
    if (preferredId && state.customPreviews.some((d) => d.id === preferredId)) return preferredId;
    if (savedPreview && state.customPreviews.some((d) => d.id === savedPreview)) return savedPreview;
    return state.customPreviews[0]?.id || '';
  };

  const urlSyncLocked = isSidecar || window.location.protocol === 'plugin:';

  // In Sidecar / plugin: mode where URL query params cannot be updated via replaceState, sessionStorage is authoritative on reload
  if (urlSyncLocked && tabMode) {
    if (tabMode === 'docs') {
      const docId = resolveValidDocId(tabPreview);
      if (docId) await openCustomPreview(docId);
      else showEmptyDocsStage();
      return;
    }
    if (tabMode === 'sessions') {
      const convTarget = tabConv || pickDefaultConversationId();
      if (convTarget) await openConversation(convTarget);
      else connectSSE();
      return;
    }
  }

  if (urlPreview) {
    const docId = resolveValidDocId(urlPreview);
    if (docId) await openCustomPreview(docId);
    else showEmptyDocsStage();
    return;
  }

  if (urlConv) {
    await openConversation(urlConv);
    return;
  }

  if (urlMode === 'docs') {
    const docId = resolveValidDocId();
    if (docId) await openCustomPreview(docId);
    else showEmptyDocsStage();
    return;
  }

  // Preserve active mode/document/session across reloads of the same tab or Sidecar pane
  if (tabMode === 'docs') {
    const docId = resolveValidDocId(tabPreview);
    if (docId) await openCustomPreview(docId);
    else showEmptyDocsStage();
    return;
  }
  if (tabMode === 'sessions') {
    const convTarget = (tabConv && state.conversations.some((c) => c.id === tabConv))
      ? tabConv
      : (tabConv || pickDefaultConversationId());
    if (convTarget) {
      await openConversation(convTarget);
    } else {
      connectSSE();
    }
    return;
  }

  if (sidecarDefaultConv) {
    await openConversation(sidecarDefaultConv);
    return;
  }

  const defaultConv = pickDefaultConversationId();
  if (defaultConv) {
    await openConversation(defaultConv);
  } else if (state.customPreviews.length > 0) {
    await openCustomPreview(resolveValidDocId());
  } else {
    connectSSE();
  }
}

async function bootstrap() {
  setLang(getLang());
  applyStaticI18n();
  syncFlavorSelect();
  applyAppearance();
  const initManageBtn = el('docs-manage-btn');
  if (initManageBtn) initManageBtn.textContent = t('manageBtn');

  transcriptRenderer = new TranscriptRenderer(el('reader-column'), {
    theme: resolvedTheme(),
    onSaveTurn: (turn) => saveCurrentTurn(turn),
    onSaveBtwTurn: (source) => saveBtwInteraction(source),
    onLoadFullStep: async (stepIdx) => {
      if (!state.activeConvId) return null;
      const res = await apiFetch(`/api/conversations/${encodeURIComponent(state.activeConvId)}/steps/${stepIdx}?flavor=${encodeURIComponent(state.flavor)}`);
      return res.ok ? res.json() : null;
    },
    onSaveBtwNote: async (question, answer) => {
      if (!state.activeConvId) return;
      const res = await apiFetch(`/api/conversations/${encodeURIComponent(state.activeConvId)}/btw-notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, answer }),
      });
      if (res.ok) {
        const out = await res.json();
        if (state.currentViewData?.cliInsights) {
          state.currentViewData.cliInsights.btwNotes = out.notes || [];
          transcriptRenderer._rerenderCurrent();
        }
      }
    },
    onDeleteBtwNote: async (noteId) => {
      if (!state.activeConvId || !noteId) return;
      const res = await apiFetch(`/api/conversations/${encodeURIComponent(state.activeConvId)}/btw-notes/${encodeURIComponent(noteId)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        const out = await res.json();
        if (state.currentViewData?.cliInsights) {
          state.currentViewData.cliInsights.btwNotes = out.notes || [];
          transcriptRenderer._rerenderCurrent();
        }
      }
    },
    onTocChanged: renderToc,
    onStreamTick: () => {
      if (!state.autoFollow) return;
      const sc = el('reader-scroll');
      if (sc && sc.scrollHeight - sc.scrollTop - sc.clientHeight < 220) {
        sc.scrollTop = sc.scrollHeight;
      }
    },
  });

  const mdCallbacks = {
    onOpenLocalLink: (rawHref, baseDir, previewMode = 'popup') => {
      if (previewMode === 'sidebar') {
        el('file-preview-modal')?.classList.add('hidden');
        openInSidePreview(rawHref, baseDir);
      } else {
        openInPopupModal(rawHref, baseDir);
      }
    },
    onOpenConversation: (convId) => {
      if (convId) {
        el('file-preview-modal')?.classList.add('hidden');
        openConversation(convId);
      }
    },
    onZoomImage: openZoomImage,
    onFullscreenMermaid: openFullscreenMermaid,
  };
  attachCodeCardInteractions(el('reader-column'), mdCallbacks);
  attachCodeCardInteractions(el('side-preview-body'), mdCallbacks);
  attachCodeCardInteractions(el('popup-preview-body'), mdCallbacks);
  attachCodeCardInteractions(el('cli-tools-drawer'), mdCallbacks);
  initSidePaneResizer();
  initMermaidModalResizer();

  // Password Lock Overlay listeners
  el('auth-toggle-vis-btn')?.addEventListener('click', () => {
    const inp = el('auth-password-input');
    if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
  });
  el('auth-lock-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const inp = el('auth-password-input');
    const btn = el('auth-submit-btn');
    const pwd = inp?.value || '';
    if (!pwd.trim()) return;
    if (btn) {
      btn.disabled = true;
      btn.textContent = t('unlockingBtn');
    }
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showAuthLockOverlay(data.error || t('lockErrorWrong'));
      } else {
        hideAuthLockOverlay();
        await loadInitialWorkspaceContent();
      }
    } catch (err) {
      showAuthLockOverlay(err.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = t('unlockBtn');
      }
    }
  });
  el('lock-session-btn')?.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    if (state.eventSource) {
      state.eventSource.close();
      state.eventSource = null;
    }
    showAuthLockOverlay();
  });

  // Sidebar & Toolbar listeners
  const toggleSidebar = () => {
    hideDocHoverPopover();
    el('sidebar')?.classList.toggle('collapsed');
  };
  el('sidebar-toggle-btn')?.addEventListener('click', toggleSidebar);
  el('sidebar-collapse-btn')?.addEventListener('click', toggleSidebar);

  el('pin-session-btn')?.addEventListener('click', () => {
    if (state.activeConvId) togglePinSession(state.activeConvId);
  });

  el('toggle-all-projects-btn')?.addEventListener('click', () => {
    const shouldOpen = !(state.anyProjectOpen || state.showOlderInProject.size > 0);
    for (const key of state.allProjectKeys) {
      state.projectExpanded.set(key, shouldOpen);
    }
    if (!shouldOpen) state.showOlderInProject.clear();
    renderSidebarList();
  });

  el('reader-scroll')?.addEventListener('scroll', () => {
    const sc = el('reader-scroll');
    if (!sc) return;
    const distFromBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight;
    state.autoFollow = distFromBottom < 160;
  }, { passive: true });

  el('reader-column')?.addEventListener('click', (e) => {
    const wsBtn = e.target.closest('[data-reveal-workspace]');
    if (wsBtn) {
      revealInFolder(wsBtn.dataset.revealWorkspace, '', wsBtn);
    }
  });

  el('toc-toggle-btn')?.addEventListener('click', () => {
    const drawer = el('toc-drawer');
    if (!drawer) return;
    const hidden = drawer.classList.toggle('hidden');
    el('toc-toggle-btn')?.classList.toggle('active', !hidden);
  });

  el('mode-sessions-btn')?.addEventListener('click', () => {
    state.mode = 'sessions';
    persistNavigationState({ mode: 'sessions' });
    updateModeButtons();
    renderSidebarList();
    const targetConv = state.activeConvId || pickDefaultConversationId();
    if (targetConv) {
      const keepScroll = Boolean(targetConv === state.activeConvId && state.currentViewData);
      openConversation(targetConv, { scrollToLatestUser: !keepScroll });
    } else {
      ++state.navSeq;
      syncUrlState({});
      el('doc-title').textContent = t('selectSession');
      el('reader-column').innerHTML = `<div class="empty-state"><strong>${escapeHtml(t('readyTitle'))}</strong><span>${t('readyHint')}</span></div>`;
      renderToc([]);
      connectSSE();
    }
  });

  el('mode-docs-btn')?.addEventListener('click', () => {
    if (state.mode === 'sessions' && state.activeConvId) stashConversationChrome(state.activeConvId);
    const validTarget = state.customPreviews.find((d) => d.id === state.activePreviewId)?.id || state.customPreviews[0]?.id || '';
    if (validTarget) {
      openCustomPreview(validTarget);
    } else {
      showEmptyDocsStage();
    }
  });

  el('docs-browse-btn')?.addEventListener('click', pickNativeFile);
  el('paste-browse-btn')?.addEventListener('click', pickNativeFile);

  el('docs-manage-btn')?.addEventListener('click', () => {
    state.docsManageMode = !state.docsManageMode;
    state.renamingDocId = null;
    const btn = el('docs-manage-btn');
    if (btn) {
      btn.textContent = state.docsManageMode ? t('manageDoneBtn') : t('manageBtn');
      btn.classList.toggle('active', state.docsManageMode);
    }
    renderSidebarList();
  });

  el('flavor-select')?.addEventListener('change', (e) => {
    const value = e.target.value;
    if (value === '__saved_turns__') {
      state.sidebarSource = 'saved-turns';
      syncFlavorSelect();
      loadSavedTurns();
      return;
    }
    state.sidebarSource = 'sessions';
    state.flavor = value;
    localStorage.setItem('amp-flavor', state.flavor);
    syncFlavorSelect();
    loadConversations();
  });

  el('sidebar-search')?.addEventListener('input', renderSidebarList);

  const sessionListEl = el('session-list');

  sessionListEl?.addEventListener('mouseenter', () => {
    state.sidebarPointerInside = true;
  });
  sessionListEl?.addEventListener('mouseleave', () => {
    state.sidebarPointerInside = false;
    if (state.sidebarDirtyWhileHovered && !state.sidebarMouseDown && !state.renamingDocId) {
      renderSidebarList();
    }
  });
  sessionListEl?.addEventListener('mousedown', () => {
    state.sidebarMouseDown = true;
  });
  window.addEventListener('mouseup', () => {
    if (!state.sidebarMouseDown) return;
    state.sidebarMouseDown = false;
    if (!state.sidebarPointerInside && state.sidebarDirtyWhileHovered && !state.renamingDocId) {
      renderSidebarList();
    }
  });

  const toastEl = el('app-toast');
  toastEl?.addEventListener('mouseenter', () => {
    toastHoverPaused = true;
  });
  toastEl?.addEventListener('mouseleave', () => {
    toastHoverPaused = false;
    if ((state.pendingFocusTarget || state.pendingDecisionAlert) && !toastEl.classList.contains('hidden')) {
      scheduleSwitchToastAutoHide(4200);
    }
  });
  toastEl?.addEventListener('click', async (e) => {
    if (e.target.closest('[data-toast-dismiss]')) {
      hideToast();
      return;
    }
    if (e.target.closest('[data-toast-decision]') && state.pendingDecisionAlert) {
      const alertInfo = state.pendingDecisionAlert;
      hideToast();
      if (state.mode === 'sessions' && state.activeConvId === alertInfo.convId) {
        scrollToDecisionCard(alertInfo.decisionId);
      } else {
        await openConversation(alertInfo.convId, { scrollToLatestUser: false });
        scrollToDecisionCard(alertInfo.decisionId);
      }
      return;
    }
    if (e.target.closest('[data-toast-switch]') && state.pendingFocusTarget) {
      const target = state.pendingFocusTarget;
      hideToast();
      if (target.previewId) {
        openCustomPreview(target.previewId);
      } else if (target.conversationId) {
        if (target.flavor) state.flavor = target.flavor;
        openConversation(target.conversationId);
      }
    }
  });

  sessionListEl?.addEventListener('mouseover', (e) => {
    if (state.mode !== 'docs' || state.docsManageMode) return;
    const card = e.target.closest('[data-doc-card]');
    if (!card) return;
    const docId = card.dataset.docCard;
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => showDocHoverPopover(docId, card), 170);
  });
  sessionListEl?.addEventListener('mouseout', (e) => {
    if (state.mode !== 'docs') return;
    const related = e.relatedTarget;
    if (related && e.target.closest('[data-doc-card]') === related.closest?.('[data-doc-card]')) return;
    hideDocHoverPopover();
  });
  sessionListEl?.addEventListener('scroll', hideDocHoverPopover);

  sessionListEl?.addEventListener('dragstart', (e) => {
    const card = e.target.closest('[data-doc-card]');
    if (!card || !state.docsManageMode) return;
    state.dragDocId = card.dataset.docCard;
    e.dataTransfer.effectAllowed = 'move';
  });
  sessionListEl?.addEventListener('dragover', (e) => {
    if (!state.dragDocId || !state.docsManageMode) return;
    const card = e.target.closest('[data-doc-card]');
    if (!card || card.dataset.docCard === state.dragDocId) return;
    e.preventDefault();
    sessionListEl.querySelectorAll('.doc-item-card.drag-over').forEach((n) => n.classList.remove('drag-over'));
    card.classList.add('drag-over');
  });
  sessionListEl?.addEventListener('dragleave', (e) => {
    e.target.closest?.('.doc-item-card')?.classList.remove('drag-over');
  });
  sessionListEl?.addEventListener('drop', async (e) => {
    if (!state.dragDocId || !state.docsManageMode) return;
    e.preventDefault();
    e.stopPropagation();
    sessionListEl.querySelectorAll('.doc-item-card.drag-over').forEach((n) => n.classList.remove('drag-over'));
    const targetCard = e.target.closest('[data-doc-card]');
    const fromId = state.dragDocId;
    state.dragDocId = null;
    if (!targetCard || targetCard.dataset.docCard === fromId) return;

    const ids = state.customPreviews.map((d) => d.id);
    const fromIdx = ids.indexOf(fromId);
    const toIdx = ids.indexOf(targetCard.dataset.docCard);
    if (fromIdx === -1 || toIdx === -1) return;
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, fromId);

    const res = await apiFetch('/api/previews/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds: ids }),
    });
    if (res.ok) {
      const data = await res.json();
      state.customPreviews = data.previews || state.customPreviews;
      renderSidebarList();
    }
  });
  sessionListEl?.addEventListener('dragend', () => {
    state.dragDocId = null;
    sessionListEl.querySelectorAll('.doc-item-card.drag-over').forEach((n) => n.classList.remove('drag-over'));
  });

  sessionListEl?.addEventListener('keydown', (e) => {
    const inp = e.target.closest('[data-rename-input]');
    if (!inp) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      commitDocRename(inp.dataset.renameInput, inp.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      state.renamingDocId = null;
      renderSidebarList();
    }
  });
  sessionListEl?.addEventListener('focusout', (e) => {
    const inp = e.target.closest('[data-rename-input]');
    if (!inp) return;
    const id = inp.dataset.renameInput;
    if (state.renamingDocId === id) {
      commitDocRename(id, inp.value);
    }
  });

  sessionListEl?.addEventListener('click', async (e) => {
    if (e.target.closest('[data-rename-input]')) return;

    const renameBtn = e.target.closest('[data-doc-rename]');
    if (renameBtn) {
      e.stopPropagation();
      state.renamingDocId = renameBtn.dataset.docRename;
      renderSidebarList();
      return;
    }

    const deleteBtn = e.target.closest('[data-doc-delete]');
    if (deleteBtn) {
      e.stopPropagation();
      const delId = deleteBtn.dataset.docDelete;
      await apiFetch(`/api/previews/${encodeURIComponent(delId)}`, { method: 'DELETE' });
      await loadCustomPreviews();
      if (state.activePreviewId === delId) {
        state.activePreviewId = null;
        try { sessionStorage.removeItem('amp-tab-preview'); } catch {}
        if (state.customPreviews.length > 0) {
          openCustomPreview(state.customPreviews[0].id);
        } else {
          ++state.navSeq;
          state.currentCustomDoc = null;
          syncUrlState({ mode: 'docs' });
          el('doc-title').textContent = t('tabDocs');
          el('reader-column').innerHTML = `<div class="empty-state"><strong>${escapeHtml(t('docRemovedTitle'))}</strong><span>${escapeHtml(t('docRemovedHint'))}</span></div>`;
          renderToc([]);
          connectSSE();
        }
      }
      return;
    }

    const pinAction = e.target.closest('[data-pin-conv]');
    if (pinAction) {
      e.preventDefault();
      e.stopPropagation();
      togglePinSession(pinAction.dataset.pinConv);
      return;
    }

    const pinnedGroupToggle = e.target.closest('[data-toggle-pinned-group]');
    if (pinnedGroupToggle) {
      state.pinnedGroupOpen = !state.pinnedGroupOpen;
      renderSidebarList();
      return;
    }

    const projToggle = e.target.closest('[data-toggle-project]');
    if (projToggle) {
      const key = projToggle.dataset.toggleProject;
      const folderEl = projToggle.closest('.project-folder');
      const currentlyOpen = folderEl?.dataset.open === 'true';
      state.projectExpanded.set(key, !currentlyOpen);
      renderSidebarList();
      return;
    }

    const subToggle = e.target.closest('[data-toggle-subagents]');
    if (subToggle) {
      const subKey = subToggle.dataset.toggleSubagents;
      if (state.expandedSubagentGroups.has(subKey)) state.expandedSubagentGroups.delete(subKey);
      else state.expandedSubagentGroups.add(subKey);
      renderSidebarList();
      return;
    }

    const showOlderBtn = e.target.closest('[data-show-older-project]');
    if (showOlderBtn) {
      state.showOlderInProject.add(showOlderBtn.dataset.showOlderProject);
      renderSidebarList();
      return;
    }

    const deleteSaved = e.target.closest('[data-delete-saved-turn]');
    if (deleteSaved) {
      e.preventDefault();
      e.stopPropagation();
      deleteSavedTurn(deleteSaved.dataset.deleteSavedTurn);
      return;
    }

    const savedBtn = e.target.closest('[data-saved-turn]');
    if (savedBtn) {
      openSavedTurn(savedBtn.dataset.savedTurn);
      return;
    }

    const convBtn = e.target.closest('[data-conv-id]');
    if (convBtn) {
      openConversation(convBtn.dataset.convId);
      return;
    }
    const prevBtn = e.target.closest('[data-preview-id]');
    if (prevBtn) {
      openCustomPreview(prevBtn.dataset.previewId);
    }
  });

  el('toc-list')?.addEventListener('click', (e) => {
    const link = e.target.closest('[data-target-id]');
    if (!link) return;
    document.getElementById(link.dataset.targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Popup File Preview Modal controls
  el('popup-close-btn')?.addEventListener('click', () => el('file-preview-modal')?.classList.add('hidden'));
  el('file-preview-modal')?.addEventListener('click', (e) => {
    if (e.target === el('file-preview-modal')) el('file-preview-modal')?.classList.add('hidden');
  });
  el('popup-to-sidebar-btn')?.addEventListener('click', () => {
    if (state.popupCurrent) {
      const href = (state.popupCurrent.path || state.popupCurrent.rawHref || '') + (state.popupCurrent.hash ? `#${state.popupCurrent.hash}` : '');
      el('file-preview-modal')?.classList.add('hidden');
      openInSidePreview(href, state.popupCurrent.baseDir);
    }
  });
  el('popup-reveal-btn')?.addEventListener('click', (e) => {
    const targetPath = state.popupCurrent?.path || state.popupCurrent?.rawHref || el('popup-preview-path')?.textContent || '';
    revealInFolder(targetPath, state.popupCurrent?.baseDir || state.currentBaseDir, e.currentTarget);
  });
  el('popup-wrap-btn')?.addEventListener('click', (e) => {
    const view = el('popup-code-view');
    if (!view) return;
    const wrapped = view.classList.toggle('wrapped');
    e.target.textContent = wrapped ? t('unwrapBtn') : t('wrapBtn');
  });
  el('popup-copy-btn')?.addEventListener('click', async (e) => {
    const text = state.popupCurrent?.content || state.popupCurrent?.path || '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      e.target.textContent = t('copiedBtn');
      setTimeout(() => { e.target.textContent = t('copyBtn'); }, 1300);
    } catch {}
  });

  // Side Preview Pane controls (including fixed 📂 目录 / Folder button)
  el('side-close-btn')?.addEventListener('click', closeSidePreview);
  el('side-back-btn')?.addEventListener('click', () => {
    if (state.sideHistoryIdx > 0) {
      state.sideHistoryIdx -= 1;
      const item = state.sideHistory[state.sideHistoryIdx];
      openInSidePreview(item.rawHref, item.baseDir, { pushHistory: false });
    }
  });
  el('side-fwd-btn')?.addEventListener('click', () => {
    if (state.sideHistoryIdx < state.sideHistory.length - 1) {
      state.sideHistoryIdx += 1;
      const item = state.sideHistory[state.sideHistoryIdx];
      openInSidePreview(item.rawHref, item.baseDir, { pushHistory: false });
    }
  });
  el('side-reveal-btn')?.addEventListener('click', (e) => {
    const targetPath = state.sideCurrent?.path || state.sideCurrent?.rawHref || el('side-preview-path')?.textContent || '';
    revealInFolder(targetPath, state.sideCurrent?.baseDir || state.currentBaseDir, e.currentTarget);
  });
  el('side-wrap-btn')?.addEventListener('click', (e) => {
    const view = el('side-code-view');
    if (!view) return;
    const wrapped = view.classList.toggle('wrapped');
    e.target.textContent = wrapped ? t('unwrapBtn') : t('wrapBtn');
  });
  el('side-copy-btn')?.addEventListener('click', async (e) => {
    const text = state.sideCurrent?.content || state.sideCurrent?.path || '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      e.target.textContent = t('copiedBtn');
      setTimeout(() => { e.target.textContent = t('copyBtn'); }, 1300);
    } catch {}
  });
  el('side-promote-btn')?.addEventListener('click', async () => {
    if (state.sideCurrent?.path) {
      await submitCustomPreview({ filePath: state.sideCurrent.path });
      closeSidePreview();
    }
  });

  el('sync-btn')?.addEventListener('click', manualSync);
  el('export-btn')?.addEventListener('click', exportCurrentMarkdown);
  document.addEventListener('click', (e) => {
    const viewBtn = e.target.closest('[data-md-view]');
    if (!viewBtn) return;
    e.preventDefault();
    setMarkdownSourceMode(viewBtn.dataset.mdView === 'source');
  });

  el('jump-top-btn')?.addEventListener('click', () => {
    el('reader-scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
  });
  el('jump-bottom-btn')?.addEventListener('click', () => {
    state.autoFollow = true;
    const sc = el('reader-scroll');
    if (sc) sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' });
  });

  // Topbar Tools (/btw, /context, /usage) dropdown & drawer
  el('tools-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    el('prefs-menu')?.classList.add('hidden');
    renderToolsMenu();
    el('tools-menu')?.classList.toggle('hidden');
  });

  el('tools-menu')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const btn = e.target.closest('[data-open-cli-tool]');
    if (!btn) return;
    const targetTab = btn.dataset.openCliTool;
    state.activeCliToolTab = state.activeCliToolTab === targetTab ? null : targetTab;
    el('tools-menu')?.classList.add('hidden');
    renderCliToolsDrawer();
  });

  el('cli-tools-drawer')?.addEventListener('click', async (e) => {
    const tabBtn = e.target.closest('[data-drawer-cli-tab]');
    if (tabBtn) {
      state.activeCliToolTab = tabBtn.dataset.drawerCliTab;
      renderCliToolsDrawer();
      return;
    }
    if (e.target.closest('[data-close-cli-drawer]')) {
      state.activeCliToolTab = null;
      renderCliToolsDrawer();
      return;
    }
    const saveBtw = e.target.closest('[data-action="save-btw-turn"]');
    if (saveBtw) {
      const ok = await saveBtwInteraction({
        question: saveBtw.dataset.btwQuestion || '',
        noteId: saveBtw.dataset.btwNoteId || '',
      });
      if (ok) {
        saveBtw.dataset.busy = '1';
        saveBtw.textContent = t('savedTurnBtn');
        setTimeout(() => {
          delete saveBtw.dataset.busy;
          if (saveBtw.isConnected) saveBtw.textContent = t('saveTurnBtn');
        }, 1400);
      }
      return;
    }
    const prefillBtw = e.target.closest('[data-action="prefill-btw-question"]');
    if (prefillBtw) {
      const det = el('cli-tools-drawer')?.querySelector('[data-btw-manual-details]');
      if (det) det.open = true;
      const qIn = el('cli-tools-drawer')?.querySelector('[data-btw-q-input]');
      const aIn = el('cli-tools-drawer')?.querySelector('[data-btw-a-input]');
      if (qIn) qIn.value = prefillBtw.dataset.question || '';
      try {
        const clip = await navigator.clipboard.readText();
        if (clip && aIn && !aIn.value) aIn.value = clip;
      } catch {}
      aIn?.focus();
      return;
    }
    if (e.target.closest('[data-action="paste-clipboard-btw"]')) {
      const aIn = el('cli-tools-drawer')?.querySelector('[data-btw-a-input]');
      try {
        const clip = await navigator.clipboard.readText();
        if (clip && aIn) aIn.value = clip;
      } catch {}
      return;
    }
    if (e.target.closest('[data-action="save-btw-note"]')) {
      const q = el('cli-tools-drawer')?.querySelector('[data-btw-q-input]')?.value || '';
      const a = el('cli-tools-drawer')?.querySelector('[data-btw-a-input]')?.value || '';
      if (a.trim() && state.activeConvId) {
        const res = await apiFetch(`/api/conversations/${encodeURIComponent(state.activeConvId)}/btw-notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: q, answer: a }),
        });
        if (res.ok) {
          const out = await res.json();
          if (state.currentViewData?.cliInsights) {
            state.currentViewData.cliInsights.btwNotes = out.notes || [];
            renderCliToolsDrawer();
          }
        }
      }
      return;
    }
    const delBtw = e.target.closest('[data-action="delete-btw-note"]');
    if (delBtw && state.activeConvId) {
      const res = await apiFetch(`/api/conversations/${encodeURIComponent(state.activeConvId)}/btw-notes/${encodeURIComponent(delBtw.dataset.noteId)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        const out = await res.json();
        if (state.currentViewData?.cliInsights) {
          state.currentViewData.cliInsights.btwNotes = out.notes || [];
          renderCliToolsDrawer();
        }
      }
    }
  });

  // Unified Persistent Preferences Dropdown + Live Custom RGB Panel
  el('prefs-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    el('tools-menu')?.classList.add('hidden');
    renderPrefsMenu();
    el('prefs-menu')?.classList.toggle('hidden');
  });

  el('prefs-menu')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.target.closest('[data-palette-rename-input]')) return;

    const langBtn = e.target.closest('[data-pref-lang]');
    if (langBtn) {
      applyLanguage(langBtn.dataset.prefLang);
      return;
    }

    const sizeDeltaBtn = e.target.closest('[data-font-size-delta]');
    if (sizeDeltaBtn) {
      const delta = Number(sizeDeltaBtn.dataset.fontSizeDelta) || 0;
      state.fontSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, state.fontSize + delta));
      localStorage.setItem('amp-font-size', String(state.fontSize));
      applyAppearance();
      return;
    }

    if (e.target.closest('[data-font-size-reset]')) {
      state.fontSize = DEFAULT_FONT_SIZE;
      localStorage.setItem('amp-font-size', String(DEFAULT_FONT_SIZE));
      applyAppearance();
      return;
    }

    const togglePickerBtn = e.target.closest('[data-toggle-font-picker]');
    if (togglePickerBtn) {
      const which = togglePickerBtn.dataset.toggleFontPicker || 'latin';
      state.openFontPicker = state.openFontPicker === which ? null : which;
      renderPrefsMenu();
      return;
    }

    const proseBtn = e.target.closest('[data-pref-prose]');
    if (proseBtn) {
      const targetFont = proseBtn.dataset.prefProse;
      if (LATIN_FONTS.some((f) => f.id === targetFont)) {
        state.prose = targetFont;
        localStorage.setItem('amp-prose', state.prose);
        applyAppearance();
      }
      return;
    }

    const proseCjkBtn = e.target.closest('[data-pref-prose-cjk]');
    if (proseCjkBtn) {
      const targetCjk = proseCjkBtn.dataset.prefProseCjk;
      if (CJK_FONTS.some((f) => f.id === targetCjk)) {
        state.proseCjk = targetCjk;
        localStorage.setItem('amp-prose-cjk', state.proseCjk);
        applyAppearance();
      }
      return;
    }
    const widthBtn = e.target.closest('[data-pref-width]');
    if (widthBtn) {
      state.width = widthBtn.dataset.prefWidth === 'wide' ? 'wide' : 'normal';
      localStorage.setItem('amp-width', state.width);
      applyAppearance();
      return;
    }
    const tablesBtn = e.target.closest('[data-pref-tables]');
    if (tablesBtn) {
      state.tables = tablesBtn.dataset.prefTables === 'expand' ? 'expand' : 'compact';
      localStorage.setItem('amp-tables', state.tables);
      applyAppearance();
      return;
    }
    const modeBtn = e.target.closest('[data-theme-mode]');
    if (modeBtn) {
      state.theme = modeBtn.dataset.themeMode === 'dark' ? 'dark' : 'light';
      localStorage.setItem('amp-theme', state.theme);
      applyAppearance();
      return;
    }
    if (e.target.closest('[data-add-custom-palette]')) {
      createNewCustomPalette();
      return;
    }
    const renamePalBtn = e.target.closest('[data-rename-palette]');
    if (renamePalBtn) {
      state.renamingPaletteId = renamePalBtn.dataset.renamePalette;
      renderPrefsMenu();
      return;
    }
    const delPalBtn = e.target.closest('[data-delete-palette]');
    if (delPalBtn) {
      deleteCustomPalette(delPalBtn.dataset.deletePalette);
      return;
    }
    const palBtn = e.target.closest('[data-theme-palette]');
    if (palBtn) {
      state.palette = palBtn.dataset.themePalette;
      state.renamingPaletteId = null;
      localStorage.setItem('amp-palette', state.palette);
      applyAppearance();
      return;
    }
    const rgbSlotBtn = e.target.closest('[data-rgb-slot]');
    if (rgbSlotBtn) {
      state.rgbActiveSlot = rgbSlotBtn.dataset.rgbSlot === 'accent' ? 'accent' : 'bg';
      renderPrefsMenu();
      return;
    }
    if (e.target.closest('[data-rgb-reset]')) {
      const activeCustom = getActiveCustomPalette();
      if (activeCustom) {
        activeCustom.lightBg = DEFAULT_CUSTOM_COLORS.lightBg;
        activeCustom.darkBg = DEFAULT_CUSTOM_COLORS.darkBg;
        activeCustom.accent = DEFAULT_CUSTOM_COLORS.accent;
        saveCustomPalettes();
        applyAppearance();
      }
    }
  });

  el('prefs-menu')?.addEventListener('keydown', (e) => {
    const renInp = e.target.closest('[data-palette-rename-input]');
    if (!renInp) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      commitPaletteRename(renInp.dataset.paletteRenameInput, renInp.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      state.renamingPaletteId = null;
      renderPrefsMenu();
    }
  });

  el('prefs-menu')?.addEventListener('focusout', (e) => {
    const renInp = e.target.closest('[data-palette-rename-input]');
    if (!renInp) return;
    const id = renInp.dataset.paletteRenameInput;
    if (state.renamingPaletteId === id) {
      commitPaletteRename(id, renInp.value);
    }
  });

  el('prefs-menu')?.addEventListener('input', (e) => {
    if (e.target.closest('[data-palette-rename-input]')) return;
    const picker = e.target.closest('[data-rgb-picker]');
    if (picker && isValidHex(picker.value)) {
      applyCustomSlotColorLive(picker.value);
      return;
    }
    const hexIn = e.target.closest('[data-rgb-hex]');
    if (hexIn) {
      const candidate = hexIn.value.startsWith('#') ? hexIn.value : `#${hexIn.value}`;
      if (isValidHex(candidate)) {
        applyCustomSlotColorLive(candidate);
      }
      return;
    }
    const rangeCh = e.target.closest('[data-rgb-channel]');
    const numCh = e.target.closest('[data-rgb-num]');
    if (rangeCh || numCh) {
      const menu = el('prefs-menu');
      const activeCustom = getActiveCustomPalette();
      if (!activeCustom) return;
      const { bgHex, accentHex } = getPaletteColorsFor(activeCustom);
      const curHex = state.rgbActiveSlot === 'accent' ? accentHex : bgHex;
      const rgb = hexToRgb(curHex);
      const ch = rangeCh ? rangeCh.dataset.rgbChannel : numCh.dataset.rgbNum;
      rgb[ch] = clampByte((rangeCh || numCh).value);
      const nextHex = rgbToHex(rgb.r, rgb.g, rgb.b);
      if (menu) {
        const peer = rangeCh
          ? menu.querySelector(`[data-rgb-num="${ch}"]`)
          : menu.querySelector(`[data-rgb-channel="${ch}"]`);
        if (peer) peer.value = String(rgb[ch]);
      }
      applyCustomSlotColorLive(nextHex);
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.theme-dropdown-wrap')) {
      el('prefs-menu')?.classList.add('hidden');
      el('tools-menu')?.classList.add('hidden');
    }
  });

  // Find bar
  el('find-toggle-btn')?.addEventListener('click', () => {
    const bar = el('find-bar');
    bar.classList.toggle('hidden');
    if (!bar.classList.contains('hidden')) el('find-input')?.focus();
    else clearFindHighlights();
  });
  el('find-input')?.addEventListener('input', (e) => runFindInPage(e.target.value));
  el('find-next-btn')?.addEventListener('click', () => jumpToFindHit(state.findIndex + 1));
  el('find-prev-btn')?.addEventListener('click', () => jumpToFindHit(state.findIndex - 1));
  el('find-close-btn')?.addEventListener('click', () => {
    el('find-bar')?.classList.add('hidden');
    clearFindHighlights();
  });

  // Open / Paste modal
  el('paste-open-btn')?.addEventListener('click', () => {
    el('paste-modal')?.classList.remove('hidden');
    el('paste-filepath-input')?.focus();
  });
  el('paste-close-btn')?.addEventListener('click', () => el('paste-modal')?.classList.add('hidden'));
  el('paste-submit-btn')?.addEventListener('click', async () => {
    const pathOrBase = (el('paste-filepath-input')?.value || '').trim().replace(/^["']|["']$/g, '');
    const content = el('paste-textarea')?.value || '';
    const title = el('paste-title-input')?.value.trim() || '';
    const mode = el('paste-mode-select')?.value || 'auto';

    if (!pathOrBase && !content.trim()) return;
    el('paste-modal')?.classList.add('hidden');

    if (!content.trim() && pathOrBase) {
      await submitCustomPreview({ filePath: pathOrBase, title, mode });
    } else {
      await submitCustomPreview({
        title,
        content,
        mode,
        baseDir: pathOrBase || '',
      });
    }
  });

  el('image-modal')?.addEventListener('click', () => el('image-modal')?.classList.add('hidden'));

  // Fullscreen Mermaid Modal controls
  el('mmd-modal-close')?.addEventListener('click', () => el('mermaid-modal')?.classList.add('hidden'));
  el('mermaid-modal')?.addEventListener('click', (e) => {
    if (e.target === el('mermaid-modal')) el('mermaid-modal')?.classList.add('hidden');
  });
  el('mmd-modal-zoom-in')?.addEventListener('click', () => el('mermaid-modal-viewport')?._panZoomCtrl?.zoomBy(1.25));
  el('mmd-modal-zoom-out')?.addEventListener('click', () => el('mermaid-modal-viewport')?._panZoomCtrl?.zoomBy(0.8));
  el('mmd-modal-zoom-reset')?.addEventListener('click', () => el('mermaid-modal-viewport')?._panZoomCtrl?.reset());
  el('mmd-modal-zoom-width')?.addEventListener('click', fitMermaidModalToWidth);
  el('mmd-modal-zoom-fit')?.addEventListener('click', fitMermaidModalToScreen);
  el('mmd-modal-download')?.addEventListener('click', () => {
    const svg = el('mermaid-modal-canvas')?.querySelector('svg');
    if (svg) downloadSvgElement(svg, 'mermaid-elk-diagram.svg');
  });

  // External OS File Drag-and-Drop onto window
  document.addEventListener('dragover', (e) => {
    if (state.dragDocId) return;
    e.preventDefault();
  });
  document.addEventListener('drop', async (e) => {
    if (state.dragDocId) return;
    e.preventDefault();

    const uriList = (e.dataTransfer?.getData('text/uri-list') || '').split(/\r?\n/).find((l) => l && !l.startsWith('#'));
    if (uriList && uriList.startsWith('file://')) {
      await submitCustomPreview({ filePath: uriList, mode: 'auto' });
      return;
    }

    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    const lowerName = (file.name || '').toLowerCase();
    const isBinaryExt = /\.(pdf|docx|doc|xlsx|xls|ods|pptx|ppt|mp4|webm|mov|m4v|ogv|mkv|avi|mp3|wav|flac|ogg|oga|m4a|aac|opus|png|jpg|jpeg|gif|webp|bmp|ico|avif)$/i.test(lowerName);
    if (isBinaryExt) {
      el('paste-modal')?.classList.remove('hidden');
      showToast(getLang() === 'zh' ? '请点击「📂 浏览…」选择该本地文档/媒体文件以直接流式预览' : 'Click "📂 Browse…" to open binary PDF / Office / media files directly from disk');
      return;
    }
    const text = await file.text();
    await submitCustomPreview({
      title: file.name,
      droppedFilename: file.name,
      content: text,
      mode: 'auto',
    });
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (!el('auth-lock-overlay')?.classList.contains('hidden')) return;
    const tag = document.activeElement?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      toggleSidebar();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      el('find-bar')?.classList.remove('hidden');
      el('find-input')?.focus();
      return;
    }
    if (e.key === 'Escape') {
      if (!el('prefs-menu')?.classList.contains('hidden') || !el('tools-menu')?.classList.contains('hidden')) {
        el('prefs-menu')?.classList.add('hidden');
        el('tools-menu')?.classList.add('hidden');
        return;
      }
      if (state.activeCliToolTab) {
        state.activeCliToolTab = null;
        renderCliToolsDrawer();
        return;
      }
      if (!el('mermaid-modal')?.classList.contains('hidden')) {
        el('mermaid-modal')?.classList.add('hidden');
        return;
      }
      if (!el('image-modal')?.classList.contains('hidden')) {
        el('image-modal')?.classList.add('hidden');
        return;
      }
      if (!el('file-preview-modal')?.classList.contains('hidden')) {
        el('file-preview-modal')?.classList.add('hidden');
        return;
      }
      if (!el('paste-modal')?.classList.contains('hidden')) {
        el('paste-modal')?.classList.add('hidden');
        return;
      }
      if (!el('find-bar')?.classList.contains('hidden')) {
        el('find-bar')?.classList.add('hidden');
        clearFindHighlights();
        return;
      }
      if (!el('side-preview-pane')?.classList.contains('hidden')) {
        closeSidePreview();
      }
      return;
    }
    if (typing || document.activeElement?.isContentEditable) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const k = e.key.toLowerCase();
    if (k === 'r') { e.preventDefault(); manualSync(); }
    else if (k === 't') {
      e.preventDefault();
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('amp-theme', state.theme);
      applyAppearance();
    }
    else if (k === 'o') { e.preventDefault(); el('toc-toggle-btn')?.click(); }
    else if (k === 'w') {
      e.preventDefault();
      state.width = state.width === 'normal' ? 'wide' : 'normal';
      localStorage.setItem('amp-width', state.width);
      applyAppearance();
    }
    else if (k === 'f') {
      e.preventDefault();
      const curIdx = LATIN_FONTS.findIndex((f) => f.id === state.prose);
      const nextFont = LATIN_FONTS[(curIdx + 1) % LATIN_FONTS.length] || LATIN_FONTS[0];
      state.prose = nextFont.id;
      localStorage.setItem('amp-prose', state.prose);
      applyAppearance();
    }
    else if (k === 'p') { e.preventDefault(); el('paste-open-btn')?.click(); }
    else if (k === '/') {
      e.preventDefault();
      el('find-bar')?.classList.remove('hidden');
      el('find-input')?.focus();
    }
  });

  if (isSidecar || window.innerWidth <= 860) {
    if (isSidecar) el('sidebar')?.classList.add('collapsed');
    el('toc-drawer')?.classList.add('hidden');
    el('toc-toggle-btn')?.classList.remove('active');
  }

  const auth = await checkAuthStatus();
  if (auth.authRequired && !auth.authenticated) {
    showAuthLockOverlay();
    return;
  }

  await loadInitialWorkspaceContent();
}

bootstrap();
