import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.js';
import { AppError } from '../errors.js';

let initPromise = null;
let ResvgClass = null;

export async function initRenderer() {
  if (ResvgClass) return ResvgClass;
  if (!initPromise) {
    initPromise = (async () => {
      const mod = await import('@resvg/resvg-wasm');
      const wasmPath = path.join(ROOT, 'node_modules', '@resvg', 'resvg-wasm', 'index_bg.wasm');
      await mod.initWasm(readFileSync(wasmPath));
      ResvgClass = mod.Resvg;
      return mod.Resvg;
    })();
  }
  return initPromise;
}

/**
 * Rasterizes an SVG at exactly width×height on a transparent background.
 * Returns both RGBA pixels (for metrics) and a PNG buffer (for storage/UI).
 */
export async function renderSvg(svg, width, height) {
  await initRenderer();
  try {
    const renderer = new ResvgClass(svg, {
      fitTo: { mode: 'original' },
      background: undefined,
    });
    const image = renderer.render();
    const png = Buffer.from(image.asPng());
    const pixels = image.pixels;
    const rgba = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
    if (image.width !== width || image.height !== height) {
      throw new AppError(
        'RENDER_SIZE_MISMATCH',
        `Рендер ${image.width}×${image.height} не совпадает с источником ${width}×${height}`,
        500,
      );
    }
    return { rgba, png, width: image.width, height: image.height };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('RENDER_FAILED', 'Не удалось отрисовать SVG: ' + error.message, 500);
  }
}
