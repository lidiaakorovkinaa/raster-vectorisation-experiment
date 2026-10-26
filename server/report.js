import fs from 'node:fs/promises';
import path from 'node:path';
import archiver from 'archiver';
import { PNG } from 'pngjs';
import {
  ENGINE_COLORS,
  ENGINE_IDS,
  METRIC_GROUPS,
  bestRows,
  formatBytes,
  formatMs,
  formatValue,
  isBest,
  paramsRows,
} from './metrics/catalog.js';
import { readExperimentFile } from './store.js';
import { cropRGBA, encodePng } from './image.js';
import { ENGINE_META, METHODOLOGY_VERSION } from './config.js';

const STATUS_LABEL = { ok: 'полный', partial: 'частичный', error: 'ошибка' };
const ENGINE_ORDER = ENGINE_IDS;

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function ruDate(iso) {
  try {
    return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

async function dataUri(record, fileName, fallbackMime = 'image/png') {
  if (!fileName) return null;
  try {
    const buffer = await readExperimentFile(record.id, fileName);
    const ext = path.extname(fileName).slice(1).toLowerCase();
    const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'svg' ? 'image/svg+xml' : fallbackMime;
    return `data:${mime};base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

async function readSvg(record, engine) {
  const file = record.engines?.[engine]?.files?.svg;
  if (!file) return null;
  try {
    return await readExperimentFile(record.id, file);
  } catch {
    return null;
  }
}

function engineLabel(engine) {
  return ENGINE_META[engine]?.name || engine;
}

function metricTable(record, bestMap) {
  let html = '';
  for (const group of METRIC_GROUPS) {
    const availableRows = group.id === 'silhouette'
      ? group.rows.filter((row) => ENGINE_ORDER.some((engine) => Number.isFinite(row.get(record.engines?.[engine] || {}))))
      : group.rows;
    if (!availableRows.length) continue;
    html += `<section class="table-block"><h3>${escapeHtml(group.title)}</h3><p class="note">${escapeHtml(group.note)}</p><table><thead><tr><th>Показатель</th>${ENGINE_ORDER.map((e) => `<th><span class="dot" style="background:${ENGINE_COLORS[e]}"></span>${escapeHtml(engineLabel(e))}</th>`).join('')}</tr></thead><tbody>`;
    for (const row of availableRows) {
      html += `<tr><td>${escapeHtml(row.label)}</td>`;
      for (const engine of ENGINE_ORDER) {
        const item = record.engines?.[engine] || {};
        const value = item.status === 'error' ? null : row.get(item);
        const best = isBest(bestMap, group.id, row.key, engine, value) && row.better !== 'none';
        const formatted = formatValue(value, row.format);
        html += `<td class="${best ? 'best' : ''} ${row.primary ? 'primary' : ''}">${escapeHtml(formatted)}${best ? ' <span class="best-mark">лучшее</span>' : ''}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table></section>';
  }
  return html;
}

function paramsTable(record) {
  const rows = paramsRows(record);
  let html = `<table><thead><tr><th>Параметр</th>${ENGINE_ORDER.map((e) => `<th>${escapeHtml(engineLabel(e))}</th>`).join('')}</tr></thead><tbody>`;
  for (const row of rows) {
    html += `<tr><td>${escapeHtml(row.label)} <code>${escapeHtml(row.key)}</code></td>`;
    for (const engine of ENGINE_ORDER) {
      const value = row.values[engine];
      html += `<td>${escapeHtml(formatParam(value))}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

function formatParam(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'да' : 'нет';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(value);
  return String(value);
}

function sourceTable(record) {
  const s = record.source || {};
  const rows = [
    ['Файл', s.originalName],
    ['Формат', String(s.format || '').toUpperCase()],
    ['Размер источника', `${s.sourceWidth || s.width} × ${s.sourceHeight || s.height} px`],
    ['Рабочее разрешение', `${s.width} × ${s.height} px (${s.megapixels} Мп)`],
    ['Масштаб', s.scale != null ? `${(s.scale * 100).toFixed(1)}%` : '—'],
    ['Фон нормализации', s.background],
    ['Фон метрик', s.qualityBackground || s.background],
    ['Альфа-канал', s.hasAlpha ? `да (${(s.transparentRatio * 100).toFixed(1)}% прозрачных)` : 'нет'],
    ['Ориентация EXIF', s.orientation || 1],
    ['SHA-256 источника', s.normalizedSha256 ? s.normalizedSha256.slice(0, 16) + '…' : '—'],
    ['SHA-256 оригинала', s.originalSha256 ? s.originalSha256.slice(0, 16) + '…' : '—'],
  ];
  return `<table class="kv">${rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v ?? '—')}</td></tr>`).join('')}</table>`;
}

function engineErrorBlock(record) {
  const errors = ENGINE_ORDER.filter((e) => record.engines?.[e]?.status !== 'ok');
  if (!errors.length) return '';
  return `<section class="callout warn"><h3>Неполные результаты</h3><ul>${errors.map((e) => `<li><strong>${escapeHtml(engineLabel(e))}</strong>: ${escapeHtml(record.engines[e]?.error || (record.engines[e]?.status === 'partial' ? 'SVG получен, метрики не рассчитаны' : 'нет результата'))}</li>`).join('')}</ul></section>`;
}

function summaryBlock(record) {
  const best = record.best || {};
  const items = [
    ['Качество (SSIM)', best.quality ? `${engineLabel(best.quality.engine)} · ${formatValue(best.quality.value, 'num4')}` : '—'],
    ['Наименьшая ошибка (RMSE)', best.rmse ? `${engineLabel(best.rmse.engine)} · ${formatValue(best.rmse.value, 'num3')}` : '—'],
    ['Цвет (ΔE2000)', best.color ? `${engineLabel(best.color.engine)} · ${formatValue(best.color.value, 'num3')}` : '—'],
    ['Скорость', best.speed ? `${engineLabel(best.speed.engine)} · ${formatMs(best.speed.value)}` : '—'],
    ['Компактность SVG', best.size ? `${engineLabel(best.size.engine)} · ${formatBytes(best.size.value)}` : '—'],
  ];
  return `<div class="summary-grid">${items.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}</div>`;
}

function barChart(record, metric, label, better = 'min', format = 'ms') {
  const values = ENGINE_ORDER.map((engine) => ({
    engine,
    value: metric(record.engines?.[engine] || {}),
  })).filter((v) => Number.isFinite(v.value));
  if (!values.length) return '';
  const max = Math.max(...values.map((v) => v.value)) || 1;
  return `<div class="chart"><h4>${escapeHtml(label)}</h4>${values.map((v) => {
    const width = Math.max(2, (v.value / max) * 100);
    return `<div class="bar-row"><span class="bar-label"><i style="background:${ENGINE_COLORS[v.engine]}"></i>${escapeHtml(engineLabel(v.engine))}</span><span class="bar-track"><span class="bar" style="width:${width}%;background:${ENGINE_COLORS[v.engine]}"></span></span><span class="bar-value">${escapeHtml(format === 'ms' ? formatMs(v.value) : formatValue(v.value, format))}</span></div>`;
  }).join('')}</div>`;
}

async function figure(record, title, subtitle, content) {
  return `<figure><div class="figure-head"><h3>${escapeHtml(title)}</h3>${subtitle ? `<span>${escapeHtml(subtitle)}</span>` : ''}</div>${content}</figure>`;
}

async function visualGrid(record) {
  const sourceUri = await dataUri(record, record.source?.normalizedFile);
  const cards = [`<div class="visual-card"><div class="visual-head"><span>Источник</span><span>${record.source.width}×${record.source.height}</span></div><div class="visual-body">${sourceUri ? `<img src="${sourceUri}" alt="Исходное изображение"/>` : '<div class="empty">Источник недоступен</div>'}</div></div>`];
  for (const engine of ENGINE_ORDER) {
    const item = record.engines?.[engine];
    const renderUri = await dataUri(record, item?.files?.render);
    const caption = item?.metrics ? `SSIM ${formatValue(item.metrics.ssim, 'num4')} · ΔE00 ${formatValue(item.metrics.deltaE2000, 'num3')}` : (item?.status === 'error' ? 'ошибка' : 'нет метрик');
    cards.push(`<div class="visual-card" style="--engine:${ENGINE_COLORS[engine]}"><div class="visual-head"><span><i class="dot"></i>${escapeHtml(engineLabel(engine))}</span><span>${escapeHtml(caption)}</span></div><div class="visual-body">${renderUri ? `<img src="${renderUri}" alt="${escapeHtml(engineLabel(engine))}"/>` : '<div class="empty">Нет рендера</div>'}</div></div>`);
  }
  return `<div class="visual-grid">${cards.join('')}</div>`;
}

async function vectorFigures(record) {
  let html = '';
  for (const engine of ENGINE_ORDER) {
    const svg = await readSvg(record, engine);
    if (!svg) continue;
    const stats = record.engines?.[engine]?.stats;
    if (stats && stats.bytes > 2.5 * 1024 * 1024) {
      const renderUri = await dataUri(record, record.engines[engine]?.files?.render);
      html += `<figure class="vector-figure"><figcaption>${escapeHtml(engineLabel(engine))} — SVG ${formatBytes(stats.bytes)}, показан растр; векторный файл в ZIP</figcaption>${renderUri ? `<img src="${renderUri}" alt=""/>` : ''}</figure>`;
    } else {
      html += `<figure class="vector-figure" style="--engine:${ENGINE_COLORS[engine]}"><figcaption>${escapeHtml(engineLabel(engine))} — SVG ${formatBytes(stats?.bytes || 0)}, ${stats?.nodes ?? '—'} узлов</figcaption><div class="svg-embed">${svg}</div></figure>`;
    }
  }
  return html;
}

async function diffFigures(record) {
  const rows = [];
  for (const engine of ENGINE_ORDER) {
    const item = record.engines?.[engine];
    if (!item?.files?.heatmap) continue;
    const heat = await dataUri(record, item.files.heatmapFixed || item.files.heatmap);
    const diff = await dataUri(record, item.files.diff);
    const ssim = await dataUri(record, item.files.ssim);
    rows.push(`<div class="diff-card"><h4><i class="dot" style="background:${ENGINE_COLORS[engine]}"></i>${escapeHtml(engineLabel(engine))}</h4><div class="diff-imgs"><figure><img src="${heat}" alt="ΔE00"/><figcaption>ΔE2000, ${item.files.heatmapFixed ? 'шкала 0–20' : 'авто-шкала ' + (item.metrics?.heatmapScale ?? 20)}</figcaption></figure><figure><img src="${diff}" alt="Усиленная разница"/><figcaption>Усиленная разница ×${item.metrics?.diffGain ?? 7}</figcaption></figure><figure><img src="${ssim}" alt="SSIM"/><figcaption>Карта SSIM</figcaption></figure></div></div>`);
  }
  return rows.join('');
}

async function roiSection(record) {
  if (!record.rois?.length) return '';
  let html = '';
  for (const roi of record.rois) {
    const sourcePng = await readExperimentFile(record.id, 'source.png');
    const source = PNG.sync.read(sourcePng);
    const crop = cropRGBA(source.data, source.width, source.height, roi.rect);
    const sourceUri = `data:image/png;base64,${encodePng(crop.rgba, crop.width, crop.height).toString('base64')}`;
    const crops = [`<figure><img src="${sourceUri}" alt=""/><figcaption>Источник</figcaption></figure>`];
    for (const engine of ENGINE_ORDER) {
      const item = record.engines?.[engine];
      if (!item?.files?.render) continue;
      try {
        const render = PNG.sync.read(await readExperimentFile(record.id, item.files.render));
        const rc = cropRGBA(render.data, render.width, render.height, roi.rect);
        crops.push(`<figure><img src="data:image/png;base64,${encodePng(rc.rgba, rc.width, rc.height).toString('base64')}" alt=""/><figcaption>${escapeHtml(engineLabel(engine))}</figcaption></figure>`);
      } catch {
        /* ignore */
      }
    }
    html += `<section class="roi"><h3>${escapeHtml(roi.name)} <small>${roi.rect.w}×${roi.rect.h} @ ${roi.rect.x},${roi.rect.y}</small></h3>${roi.note ? `<p>${escapeHtml(roi.note)}</p>` : ''}<div class="roi-crops">${crops.join('')}</div><table><thead><tr><th>Метрика</th>${ENGINE_ORDER.map((e) => `<th>${escapeHtml(engineLabel(e))}</th>`).join('')}</tr></thead><tbody>`;
    const rows = [['RMSE', 'rmse', 'num3'], ['SSIM', 'ssim', 'num4'], ['ΔE2000', 'deltaE2000', 'num3'], ['ΔE00 p95', 'deltaE2000P95', 'num3'], ['Пиксели ΔE00 > 2.3, %', 'diffJndRatio', 'pct2']];
    for (const [label, key, fmt] of rows) {
      html += `<tr><td>${label}</td>${ENGINE_ORDER.map((e) => `<td>${escapeHtml(formatValue(roi.metrics?.[e]?.[key], fmt))}</td>`).join('')}</tr>`;
    }
    html += '</tbody></table></section>';
  }
  return html;
}

export async function buildReportHtml(record, options = {}) {
  const bestMap = bestRows(record);
  const visual = await visualGrid(record);
  const vectors = await vectorFigures(record);
  const diffs = await diffFigures(record);
  const rois = await roiSection(record);
  const warnings = record.warnings || [];
  const date = ruDate(record.createdAt);
  const source = sourceTable(record);
  const params = paramsTable(record);
  const metrics = metricTable(record, bestMap);
  const charts = [
    barChart(record, (e) => e.timing?.median, 'Медианное время трассировки', 'min', 'ms'),
    barChart(record, (e) => e.metrics?.ssim, 'SSIM (больше — лучше)', 'max', 'num4'),
    barChart(record, (e) => e.stats?.bytes, 'Размер SVG', 'min', 'bytes'),
  ].join('');

  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(record.name)} — отчёт по векторизации</title>
<style>
:root{--ink:#17191c;--muted:#696b66;--paper:#f7f5ef;--line:#ddd8ca;--rust:#c7492b;--blue:#2b6cb0;--green:#1f7a5c;--surface:#fffefb}
*{box-sizing:border-box}
body{margin:0;background:#e8e4d8;color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif}
.page{max-width:1080px;margin:24px auto;background:var(--surface);padding:56px 64px 72px;box-shadow:0 20px 60px rgba(30,25,15,.14)}
.screen-toolbar{position:fixed;right:22px;bottom:22px;display:flex;gap:8px;z-index:10}
.screen-toolbar button{border:1px solid #333;background:#17191c;color:#fff;border-radius:999px;padding:10px 18px;font-size:13px;cursor:pointer}
h1,h2,h3,h4{font-family:Georgia,"Times New Roman",serif;font-weight:600;letter-spacing:-.01em}
h1{font-size:42px;line-height:1.05;margin:8px 0 10px}
h2{font-size:24px;margin:44px 0 14px;padding-top:16px;border-top:1px solid var(--line)}
h3{font-size:17px;margin:22px 0 8px}
h4{font-size:14px;margin:0 0 8px}
p{margin:8px 0}
.eyebrow{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--rust);font-weight:700}
.lede{font-size:18px;color:#3c3e3a;max-width:760px}
.meta{display:flex;flex-wrap:wrap;gap:18px;margin:24px 0 8px;color:var(--muted);font-size:13px}
.badge{display:inline-block;padding:3px 9px;border-radius:999px;font-size:11px;text-transform:uppercase;letter-spacing:.08em;font-weight:700;background:#efe9db}
.badge.ok{background:#e1f0e6;color:#17603f}.badge.partial{background:#f8edd2;color:#7d5a11}.badge.error{background:#f7ded8;color:#8a2d1d}
.summary-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:22px 0}
.summary-grid>div{border:1px solid var(--line);padding:12px;background:#fbf9f3}
.summary-grid span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted)}
.summary-grid strong{display:block;font-size:14px;margin-top:4px}
.grid-2{display:grid;grid-template-columns:1.1fr .9fr;gap:28px;align-items:start}
table{width:100%;border-collapse:collapse;margin:10px 0 18px;font-size:12.5px}
th,td{border-bottom:1px solid var(--line);padding:7px 8px;text-align:left;vertical-align:top}
th{font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);font-weight:700;background:#faf8f2}
tbody tr:hover{background:#fbf9f3}
td.best{background:#e8f3ea;font-weight:700;color:#145235}
.best-mark{font-size:8px;text-transform:uppercase;letter-spacing:.08em;background:#17603f;color:#fff;padding:1px 4px;border-radius:2px;vertical-align:middle}
td.primary{font-weight:600}
.kv th{width:38%;font-size:11px;background:transparent;border-bottom:1px solid #ece8dd}
code{font:11px "SF Mono",Menlo,monospace;color:#6d4a3c}
.note{font-size:11.5px;color:var(--muted);margin:2px 0 8px}
.table-block{break-inside:avoid}
.visual-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin:18px 0}
.visual-card{border:1px solid var(--line);background:#fff;break-inside:avoid}
.visual-card .visual-head{display:flex;justify-content:space-between;gap:8px;padding:7px 10px;font-size:10.5px;border-bottom:1px solid var(--line);color:#4d4f4a;letter-spacing:.03em}
.visual-head i.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--engine,#777);margin-right:5px}
.visual-body{background:conic-gradient(#ece9e0 25%,#faf8f2 0 50%,#ece9e0 0 75%,#faf8f2 0) 0 0/16px 16px;display:flex;align-items:center;justify-content:center;min-height:160px}
.visual-body img{width:100%;height:auto;display:block}
.empty{padding:30px;color:var(--muted);font-size:12px}
.vector-figure{border:1px solid var(--line);padding:12px;margin:14px 0;break-inside:avoid;background:#fff}
.vector-figure figcaption{font-size:11px;color:var(--muted);margin-bottom:8px}
.svg-embed svg{width:100%;height:auto;max-height:340px;display:block}
.diff-card{border:1px solid var(--line);padding:10px;margin:12px 0;break-inside:avoid;background:#fff}
.diff-imgs{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.diff-imgs img{width:100%;display:block;background:#111}
.diff-imgs figcaption{font-size:9.5px;color:var(--muted);margin-top:4px}
.chart{display:inline-block;width:31%;min-width:240px;vertical-align:top;margin:0 2% 18px 0}
.bar-row{display:flex;align-items:center;gap:6px;font-size:10.5px;margin:5px 0}
.bar-label{width:86px;color:#4d4f4a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar-label i{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:4px}
.bar-track{flex:1;height:7px;background:#efece4;border-radius:4px;overflow:hidden}
.bar{display:block;height:100%;border-radius:4px}
.bar-value{width:64px;text-align:right;font-variant-numeric:tabular-nums;color:#333}
.callout{border:1px solid var(--line);padding:14px 16px;margin:18px 0;background:#fbf9f3;break-inside:avoid}
.callout.warn{border-left:3px solid #b87916;background:#fdf8ec}
.callout h3{margin:0 0 6px}
.callout ul{margin:6px 0 0;padding-left:18px;font-size:12.5px}
.roi{border-top:1px dashed var(--line);margin-top:24px;padding-top:8px;break-inside:avoid}
.roi small{font:11px monospace;color:var(--muted)}
.roi-crops{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
.roi-crops figure{margin:0;border:1px solid var(--line);background:#fff;max-width:160px}
.roi-crops img{max-width:160px;display:block}
.roi-crops figcaption{font-size:9.5px;padding:3px 5px;color:var(--muted)}
footer{margin-top:50px;border-top:1px solid var(--line);padding-top:14px;font-size:10.5px;color:var(--muted);display:flex;justify-content:space-between;gap:20px}
@media print{
  body{background:#fff}.page{box-shadow:none;margin:0;padding:0;max-width:none}
  .screen-toolbar{display:none}
  h2{break-after:avoid}.visual-grid{break-inside:avoid}
  @page{size:A4;margin:14mm}
}
@media (max-width:800px){.page{padding:28px 20px}.summary-grid{grid-template-columns:1fr 1fr}.grid-2{grid-template-columns:1fr}.visual-grid{grid-template-columns:1fr}.chart{width:100%}}
</style>
</head>
<body>
<div class="page">
  <div class="eyebrow">Сравнительная векторизация · отчёт ${escapeHtml(String(METHODOLOGY_VERSION))}</div>
  <h1>${escapeHtml(record.name)}</h1>
  <div class="meta">
    <span>${escapeHtml(date)}</span>
    <span>Автор: ${escapeHtml(record.author || '—')}</span>
    <span class="badge ${escapeHtml(record.status)}">${escapeHtml(STATUS_LABEL[record.status] || record.status)}</span>
    ${(record.tags || []).map((t) => `<span>#${escapeHtml(t)}</span>`).join('')}
  </div>
  <p class="lede">Сравнение трёх алгоритмов векторизации на одном нормализованном растре: ${escapeHtml(record.source.originalName)}. Одинаковые пиксели на входе, одинаковый рендерер для метрик и независимые замеры времени.</p>
  ${summaryBlock(record)}
  ${warnings.length ? `<section class="callout warn"><h3>Замечания к эксперименту</h3><ul>${warnings.map((w) => `<li>${escapeHtml(w.message)}</li>`).join('')}</ul></section>` : ''}

  <h2>1. Исходные данные и метод</h2>
  <div class="grid-2"><div>${source}</div><div><h3>Конфигурация</h3><table class="kv">
    <tr><th>Повторов (измерения)</th><td>${record.config.repetitions}</td></tr>
    <tr><th>Прогрев</th><td>${record.config.warmup} прогон(а)</td></tr>
    <tr><th>Порог Potrace</th><td>${record.params.potrace.thresholdMode === 'auto' ? 'авто Оцу' : 'вручную'} → ${record.timing.resolvedThreshold}</td></tr>
    <tr><th>Длительность</th><td>${formatMs(record.timing.durationMs)} (анализ ${formatMs(record.timing.analysisMs)})</td></tr>
    <tr><th>Порядок движков</th><td>${(record.timing.engineOrder || ENGINE_ORDER).map(engineLabel).join(' → ')}</td></tr>
    <tr><th>Повторов при перезапуске</th><td>${record.timing.workerRestarts || 0}</td></tr>
  </table></div></div>
  <h3>Параметры алгоритмов</h3>
  ${params}

  <h2>2. Визуальное сравнение</h2>
  ${visual}
  <h3>Векторные результаты</h3>
  ${vectors}

  <h2>3. Количественные метрики</h2>
  <div class="chart-row">${charts}</div>
  ${metrics}

  <h2>4. Карты различий</h2>
  <p class="note">Тепловая карта ΔE2000 показывает воспринимаемое цветовое расхождение; усиленная разница — абсолютные RGB-отклонения; карта SSIM — локальную структурную похожесть.</p>
  ${diffs}
  ${rois ? `<h2>5. Исследованные области (ROI)</h2>${rois}` : ''}

  <h2>${rois ? '6' : '5'}. Ограничения и методика</h2>
  <div class="grid-2">
    <div>
      <h3>Как измерялось</h3>
      <p class="note">${escapeHtml(record.methodology?.timing)}</p>
      <p class="note">${escapeHtml(record.methodology?.quality)}</p>
      <p class="note">${escapeHtml(record.methodology?.inputNormalization)}</p>
      <h3>Ограничения</h3>
      <ul class="note">
        <li>Potrace — бинарный трассировщик: он не воспроизводит цвет, поэтому цветовые метрики (SSIM, ΔE) не являются для него «проигрышем» в том же смысле, что для цветных движков. Сопоставляйте его прежде всего по силуэту, узлам и скорости.</li>
        <li>ImageTracer и VTracer имеют разные модели цвета/слоёв; параметры подобраны как стартовые, а не как результат оптимизации под конкретное изображение.</li>
        <li>Время зависит от машины, JIT-прогрева и фона процессов; сравнивайте медианы внутри одного запуска, а не абсолютные значения между сессиями.</li>
        <li>SSIM считается по яркости в окне 11×11 (гауссово, σ=1.5), ΔE2000 — попиксельно после композитинга на фон метрик.</li>
      </ul>
    </div>
    <div>
      <h3>Воспроизводимость</h3>
      <table class="kv">
        <tr><th>Сравнение векторизации</th><td>${escapeHtml(record.environment.appVersion)}</td></tr>
        <tr><th>Методика</th><td>${escapeHtml(record.methodology.version)}</td></tr>
        <tr><th>Node.js</th><td>${escapeHtml(record.environment.node)}</td></tr>
        <tr><th>Платформа</th><td>${escapeHtml(record.environment.platform)} / ${escapeHtml(record.environment.arch)}</td></tr>
        <tr><th>CPU</th><td>${escapeHtml(record.environment.cpu)} · ${record.environment.cores} ядер</td></tr>
        <tr><th>RAM</th><td>${record.environment.totalMemoryMB} МБ</td></tr>
        <tr><th>Potrace</th><td>${escapeHtml(ENGINE_META.potrace.version)}</td></tr>
        <tr><th>ImageTracer</th><td>${escapeHtml(ENGINE_META.imagetracer.version)}</td></tr>
        <tr><th>VTracer</th><td>${escapeHtml(ENGINE_META.vtracer.version)}</td></tr>
        <tr><th>resvg</th><td>2.6.2 (WASM)</td></tr>
      </table>
      <h3>Файлы</h3>
      <p class="note">SVG каждого движка, растр-рендеры, карты различий, source.png и original сохранены в папке эксперимента и в ZIP-экспорте. Контрольные суммы: source ${escapeHtml((record.source.normalizedSha256 || '').slice(0, 20))}…</p>
    </div>
  </div>

  ${record.notes ? `<h2>Примечания</h2><p>${escapeHtml(record.notes).replace(/\n/g, '<br/>')}</p>` : ''}

  <footer><span>эксперимент ${escapeHtml(record.id)}</span><span>Сформировано ${escapeHtml(new Date().toLocaleString('ru-RU'))}</span></footer>
</div>
<div class="screen-toolbar"><button onclick="window.print()">Печать / PDF</button></div>
</body>
</html>`;
  return html;
}

export function buildReportMarkdown(record) {
  const bestMap = bestRows(record);
  const lines = [];
  lines.push(`# ${record.name}`, '');
  lines.push(`**Сравнительная векторизация**`, '');
  lines.push(`- Дата: ${ruDate(record.createdAt)}`);
  lines.push(`- Автор: ${record.author || '—'}`);
  lines.push(`- Статус: ${STATUS_LABEL[record.status] || record.status}`);
  lines.push(`- Источник: ${record.source.originalName} (${record.source.width}×${record.source.height}, ${record.source.megapixels} Мп)`);
  lines.push(`- Теги: ${(record.tags || []).map((t) => '#' + t).join(' ') || '—'}`, '');
  if (record.notes) lines.push(record.notes, '');
  lines.push('## Сводка', '');
  const b = record.best || {};
  lines.push('| Показатель | Победитель | Значение |', '|---|---|---|');
  if (b.quality) lines.push(`| Качество (SSIM) | ${engineLabel(b.quality.engine)} | ${formatValue(b.quality.value, 'num4')} |`);
  if (b.speed) lines.push(`| Скорость | ${engineLabel(b.speed.engine)} | ${formatMs(b.speed.value)} |`);
  if (b.size) lines.push(`| Компактность | ${engineLabel(b.size.engine)} | ${formatBytes(b.size.value)} |`);
  lines.push('');
  lines.push('## Параметры', '');
  const prow = paramsRows(record);
  lines.push('| Параметр | ' + ENGINE_ORDER.map(engineLabel).join(' | ') + ' |');
  lines.push('|---|' + ENGINE_ORDER.map(() => '---').join('|') + '|');
  for (const row of prow) lines.push(`| ${row.label} | ${ENGINE_ORDER.map((e) => formatParam(row.values[e])).join(' | ')} |`);
  lines.push('');
  for (const group of METRIC_GROUPS) {
    const rows = group.id === 'silhouette'
      ? group.rows.filter((row) => ENGINE_ORDER.some((engine) => Number.isFinite(row.get(record.engines?.[engine] || {}))))
      : group.rows;
    if (!rows.length) continue;
    lines.push(`## ${group.title}`, '', group.note, '');
    lines.push('| Показатель | ' + ENGINE_ORDER.map(engineLabel).join(' | ') + ' |');
    lines.push('|---|' + ENGINE_ORDER.map(() => '---').join('|') + '|');
    for (const row of rows) {
      const cells = ENGINE_ORDER.map((engine) => {
        const item = record.engines?.[engine] || {};
        const value = item.status === 'error' ? null : row.get(item);
        const text = formatValue(value, row.format);
        return isBest(bestMap, group.id, row.key, engine, value) ? `**${text}**` : text;
      });
      lines.push(`| ${row.label} | ${cells.join(' | ')} |`);
    }
    lines.push('');
  }
  lines.push('## Визуальные материалы', '');
  lines.push('В ZIP-архиве: `render-<engine>.png`, `heatmap-<engine>.png`, `diff-<engine>.png`, `ssim-<engine>.png`, `svg-<engine>.svg`.');
  lines.push('');
  if (record.rois?.length) {
    lines.push('## ROI', '');
    for (const roi of record.rois) lines.push(`### ${roi.name} (${roi.rect.w}×${roi.rect.h} @ ${roi.rect.x},${roi.rect.y})`, '', roi.note || '');
  }
  lines.push('## Ограничения', '');
  lines.push('- Potrace — бинарный трассировщик; цветовые метрики для него носят справочный характер.');
  lines.push('- Время — медиана вызовов движка после прогрева, без декодирования и растеризации.');
  lines.push('- SSIM: 11×11 Gaussian σ=1.5; ΔE2000: попиксельно; фон композитинга — ' + (record.source.qualityBackground || record.source.background) + '.');
  lines.push('');
  lines.push(`_Сформировано ${new Date().toLocaleString('ru-RU')}; методика ${record.methodology.version}._`);
  return lines.join('\n');
}

export function buildCsv(record) {
  const params = flattenRecordParams(record.params);
  const keys = [
    'experiment_id', 'experiment_name', 'created_at', 'status', 'source_name', 'source_width', 'source_height', 'megapixels',
    'engine', 'engine_version', 'engine_status', 'median_ms', 'mean_ms', 'min_ms', 'max_ms', 'std_ms', 'cv_percent', 'samples_ms',
    'svg_bytes', 'svg_gzip_bytes', 'paths', 'subpaths', 'nodes', 'segments', 'curves', 'control_points', 'colors', 'coordinate_precision', 'path_length_px',
    'rmse', 'mae', 'psnr', 'ssim', 'ssim_p05', 'delta_e76', 'delta_e2000', 'delta_e2000_p95', 'diff_jnd_ratio', 'diff5_ratio', 'exact_rgb_ratio',
    'coverage', 'silhouette_iou', 'silhouette_dice', 'silhouette_precision', 'silhouette_recall', 'deterministic', 'svg_sha1',
    ...Object.keys(params),
  ];
  const rows = [];
  for (const engine of ENGINE_ORDER) {
    const item = record.engines?.[engine] || {};
    const t = item.timing || {};
    const s = item.stats || {};
    const m = item.metrics || {};
    rows.push({
      experiment_id: record.id,
      experiment_name: record.name,
      created_at: record.createdAt,
      status: record.status,
      source_name: record.source.originalName,
      source_width: record.source.width,
      source_height: record.source.height,
      megapixels: record.source.megapixels,
      engine,
      engine_version: ENGINE_META[engine].version,
      engine_status: item.status,
      median_ms: t.median ?? '',
      mean_ms: t.mean ?? '',
      min_ms: t.min ?? '',
      max_ms: t.max ?? '',
      std_ms: t.std ?? '',
      cv_percent: t.cv ?? '',
      samples_ms: (t.samples || []).join(';'),
      svg_bytes: s.bytes ?? '',
      svg_gzip_bytes: s.gzipBytes ?? '',
      paths: s.paths ?? '',
      subpaths: s.subpaths ?? '',
      nodes: s.nodes ?? '',
      segments: s.segments ?? '',
      curves: s.curves ?? '',
      control_points: s.controlPoints ?? '',
      colors: m.colors ?? '',
      coordinate_precision: s.coordinatePrecision ?? '',
      path_length_px: s.pathLengthPx ?? '',
      rmse: m.rmse ?? '',
      mae: m.mae ?? '',
      psnr: m.psnr ?? '',
      ssim: m.ssim ?? '',
      ssim_p05: m.ssimP05 ?? '',
      delta_e76: m.deltaE76 ?? '',
      delta_e2000: m.deltaE2000 ?? '',
      delta_e2000_p95: m.deltaE2000P95 ?? '',
      diff_jnd_ratio: m.diffJndRatio ?? '',
      diff5_ratio: m.diff5Ratio ?? '',
      exact_rgb_ratio: m.exactPixelRatio ?? '',
      coverage: m.coverage ?? '',
      silhouette_iou: m.silhouette?.iou ?? '',
      silhouette_dice: m.silhouette?.dice ?? '',
      silhouette_precision: m.silhouette?.precision ?? '',
      silhouette_recall: m.silhouette?.recall ?? '',
      deterministic: item.deterministic ?? '',
      svg_sha1: s.sha1 ?? '',
      ...params,
    });
  }
  return '\uFEFF' + toCsv(keys, rows);
}

function flattenRecordParams(params) {
  const out = {};
  for (const engine of ENGINE_ORDER) {
    for (const [key, value] of Object.entries(params?.[engine] || {})) {
      if (key === 'resolvedThreshold') continue;
      out[`param_${engine}_${key}`] = value;
    }
  }
  return out;
}

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

export function toCsv(headers, rows) {
  return [headers.join(','), ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(','))].join('\r\n') + '\r\n';
}

export function buildLatex(record) {
  const rows = [
    { label: 'RMSE ↓', get: (e) => e.metrics?.rmse, format: 'num3', better: 'min' },
    { label: 'SSIM ↑', get: (e) => e.metrics?.ssim, format: 'num4', better: 'max' },
    { label: 'ΔE2000 ↓', get: (e) => e.metrics?.deltaE2000, format: 'num3', better: 'min' },
    { label: 'IoU (Оцу) ↑', get: (e) => e.metrics?.silhouette?.iou, format: 'num4', better: 'max' },
    { label: 'Время, мс ↓', get: (e) => e.timing?.median, format: 'num2', better: 'min' },
    { label: 'SVG, КБ ↓', get: (e) => (e.stats?.bytes ? e.stats.bytes / 1024 : null), format: 'num1', better: 'min' },
  ];
  const lines = [];
  lines.push('% Требуется \\usepackage{booktabs}');
  lines.push('% Для кириллицы: XeLaTeX/LuaLaTeX или \\usepackage[utf8]{inputenc} + \\usepackage[russian]{babel}');
  lines.push('\\begin{table}[htbp]');
  lines.push('\\centering');
  lines.push(`\\caption{Сравнение алгоритмов векторизации: ${escapeLatex(record.name)}}`);
  lines.push('\\begin{tabular}{l' + 'r'.repeat(ENGINE_ORDER.length) + '}');
  lines.push('\\toprule');
  lines.push('Показатель & ' + ENGINE_ORDER.map(engineLabel).join(' & ') + ' \\\\');
  lines.push('\\midrule');
  for (const row of rows) {
    const values = ENGINE_ORDER.map((engine) => Number(row.get(record.engines?.[engine] || {})));
    const finite = values.map((v, i) => ({ v, i })).filter((x) => Number.isFinite(x.v));
    let bestIndex = -1;
    if (finite.length) {
      let best = finite[0];
      for (const cand of finite.slice(1)) {
        if (row.better === 'max' ? cand.v > best.v : cand.v < best.v) best = cand;
      }
      bestIndex = best.i;
    }
    const cells = ENGINE_ORDER.map((engine, index) => {
      const value = Number.isFinite(values[index]) ? values[index] : null;
      const text = escapeLatex(latexNumber(value, row.format));
      return index === bestIndex && finite.length > 1 ? `\\textbf{${text}}` : text;
    });
    lines.push(`${escapeLatex(row.label)} & ${cells.join(' & ')} \\\\`);
  }
  lines.push('\\bottomrule');
  lines.push('\\end{tabular}');
  lines.push('\\end{table}');
  return lines.join('\n');
}

function bestMapValue(record, engine, key) {
  const map = {
    rmse: 'quality:rmse',
    ssim: 'quality:ssim',
    deltaE2000: 'quality:deltaE2000',
    'silhouette.iou': 'silhouette:silhouette.iou',
    'timing.median': 'performance:timing.median',
    'stats.bytes': 'files:stats.bytes',
  };
  const best = record.best;
  return Boolean(best && map[key] && best[key.split('.')[0]]?.engine === engine);
}

function latexNumber(value, format) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const v = Number(value);
  if (format === 'num1') return v.toFixed(1);
  if (format === 'num2') return v.toFixed(2);
  if (format === 'num3') return v.toFixed(3);
  if (format === 'num4') return v.toFixed(4);
  return String(v);
}

function escapeLatex(text) {
  return String(text ?? '').replace(/[\\&%$#_{}]/g, (m) => '\\' + m);
}

export async function buildJsonExport(record) {
  const svgs = {};
  for (const engine of ENGINE_ORDER) {
    const svg = await readSvg(record, engine);
    if (svg) svgs[engine] = svg;
  }
  return JSON.stringify({ ...record, assets: { svgs } }, null, 2);
}

export function buildDatasetJson(records) {
  return JSON.stringify({ generatedAt: new Date().toISOString(), count: records.length, aggregate: aggregateRecords(records), experiments: records }, null, 2);
}

export function aggregateRecords(records) {
  const out = {};
  for (const engine of ENGINE_ORDER) {
    const rows = records.map((r) => r.engines?.[engine]).filter((e) => e && e.status === 'ok' && e.metrics);
    const avg = (fn) => rows.length ? rows.reduce((a, e) => a + (fn(e) || 0), 0) / rows.length : null;
    out[engine] = {
      count: rows.length,
      meanRmse: avg((e) => e.metrics.rmse),
      meanSsim: avg((e) => e.metrics.ssim),
      meanDeltaE2000: avg((e) => e.metrics.deltaE2000),
      meanMedianMs: avg((e) => e.timing?.median),
      meanBytes: avg((e) => e.stats?.bytes),
      winsQuality: records.filter((r) => r.best?.quality?.engine === engine).length,
      winsSpeed: records.filter((r) => r.best?.speed?.engine === engine).length,
      winsSize: records.filter((r) => r.best?.size?.engine === engine).length,
    };
  }
  return out;
}

export function buildDatasetMarkdown(records, title = 'Серия экспериментов') {
  const agg = aggregateRecords(records);
  const lines = [`# ${title}`, '', `Экспериментов: ${records.length}. Сформировано ${new Date().toLocaleString('ru-RU')}.`, ''];
  lines.push('## Средние значения', '', '| Движок | N | RMSE | SSIM | ΔE2000 | Время, мс | SVG | Побед по качеству | Побед по скорости |', '|---|---|---|---|---|---|---|---|---|');
  for (const engine of ENGINE_ORDER) {
    const a = agg[engine];
    lines.push(`| ${engineLabel(engine)} | ${a.count} | ${formatValue(a.meanRmse, 'num3')} | ${formatValue(a.meanSsim, 'num4')} | ${formatValue(a.meanDeltaE2000, 'num3')} | ${formatValue(a.meanMedianMs, 'num2')} | ${formatValue(a.meanBytes, 'bytes')} | ${a.winsQuality} | ${a.winsSpeed} |`);
  }
  lines.push('', '## Эксперименты', '', '| Эксперимент | Дата | Статус | Лучшее качество | Быстрейший | Компактнейший |', '|---|---|---|---|---|---|');
  for (const r of records) {
    lines.push(`| ${r.name} | ${ruDate(r.createdAt)} | ${STATUS_LABEL[r.status] || r.status} | ${r.best?.quality ? engineLabel(r.best.quality.engine) : '—'} | ${r.best?.speed ? engineLabel(r.best.speed.engine) : '—'} | ${r.best?.size ? engineLabel(r.best.size.engine) : '—'} |`);
  }
  return lines.join('\n');
}

export function buildDatasetCsv(records) {
  const headers = [
    'experiment_id', 'experiment_name', 'created_at', 'status', 'batch_id', 'source_name', 'width', 'height', 'megapixels',
    'engine', 'engine_status', 'rmse', 'ssim', 'delta_e2000', 'silhouette_iou', 'median_ms', 'svg_bytes', 'nodes', 'paths', 'best_quality', 'best_speed', 'best_size',
  ];
  const rows = [];
  for (const r of records) {
    for (const engine of ENGINE_ORDER) {
      const e = r.engines?.[engine] || {};
      rows.push({
        experiment_id: r.id,
        experiment_name: r.name,
        created_at: r.createdAt,
        status: r.status,
        batch_id: r.batchId || '',
        source_name: r.source?.originalName,
        width: r.source?.width,
        height: r.source?.height,
        megapixels: r.source?.megapixels,
        engine,
        engine_status: e.status || '',
        rmse: e.metrics?.rmse ?? '',
        ssim: e.metrics?.ssim ?? '',
        delta_e2000: e.metrics?.deltaE2000 ?? '',
        silhouette_iou: e.metrics?.silhouette?.iou ?? '',
        median_ms: e.timing?.median ?? '',
        svg_bytes: e.stats?.bytes ?? '',
        nodes: e.stats?.nodes ?? '',
        paths: e.stats?.paths ?? '',
        best_quality: r.best?.quality?.engine || '',
        best_speed: r.best?.speed?.engine || '',
        best_size: r.best?.size?.engine || '',
      });
    }
  }
  return '\uFEFF' + toCsv(headers, rows);
}

export async function createExperimentZip(record) {
  const archive = archiver('zip', { zlib: { level: 9 } });
  const base = `experiment-${record.id}`;
  archive.append(await buildReportHtml(record), { name: `${base}/report.html` });
  archive.append(buildReportMarkdown(record), { name: `${base}/report.md` });
  archive.append(buildCsv(record), { name: `${base}/metrics.csv` });
  archive.append(buildLatex(record), { name: `${base}/table.tex` });
  archive.append(await buildJsonExport(record), { name: `${base}/experiment.json` });
  archive.append(record.notes || '', { name: `${base}/notes.txt` });
  for (const file of ['source.png', 'thumb.png']) {
    try {
      archive.append(await readExperimentFile(record.id, file), { name: `${base}/${file}` });
    } catch {
      /* ignore */
    }
  }
  if (record.source?.originalFile) {
    try {
      archive.append(await readExperimentFile(record.id, record.source.originalFile), { name: `${base}/${record.source.originalFile}` });
    } catch {
      /* ignore */
    }
  }
  for (const engine of ENGINE_ORDER) {
    const item = record.engines?.[engine];
    if (!item?.files) continue;
    for (const [kind, file] of Object.entries(item.files)) {
      try {
        archive.append(await readExperimentFile(record.id, file), { name: `${base}/${engine}/${file}` });
      } catch {
        /* ignore */
      }
    }
  }
  archive.append(JSON.stringify(record.rois || [], null, 2), { name: `${base}/rois.json` });
  archive.append(zipReadme(record), { name: `${base}/README.md` });
  archive.finalize();
  return archive;
}

export async function createDatasetZip(records, title = 'experiments') {
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.append(buildDatasetCsv(records), { name: 'dataset.csv' });
  archive.append(buildDatasetJson(records), { name: 'dataset.json' });
  archive.append(buildDatasetMarkdown(records, title), { name: 'summary.md' });
  for (const record of records) {
    const base = `experiments/${record.id}`;
    archive.append(await buildReportHtml(record), { name: `${base}/report.html` });
    archive.append(await buildJsonExport(record), { name: `${base}/experiment.json` });
    archive.append(buildCsv(record), { name: `${base}/metrics.csv` });
    for (const file of ['source.png']) {
      try {
        archive.append(await readExperimentFile(record.id, file), { name: `${base}/${file}` });
      } catch {
        /* ignore */
      }
    }
    for (const engine of ENGINE_ORDER) {
      const item = record.engines?.[engine];
      if (!item?.files) continue;
      for (const [kind, file] of Object.entries(item.files)) {
        try {
          archive.append(await readExperimentFile(record.id, file), { name: `${base}/${engine}/${file}` });
        } catch {
          /* ignore */
        }
      }
    }
  }
  archive.finalize();
  return archive;
}

function zipReadme(record) {
  return `# Сравнение векторизации — ${record.name}

Эксперимент: ${record.id}
Дата: ${ruDate(record.createdAt)}
Статус: ${STATUS_LABEL[record.status] || record.status}
Источник: ${record.source.originalName} (${record.source.width}×${record.source.height})

## Состав архива
- report.html — автономный отчёт с таблицами, SVG и картами различий (открывается в браузере, печать в PDF).
- report.md — текстовая версия.
- metrics.csv — таблица метрик (по строке на движок), UTF-8 BOM, открывается в Excel.
- table.tex — LaTeX-таблица (booktabs).
- experiment.json — полное описание эксперимента + SVG-исходники.
- source.png / original.* — нормализованный и исходный растры.
- <engine>/ — SVG, рендер, heatmap (ΔE2000), diff, ssim.
- rois.json — сохранённые области и их метрики.

## Методика
Время: ${record.methodology?.timing}
Качество: ${record.methodology?.quality}
Нормализация: ${record.methodology?.inputNormalization}

## Ограничения
Potrace — бинарный трассировщик; его цветовые метрики следует рассматривать как справочные. Абсолютные времена зависят от машины.
`;
}
