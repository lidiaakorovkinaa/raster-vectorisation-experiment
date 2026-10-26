import type { EngineId, EngineRecord, ExperimentRecord } from '@/types';
import { METRIC_GROUPS, type MetricFormat } from './engines';

export interface SimpleRow {
  key: string;
  label: string;
  get: (engine: EngineRecord, record: ExperimentRecord) => number | string | boolean | null | undefined;
  format: MetricFormat;
  better: 'min' | 'max' | 'none';
  hint?: string;
  primary?: boolean;
}

export interface SimpleGroup {
  id: string;
  title: string;
  rows: SimpleRow[];
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function ratio(numerator: number | null | undefined, denominator: number | null | undefined): number | null {
  if (!finite(numerator) || !finite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

export function buildSimpleGroups(record: ExperimentRecord): SimpleGroup[] {
  const mp = (record.source.width * record.source.height) / 1e6;
  const groups: SimpleGroup[] = METRIC_GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    rows: group.rows.map((row) => ({ ...row })),
  }));

  const quality = groups.find((g) => g.id === 'quality')!;
  quality.rows.push(
    { key: 'coverageError', label: 'Отклонение покрытия от источника, %', get: (e) => {
      const c = e.metrics?.coverage;
      const s = e.metrics?.coverageSource;
      return finite(c) && finite(s) ? Math.abs(c - s) : null;
    }, format: 'pct2', better: 'min', hint: 'Модуль разницы доли закрашенных пикселей источника и рендера.' },
    { key: 'colorsDiff', label: 'Отклонение числа цветов', get: (e) => {
      const c = e.metrics?.colors;
      const s = e.metrics?.colorsSource;
      return finite(c) && finite(s) ? Math.abs(c - s) : null;
    }, format: 'int', better: 'min', hint: 'Насколько число квантованных цветов отличается от источника.' },
  );

  const silhouette = groups.find((g) => g.id === 'silhouette');
  if (silhouette) {
    silhouette.rows.push({
      key: 'silhouette.error',
      label: 'Ошибка маски (1 − IoU)',
      get: (e) => (finite(e.metrics?.silhouette?.iou) ? 1 - e.metrics!.silhouette!.iou : null),
      format: 'num4',
      better: 'min',
    });
  }

  const structure = groups.find((g) => g.id === 'structure')!;
  structure.rows.push(
    { key: 'nodesPerPath', label: 'Узлов на путь', get: (e) => ratio(e.stats?.nodes, e.stats?.paths), format: 'num2', better: 'none' },
    { key: 'segmentsPerPath', label: 'Сегментов на путь', get: (e) => ratio(e.stats?.segments, e.stats?.paths), format: 'num2', better: 'none' },
    { key: 'controlPointsPerNode', label: 'Контрольных точек на узел', get: (e) => ratio(e.stats?.controlPoints, e.stats?.nodes), format: 'num3', better: 'none' },
    { key: 'curvesShare', label: 'Доля кривых в сегментах, %', get: (e) => ratio(e.stats?.curves, e.stats?.segments), format: 'pct2', better: 'none' },
    { key: 'nodeSpacingPx', label: 'Средний шаг узлов, px', get: (e) => ratio(e.stats?.pathLengthPx, e.stats?.nodes), format: 'num2', better: 'none' },
    { key: 'pathLengthPerKpx', label: 'Длина контуров на 1000 px²', get: (e) => ratio(e.stats?.pathLengthPx, (record.source.width * record.source.height) / 1000), format: 'num2', better: 'none' },
    { key: 'bboxAreaRatio', label: 'Bbox / площадь кадра, %', get: (e) => {
      const b = e.stats?.bbox;
      return b ? (b.width * b.height) / (record.source.width * record.source.height) : null;
    }, format: 'pct2', better: 'none' },
  );

  const performance = groups.find((g) => g.id === 'performance')!;
  performance.rows.push(
    { key: 'timePerMpix', label: 'Время на 1 Мп, мс', get: (e) => ratio(e.timing?.median, mp), format: 'num1', better: 'min', hint: 'Медиана, нормированная на мегапиксель рабочего разрешения.' },
    { key: 'mpxPerSec', label: 'Скорость, Мп/с', get: (e) => ratio(mp, (e.timing?.median ?? 0) / 1000), format: 'num3', better: 'max' },
    { key: 'nodesPerMs', label: 'Узлов на мс', get: (e) => ratio(e.stats?.nodes, e.timing?.median), format: 'num2', better: 'max' },
    { key: 'timePerNodeUs', label: 'Время на узел, мкс', get: (e) => ratio((e.timing?.median ?? 0) * 1000, e.stats?.nodes), format: 'num3', better: 'min' },
    { key: 'runs', label: 'Измеренных прогонов', get: (e) => e.timing?.runs, format: 'int', better: 'none' },
  );

  const files = groups.find((g) => g.id === 'files')!;
  files.rows.push(
    { key: 'bytesPerPath', label: 'Байт на путь', get: (e) => ratio(e.stats?.bytes, e.stats?.paths), format: 'num1', better: 'min' },
    { key: 'pathsPerKpx', label: 'Путей на 1000 px²', get: (e) => ratio(e.stats?.paths, (record.source.width * record.source.height) / 1000), format: 'num3', better: 'none' },
    { key: 'svgGzipPercent', label: 'Gzip от исходного SVG, %', get: (e) => e.stats?.gzipRatio, format: 'pct2', better: 'none' },
  );

  const derivedRows: SimpleRow[] = [
    { key: 'ssimPerKb', label: 'SSIM на 1 КБ', get: (e) => ratio(e.metrics?.ssim, (e.stats?.bytes ?? 0) / 1024), format: 'num5', better: 'max', hint: 'Компромисс качества и размера. Не является стандартной метрикой — используйте как ориентир.' },
    { key: 'qualityPerMs', label: 'SSIM на 1 мс', get: (e) => ratio(e.metrics?.ssim, e.timing?.median), format: 'num5', better: 'max', hint: 'Компромисс качества и времени. Ориентир, не стандартная метрика.' },
    { key: 'silhouettePerKb', label: 'IoU на 1 КБ', get: (e) => ratio(e.metrics?.silhouette?.iou, (e.stats?.bytes ?? 0) / 1024), format: 'num5', better: 'max' },
    { key: 'psnrPerKb', label: 'PSNR на 1 КБ', get: (e) => ratio(e.metrics?.psnr, (e.stats?.bytes ?? 0) / 1024), format: 'num4', better: 'max' },
    { key: 'pixelsPerNode', label: 'Пикселей на узел', get: (e) => ratio(record.source.width * record.source.height, e.stats?.nodes), format: 'num1', better: 'none' },
    { key: 'coveragePerKb', label: 'Покрытие на 1 КБ, %', get: (e) => ratio((e.metrics?.coverage ?? 0) * 100, (e.stats?.bytes ?? 0) / 1024), format: 'num4', better: 'none' },
  ];
  groups.push({ id: 'derived', title: 'Производные показатели', rows: derivedRows });

  return groups;
}

export function bestOfRow(record: ExperimentRecord, row: SimpleRow): { engine: EngineId; value: number } | null {
  if (row.better === 'none') return null;
  let best: { engine: EngineId; value: number } | null = null;
  for (const engine of ['potrace', 'imagetracer', 'vtracer'] as EngineId[]) {
    const item = record.engines[engine];
    if (!item) continue;
    const value = row.get(item, record);
    if (!finite(value)) continue;
    if (!best || (row.better === 'max' ? value > best.value : value < best.value)) best = { engine, value };
  }
  return best;
}
