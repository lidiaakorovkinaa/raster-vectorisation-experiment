import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import crypto from 'node:crypto';
import { ROOT, LIMITS } from './config.js';
import { AppError } from './errors.js';
import { otsuThreshold } from './params.js';
import { svgStats } from './metrics/svg-stats.js';

const WORKER_PATH = path.join(ROOT, 'server', 'engines', 'worker.js');
const ENGINE_IDS = ['potrace', 'imagetracer', 'vtracer'];

class WorkerTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WorkerTimeoutError';
  }
}

class ComputeWorker {
  constructor() {
    this.worker = null;
    this.pending = new Map();
    this.seq = 0;
    this.dead = false;
  }

  async start() {
    if (this.worker) return;
    this.dead = false;
    this.worker = new Worker(WORKER_PATH);
    this.worker.on('message', (message) => this.onMessage(message));
    this.worker.on('error', (error) => {
      this.failAll(error);
      this.terminate();
    });
    this.worker.on('exit', (code) => {
      if (!this.dead) this.failAll(new Error(`Compute worker exited with code ${code}`));
      this.worker = null;
    });
    await new Promise((resolve) => setImmediate(resolve));
  }

  onMessage(message) {
    const { id, type } = message;
    if (type === 'fatal') {
      this.failAll(new Error(message.error || 'Worker fatal error'));
      this.terminate();
      return;
    }
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    if (type === 'error' || message.ok === false) entry.reject(new Error(message.error || 'Ошибка вычисления'));
    else entry.resolve(message);
  }

  failAll(error) {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
      this.pending.delete(id);
    }
  }

  request(type, payload, timeoutMs) {
    if (!this.worker) throw new Error('Worker is not running');
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.terminate();
        reject(new WorkerTimeoutError(`Превышено время выполнения (${Math.round(timeoutMs / 1000)} с)`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, type, ...payload });
    });
  }

  terminate() {
    this.dead = true;
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {
        /* ignore */
      }
    }
    this.worker = null;
    this.failAll(new Error('Рабочий поток остановлен'));
  }
}

class Mutex {
  constructor() {
    this.tail = Promise.resolve();
  }
  run(task) {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => {});
    return result;
  }
}

const mutex = new Mutex();

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function timingStats(samples, warmup) {
  const clean = samples.filter((n) => Number.isFinite(n) && n >= 0);
  if (!clean.length) return { samples: [], runs: 0, median: null, mean: null, min: null, max: null, std: null, cv: null, warmup };
  const mean = clean.reduce((a, b) => a + b, 0) / clean.length;
  const variance = clean.length > 1 ? clean.reduce((a, b) => a + (b - mean) ** 2, 0) / (clean.length - 1) : 0;
  const std = Math.sqrt(variance);
  return {
    samples: clean.map((n) => round(n, 3)),
    runs: clean.length,
    median: round(median(clean), 3),
    mean: round(mean, 3),
    min: round(Math.min(...clean), 3),
    max: round(Math.max(...clean), 3),
    std: round(std, 3),
    cv: mean > 0 ? round((std / mean) * 100, 2) : 0,
    warmup,
  };
}

