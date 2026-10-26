import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  APP_VERSION,
  DATA_DIR,
  DIST_DIR,
  ENGINE_META,
  ENVIRONMENT,
  HOST,
  LIMITS,
  METHODOLOGY_VERSION,
  PORT,
  PUBLIC_DIR,
} from './config.js';
import { AppError, errorPayload } from './errors.js';
import { ensureStore, listExperiments, getExperiment, patchExperiment, deleteExperiment, getBatches, readExperimentFile, readIndex } from './store.js';
import {
  createExperiment,
  deleteRoi,
  deriveExperiment,
  recomputeRoiMetrics,
  saveRoi,
} from './experiments.js';
import {
  buildCsv,
  buildDatasetCsv,
  buildDatasetJson,
  buildDatasetMarkdown,
  buildJsonExport,
  buildLatex,
  buildReportHtml,
  buildReportMarkdown,
  createDatasetZip,
  createExperimentZip,
} from './report.js';
import { DEFAULT_PARAMS, PRESETS, PARAM_LABELS, ENUM_LABELS, parseJsonField } from './params.js';

const ENGINE_IDS = ['potrace', 'imagetracer', 'vtracer'];
const app = express();
app.disable('x-powered-by');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITS.maxUploadBytes, files: 3, fields: 24 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype?.startsWith('image/') || file.mimetype === 'application/octet-stream') return cb(null, true);
    cb(new AppError('UNSUPPORTED_MIME', `Неподдерживаемый тип файла: ${file.mimetype}`, 415));
  },
});

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (!req.path.startsWith('/api/')) {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  }
  next();
});

app.use(express.json({ limit: '512kb' }));

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function noStore(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
}

function slug(value) {
  return String(value || 'experiment')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'experiment';
}

app.get('/api/health', (req, res) => {
  noStore(res);
  res.json({
    ok: true,
    app: 'vectorization-experiment',
    version: APP_VERSION,
    methodologyVersion: METHODOLOGY_VERSION,
    uptime: Math.round(process.uptime()),
    environment: ENVIRONMENT,
    engines: Object.fromEntries(ENGINE_IDS.map((id) => [id, { ...ENGINE_META[id], ok: true }])),
    limits: LIMITS,
  });
});

app.get('/api/config', (req, res) => {
  noStore(res);
  res.json({
    app: { name: 'Эксперимент', version: APP_VERSION, methodologyVersion: METHODOLOGY_VERSION },
    engines: ENGINE_IDS.map((id) => ENGINE_META[id]),
    defaultParams: DEFAULT_PARAMS,
    presets: PRESETS,
    labels: { params: PARAM_LABELS, enums: ENUM_LABELS },
    limits: LIMITS,
    environment: ENVIRONMENT,
    methodology: {
      title: 'Методика измерений',
      timing: 'Время измеряется вокруг вызова движка в отдельном worker-потоке: после N прогревочных и P измеренных прогонов, без декодирования PNG, растеризации и записи файлов. Порядок движков ротируется между прогонами; эксперименты выполняются последовательно, чтобы избежать конкуренции за CPU.',
      quality: 'SVG каждого движка рендерится в resvg 2.6.2 (WASM) при рабочем разрешении источника. Сравнение идёт по RGB после композитинга прозрачных областей на фон метрик. SSIM — по яркости, окно 11×11, гауссово σ=1.5. ΔE76/ΔE2000 — попиксельно в CIELAB. Силуэт — по маске Оцу.',
      normalization: 'Браузер применяет EXIF-ориентацию, сглаживает прозрачность на выбранный фон и уменьшает длинную сторону до maxSide (area average на сервере). Все движки получают один и тот же массив RGBA.',
      caveats: [
        'Potrace — бинарный трассировщик; цветовые метрики для него справочные. Основные для него — силуэт, число узлов и скорость.',
        'Абсолютные времена зависят от машины, JIT и фоновой нагрузки. Сравнивайте медианы внутри одного запуска.',
        'ImageTracer и VTracer имеют разные модели цвета; параметры по умолчанию — стартовая точка, а не оптимум.',
        'SSIM и ΔE2000 считаются на рабочем разрешении; при уменьшении maxSide мелкие детали могут исчезнуть.',
      ],
    },
  });
});

