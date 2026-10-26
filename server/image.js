import crypto from 'node:crypto';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { AppError } from './errors.js';
import { LIMITS } from './config.js';

export function sniffFormat(buffer) {
  if (!buffer || buffer.length < 12) return 'unknown';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpeg';
  if (buffer.slice(0, 6).toString('ascii') === 'GIF87a' || buffer.slice(0, 6).toString('ascii') === 'GIF89a') return 'gif';
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (buffer.slice(0, 2).toString('ascii') === 'BM') return 'bmp';
  if (buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a) return 'tiff';
  if (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[3] === 0x2a) return 'tiff';
  return 'unknown';
}

const MIME_BY_FORMAT = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  unknown: 'application/octet-stream',
};

export function mimeForFormat(format) {
  return MIME_BY_FORMAT[format] || MIME_BY_FORMAT.unknown;
}

export function decodePng(buffer) {
  try {
    const png = PNG.sync.read(buffer);
    return { rgba: new Uint8Array(png.data), width: png.width, height: png.height, format: 'png' };
  } catch (error) {
    throw new AppError('INVALID_PNG', 'Не удалось прочитать PNG: ' + error.message, 400);
  }
}

export function decodeJpeg(buffer) {
  try {
    const raw = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: true, tolerantDecoding: true });
    return { rgba: new Uint8Array(raw.data), width: raw.width, height: raw.height, format: 'jpeg' };
  } catch (error) {
    throw new AppError('INVALID_JPEG', 'Не удалось прочитать JPEG: ' + error.message, 400);
  }
}

export function decodeImage(buffer, { allowFormats = ['png', 'jpeg'] } = {}) {
  const format = sniffFormat(buffer);
  if (!allowFormats.includes(format)) {
    throw new AppError(
      'UNSUPPORTED_FORMAT',
      `Сервер принимает ${allowFormats.map((f) => f.toUpperCase()).join(' / ')}. Формат ${format.toUpperCase()} конвертируется в браузере при загрузке.`,
      415,
    );
  }
  const decoded = format === 'png' ? decodePng(buffer) : decodeJpeg(buffer);
  if (format === 'jpeg') {
    const orientation = readExifOrientation(buffer);
    if (orientation && orientation !== 1) {
      const transformed = orientRGBA(decoded.rgba, decoded.width, decoded.height, orientation);
      decoded.rgba = transformed.rgba;
      decoded.width = transformed.width;
      decoded.height = transformed.height;
      decoded.orientation = orientation;
    }
  }
  validateDimensions(decoded.width, decoded.height);
  return decoded;
}

export function validateDimensions(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new AppError('INVALID_DIMENSIONS', 'Некорректные размеры изображения');
  }
  if (width * height > LIMITS.maxPixels) {
    throw new AppError(
      'IMAGE_TOO_LARGE',
      `Изображение ${width}×${height} содержит ${(width * height / 1e6).toFixed(1)} Мп; лимит — ${(LIMITS.maxPixels / 1e6).toFixed(1)} Мп. Уменьшите сторону.`,
      413,
    );
  }
}

export function parseHexColor(hex) {
  const value = typeof hex === 'string' ? hex.trim().replace('#', '') : 'FFFFFF';
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return { r: 255, g: 255, b: 255 };
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

export function compositeBackground(rgba, bgHex) {
  const bg = parseHexColor(bgHex);
  const out = new Uint8Array(rgba.length);
  let transparent = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3] / 255;
    if (a < 0.999) transparent++;
    out[i] = Math.round(rgba[i] * a + bg.r * (1 - a));
    out[i + 1] = Math.round(rgba[i + 1] * a + bg.g * (1 - a));
    out[i + 2] = Math.round(rgba[i + 2] * a + bg.b * (1 - a));
    out[i + 3] = 255;
  }
  return { rgba: out, transparentRatio: transparent / (rgba.length / 4) };
}

export function downscaleRGBA(rgba, width, height, maxSide) {
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { rgba, width, height, scale: 1 };
  const scale = maxSide / longest;
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));
  const out = new Uint8Array(targetW * targetH * 4);
  const xRatio = width / targetW;
  const yRatio = height / targetH;

  for (let ty = 0; ty < targetH; ty++) {
    const sy0 = ty * yRatio;
    const sy1 = Math.min(height, (ty + 1) * yRatio);
    const y0 = Math.floor(sy0);
    const y1 = Math.ceil(sy1);
    for (let tx = 0; tx < targetW; tx++) {
      const sx0 = tx * xRatio;
      const sx1 = Math.min(width, (tx + 1) * xRatio);
      const x0 = Math.floor(sx0);
      const x1 = Math.ceil(sx1);
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let sy = y0; sy < y1; sy++) {
        const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
        if (wy <= 0) continue;
        for (let sx = x0; sx < x1; sx++) {
          const wx = Math.min(sx + 1, sx1) - Math.max(sx, sx0);
          if (wx <= 0) continue;
          const w = wx * wy;
          const i = (sy * width + sx) * 4;
          r += rgba[i] * w;
          g += rgba[i + 1] * w;
          b += rgba[i + 2] * w;
          a += rgba[i + 3] * w;
          wsum += w;
        }
      }
      const o = (ty * targetW + tx) * 4;
      out[o] = Math.round(r / wsum);
      out[o + 1] = Math.round(g / wsum);
      out[o + 2] = Math.round(b / wsum);
      out[o + 3] = Math.round(a / wsum);
    }
  }
  return { rgba: out, width: targetW, height: targetH, scale };
}

