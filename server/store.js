import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR, SCHEMA_VERSION } from './config.js';
import { AppError } from './errors.js';

const EXPERIMENTS_DIR = path.join(DATA_DIR, 'experiments');
const INDEX_PATH = path.join(DATA_DIR, 'index.json');
let indexMutex = Promise.resolve();

async function withIndexLock(task) {
  const result = indexMutex.then(task, task);
  indexMutex = result.catch(() => {});
  return result;
}

export async function ensureStore() {
  await fs.mkdir(EXPERIMENTS_DIR, { recursive: true });
  try {
    await fs.access(INDEX_PATH);
  } catch {
    await writeIndex({ schemaVersion: SCHEMA_VERSION, updatedAt: new Date().toISOString(), experiments: [] });
  }
  await reconcile();
}

async function writeIndex(index) {
  const tmp = INDEX_PATH + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(index, null, 2), 'utf8');
  await fs.rename(tmp, INDEX_PATH);
}

export async function readIndex() {
  try {
    const raw = await fs.readFile(INDEX_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.experiments)) parsed.experiments = [];
    return parsed;
  } catch {
    return { schemaVersion: SCHEMA_VERSION, updatedAt: new Date().toISOString(), experiments: [] };
  }
}

async function reconcile() {
  const index = await readIndex();
  const known = new Set(index.experiments.map((e) => e.id));
  let changed = false;
  let entries = [];
  try {
    entries = await fs.readdir(EXPERIMENTS_DIR, { withFileTypes: true });
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || known.has(entry.name)) continue;
    try {
      const record = JSON.parse(await fs.readFile(path.join(EXPERIMENTS_DIR, entry.name, 'record.json'), 'utf8'));
      index.experiments.push(summaryFromRecord(record));
      changed = true;
    } catch {
      /* skip orphan */
    }
  }
  // Drop summaries whose folders disappeared.
  index.experiments = index.experiments.filter((item) => {
    const exists = entries.some((e) => e.isDirectory() && e.name === item.id);
    if (!exists) changed = true;
    return exists;
  });
  if (changed) {
    index.updatedAt = new Date().toISOString();
    await writeIndex(index);
  }
}

export function newId(prefix = 'exp') {
  const time = Date.now().toString(36);
  const rand = crypto.randomBytes(3).toString('hex');
  return `${prefix}_${time}${rand}`;
}

export function experimentDir(id) {
  if (!/^[a-z0-9_]{6,64}$/i.test(id)) throw new AppError('INVALID_ID', 'Некорректный идентификатор эксперимента', 400);
  return path.join(EXPERIMENTS_DIR, id);
}

export function summaryFromRecord(record) {
  const engines = {};
  for (const [key, engine] of Object.entries(record.engines || {})) {
    engines[key] = {
      status: engine.status,
      median: engine.timing?.median ?? null,
      bytes: engine.stats?.bytes ?? null,
      nodes: engine.stats?.nodes ?? null,
      paths: engine.stats?.paths ?? null,
      rmse: engine.metrics?.rmse ?? null,
      ssim: engine.metrics?.ssim ?? null,
      deltaE2000: engine.metrics?.deltaE2000 ?? null,
      silhouetteIou: engine.metrics?.silhouette?.iou ?? null,
      error: engine.error || null,
    };
  }
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    status: record.status,
    batchId: record.batchId || null,
    batchName: record.batchName || null,
    derivedFrom: record.derivedFrom || null,
    tags: record.tags || [],
    pinned: Boolean(record.pinned),
    author: record.author || '',
    notesPreview: (record.notes || '').slice(0, 240),
    source: {
      originalName: record.source?.originalName,
      width: record.source?.width,
      height: record.source?.height,
      megapixels: record.source?.megapixels,
      format: record.source?.format,
      background: record.source?.background,
    },
    config: {
      repetitions: record.config?.repetitions,
      warmup: record.config?.warmup,
      maxSide: record.config?.maxSide,
      resolvedThreshold: record.timing?.resolvedThreshold,
    },
    timing: {
      durationMs: record.timing?.durationMs,
      analysisMs: record.timing?.analysisMs,
    },
    engines,
    best: record.best || {},
    roisCount: Array.isArray(record.rois) ? record.rois.length : 0,
  };
}

