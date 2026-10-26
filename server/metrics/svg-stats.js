import { gzipSync } from 'node:zlib';
import crypto from 'node:crypto';
import { analyzeSvg } from '../svg.js';

export function svgStats(svg, width, height) {
  const bytes = Buffer.byteLength(svg, 'utf8');
  const gzip = gzipSync(Buffer.from(svg, 'utf8'), { level: 9, mtime: 0 }).length;
  return {
    ...analyzeSvg(svg, width, height),
    bytes,
    gzipBytes: gzip,
    gzipRatio: bytes ? Number((gzip / bytes).toFixed(4)) : 0,
    bytesPerPixel: width * height ? Number((bytes / (width * height)).toFixed(4)) : 0,
    sha1: crypto.createHash('sha1').update(svg).digest('hex'),
  };
}