export function encodePng(rgba, width, height, colorType = 6) {
  const png = new PNG({ width, height, colorType });
  png.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  return PNG.sync.write(png);
}

export function cropRGBA(rgba, width, height, rect) {
  const x = Math.max(0, Math.min(width - 1, Math.floor(rect.x)));
  const y = Math.max(0, Math.min(height - 1, Math.floor(rect.y)));
  const w = Math.max(1, Math.min(width - x, Math.floor(rect.w)));
  const h = Math.max(1, Math.min(height - y, Math.floor(rect.h)));
  const out = new Uint8Array(w * h * 4);
  for (let row = 0; row < h; row++) {
    const from = ((y + row) * width + x) * 4;
    out.set(rgba.subarray(from, from + w * 4), row * w * 4);
  }
  return { rgba: out, width: w, height: h, rect: { x, y, w, h } };
}

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function sha1(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

export function orientRGBA(rgba, width, height, orientation) {
  const swap = orientation >= 5 && orientation <= 8;
  const outW = swap ? height : width;
  const outH = swap ? width : height;
  const out = new Uint8Array(outW * outH * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let dx = x;
      let dy = y;
      switch (orientation) {
        case 2: dx = width - 1 - x; break;
        case 3: dx = width - 1 - x; dy = height - 1 - y; break;
        case 4: dy = height - 1 - y; break;
        case 5: dx = y; dy = x; break;
        case 6: dx = height - 1 - y; dy = x; break;
        case 7: dx = height - 1 - y; dy = width - 1 - x; break;
        case 8: dx = y; dy = width - 1 - x; break;
        default: break;
      }
      const si = (y * width + x) * 4;
      const di = (dy * outW + dx) * 4;
      out[di] = rgba[si];
      out[di + 1] = rgba[si + 1];
      out[di + 2] = rgba[si + 2];
      out[di + 3] = rgba[si + 3];
    }
  }
  return { rgba: out, width: outW, height: outH };
}

export function readExifOrientation(buffer) {
  try {
    if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return 1;
    let offset = 2;
    while (offset + 4 < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (marker === 0xe1) {
        const exifStart = offset + 4;
        if (buffer.toString('ascii', exifStart, exifStart + 4) !== 'Exif') return 1;
        const tiff = exifStart + 6;
        const little = buffer.toString('ascii', tiff, tiff + 2) === 'II';
        const read16 = (o) => (little ? buffer.readUInt16LE(o) : buffer.readUInt16BE(o));
        const read32 = (o) => (little ? buffer.readUInt32LE(o) : buffer.readUInt32BE(o));
        const ifdOffset = read32(tiff + 4);
        const ifd = tiff + ifdOffset;
        const count = read16(ifd);
        for (let i = 0; i < count; i++) {
          const entry = ifd + 2 + i * 12;
          const tag = read16(entry);
          if (tag === 0x0112) {
            const type = read16(entry + 2);
            if (type === 3) return read16(entry + 8);
          }
        }
        return 1;
      }
      if (marker === 0xd9 || marker === 0xda) break;
      offset += 2 + length;
    }
  } catch {
    return 1;
  }
  return 1;
}

export function describeSource(decoded, { originalName, originalMime, originalBytes, originalSha256, normalizedBuffer, maxSide, scale }) {
  const hasAlpha = (() => {
    for (let i = 3; i < decoded.rgba.length; i += 4) if (decoded.rgba[i] < 255) return true;
    return false;
  })();
  return {
    originalName,
    originalMime,
    originalBytes,
    originalSha256,
    format: decoded.format,
    width: decoded.width,
    height: decoded.height,
    megapixels: Number(((decoded.width * decoded.height) / 1e6).toFixed(3)),
    aspect: Number((decoded.width / decoded.height).toFixed(4)),
    hasAlpha,
    orientation: decoded.orientation || 1,
    normalizedBytes: normalizedBuffer?.length,
    normalizedSha256: normalizedBuffer ? sha256(normalizedBuffer) : undefined,
    maxSide,
    scale,
  };
}


/**
 * Estimates the visual background of an opaque raster from border pixels.
 * Used only as the compositing colour for transparent SVG areas in metrics,
 * so transparent-background engines are not penalised for not painting a
 * background they never had.
 */
export function estimateBackground(rgba, width, height) {
  const rs = [], gs = [], bs = [];
  const stepX = Math.max(1, Math.floor(width / 200));
  const stepY = Math.max(1, Math.floor(height / 200));
  for (let x = 0; x < width; x += stepX) {
    for (const y of [0, Math.max(0, height - 1)]) {
      const i = (y * width + x) * 4;
      rs.push(rgba[i]); gs.push(rgba[i + 1]); bs.push(rgba[i + 2]);
    }
  }
  for (let y = 0; y < height; y += stepY) {
    for (const x of [0, Math.max(0, width - 1)]) {
      const i = (y * width + x) * 4;
      rs.push(rgba[i]); gs.push(rgba[i + 1]); bs.push(rgba[i + 2]);
    }
  }
  const med = (arr) => {
    arr.sort((a, b) => a - b);
    return arr[Math.floor(arr.length / 2)] || 0;
  };
  const r = med(rs), g = med(gs), b = med(bs);
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase();
}
