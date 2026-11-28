/**
 * Two-stage compact table column widths for Tables: Fit.
 * Stage 1 picks a convex balance of wrapping and leftover space.
 * Stage 2 drops width that does not add lines, then spends leftover
 * pane width on the columns that are keeping a row tall.
 * Cells that still wrap past the fold threshold are marked for the reader.
 */

import { t } from './i18n.js';

const CJK_CLOSING_PUNCTUATION = new Set([
  '，', '。', '！', '？', '；', '：', '、', '）', '》', '」', '』', '】',
  '〉', '〕', '〗', '”', '’', '—', '…', '·', '.', ',', '!', '?', ';', ':', ')', ']', '}',
]);

function isCjkOrFullwidthCodePoint(cp) {
  return (
    (cp >= 0x2e80 && cp <= 0x9fff) ||
    (cp >= 0xac00 && cp <= 0xd7af) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xffef) ||
    (cp >= 0x3000 && cp <= 0x30ff) ||
    (cp >= 0x20000 && cp <= 0x2fa1f)
  );
}

export function defaultHeuristicMeasureText(text, fontSize) {
  let emUnits = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp <= 0x20) emUnits += 0.28;
    else if ("ilI1|.,:;'`!()[]{}".includes(ch)) emUnits += 0.32;
    else if ('mwMW@%#&'.includes(ch)) emUnits += 0.82;
    else if (cp >= 0x30 && cp <= 0x39) emUnits += 0.58;
    else if (cp < 0x0080) emUnits += 0.56;
    else if (isCjkOrFullwidthCodePoint(cp)) emUnits += 1.0;
    else if (cp > 0xffff) emUnits += 1.15;
    else emUnits += 0.68;
  }
  return emUnits * fontSize * 1.03;
}

function tokenizeParagraph(line, fontSize, measure) {
  const tokens = [];
  const spaceWidth = measure(' ', fontSize);
  let asciiBuffer = '';
  let pendingSpace = false;

  const flushAscii = () => {
    if (!asciiBuffer) return;
    tokens.push({
      width: measure(asciiBuffer, fontSize),
      spaceBefore: tokens.length > 0 && pendingSpace ? spaceWidth : 0,
    });
    asciiBuffer = '';
    pendingSpace = false;
  };

  for (const ch of line) {
    const cp = ch.codePointAt(0) ?? 0;
    if (/\s/.test(ch)) {
      flushAscii();
      if (tokens.length > 0) pendingSpace = true;
      continue;
    }
    if (CJK_CLOSING_PUNCTUATION.has(ch) && !asciiBuffer && tokens.length > 0 && !pendingSpace) {
      tokens[tokens.length - 1].width += measure(ch, fontSize);
      continue;
    }
    if (isCjkOrFullwidthCodePoint(cp) || cp > 0xffff) {
      flushAscii();
      tokens.push({
        width: measure(ch, fontSize),
        spaceBefore: tokens.length > 0 && pendingSpace ? spaceWidth : 0,
      });
      pendingSpace = false;
      continue;
    }
    if (ch === '-' || ch === '/') {
      asciiBuffer += ch;
      flushAscii();
      continue;
    }
    asciiBuffer += ch;
  }
  flushAscii();

  let naturalWidth = 0;
  let maxTokenWidth = 0;
  for (const token of tokens) {
    naturalWidth += token.spaceBefore + token.width;
    if (token.width > maxTokenWidth) maxTokenWidth = token.width;
  }
  return { tokens, naturalWidth, maxTokenWidth };
}

function parseCell(input, defaultIsHeader, fontSize, measure) {
  const rawText = typeof input === 'string' ? input : (input?.text ?? '');
  const isHeader = typeof input === 'object' && input !== null && input.isHeader !== undefined
    ? Boolean(input.isHeader)
    : defaultIsHeader;
  const paragraphs = [];
  let naturalWidth = 0;
  let minWordWidth = 0;
  for (const line of String(rawText).split(/\r?\n/)) {
    const para = tokenizeParagraph(line, fontSize, measure);
    paragraphs.push(para);
    if (para.naturalWidth > naturalWidth) naturalWidth = para.naturalWidth;
    if (para.maxTokenWidth > minWordWidth) minWordWidth = para.maxTokenWidth;
  }
  return { paragraphs, naturalWidth, minWordWidth, isHeader };
}

