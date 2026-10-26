import type { EngineId, EngineRecord, ExperimentRecord, QualityMetrics } from '@/types';

export const ENGINE_IDS: EngineId[] = ['potrace', 'imagetracer', 'vtracer'];

export const ENGINE_COLORS: Record<EngineId, string> = {
  potrace: '#C7492B',
  imagetracer: '#2B6CB0',
  vtracer: '#1F7A5C',
};

export const ENGINE_NAMES: Record<EngineId, string> = {
  potrace: 'Potrace',
  imagetracer: 'ImageTracer',
  vtracer: 'VTracer',
};

export const ENGINE_TAGLINES: Record<EngineId, string> = {
  potrace: 'бинарный · кривые Безье',
  imagetracer: 'цвет · квантизация',
  vtracer: 'цвет · иерархия · WASM',
};

export type MetricFormat = 'int' | 'num1' | 'num2' | 'num3' | 'num4' | 'num5' | 'pct' | 'pct2' | 'bytes' | 'ms' | 'text' | 'bool';

export interface MetricRow {
  key: string;
  label: string;
  get: (engine: EngineRecord) => number | string | boolean | null | undefined;
  format: MetricFormat;
  better: 'min' | 'max' | 'none';
  primary?: boolean;
  hint?: string;
}

export interface MetricGroup {
  id: string;
  title: string;
  note: string;
  rows: MetricRow[];
}

const metric = (m: QualityMetrics | null | undefined, key: keyof QualityMetrics) => m?.[key] as number | undefined;

