import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT, DEFAULT_BACKGROUND, SCHEMA_VERSION } from '../server/config.js';
import { ensureStore, saveExperiment, patchExperiment, listExperiments } from '../server/store.js';
import { createExperiment, saveRoi } from '../server/experiments.js';
import { DEFAULT_PARAMS } from '../server/params.js';

const DATA = path.join(ROOT, 'data');
const EXPERIMENTS = path.join(DATA, 'experiments');
const INDEX = path.join(DATA, 'index.json');
await fs.rm(EXPERIMENTS, { recursive: true, force: true });
await fs.mkdir(EXPERIMENTS, { recursive: true });
await fs.writeFile(INDEX, JSON.stringify({ schemaVersion: SCHEMA_VERSION, updatedAt: new Date().toISOString(), experiments: [] }, null, 2));
await ensureStore();

const baseParams = structuredClone(DEFAULT_PARAMS);

async function seed({ sample, name, tags, notes, batchId, batchName, params, maxSide = 1200, repetitions = 3 }) {
  const buffer = await fs.readFile(path.join(ROOT, 'public', 'samples', `${sample}.png`));
  const files = {
    normalized: [{ buffer, originalname: `${sample}.png`, mimetype: 'image/png', size: buffer.length }],
    original: [{ buffer, originalname: `${sample}.png`, mimetype: 'image/png', size: buffer.length }],
  };
  console.log(`  · ${name}`);
  const record = await createExperiment({
    files,
    meta: {
      name, tags, notes, author: 'Demo', batchId, batchName,
      config: { repetitions, warmup: 1, background: DEFAULT_BACKGROUND, maxSide },
      client: { originalName: `${sample}.png`, originalType: 'image/png', originalSize: buffer.length, preprocessing: 'seed: synthetic sample' },
    },
    params,
    emit: (message) => {
      if (message.stage === 'engine' && message.completedRuns === message.totalRuns) process.stdout.write('    ✓ ');
      else if (message.stage === 'saved') process.stdout.write('saved\n');
    },
  });
  return record;
}

console.log('Seeding VecBench demo data…');

const batchId = 'batch_demo_2026';
const batchName = 'Демо · три сюжета';

const posterParams = structuredClone(baseParams);
posterParams.imagetracer.numberofcolors = 10;
posterParams.imagetracer.roundcoords = 2;

const poster = await seed({
  sample: 'poster', name: 'Постер · типографика и цвет',
  tags: ['demo', 'типографика', 'цвет'],
  notes: 'Демонстрационный эксперимент: крупные цветовые поля, текст и градиенты. Показывает разницу между бинарным Potrace и цветными движками. Запись можно удалить.',
  batchId, batchName, params: posterParams,
});

const lineartParams = structuredClone(baseParams);
lineartParams.potrace.turdSize = 3;
lineartParams.potrace.optTolerance = 0.3;
lineartParams.imagetracer.numberofcolors = 6;

const lineart = await seed({
  sample: 'lineart', name: 'Архитектурная графика · силуэт',
  tags: ['demo', 'линия', 'бинарь'],
  notes: 'Тонкие штрихи и перекрёстная штриховка. Хороший кейс для Potrace: силуэт и гладкость контуров важнее цвета.',
  batchId, batchName, params: lineartParams,
});

const badgeParams = structuredClone(baseParams);
badgeParams.vtracer.colorPrecision = 7;
badgeParams.imagetracer.numberofcolors = 10;

const badge = await seed({
  sample: 'badge', name: 'Эмблема · мелкие детали',
  tags: ['demo', 'логотип', 'контраст'],
  notes: 'Тёмный фон, кольца и монограмма. Проверка мелких деталей, слоёв и компактности SVG.',
  batchId, batchName, params: badgeParams,
});

const chartParams = structuredClone(baseParams);
chartParams.imagetracer.numberofcolors = 8;
chartParams.imagetracer.pathomit = 4;

await seed({
  sample: 'chart', name: 'Научный график · тонкие линии',
  tags: ['demo', 'график', 'текст'],
  notes: 'Оси, сетка и подписи. Проверка тонких линий и векторной типографики; полезно сравнить SSIM и размер SVG.',
  params: chartParams,
});

const landscapeParams = structuredClone(baseParams);
landscapeParams.imagetracer.numberofcolors = 16;
landscapeParams.vtracer.colorPrecision = 7;
landscapeParams.vtracer.layerDifference = 4;

await seed({
  sample: 'landscape', name: 'Горный пейзаж · градиенты',
  tags: ['demo', 'фото', 'градиент'],
  notes: 'Плавные переходы и атмосферная перспектива. Показывает, где цветовые движки выигрывают у бинарного Potrace.',
  params: landscapeParams,
});

// Save a couple of illustrative ROIs for the demo.
await saveRoi(poster.id, { name: 'Буква «02»', note: 'Контуры типографики и антиалиасинг.', rect: { x: 120, y: 520, w: 340, h: 320 } });
await saveRoi(badge.id, { name: 'Центральная звезда', note: 'Мелкие детали и монограмма.', rect: { x: 300, y: 220, w: 400, h: 420 } });
await patchExperiment(badge.id, { pinned: true });

const { total } = await listExperiments();
console.log(`Done: ${total} demo experiments.`);