function countParagraphLines(para, colWidth) {
  const { tokens } = para;
  if (tokens.length === 0) return 1;
  if (para.naturalWidth <= colWidth + 1e-3) return 1;

  let lines = 1;
  let currentLineWidth = 0;
  for (const tok of tokens) {
    if (tok.width > colWidth + 1e-3) {
      if (currentLineWidth > 0) {
        lines += 1;
        currentLineWidth = 0;
      }
      const fullChunks = Math.floor(tok.width / colWidth);
      const remainder = tok.width - fullChunks * colWidth;
      if (remainder > 1e-3) {
        lines += fullChunks;
        currentLineWidth = remainder;
      } else {
        lines += Math.max(0, fullChunks - 1);
        currentLineWidth = colWidth;
      }
      continue;
    }
    const gap = currentLineWidth === 0 ? 0 : tok.spaceBefore;
    if (currentLineWidth + gap + tok.width <= colWidth + 1e-3) {
      currentLineWidth += gap + tok.width;
    } else {
      lines += 1;
      currentLineWidth = tok.width;
    }
  }
  return lines;
}

function countCellLines(cell, colWidth) {
  let totalLines = 0;
  for (const para of cell.paragraphs) totalLines += countParagraphLines(para, colWidth);
  return Math.max(1, totalLines);
}

function buildColumnModel(cells, minColContentWidth, maxUnbreakableWordWidth, alphaPerPx, headerWrapPenalty) {
  let rawMinWord = minColContentWidth;
  let maxNatural = minColContentWidth;
  for (const cell of cells) {
    const cappedWord = Math.min(cell.minWordWidth, maxUnbreakableWordWidth);
    if (cappedWord > rawMinWord) rawMinWord = cappedWord;
    if (cell.naturalWidth > maxNatural) maxNatural = cell.naturalWidth;
  }

  const minWidth = Math.ceil(rawMinWord * 2) / 2;
  const maxWidth = Math.max(minWidth, Math.ceil(maxNatural * 2) / 2);
  const samples = [];
  let baseWasteSlope = 0;

  for (const cell of cells) {
    const wrapWeight = cell.isHeader ? headerWrapPenalty : 1;
    for (const para of cell.paragraphs) {
      const length = Math.min(maxWidth, para.naturalWidth);
      if (length <= minWidth + 1e-4) baseWasteSlope += alphaPerPx;
      else samples.push({ width: length, wrapLoad: wrapWeight * length, wasteSlope: alphaPerPx });
    }
  }

  if (samples.length === 0 || maxWidth <= minWidth + 1e-4) {
    return { minWidth, maxWidth: minWidth, baseWasteSlope, initialWrapLoad: 0, breakpoints: [] };
  }

  samples.sort((a, b) => a.width - b.width);
  const grouped = [];
  for (const sample of samples) {
    const last = grouped[grouped.length - 1];
    if (last && Math.abs(sample.width - last.width) <= 1e-3) {
      last.deltaWaste += sample.wasteSlope;
      last.deltaWrapLoad += sample.wrapLoad;
    } else {
      grouped.push({ width: sample.width, deltaWaste: sample.wasteSlope, deltaWrapLoad: sample.wrapLoad });
    }
  }

  let totalWrapLoad = 0;
  for (const group of grouped) totalWrapLoad += group.deltaWrapLoad;

  const breakpoints = [];
  let runningWaste = baseWasteSlope;
  let remainingWrap = totalWrapLoad;
  for (const group of grouped) {
    runningWaste += group.deltaWaste;
    remainingWrap = Math.max(0, remainingWrap - group.deltaWrapLoad);
    breakpoints.push({
      width: group.width,
      activeWasteSlope: runningWaste,
      remainingWrapLoad: remainingWrap,
    });
  }

  return {
    minWidth,
    maxWidth: grouped[grouped.length - 1].width,
    baseWasteSlope,
    initialWrapLoad: totalWrapLoad,
    breakpoints,
  };
}