function round(n, digits = 3) {
  if (!Number.isFinite(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function rotateOrder(roundIndex) {
  const shift = roundIndex % ENGINE_IDS.length;
  return [...ENGINE_IDS.slice(shift), ...ENGINE_IDS.slice(0, shift)];
}

function hashSvg(svg) {
  return crypto.createHash('sha1').update(svg).digest('hex');
}

/**
 * Runs the full benchmark under a global mutex so that timings are not
 * distorted by a concurrent experiment.
 */
export async function runBenchmark({ source, width, height, params, config, emit = () => {}, onCleanup = null }) {
  emit({ type: 'progress', stage: 'queued', message: 'Ожидание очереди вычислений' });
  return mutex.run(async () => {
    const startedAt = Date.now();
    const engineOrder = config.engineOrder || ENGINE_IDS;
    const active = {
      potrace: { id: 'potrace', status: 'pending', samples: [], warmupRuns: [], failures: [], svgs: [], hashes: [], errors: [] },
      imagetracer: { id: 'imagetracer', status: 'pending', samples: [], warmupRuns: [], failures: [], svgs: [], hashes: [], errors: [] },
      vtracer: { id: 'vtracer', status: 'pending', samples: [], warmupRuns: [], failures: [], svgs: [], hashes: [], errors: [] },
    };
    const resolvedThreshold = params.potrace.thresholdMode === 'auto' ? otsuThreshold(source) : params.potrace.threshold;
    const effectiveParams = {
      ...params,
      potrace: { ...params.potrace, threshold: resolvedThreshold, resolvedThreshold },
    };

    emit({ type: 'progress', stage: 'prepare', message: 'Подготовка пикселей и порога' });

    let client = new ComputeWorker();
    await client.start();
    let workerRestarts = 0;

    const bootstrap = async () => {
      await client.start();
      await client.request('init', { source: source, width, height }, 30_000);
    };
    const recover = async (reason) => {
      workerRestarts++;
      client.terminate();
      client = new ComputeWorker();
      await bootstrap();
      emit({ type: 'progress', stage: 'recover', level: 'warn', message: `Рабочий поток перезапущен: ${reason}` });
    };

    try {
      await bootstrap();

      // Warm-up runs are discarded but keep JIT and WASM state warm.
      for (const engine of engineOrder) {
        if (active[engine].status === 'error') continue;
        if (config.warmup <= 0) continue;
        emit({ type: 'progress', stage: 'warmup', engine, message: `Прогрев ${engine}` });
        try {
          const result = await client.request('run', { engine, params: effectiveParams[engine] }, LIMITS.requestTimeoutMs);
          active[engine].warmupRuns.push(round(result.ms, 3));
        } catch (error) {
          if (error instanceof WorkerTimeoutError) {
            active[engine].status = 'error';
            active[engine].errors.push(error.message);
            await recover(`${engine}: ${error.message}`);
          } else {
            active[engine].status = 'error';
            active[engine].errors.push(error.message);
            emit({ type: 'progress', stage: 'engine-error', engine, level: 'error', message: `${engine}: ${error.message}` });
          }
        }
      }

      const totalRuns = engineOrder.length * config.repetitions;
      let completedRuns = 0;

      for (let roundIndex = 0; roundIndex < config.repetitions; roundIndex++) {
        for (const engine of rotateOrder(roundIndex)) {
          if (!engineOrder.includes(engine)) continue;
          if (active[engine].status === 'error') continue;
          completedRuns++;
          emit({
            type: 'progress',
            stage: 'engine',
            engine,
            round: roundIndex + 1,
            repetitions: config.repetitions,
            completedRuns,
            totalRuns,
            message: `${engine} · прогон ${roundIndex + 1}/${config.repetitions}`,
          });
          try {
            const result = await client.request('run', { engine, params: effectiveParams[engine] }, LIMITS.requestTimeoutMs);
            if (Buffer.byteLength(result.svg, 'utf8') > LIMITS.maxSvgBytes) {
              active[engine].status = 'error';
              active[engine].errors.push(`SVG больше лимита ${(LIMITS.maxSvgBytes / 1024 / 1024).toFixed(0)} МБ`);
              continue;
            }
            active[engine].samples.push(round(result.ms, 3));
            if (!active[engine].svgs.length) active[engine].svgs.push(result.svg);
            active[engine].hashes.push(hashSvg(result.svg));
          } catch (error) {
            active[engine].failures.push(error.message);
            active[engine].errors.push(error.message);
            if (error instanceof WorkerTimeoutError) {
              active[engine].status = 'error';
              await recover(`${engine}: ${error.message}`);
            } else {
              emit({ type: 'progress', stage: 'engine-error', engine, level: 'error', message: `${engine}: ${error.message}` });
            }
          }
        }
      }

      const traceSummary = [];
      for (const engine of ENGINE_IDS) {
        const item = active[engine];
        const ok = item.samples.length > 0 && item.svgs.length > 0;
        item.status = ok ? 'ok' : 'error';
        item.timing = timingStats(item.samples, config.warmup);
        item.deterministic = item.hashes.length > 0 && new Set(item.hashes).size === 1;
        item.hash = item.hashes[0] || null;
        item.svg = item.svgs[0] || null;
        traceSummary.push({
          engine,
          status: item.status,
          samples: item.timing.samples,
          warmupRuns: item.warmupRuns,
          median: item.timing.median,
          deterministic: item.deterministic,
          error: item.errors.length ? item.errors[item.errors.length - 1] : undefined,
        });
      }

      const successfulSvgs = {};
      for (const engine of ENGINE_IDS) if (active[engine].svg) successfulSvgs[engine] = active[engine].svg;

      let analysis = {};
      let analysisMs = null;
      if (Object.keys(successfulSvgs).length) {
        emit({ type: 'progress', stage: 'analysis', message: 'Растеризация SVG и расчёт метрик' });
        const analysisStart = performance.now();
        try {
          const analysisResult = await client.request(
            'analyze',
            {
              svgs: successfulSvgs,
              background: config.qualityBackground || config.background,
              threshold: resolvedThreshold,
              blackOnWhite: effectiveParams.potrace.blackOnWhite,
              vtracerBinary: effectiveParams.vtracer.colorMode === 'binary',
            },
            LIMITS.analysisTimeoutMs,
          );
          analysis = analysisResult.engines || {};
          analysisMs = round(performance.now() - analysisStart, 2);
        } catch (error) {
          emit({ type: 'progress', stage: 'analysis-error', level: 'error', message: `Анализ не выполнен: ${error.message}` });
          analysis = {};
          analysisMs = null;
        }
      }

      // Fallback structural statistics and normalized SVG if analysis failed.
      const engines = {};
      for (const engine of ENGINE_IDS) {
        const item = active[engine];
        if (!item.svg) {
          engines[engine] = {
            status: 'error',
            error: item.errors[item.errors.length - 1] || 'Движок не вернул результат',
            timing: item.timing,
          };
          continue;
        }
        let normalizedSvg = item.svg;
        try {
          const { normalizeSvg } = await import('./svg.js');
          normalizedSvg = normalizeSvg(item.svg, width, height).renderSvg;
        } catch {
          /* keep raw */
        }
        const analyzed = analysis[engine];
        engines[engine] = {
          status: analyzed?.ok ? 'ok' : 'partial',
          error: analyzed && analyzed.ok === false ? analyzed.error : undefined,
          svg: analyzed?.svg || normalizedSvg,
          rawSvgHash: item.hash,
          deterministic: item.deterministic,
          timing: item.timing,
          stats: analyzed?.stats || svgStats(normalizedSvg, width, height),
          metrics: analyzed?.metrics || null,
          viewBox: analyzed?.viewBox || null,
          aspectMismatch: analyzed?.aspectMismatch ?? null,
          images: analyzed?.ok
            ? { renderPng: analyzed.renderPng, heatmapPng: analyzed.heatmapPng, heatmapFixedPng: analyzed.heatmapFixedPng, ssimPng: analyzed.ssimPng, diffPng: analyzed.diffPng }
            : null,
          failures: item.failures.length,
          errors: item.errors.slice(-5),
        };
      }

      const durationMs = round(Date.now() - startedAt, 0);
      emit({ type: 'progress', stage: 'done', message: 'Вычисления завершены' });

      return {
        engines,
        timing: {
          resolvedThreshold,
          engineOrder,
          repetitions: config.repetitions,
          warmup: config.warmup,
          durationMs,
          analysisMs,
          workerRestarts,
        },
        traceSummary,
      };
    } finally {
      client.terminate();
      if (onCleanup) onCleanup();
    }
  });
}
