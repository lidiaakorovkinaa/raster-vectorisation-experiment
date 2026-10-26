import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  APP_VERSION,
  DEFAULT_BACKGROUND,
  ENGINE_META,
  ENVIRONMENT,
  LIMITS,
  METHODOLOGY_VERSION,
  SCHEMA_VERSION,
} from './config.js';
import { AppError } from './errors.js';
import {
  compositeBackground,
  cropRGBA,
  decodeImage,
  downscaleRGBA,
  encodePng,
  estimateBackground,
  mimeForFormat,
  parseHexColor,
  sha256,
  sniffFormat,
} from './image.js';
import { normalizeConfig, normalizeMeta, normalizeParams, clampRepetitions, DEFAULT_PARAMS, otsuThreshold } from './params.js';
import { runBenchmark } from './compute.js';
import {
  deleteExperiment,
  experimentDir,
  experimentFileExists,
  filePath,
  getExperiment,
  newId,
  patchExperiment,
  readExperimentFile,
  saveExperiment,
  writeExperimentFile,
} from './store.js';
import { normalizeSvg } from './svg.js';
import { prepareSource, compareRender } from './metrics/pixels.js';
import { decodePng } from './image.js';

const ENGINE_IDS = ['potrace', 'imagetracer', 'vtracer'];

function safeName(value, fallback = 'Эксперимент') {
  const cleaned = String(value || '').replace(/[\u0000-\u001f]/g, '').trim();
  return cleaned.slice(0, 160) || fallback;
}

function normalizeTags(tags) {
  const set = new Set();
  for (const tag of tags || []) {
    const clean = String(tag).trim().slice(0, 40);
    if (clean) set.add(clean);
  }
  return [...set].slice(0, 12);
}

function fileExtension(format, originalName) {
  const byFormat = { png: 'png', jpeg: 'jpg', webp: 'webp', gif: 'gif', bmp: 'bmp', tiff: 'tif' };
  if (byFormat[format]) return byFormat[format];
  const ext = path.extname(originalName || '').replace('.', '').toLowerCase();
  return /^[a-z0-9]{2,5}$/.test(ext) ? ext : 'bin';
}

function buildWarnings(record, computation) {
  const warnings = [];
  if (computation.timing?.workerRestarts) {
    warnings.push({
      level: 'warn',
      message: `Рабочий поток перезапускался ${computation.timing.workerRestarts} раз(а): часть замеров могла быть выполнена после холодного старта.`,
    });
  }
  for (const engine of ENGINE_IDS) {
    const item = record.engines[engine];
    if (!item) continue;
    if (item.status === 'error') warnings.push({ level: 'error', message: `${ENGINE_META[engine].name}: ${item.error || 'нет результата'}` });
    if (item.status === 'partial') warnings.push({ level: 'warn', message: `${ENGINE_META[engine].name}: SVG получен, но метрики не рассчитаны.` });
    if (item.timing?.cv > 20) warnings.push({ level: 'warn', message: `${ENGINE_META[engine].name}: высокий разброс времени (CV ${item.timing.cv}%).` });
    if (item.stats?.bytes > 5 * 1024 * 1024) warnings.push({ level: 'warn', message: `${ENGINE_META[engine].name}: SVG ${(item.stats.bytes / 1024 / 1024).toFixed(1)} МБ — результат очень тяжёлый.` });
    if (item.deterministic === false) warnings.push({ level: 'warn', message: `${ENGINE_META[engine].name}: результаты прогонов различаются (недетерминированный вывод).` });
    if (item.aspectMismatch > 0.01) warnings.push({ level: 'warn', message: `${ENGINE_META[engine].name}: пропорции SVG отличаются от исходника на ${(item.aspectMismatch * 100).toFixed(1)}%.` });
  }
  if (record.status === 'partial') warnings.push({ level: 'warn', message: 'Эксперимент сохранён частично: доступны не все три результата или метрики.' });
  return warnings;
}

