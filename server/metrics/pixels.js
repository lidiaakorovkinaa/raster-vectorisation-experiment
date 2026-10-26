import { encodePng } from '../image.js';

const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const v = i / 255;
  SRGB_TO_LINEAR[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

const XN = 0.95047;
const YN = 1.0;
const ZN = 1.08883;

function labF(t) {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

function labFromRGB(r, g, b, out, offset) {
  const lr = SRGB_TO_LINEAR[r];
  const lg = SRGB_TO_LINEAR[g];
  const lb = SRGB_TO_LINEAR[b];
  const x = (lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375) / XN;
  const y = (lr * 0.2126729 + lg * 0.7151522 + lb * 0.072175) / YN;
  const z = (lr * 0.0193339 + lg * 0.119192 + lb * 0.9503041) / ZN;
  const fx = labF(x);
  const fy = labF(y);
  const fz = labF(z);
  out[offset] = 116 * fy - 16;
  out[offset + 1] = 500 * (fx - fy);
  out[offset + 2] = 200 * (fy - fz);
}

function deltaE76(l1, a1, b1, l2, a2, b2) {
  const dl = l1 - l2;
  const da = a1 - a2;
  const db = b1 - b2;
  return Math.sqrt(dl * dl + da * da + db * db);
}

const DEG = Math.PI / 180;

function deltaE2000(l1, a1, b1, l2, a2, b2) {
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const cBar = (c1 + c2) / 2;
  const cBar7 = Math.pow(cBar, 7);
  const g = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + 6103515625)));
  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);
  const h1p = hPrime(b1, a1p);
  const h2p = hPrime(b2, a2p);
  const dLp = l2 - l1;
  const dCp = c2p - c1p;
  let dhp = 0;
  if (c1p * c2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin((dhp * DEG) / 2);
  const lBarP = (l1 + l2) / 2;
  const cBarP = (c1p + c2p) / 2;
  let hBarP = h1p + h2p;
  if (c1p * c2p === 0) hBarP = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hBarP = (h1p + h2p) / 2;
  else if (h1p + h2p < 360) hBarP = (h1p + h2p + 360) / 2;
  else hBarP = (h1p + h2p - 360) / 2;
  const t =
    1 -
    0.17 * Math.cos((hBarP - 30) * DEG) +
    0.24 * Math.cos(2 * hBarP * DEG) +
    0.32 * Math.cos((3 * hBarP + 6) * DEG) -
    0.2 * Math.cos((4 * hBarP - 63) * DEG);
  const dTheta = 30 * Math.exp(-Math.pow((hBarP - 275) / 25, 2));
  const cBarP7 = Math.pow(cBarP, 7);
  const rc = 2 * Math.sqrt(cBarP7 / (cBarP7 + 6103515625));
  const l50 = lBarP - 50;
  const sl = 1 + (0.015 * l50 * l50) / Math.sqrt(20 + l50 * l50);
  const sc = 1 + 0.045 * cBarP;
  const sh = 1 + 0.015 * cBarP * t;
  const rt = -Math.sin(2 * dTheta * DEG) * rc;
  const tL = dLp / sl;
  const tC = dCp / sc;
  const tH = dHp / sh;
  return Math.sqrt(tL * tL + tC * tC + tH * tH + rt * tC * tH);
}

function hPrime(b, ap) {
  if (b === 0 && ap === 0) return 0;
  let h = Math.atan2(b, ap) / DEG;
  if (h < 0) h += 360;
  return h;
}

function gaussianKernel(size, sigma) {
  const kernel = new Float32Array(size);
  const half = (size - 1) / 2;
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const x = i - half;
    const v = Math.exp(-(x * x) / (2 * sigma * sigma));
    kernel[i] = v;
    sum += v;
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum;
  return kernel;
}

const SSIM_KERNEL = gaussianKernel(11, 1.5);

function grayFromRGBA(rgba) {
  const n = rgba.length / 4;
  const gray = new Float32Array(n);
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    gray[p] = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
  }
  return gray;
}

function separableFilter(src, width, height, kernel) {
  const half = (kernel.length - 1) / 2;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = 0; k < kernel.length; k++) {
        let xx = x + k - half;
        if (xx < 0) xx = 0;
        else if (xx >= width) xx = width - 1;
        sum += src[row + xx] * kernel[k];
      }
      tmp[row + x] = sum;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = 0; k < kernel.length; k++) {
        let yy = y + k - half;
        if (yy < 0) yy = 0;
        else if (yy >= height) yy = height - 1;
        sum += tmp[yy * width + x] * kernel[k];
      }
      out[y * width + x] = sum;
    }
  }
  return out;
}