app.get('/api/samples', (req, res) => {
  noStore(res);
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'samples', 'samples.json'), 'utf8'));
    res.json(manifest);
  } catch {
    res.json({ samples: [] });
  }
});

app.use('/samples', express.static(path.join(PUBLIC_DIR, 'samples'), { maxAge: '7d', immutable: true }));

app.get('/api/experiments', asyncRoute(async (req, res) => {
  noStore(res);
  const result = await listExperiments({
    q: req.query.q,
    tag: req.query.tag,
    batchId: req.query.batch,
    status: req.query.status,
    limit: req.query.limit ? Math.min(500, Number(req.query.limit)) : undefined,
    offset: req.query.offset,
  });
  res.json(result);
}));

app.get('/api/batches', asyncRoute(async (req, res) => {
  noStore(res);
  res.json({ batches: await getBatches() });
}));

function parseUploadMeta(body) {
  const meta = parseJsonField(body.meta, {});
  const params = parseJsonField(body.params, {});
  return { meta, params };
}

function streamResponse(res) {
  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  let closed = false;
  res.on('close', () => { closed = true; });
  return {
    emit(message) {
      if (closed) return;
      try {
        res.write(JSON.stringify(message) + '\n');
      } catch {
        closed = true;
      }
    },
    done(payload) {
      if (closed) return;
      res.write(JSON.stringify({ type: 'done', ...payload }) + '\n');
      res.end();
    },
    error(error) {
      if (closed) return;
      res.write(JSON.stringify({ type: 'error', error: errorPayload(error) }) + '\n');
      res.end();
    },
    get closed() { return closed; },
  };
}

app.post('/api/experiments', upload.fields([
  { name: 'normalized', maxCount: 1 },
  { name: 'original', maxCount: 1 },
  { name: 'file', maxCount: 1 },
]), asyncRoute(async (req, res) => {
  const { meta, params } = parseUploadMeta(req.body || {});
  const stream = req.query.sync !== '1' && String(req.headers.accept || '').includes('application/x-ndjson');
  if (!stream) {
    try {
      const record = await createExperiment({ files: req.files, meta, params });
      noStore(res);
      res.status(201).json(record);
    } catch (error) {
      throw error;
    }
    return;
  }
  const out = streamResponse(res);
  try {
    const record = await createExperiment({ files: req.files, meta, params, emit: (m) => out.emit(m) });
    out.done({ experiment: record });
  } catch (error) {
    console.error('[server] experiment failed:', error?.message);
    out.error(error);
  }
}));

app.post('/api/experiments/:id/derive', asyncRoute(async (req, res) => {
  const id = req.params.id;
  const stream = req.query.sync !== '1' && String(req.headers.accept || '').includes('application/x-ndjson');
  if (!stream) {
    const record = await deriveExperiment(id, { params: req.body?.params, config: req.body?.config, meta: req.body?.meta });
    noStore(res);
    res.status(201).json(record);
    return;
  }
  const out = streamResponse(res);
  try {
    const record = await deriveExperiment(id, { params: req.body?.params, config: req.body?.config, meta: req.body?.meta, emit: (m) => out.emit(m) });
    out.done({ experiment: record });
  } catch (error) {
    out.error(error);
  }
}));

app.get('/api/experiments/:id', asyncRoute(async (req, res) => {
  noStore(res);
  const record = await getExperiment(req.params.id);
  res.json(record);
}));

