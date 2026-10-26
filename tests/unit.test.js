import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSvg, normalizeSvg, sanitizeSvg } from '../server/svg.js';
import { prepareSource, compareRender, deltaE2000, rgbToLab } from '../server/metrics/pixels.js';
import { otsuThreshold } from '../server/params.js';
import { svgStats } from '../server/metrics/svg-stats.js';
import { buildLatex } from '../server/report.js';

function makeSource(w, h, draw) {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a = 255] = draw(x, y);
      const i = (y * w + x) * 4;
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a;
    }
  }
  return rgba;
}

test('Otsu threshold separates a bimodal image', () => {
  const rgba = makeSource(100, 10, (x) => (x < 50 ? [0, 0, 0] : [255, 255, 255]));
  const t = otsuThreshold(rgba);
  assert.ok(t >= 0 && t < 255);
  assert.ok(t > 0 && t < 255);
});

test('SVG stats: rectangle path', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10" viewBox="0 0 20 10"><path d="M0 0 H10 V10 H0 Z" fill="#000"/></svg>';
  const stats = analyzeSvg(svg, 20, 10);
  assert.equal(stats.paths, 1);
  assert.equal(stats.subpaths, 1);
  assert.equal(stats.nodes, 4);
  assert.equal(stats.segments, 3);
  assert.equal(stats.lines, 3);
  assert.equal(stats.pathLengthPx, 40);
  assert.deepEqual(stats.bbox, { x: 0, y: 0, width: 10, height: 10 });
  assert.equal(stats.colors, 1);
  assert.equal(stats.invalidPaths, 0);
});

test('SVG stats: transform and viewBox scaling', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 50 50"><g transform="translate(5 5)"><path d="M0 0 h10 v10 h-10 z"/></g></svg>';
  const stats = analyzeSvg(svg, 100, 100);
  assert.deepEqual(stats.bbox, { x: 10, y: 10, width: 20, height: 20 });
  assert.equal(stats.pathLengthPx, 80);
});

test('SVG stats: cubic curves, precision and colors', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M0.5 0.5 C0 10.25 10 10 10 0.5" fill="#abc" stroke="rgb(255, 0, 0)"/></svg>';
  const stats = analyzeSvg(svg, 20, 20);
  assert.equal(stats.paths, 1);
  assert.equal(stats.subpaths, 1);
  assert.equal(stats.nodes, 2);
  assert.equal(stats.curves, 1);
  assert.equal(stats.cubic, 1);
  assert.equal(stats.controlPoints, 2);
  assert.equal(stats.coordinatePrecision, 2);
  assert.equal(stats.colors, 2);
  assert.ok(stats.bbox.height > 5);
});

test('normalizeSvg sanitizes scripts and external refs, sets exact viewport', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><script>alert(1)</script><path d="M0 0 L10 10" onclick="x()"/><image href="https://example.com/a.png"/></svg>';
  const normalized = normalizeSvg(svg, 300, 100);
  assert.match(normalized.renderSvg, /width="300"/);
  assert.match(normalized.renderSvg, /height="100"/);
  assert.doesNotMatch(normalized.renderSvg, /script/i);
  assert.doesNotMatch(normalized.renderSvg, /onclick/i);
  assert.doesNotMatch(normalized.renderSvg, /example\.com/);
  assert.ok(normalized.aspectMismatch > 0.5);
  assert.equal(sanitizeSvg('<svg><script>x</script><path d="M0 0"/></svg>').includes('script'), false);
});

test('svgStats reports bytes, gzip and hash', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><path d="M0 0 H2 V2 Z"/></svg>';
  const stats = svgStats(svg, 2, 2);
  assert.ok(stats.bytes > 0);
  assert.ok(stats.gzipBytes > 0);
  assert.ok(stats.gzipRatio > 0);
  assert.equal(stats.sha1.length, 40);
});

test('identical render yields perfect metrics', () => {
  const w = 8, h = 8;
  const source = makeSource(w, h, (x, y) => (x < 4 ? [255, 0, 0] : [255, 255, 255]));
  const ctx = prepareSource(source, w, h, { background: '#FFFFFF', threshold: 128 });
  const result = compareRender(ctx, source, { maps: true, silhouette: true });
  assert.equal(result.metrics.rmse, 0);
  assert.equal(result.metrics.ssim, 1);
  assert.equal(result.metrics.deltaE2000, 0);
  assert.equal(result.metrics.exactPixelRatio, 1);
  assert.equal(result.metrics.heatmapScale, 0.5);
  assert.ok(result.images.heatmap.length > 0);
  assert.ok(result.images.heatmapFixed.length > 0);
  assert.ok(result.images.ssim.length > 0);
  assert.ok(result.images.diff.length > 0);
  assert.ok(result.metrics.silhouette.iou >= 0 && result.metrics.silhouette.iou <= 1);
});

test('black render on white source yields expected error and no false silhouette', () => {
  const w = 8, h = 8;
  const source = makeSource(w, h, () => [255, 255, 255]);
  const black = makeSource(w, h, () => [0, 0, 0]);
  const ctx = prepareSource(source, w, h, { background: '#FFFFFF', threshold: 128 });
  const result = compareRender(ctx, black, { maps: false, silhouette: false });
  assert.ok(result.metrics.rmse > 200);
  assert.ok(result.metrics.ssim < 0.2);
  assert.ok(result.metrics.deltaE2000 > 90);
  assert.equal(result.metrics.silhouette, null);
  assert.equal(result.metrics.coverage, 1);
});

test('silhouette mask respects inversion', () => {
  const w = 4, h = 4;
  const source = makeSource(w, h, (x) => (x < 2 ? [0, 0, 0] : [255, 255, 255]));
  const normal = prepareSource(source, w, h, { background: '#FFFFFF', threshold: 128 });
  const inverted = prepareSource(source, w, h, { background: '#FFFFFF', threshold: 128, invertMask: true });
  assert.equal(normal.darkMask[0], 1);
  assert.equal(normal.darkMask[3], 0);
  assert.equal(inverted.darkMask[0], 0);
  assert.equal(inverted.darkMask[3], 1);
});

test('deltaE2000 is zero for identical colours and large for black/white', () => {
  assert.equal(deltaE2000(...rgbToLab(10, 20, 30), ...rgbToLab(10, 20, 30)), 0);
  assert.ok(deltaE2000(...rgbToLab(0, 0, 0), ...rgbToLab(255, 255, 255)) > 90);
});

test('LaTeX table uses dot decimals and highlights best values', () => {
  const record = {
    name: 'Test',
    engines: {
      potrace: { metrics: { rmse: 2, ssim: 0.5, deltaE2000: 4, silhouette: { iou: 0.8 } }, timing: { median: 30 }, stats: { bytes: 1000 } },
      imagetracer: { metrics: { rmse: 1, ssim: 0.9, deltaE2000: 2, silhouette: null }, timing: { median: 20 }, stats: { bytes: 2000 } },
      vtracer: { metrics: { rmse: 1.5, ssim: 0.8, deltaE2000: 3, silhouette: null }, timing: { median: 10 }, stats: { bytes: 3000 } },
    },
  };
  const tex = buildLatex(record);
  assert.match(tex, /1\.000/);
  assert.doesNotMatch(tex, /1,000/);
  assert.match(tex, /textbf\{1\.000\}/);
  assert.match(tex, /\\begin\{table\}/);
});