function solveSingleColumnWidth(model, mu) {
  const { minWidth, maxWidth, baseWasteSlope, initialWrapLoad, breakpoints } = model;
  if (breakpoints.length === 0 || maxWidth <= minWidth) return minWidth;

  const getInterval = (index) => {
    const leftU = index === 0 ? minWidth : breakpoints[index - 1].width;
    const rightU = breakpoints[index].width;
    const slopeA = (index === 0 ? baseWasteSlope : breakpoints[index - 1].activeWasteSlope) + mu;
    const loadB = index === 0 ? initialWrapLoad : breakpoints[index - 1].remainingWrapLoad;
    return { leftU, rightU, slopeA, loadB };
  };

  const first = getInterval(0);
  const firstDenom = Math.max(first.leftU * first.leftU, 1e-6);
  if (first.slopeA - first.loadB / firstDenom >= 0) return minWidth;

  const lastIdx = breakpoints.length - 1;
  const last = getInterval(lastIdx);
  if (last.slopeA - last.loadB / Math.max(last.rightU * last.rightU, 1e-6) <= 0) return maxWidth;

  let low = 0;
  let high = lastIdx;
  while (low < high) {
    const mid = (low + high) >> 1;
    const interval = getInterval(mid);
    const leftDerivAtRightEnd = interval.slopeA - interval.loadB / Math.max(interval.rightU * interval.rightU, 1e-6);
    if (leftDerivAtRightEnd >= 0) high = mid;
    else low = mid + 1;
  }

  const target = getInterval(low);
  const rightDerivAtLeftEnd = target.slopeA - target.loadB / Math.max(target.leftU * target.leftU, 1e-6);
  if (rightDerivAtLeftEnd >= 0) return target.leftU;
  if (!(target.slopeA > 0)) return target.rightU;
  const smoothRoot = Math.sqrt(target.loadB / target.slopeA);
  return Math.min(target.rightU, Math.max(target.leftU, smoothRoot));
}

