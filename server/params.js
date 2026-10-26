import { z } from 'zod';
import { AppError } from './errors.js';
import { LIMITS } from './config.js';

const boolish = z.union([z.boolean(), z.enum(['true', 'false', '1', '0'])]).transform((v) => v === true || v === 'true' || v === '1');

export const potraceParamsSchema = z.object({
  thresholdMode: z.enum(['auto', 'manual']).default('auto'),
  threshold: z.coerce.number().int().min(0).max(255).default(128),
  turdSize: z.coerce.number().int().min(0).max(200).default(2),
  alphaMax: z.coerce.number().min(0).max(1.3334).default(1),
  optCurve: boolish.default(true),
  optTolerance: z.coerce.number().min(0).max(1).default(0.2),
  blackOnWhite: boolish.default(true),
  turnPolicy: z.enum(['minority', 'majority', 'black', 'white', 'left', 'right']).default('minority'),
});

export const imagetracerParamsSchema = z.object({
  numberofcolors: z.coerce.number().int().min(2).max(64).default(12),
  ltres: z.coerce.number().min(0).max(10).default(1),
  qtres: z.coerce.number().min(0).max(10).default(1),
  pathomit: z.coerce.number().int().min(0).max(200).default(8),
  rightangleenhance: boolish.default(true),
  colorsampling: z.coerce.number().int().min(0).max(2).default(2),
  mincolorratio: z.coerce.number().min(0).max(1).default(0),
  colorquantcycles: z.coerce.number().int().min(1).max(10).default(3),
  layering: z.coerce.number().int().min(0).max(2).default(1),
  strokewidth: z.coerce.number().min(0).max(5).default(1),
  linefilter: boolish.default(false),
  roundcoords: z.coerce.number().int().min(0).max(5).default(2),
  blurradius: z.coerce.number().min(0).max(10).default(0),
  blurdelta: z.coerce.number().min(0).max(100).default(20),
});

export const vtracerParamsSchema = z.object({
  colorMode: z.enum(['color', 'binary']).default('color'),
  hierarchical: z.enum(['stacked', 'cutout']).default('stacked'),
  mode: z.enum(['spline', 'polygon', 'none']).default('spline'),
  filterSpeckle: z.coerce.number().int().min(0).max(128).default(4),
  colorPrecision: z.coerce.number().int().min(1).max(8).default(6),
  layerDifference: z.coerce.number().int().min(0).max(255).default(5),
  cornerThreshold: z.coerce.number().int().min(0).max(180).default(60),
  lengthThreshold: z.coerce.number().min(0).max(100).default(5),
  maxIterations: z.coerce.number().int().min(0).max(20).default(2),
  spliceThreshold: z.coerce.number().int().min(0).max(180).default(45),
  pathPrecision: z.coerce.number().int().min(0).max(8).default(3),
});

export const experimentConfigSchema = z.object({
  repetitions: z.coerce.number().int().min(1).max(9).default(3),
  warmup: z.coerce.number().int().min(0).max(3).default(1),
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#FFFFFF'),
  maxSide: z.coerce.number().int().min(256).max(3000).default(1600),
  engineOrder: z.array(z.enum(['potrace', 'imagetracer', 'vtracer'])).optional(),
});

export const experimentMetaSchema = z.object({
  name: z.string().trim().max(160).optional(),
  author: z.string().trim().max(200).optional(),
  notes: z.string().max(20000).optional().default(''),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).optional().default([]),
  batchId: z.string().trim().max(80).nullish(),
  batchName: z.string().trim().max(120).nullish(),
  derivedFrom: z.string().trim().max(80).nullish(),
  client: z.object({
    originalName: z.string().max(255).optional(),
    originalType: z.string().max(120).optional(),
    originalSize: z.number().nonnegative().optional(),
    normalizedWidth: z.number().int().positive().optional(),
    normalizedHeight: z.number().int().positive().optional(),
    sourceWidth: z.number().int().positive().optional(),
    sourceHeight: z.number().int().positive().optional(),
    scale: z.number().positive().optional(),
    orientationApplied: z.boolean().optional(),
    preprocessing: z.string().max(200).optional(),
  }).partial().optional(),
  config: experimentConfigSchema.partial().optional(),
  params: z.object({
    potrace: potraceParamsSchema.partial().optional(),
    imagetracer: imagetracerParamsSchema.partial().optional(),
    vtracer: vtracerParamsSchema.partial().optional(),
  }).optional(),
});