export async function saveExperiment(record) {
  return withIndexLock(async () => {
    const dir = experimentDir(record.id);
    await fs.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, 'record.json.tmp');
    await fs.writeFile(tmp, JSON.stringify(record, null, 2), 'utf8');
    await fs.rename(tmp, path.join(dir, 'record.json'));
    const index = await readIndex();
    const summary = summaryFromRecord(record);
    const idx = index.experiments.findIndex((e) => e.id === record.id);
    if (idx >= 0) index.experiments[idx] = summary;
    else index.experiments.unshift(summary);
    index.updatedAt = new Date().toISOString();
    await writeIndex(index);
    return record;
  });
}

export async function listExperiments({ q, tag, batchId, status, limit, offset = 0 } = {}) {
  const index = await readIndex();
  let items = index.experiments;
  if (q) {
    const needle = String(q).toLowerCase();
    items = items.filter((e) =>
      [e.name, e.source?.originalName, e.batchName, ...(e.tags || [])]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle)),
    );
  }
  if (tag) items = items.filter((e) => (e.tags || []).includes(tag));
  if (batchId) items = items.filter((e) => e.batchId === batchId);
  if (status) items = items.filter((e) => e.status === status);
  items = [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });
  const total = items.length;
  const start = Math.max(0, Number(offset) || 0);
  const end = limit ? start + Math.max(1, Number(limit)) : undefined;
  return { total, items: items.slice(start, end) };
}

export async function getExperiment(id) {
  const dir = experimentDir(id);
  try {
    return JSON.parse(await fs.readFile(path.join(dir, 'record.json'), 'utf8'));
  } catch {
    throw new AppError('NOT_FOUND', 'Эксперимент не найден', 404);
  }
}

export async function patchExperiment(id, patch) {
  return withIndexLock(async () => {
    const record = await getExperiment(id);
    const allowed = ['name', 'notes', 'tags', 'author', 'batchName', 'pinned'];
    for (const key of allowed) {
      if (patch[key] !== undefined) record[key] = patch[key];
    }
    record.updatedAt = new Date().toISOString();
    const dir = experimentDir(id);
    await fs.writeFile(path.join(dir, 'record.json.tmp'), JSON.stringify(record, null, 2), 'utf8');
    await fs.rename(path.join(dir, 'record.json.tmp'), path.join(dir, 'record.json'));
    const index = await readIndex();
    const idx = index.experiments.findIndex((e) => e.id === id);
    if (idx >= 0) index.experiments[idx] = summaryFromRecord(record);
    else index.experiments.unshift(summaryFromRecord(record));
    index.updatedAt = new Date().toISOString();
    await writeIndex(index);
    return record;
  });
}

export async function deleteExperiment(id) {
  return withIndexLock(async () => {
    const dir = experimentDir(id);
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (error) {
      throw new AppError('DELETE_FAILED', 'Не удалось удалить эксперимент: ' + error.message, 500);
    }
    const index = await readIndex();
    index.experiments = index.experiments.filter((e) => e.id !== id);
    index.updatedAt = new Date().toISOString();
    await writeIndex(index);
  });
}

export function filePath(id, name) {
  const safe = path.basename(name);
  if (safe !== name || safe.includes('..')) throw new AppError('INVALID_FILE', 'Некорректное имя файла', 400);
  return path.join(experimentDir(id), safe);
}

export async function writeExperimentFile(id, name, data) {
  const dir = experimentDir(id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath(id, name), data);
}

export async function readExperimentFile(id, name) {
  try {
    return await fs.readFile(filePath(id, name));
  } catch {
    throw new AppError('FILE_NOT_FOUND', 'Файл результата не найден', 404);
  }
}

export async function experimentFileExists(id, name) {
  try {
    await fs.access(filePath(id, name));
    return true;
  } catch {
    return false;
  }
}

export async function getBatches() {
  const index = await readIndex();
  const map = new Map();
  for (const item of index.experiments) {
    if (!item.batchId) continue;
    if (!map.has(item.batchId)) {
      map.set(item.batchId, {
        id: item.batchId,
        name: item.batchName || 'Серия',
        createdAt: item.createdAt,
        count: 0,
        experimentIds: [],
        statuses: {},
      });
    }
    const batch = map.get(item.batchId);
    batch.count++;
    batch.experimentIds.push(item.id);
    batch.statuses[item.status] = (batch.statuses[item.status] || 0) + 1;
    if (item.createdAt < batch.createdAt) batch.createdAt = item.createdAt;
  }
  return [...map.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export { EXPERIMENTS_DIR };