export function optimizeTableColumnWidths(rows, options = {}) {
  const numRows = rows?.length || 0;
  const numCols = (rows || []).reduce((max, row) => Math.max(max, row?.length || 0), 0);
  if (numRows === 0 || numCols === 0) {
    return {
      columnBorderBoxWidths: [],
      columnContentWidths: [],
      totalTableWidth: 0,
      estimatedRowLineCounts: [],
      estimatedTotalHeight: 0,
      requiresHorizontalScroll: false,
      outlierCells: [],
    };
  }

  const fontSize = options.fontSize ?? 14;
  const lineHeight = options.lineHeight ?? Math.round(fontSize * 1.55);
  const cellPadding = options.cellHorizontalPadding ?? 16;
  const minColContentWidth = options.minColContentWidth ?? 32;
  const maxUnbreakableWordWidth = options.maxUnbreakableWordWidth ?? Math.max(minColContentWidth, fontSize * 4);
  const compactness = options.compactness ?? 0.12;
  const headerRowCount = options.headerRowCount ?? 1;
  const headerWrapPenalty = options.headerWrapPenalty ?? 2.5;
  const foldLineThreshold = options.foldLineThreshold ?? 5;
  const measure = options.measureText ?? defaultHeuristicMeasureText;
  const alphaPerPx = compactness / Math.max(1, lineHeight);

  const grid = Array.from({ length: numRows }, (_, r) => (
    Array.from({ length: numCols }, (__, c) => (
      parseCell(rows[r]?.[c], r < headerRowCount, fontSize, measure)
    ))
  ));

  const colModels = Array.from({ length: numCols }, (_, c) => (
    buildColumnModel(
      grid.map((row) => row[c]),
      minColContentWidth,
      maxUnbreakableWordWidth,
      alphaPerPx,
      headerWrapPenalty,
    )
  ));

  const totalPadding = numCols * cellPadding;
  const sumMinContentWidths = colModels.reduce((acc, model) => acc + model.minWidth, 0);
  const rawContentBudget = options.maxTableWidth - totalPadding;
  const requiresHorizontalScroll = sumMinContentWidths > rawContentBudget + 1e-3;
  const effectiveContentBudget = Math.max(sumMinContentWidths, rawContentBudget);

  const colWidths = colModels.map((model) => solveSingleColumnWidth(model, 0));
  const unconstrainedSum = colWidths.reduce((acc, width) => acc + width, 0);

  if (unconstrainedSum > effectiveContentBudget + 1e-2) {
    let muLow = 0;
    let muHigh = 1;
    for (const model of colModels) {
      const bound = model.initialWrapLoad / Math.max(1, model.minWidth * model.minWidth) + 1;
      if (bound > muHigh) muHigh = bound;
    }
    for (let iter = 0; iter < 36; iter += 1) {
      const muMid = 0.5 * (muLow + muHigh);
      let currentSum = 0;
      for (let c = 0; c < numCols; c += 1) currentSum += solveSingleColumnWidth(colModels[c], muMid);
      if (currentSum > effectiveContentBudget) muLow = muMid;
      else muHigh = muMid;
    }
    for (let c = 0; c < numCols; c += 1) colWidths[c] = solveSingleColumnWidth(colModels[c], muHigh);
  }

  const cellLines = Array.from({ length: numRows }, () => new Array(numCols).fill(1));
  const rowHeights = new Array(numRows).fill(1);
  const recomputeAllHeights = () => {
    for (let r = 0; r < numRows; r += 1) {
      let maxH = 1;
      for (let c = 0; c < numCols; c += 1) {
        const height = countCellLines(grid[r][c], colWidths[c]);
        cellLines[r][c] = height;
        if (height > maxH) maxH = height;
      }
      rowHeights[r] = maxH;
    }
  };
  recomputeAllHeights();
  const lineCeiling = cellLines.map((row) => row.slice());

  for (let c = 0; c < numCols; c += 1) {
    let low = colModels[c].minWidth;
    let high = colWidths[c];
    if (high - low <= 0.5) continue;
    // Only drop width that does not add a wrap in this column. A tall
    // neighbor must not let a short column collapse down to that row height.
    const canKeepRowHeights = (testWidth) => {
      for (let r = 0; r < numRows; r += 1) {
        if (countCellLines(grid[r][c], testWidth) > lineCeiling[r][c]) return false;
      }
      return true;
    };
    if (canKeepRowHeights(low)) colWidths[c] = low;
    else {
      for (let iter = 0; iter < 14; iter += 1) {
        const mid = 0.5 * (low + high);
        if (canKeepRowHeights(mid)) high = mid;
        else low = mid;
      }
      colWidths[c] = high;
    }
  }
  recomputeAllHeights();

  let currentContentSum = colWidths.reduce((acc, width) => acc + width, 0);
  const maxRefinementSteps = Math.min(64, numRows * 4);
  for (let step = 0; step < maxRefinementSteps; step += 1) {
    const remainingBudget = effectiveContentBudget - currentContentSum;
    if (remainingBudget <= 1) break;

    let bestRow = -1;
    let bestEfficiency = 0;
    let bestUpdates = [];
    let bestDeltaW = 0;

    for (let r = 0; r < numRows; r += 1) {
      const targetLines = rowHeights[r] - 1;
      if (targetLines < 1) continue;
      const updates = [];
      let possible = true;
      let deltaW = 0;
      for (let c = 0; c < numCols; c += 1) {
        if (cellLines[r][c] < rowHeights[r]) continue;
        const maxColW = colModels[c].maxWidth;
        if (countCellLines(grid[r][c], maxColW) > targetLines) {
          possible = false;
          break;
        }
        let low = colWidths[c];
        let high = maxColW;
        for (let iter = 0; iter < 12; iter += 1) {
          const mid = 0.5 * (low + high);
          if (countCellLines(grid[r][c], mid) <= targetLines) high = mid;
          else low = mid;
        }
        const needed = high - colWidths[c];
        deltaW += needed;
        if (deltaW > remainingBudget) {
          possible = false;
          break;
        }
        updates.push({ col: c, nextWidth: high });
      }
      if (!possible || updates.length === 0 || deltaW <= 0) continue;

      const rowGain = r < headerRowCount ? headerWrapPenalty : 1;
      let extraWasteCost = 0;
      for (const update of updates) {
        for (let rr = 0; rr < numRows; rr += 1) {
          const natural = grid[rr][update.col].naturalWidth;
          if (natural < update.nextWidth) {
            const addedBlank = update.nextWidth - Math.max(colWidths[update.col], natural);
            if (addedBlank > 0) extraWasteCost += alphaPerPx * addedBlank;
          }
        }
      }
      const netBenefit = rowGain - extraWasteCost;
      if (netBenefit > 0) {
        const efficiency = netBenefit / deltaW;
        if (efficiency > bestEfficiency) {
          bestEfficiency = efficiency;
          bestRow = r;
          bestUpdates = updates;
          bestDeltaW = deltaW;
        }
      }
    }

    if (bestRow === -1) break;
    for (const update of bestUpdates) colWidths[update.col] = update.nextWidth;
    currentContentSum += bestDeltaW;
    recomputeAllHeights();
  }

  // Leftover pane width goes to columns that are still wrapping, up to the
  // text's own width. Columns that already fit on one line are not padded.
  let leftover = effectiveContentBudget - colWidths.reduce((acc, width) => acc + width, 0);
  for (let guard = 0; guard < numCols && leftover > 1; guard += 1) {
    let bestCol = -1;
    let bestLines = 1;
    for (let c = 0; c < numCols; c += 1) {
      if (colModels[c].maxWidth - colWidths[c] <= 1) continue;
      let lines = 1;
      for (let r = 0; r < numRows; r += 1) {
        if (cellLines[r][c] > lines) lines = cellLines[r][c];
      }
      if (lines > bestLines) {
        bestLines = lines;
        bestCol = c;
      }
    }
    if (bestCol === -1) break;
    const add = Math.min(leftover, colModels[bestCol].maxWidth - colWidths[bestCol]);
    colWidths[bestCol] += add;
    leftover -= add;
    recomputeAllHeights();
  }

  const columnContentWidths = colWidths.map((width) => Math.round(width * 10) / 10);
  const columnBorderBoxWidths = columnContentWidths.map((width) => Math.round((width + cellPadding) * 10) / 10);
  const totalTableWidth = Math.round(columnBorderBoxWidths.reduce((acc, width) => acc + width, 0) * 10) / 10;
  const outlierCells = [];
  for (let r = 0; r < numRows; r += 1) {
    for (let c = 0; c < numCols; c += 1) {
      if (cellLines[r][c] > foldLineThreshold) {
        outlierCells.push({
          row: r,
          col: c,
          lineCount: cellLines[r][c],
          naturalWidth: Math.round(grid[r][c].naturalWidth),
        });
      }
    }
  }
  const totalLines = rowHeights.reduce((acc, height) => acc + height, 0);
  return {
    columnBorderBoxWidths,
    columnContentWidths,
    totalTableWidth,
    estimatedRowLineCounts: rowHeights.slice(),
    estimatedTotalHeight: totalLines * lineHeight,
    requiresHorizontalScroll,
    outlierCells,
  };
}

