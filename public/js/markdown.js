// Lightweight, high-performance Markdown renderer:
// - Block-level memoization keyed by (baseDir, blockText)
// - Relative & local file/image path resolution + "Open in sidebar" pills for code files
// - Safe HTML sanitizer preserving README <img>/<details>/<br>/centered blocks while blocking scripts
// - CJK bold punctuation compatibility + KaTeX math + Obsidian/GitHub callouts + lazy Mermaid

import { getLang, t } from './i18n.js';
import { relayoutMarkdownTables, toggleCellFold } from './table-layout.js';

export { relayoutMarkdownTables };

const blockHtmlCache = new Map();
let mermaidLoaderPromise = null;
let mermaidCounter = 0;

const IMAGE_FILE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif',
]);

const MEDIA_PREVIEW_EXTS = new Set([
  '.pdf',
  '.docx', '.doc',
  '.xlsx', '.xls', '.ods',
  '.pptx', '.ppt',
  '.mp4', '.webm', '.mov', '.m4v', '.ogv', '.mkv', '.avi',
  '.mp3', '.wav', '.flac', '.ogg', '.oga', '.m4a', '.aac', '.opus', '.weba',
]);

const INLINE_VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogv']);
const INLINE_AUDIO_EXTS = new Set(['.mp3', '.wav', '.flac', '.ogg', '.oga', '.m4a', '.aac', '.opus', '.weba']);

const DOC_FILE_EXTS = new Set([
  '.md', '.markdown', '.mdx', '.txt', '.log', '.rst', '.csv', '.tsv',
]);

const NON_PREVIEWABLE_BINARY_EXTS = new Set([
  '.zip', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.iso', '.dmg', '.msi',
  '.whl', '.pyc', '.pyo', '.pyd', '.class', '.jar', '.o', '.obj', '.a', '.lib',
  '.pt', '.pth', '.ckpt', '.safetensors', '.onnx', '.trt', '.engine', '.npz', '.npy', '.h5', '.hdf5', '.pkl', '.parquet',
  '.blend', '.fbx', '.glb', '.gltf', '.usd', '.usda', '.usdc', '.stl', '.ply',
]);

const CALLOUT_ICONS = {
  note: '<svg class="callout-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>',
  tip: '<svg class="callout-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.751.751 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z"/></svg>',
  important: '<svg class="callout-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/></svg>',
  warning: '<svg class="callout-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/></svg>',
  caution: '<svg class="callout-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>',
};

function getCalloutIconSvg(kind) {
  if (kind === 'tip' || kind === 'success') return CALLOUT_ICONS.tip;
  if (kind === 'important') return CALLOUT_ICONS.important;
  if (kind === 'warning') return CALLOUT_ICONS.warning;
  if (kind === 'caution' || kind === 'error' || kind === 'bug') return CALLOUT_ICONS.caution;
  return CALLOUT_ICONS.note;
}

const CODE_FILE_EXTS = new Set([
  '.py', '.pyi', '.ipynb', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.c', '.cc', '.cpp', '.cxx', '.h', '.hpp', '.cu', '.cuh',
  '.rs', '.go', '.java', '.kt', '.kts', '.scala', '.cs', '.swift', '.rb', '.php', '.lua',
  '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
  '.json', '.jsonl', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.xml', '.html', '.css', '.scss', '.vue', '.svelte',
  '.sql', '.graphql', '.proto', '.cmake', '.gradle', '.tex', '.bib', '.gitignore',
]);

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function slugifyHeading(text) {
  return String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/**
 * Outline title for prose that has no Markdown heading.
 * CJK characters count as one unit; Latin tokens stay whole words.
 */
export function outlineLeadLabel(text, { maxUnits = 14, maxChars = 36 } = {}) {
  const single = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!single) return '';
  const token = /[\u3400-\u9fff\u3040-\u30ff\uf900-\ufaff\uac00-\ud7af]|[A-Za-z0-9]+(?:[.'’-][A-Za-z0-9]+)*|[^\s]/gu;
  let units = 0;
  let end = 0;
  for (const match of single.matchAll(token)) {
    const nextEnd = match.index + match[0].length;
    if (units > 0 && (units >= maxUnits || nextEnd > maxChars)) break;
    units += 1;
    end = nextEnd;
    if (units === 1 && nextEnd > maxChars) {
      end = maxChars;
      break;
    }
    if (units >= maxUnits || end >= maxChars) break;
  }
  if (!end) return '';
  const truncated = end < single.length;
  let label = single.slice(0, end).replace(/[\s,，.。!！?？;；:：、)）]+$/u, '');
  if (!label) label = single.slice(0, end).trim();
  if (!label) return '';
  return truncated ? `${label}…` : label;
}

export function isCodeFilePath(rawHref) {
  if (!rawHref || typeof rawHref !== 'string') return false;
  const clean = rawHref.split('#')[0].split('?')[0].trim().toLowerCase();
  const slashIdx = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  const filename = slashIdx >= 0 ? clean.slice(slashIdx + 1) : clean;
  if (['dockerfile', 'makefile', 'cmakelists.txt'].includes(filename)) return true;
  const dotIdx = filename.lastIndexOf('.');
  if (dotIdx === -1) return false;
  return CODE_FILE_EXTS.has(filename.slice(dotIdx));
}

export function isPreviewableFilePath(rawHref) {
  if (!rawHref || typeof rawHref !== 'string') return false;
  const clean = rawHref.split('#')[0].split('?')[0].trim().replace(/[\\/]+$/, '').toLowerCase();
  if (!clean) return false;
  const slashIdx = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  const filename = slashIdx >= 0 ? clean.slice(slashIdx + 1) : clean;
  if (['dockerfile', 'makefile', 'cmakelists.txt', 'readme', 'license', 'changelog'].includes(filename)) return true;
  const dotIdx = filename.lastIndexOf('.');
  // Extensionless local paths (e.g. `packages/core` or `docs/`) typically point to directories with README.md
  if (dotIdx === -1) return true;
  const ext = filename.slice(dotIdx);
  if (NON_PREVIEWABLE_BINARY_EXTS.has(ext)) return false;
  return CODE_FILE_EXTS.has(ext) || DOC_FILE_EXTS.has(ext) || IMAGE_FILE_EXTS.has(ext) || MEDIA_PREVIEW_EXTS.has(ext);
}

export function classifyHref(rawHref) {
  if (!rawHref || typeof rawHref !== 'string') return { kind: 'unsafe' };
  const trimmed = rawHref.trim();
  if (!trimmed) return { kind: 'unsafe' };
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('vbscript:') || lower.startsWith('data:text/html')) {
    return { kind: 'unsafe' };
  }
  if (trimmed.startsWith('#')) {
    return { kind: 'anchor', href: trimmed };
  }
  if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('mailto:')) {
    return { kind: 'external', href: trimmed };
  }
  if (lower.startsWith('conversation://')) {
    return { kind: 'conversation', convId: trimmed.replace(/^conversation:\/\/\/?/i, '').trim() };
  }
  if (lower.startsWith('data:image/')) {
    return { kind: 'data-image', href: trimmed };
  }
  // Everything else (file://, E:\..., /path/..., packages/core/README.md, ./foo.py, ../img.png) is a local/relative target
  return {
    kind: 'local',
    rawPath: trimmed,
    isCode: isCodeFilePath(trimmed),
    isPreviewable: isPreviewableFilePath(trimmed),
  };
}