function bestFromEngines(engines) {
  const available = ENGINE_IDS.filter((id) => engines[id]?.metrics);
  const pick = (metric, mode = 'max') => {
    let winner = null;
    let value = null;
    for (const id of available) {
      const v = engines[id].metrics[metric];
      if (!Number.isFinite(v)) continue;
      if (value === null || (mode === 'max' ? v > value : v < value)) {
        value = v;
        winner = id;
      }
    }
    return winner ? { engine: winner, value } : null;
  };
  const pickNested = (fn, mode = 'max') => {
    let winner = null;
    let value = null;
    for (const id of available) {
      const v = fn(engines[id]);
      if (!Number.isFinite(v)) continue;
      if (value === null || (mode === 'max' ? v > value : v < value)) {
        value = v;
        winner = id;
      }
    }
    return winner ? { engine: winner, value } : null;
  };
  const timeCandidates = ENGINE_IDS.filter((id) => Number.isFinite(engines[id]?.timing?.median));
  let speed = null;
  for (const id of timeCandidates) {
    if (!speed || engines[id].timing.median < speed.value) speed = { engine: id, value: engines[id].timing.median };
  }
  let size = null;
  for (const id of ENGINE_IDS) {
    const bytes = engines[id]?.stats?.bytes;
    if (!Number.isFinite(bytes)) continue;
    if (!size || bytes < size.value) size = { engine: id, value: bytes };
  }
  return {
    quality: pick('ssim', 'max'),
    rmse: pick('rmse', 'min'),
    color: pick('deltaE2000', 'min'),
    silhouette: pickNested((e) => e.metrics?.silhouette?.iou, 'max'),
    speed,
    size,
  };
}

function qualityStatus(engines) {
  const values = ENGINE_IDS.map((id) => engines[id]);
  const okCount = values.filter((e) => e?.status === 'ok' && e?.metrics).length;
  const tracedCount = values.filter((e) => e?.stats).length;
  if (okCount === 3) return 'ok';
  if (tracedCount === 0) return 'error';
  return 'partial';
}

