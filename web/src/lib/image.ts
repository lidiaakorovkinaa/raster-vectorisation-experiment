import type { NormalizedImage } from '@/types';

const MAX_LOCAL_PIXELS = 60_000_000;

function fileIsImage(file: File): boolean {
  return file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|tiff?|avif|heic|svg)$/i.test(file.name);
}

async function bitmapFromFile(file: File): Promise<{ bitmap: ImageBitmap | HTMLImageElement; width: number; height: number; revoke: () => void }> {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
      return { bitmap, width: bitmap.width, height: bitmap.height, revoke: () => bitmap.close() };
    } catch {
      /* fall back to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Браузер не смог декодировать изображение'));
    image.src = url;
  });
  return { bitmap: image, width: image.naturalWidth, height: image.naturalHeight, revoke: () => URL.revokeObjectURL(url) };
}

export async function normalizeImage(file: File, { maxSide, background }: { maxSide: number; background: string }): Promise<NormalizedImage> {
  if (!fileIsImage(file)) throw new Error(`Файл «${file.name}» не является изображением.`);
  if (file.size > 40 * 1024 * 1024) throw new Error(`Файл «${file.name}» больше 40 МБ.`);
  const decoded = await bitmapFromFile(file);
  try {
    const { width: sourceWidth, height: sourceHeight } = decoded;
    if (!sourceWidth || !sourceHeight) throw new Error('Не удалось определить размеры изображения.');
    if (sourceWidth * sourceHeight > MAX_LOCAL_PIXELS) throw new Error(`Изображение ${sourceWidth}×${sourceHeight} слишком велико для браузера.`);
    const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D недоступен.');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(decoded.bitmap, 0, 0, width, height);
    const normalized = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Не удалось закодировать PNG.'))), 'image/png');
    });
    return {
      file,
      normalized,
      width,
      height,
      sourceWidth,
      sourceHeight,
      scale,
      orientationApplied: true,
    };
  } finally {
    decoded.revoke();
  }
}

export async function sampleToFile(sampleId: string): Promise<File> {
  const response = await fetch(`/samples/${sampleId}.png`);
  if (!response.ok) throw new Error('Не удалось загрузить пример.');
  const blob = await response.blob();
  return new File([blob], `${sampleId}.png`, { type: 'image/png' });
}

export function fileExtension(name: string): string {
  return name.split('.').pop()?.toLowerCase() || '';
}

export function makeBatchId(): string {
  return `batch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function revoke(url: string | undefined) {
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
}