export function buildRawFileUrl(rawPath, baseDir = '') {
  const qs = new URLSearchParams({ path: rawPath });
  if (baseDir) qs.set('base', baseDir);
  return `/api/raw-file?${qs.toString()}`;
}

/**
 * Marked treats a single `~` as strikethrough (`~~?` in its GFM rule).
 * Approximation marks such as `~17 ep` then pair with the next `~` and draw a
 * line through the text between them. Real strikethrough stays `~~text~~`.
 */
const ANCHOR_MARKUP = /[`*_~#]/;

export function isAnchorMarkup(ch) {
  return ANCHOR_MARKUP.test(ch);
}

/** Visible prose used to match a spot between rendered Markdown and its source. */
export function normalizeAnchorText(text) {
  return String(text ?? '')
    .replace(new RegExp(ANCHOR_MARKUP.source, 'g'), '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A short normalized phrase around a raw-text offset. */
export function anchorProbe(text, offset, radius = 42) {
  const raw = String(text ?? '');
  const at = Math.max(0, Math.min(raw.length, Number(offset) || 0));
  const slice = raw.slice(Math.max(0, at - radius), Math.min(raw.length, at + radius));
  const norm = normalizeAnchorText(slice);
  if (norm.length >= 12) return norm;
  return normalizeAnchorText(raw.slice(Math.max(0, at - radius * 3), Math.min(raw.length, at + radius * 3))).slice(0, 96);
}

/** Index of the probe inside already-normalized text, shrinking from both ends if needed. */
export function locateAnchorProbe(haystackNorm, probe) {
  const hay = String(haystackNorm ?? '');
  let needle = String(probe ?? '').trim();
  if (!hay || !needle) return -1;
  while (needle.length >= 8) {
    const at = hay.indexOf(needle);
    if (at >= 0) return at;
    if (needle.length === 8) break;
    needle = needle.slice(1, -1);
  }
  return -1;
}

export function escapeApproxTildes(text) {
  return String(text ?? '').replace(/(^|[^\\])(~+)/g, (full, lead, run) => {
    if (run.length % 2 === 0) return full;
    return `${lead}${'~'.repeat(run.length - 1)}\\~`;
  });
}

export function fixCjkEmphasis(text) {
  const parts = String(text ?? '').split(/(`[^`]*`)/g);
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i].replace(
      /\*\*([^*\n]+?[：:，,。！？；、）》」』】\]])\*\*(?=[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af])/g,
      '<strong>$1</strong>'
    );
  }
  return parts.join('');
}

function extractMathAndCode(source) {
  const mathTokens = [];
  const text = String(source ?? '').replace(/\r\n/g, '\n');

  const codeSegments = text.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)/g);
  for (let i = 0; i < codeSegments.length; i += 2) {
    let seg = codeSegments[i];

    seg = seg.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr) => {
      const idx = mathTokens.length;
      mathTokens.push({ display: true, expr: expr.trim() });
      return `\uE000MATH_BLOCK_${idx}\uE001`;
    });
    seg = seg.replace(/\\\[([\s\S]+?)\\\]/g, (_, expr) => {
      const idx = mathTokens.length;
      mathTokens.push({ display: true, expr: expr.trim() });
      return `\uE000MATH_BLOCK_${idx}\uE001`;
    });

    seg = seg.replace(/\\\((.+?)\\\)/g, (_, expr) => {
      const idx = mathTokens.length;
      mathTokens.push({ display: false, expr: expr.trim() });
      return `\uE000MATH_INLINE_${idx}\uE001`;
    });
    seg = seg.replace(/(?<![\\$\w])\$(?!\s)([^$\n]+?)(?<!\s)\$(?![\w])/g, (_, expr) => {
      const idx = mathTokens.length;
      mathTokens.push({ display: false, expr: expr.trim() });
      return `\uE000MATH_INLINE_${idx}\uE001`;
    });

    seg = escapeApproxTildes(seg);
    codeSegments[i] = fixCjkEmphasis(seg);
  }

  return { text: codeSegments.join(''), mathTokens };
}

function renderLatex(expr, displayMode) {
  if (typeof window !== 'undefined' && window.katex?.renderToString) {
    try {
      return window.katex.renderToString(expr, {
        displayMode,
        throwOnError: false,
        strict: false,
      });
    } catch {
      return `<code>${escapeHtml(expr)}</code>`;
    }
  }
  return displayMode
    ? `<pre class="math-fallback"><code>${escapeHtml(expr)}</code></pre>`
    : `<code>${escapeHtml(expr)}</code>`;
}

function restoreMath(html, mathTokens) {
  if (!mathTokens.length) return html;
  let out = html.replace(/<p>\s*(\uE000MATH_BLOCK_\d+\uE001)\s*<\/p>/g, '$1');
  out = out.replace(/\uE000MATH_(BLOCK|INLINE)_(\d+)\uE001/g, (_, kind, idxStr) => {
    const token = mathTokens[Number(idxStr)];
    if (!token) return '';
    const rendered = renderLatex(token.expr, kind === 'BLOCK');
    return kind === 'BLOCK' ? `<div class="math-block">${rendered}</div>` : rendered;
  });
  return out;
}

/**
 * Safely sanitize common benign HTML in READMEs (`<img>`, `<br>`, `<details>`, `<summary>`,
 * `<p align="center">`, `<sub>`, `<sup>`, `<kbd>`) while escaping scripts/handlers.
 */