export async function createExperiment({ files, meta: rawMeta, params: rawParams, emit = () => {} }) {
  const startedAt = performance.now();
  const meta = normalizeMeta(rawMeta || {});
  const configInput = { ...(meta.config || {}) };
  if (configInput.maxSide === undefined) configInput.maxSide = LIMITS.defaultMaxSide;
  if (configInput.background === undefined) configInput.background = DEFAULT_BACKGROUND;
  if (configInput.repetitions === undefined) configInput.repetitions = clampRepetitions(LIMITS.defaultRepetitions);
  if (configInput.warmup === undefined) configInput.warmup = 1;
  const config = normalizeConfig(configInput);
  config.repetitions = clampRepetitions(config.repetitions);
  const params = normalizeParams(rawParams || {});

  const normalizedFile = files?.normalized?.[0];
  const originalFile = files?.original?.[0];
  const genericFile = files?.file?.[0];
  const sourceUpload = normalizedFile || genericFile;
  if (!sourceUpload) throw new AppError('NO_FILE', 'Не передан файл изображения');

  const sourceBufferIn = sourceUpload.buffer;
  const decodedRaw = decodeImage(sourceBufferIn, { allowFormats: ['png', 'jpeg'] });
  if (!decodedRaw.width || !decodedRaw.height) throw new AppError('INVALID_IMAGE', 'Не удалось определить размеры изображения');

  let working = decodedRaw;
  if (Math.max(working.width, working.height) > config.maxSide) {
    const scaled = downscaleRGBA(working.rgba, working.width, working.height, config.maxSide);
    working = { ...working, ...scaled };
  }
  const flattened = compositeBackground(working.rgba, config.background);
  const sourceRGBA = flattened.rgba;
  const qualityBackground = flattened.transparentRatio > 0.001 ? config.background : estimateBackground(sourceRGBA, working.width, working.height);
  const normBuffer = encodePng(sourceRGBA, working.width, working.height);
  const normSha = sha256(normBuffer);

  const originalBuffer = originalFile?.buffer || sourceBufferIn;
  const originalFormat = sniffFormat(originalBuffer);
  const originalMime = originalFile?.mimetype || mimeForFormat(originalFormat);
  const originalName = path.basename(meta.client?.originalName || originalFile?.originalname || sourceUpload.originalname || 'image.png');
  const ext = fileExtension(originalFormat, originalName);
  const originalFileRel = `original.${ext}`;
  const originalSha = sha256(originalBuffer);

  const id = newId('exp');
  const dir = experimentDir(id);
  await fs.mkdir(dir, { recursive: true });

  try {
    await fs.writeFile(path.join(dir, 'source.png'), normBuffer);
    await fs.writeFile(path.join(dir, originalFileRel), originalBuffer);

    // Small thumbnail for lists, independent from the canonical source.
    const thumbScale = Math.min(1, 420 / Math.max(working.width, working.height));
    const thumbW = Math.max(1, Math.round(working.width * thumbScale));
    const thumbH = Math.max(1, Math.round(working.height * thumbScale));
    const thumb = scaleNearest(sourceRGBA, working.width, working.height, thumbW, thumbH);
    await fs.writeFile(path.join(dir, 'thumb.png'), encodePng(thumb, thumbW, thumbH));

    const sourceInfo = {
      originalName,
      originalMime,
      originalBytes: originalBuffer.length,
      originalSha256: originalSha,
      originalFile: originalFileRel,
      format: decodedRaw.format,
      width: working.width,
      height: working.height,
      sourceWidth: decodedRaw.width,
      sourceHeight: decodedRaw.height,
      megapixels: Number(((working.width * working.height) / 1e6).toFixed(3)),
      aspect: Number((working.width / working.height).toFixed(4)),
      hasAlpha: decodedRaw.format === 'png' ? hasAlpha(decodedRaw.rgba) : false,
      transparentRatio: Number(flattened.transparentRatio.toFixed(4)),
      normalizedBytes: normBuffer.length,
      normalizedSha256: normSha,
      normalizedFile: 'source.png',
      thumbFile: 'thumb.png',
      background: config.background,
      qualityBackground,
      maxSide: config.maxSide,
      downscaled: working.width !== decodedRaw.width || working.height !== decodedRaw.height,
      scale: decodedRaw.width ? Number((working.width / decodedRaw.width).toFixed(4)) : 1,
      client: meta.client || null,
    };

    emit({
      type: 'progress',
      stage: 'source',
      message: `Источник ${working.width}×${working.height} · ${(working.width * working.height / 1e6).toFixed(2)} Мп`,
      source: sourceInfo,
    });

    const computation = await runBenchmark({
      source: sourceRGBA,
      width: working.width,
      height: working.height,
      params,
      config: { ...config, qualityBackground },
      emit,
    });

    const engines = {};
    for (const engine of ENGINE_IDS) {
      const result = computation.engines[engine];
      const item = {
        id: engine,
        name: ENGINE_META[engine].name,
        version: ENGINE_META[engine].version,
        status: result.status,
        error: result.error || null,
        timing: result.timing || null,
        deterministic: result.deterministic ?? null,
        stats: result.stats || null,
        metrics: result.metrics || null,
        viewBox: result.viewBox || null,
        aspectMismatch: result.aspectMismatch ?? null,
        failures: result.failures || 0,
        errors: result.errors || [],
        files: {},
      };
      if (result.svg) {
        const svgFile = `svg-${engine}.svg`;
        await writeExperimentFile(id, svgFile, result.svg);
        item.files.svg = svgFile;
      }
      if (result.images) {
        const renderFile = `render-${engine}.png`;
        const heatmapFile = `heatmap-${engine}.png`;
        const heatmapFixedFile = `heatmap-fixed-${engine}.png`;
        const ssimFile = `ssim-${engine}.png`;
        const diffFile = `diff-${engine}.png`;
        await writeExperimentFile(id, renderFile, result.images.renderPng);
        await writeExperimentFile(id, heatmapFile, result.images.heatmapPng);
        await writeExperimentFile(id, heatmapFixedFile, result.images.heatmapFixedPng);
        await writeExperimentFile(id, ssimFile, result.images.ssimPng);
        await writeExperimentFile(id, diffFile, result.images.diffPng);
        item.files = { ...item.files, render: renderFile, heatmap: heatmapFile, heatmapFixed: heatmapFixedFile, ssim: ssimFile, diff: diffFile };
      }
      engines[engine] = item;
    }

    const record = {
      schemaVersion: SCHEMA_VERSION,
      id,
      name: safeName(meta.name || path.basename(originalName, path.extname(originalName)) || 'Эксперимент'),
      notes: meta.notes || '',
      tags: normalizeTags(meta.tags),
      author: meta.author || '',
      batchId: meta.batchId || null,
      batchName: meta.batchName || null,
      derivedFrom: meta.derivedFrom || null,
      pinned: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: qualityStatus(engines),
      source: sourceInfo,
      config: {
        repetitions: config.repetitions,
        warmup: config.warmup,
        background: config.background,
        maxSide: config.maxSide,
      },
      params: {
        ...params,
        potrace: { ...params.potrace, threshold: computation.timing.resolvedThreshold, resolvedThreshold: computation.timing.resolvedThreshold },
      },
      timing: {
        ...computation.timing,
        totalDurationMs: Math.round(performance.now() - startedAt),
        createdAt: new Date().toISOString(),
      },
      engines,
      rois: [],
      environment: {
        ...ENVIRONMENT,
        engineVersions: {
          potrace: ENGINE_META.potrace.version,
          imagetracer: ENGINE_META.imagetracer.version,
          vtracer: ENGINE_META.vtracer.version,
          resvg: '2.6.2',
          node: process.version,
        },
      },
      methodology: {
        version: METHODOLOGY_VERSION,
        appVersion: APP_VERSION,
        inputNormalization: 'EXIF в браузере; альфа на фон; downscale area-average до maxSide; sRGB PNG',
        timing: `Прогрев ${config.warmup} + ${config.repetitions} измеренных прогонов; порядок движков ротируется; только вызов движка, без декодирования и растеризации`,
        quality: `Рендер resvg 2.6.2 при исходном разрешении; фон композитинга ${qualityBackground}; SSIM 11×11 Gaussian σ=1.5; ΔE2000; маска Оцу`, 
      },
    };
    record.best = bestFromEngines(engines);
    record.warnings = buildWarnings(record, computation);

    await saveExperiment(record);
    emit({ type: 'progress', stage: 'saved', message: 'Эксперимент сохранён' });
    return record;
  } catch (error) {
    // Remove the partial experiment folder so a failed run does not pollute the series.
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    throw error;
  }
}

