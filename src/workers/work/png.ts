// A small PNG encoder for exported images (M4-06): 8-bit RGBA, filter 0, zlib
// through the platform's CompressionStream. Exact pixels — a canvas would
// premultiply alpha and change semi-transparent colours. Runs in the Work
// worker (rule 1); no dependency.
import { crc32 } from './zip';

async function zlib(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** `rgba`: width × height × 4 bytes, rows top to bottom, straight (not premultiplied) alpha. */
export async function encodePng(
  rgba: Uint8Array,
  width: number,
  height: number,
): Promise<Uint8Array> {
  if (rgba.length !== width * height * 4)
    throw new RangeError('pixel data does not match the size');
  const opaque = rgba.every((b, i) => i % 4 !== 3 || b === 255);
  const channels = opaque ? 3 : 4;
  const raw = new Uint8Array(height * (1 + width * channels));
  for (let y = 0, o = 0; y < height; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      raw[o++] = rgba[i] ?? 0;
      raw[o++] = rgba[i + 1] ?? 0;
      raw[o++] = rgba[i + 2] ?? 0;
      if (!opaque) raw[o++] = rgba[i + 3] ?? 0;
    }
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr.set([8, opaque ? 2 : 6, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', await zlib(raw)),
    chunk('IEND', new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * A PDFium bitmap's pixels as RGBA. Formats: 1 gray, 2 BGR, 3 BGRx, 4 BGRA
 * (FPDFBitmap_Gray … FPDFBitmap_BGRA).
 */
export function toRgba(
  src: Uint8Array,
  width: number,
  height: number,
  stride: number,
  format: number,
): Uint8Array {
  const bpp = format === 1 ? 1 : format === 2 ? 3 : 4;
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = y * stride + x * bpp;
      const d = (y * width + x) * 4;
      if (bpp === 1) {
        const g = src[s] ?? 0;
        out[d] = g;
        out[d + 1] = g;
        out[d + 2] = g;
        out[d + 3] = 255;
      } else {
        out[d] = src[s + 2] ?? 0;
        out[d + 1] = src[s + 1] ?? 0;
        out[d + 2] = src[s] ?? 0;
        out[d + 3] = format === 4 ? (src[s + 3] ?? 0) : 255;
      }
    }
  }
  return out;
}