function ssimMaps(grayA, grayB, width, height) {
  const k = SSIM_KERNEL;
  const muA = separableFilter(grayA, width, height, k);
  const muB = separableFilter(grayB, width, height, k);
  const a2 = new Float32Array(grayA.length);
  const b2 = new Float32Array(grayA.length);
  const ab = new Float32Array(grayA.length);
  for (let i = 0; i < grayA.length; i++) {
    a2[i] = grayA[i] * grayA[i];
    b2[i] = grayB[i] * grayB[i];
    ab[i] = grayA[i] * grayB[i];
  }
  const muA2 = separableFilter(a2, width, height, k);
  const muB2 = separableFilter(b2, width, height, k);
  const muAB = separableFilter(ab, width, height, k);
  const map = new Float32Array(grayA.length);
  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;
  let sum = 0;
  const hist = new Uint32Array(1000);
  for (let i = 0; i < map.length; i++) {
    const mua = muA[i];
    const mub = muB[i];
    const va = Math.max(0, muA2[i] - mua * mua);
    const vb = Math.max(0, muB2[i] - mub * mub);
    const cov = muAB[i] - mua * mub;
    const value = ((2 * mua * mub + C1) * (2 * cov + C2)) / ((mua * mua + mub * mub + C1) * (va + vb + C2));
    map[i] = value;
    sum += value;
    const bin = Math.max(0, Math.min(999, Math.round(value * 999)));
    hist[bin]++;
  }
  let target = map.length * 0.05;
  let acc = 0;
  let p05 = 1;
  for (let i = 0; i < hist.length; i++) {
    acc += hist[i];
    if (acc >= target) {
      p05 = i / 999;
      break;
    }
  }
  return { map, mean: sum / map.length, p05 };
}

export function prepareSource(sourceRGBA, width, height, { background = '#FFFFFF', threshold = 128, invertMask = false } = {}) {
  const n = width * height;
  const gray = grayFromRGBA(sourceRGBA);
  const lab = new Float32Array(n * 3);
  const colors = new Set();
  let ink = 0;
  const bg = hexToRgb(background);
  const darkMask = new Uint8Array(n);
  for (let i = 0, p = 0; i < sourceRGBA.length; i += 4, p++) {
    labFromRGB(sourceRGBA[i], sourceRGBA[i + 1], sourceRGBA[i + 2], lab, p * 3);
    colors.add(((sourceRGBA[i] >> 3) << 10) | ((sourceRGBA[i + 1] >> 3) << 5) | (sourceRGBA[i + 2] >> 3));
    const dr = sourceRGBA[i] - bg.r;
    const dg = sourceRGBA[i + 1] - bg.g;
    const db = sourceRGBA[i + 2] - bg.b;
    if (Math.abs(dr) + Math.abs(dg) + Math.abs(db) > 30) ink++;
    darkMask[p] = (gray[p] < threshold) !== invertMask ? 1 : 0;
  }
  return {
    width,
    height,
    gray,
    lab,
    colors,
    inkRatio: ink / n,
    darkMask,
    background: bg,
    threshold,
    sourceRGBA,
  };
}

function hexToRgb(hex) {
  const v = String(hex || '#FFFFFF').replace('#', '');
  return {
    r: parseInt(v.slice(0, 2), 16) || 0,
    g: parseInt(v.slice(2, 4), 16) || 0,
    b: parseInt(v.slice(4, 6), 16) || 0,
  };
}

function colorSet(rgba) {
  const set = new Set();
  for (let i = 0; i < rgba.length; i += 4) {
    set.add(((rgba[i] >> 3) << 10) | ((rgba[i + 1] >> 3) << 5) | (rgba[i + 2] >> 3));
  }
  return set;
}

