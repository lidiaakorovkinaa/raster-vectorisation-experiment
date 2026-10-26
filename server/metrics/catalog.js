export const ENGINE_IDS = ['potrace', 'imagetracer', 'vtracer'];

export const ENGINE_COLORS = {
  potrace: '#C7492B',
  imagetracer: '#2B6CB0',
  vtracer: '#1F7A5C',
};

export const METRIC_GROUPS = [
  {
    id: 'quality',
    title: 'Качество воспроизведения',
    note: 'Попиксельное сравнение рендера SVG с нормализованным источником. Меньше — лучше для ошибок, больше — для схожести.',
    rows: [
      { key: 'rmse', label: 'RMSE (0–255)', get: (e) => e.metrics?.rmse, format: 'num3', better: 'min', primary: true },
      { key: 'mae', label: 'MAE (0–255)', get: (e) => e.metrics?.mae, format: 'num3', better: 'min' },
      { key: 'psnr', label: 'PSNR, дБ', get: (e) => e.metrics?.psnr, format: 'num2', better: 'max' },
      { key: 'ssim', label: 'SSIM (среднее)', get: (e) => e.metrics?.ssim, format: 'num4', better: 'max', primary: true },
      { key: 'ssimP05', label: 'SSIM p05', get: (e) => e.metrics?.ssimP05, format: 'num4', better: 'max' },
      { key: 'deltaE2000', label: 'ΔE2000 (среднее)', get: (e) => e.metrics?.deltaE2000, format: 'num3', better: 'min', primary: true },
      { key: 'deltaE76', label: 'ΔE76 (среднее)', get: (e) => e.metrics?.deltaE76, format: 'num3', better: 'min' },
      { key: 'deltaE2000P95', label: 'ΔE2000 p95', get: (e) => e.metrics?.deltaE2000P95, format: 'num3', better: 'min' },
      { key: 'diffJndRatio', label: 'Пиксели ΔE00 > 2.3, %', get: (e) => e.metrics?.diffJndRatio, format: 'pct2', better: 'min' },
      { key: 'diff5Ratio', label: 'Пиксели ΔE00 > 5, %', get: (e) => e.metrics?.diff5Ratio, format: 'pct2', better: 'min' },
      { key: 'diffRgb16Ratio', label: 'Пиксели RGB Δ > 16, %', get: (e) => e.metrics?.diffRgb16Ratio, format: 'pct2', better: 'min' },
      { key: 'exactPixelRatio', label: 'Точное совпадение RGB, %', get: (e) => e.metrics?.exactPixelRatio, format: 'pct2', better: 'max' },
      { key: 'coverage', label: 'Покрытие непрозрачных областей, %', get: (e) => e.metrics?.coverage, format: 'pct2', better: 'none' },
    ],
  },
  {
    id: 'silhouette',
    title: 'Силуэт (бинарная маска Оцу)',
    note: 'Сравнение формы с маской источника по порогу Оцу. Наиболее корректно для Potrace и бинарного режима VTracer; для цветных движков служит справочной оценкой. Прочерк — метрика не рассчитывалась.',
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
    note: 'Геометрия разобранного SVG. Это описание выхода, а не оценка «лучше/хуже»: меньше узлов — компактнее, но может быть грубее.',
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
    note: 'Время только вызова движка после прогрева, без декодирования PNG, растеризации, записи файлов и HTTP. Порядок движков ротируется между прогонами.',
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
    note: 'Размер хранимого SVG и его сжатие gzip. Меньше — компактнее, но размер не равен качеству.',
    rows: [
      { key: 'stats.bytes', label: 'SVG, байт', get: (e) => e.stats?.bytes, format: 'bytes', better: 'min', primary: true },
      { key: 'stats.gzipBytes', label: 'SVG gzip, байт', get: (e) => e.stats?.gzipBytes, format: 'bytes', better: 'min' },
      { key: 'stats.gzipRatio', label: 'Сжатие gzip, %', get: (e) => e.stats?.gzipRatio, format: 'pct2', better: 'none' },
      { key: 'stats.bytesPerPixel', label: 'Байт на пиксель', get: (e) => e.stats?.bytesPerPixel, format: 'num4', better: 'min' },
      { key: 'bytesPerNode', label: 'Байт на узел', get: (e) => e.stats?.bytes && e.stats?.nodes ? e.stats.bytes / e.stats.nodes : null, format: 'num2', better: 'min' },
      { key: 'deterministic', label: 'Детерминированный вывод', get: (e) => e.deterministic, format: 'bool', better: 'none' },
      { key: 'hash', label: 'SHA-1 SVG', get: (e) => e.stats?.sha1, format: 'text', better: 'none' },
    ],
  },
];