function sanitizeHtmlSnippet(rawHtml, baseDir) {
  const trimmed = String(rawHtml ?? '').trim();
  if (/^<\/?(?:strong|em|b|i|sub|sup|kbd|br|hr|details|summary)\s*\/?>$/i.test(trimmed)) {
    return trimmed;
  }
  if (/^<\/(?:p|div|span|a)>$/i.test(trimmed)) {
    return trimmed;
  }
  const alignOpen = trimmed.match(/^<(p|div)(?:\s+align=["']?(center|left|right)["']?)?\s*>$/i);
  if (alignOpen) {
    const tag = alignOpen[1].toLowerCase();
    const align = alignOpen[2] ? ` style="text-align:${alignOpen[2].toLowerCase()};"` : '';
    return `<${tag}${align}>`;
  }

  // Handle raw <img ...> tags frequently used in GitHub READMEs
  if (/^<img\b[^>]*>$/i.test(trimmed)) {
    const srcMatch = trimmed.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const altMatch = trimmed.match(/\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const widthMatch = trimmed.match(/\bwidth\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const rawSrc = srcMatch ? (srcMatch[1] ?? srcMatch[2] ?? srcMatch[3] ?? '') : '';
    const alt = escapeHtml(altMatch ? (altMatch[1] ?? altMatch[2] ?? '') : '');
    const widthVal = widthMatch ? (widthMatch[1] ?? widthMatch[2] ?? widthMatch[3] ?? '') : '';
    const safeWidth = /^\d+(?:%|px)?$/.test(widthVal) ? ` width="${escapeHtml(widthVal)}"` : '';

    const cls = classifyHref(rawSrc);
    let finalSrc = '';
    if (cls.kind === 'external' || cls.kind === 'data-image') {
      finalSrc = cls.href;
    } else if (cls.kind === 'local') {
      finalSrc = buildRawFileUrl(cls.rawPath, baseDir);
    }
    if (finalSrc) {
      return `<img src="${escapeHtml(finalSrc)}" alt="${alt}"${safeWidth} class="md-image" data-zoomable="true" loading="lazy" />`;
    }
  }

  // Handle simple HTML blocks containing nested <img> tags (e.g. `<p align="center"><img ... /></p>`)
  if (trimmed.includes('<img') && !/<script|<iframe|on\w+\s*=/i.test(trimmed)) {
    return trimmed.replace(/<[^>]+>/g, (tag) => sanitizeHtmlSnippet(tag, baseDir));
  }

  return escapeHtml(rawHtml);
}

function createMarkedForBase(baseDir = '') {
  if (typeof window === 'undefined' || !window.marked) return null;
  const { Marked } = window.marked;
  const renderer = {
    html(token) {
      const raw = typeof token === 'string' ? token : token.text || '';
      return sanitizeHtmlSnippet(raw, baseDir);
    },
    heading(token) {
      const htmlText = this.parser.parseInline(token.tokens || []);
      const slug = slugifyHeading(token.text || htmlText);
      const idAttr = slug ? ` id="${escapeHtml(slug)}"` : '';
      return `<h${token.depth}${idAttr}>${htmlText}</h${token.depth}>\n`;
    },
    link(token) {
      const text = this.parser.parseInline(token.tokens || []) || escapeHtml(token.text || '');
      const titleAttr = token.title ? ` title="${escapeHtml(token.title)}"` : '';
      const info = classifyHref(token.href);

      if (info.kind === 'unsafe') {
        return text;
      }
      if (info.kind === 'anchor') {
        return `<a href="${escapeHtml(info.href)}" data-anchor-link="true"${titleAttr}>${text}</a>`;
      }
      if (info.kind === 'external') {
        return `<a href="${escapeHtml(info.href)}" target="_blank" rel="noopener noreferrer"${titleAttr}>${text}</a>`;
      }
      if (info.kind === 'conversation') {
        return `<a href="#" class="local-file-link" data-open-conv="${escapeHtml(info.convId)}" title="Preview subagent conversation">${text}</a>`;
      }
      if (info.kind === 'local') {
        const escapedTarget = escapeHtml(info.rawPath);
        const escapedBase = escapeHtml(baseDir);
        const linkEl = `<a href="#" class="local-file-link" data-local-href="${escapedTarget}" data-base-dir="${escapedBase}" data-preview-mode="popup" title="${escapedTarget}">${text}</a>`;
        if (info.isPreviewable) {
          return `<span class="code-link-group">${linkEl}<button type="button" class="open-sidebar-pill" data-local-href="${escapedTarget}" data-base-dir="${escapedBase}" data-preview-mode="sidebar" title="${escapeHtml(t('openInSidebarTip', { path: info.rawPath }))}">${escapeHtml(t('openInSidebar'))}</button></span>`;
        }
        return linkEl;
      }
      return text;
    },
    image(token) {
      const alt = escapeHtml(token.text || '');
      const titleAttr = token.title ? ` title="${escapeHtml(token.title)}"` : '';
      const info = classifyHref(token.href);

      let src = '';
      if (info.kind === 'external' || info.kind === 'data-image') {
        src = info.href;
      } else if (info.kind === 'local') {
        src = buildRawFileUrl(info.rawPath, baseDir);
      }

      if (!src) {
        return `<span class="image-alt-badge">[Image: ${alt || 'unavailable'}]</span>`;
      }
      const cleanHref = String(token.href || '').split('#')[0].split('?')[0].trim().toLowerCase();
      const dotIdx = cleanHref.lastIndexOf('.');
      const ext = dotIdx !== -1 ? cleanHref.slice(dotIdx) : '';
      if (INLINE_VIDEO_EXTS.has(ext)) {
        return `<video src="${escapeHtml(src)}" controls playsinline preload="metadata"${titleAttr} class="md-video"></video>`;
      }
      if (INLINE_AUDIO_EXTS.has(ext)) {
        return `<audio src="${escapeHtml(src)}" controls preload="metadata"${titleAttr} class="md-audio"></audio>`;
      }
      return `<img src="${escapeHtml(src)}" alt="${alt}"${titleAttr} class="md-image" data-zoomable="true" loading="lazy" />`;
    },
    code(token) {
      const code = token.text || '';
      const lang = (token.lang || '').trim().split(/\s+/)[0].toLowerCase();

      if (lang === 'mermaid') {
        const id = `mermaid-${++mermaidCounter}`;
        return `<div class="mermaid-card" data-mermaid-id="${id}" data-mermaid-src="${escapeHtml(code)}">
          <div class="code-card-header">
            <span>mermaid · ELK</span>
            <div class="code-card-actions">
              <button type="button" class="code-mini-btn" data-action="mmd-zoom-out" title="${escapeHtml(t('mmdZoomOutTip'))}">−</button>
              <button type="button" class="code-mini-btn" data-action="mmd-zoom-reset" data-zoom-label title="${escapeHtml(t('mmdZoomResetTip'))}">100%</button>
              <button type="button" class="code-mini-btn" data-action="mmd-zoom-in" title="${escapeHtml(t('mmdZoomInTip'))}">+</button>
              <button type="button" class="code-mini-btn" data-action="mmd-toggle-wide" title="${escapeHtml(t('mmdWideTip'))}">${escapeHtml(t('mmdWideBtn'))}</button>
              <button type="button" class="code-mini-btn" data-action="mmd-fullscreen" title="${escapeHtml(t('mmdFullscreenTip'))}">${escapeHtml(t('mmdFullscreenBtn'))}</button>
              <button type="button" class="code-mini-btn" data-action="mmd-download-svg" title="${escapeHtml(t('mmdDownloadTip'))}">${escapeHtml(t('mmdDownloadBtn'))}</button>
              <button type="button" class="code-mini-btn" data-action="copy-raw">${escapeHtml(t('copyBtn'))}</button>
            </div>
          </div>
          <div class="mermaid-stage" title="${escapeHtml(t('mmdStageTip'))}">
            <div class="mermaid-panzoom-canvas"><span style="color:var(--text-faint);font-size:0.8rem;">${escapeHtml(t('renderingDiagram'))}</span></div>
          </div>
        </div>`;
      }

      const lineCount = code.split('\n').length;
      const langLabel = lang || 'text';
      return `<div class="code-card" data-lang="${escapeHtml(lang)}">
        <div class="code-card-header">
          <span>${escapeHtml(langLabel)} · ${lineCount} ${escapeHtml(t('linesUnit'))}</span>
          <div class="code-card-actions">
            <button type="button" class="code-mini-btn" data-action="toggle-wrap">${escapeHtml(t('wrapBtn'))}</button>
            <button type="button" class="code-mini-btn" data-action="copy-code">${escapeHtml(t('copyBtn'))}</button>
          </div>
        </div>
        <pre><code class="${lang ? `language-${escapeHtml(lang)}` : ''}">${escapeHtml(code)}</code></pre>
      </div>`;
    },
    table(token) {
      let headerHtml = '';
      const colCount = token.header?.length || 0;
      const rowCount = token.rows?.length || 0;
      if (colCount > 0) {
        const cells = token.header.map((cell, i) => {
          const align = token.align?.[i] ? ` style="text-align:${token.align[i]}"` : '';
          return `<th${align}>${this.parser.parseInline(cell.tokens)}</th>`;
        }).join('');
        headerHtml = `<thead><tr>${cells}</tr></thead>`;
      }
      const rowsHtml = (token.rows || []).map((row) => {
        const cells = row.map((cell, i) => {
          const align = token.align?.[i] ? ` style="text-align:${token.align[i]}"` : '';
          return `<td${align}>${this.parser.parseInline(cell.tokens)}</td>`;
        }).join('');
        return `<tr>${cells}</tr>`;
      }).join('');
      const expandBar = colCount >= 3
        ? `<div class="table-card-header"><span>${escapeHtml(t('tableMeta', { cols: colCount, rows: rowCount }))}</span><button type="button" class="code-mini-btn" data-action="toggle-table-expand" title="${escapeHtml(t('tableExpandTip'))}">${escapeHtml(t('tableExpandBtn'))}</button></div>`
        : '';
      return `<div class="table-card">${expandBar}<div class="table-wrap"><table>${headerHtml}<tbody>${rowsHtml}</tbody></table></div></div>`;
    },
    blockquote(token) {
      const inner = this.parser.parse(token.tokens || []);
      const match = inner.match(/^\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|INFO|SUCCESS|ERROR|BUG)\]([+-])?[ \t]*([^\n]*?)(?:\n([\s\S]*?))?<\/p>([\s\S]*)$/i);
      if (match) {
        const kind = match[1].toLowerCase();
        const collapseFlag = match[2] || '';
        const sameLine = (match[3] || '').trim();
        const firstParaRest = (match[4] || '').trim();
        const restParas = (match[5] || '').trim();
        const defaultTitle = kind.charAt(0).toUpperCase() + kind.slice(1);

        let titleHtml = defaultTitle;
        let bodyHtml = '';

        if (!firstParaRest && !restParas && sameLine) {
          // Single-line alert (`> [!CAUTION] High-risk actions...`): keep clean badge header and place content in body
          bodyHtml = `<p>${sameLine}</p>`;
        } else {
          const plainSameLine = sameLine.replace(/<[^>]+>/g, '').trim();
          if (sameLine && plainSameLine.length <= 72) {
            titleHtml = sameLine;
            bodyHtml = `${firstParaRest ? `<p>${firstParaRest}</p>` : ''}${restParas}`;
          } else {
            const combinedFirstP = [sameLine, firstParaRest].filter(Boolean).join('<br>');
            bodyHtml = `${combinedFirstP ? `<p>${combinedFirstP}</p>` : ''}${restParas}`;
          }
        }

        const iconSvg = getCalloutIconSvg(kind);
        const headerInner = `${iconSvg}<span class="callout-title-text">${titleHtml}</span>`;
        if (collapseFlag === '-') {
          return `<details class="callout callout-${kind}"><summary class="callout-title" style="cursor:pointer;">${headerInner}</summary><div class="callout-body">${bodyHtml}</div></details>`;
        }
        return `<div class="callout callout-${kind}"><div class="callout-title">${headerInner}</div>${bodyHtml ? `<div class="callout-body">${bodyHtml}</div>` : ''}</div>`;
      }
      return `<blockquote>${inner}</blockquote>`;
    },
  };

  const instance = new Marked({ gfm: true, breaks: false });
  instance.use({ renderer });
  return instance;
}

const markedByBase = new Map();
function getMarked(baseDir = '') {
  const cacheKey = `${getLang()}\0${baseDir}`;
  let inst = markedByBase.get(cacheKey);
  if (!inst) {
    inst = createMarkedForBase(baseDir);
    if (inst) {
      markedByBase.set(cacheKey, inst);
      if (markedByBase.size > 32) {
        markedByBase.delete(markedByBase.keys().next().value);
      }
    }
  }
  return inst;
}

function splitTopLevelBlocks(md) {
  const lines = md.split('\n');
  const blocks = [];
  let buf = [];
  let inFence = false;
  let fenceChar = '';

  for (const line of lines) {
    const trimmed = line.trim();
    const fenceMatch = trimmed.match(/^(```+|~~~+)/);
    if (fenceMatch) {
      const ch = fenceMatch[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = ch;
      } else if (ch === fenceChar && trimmed === fenceChar.repeat(trimmed.length)) {
        inFence = false;
        fenceChar = '';
      }
    }
    buf.push(line);
    if (!inFence && trimmed === '' && buf.length > 1) {
      blocks.push(buf.join('\n'));
      buf = [];
    }
  }
  if (buf.length > 0) blocks.push(buf.join('\n'));
  return blocks;
}

function renderBlockUncached(blockText, baseDir = '') {
  const m = getMarked(baseDir);
  const { text, mathTokens } = extractMathAndCode(blockText);
  if (!m) return `<pre>${escapeHtml(blockText)}</pre>`;
  const rawHtml = m.parse(text);
  return restoreMath(rawHtml, mathTokens);
}

export function renderMarkdownHtml(markdown, { baseDir = '' } = {}) {
  if (!markdown || typeof markdown !== 'string') return '';
  const blocks = splitTopLevelBlocks(markdown.replace(/\r\n/g, '\n'));
  const htmlParts = [];

  for (const blk of blocks) {
    const key = `${getLang()}\0${baseDir}\0${blk}`;
    let html = blockHtmlCache.get(key);
    if (html === undefined) {
      html = renderBlockUncached(blk, baseDir);
      blockHtmlCache.set(key, html);
      if (blockHtmlCache.size > 1500) {
        const firstKey = blockHtmlCache.keys().next().value;
        blockHtmlCache.delete(firstKey);
      }
    }
    htmlParts.push(html);
  }
  return htmlParts.join('');
}

const GPT_PASTEL_LIGHT = [
  { fill: '#dcebff', stroke: '#5b9bf8' }, // Sky Blue
  { fill: '#f2e7ff', stroke: '#a86ef5' }, // Soft Violet
  { fill: '#dcfce7', stroke: '#34c77b' }, // Mint Emerald
  { fill: '#fef3c7', stroke: '#e59924' }, // Warm Amber
  { fill: '#ffe4ec', stroke: '#e8648c' }, // Soft Rose
];

const GPT_PASTEL_DARK = [
  { fill: '#192b48', stroke: '#60a5fa' }, // Deep Sky Blue
  { fill: '#2a1d42', stroke: '#c084fc' }, // Deep Violet
  { fill: '#153226', stroke: '#4ade80' }, // Deep Mint Emerald
  { fill: '#362813', stroke: '#fbbf24' }, // Deep Amber
  { fill: '#381b26', stroke: '#f472b6' }, // Deep Rose
];

function roundOrthogonalSvgPath(d, radius = 6.5) {
  if (!d || /[CcQqSsTtAaZz]/.test(d)) return d;
  const tokens = [...d.matchAll(/([ML])\s*(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/gi)];
  if (tokens.length < 3) return d;

  // Only round single continuous M ... L ... polylines
  if (tokens.some((t, idx) => idx > 0 && t[1].toUpperCase() === 'M')) return d;

  const rawPts = tokens.map((t) => ({ x: Number(t[2]), y: Number(t[3]) }));
  const pts = [rawPts[0]];
  for (let i = 1; i < rawPts.length; i++) {
    const prev = pts[pts.length - 1];
    if (Math.hypot(rawPts[i].x - prev.x, rawPts[i].y - prev.y) > 0.5) {
      pts.push(rawPts[i]);
    }
  }
  if (pts.length < 3) return d;

  const out = [`M ${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`];
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const dx1 = p1.x - p0.x;
    const dy1 = p1.y - p0.y;
    const dx2 = p2.x - p1.x;
    const dy2 = p2.y - p1.y;
    const len1 = Math.hypot(dx1, dy1);
    const len2 = Math.hypot(dx2, dy2);
    const cross = Math.abs(dx1 * dy2 - dy1 * dx2);
    if (len1 < 2 || len2 < 2 || cross < 1e-2) {
      out.push(`L ${p1.x.toFixed(2)},${p1.y.toFixed(2)}`);
      continue;
    }
    const r = Math.min(radius, len1 * 0.45, len2 * 0.45);
    const sx = p1.x - (dx1 / len1) * r;
    const sy = p1.y - (dy1 / len1) * r;
    const ex = p1.x + (dx2 / len2) * r;
    const ey = p1.y + (dy2 / len2) * r;
    out.push(`L ${sx.toFixed(2)},${sy.toFixed(2)} Q ${p1.x.toFixed(2)},${p1.y.toFixed(2)} ${ex.toFixed(2)},${ey.toFixed(2)}`);
  }
  const last = pts[pts.length - 1];
  out.push(`L ${last.x.toFixed(2)},${last.y.toFixed(2)}`);
  return out.join(' ');
}

function parseTranslateXY(transformAttr) {
  if (!transformAttr) return null;
  const m = transformAttr.match(/translate\(\s*(-?\d+(?:\.\d+)?)(?:[,\s]+(-?\d+(?:\.\d+)?))?\s*\)/i);
  if (!m) return null;
  return { x: Number(m[1]), y: Number(m[2] || 0) };
}

function polishMermaidSvgToGptStyle(svgEl, isDark) {
  if (!svgEl) return;
  const palette = isDark ? GPT_PASTEL_DARK : GPT_PASTEL_LIGHT;
  const lineStroke = isDark ? '#787e8c' : '#969ba6';
  const textColor = isDark ? '#f1f5f9' : '#1e293b';
  const clusterFill = isDark ? '#1b1d22' : '#f3f4f6';
  const clusterStroke = isDark ? '#2e323b' : '#e5e7eb';

  // 1. Subgraph / Cluster containers -> soft light-gray / dark-slate GPT cards
  const clusterBoxes = [];
  svgEl.querySelectorAll('g.cluster').forEach((cl) => {
    const rect = cl.querySelector('rect');
    if (rect) {
      const inlineStyle = rect.getAttribute('style') || '';
      const hasCustomFill = /fill\s*:\s*(?!none|#fff4dd|#ffffde|hsl\()/i.test(inlineStyle);
      const x = Number(rect.getAttribute('x') || 0);
      const y = Number(rect.getAttribute('y') || 0);
      const w = Number(rect.getAttribute('width') || 0);
      const h = Number(rect.getAttribute('height') || 0);
      clusterBoxes.push({ x, y, w, h, area: w * h });
      if (!hasCustomFill) {
        rect.style.fill = clusterFill;
        rect.style.stroke = clusterStroke;
        rect.style.strokeWidth = '1px';
      }
      rect.setAttribute('rx', '5');
      rect.setAttribute('ry', '5');
    }
    cl.querySelectorAll('.cluster-label span, .cluster-label text, .cluster-label p').forEach((lbl) => {
      lbl.style.color = textColor;
      lbl.style.fill = textColor;
      lbl.style.fontWeight = '600';
      lbl.style.fontSize = '13.5px';
    });
  });

  // Sort clusters top-to-bottom so stages get deterministic pastel hues
  clusterBoxes.sort((a, b) => a.y - b.y || a.x - b.x);

  // Collect node Y range for unclustered topological coloring
  const nodeInfos = [];
  svgEl.querySelectorAll('g.node').forEach((nodeEl) => {
    const pos = parseTranslateXY(nodeEl.getAttribute('transform')) || { x: 0, y: 0 };
    nodeInfos.push({ nodeEl, x: pos.x, y: pos.y });
  });
  const minY = nodeInfos.length ? Math.min(...nodeInfos.map((n) => n.y)) : 0;
  const maxY = nodeInfos.length ? Math.max(...nodeInfos.map((n) => n.y)) : 1;
  const spanY = Math.max(1, maxY - minY);

  // 2. Pastel rounded pill styling on flowchart/state nodes
  for (const { nodeEl, x, y } of nodeInfos) {
    // Pick smallest containing cluster if nested
    let matchedClusterIdx = -1;
    let smallestArea = Infinity;
    clusterBoxes.forEach((cb, idx) => {
      if (x >= cb.x && x <= cb.x + cb.w && y >= cb.y && y <= cb.y + cb.h && cb.area < smallestArea) {
        smallestArea = cb.area;
        matchedClusterIdx = idx;
      }
    });

    let palIdx = 0;
    if (matchedClusterIdx >= 0) {
      // Map stage 0 -> blue, stage 1 & 2 -> violet, stage 3 -> emerald, etc. (matching ChatGPT multi-stage palette)
      const stageMap = [0, 1, 1, 2, 3, 4];
      palIdx = stageMap[matchedClusterIdx % stageMap.length];
    } else if (clusterBoxes.length > 0) {
      palIdx = y <= clusterBoxes[0].y ? 0 : 2;
    } else {
      const ratio = (y - minY) / spanY;
      palIdx = ratio < 0.22 ? 0 : (ratio > 0.78 ? 2 : 1);
    }

    const chosen = palette[palIdx % palette.length];
    const shape = nodeEl.querySelector('rect.label-container, rect.basic, polygon.label-container, path.label-container, rect');
    if (shape) {
      const inlineStyle = shape.getAttribute('style') || '';
      const hasUserCustomFill = /fill\s*:\s*(?!none|#fff4dd|#eaeaea|#ececff|#f9f9f9|hsl\(40)/i.test(inlineStyle);
      if (!hasUserCustomFill) {
        shape.style.fill = chosen.fill;
        shape.style.stroke = chosen.stroke;
        shape.style.strokeWidth = '1.25px';
      }
      if (shape.tagName.toLowerCase() === 'rect') {
        const curRx = Number(shape.getAttribute('rx') || 0);
        if (curRx < 10) {
          shape.setAttribute('rx', '10');
          shape.setAttribute('ry', '10');
        }
      }
    }

    nodeEl.querySelectorAll('.nodeLabel, text, span, p').forEach((t) => {
      if (!t.style.color) t.style.color = textColor;
      if (t.tagName.toLowerCase() === 'text') t.style.fill = textColor;
      t.style.fontWeight = '500';
      t.style.fontSize = '13px';
    });
  }

  // 3. Round 90-degree orthogonal ELK connector elbows & refine strokes
  svgEl.querySelectorAll('path.flowchart-link, path.transition, g.edgePaths path').forEach((p) => {
    const rawD = p.getAttribute('d') || '';
    if (rawD) {
      p.setAttribute('d', roundOrthogonalSvgPath(rawD, 6.5));
    }
    if (p.classList.contains('edge-pattern-solid')) {
      p.style.strokeDasharray = 'none';
      p.style.strokeDashoffset = '0';
    }
    const inlineStyle = p.getAttribute('style') || '';
    if (!/stroke\s*:\s*#(?!333|000|0b0b0b)/i.test(inlineStyle)) {
      p.style.stroke = lineStroke;
    }
    p.style.strokeWidth = '1.15px';
    p.style.strokeLinecap = 'round';
    p.style.strokeLinejoin = 'round';
  });

  // 4. Lightweight refined arrowheads matching connector tone
  svgEl.querySelectorAll('marker path, marker polygon, .marker').forEach((mk) => {
    mk.style.fill = lineStroke;
    mk.style.stroke = lineStroke;
  });

  // 5. Edge labels pill background
  svgEl.querySelectorAll('.edgeLabel rect, .labelBkg').forEach((bg) => {
    bg.style.fill = isDark ? '#18191e' : '#ffffff';
    bg.style.opacity = '0.92';
  });
}

export function bindPanZoomViewport(viewportEl, canvasEl, { wheelRequiresModifier = false, onScaleChange } = {}) {
  if (!viewportEl || !canvasEl) return null;
  if (viewportEl._panZoomCtrl) return viewportEl._panZoomCtrl;

  const state = { scale: 1, tx: 0, ty: 0, dragging: false, startX: 0, startY: 0 };

  const apply = () => {
    canvasEl.style.transform = `translate(${state.tx.toFixed(1)}px, ${state.ty.toFixed(1)}px) scale(${state.scale.toFixed(3)})`;
    onScaleChange?.(state.scale);
  };

  const zoomBy = (factor, originClientX = null, originClientY = null) => {
    const prevScale = state.scale;
    const nextScale = Math.min(6, Math.max(0.2, prevScale * factor));
    if (Math.abs(nextScale - prevScale) < 1e-4) return;
    if (originClientX != null && originClientY != null) {
      const rect = viewportEl.getBoundingClientRect();
      const cx = originClientX - (rect.left + rect.width / 2);
      const cy = originClientY - (rect.top + rect.height / 2);
      const ratio = nextScale / prevScale;
      state.tx = cx - (cx - state.tx) * ratio;
      state.ty = cy - (cy - state.ty) * ratio;
    }
    state.scale = nextScale;
    apply();
  };

  const reset = () => {
    state.scale = 1;
    state.tx = 0;
    state.ty = 0;
    apply();
  };

  viewportEl.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    state.dragging = true;
    state.startX = e.clientX - state.tx;
    state.startY = e.clientY - state.ty;
    viewportEl.classList.add('panning');
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!state.dragging) return;
    state.tx = e.clientX - state.startX;
    state.ty = e.clientY - state.startY;
    apply();
  });

  window.addEventListener('mouseup', () => {
    if (!state.dragging) return;
    state.dragging = false;
    viewportEl.classList.remove('panning');
  });

  viewportEl.addEventListener('wheel', (e) => {
    if (wheelRequiresModifier && !(e.ctrlKey || e.metaKey || e.altKey)) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.14 : 1 / 1.14;
    zoomBy(factor, e.clientX, e.clientY);
  }, { passive: false });

  const setTransform = (nextScale, nextTx = 0, nextTy = 0) => {
    state.scale = Math.min(6, Math.max(0.2, nextScale));
    state.tx = nextTx;
    state.ty = nextTy;
    apply();
  };

  const ctrl = { zoomBy, reset, setTransform, getScale: () => state.scale };
  viewportEl._panZoomCtrl = ctrl;
  return ctrl;
}

function configureMermaidInstance(theme, useElk = true) {
  const isDark = theme === 'dark';
  window.mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    layout: useElk ? 'elk' : 'dagre',
    look: 'classic',
    elk: {
      mergeEdges: false,
      nodePlacementStrategy: 'BRANDES_KOEPF',
      cycleBreakingStrategy: 'GREEDY',
    },
    flowchart: {
      useMaxWidth: false,
      htmlLabels: true,
      curve: 'linear',
      wrappingWidth: 260,
      padding: 11,
      nodeSpacing: 28,
      rankSpacing: 38,
      subGraphTitleMargin: { top: 10, bottom: 8 },
    },
    sequence: { useMaxWidth: false },
    class: { useMaxWidth: false },
    state: { useMaxWidth: false },
    er: { useMaxWidth: false },
    gantt: { useMaxWidth: false },
    journey: { useMaxWidth: false },
    theme: 'base',
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    themeVariables: isDark
      ? {
          darkMode: true,
          background: 'transparent',
          primaryColor: '#192b48',
          primaryTextColor: '#f1f5f9',
          primaryBorderColor: '#60a5fa',
          lineColor: '#787e8c',
          secondaryColor: '#2a1d42',
          tertiaryColor: '#1b1d22',
          mainBkg: '#192b48',
          nodeBorder: '#60a5fa',
          clusterBkg: '#1b1d22',
          clusterBorder: '#2e323b',
          titleColor: '#f1f5f9',
          edgeLabelBackground: '#18191e',
        }
      : {
          darkMode: false,
          background: 'transparent',
          primaryColor: '#dcebff',
          primaryTextColor: '#1e293b',
          primaryBorderColor: '#5b9bf8',
          lineColor: '#969ba6',
          secondaryColor: '#f2e7ff',
          tertiaryColor: '#f3f4f6',
          mainBkg: '#dcebff',
          nodeBorder: '#5b9bf8',
          clusterBkg: '#f3f4f6',
          clusterBorder: '#e5e7eb',
          titleColor: '#1e293b',
          edgeLabelBackground: '#ffffff',
        },
  });
}

async function ensureMermaid(theme) {
  if (!window.mermaid) {
    if (!mermaidLoaderPromise) {
      mermaidLoaderPromise = new Promise((resolveLoad, rejectLoad) => {
        const script = document.createElement('script');
        script.src = '/vendor/mermaid.min.js';
        script.onload = () => resolveLoad(window.mermaid);
        script.onerror = rejectLoad;
        document.head.appendChild(script);
      });
    }
    await mermaidLoaderPromise;
  }
  configureMermaidInstance(theme, true);
  return window.mermaid;
}

export function computeAdaptiveInlineMermaidSize(natW, natH, availW, viewportH = 900) {
  const safeNatW = Math.max(1, Number(natW) || 600);
  const safeNatH = Math.max(1, Number(natH) || 360);
  const safeAvailW = Math.max(180, Number(availW) || safeNatW);
  const safeViewportH = Math.max(480, Number(viewportH) || 900);

  const widthScale = safeAvailW / safeNatW;
  let scale = widthScale;

  if (widthScale > 1) {
    const maxUpscale = 2.6;
    scale = Math.min(widthScale, maxUpscale);
    if (safeNatH > safeNatW * 1.35) {
      const maxComfortH = Math.max(980, safeViewportH * 1.15);
      const heightCapScale = Math.max(1.25, maxComfortH / safeNatH);
      scale = Math.min(scale, heightCapScale);
    }
  }

  return {
    width: Math.max(120, Math.round(safeNatW * scale)),
    height: Math.max(60, Math.round(safeNatH * scale)),
    scale,
  };
}

function measureAndPrepareMermaidSvg(svgEl) {
  if (!svgEl) return { natW: 600, natH: 360 };

  let vx = 0;
  let vy = 0;
  let vw = 0;
  let vh = 0;

  const vbRaw = (svgEl.getAttribute('viewBox') || '').trim();
  if (vbRaw) {
    const parts = vbRaw.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      [vx, vy, vw, vh] = parts;
    }
  }

  if (!(vw > 0 && vh > 0)) {
    const attrW = parseFloat(svgEl.getAttribute('width') || '') || 600;
    const attrH = parseFloat(svgEl.getAttribute('height') || '') || 360;
    vw = attrW;
    vh = attrH;
    svgEl.setAttribute('viewBox', `0 0 ${vw} ${vh}`);
  }

  // Tighten viewBox if diagram generator left excessive empty horizontal/vertical margins
  try {
    if (svgEl.isConnected && typeof svgEl.getBBox === 'function') {
      const bbox = svgEl.getBBox();
      if (bbox && bbox.width > 16 && bbox.height > 16) {
        if (vw > bbox.width + 36 || vh > bbox.height + 36) {
          vx = Number((bbox.x - 10).toFixed(2));
          vy = Number((bbox.y - 10).toFixed(2));
          vw = Number((bbox.width + 20).toFixed(2));
          vh = Number((bbox.height + 20).toFixed(2));
          svgEl.setAttribute('viewBox', `${vx} ${vy} ${vw} ${vh}`);
        }
      }
    }
  } catch {
    // Ignore getBBox errors in non-rendered / hidden containers
  }

  svgEl.removeAttribute('width');
  svgEl.removeAttribute('height');
  svgEl.style.maxWidth = 'none';
  svgEl.style.maxHeight = 'none';
  svgEl.dataset.natW = String(vw);
  svgEl.dataset.natH = String(vh);
  return { natW: vw, natH: vh };
}

let mermaidResizeObserver = null;
const observedScrollContainers = new WeakMap();

export function fitInlineMermaidCard(card, { force = false } = {}) {
  if (!card) return;
  const stage = card.querySelector('.mermaid-stage');
  const svgEl = stage?.querySelector('svg');
  if (!stage || !svgEl) return;

  if (card.classList.contains('expanded-width')) {
    const scrollEl = card.closest('.reader-scroll');
    const parentEl = card.parentElement;
    if (scrollEl && parentEl && scrollEl.clientWidth > 0) {
      const scrollRect = scrollEl.getBoundingClientRect();
      const parentRect = parentEl.getBoundingClientRect();
      const fullW = Math.max(parentRect.width, scrollEl.clientWidth - 40);
      const fullLeft = scrollRect.left + 20;
      card.style.width = `${Math.round(fullW)}px`;
      card.style.marginLeft = `${Math.round(fullLeft - parentRect.left)}px`;
    }
  } else if (card.style.width || card.style.marginLeft) {
    card.style.width = '';
    card.style.marginLeft = '';
  }

  const stageW = stage.clientWidth;
  if (stageW <= 0) return;
  const availW = Math.max(180, stageW - 28);
  if (!force && Math.abs(availW - (card._lastAvailW || 0)) < 2) return;
  card._lastAvailW = availW;

  const natW = Number(svgEl.dataset.natW) || 600;
  const natH = Number(svgEl.dataset.natH) || 360;
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 900;
  const { width, height } = computeAdaptiveInlineMermaidSize(natW, natH, availW, viewportH);

  svgEl.style.width = `${width}px`;
  svgEl.style.height = `${height}px`;
  stage.style.alignItems = height > 1360 ? 'flex-start' : 'center';
}

function observeMermaidCardResize(card) {
  if (typeof ResizeObserver === 'undefined' || !card) return;
  const stage = card.querySelector('.mermaid-stage');
  if (!stage) return;

  if (!mermaidResizeObserver) {
    mermaidResizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const target = entry.target;
        if (target.classList?.contains('mermaid-stage')) {
          const ownerCard = target.closest('.mermaid-card');
          if (ownerCard) fitInlineMermaidCard(ownerCard);
        } else {
          const cards = observedScrollContainers.get(target);
          if (cards) {
            cards.forEach((c) => {
              if (!c.isConnected) cards.delete(c);
              else if (c.classList.contains('expanded-width')) fitInlineMermaidCard(c, { force: true });
            });
          }
        }
      }
    });
  }

  mermaidResizeObserver.observe(stage);
  const scrollEl = card.closest('.reader-scroll');
  if (scrollEl) {
    let set = observedScrollContainers.get(scrollEl);
    if (!set) {
      set = new Set();
      observedScrollContainers.set(scrollEl, set);
      mermaidResizeObserver.observe(scrollEl);
    }
    set.add(card);
  }
}

async function renderSingleMermaidCard(card, theme) {
  const src = card.dataset.mermaidSrc || '';
  const stage = card.querySelector('.mermaid-stage');
  let canvas = stage?.querySelector('.mermaid-panzoom-canvas');
  if (!stage || !src) return;
  if (!canvas) {
    canvas = document.createElement('div');
    canvas.className = 'mermaid-panzoom-canvas';
    stage.innerHTML = '';
    stage.appendChild(canvas);
  }

  const mermaid = await ensureMermaid(theme);
  try {
    let rendered;
    try {
      configureMermaidInstance(theme, true);
      rendered = await mermaid.render(`mmd_${++mermaidCounter}`, src);
    } catch {
      // Seamless fallback to standard layout for specialized diagrams (e.g. gantt / timeline)
      configureMermaidInstance(theme, false);
      rendered = await mermaid.render(`mmd_${++mermaidCounter}`, src);
    }
    canvas.innerHTML = rendered.svg;
    const svgEl = canvas.querySelector('svg');
    polishMermaidSvgToGptStyle(svgEl, theme === 'dark');
    measureAndPrepareMermaidSvg(svgEl);
    fitInlineMermaidCard(card, { force: true });
    observeMermaidCardResize(card);
    card.dataset.mermaidRendered = 'true';
    card.dataset.mermaidTheme = theme;

    const zoomLabel = card.querySelector('[data-zoom-label]');
    bindPanZoomViewport(stage, canvas, {
      wheelRequiresModifier: true,
      onScaleChange: (s) => {
        if (zoomLabel) zoomLabel.textContent = `${Math.round(s * 100)}%`;
      },
    });
  } catch (err) {
    canvas.innerHTML = `<pre class="tool-pre">${escapeHtml(src)}\n\n[Mermaid error: ${escapeHtml(err.message || String(err))}]</pre>`;
    card.dataset.mermaidRendered = 'true';
    card.dataset.mermaidTheme = theme;
  }
}

export function rethemeMermaidDiagrams(theme = 'light') {
  const cards = document.querySelectorAll('.mermaid-card[data-mermaid-rendered="true"]');
  cards.forEach((card) => {
    if (card.dataset.mermaidTheme !== theme) {
      renderSingleMermaidCard(card, theme).catch(() => {});
    }
  });
}

export function enhanceMarkdownDom(container, theme = 'light') {
  if (!container) return;

  if (window.hljs) {
    container.querySelectorAll('pre code:not([data-highlighted="yes"])').forEach((el) => {
      try {
        window.hljs.highlightElement(el);
        el.dataset.highlighted = 'yes';
      } catch {
        // Ignore unknown language fallback
      }
    });
  }

  const mermaidCards = container.querySelectorAll('.mermaid-card');
  if (mermaidCards.length > 0) {
    (async () => {
      for (const card of mermaidCards) {
        if (card.dataset.mermaidRendered === 'true' && card.dataset.mermaidTheme === theme) continue;
        await renderSingleMermaidCard(card, theme);
      }
    })().catch(() => {});
  }

  relayoutMarkdownTables(container, { force: true });
}

export function downloadSvgElement(svgEl, filename = 'mermaid-diagram.svg') {
  if (!svgEl) return;
  const clone = svgEl.cloneNode(true);
  if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${clone.outerHTML}`;
  const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function attachCodeCardInteractions(root, { onOpenLocalLink, onOpenConversation, onZoomImage, onFullscreenMermaid } = {}) {
  if (!root || root.dataset.mdInteractionsBound === 'true') return;
  root.dataset.mdInteractionsBound = 'true';

  const handleLocalTrigger = (e) => {
    const convEl = e.target.closest('[data-open-conv]');
    if (convEl) {
      e.preventDefault();
      e.stopPropagation();
      if (e.type === 'dblclick') return true;
      onOpenConversation?.(convEl.dataset.openConv);
      return true;
    }

    const localEl = e.target.closest('[data-local-href]');
    if (localEl) {
      e.preventDefault();
      e.stopPropagation();
      if (e.type === 'dblclick') return true;
      const rawHref = localEl.dataset.localHref || '';
      const baseDir = localEl.dataset.baseDir || '';
      const mode = localEl.dataset.previewMode || 'popup';
      onOpenLocalLink?.(rawHref, baseDir, mode);
      return true;
    }
    const anchorEl = e.target.closest('a[data-anchor-link="true"]');
    if (anchorEl) {
      e.preventDefault();
      if (e.type === 'dblclick') return true;
      const hash = anchorEl.getAttribute('href')?.slice(1) || '';
      if (hash) {
        const decoded = decodeURIComponent(hash);
        const target = root.querySelector(`#${CSS.escape(decoded)}`) || root.querySelector(`#${CSS.escape(slugifyHeading(decoded))}`);
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return true;
    }
    return false;
  };

  root.addEventListener('dblclick', (e) => {
    if (handleLocalTrigger(e)) return;
    const mmdStage = e.target.closest('.mermaid-stage');
    if (mmdStage && onFullscreenMermaid) {
      const svg = mmdStage.querySelector('svg');
      if (svg) onFullscreenMermaid(svg);
    }
  });

  root.addEventListener('click', async (e) => {
    if (handleLocalTrigger(e)) return;

    const zoomImg = e.target.closest('img[data-zoomable="true"]');
    if (zoomImg && onZoomImage) {
      onZoomImage(zoomImg.src, zoomImg.alt || '');
      return;
    }

    const btn = e.target.closest('.code-mini-btn');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'toggle-cell-fold') {
      toggleCellFold(btn);
      return;
    }

    if (action === 'toggle-table-expand') {
      const tableCard = btn.closest('.table-card');
      if (!tableCard) return;
      const globalExpanded = document.documentElement.getAttribute('data-tables') === 'expand';
      if (globalExpanded && !tableCard.dataset.localOverride) {
        tableCard.dataset.localOverride = 'compact';
        tableCard.classList.remove('expanded');
        tableCard.classList.add('force-compact');
        btn.textContent = t('tableExpandBtn');
      } else {
        tableCard.classList.remove('force-compact');
        delete tableCard.dataset.localOverride;
        const expanded = tableCard.classList.toggle('expanded');
        btn.textContent = expanded ? t('tableFitBtn') : t('tableExpandBtn');
      }
      relayoutMarkdownTables(tableCard, { force: true });
      return;
    }

    const card = btn.closest('.code-card, .mermaid-card');
    if (!card) return;

    if (action === 'mmd-zoom-in' || action === 'mmd-zoom-out' || action === 'mmd-zoom-reset') {
      const stage = card.querySelector('.mermaid-stage');
      const ctrl = stage?._panZoomCtrl;
      if (!ctrl) return;
      if (action === 'mmd-zoom-reset') {
        fitInlineMermaidCard(card, { force: true });
        ctrl.reset();
      } else {
        ctrl.zoomBy(action === 'mmd-zoom-in' ? 1.25 : 0.8);
      }
      return;
    }

    if (action === 'mmd-toggle-wide') {
      const expanded = card.classList.toggle('expanded-width');
      btn.textContent = expanded ? t('mmdCompactBtn') : t('mmdWideBtn');
      fitInlineMermaidCard(card, { force: true });
      card.querySelector('.mermaid-stage')?._panZoomCtrl?.reset();
      return;
    }

    if (action === 'mmd-fullscreen') {
      const svg = card.querySelector('.mermaid-stage svg');
      if (svg && onFullscreenMermaid) onFullscreenMermaid(svg);
      return;
    }

    if (action === 'mmd-download-svg') {
      const svg = card.querySelector('.mermaid-stage svg');
      if (svg) downloadSvgElement(svg, `${card.dataset.mermaidId || 'mermaid'}.svg`);
      return;
    }

    if (action === 'toggle-wrap') {
      const wrapped = card.classList.toggle('wrapped');
      btn.textContent = wrapped ? t('unwrapBtn') : t('wrapBtn');
      return;
    }

    if (action === 'copy-code' || action === 'copy-raw') {
      const text = action === 'copy-raw'
        ? (card.dataset.mermaidSrc || '')
        : (card.querySelector('pre code')?.textContent || '');
      try {
        await navigator.clipboard.writeText(text);
        const orig = btn.textContent;
        btn.textContent = t('copiedBtn');
        setTimeout(() => { btn.textContent = orig; }, 1400);
      } catch {
        // Clipboard denied fallback
      }
    }
  });
}