function hasAlpha(rgba) {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 255) return true;
  return false;
}

function scaleNearest(rgba, width, height, targetW, targetH) {
  const out = new Uint8Array(targetW * targetH * 4);
  for (let y = 0; y < targetH; y++) {
    const sy = Math.min(height - 1, Math.floor((y + 0.5) * (height / targetH)));
    for (let x = 0; x < targetW; x++) {
      const sx = Math.min(width - 1, Math.floor((x + 0.5) * (width / targetW)));
      const si = (sy * width + sx) * 4;
      const di = (y * targetW + x) * 4;
      out[di] = rgba[si];
      out[di + 1] = rgba[si + 1];
      out[di + 2] = rgba[si + 2];
      out[di + 3] = rgba[si + 3];
    }
  }
  return out;
}

export async function deriveExperiment(id, { params, config, meta, emit = () => {} }) {
  const parent = await getExperiment(id);
  const source = await readExperimentFile(id, 'source.png');
  let original = null;
  try {
    original = await readExperimentFile(id, parent.source?.originalFile || 'source.png');
  } catch {
    original = source;
  }
  const files = {
    normalized: [{ buffer: source, originalname: parent.source?.originalName || 'source.png', mimetype: 'image/png', size: source.length }],
    original: [{ buffer: original, originalname: parent.source?.originalName || 'original', mimetype: parent.source?.originalMime || 'application/octet-stream', size: original.length }],
  };
  const combinedMeta = {
    ...(meta || {}),
    name: meta?.name || `${parent.name} · повтор`,
    derivedFrom: id,
    notes: meta?.notes ?? parent.notes,
    tags: meta?.tags ?? parent.tags,
    batchId: meta?.batchId ?? null,
    batchName: meta?.batchName ?? null,
    client: {
      originalName: parent.source?.originalName,
      originalType: parent.source?.originalMime,
      originalSize: parent.source?.originalBytes,
      preprocessing: 'Источник повторно декодирован из сохранённого source.png',
    },
    config: {
      repetitions: config?.repetitions ?? parent.config?.repetitions,
      warmup: config?.warmup ?? parent.config?.warmup,
      background: config?.background ?? parent.config?.background ?? DEFAULT_BACKGROUND,
      maxSide: config?.maxSide ?? parent.config?.maxSide ?? LIMITS.defaultMaxSide,
    },
  };
  return createExperiment({
    files,
    meta: combinedMeta,
    params: params || parent.params,
    emit,
  });
}

