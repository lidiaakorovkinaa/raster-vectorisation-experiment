import sax from 'sax';

const IDENTITY = [1, 0, 0, 1, 0, 0];

function multiply(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function parseTransform(value) {
  if (!value) return IDENTITY;
  let matrix = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/gi;
  let match;
  while ((match = re.exec(value))) {
    const name = match[1].toLowerCase();
    const args = match[2].trim().split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));
    let next = IDENTITY;
    if (name === 'matrix' && args.length >= 6) next = args.slice(0, 6);
    else if (name === 'translate') next = [1, 0, 0, 1, args[0] || 0, args[1] || 0];
    else if (name === 'scale') next = [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0];
    else if (name === 'rotate') {
      const angle = ((args[0] || 0) * Math.PI) / 180;
      const cx = args[1] || 0;
      const cy = args[2] || 0;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      next = [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
    } else if (name === 'skewx') next = [1, 0, Math.tan(((args[0] || 0) * Math.PI) / 180), 1, 0, 0];
    else if (name === 'skewy') next = [1, Math.tan(((args[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
    matrix = multiply(matrix, next);
  }
  return matrix;
}

function attrsToObject(attrs) {
  const out = {};
  for (const [key, value] of Object.entries(attrs || {})) out[key.toLowerCase()] = String(value);
  return out;
}

function parseStyle(style) {
  const out = {};
  if (!style) return out;
  for (const part of style.split(';')) {
    const idx = part.indexOf(':');
    if (idx > 0) out[part.slice(0, idx).trim().toLowerCase()] = part.slice(idx + 1).trim();
  }
  return out;
}

function normalizeColor(value) {
  if (!value) return null;
  let v = String(value).trim().toLowerCase();
  if (!v || v === 'none' || v === 'transparent' || v === 'currentcolor') return null;
  if (v.startsWith('url(')) return { ref: v };
  if (/^#[0-9a-f]{3}$/.test(v)) {
    v = '#' + v.slice(1).split('').map((c) => c + c).join('');
  }
  const rgb = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (rgb) {
    const [r, g, b] = rgb.slice(1, 4).map((n) => Math.max(0, Math.min(255, Math.round(Number(n)))));
    v = '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
  }
  return { color: v };
}

const PARAM_COUNT = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
const NUMBER_RE = /[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g;

function angleBetween(ux, uy, vx, vy) {
  const dot = ux * vx + uy * vy;
  const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (len === 0) return 0;
  const a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
  return ux * vy - uy * vx < 0 ? -a : a;
}

function pathStats(d, baseMatrix, state) {
  if (!d || typeof d !== 'string') return;
  const tokens = [];
  const re = /[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g;
  let match;
  while ((match = re.exec(d))) tokens.push(match[0]);
  let i = 0;
  let command = null;
  let prevCommand = null;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let started = false;
  let prevCubicCtrl = null;
  let prevQuadCtrl = null;
  const precisionOf = (token) => {
    if (/[eE]/.test(token)) return 6;
    const dot = token.indexOf('.');
    return dot < 0 ? 0 : token.length - dot - 1;
  };
  const point = (x, y) => {
    const [px, py] = apply(baseMatrix, x, y);
    if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
    if (px < state.minX) state.minX = px;
    if (py < state.minY) state.minY = py;
    if (px > state.maxX) state.maxX = px;
    if (py > state.maxY) state.maxY = py;
    return [px, py];
  };
  const addLength = (length) => {
    if (Number.isFinite(length) && length > 0) state.length += length;
  };
  const lineTo = (x, y) => {
    const p = point(x, y);
    if (p) addLength(Math.hypot(p[0] - state.lastPx, p[1] - state.lastPy));
    state.nodes++;
    state.segments++;
    state.lines++;
    cx = x;
    cy = y;
    if (p) {
      state.lastPx = p[0];
      state.lastPy = p[1];
    }
  };
  const cubicTo = (x1, y1, x2, y2, x3, y3) => {
    const samples = 16;
    let prev = [state.lastPx, state.lastPy];
    const startX = cx;
    const startY = cy;
    for (let s = 1; s <= samples; s++) {
      const t = s / samples;
      const mt = 1 - t;
      const x = mt * mt * mt * startX + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3;
      const y = mt * mt * mt * startY + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3;
      const p = point(x, y);
      if (p) {
        addLength(Math.hypot(p[0] - prev[0], p[1] - prev[1]));
        prev = p;
      }
    }
    state.nodes++;
    state.segments++;
    state.curves++;
    cx = x3;
    cy = y3;
    state.lastPx = prev[0];
    state.lastPy = prev[1];
  };
  const quadTo = (x1, y1, x2, y2) => {
    const samples = 16;
    let prev = [state.lastPx, state.lastPy];
    const startX = cx;
    const startY = cy;
    for (let s = 1; s <= samples; s++) {
      const t = s / samples;
      const mt = 1 - t;
      const x = mt * mt * startX + 2 * mt * t * x1 + t * t * x2;
      const y = mt * mt * startY + 2 * mt * t * y1 + t * t * y2;
      const p = point(x, y);
      if (p) {
        addLength(Math.hypot(p[0] - prev[0], p[1] - prev[1]));
        prev = p;
      }
    }
    state.nodes++;
    state.segments++;
    state.curves++;
    cx = x2;
    cy = y2;
    state.lastPx = prev[0];
    state.lastPy = prev[1];
  };

  while (i < tokens.length) {
    const token = tokens[i];
    if (/^[MmLlHhVvCcSsQqTtAaZz]$/.test(token)) {
      command = token;
      i++;
      if (command === 'Z' || command === 'z') {
        if (started && (cx !== sx || cy !== sy)) {
          const p = point(sx, sy);
          if (p) addLength(Math.hypot(p[0] - state.lastPx, p[1] - state.lastPy));
          cx = sx;
          cy = sy;
          if (p) {
            state.lastPx = p[0];
            state.lastPy = p[1];
          }
        }
        prevCommand = 'Z';
        prevCubicCtrl = null;
        prevQuadCtrl = null;
        command = null;
        continue;
      }
    }
    if (!command) {
      i++;
      continue;
    }
    const upper = command.toUpperCase();
    const count = PARAM_COUNT[upper];
    if (count === 0) {
      i++;
      continue;
    }
    if (i + count > tokens.length) {
      state.invalid++;
      break;
    }
    const args = tokens.slice(i, i + count);
    if (args.some((a) => /^[A-Za-z]$/.test(a))) {
      state.invalid++;
      command = null;
      continue;
    }
    const nums = args.map(Number);
    if (nums.some((n) => !Number.isFinite(n))) {
      state.invalid++;
      i += count;
      continue;
    }
    for (const a of args) state.precision = Math.max(state.precision, precisionOf(a));
    state.commands++;
    const rel = command === command.toLowerCase();
    const ox = rel ? cx : 0;
    const oy = rel ? cy : 0;
    if (upper === 'M') {
      state.subpaths++;
      state.nodes++;
      cx = nums[0] + ox;
      cy = nums[1] + oy;
      sx = cx;
      sy = cy;
      started = true;
      const p = point(cx, cy);
      if (p) {
        state.lastPx = p[0];
        state.lastPy = p[1];
      }
      prevCommand = 'M';
      prevCubicCtrl = null;
      prevQuadCtrl = null;
      command = command === 'M' ? 'L' : 'l';
      i += 2;
      continue;
    }
    if (!started) {
      sx = cx;
      sy = cy;
      started = true;
    }
    if (upper === 'L') lineTo(nums[0] + ox, nums[1] + oy);
    else if (upper === 'H') lineTo(nums[0] + ox, cy);
    else if (upper === 'V') lineTo(cx, nums[0] + oy);
    else if (upper === 'C') {
      const x1 = nums[0] + ox, y1 = nums[1] + oy;
      const x2 = nums[2] + ox, y2 = nums[3] + oy;
      const x3 = nums[4] + ox, y3 = nums[5] + oy;
      state.controlPoints += 2;
      cubicTo(x1, y1, x2, y2, x3, y3);
      prevCubicCtrl = [x2, y2];
      prevQuadCtrl = null;
      state.cubic++;
    } else if (upper === 'S') {
      const x1 = prevCubicCtrl ? 2 * cx - prevCubicCtrl[0] : cx;
      const y1 = prevCubicCtrl ? 2 * cy - prevCubicCtrl[1] : cy;
      const x2 = nums[0] + ox, y2 = nums[1] + oy;
      const x3 = nums[2] + ox, y3 = nums[3] + oy;
      state.controlPoints += 1;
      cubicTo(x1, y1, x2, y2, x3, y3);
      prevCubicCtrl = [x2, y2];
      prevQuadCtrl = null;
      state.cubic++;
    } else if (upper === 'Q') {
      const x1 = nums[0] + ox, y1 = nums[1] + oy;
      const x2 = nums[2] + ox, y2 = nums[3] + oy;
      state.controlPoints += 1;
      quadTo(x1, y1, x2, y2);
      prevQuadCtrl = [x1, y1];
      prevCubicCtrl = null;
      state.quadratic++;
    } else if (upper === 'T') {
      const x1 = prevQuadCtrl ? 2 * cx - prevQuadCtrl[0] : cx;
      const y1 = prevQuadCtrl ? 2 * cy - prevQuadCtrl[1] : cy;
      const x2 = nums[0] + ox, y2 = nums[1] + oy;
      quadTo(x1, y1, x2, y2);
      prevQuadCtrl = [x1, y1];
      prevCubicCtrl = null;
      state.quadratic++;
    } else if (upper === 'A') {
      state.arcs++;
      state.curves++;
      state.segments++;
      state.nodes++;
      const x = nums[5] + ox;
      const y = nums[6] + oy;
      const p = point(x, y);
      if (p) {
        addLength(Math.hypot(p[0] - state.lastPx, p[1] - state.lastPy));
        state.lastPx = p[0];
        state.lastPy = p[1];
      }
      cx = x;
      cy = y;
    }
    if (!['C', 'S', 'Q', 'T'].includes(upper)) {
      prevCubicCtrl = null;
      prevQuadCtrl = null;
    }
    prevCommand = upper;
    i += count;
  }
}

export function analyzeSvg(svg, sourceWidth, sourceHeight) {
  const state = {
    paths: 0,
    subpaths: 0,
    nodes: 0,
    segments: 0,
    lines: 0,
    curves: 0,
    cubic: 0,
    quadratic: 0,
    arcs: 0,
    controlPoints: 0,
    commands: 0,
    precision: 0,
    invalid: 0,
    length: 0,
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    lastPx: 0,
    lastPy: 0,
    gradients: 0,
    shapes: 0,
    hasText: false,
    hasImage: false,
    hasUse: false,
    colors: new Set(),
    colorRefs: 0,
  };
  let root = null;
  const stack = [IDENTITY];
  let depth = 0;
  let parseError = null;
  const parser = sax.parser(true, { lowercase: true, trim: false, normalize: false });
  parser.onopentag = (node) => {
    const attrs = attrsToObject(node.attributes);
    const name = node.name.toLowerCase().split(':').pop();
    const style = parseStyle(attrs.style);
    if (name === 'svg' && !root) {
      root = attrs;
    }
    if (['g', 'svg', 'a', 'symbol', 'defs'].includes(name)) {
      const local = parseTransform(attrs.transform);
      stack.push(multiply(stack[stack.length - 1], local));
      depth++;
    }
    if (name === 'lineargradient' || name === 'radialgradient') state.gradients++;
    if (name === 'text' || name === 'tspan') state.hasText = true;
    if (name === 'image') state.hasImage = true;
    if (name === 'use') state.hasUse = true;
    if (['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line'].includes(name)) state.shapes++;
    if (name === 'path') {
      state.paths++;
      const local = parseTransform(attrs.transform);
      const matrix = multiply(stack[stack.length - 1], local);
      const before = state.segments;
      pathStats(attrs.d, matrix, state);
      if (state.segments === before && attrs.d) state.invalid++;
    }
    for (const key of ['fill', 'stroke']) {
      const raw = style[key] ?? attrs[key];
      const parsed = normalizeColor(raw);
      if (parsed?.color) state.colors.add(parsed.color);
      if (parsed?.ref) state.colorRefs++;
    }
  };
  parser.onclosetag = (name) => {
    const local = String(name).toLowerCase().split(':').pop();
    if (['g', 'svg', 'a', 'symbol', 'defs'].includes(local)) {
      if (stack.length > 1) stack.pop();
      depth = Math.max(0, depth - 1);
    }
  };
  try {
    parser.write(svg).close();
  } catch (error) {
    parseError = error.message;
  }

  const viewBox = parseViewBox(root?.viewbox || root?.viewBox);
  const vbX = viewBox?.x ?? 0;
  const vbY = viewBox?.y ?? 0;
  const vbW = viewBox?.w || Number(root?.width) || sourceWidth || 1;
  const vbH = viewBox?.h || Number(root?.height) || sourceHeight || 1;
  const sx = (sourceWidth || vbW) / vbW;
  const sy = (sourceHeight || vbH) / vbH;
  // Recompute bbox/length in source pixels if the root viewBox differs.
  // Paths were parsed in viewBox units; rescale the aggregate values here.
  const bbox = Number.isFinite(state.minX)
    ? {
        x: round2((state.minX - vbX) * sx),
        y: round2((state.minY - vbY) * sy),
        width: round2((state.maxX - state.minX) * sx),
        height: round2((state.maxY - state.minY) * sy),
      }
    : null;
  const scale = Math.sqrt(Math.abs(sx * sy)) || 1;
  const pathLength = round2(state.length * scale);
  const nodeDensity = sourceWidth && sourceHeight ? round3((state.nodes / (sourceWidth * sourceHeight)) * 1e6) : null;
  return {
    paths: state.paths,
    subpaths: state.subpaths,
    nodes: state.nodes,
    segments: state.segments,
    lines: state.lines,
    curves: state.curves,
    cubic: state.cubic,
    quadratic: state.quadratic,
    arcs: state.arcs,
    controlPoints: state.controlPoints,
    commands: state.commands,
    coordinatePrecision: state.precision,
    colors: state.colors.size,
    colorRefs: state.colorRefs,
    gradients: state.gradients,
    shapes: state.shapes,
    hasText: state.hasText,
    hasImage: state.hasImage,
    hasUse: state.hasUse,
    pathLengthPx: pathLength,
    meanSegmentPx: state.segments ? round2(pathLength / state.segments) : 0,
    nodesPerMegapixel: nodeDensity,
    bbox,
    viewBox: viewBox ? { ...viewBox } : null,
    invalidPaths: state.invalid,
    parseError,
  };
}

function round2(n) {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
function round3(n) {
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
}

function parseViewBox(value) {
  if (!value) return null;
  const nums = String(value).trim().split(/[\s,]+/).map(Number);
  if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n)) || nums[2] <= 0 || nums[3] <= 0) return null;
  return { x: nums[0], y: nums[1], w: nums[2], h: nums[3] };
}

export function sanitizeSvg(svg) {
  let out = String(svg);
  out = out.replace(/<\?xml[\s\S]*?\?>/gi, '');
  out = out.replace(/<!DOCTYPE[\s\S]*?>/gi, '');
  out = out.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '');
  out = out.replace(/<script\b[^>]*\/>/gi, '');
  out = out.replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, '');
  out = out.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '');
  out = out.replace(/(?:xlink:)?href\s*=\s*("|')\s*(?:javascript|data):[^"']*\1/gi, '');
  out = out.replace(/(?:xlink:)?href\s*=\s*("|')https?:\/\/[^"']*\1/gi, '');
  return out.trim();
}

export function normalizeSvg(svg, width, height) {
  const sanitized = sanitizeSvg(svg);
  const open = sanitized.match(/<svg\b([^>]*)>/i);
  if (!open) {
    return {
      renderSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="none"/></svg>`,
      displaySvg: '',
      viewBox: { x: 0, y: 0, w: width, h: height },
      aspectMismatch: 0,
    };
  }
  const attrs = parseAttrs(open[1]);
  const viewBox = parseViewBox(attrs.viewbox || attrs.viewBox) || {
    x: 0,
    y: 0,
    w: Number.parseFloat(attrs.width) || width,
    h: Number.parseFloat(attrs.height) || height,
  };
  const closeIdx = sanitized.toLowerCase().lastIndexOf('</svg>');
  const inner = closeIdx > 0 ? sanitized.slice(open.index + open[0].length, closeIdx) : sanitized.slice(open.index + open[0].length);
  const head = `xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}" preserveAspectRatio="xMidYMid meet"`;
  const renderSvg = `<svg ${head} width="${width}" height="${height}">${inner}</svg>`;
  const displaySvg = `<svg ${head} width="100%" height="100%">${inner}</svg>`;
  const aspectMismatch = Math.abs(viewBox.w / viewBox.h - width / height) / (width / height);
  return { renderSvg, displaySvg, viewBox, aspectMismatch };
}

function parseAttrs(text) {
  const attrs = {};
  const re = /([:\w-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(text))) attrs[m[1].toLowerCase()] = m[3] ?? m[4] ?? '';
  return attrs;
}
