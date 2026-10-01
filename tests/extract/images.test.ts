// Export Images (M4-06) on real PDFium (the WASM the workers load) and the
// self-made image fixture: JPEG bytes passed through, PNG for the rest (alpha
// kept), repeats written once, tiny images skipped, Form XObjects searched.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { inflateSync } from 'node:zlib';
import { init } from '@embedpdf/pdfium';
import { describe, expect, it } from 'vitest';
import { imagesPdf, JPEG_24 } from '../../e2e/fixtures/extraction.ts';
import { exportImages } from '../../src/workers/work/images';
import { encodePng, toRgba } from '../../src/workers/work/png';
import type { JobSlice } from '../../src/workers/work/scheduler';

const require = createRequire(import.meta.url);
const mod = await init({
  wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')),
});
const heap = mod.pdfium as unknown as {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  HEAPU8: Uint8Array;
};
(mod as unknown as { PDFiumExt_Init(): void }).PDFiumExt_Init();

function openDoc(bytes: Uint8Array): number {
  const p = heap.wasmExports.malloc(bytes.length);
  heap.HEAPU8.set(bytes, p);
  const doc = (
    mod as unknown as { FPDF_LoadMemDocument(p: number, n: number, pw: string): number }
  ).FPDF_LoadMemDocument(p, bytes.length, '');
  if (!doc) throw new Error('open failed');
  return doc;
}
const slice = { checkpoint: () => Promise.resolve() } as unknown as JobSlice;

/** Reads a PNG back: size, colour type and the unfiltered pixel rows. */
function readPng(png: Uint8Array) {
  const v = new DataView(png.buffer, png.byteOffset);
  let at = 8;
  let width = 0;
  let height = 0;
  let type = 0;
  const idat: Uint8Array[] = [];
  while (at < png.length) {
    const len = v.getUint32(at);
    const kind = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const data = png.subarray(at + 8, at + 8 + len);
    if (kind === 'IHDR') {
      width = new DataView(data.buffer, data.byteOffset).getUint32(0);
      height = new DataView(data.buffer, data.byteOffset).getUint32(4);
      type = data[9] ?? 0;
    }
    if (kind === 'IDAT') idat.push(data);
    at += 12 + len;
  }
  return { width, height, type, raw: inflateSync(Buffer.concat(idat)) };
}

describe('PNG encoder (M4-06)', () => {
  it('writes exact RGB when opaque and RGBA when not', async () => {
    const rgba = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]);
    const a = readPng(await encodePng(rgba, 2, 1));
    expect([a.width, a.height, a.type]).toEqual([2, 1, 2]);
    expect([...a.raw]).toEqual([0, 10, 20, 30, 40, 50, 60]);
    const b = readPng(await encodePng(new Uint8Array([1, 2, 3, 128]), 1, 1));
    expect(b.type).toBe(6);
    expect([...b.raw]).toEqual([0, 1, 2, 3, 128]);
  });

  it('converts PDFium bitmap layouts (gray, BGR, BGRx, BGRA) with row padding', () => {
    expect([...toRgba(new Uint8Array([7, 0]), 1, 1, 2, 1)]).toEqual([7, 7, 7, 255]);
    expect([...toRgba(new Uint8Array([3, 2, 1, 0]), 1, 1, 4, 2)]).toEqual([1, 2, 3, 255]);
    expect([...toRgba(new Uint8Array([3, 2, 1, 9]), 1, 1, 4, 3)]).toEqual([1, 2, 3, 255]);
    expect([...toRgba(new Uint8Array([3, 2, 1, 9]), 1, 1, 4, 4)]).toEqual([1, 2, 3, 9]);
  });
});

describe('Export Images (M4-06)', () => {
  it('every distinct image once, JPEG as JPEG, the rest as PNG, dots skipped', async () => {
    const doc = openDoc(imagesPdf());
    const progress: number[] = [];
    const r = await exportImages(mod, doc, [0, 1, 2], slice, (p) => progress.push(p.done));
    expect(r.files.map((f) => f.path)).toEqual([
      'page-1-image-1.jpg',
      'page-1-image-2.png',
      'page-1-image-3.png',
      'page-2-image-1.png',
      'page-2-image-2.png',
      'page-3-image-1.png',
    ]);
    expect(r.images).toBe(6);
    expect(r.duplicates).toBe(1); // the logo on page 2
    expect(r.skipped).toBe(1); // the 4 × 4 dot
    expect(progress).toEqual([0, 1, 2, 3]);
    // The JPEG is the file's own stream, byte for byte.
    expect(Buffer.from(r.files[0]?.data as Uint8Array).equals(JPEG_24)).toBe(true);
    // The 40 × 20 Flate image keeps its pixel size and colours.
    const rgbPng = readPng(r.files[1]?.data as Uint8Array);
    expect([rgbPng.width, rgbPng.height, rgbPng.type]).toEqual([40, 20, 2]);
    expect([...rgbPng.raw.subarray(1, 4)]).toEqual([0, 0, 128]);
    // The soft-masked image keeps its alpha.
    const masked = readPng(r.files[3]?.data as Uint8Array);
    expect(masked.type).toBe(6);
  });

  it('only the chosen pages', async () => {
    const doc = openDoc(imagesPdf());
    const r = await exportImages(mod, doc, [2], slice, () => undefined);
    expect(r.files.map((f) => f.path)).toEqual(['page-3-image-1.png']);
  });
});