function cardWantsFit(card) {
  const globalExpand = document.documentElement.getAttribute('data-tables') === 'expand';
  if (card.classList.contains('expanded')) return false;
  if (card.classList.contains('force-compact')) return true;
  return !globalExpand;
}

function plainCellText(cell) {
  let out = '';
  const walk = (node) => {
    if (node.nodeType === 3) {
      out += node.textContent;
      return;
    }
    if (node.nodeType !== 1) return;
    if (node.classList?.contains('cell-fold-btn')) return;
    if (node.tagName === 'BR') {
      out += '\n';
      return;
    }
    for (const child of node.childNodes) walk(child);
  };
  walk(cell);
  return out.replace(/\u00a0/g, ' ').trim();
}

function clearFitChrome(card) {
  card.classList.remove('cols-optimized');
  card.style.removeProperty('--table-opt-width');
  card.querySelector('colgroup[data-optimized]')?.remove();
  const table = card.querySelector('table');
  if (table) table.style.width = '';
  card.querySelectorAll('.cell-fold-btn').forEach((button) => button.remove());
  card.querySelectorAll('.cell-fold').forEach((fold) => {
    const parent = fold.parentElement;
    if (!parent) return;
    while (fold.firstChild) parent.insertBefore(fold.firstChild, fold);
    fold.remove();
    parent.classList.remove('has-cell-fold');
  });
}

function readMatrix(table) {
  return [...table.rows].map((row) => [...row.cells].map((cell) => ({
    text: plainCellText(cell),
    isHeader: cell.tagName === 'TH',
    foldOpen: cell.dataset.foldOpen === '1',
  })));
}