export function formatValue(value, format) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'да' : 'нет';
  if (Number.isNaN(value)) return '—';
  switch (format) {
    case 'int':
      return typeof value === 'number' ? Math.round(value).toLocaleString('ru-RU') : String(value);
    case 'num1':
      return Number(value).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    case 'num2':
      return Number(value).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case 'num3':
      return Number(value).toLocaleString('ru-RU', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    case 'num4':
      return Number(value).toLocaleString('ru-RU', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    case 'pct2':
      return `${(Number(value) * 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
    case 'bytes':
      return formatBytes(value);
    case 'text':
      return String(value);
    default:
      return String(value);
  }
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(2)} МБ`;
}

export function formatMs(ms) {
  if (!Number.isFinite(ms)) return '—';
  if (ms < 1) return `${ms.toFixed(2)} мс`;
  if (ms < 1000) return `${ms.toFixed(1)} мс`;
  return `${(ms / 1000).toFixed(2)} с`;
}

export function bestRows(record) {
  const result = {};
  for (const group of METRIC_GROUPS) {
    for (const row of group.rows) {
      if (!row.better || row.better === 'none') continue;
      let best = null;
      for (const engine of ENGINE_IDS) {
        const item = record.engines?.[engine];
        if (!item || item.status === 'error') continue;
        const value = row.get(item);
        if (!Number.isFinite(value)) continue;
        if (best === null || (row.better === 'max' ? value > best.value : value < best.value)) {
          best = { engine, value };
        }
      }
      if (best) result[group.id + ':' + row.key] = best;
    }
  }
  return result;
}

export function isBest(bestMap, groupId, rowKey, engine, value) {
  const best = bestMap[groupId + ':' + rowKey];
  return Boolean(best && best.engine === engine && best.value === value);
}

export function paramsRows(record) {
  const labels = {
    thresholdMode: 'Режим порога',
    threshold: 'Порог',
    turdSize: 'Мин. площадь пятна',
    alphaMax: 'Скругление α',
    optCurve: 'Оптимизация кривых',
    optTolerance: 'Допуск оптимизации',
    blackOnWhite: 'Чёрное на белом',
    turnPolicy: 'Правило обхода',
    numberofcolors: 'Число цветов',
    ltres: 'Допуск линий',
    qtres: 'Допуск кривых',
    pathomit: 'Отбрасывать пути <',
    rightangleenhance: 'Усиление углов',
    colorsampling: 'Выборка цветов',
    mincolorratio: 'Мин. доля цвета',
    colorquantcycles: 'Циклы квантизации',
    layering: 'Слои',
    strokewidth: 'Ширина обводки',
    linefilter: 'Фильтр линий',
    roundcoords: 'Знаков после запятой',
    blurradius: 'Радиус размытия',
    blurdelta: 'Порог размытия',
    colorMode: 'Режим цвета',
    hierarchical: 'Иерархия',
    mode: 'Аппроксимация',
    filterSpeckle: 'Фильтр спеклов',
    colorPrecision: 'Точность цвета',
    layerDifference: 'Разница слоёв',
    cornerThreshold: 'Порог углов',
    lengthThreshold: 'Мин. длина сегмента',
    maxIterations: 'Макс. итераций',
    spliceThreshold: 'Порог сращивания',
    pathPrecision: 'Точность координат',
  };
  const order = ['potrace', 'imagetracer', 'vtracer'];
  const keys = new Set();
  for (const engine of order) for (const key of Object.keys(record.params?.[engine] || {})) keys.add(key);
  return [...keys]
    .filter((key) => key !== 'resolvedThreshold')
    .map((key) => ({ key, label: labels[key] || key, values: Object.fromEntries(order.map((e) => [e, record.params?.[e]?.[key]])) }));
}

export function summaryMetrics(record) {
  const engines = ENGINE_IDS.map((id) => record.engines?.[id]).filter(Boolean);
  const ok = engines.filter((e) => e.status === 'ok');
  return {
    okCount: ok.length,
    bestQuality: record.best?.quality,
    bestSpeed: record.best?.speed,
    smallest: record.best?.size,
    bestSilhouette: record.best?.silhouette,
  };
}