app.patch('/api/experiments/:id', asyncRoute(async (req, res) => {
  noStore(res);
  const patch = {};
  for (const key of ['name', 'notes', 'tags', 'author', 'batchName', 'pinned']) {
    if (req.body?.[key] !== undefined) patch[key] = req.body[key];
  }
  if (patch.name !== undefined) {
    patch.name = String(patch.name).trim().slice(0, 160);
    if (!patch.name) throw new AppError('INVALID_NAME', 'Название не может быть пустым');
  }
  if (patch.notes !== undefined) patch.notes = String(patch.notes).slice(0, 20000);
  if (patch.author !== undefined) patch.author = String(patch.author).slice(0, 200);
  if (patch.tags !== undefined) patch.tags = (Array.isArray(patch.tags) ? patch.tags : []).map((t) => String(t).trim().slice(0, 40)).filter(Boolean).slice(0, 12);
  if (patch.batchName !== undefined) patch.batchName = String(patch.batchName).slice(0, 120);
  if (patch.pinned !== undefined) patch.pinned = Boolean(patch.pinned);
  const record = await patchExperiment(req.params.id, patch);
  res.json(record);
}));

app.delete('/api/experiments/:id', asyncRoute(async (req, res) => {
  await deleteExperiment(req.params.id);
  res.json({ ok: true });
}));

function fileForKind(record, kind, engine) {
  if (kind === 'source') return record.source?.normalizedFile;
  if (kind === 'thumb') return record.source?.thumbFile;
  if (kind === 'original') return record.source?.originalFile;
  if (!ENGINE_IDS.includes(engine)) throw new AppError('INVALID_ENGINE', 'Неизвестный движок');
  const item = record.engines?.[engine];
  if (!item) throw new AppError('NOT_FOUND', 'Движок отсутствует в эксперименте', 404);
  const map = { svg: 'svg', render: 'render', heatmap: 'heatmap', heatmapFixed: 'heatmapFixed', ssim: 'ssim', diff: 'diff' };
  const key = map[kind];
  if (!key || !item.files?.[key]) throw new AppError('NOT_FOUND', 'Файл не найден', 404);
  return item.files[key];
}

const fileHandler = asyncRoute(async (req, res) => {
  const record = await getExperiment(req.params.id);
  const file = fileForKind(record, req.params.kind, req.params.engine);
  if (!file) throw new AppError('NOT_FOUND', 'Файл не найден', 404);
  let buffer;
  try {
    buffer = await readExperimentFile(record.id, file);
  } catch {
    throw new AppError('NOT_FOUND', 'Файл не найден', 404);
  }
  const ext = path.extname(file).toLowerCase();
  const download = req.query.download === '1';
  if (ext === '.svg') {
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:");
    if (download) res.setHeader('Content-Disposition', `attachment; filename="${slug(record.name)}-${req.params.engine}.svg"`);
  } else if (ext === '.png') {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    if (download) res.setHeader('Content-Disposition', `attachment; filename="${slug(record.name)}-${req.params.kind}${req.params.engine ? '-' + req.params.engine : ''}.png"`);
  } else {
    res.setHeader('Content-Type', 'application/octet-stream');
    if (download) res.setHeader('Content-Disposition', `attachment; filename="${slug(record.source?.originalName || 'original')}${ext}"`);
  }
  res.send(buffer);
});

app.get('/api/experiments/:id/file/:kind', fileHandler);
app.get('/api/experiments/:id/file/:kind/:engine', fileHandler);

app.get('/api/experiments/:id/roi', asyncRoute(async (req, res) => {
  noStore(res);
  const rect = {
    x: Number(req.query.x),
    y: Number(req.query.y),
    w: Number(req.query.w),
    h: Number(req.query.h),
  };
  if (![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)) throw new AppError('INVALID_ROI', 'Некорректный прямоугольник ROI');
  const result = await recomputeRoiMetrics(req.params.id, rect);
  res.json(result);
}));

app.post('/api/experiments/:id/rois', asyncRoute(async (req, res) => {
  const roi = await saveRoi(req.params.id, req.body || {});
  res.status(201).json(roi);
}));

app.delete('/api/experiments/:id/rois/:roiId', asyncRoute(async (req, res) => {
  const record = await deleteRoi(req.params.id, req.params.roiId);
  res.json(record);
}));

const REPORT_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:";

