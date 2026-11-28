import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDefaultDocsDataDir } from './custom-preview.mjs';

const ID_RE = /^st-[a-zA-Z0-9_-]{6,80}$/;
const MAX_RECORD_BYTES = 8 * 1024 * 1024;

function previewText(turn) {
  const request = String(turn?.user?.request || turn?.scheduleLabel || '').replace(/\s+/g, ' ').trim();
  return request.slice(0, 180);
}

function cleanTurn(turn) {
  if (!turn || typeof turn !== 'object' || Array.isArray(turn)) {
    throw new Error('turn is required');
  }
  let cloned;
  try {
    cloned = JSON.parse(JSON.stringify(turn));
  } catch {
    throw new Error('turn could not be saved');
  }
  if (!Array.isArray(cloned.items)) cloned.items = [];
  return cloned;
}

export class SavedTurnStore {
  constructor({ dir = join(getDefaultDocsDataDir(), 'saved-turns') } = {}) {
    this.dir = dir || '';
    this.indexPath = this.dir ? join(this.dir, 'index.json') : '';
    this.itemsDir = this.dir ? join(this.dir, 'items') : '';
  }

  list() {
    const index = this.#readIndex();
    return index.map((item) => ({ ...item }));
  }

  get(id) {
    const safeId = this.#assertId(id);
    const path = join(this.itemsDir, `${safeId}.json`);
    if (!existsSync(path)) return null;
    try {
      const record = JSON.parse(readFileSync(path, 'utf-8'));
      if (!record || record.id !== safeId || !record.turn) return null;
      return record;
    } catch {
      return null;
    }
  }

  create(input = {}) {
    if (!this.dir) throw new Error('saved turns are unavailable');
    const turn = cleanTurn(input.turn);
    const id = `st-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const savedAt = Date.now();
    const record = {
      id,
      savedAt,
      conversationId: String(input.conversationId || '').slice(0, 80),
      flavor: String(input.flavor || '').slice(0, 40),
      conversationTitle: String(input.conversationTitle || '').replace(/\s+/g, ' ').trim().slice(0, 160),
      projectName: String(input.projectName || '').replace(/\s+/g, ' ').trim().slice(0, 160),
      turnId: String(turn.id || '').slice(0, 80),
      turnIndex: Number.isFinite(Number(turn.index)) ? Number(turn.index) : null,
      scheduleLabel: String(turn.scheduleLabel || '').slice(0, 80),
      promptPreview: previewText(turn),
      turn,
    };
    const json = JSON.stringify(record);
    if (Buffer.byteLength(json) > MAX_RECORD_BYTES) {
      throw new Error('this turn is too large to save');
    }
    mkdirSync(this.itemsDir, { recursive: true });
    const itemPath = join(this.itemsDir, `${id}.json`);
    writeFileSync(itemPath, json, 'utf-8');
    const index = this.#readIndex().filter((item) => item.id !== id);
    index.unshift(this.#summary(record));
    this.#writeIndex(index);
    return this.#summary(record);
  }

  delete(id) {
    const safeId = this.#assertId(id);
    const path = join(this.itemsDir, `${safeId}.json`);
    if (existsSync(path)) rmSync(path, { force: true });
    const index = this.#readIndex().filter((item) => item.id !== safeId);
    this.#writeIndex(index);
    return true;
  }

  #assertId(id) {
    const safeId = String(id || '');
    if (!ID_RE.test(safeId)) throw new Error('invalid saved turn id');
    return safeId;
  }

  #summary(record) {
    return {
      id: record.id,
      savedAt: record.savedAt,
      conversationId: record.conversationId,
      flavor: record.flavor,
      conversationTitle: record.conversationTitle,
      projectName: record.projectName,
      turnId: record.turnId,
      turnIndex: record.turnIndex,
      scheduleLabel: record.scheduleLabel,
      promptPreview: record.promptPreview,
    };
  }

  #readIndex() {
    if (!this.indexPath || !existsSync(this.indexPath)) return [];
    try {
      const parsed = JSON.parse(readFileSync(this.indexPath, 'utf-8'));
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item) => item && ID_RE.test(String(item.id || '')));
    } catch {
      return [];
    }
  }

  #writeIndex(index) {
    if (!this.dir) return;
    mkdirSync(this.dir, { recursive: true });
    const json = JSON.stringify(index, null, 2);
    const tmp = `${this.indexPath}.tmp.${process.pid}`;
    writeFileSync(tmp, json, 'utf-8');
    try {
      renameSync(tmp, this.indexPath);
    } catch {
      writeFileSync(this.indexPath, json, 'utf-8');
      try { rmSync(tmp, { force: true }); } catch {}
    }
    try { statSync(this.indexPath); } catch {}
  }
}
