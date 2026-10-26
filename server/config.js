import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { readFileSync } from 'node:fs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.VECBENCH_DATA
  ? path.resolve(process.env.VECBENCH_DATA)
  : path.join(ROOT, 'data');
export const DIST_DIR = path.join(ROOT, 'dist');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const PORT = Number(process.env.PORT || 8810);
export const HOST = process.env.HOST || '127.0.0.1';

export const APP_VERSION = '1.0.0';
export const METHODOLOGY_VERSION = '1.0';
export const SCHEMA_VERSION = 1;

function pkgVersion(name) {
  try {
    return JSON.parse(readFileSync(path.join(ROOT, 'node_modules', name, 'package.json'), 'utf8')).version;
  } catch {
    return 'unknown';
  }
}

export const ENGINE_META = {
  potrace: {
    id: 'potrace',
    name: 'Potrace',
    subtitle: 'Бинарный трассировщик контуров',
    color: '#C7492B',
    version: pkgVersion('potrace'),
    algorithm: 'Potrace (Peter Selinger), JS-порт node-potrace',
    license: 'GPL-2.0',
    note: 'Бинарная трассировка: изображение сводится к чёрно-белой маске по порогу, затем контуры аппроксимируются кривыми Безье. Цвет не воспроизводится.',
  },
  imagetracer: {
    id: 'imagetracer',
    name: 'ImageTracer',
    subtitle: 'Цветовая квантизация и трассировка',
    color: '#2B6CB0',
    version: pkgVersion('imagetracerjs'),
    algorithm: 'ImageTracer.js (András Jankovics)',
    license: 'Unlicense / public domain',
    note: 'Цветовая квантизация, выделение слоёв и трассировка контуров с аппроксимацией кривыми. Число цветов и допуски напрямую влияют на размер SVG.',
  },
  vtracer: {
    id: 'vtracer',
    name: 'VTracer',
    subtitle: 'Иерархическая цветовая векторизация',
    color: '#1F7A5C',
    version: pkgVersion('@neplex/vectorizer-wasm32-wasi'),
    algorithm: 'visioncortex VTracer 0.1.0 (WASM-сборка @neplex/vectorizer)',
    license: 'MIT',
    note: 'Иерархическая кластеризация цветовых областей и сплайн-аппроксимация (Rust/WASM). Поддерживает цветной, бинарный и слоистый режимы.',
  },
};

export const LIMITS = {
  maxUploadBytes: 40 * 1024 * 1024,
  maxPixels: 12_000_000,
  maxSide: 3000,
  defaultMaxSide: 1600,
  maxSvgBytes: 48 * 1024 * 1024,
  maxRepetitions: 9,
  defaultRepetitions: 3,
  minRepetitions: 1,
  maxFilesPerRequest: 4,
  maxBatchFiles: 24,
  requestTimeoutMs: 180_000,
  analysisTimeoutMs: 300_000,
};

export const ENVIRONMENT = {
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  release: os.release(),
  cpu: os.cpus()?.[0]?.model?.trim() || 'unknown',
  cores: os.cpus()?.length || 1,
  totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024),
  appVersion: APP_VERSION,
  methodologyVersion: METHODOLOGY_VERSION,
};

export const DEFAULT_BACKGROUND = '#FFFFFF';