export const DEFAULT_PARAMS = {
  potrace: potraceParamsSchema.parse({}),
  imagetracer: imagetracerParamsSchema.parse({}),
  vtracer: vtracerParamsSchema.parse({}),
};

export const PRESETS = {
  potrace: [
    { id: 'default', name: 'Логотип / авто', description: 'Авто-порог Оцу, лёгкая очистка, максимум скруглений.', params: { thresholdMode: 'auto', turdSize: 2, alphaMax: 1, optCurve: true, optTolerance: 0.2, blackOnWhite: true, turnPolicy: 'minority' } },
    { id: 'sharp', name: 'Пиксель / углы', description: 'Полигональная трассировка без скруглений.', params: { alphaMax: 0, optCurve: false, optTolerance: 0.2, turdSize: 1 } },
    { id: 'soft', name: 'Мягкие формы', description: 'Сильное скругление и допуск оптимизации.', params: { alphaMax: 1.3334, optCurve: true, optTolerance: 0.5, turdSize: 4 } },
    { id: 'document', name: 'Документ / шум', description: 'Ручной порог и подавление мелких пятен.', params: { thresholdMode: 'manual', threshold: 165, turdSize: 12, alphaMax: 1, optTolerance: 0.3 } },
  ],
  imagetracer: [
    { id: 'default', name: 'Стандарт', description: '12 цветов, сглаженные кривые, умеренная очистка.', params: { numberofcolors: 12, ltres: 1, qtres: 1, pathomit: 8, roundcoords: 2, blurradius: 0 } },
    { id: 'poster', name: 'Постер', description: 'Меньше цветов и сглаживание шума.', params: { numberofcolors: 6, ltres: 1.5, qtres: 1.5, pathomit: 16, roundcoords: 2, blurradius: 1, blurdelta: 24 } },
    { id: 'detail', name: 'Детально', description: 'Больше цветов, меньше отбрасывания путей.', params: { numberofcolors: 24, ltres: 0.5, qtres: 0.5, pathomit: 2, roundcoords: 3, blurradius: 0 } },
    { id: 'minimal', name: 'Минимум', description: '4 цвета, агрессивная очистка — компактный SVG.', params: { numberofcolors: 4, ltres: 2, qtres: 2, pathomit: 32, roundcoords: 1, blurradius: 2, blurdelta: 32 } },
  ],
  vtracer: [
    { id: 'default', name: 'Стандарт', description: 'Цветной слоистый режим со сплайнами.', params: { colorMode: 'color', hierarchical: 'stacked', mode: 'spline', filterSpeckle: 4, colorPrecision: 6, layerDifference: 5, cornerThreshold: 60, lengthThreshold: 5, maxIterations: 2, spliceThreshold: 45, pathPrecision: 3 } },
    { id: 'photo', name: 'Фото', description: 'Больше цветовой точности и меньше слоёв.', params: { colorMode: 'color', hierarchical: 'cutout', mode: 'spline', filterSpeckle: 2, colorPrecision: 7, layerDifference: 8, cornerThreshold: 70, lengthThreshold: 4 } },
    { id: 'logo', name: 'Логотип / полигоны', description: 'Полигональная аппроксимация, сильная очистка.', params: { colorMode: 'color', hierarchical: 'stacked', mode: 'polygon', filterSpeckle: 8, colorPrecision: 6, layerDifference: 6, cornerThreshold: 50, lengthThreshold: 8 } },
    { id: 'binary', name: 'Бинарный', description: 'Чёрно-белая векторизация (ближе к Potrace).', params: { colorMode: 'binary', hierarchical: 'stacked', mode: 'spline', filterSpeckle: 4, cornerThreshold: 60, lengthThreshold: 5 } },
  ],
};