app.get('/api/experiments/:id/export', asyncRoute(async (req, res) => {
  const record = await getExperiment(req.params.id);
  const format = String(req.query.format || 'html').toLowerCase();
  const download = req.query.download === '1';
  const base = slug(record.name || record.id);
  if (format === 'html') {
    const html = await buildReportHtml(record);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', REPORT_CSP);
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${base}-report.html"`);
    res.send(html);
    return;
  }
  if (format === 'md' || format === 'markdown') {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${base}-report.md"`);
    res.send(buildReportMarkdown(record));
    return;
  }
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${base}-metrics.csv"`);
    res.send(buildCsv(record));
    return;
  }
  if (format === 'latex' || format === 'tex') {
    res.setHeader('Content-Type', 'application/x-tex; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${base}-table.tex"`);
    res.send(buildLatex(record));
    return;
  }
  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${base}.json"`);
    res.send(await buildJsonExport(record));
    return;
  }
  if (format === 'zip') {
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.zip"`);
    const archive = await createExperimentZip(record);
    archive.on('error', (error) => {
      console.error('[server] zip error', error);
      res.destroy(error);
    });
    archive.pipe(res);
    return;
  }
  throw new AppError('INVALID_FORMAT', 'Неизвестный формат экспорта', 400);
}));

app.get('/api/export', asyncRoute(async (req, res) => {
  const format = String(req.query.format || 'csv').toLowerCase();
  let records = [];
  if (req.query.ids) {
    const ids = String(req.query.ids).split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200);
    records = await Promise.all(ids.map((id) => getExperiment(id).catch(() => null)));
    records = records.filter(Boolean);
  } else {
    const index = await readIndex();
    let items = index.experiments;
    if (req.query.batch) items = items.filter((i) => i.batchId === req.query.batch);
    records = await Promise.all(items.slice(0, 200).map((i) => getExperiment(i.id).catch(() => null)));
    records = records.filter(Boolean);
  }
  if (!records.length) throw new AppError('NOT_FOUND', 'Нет экспериментов для экспорта', 404);
  const title = String(req.query.title || 'Серия экспериментов').slice(0, 160);
  const base = slug(title);
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${base}-dataset.csv"`);
    res.send(buildDatasetCsv(records));
    return;
  }
  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${base}-dataset.json"`);
    res.send(buildDatasetJson(records));
    return;
  }
  if (format === 'md' || format === 'markdown') {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${base}-summary.md"`);
    res.send(buildDatasetMarkdown(records, title));
    return;
  }
  if (format === 'zip') {
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${base}-dataset.zip"`);
    const archive = await createDatasetZip(records, title);
    archive.on('error', (error) => {
      console.error('[server] dataset zip error', error);
      res.destroy(error);
    });
    archive.pipe(res);
    return;
  }
  throw new AppError('INVALID_FORMAT', 'Неизвестный формат экспорта', 400);
}));

app.use('/api', (req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API-маршрут не найден' } });
});

// Built frontend
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
      else res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

app.use((error, req, res, next) => {
  if (res.headersSent) {
    try { res.end(); } catch { /* ignore */ }
    return;
  }
  let status = error?.status && Number.isInteger(error.status) ? error.status : 500;
  if (error?.code === 'LIMIT_FILE_SIZE') status = 413;
  else if (error?.code === 'LIMIT_FILE_COUNT' || error?.code === 'LIMIT_UNEXPECTED_FILE') status = 400;
  if (error?.code === 'LIMIT_FILE_SIZE') error.message = `Файл больше лимита ${(LIMITS.maxUploadBytes / 1024 / 1024).toFixed(0)} МБ`;
  if (status >= 500) console.error('[server]', error);
  if (req.path.startsWith('/api/')) {
    res.status(status).json({ error: errorPayload(error) });
  } else {
    res.status(status).send(error?.message || 'Ошибка');
  }
});

await ensureStore();
const server = app.listen(PORT, HOST, () => {
  console.log(`\n  Эксперимент ${APP_VERSION} · http://${HOST}:${PORT}\n  Data: ${DATA_DIR}\n  Method: v${METHODOLOGY_VERSION}\n`);
});
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n  Порт ${PORT} уже занят. Запустите с другим портом: PORT=${PORT + 1} ./start.sh\n`);
  } else {
    console.error('[server] server error:', error);
  }
  process.exit(1);
});

function shutdown(signal) {
  console.log(`\n  ${signal}: shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export { app, server };