function measureTable(table) {
  const sample = table.querySelector('td, th') || table;
  const style = getComputedStyle(sample);
  const fontSize = parseFloat(style.fontSize) || 14;
  const fontFamily = style.fontFamily || 'sans-serif';
  const fontWeight = style.fontWeight || '400';
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const cache = new Map();
  const measureText = (text, size) => {
    const key = `${size}:${text}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    ctx.font = `${fontWeight} ${size}px ${fontFamily}`;
    const width = (ctx?.measureText(text).width || defaultHeuristicMeasureText(text, size)) * 1.015;
    if (cache.size > 8192) cache.clear();
    cache.set(key, width);
    return width;
  };
  const parsedLine = parseFloat(style.lineHeight);
  const lineHeight = Number.isFinite(parsedLine) ? parsedLine : Math.round(fontSize * 1.55);
  const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
  const border = (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.borderRightWidth) || 0);
  return {
    measureText,
    fontSize,
    lineHeight,
    cellHorizontalPadding: Math.max(8, Math.round(padding + border)),
  };
}

function applyOutlierFolds(table, outlierCells, matrix) {
  const rows = [...table.rows];
  for (const hint of outlierCells) {
    const cell = rows[hint.row]?.cells[hint.col];
    const source = matrix[hint.row]?.[hint.col];
    if (!cell || !source) continue;
    const fold = document.createElement('div');
    fold.className = source.foldOpen ? 'cell-fold' : 'cell-fold is-clamped';
    while (cell.firstChild) fold.appendChild(cell.firstChild);
    cell.appendChild(fold);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'code-mini-btn cell-fold-btn';
    button.dataset.action = 'toggle-cell-fold';
    button.textContent = source.foldOpen ? t('cellFoldLess') : t('cellFoldMore');
    cell.appendChild(button);
    cell.classList.add('has-cell-fold');
  }
}

function layoutTableCard(card, force) {
  if (!card || card._fitting) return;
  const table = card.querySelector('table');
  const wrap = card.querySelector('.table-wrap') || card;
  if (!table) return;
  watchTableWrap(wrap, card);
  if (!cardWantsFit(card)) {
    clearFitChrome(card);
    card._fitAppliedWidth = 0;
    return;
  }
  const paneWidth = wrap.clientWidth;
  if (paneWidth < 48) return;
  if (!force && card.classList.contains('cols-optimized')) {
    const previous = card._fitAppliedWidth || 0;
    if (Math.abs(previous - paneWidth) < 2) return;
    if (card.classList.contains('needs-h-scroll') && paneWidth < previous && previous - paneWidth < 24) return;
  }

  card._fitting = true;
  try {
    const matrix = readMatrix(table);
    const rows = matrix.map((row) => row.map((cell) => ({ text: cell.text, isHeader: cell.isHeader })));
    if (rows.length === 0 || rows[0].length === 0) return;
    clearFitChrome(card);
    const measured = measureTable(table);
    const layout = optimizeTableColumnWidths(rows, {
      maxTableWidth: paneWidth,
      fontSize: measured.fontSize,
      lineHeight: measured.lineHeight,
      cellHorizontalPadding: measured.cellHorizontalPadding,
      measureText: measured.measureText,
    });
    if (!layout.columnBorderBoxWidths.length) return;

    const colgroup = document.createElement('colgroup');
    colgroup.dataset.optimized = '1';
    for (const width of layout.columnBorderBoxWidths) {
      const col = document.createElement('col');
      col.style.width = `${width}px`;
      colgroup.appendChild(col);
    }
    table.prepend(colgroup);
    table.style.width = `${layout.totalTableWidth}px`;
    card.style.setProperty('--table-opt-width', `${layout.totalTableWidth}px`);
    card.classList.add('cols-optimized');
    if (layout.requiresHorizontalScroll) card.classList.add('needs-h-scroll');
    else card.classList.remove('needs-h-scroll');
    applyOutlierFolds(table, layout.outlierCells, matrix);
    card._fitAppliedWidth = paneWidth;
    window.requestAnimationFrame(() => {
      if (!card.isConnected) return;
      card.querySelectorAll('.has-cell-fold').forEach((cell) => {
        const fold = cell.querySelector('.cell-fold');
        if (!fold?.classList.contains('is-clamped')) return;
        if (fold.scrollHeight <= fold.clientHeight + 2) {
          while (fold.firstChild) cell.insertBefore(fold.firstChild, fold);
          fold.remove();
          cell.querySelector('.cell-fold-btn')?.remove();
          cell.classList.remove('has-cell-fold');
        }
      });
    });
  } finally {
    card._fitting = false;
  }
}

function watchTableWrap(wrap, card) {
  if (wrap._fitObserver || typeof ResizeObserver === 'undefined') return;
  let timer = 0;
  const observer = new ResizeObserver(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => layoutTableCard(card, false), 60);
  });
  observer.observe(wrap);
  wrap._fitObserver = observer;
}

export function relayoutMarkdownTables(root, { force = false } = {}) {
  if (typeof document === 'undefined' || !root?.querySelectorAll) {
    if (root?.classList?.contains('table-card')) layoutTableCard(root, force);
    return;
  }
  const cards = root.classList?.contains('table-card')
    ? [root]
    : root.querySelectorAll('.table-card');
  for (const card of cards) layoutTableCard(card, force);
}

export function toggleCellFold(button) {
  const cell = button?.closest?.('td, th');
  const fold = cell?.querySelector('.cell-fold');
  if (!cell || !fold) return;
  const willOpen = fold.classList.contains('is-clamped');
  fold.classList.toggle('is-clamped', !willOpen);
  cell.dataset.foldOpen = willOpen ? '1' : '0';
  button.textContent = willOpen ? t('cellFoldLess') : t('cellFoldMore');
}