export const PARAM_LABELS = {
  potrace: {
    thresholdMode: 'Режим порога',
    threshold: 'Порог (0–255)',
    turdSize: 'Мин. площадь пятна (px)',
    alphaMax: 'Скругление α',
    optCurve: 'Оптимизация кривых',
    optTolerance: 'Допуск оптимизации',
    blackOnWhite: 'Чёрное на белом',
    turnPolicy: 'Правило обхода',
  },
  imagetracer: {
    numberofcolors: 'Число цветов',
    ltres: 'Допуск линий',
    qtres: 'Допуск кривых',
    pathomit: 'Отбрасывать пути < (px)',
    rightangleenhance: 'Усиление прямых углов',
    colorsampling: 'Выборка цветов',
    mincolorratio: 'Мин. доля цвета',
    colorquantcycles: 'Циклы квантизации',
    layering: 'Слои',
    strokewidth: 'Ширина обводки',
    linefilter: 'Фильтр линий',
    roundcoords: 'Знаков после запятой',
    blurradius: 'Радиус размытия',
    blurdelta: 'Порог размытия',
  },
  vtracer: {
    colorMode: 'Режим цвета',
    hierarchical: 'Иерархия',
    mode: 'Аппроксимация',
    filterSpeckle: 'Фильтр спеклов',
    colorPrecision: 'Точность цвета (бит)',
    layerDifference: 'Разница слоёв',
    cornerThreshold: 'Порог углов (°)',
    lengthThreshold: 'Мин. длина сегмента',
    maxIterations: 'Макс. итераций',
    spliceThreshold: 'Порог сращивания (°)',
    pathPrecision: 'Точность координат',
  },
};

export const ENUM_LABELS = {
  thresholdMode: { auto: 'Авто (Оцу)', manual: 'Вручную' },
  turnPolicy: { minority: 'minority', majority: 'majority', black: 'black', white: 'white', left: 'left', right: 'right' },
  colorMode: { color: 'Цветной', binary: 'Бинарный' },
  hierarchical: { stacked: 'Stacked', cutout: 'Cutout' },
  mode: { spline: 'Сплайны', polygon: 'Полигоны', none: 'Без упрощения' },
  layering: { 0: 'Sequential', 1: 'Stacked', 2: 'Cutout' },
  colorsampling: { 0: 'По умолчанию', 1: 'Детерминированная', 2: 'Адаптивная' },
};

function parseWith(schema, value, engine) {
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    throw new AppError('INVALID_PARAMS', `Некорректные параметры ${engine}`, 400, result.error.issues);
  }
  return result.data;
}

export function normalizeParams(input = {}) {
  return {
    potrace: parseWith(potraceParamsSchema, input.potrace, 'Potrace'),
    imagetracer: parseWith(imagetracerParamsSchema, input.imagetracer, 'ImageTracer'),
    vtracer: parseWith(vtracerParamsSchema, input.vtracer, 'VTracer'),
  };
}

export function normalizeConfig(input = {}) {
  const result = experimentConfigSchema.safeParse(input ?? {});
  if (!result.success) {
    throw new AppError('INVALID_CONFIG', 'Некорректные настройки эксперимента', 400, result.error.issues);
  }
  return result.data;
}

export function normalizeMeta(input = {}) {
  const result = experimentMetaSchema.safeParse(input ?? {});
  if (!result.success) {
    throw new AppError('INVALID_META', 'Некорректные метаданные эксперимента', 400, result.error.issues);
  }
  return result.data;
}

export function parseJsonField(value, fallback = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new AppError('INVALID_JSON', 'Поле содержит некорректный JSON');
  }
}

export function clampRepetitions(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return LIMITS.defaultRepetitions;
  return Math.max(LIMITS.minRepetitions, Math.min(LIMITS.maxRepetitions, Math.round(n)));
}

/**
 * Otsu threshold over the luminance histogram. Used both to resolve Potrace's
 * automatic threshold and to build an independent silhouette reference mask.
 */
export function otsuThreshold(rgba) {
  const hist = new Uint32Array(256);
  let total = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const y = Math.round(0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]);
    hist[y]++;
    total++;
  }
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) {
      bestVar = between;
      best = t;
    }
  }
  // The render/silhouette masks use a strict '< threshold' comparison; adding
  // one keeps pure-black regions inside the mask when Otsu returns 0.
  return Math.min(255, best + 1);
}

export function flattenParams(params) {
  const out = {};
  for (const engine of ['potrace', 'imagetracer', 'vtracer']) {
    for (const [key, value] of Object.entries(params[engine] || {})) {
      out[`${engine}.${key}`] = value;
    }
  }
  return out;
}