export function compareRender(source, renderRGBA, { maps = true, silhouette = true } = {}) {
  const { width, height, lab, gray, background } = source;
  const n = width * height;
  if (renderRGBA.length !== n * 4) {
    throw new Error(`Размер рендера не совпадает с источником: ${renderRGBA.length} vs ${n * 4}`);
  }
  const renderGray = new Float32Array(n);
  const deltaE = new Uint8ClampedArray(n);
  const deltaEHist = new Uint32Array(2048);
  const diffMap = maps ? new Uint8Array(n * 4) : null;
  const rgbHist = new Uint32Array(256);
  const renderColors = new Set();
  const renderMask = new Uint8Array(n);
  let renderInk = 0;
  let se = 0;
  let ae = 0;
  let de76 = 0;
  let de00 = 0;
  let exact = 0;
  let diffJnd = 0;
  let diff5 = 0;
  let diffRgb16 = 0;
  let diffRgb32 = 0;
  const rl = new Float32Array(3);

  for (let i = 0, p = 0; i < renderRGBA.length; i += 4, p++) {
    const alpha = renderRGBA[i + 3] / 255;
    const r = Math.round(renderRGBA[i] * alpha + background.r * (1 - alpha));
    const g = Math.round(renderRGBA[i + 1] * alpha + background.g * (1 - alpha));
    const b = Math.round(renderRGBA[i + 2] * alpha + background.b * (1 - alpha));
    const sr = source.sourceRGBA[i];
    const sg = source.sourceRGBA[i + 1];
    const sb = source.sourceRGBA[i + 2];
    const dr = r - sr;
    const dg = g - sg;
    const db = b - sb;
    const dr2 = dr * dr;
    const dg2 = dg * dg;
    const db2 = db * db;
    se += dr2 + dg2 + db2;
    ae += Math.abs(dr) + Math.abs(dg) + Math.abs(db);
    const maxDiff = Math.max(Math.abs(dr), Math.abs(dg), Math.abs(db));
    rgbHist[Math.min(255, Math.round(maxDiff))]++;
    if (maxDiff > 16) diffRgb16++;
    if (maxDiff > 32) diffRgb32++;
    if (dr === 0 && dg === 0 && db === 0) exact++;
    labFromRGB(r, g, b, rl, 0);
    const l1 = lab[p * 3], a1 = lab[p * 3 + 1], b1 = lab[p * 3 + 2];
    const d76 = deltaE76(l1, a1, b1, rl[0], rl[1], rl[2]);
    const d00 = deltaE2000(l1, a1, b1, rl[0], rl[1], rl[2]);
    de76 += d76;
    de00 += d00;
    if (d00 > 2.3) diffJnd++;
    if (d00 > 5) diff5++;
    deltaE[p] = Math.min(255, Math.round(d00 * 12.75));
    deltaEHist[Math.min(2047, Math.floor(d00 * 20))]++;
    renderGray[p] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    renderColors.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
    const bgDiff = Math.abs(r - background.r) + Math.abs(g - background.g) + Math.abs(b - background.b);
    const isInk = bgDiff > 30;
    renderMask[p] = isInk ? 1 : 0;
    if (isInk) renderInk++;
    if (maps) {
      const o = p * 4;
      diffMap[o] = Math.min(255, Math.abs(dr));
      diffMap[o + 1] = Math.min(255, Math.abs(dg));
      diffMap[o + 2] = Math.min(255, Math.abs(db));
      diffMap[o + 3] = 255;
    }
    if (p % 4096 === 0) { /* keep loop monomorphic */ }
  }

  const ssim = ssimMaps(gray, renderGray, width, height);
  const rmse = Math.sqrt(se / (n * 3));
  const mae = ae / (n * 3);
  const meanDE76 = de76 / n;
  const meanDE00 = de00 / n;
  const p95Bin = percentileFromHistogram(deltaEHist, n, 0.95);
  const p95 = p95Bin / 20;
  const p99 = percentileFromHistogram(deltaEHist, n, 0.99) / 20;
  const heatmapScale = Math.max(0.5, Math.min(20, Math.ceil(p99 * 4) / 4));
  const rgbP99 = percentileFromHistogram(rgbHist, n, 0.99);
  const diffGain = Math.max(2, Math.min(40, Math.round(18 / Math.max(1, rgbP99))));
  let silhouetteMetrics = null;
  if (silhouette) {
    const refMask = source.darkMask;
    let tp = 0, fp = 0, fn = 0, tn = 0;
    for (let p = 0; p < n; p++) {
      const a = refMask[p] === 1;
      const bMask = renderMask[p] === 1;
      if (a && bMask) tp++;
      else if (!a && bMask) fp++;
      else if (a && !bMask) fn++;
      else tn++;
    }
    const precision = tp + fp ? tp / (tp + fp) : 0;
    const recall = tp + fn ? tp / (tp + fn) : 0;
    const iou = tp + fp + fn ? tp / (tp + fp + fn) : 0;
    const dice = 2 * tp + fp + fn ? (2 * tp) / (2 * tp + fp + fn) : 0;
    const accuracy = (tp + tn) / n;
    silhouetteMetrics = {
      reference: `Оцу T=${source.threshold}`,
      iou: round(iou, 5),
      dice: round(dice, 5),
      precision: round(precision, 5),
      recall: round(recall, 5),
      accuracy: round(accuracy, 5),
      tp, fp, fn, tn,
    };
  }

  const metrics = {
    rmse: round(rmse, 3),
    mae: round(mae, 3),
    psnr: rmse === 0 ? 99 : round(20 * Math.log10(255 / rmse), 2),
    ssim: round(ssim.mean, 5),
    ssimP05: round(ssim.p05, 5),
    deltaE76: round(meanDE76, 3),
    deltaE2000: round(meanDE00, 3),
    deltaE2000P95: round(p95, 3),
    diffJndRatio: round(diffJnd / n, 5),
    diff5Ratio: round(diff5 / n, 5),
    diffRgb16Ratio: round(diffRgb16 / n, 5),
    diffRgb32Ratio: round(diffRgb32 / n, 5),
    exactPixelRatio: round(exact / n, 5),
    colors: renderColors.size,
    colorsSource: source.colors.size,
    coverage: round(renderInk / n, 5),
    coverageSource: round(source.inkRatio, 5),
    heatmapScale: round(heatmapScale, 2),
    diffGain,
    silhouette: silhouetteMetrics,
  };

  let images = null;
  if (maps) {
    images = {
      heatmap: encodeDeltaEHeatmap(deltaE, width, height, heatmapScale),
      heatmapFixed: encodeDeltaEHeatmap(deltaE, width, height, 20),
      ssim: encodeSsimHeatmap(ssim.map, width, height),
      diff: encodeDiffMap(diffMap, width, height, diffGain),
    };
  }
  return { metrics, images, ssimMap: maps ? ssim.map : null, deltaE };
}