export const METRIC_GROUPS: MetricGroup[] = [
  {
    id: 'quality',
    title: 'Качество воспроизведения',
    note: 'Попиксельное сравнение рендера SVG с нормализованным источником. Для ошибок меньше — лучше, для схожести — больше.',
    rows: [
      { key: 'rmse', label: 'RMSE (0–255)', get: (e) => metric(e.metrics, 'rmse'), format: 'num3', better: 'min', primary: true, hint: 'Среднеквадратичная ошибка по каналам RGB.' },
      { key: 'mae', label: 'MAE (0–255)', get: (e) => metric(e.metrics, 'mae'), format: 'num3', better: 'min', hint: 'Средняя абсолютная ошибка по каналам RGB.' },
      { key: 'psnr', label: 'PSNR, дБ', get: (e) => metric(e.metrics, 'psnr'), format: 'num2', better: 'max', hint: 'Пиковое отношение сигнал/шум по RMSE; 99 дБ означает точное совпадение.' },
      { key: 'ssim', label: 'SSIM (среднее)', get: (e) => metric(e.metrics, 'ssim'), format: 'num4', better: 'max', primary: true, hint: 'Структурная похожесть по яркости, окно 11×11 Gaussian σ=1.5. 1 — идеально.' },
      { key: 'ssimP05', label: 'SSIM p05', get: (e) => metric(e.metrics, 'ssimP05'), format: 'num4', better: 'max', hint: 'Пятый процентиль карты SSIM — устойчивость худших локальных участков.' },
      { key: 'deltaE2000', label: 'ΔE2000 (среднее)', get: (e) => metric(e.metrics, 'deltaE2000'), format: 'num3', better: 'min', primary: true, hint: 'Среднее воспринимаемое цветовое различие CIEDE2000; 0 — идентично.' },
      { key: 'deltaE76', label: 'ΔE76 (среднее)', get: (e) => metric(e.metrics, 'deltaE76'), format: 'num3', better: 'min', hint: 'Евклидово расстояние в CIELAB (устаревшая, но прозрачная метрика).' },
      { key: 'deltaE2000P95', label: 'ΔE2000 p95', get: (e) => metric(e.metrics, 'deltaE2000P95'), format: 'num3', better: 'min', hint: '95-й процентиль цветового различия.' },
      { key: 'diffJndRatio', label: 'Пиксели ΔE00 > 2.3, %', get: (e) => metric(e.metrics, 'diffJndRatio'), format: 'pct2', better: 'min', hint: 'Доля пикселей выше порога заметности (JND).' },
      { key: 'diff5Ratio', label: 'Пиксели ΔE00 > 5, %', get: (e) => metric(e.metrics, 'diff5Ratio'), format: 'pct2', better: 'min' },
      { key: 'diffRgb16Ratio', label: 'Пиксели RGB Δ > 16, %', get: (e) => metric(e.metrics, 'diffRgb16Ratio'), format: 'pct2', better: 'min' },
      { key: 'exactPixelRatio', label: 'Точное совпадение RGB, %', get: (e) => metric(e.metrics, 'exactPixelRatio'), format: 'pct2', better: 'max' },
      { key: 'coverage', label: 'Покрытие непрозрачных областей, %', get: (e) => metric(e.metrics, 'coverage'), format: 'pct2', better: 'none' },
    ],
  },
  {
    id: 'silhouette',
    title: 'Силуэт (маска Оцу)',
    note: 'Сравнение формы с бинарной маской источника по порогу Оцу. Наиболее корректно для Potrace и бинарного режима VTracer; для цветных движков — справочно.',
    rows: [
      { key: 'silhouette.iou', label: 'IoU', get: (e) => e.metrics?.silhouette?.iou, format: 'num4', better: 'max', primary: true },
      { key: 'silhouette.dice', label: 'Dice / F1', get: (e) => e.metrics?.silhouette?.dice, format: 'num4', better: 'max' },
      { key: 'silhouette.precision', label: 'Точность (precision)', get: (e) => e.metrics?.silhouette?.precision, format: 'num4', better: 'max' },
      { key: 'silhouette.recall', label: 'Полнота (recall)', get: (e) => e.metrics?.silhouette?.recall, format: 'num4', better: 'max' },
      { key: 'silhouette.accuracy', label: 'Accuracy', get: (e) => e.metrics?.silhouette?.accuracy, format: 'num4', better: 'max' },
    ],
  },
  {
    id: 'structure',
    title: 'Структура и сложность SVG',
    note: 'Описание выхода, а не оценка «лучше/хуже»: меньше узлов — компактнее, но может быть грубее.',
    rows: [
      { key: 'paths', label: 'Элементов <path>', get: (e) => e.stats?.paths, format: 'int', better: 'none' },
      { key: 'subpaths', label: 'Подконтуров (M)', get: (e) => e.stats?.subpaths, format: 'int', better: 'none' },
      { key: 'nodes', label: 'Опорных узлов', get: (e) => e.stats?.nodes, format: 'int', better: 'none' },
      { key: 'segments', label: 'Сегментов', get: (e) => e.stats?.segments, format: 'int', better: 'none' },
      { key: 'lines', label: 'Прямых сегментов', get: (e) => e.stats?.lines, format: 'int', better: 'none' },
      { key: 'curves', label: 'Кривых (C/Q/A)', get: (e) => e.stats?.curves, format: 'int', better: 'none' },
      { key: 'controlPoints', label: 'Контрольных точек', get: (e) => e.stats?.controlPoints, format: 'int', better: 'none' },
      { key: 'colors', label: 'Уникальных цветов (квант. 5 бит)', get: (e) => e.metrics?.colors, format: 'int', better: 'none' },
      { key: 'coordinatePrecision', label: 'Точность координат, знаков', get: (e) => e.stats?.coordinatePrecision, format: 'int', better: 'none' },
      { key: 'pathLengthPx', label: 'Длина контуров, px', get: (e) => e.stats?.pathLengthPx, format: 'num1', better: 'none' },
      { key: 'meanSegmentPx', label: 'Средний сегмент, px', get: (e) => e.stats?.meanSegmentPx, format: 'num2', better: 'none' },
      { key: 'nodesPerMegapixel', label: 'Узлов на Мп', get: (e) => e.stats?.nodesPerMegapixel, format: 'num1', better: 'none' },
      { key: 'gradients', label: 'Градиентов', get: (e) => e.stats?.gradients, format: 'int', better: 'none' },
      { key: 'invalidPaths', label: 'Некорректных путей', get: (e) => e.stats?.invalidPaths, format: 'int', better: 'none' },
    ],
  },
  {
    id: 'performance',
    title: 'Производительность',
    note: 'Время только вызова движка после прогрева: без декодирования PNG, растеризации, записи и HTTP. Порядок движков ротируется между прогонами.',
    rows: [
      { key: 'timing.median', label: 'Медиана, мс', get: (e) => e.timing?.median, format: 'num2', better: 'min', primary: true },
      { key: 'timing.mean', label: 'Среднее, мс', get: (e) => e.timing?.mean, format: 'num2', better: 'min' },
      { key: 'timing.min', label: 'Минимум, мс', get: (e) => e.timing?.min, format: 'num2', better: 'min' },
      { key: 'timing.max', label: 'Максимум, мс', get: (e) => e.timing?.max, format: 'num2', better: 'min' },
      { key: 'timing.std', label: 'Ст. отклонение, мс', get: (e) => e.timing?.std, format: 'num2', better: 'min' },
      { key: 'timing.cv', label: 'Коэф. вариации CV, %', get: (e) => e.timing?.cv, format: 'num2', better: 'min' },
      { key: 'samples', label: 'Все прогоны, мс', get: (e) => e.timing?.samples?.join(' · '), format: 'text', better: 'none' },
    ],
  },
  {
    id: 'files',
    title: 'Выходные файлы',
    note: 'Размер хранимого SVG и сжатие gzip. Меньше — компактнее, но размер не равен качеству.',
    rows: [
      { key: 'stats.bytes', label: 'SVG, байт', get: (e) => e.stats?.bytes, format: 'bytes', better: 'min', primary: true },
      { key: 'stats.gzipBytes', label: 'SVG gzip, байт', get: (e) => e.stats?.gzipBytes, format: 'bytes', better: 'min' },
      { key: 'stats.gzipRatio', label: 'Сжатие gzip, %', get: (e) => e.stats?.gzipRatio, format: 'pct2', better: 'none' },
      { key: 'stats.bytesPerPixel', label: 'Байт на пиксель', get: (e) => e.stats?.bytesPerPixel, format: 'num4', better: 'min' },
      { key: 'bytesPerNode', label: 'Байт на узел', get: (e) => (e.stats?.bytes && e.stats?.nodes ? e.stats.bytes / e.stats.nodes : null), format: 'num2', better: 'min' },
      { key: 'deterministic', label: 'Детерминированный вывод', get: (e) => e.deterministic, format: 'bool', better: 'none' },
      { key: 'hash', label: 'SHA-1 SVG', get: (e) => e.stats?.sha1, format: 'text', better: 'none' },
    ],
  },
];