export async function saveRoi(id, { name, rect, note = '' }) {
  const record = await getExperiment(id);
  const x = Math.max(0, Math.floor(Number(rect?.x) || 0));
  const y = Math.max(0, Math.floor(Number(rect?.y) || 0));
  const w = Math.max(2, Math.floor(Number(rect?.w) || 0));
  const h = Math.max(2, Math.floor(Number(rect?.h) || 0));
  if (x >= record.source.width || y >= record.source.height) throw new AppError('INVALID_ROI', 'Область вне изображения');
  const rectSafe = {
    x,
    y,
    w: Math.min(w, record.source.width - x),
    h: Math.min(h, record.source.height - y),
  };
  const sourcePng = await readExperimentFile(id, 'source.png');
  const source = decodePng(sourcePng);
  const sourceCrop = cropRGBA(source.rgba, source.width, source.height, rectSafe);
  const ctx = prepareSource(sourceCrop.rgba, sourceCrop.width, sourceCrop.height, {
    background: record.source.qualityBackground || record.source.background,
    threshold: record.timing.resolvedThreshold,
    invertMask: record.params?.potrace?.blackOnWhite === false,
  });
  const engineMetrics = {};
  for (const engine of ENGINE_IDS) {
    const renderFile = record.engines[engine]?.files?.render;
    if (!renderFile) continue;
    try {
      const render = decodePng(await readExperimentFile(id, renderFile));
      const renderCrop = cropRGBA(render.rgba, render.width, render.height, rectSafe);
      const result = compareRender(ctx, renderCrop.rgba, { maps: false });
      engineMetrics[engine] = result.metrics;
    } catch (error) {
      engineMetrics[engine] = { error: error.message };
    }
  }
  const roi = {
    id: newId('roi'),
    name: safeName(name || `Область ${record.rois.length + 1}`),
    note: String(note || '').slice(0, 2000),
    rect: rectSafe,
    metrics: engineMetrics,
    createdAt: new Date().toISOString(),
  };
  record.rois = Array.isArray(record.rois) ? record.rois : [];
  record.rois.push(roi);
  record.updatedAt = new Date().toISOString();
  await saveExperiment(record);
  return roi;
}

export async function deleteRoi(id, roiId) {
  const record = await getExperiment(id);
  record.rois = (record.rois || []).filter((r) => r.id !== roiId);
  record.updatedAt = new Date().toISOString();
  await saveExperiment(record);
  return record;
}

export async function recomputeRoiMetrics(id, rect) {
  const record = await getExperiment(id);
  if (!rect) throw new AppError('INVALID_ROI', 'Не передана область');
  const x = Math.max(0, Math.floor(Number(rect.x) || 0));
  const y = Math.max(0, Math.floor(Number(rect.y) || 0));
  const w = Math.min(Math.max(2, Math.floor(Number(rect.w) || 0)), record.source.width - x);
  const h = Math.min(Math.max(2, Math.floor(Number(rect.h) || 0)), record.source.height - y);
  const sourcePng = await readExperimentFile(id, 'source.png');
  const source = decodePng(sourcePng);
  const rectSafe = { x, y, w, h };
  const sourceCrop = cropRGBA(source.rgba, source.width, source.height, rectSafe);
  const ctx = prepareSource(sourceCrop.rgba, sourceCrop.width, sourceCrop.height, {
    background: record.source.qualityBackground || record.source.background,
    threshold: record.timing.resolvedThreshold,
    invertMask: record.params?.potrace?.blackOnWhite === false,
  });
  const out = { rect: rectSafe, engines: {} };
  for (const engine of ENGINE_IDS) {
    const renderFile = record.engines[engine]?.files?.render;
    if (!renderFile) continue;
    try {
      const render = decodePng(await readExperimentFile(id, renderFile));
      const renderCrop = cropRGBA(render.rgba, render.width, render.height, rectSafe);
      out.engines[engine] = compareRender(ctx, renderCrop.rgba, { maps: false }).metrics;
    } catch (error) {
      out.engines[engine] = { error: error.message };
    }
  }
  return out;
}

export async function deleteExperimentAndFiles(id) {
  return deleteExperiment(id);
}

export { patchExperiment };
