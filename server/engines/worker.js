import { parentPort } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import potrace from 'potrace';
import Jimp from 'jimp';
import ImageTracer from 'imagetracerjs';
import * as vtracer from '@neplex/vectorizer-wasm32-wasi';
import { normalizeSvg } from '../svg.js';
import { renderSvg } from '../metrics/render.js';
import { prepareSource, compareRender } from '../metrics/pixels.js';
import { svgStats } from '../metrics/svg-stats.js';

if (!parentPort) throw new Error('Worker must be started from worker_threads');

const state = {
  source: null,
  width: 0,
  height: 0,
  jimp: null,
  imageData: null,
};

function initSource(payload) {
  const source = Buffer.from(payload.source);
  state.source = source;
  state.width = payload.width;
  state.height = payload.height;
  state.jimp = new Jimp({ data: Buffer.from(source), width: payload.width, height: payload.height });
  state.imageData = {
    data: new Uint8ClampedArray(source),
    width: payload.width,
    height: payload.height,
  };
}

function runPotrace(params) {
  const trace = new potrace.Potrace({
    threshold: params.threshold,
    turdSize: params.turdSize,
    alphaMax: params.alphaMax,
    optCurve: params.optCurve,
    optTolerance: params.optTolerance,
    blackOnWhite: params.blackOnWhite,
    turnPolicy: params.turnPolicy,
  });
  let error = null;
  trace.loadImage(state.jimp, (err) => {
    if (err) error = err;
  });
  if (error) throw error;
  return trace.getSVG();
}

function runImageTracer(params) {
  const options = {
    numberofcolors: params.numberofcolors,
    ltres: params.ltres,
    qtres: params.qtres,
    pathomit: params.pathomit,
    rightangleenhance: params.rightangleenhance,
    colorsampling: params.colorsampling,
    mincolorratio: params.mincolorratio,
    colorquantcycles: params.colorquantcycles,
    layering: params.layering,
    strokewidth: params.strokewidth,
    linefilter: params.linefilter,
    scale: 1,
    roundcoords: params.roundcoords,
    blurradius: params.blurradius,
    blurdelta: params.blurdelta,
  };
  return ImageTracer.imagedataToSVG(state.imageData, options);
}

function runVtracer(params) {
  const config = {
    colorMode: params.colorMode === 'binary' ? vtracer.ColorMode.Binary : vtracer.ColorMode.Color,
    hierarchical: params.hierarchical === 'cutout' ? vtracer.Hierarchical.Cutout : vtracer.Hierarchical.Stacked,
    mode: params.mode === 'polygon' ? vtracer.PathSimplifyMode.Polygon : params.mode === 'none' ? vtracer.PathSimplifyMode.None : vtracer.PathSimplifyMode.Spline,
    filterSpeckle: params.filterSpeckle,
    colorPrecision: params.colorPrecision,
    layerDifference: params.layerDifference,
    cornerThreshold: params.cornerThreshold,
    lengthThreshold: params.lengthThreshold,
    maxIterations: params.maxIterations,
    spliceThreshold: params.spliceThreshold,
    pathPrecision: params.pathPrecision,
  };
  return vtracer.vectorizeRawSync(state.source, { width: state.width, height: state.height }, config);
}

function runEngine(engine, params) {
  const start = performance.now();
  let svg;
  if (engine === 'potrace') svg = runPotrace(params);
  else if (engine === 'imagetracer') svg = runImageTracer(params);
  else if (engine === 'vtracer') svg = runVtracer(params);
  else throw new Error(`Unknown engine: ${engine}`);
  const ms = performance.now() - start;
  if (typeof svg !== 'string' || !svg.includes('<svg')) throw new Error('Движок вернул некорректный SVG');
  return { svg, ms };
}

async function analyze(payload) {
  const { svgs, background, threshold, blackOnWhite } = payload;
  const sourceContext = prepareSource(state.source, state.width, state.height, {
    background,
    threshold,
    invertMask: blackOnWhite === false,
  });
  const out = {};
  for (const [engine, svg] of Object.entries(svgs)) {
    if (!svg) continue;
    try {
      const normalized = normalizeSvg(svg, state.width, state.height);
      const render = await renderSvg(normalized.renderSvg, state.width, state.height);
      const stats = svgStats(normalized.renderSvg, state.width, state.height);
      const silhouette = engine === 'potrace' || (engine === 'vtracer' && payload.vtracerBinary);
      const quality = compareRender(sourceContext, render.rgba, { maps: true, silhouette });
      out[engine] = {
        ok: true,
        svg: normalized.renderSvg,
        viewBox: normalized.viewBox,
        aspectMismatch: normalized.aspectMismatch,
        stats,
        metrics: quality.metrics,
        renderPng: render.png,
        heatmapPng: quality.images.heatmap,
        heatmapFixedPng: quality.images.heatmapFixed,
        ssimPng: quality.images.ssim,
        diffPng: quality.images.diff,
      };
    } catch (error) {
      out[engine] = { ok: false, error: error.message };
    }
  }
  return out;
}

parentPort.on('message', async (message) => {
  const { type, id } = message;
  try {
    if (type === 'init') {
      initSource(message);
      parentPort.postMessage({ type: 'init-ok', id });
      return;
    }
    if (type === 'run') {
      const result = runEngine(message.engine, message.params);
      parentPort.postMessage({ type: 'run-result', id, ok: true, ...result });
      return;
    }
    if (type === 'analyze') {
      const result = await analyze(message);
      parentPort.postMessage({ type: 'analyze-result', id, ok: true, engines: result });
      return;
    }
    parentPort.postMessage({ type: 'error', id, ok: false, error: `Unknown message: ${type}` });
  } catch (error) {
    parentPort.postMessage({ type: 'error', id, ok: false, error: error?.stack || error?.message || String(error) });
  }
});

process.on('uncaughtException', (error) => {
  parentPort.postMessage({ type: 'fatal', error: error?.stack || String(error) });
});

process.on('unhandledRejection', (error) => {
  parentPort.postMessage({ type: 'fatal', error: error?.stack || String(error) });
});