function percentileFromHistogram(hist, total, q) {
  const target = total * q;
  let acc = 0;
  for (let i = 0; i < hist.length; i++) {
    acc += hist[i];
    if (acc >= target) return i;
  }
  return hist.length - 1;
}

const INFERNO = [
  [0, 0, 4], [22, 11, 57], [66, 10, 104], [106, 23, 110], [147, 38, 103],
  [188, 55, 84], [221, 81, 58], [243, 120, 25], [252, 165, 10], [246, 215, 70], [252, 255, 164],
];
function inferno(t) {
  const x = Math.max(0, Math.min(1, t)) * (INFERNO.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = INFERNO[i];
  const b = INFERNO[Math.min(INFERNO.length - 1, i + 1)];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

function encodeDeltaEHeatmap(deltaECoded, width, height, scale = 20) {
  const out = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const dE = deltaECoded[p] / 12.75;
    const [r, g, b] = inferno(dE / scale);
    const o = p * 4;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = 255;
  }
  return encodePng(out, width, height);
}

function encodeDiffMap(diffMap, width, height, gain = 7) {
  const out = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const o = p * 4;
    const base = 8;
    out[o] = Math.min(255, base + Math.min(247, diffMap[o] - base) * gain);
    out[o + 1] = Math.min(255, base + Math.min(247, diffMap[o + 1] - base) * gain);
    out[o + 2] = Math.min(255, base + Math.min(247, diffMap[o + 2] - base) * gain);
    out[o + 3] = 255;
  }
  return encodePng(out, width, height);
}

function encodeSsimHeatmap(map, width, height) {
  const out = new Uint8Array(width * height * 4);
  for (let p = 0; p < map.length; p++) {
    const v = Math.max(0, Math.min(1, map[p]));
    const t = 1 - v;
    let r, g, b;
    if (t < 0.5) {
      const f = t / 0.5;
      r = Math.round(14 + f * 220);
      g = Math.round(38 + f * 110);
      b = Math.round(48 + f * 20);
    } else {
      const f = (t - 0.5) / 0.5;
      r = Math.round(234 + f * 18);
      g = Math.round(148 - f * 108);
      b = Math.round(68 - f * 44);
    }
    const o = p * 4;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = 255;
  }
  return encodePng(out, width, height);
}

function round(n, digits) {
  if (!Number.isFinite(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function rgbToLab(r, g, b) {
  const out = new Float32Array(3);
  labFromRGB(r, g, b, out, 0);
  return [out[0], out[1], out[2]];
}

export { deltaE2000, deltaE76, labFromRGB, grayFromRGBA, rgbToLab };