export function formatValue(value: unknown, format: MetricFormat): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'да' : 'нет';
  if (typeof value === 'string') return value;
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  switch (format) {
    case 'int': return Math.round(value).toLocaleString('ru-RU');
    case 'num1': return value.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    case 'num2': return value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case 'num3': return value.toLocaleString('ru-RU', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    case 'num4': return value.toLocaleString('ru-RU', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    case 'num5': return value.toLocaleString('ru-RU', { minimumFractionDigits: 5, maximumFractionDigits: 5 });
    case 'pct2': return `${(value * 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
    case 'bytes': return formatBytes(value);
    case 'ms': return formatMs(value);
    default: return String(value);
  }
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(2)} МБ`;
}

export function formatMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1) return `${ms.toFixed(2)} мс`;
  if (ms < 1000) return `${ms.toFixed(1)} мс`;
  return `${(ms / 1000).toFixed(2)} с`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${Math.round(seconds)} с`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m} мин ${s} с`;
}

export function formatDate(iso: string | undefined, mode: 'short' | 'long' = 'short'): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ru-RU', mode === 'long'
      ? { dateStyle: 'long', timeStyle: 'short' }
      : { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

export function relativeDate(iso: string | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return '—';
  const min = Math.round(diff / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} дн назад`;
  return formatDate(iso);
}

export function statusLabel(status: string): string {
  if (status === 'ok') return 'полный';
  if (status === 'partial') return 'частичный';
  if (status === 'error') return 'ошибка';
  return status;
}

export function shortHash(hash: string | null | undefined, length = 10): string {
  if (!hash) return '—';
  return hash.slice(0, length);
}

export function bestForRow(record: ExperimentRecord, groupId: string, row: MetricRow): { engine: EngineId; value: number | string | boolean } | null {
  if (row.better === 'none') return null;
  let best: { engine: EngineId; value: number | string | boolean } | null = null;
  for (const engine of ENGINE_IDS) {
    const item = record.engines[engine];
    if (!item || item.status === 'error') continue;
    const value = row.get(item);
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    if (!best || (row.better === 'max' ? value > (best.value as number) : value < (best.value as number))) {
      best = { engine, value };
    }
  }
  return best;
}

export function findBest(record: ExperimentRecord, metricPath: string): EngineId | null {
  const parts = metricPath.split('.');
  let best: { engine: EngineId; value: number } | null = null;
  for (const engine of ENGINE_IDS) {
    const item = record.engines[engine];
    if (!item) continue;
    let value: unknown = item;
    for (const part of parts) value = (value as Record<string, unknown> | undefined)?.[part];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    if (!best || value < best.value) best = { engine, value };
  }
  return best?.engine ?? null;
}

export function aggregate(record: ExperimentRecord) {
  const ok = ENGINE_IDS.map((id) => record.engines[id]).filter((e) => e?.status === 'ok' && e.metrics);
  return {
    count: ok.length,
    bestQuality: record.best?.quality,
    bestSpeed: record.best?.speed,
    smallest: record.best?.size,
  };
}

export function plural(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}
