// Copy or save an image on the page (M11-08·O6) on real PDFium (the WASM the
// workers load) and self-made fixtures: the image under a point (topmost, in a
// Form XObject, inline, turned; dots and empty space miss), and its PNG at the
// image's own resolution (exact pixels; a soft mask's alpha kept at full size).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { deflateSync, inflateSync } from 'node:zlib';
import { init } from '@embedpdf/pdfium';
import { describe, expect, it } from 'vitest';
import { imagesPdf } from '../../e2e/fixtures/extraction.ts';
import { buildPdf } from '../../e2e/fixtures/generate.ts';
import { rawCall } from '../../src/workers/render/pdfium';
import { imageUnder } from '../../src/workers/shared/pageImages';
import { pageImagePng } from '../../src/workers/work/pageImage';
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

/** Page points (top-left origin) of a user-space point on a 792 pt high page. */
const pt = (x: number, y: number) => ({ x, y: 792 - y });

function hitOn(doc: number, pageIndex: number, at: { x: number; y: number }) {
  const page = rawCall(mod, 'FPDF_LoadPage', doc, pageIndex);
  try {
    const hit = imageUnder(mod, page, at);
    return hit ? { width: hit.width, height: hit.height } : null;
  } finally {
    rawCall(mod, 'FPDF_ClosePage', page);
  }
}

/** Reads a PNG back: size, colour type and the unfiltered pixel rows (filter 0). */
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
  const raw = inflateSync(Buffer.concat(idat));
  const channels = type === 6 ? 4 : 3;
  const px = (x: number, y: number): number[] => {
    const o = y * (1 + width * channels) + 1 + x * channels;
    return [...raw.subarray(o, o + channels)];
  };
  return { width, height, type, px };
}

describe('the image under a point (M11-08·O6)', () => {
  const doc = openDoc(imagesPdf());

  it('finds each image at its own pixel size', () => {
    expect(hitOn(doc, 0, pt(98, 648))).toEqual({ width: 24, height: 24 }); // the JPEG
    expect(hitOn(doc, 0, pt(280, 640))).toEqual({ width: 40, height: 20 }); // Flate RGB
    expect(hitOn(doc, 0, pt(80, 430))).toEqual({ width: 32, height: 32 }); // the logo
    expect(hitOn(doc, 1, pt(240, 640))).toEqual({ width: 20, height: 20 }); // soft mask
    expect(hitOn(doc, 1, pt(80, 430))).toEqual({ width: 16, height: 16 }); // inline image
  });

  it('looks inside Form XObjects, with the form’s matrix', () => {
    expect(hitOn(doc, 2, pt(160, 530))).toEqual({ width: 30, height: 30 });
    expect(hitOn(doc, 2, pt(90, 530))).toBeNull();
  });

  it('misses empty space and images below the size limit (a 4 × 4 dot)', () => {
    expect(hitOn(doc, 0, pt(500, 700))).toBeNull();
    expect(hitOn(doc, 0, pt(404, 604))).toBeNull();
  });
});

/** Two images overlapping (the second drawn on top), one turned 90°, on a cropped page. */
function overlapPdf(): Uint8Array {
  const img = (w: number, h: number, rgb: [number, number, number]) => {
    const row = String.fromCharCode(...rgb).repeat(w);
    return {
      dict: `<< /Type /XObject /Subtype /Image /Width ${String(w)} /Height ${String(h)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode >>`,
      stream: deflateSync(Buffer.from(row.repeat(h), 'latin1')).toString('latin1'),
    };
  };
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /CropBox [36 36 576 756] /Resources << /XObject << /A 5 0 R /B 6 0 R /T 7 0 R >> >> /Contents 4 0 R >>',
    {
      dict: '<< >>',
      stream:
        'q 200 0 0 200 100 400 cm /A Do Q q 100 0 0 100 150 450 cm /B Do Q q 0 80 -40 0 400 200 cm /T Do Q',
    },
    img(50, 50, [255, 0, 0]),
    img(20, 20, [0, 0, 255]),
    img(60, 30, [0, 160, 0]),
  ]);
}

describe('topmost, turned and cropped', () => {
  const doc = openDoc(overlapPdf());
  // The crop box's top-left corner (36, 756) is the page point origin.
  const at = (x: number, y: number) => ({ x: x - 36, y: 756 - y });

  it('takes the image drawn last where two overlap', () => {
    expect(hitOn(doc, 0, at(200, 500))).toEqual({ width: 20, height: 20 });
    expect(hitOn(doc, 0, at(120, 420))).toEqual({ width: 50, height: 50 });
  });

  it('follows a turned image’s own shape', () => {
    // x 360–400, y 200–280.
    expect(hitOn(doc, 0, at(380, 260))).toEqual({ width: 60, height: 30 });
    expect(hitOn(doc, 0, at(420, 260))).toBeNull();
  });
});

describe('the PNG (M11-08·O6)', () => {
  it('gives an opaque image’s exact pixels at its own size', async () => {
    const doc = openDoc(imagesPdf());
    const r = await pageImagePng(mod, doc, 0, pt(280, 640), slice);
    expect(r).not.toBeNull();
    const png = readPng(r?.png ?? new Uint8Array());
    expect([png.width, png.height, png.type]).toEqual([40, 20, 2]);
    // The fixture's gradient: (x·5, y·7, 128).
    expect(png.px(0, 0)).toEqual([0, 0, 128]);
    expect(png.px(39, 19)).toEqual([195, 133, 128]);
  });

  it('gives a JPEG as a PNG of its decoded pixels', async () => {
    const doc = openDoc(imagesPdf());
    const r = await pageImagePng(mod, doc, 0, pt(98, 648), slice);
    const png = readPng(r?.png ?? new Uint8Array());
    expect([png.width, png.height, png.type]).toEqual([24, 24, 2]);
  });

  it('keeps a soft mask’s alpha at the image’s full resolution, not the size drawn', async () => {
    const doc = openDoc(imagesPdf());
    // Drawn 80 × 80 points; the image is 20 × 20 pixels.
    const r = await pageImagePng(mod, doc, 1, pt(240, 640), slice);
    expect(r).toMatchObject({ width: 20, height: 20 });
    const png = readPng(r?.png ?? new Uint8Array());
    expect([png.width, png.height, png.type]).toEqual([20, 20, 6]);
    // The mask's first pixel is 0 (transparent), its 50th is 150.
    expect(png.px(0, 0)[3]).toBe(0);
    expect(png.px(10, 2)[3]).toBe(150);
  });

  it('gives a turned image upright, and nothing where there is no image', async () => {
    const doc = openDoc(overlapPdf());
    const r = await pageImagePng(mod, doc, 0, { x: 380 - 36, y: 756 - 260 }, slice);
    const png = readPng(r?.png ?? new Uint8Array());
    expect([png.width, png.height]).toEqual([60, 30]);
    expect(png.px(5, 5)).toEqual([0, 160, 0]);
    expect(await pageImagePng(mod, doc, 0, { x: 5, y: 5 }, slice)).toBeNull();
  });

  it('leaves the image where it was drawn after rendering it', async () => {
    const doc = openDoc(imagesPdf());
    await pageImagePng(mod, doc, 1, pt(240, 640), slice);
    expect(hitOn(doc, 1, pt(240, 640))).toEqual({ width: 20, height: 20 });
  });
});
