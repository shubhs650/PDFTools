// M11-08·O8 (D-55): Images to PDF. The header reading and the placement are
// pure; the document is built by real PDFium here, as in the Work worker.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { RpcError } from '../../src/engine/errors';
import { looksLikeImage, readImageInfo } from '../../src/model/imageFile';
import {
  IMAGE_MARGIN,
  imagesBaseName,
  multiply,
  naturalSize,
  orientationMatrix,
  placeImage,
  type Matrix,
} from '../../src/model/imagePages';
import { PdfReader } from '../../src/model/pdf/reader';
import { docPtrOf, rawCall } from '../../src/workers/render/pdfium';
import { imagesToPdf } from '../../src/workers/work/imagesPdf';

const require = createRequire(import.meta.url);
const hasQpdf = spawnSync('qpdf', ['--version']).status === 0;
const DIR = join(import.meta.dirname, '../../e2e/fixtures/self-made/images');
const fixture = (name: string) => new Uint8Array(readFileSync(join(DIR, name)));
const buf = (b: Uint8Array) => b.slice().buffer;
let mod: WrappedPdfiumModule;
const noop = () => undefined;
const slice = { checkpoint: () => Promise.resolve(), signal: new AbortController().signal };

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
});

const apply = (m: Matrix, [x, y]: [number, number]): [number, number] => [
  Math.round((m[0] * x + m[2] * y + m[4]) * 1000) / 1000,
  Math.round((m[1] * x + m[3] * y + m[5]) * 1000) / 1000,
];

describe('image headers', () => {
  it('reads a JPEG: size, JFIF dpi, no orientation', () => {
    expect(readImageInfo(fixture('site-photo-1.jpg'))).toEqual({
      kind: 'jpeg',
      width: 640,
      height: 480,
      dpiX: 72,
      dpiY: 72,
      orientation: 1,
    });
  });

  it("reads a camera's EXIF orientation; an aspect-only JFIF states no dpi", () => {
    expect(readImageInfo(fixture('site-photo-2-exif6.jpg'))).toEqual({
      kind: 'jpeg',
      width: 480,
      height: 640,
      dpiX: null,
      dpiY: null,
      orientation: 6,
    });
  });

  it('reads a PNG: size and pHYs dpi', () => {
    const scan = readImageInfo(fixture('scan-100dpi.png'));
    expect(scan).toMatchObject({ kind: 'png', width: 425, height: 600, orientation: 1 });
    expect(scan?.dpiX).toBeCloseTo(100, 0);
    expect(readImageInfo(fixture('logo-alpha.png'))).toMatchObject({
      width: 200,
      height: 120,
      dpiX: null,
    });
  });

  it('reads little-endian EXIF and its resolution when there is no JFIF', () => {
    // SOI, APP1 Exif (II, IFD0: Orientation 8, XResolution 300/1, YResolution 300/1, unit inch), SOF0 30 × 20.
    const tiff = [
      0x49,
      0x49,
      42,
      0,
      8,
      0,
      0,
      0, // header, IFD0 at 8
      4,
      0, // 4 entries
      0x12,
      0x01,
      3,
      0,
      1,
      0,
      0,
      0,
      8,
      0,
      0,
      0, // Orientation = 8
      0x1a,
      0x01,
      5,
      0,
      1,
      0,
      0,
      0,
      62,
      0,
      0,
      0, // XResolution at 62
      0x1b,
      0x01,
      5,
      0,
      1,
      0,
      0,
      0,
      70,
      0,
      0,
      0, // YResolution at 70
      0x28,
      0x01,
      3,
      0,
      1,
      0,
      0,
      0,
      2,
      0,
      0,
      0, // ResolutionUnit = inch
      0,
      0,
      0,
      0, // next IFD
      44,
      1,
      0,
      0,
      1,
      0,
      0,
      0, // 300/1
      44,
      1,
      0,
      0,
      1,
      0,
      0,
      0, // 300/1
    ];
    const app1 = Array.from(new TextEncoder().encode('Exif\0\0')).concat(tiff);
    const len = app1.length + 2;
    const sof = [0xff, 0xc0, 0, 11, 8, 0, 20, 0, 30, 1, 1, 0x11, 0];
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...app1, ...sof]);
    expect(readImageInfo(bytes)).toEqual({
      kind: 'jpeg',
      width: 30,
      height: 20,
      dpiX: 300,
      dpiY: 300,
      orientation: 8,
    });
  });

  it('refuses other files and broken headers', () => {
    expect(readImageInfo(new TextEncoder().encode('%PDF-1.7\n'))).toBeNull();
    expect(readImageInfo(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBeNull(); // GIF
    expect(readImageInfo(fixture('site-photo-1.jpg').subarray(0, 100))).toBeNull(); // cut off
    expect(readImageInfo(fixture('logo-alpha.png').subarray(0, 20))).toBeNull();
  });

  it('routes pictures by type or file name; only JPG and PNG are read', () => {
    expect(looksLikeImage({ name: 'a.JPG', type: '' })).toBe(true);
    expect(looksLikeImage({ name: 'a.jpeg', type: '' })).toBe(true);
    expect(looksLikeImage({ name: 'scan', type: 'image/png' })).toBe(true);
    // Other pictures go the same way, to be named as left out.
    expect(looksLikeImage({ name: 'a.heic', type: '' })).toBe(true);
    expect(looksLikeImage({ name: 'a.gif', type: 'image/gif' })).toBe(true);
    expect(looksLikeImage({ name: 'a.pdf', type: 'application/pdf' })).toBe(false);
    expect(looksLikeImage({ name: 'notes.txt', type: 'text/plain' })).toBe(false);
  });
});

describe('image placement', () => {
  // The stored image's top-left corner is (0, 1) in image space.
  const TL: [number, number] = [0, 1];
  const TR: [number, number] = [1, 1];
  it.each([
    [1, [0, 1], [1, 1]],
    [2, [1, 1], [0, 1]],
    [3, [1, 0], [0, 0]],
    [4, [0, 0], [1, 0]],
    [5, [0, 1], [0, 0]],
    [6, [1, 1], [1, 0]],
    [7, [1, 0], [1, 1]],
    [8, [0, 0], [0, 1]],
  ] as const)('EXIF orientation %i puts the stored top row where the camera meant', (o, tl, tr) => {
    expect(apply(orientationMatrix(o), TL)).toEqual(tl);
    expect(apply(orientationMatrix(o), TR)).toEqual(tr);
  });

  it('multiplies as PDF composes matrices (first, then second)', () => {
    expect(multiply([1, 0, 0, 1, 5, 6], [2, 0, 0, 3, 1, 1])).toEqual([2, 0, 0, 3, 11, 19]);
  });

  const photo = { width: 4032, height: 3024, dpiX: 72, dpiY: 72, orientation: 1 };

  it('fit: the page is the image at its stated resolution, or 96 dpi', () => {
    const p = placeImage(photo, 'fit', true);
    expect(p).toEqual({ width: 4032, height: 3024, matrix: [4032, 0, 0, 3024, 0, 0] });
    expect(naturalSize({ ...photo, dpiX: null, dpiY: null })).toEqual({
      width: 3024,
      height: 2268,
    });
  });

  it('fit: a quarter-turned photo gives a portrait page', () => {
    const p = placeImage({ ...photo, orientation: 6 }, 'fit', false);
    expect(p.width).toBe(3024);
    expect(p.height).toBe(4032);
    // The stored top-left corner lands at the page's top-right.
    expect(apply(p.matrix, [0, 1])).toEqual([3024, 4032]);
  });

  it('fit stays inside PDF page limits', () => {
    const huge = placeImage({ ...photo, width: 40_000, height: 10_000 }, 'fit', false);
    expect(huge.width).toBe(14_400);
    expect(huge.height).toBe(3600);
    const tiny = placeImage({ ...photo, width: 10, height: 10 }, 'fit', false);
    expect(tiny).toEqual({ width: 36, height: 36, matrix: [10, 0, 0, 10, 13, 13] });
  });

  it('A4: a wide image gets a landscape page, scaled down inside the margin and centred', () => {
    const p = placeImage(photo, 'a4', true);
    expect(p.width).toBe(841.89);
    expect(p.height).toBe(595.28);
    const s = Math.min((841.89 - 2 * IMAGE_MARGIN) / 4032, (595.28 - 2 * IMAGE_MARGIN) / 3024);
    expect(p.matrix[0]).toBeCloseTo(4032 * s, 6);
    expect(p.matrix[3]).toBeCloseTo(3024 * s, 6);
    expect(p.matrix[4]).toBeCloseTo((841.89 - 4032 * s) / 2, 6);
    expect(p.matrix[5]).toBeCloseTo(IMAGE_MARGIN, 6);
  });

  it('Letter without a margin: the image fills the width; a small image is never enlarged', () => {
    const p = placeImage({ ...photo, orientation: 8 }, 'letter', false);
    expect([p.width, p.height]).toEqual([612, 792]);
    // 4032 × 3024 turned upright, scaled to the page's height: 594 × 792, centred.
    expect(p.matrix[2]).toBeCloseTo(-594, 6);
    expect(apply(p.matrix, [0, 1])).toEqual([9, 0]); // stored top-left → bottom-left
    const small = placeImage({ ...photo, width: 200, height: 100 }, 'letter', true);
    expect(small.matrix).toEqual([200, 0, 0, 100, (792 - 200) / 2, (612 - 100) / 2]);
  });

  it('names the new file after a single image', () => {
    expect(imagesBaseName(['IMG_0042.JPG'])).toBe('IMG_0042');
    expect(imagesBaseName(['a.png', 'b.png'])).toBeNull();
    expect(imagesBaseName(['.png'])).toBeNull();
  });
});

function qpdfOk(bytes: Uint8Array): boolean {
  if (!hasQpdf) return true;
  const f = join(mkdtempSync(join(tmpdir(), 'images-')), 'out.pdf');
  writeFileSync(f, bytes);
  return spawnSync('qpdf', ['--check', f]).status === 0;
}

async function pagesOf(bytes: Uint8Array) {
  const reader = await PdfReader.open(bytes);
  const out: { box: number[]; content: string }[] = [];
  for (const p of await reader.pages()) {
    const box = (await reader.resolve(p.dict.get('MediaBox'))) as number[];
    out.push({ box: box.map((v) => Math.round(v * 100) / 100), content: '' });
  }
  return out;
}

describe('imagesToPdf (real PDFium)', () => {
  const all = ['site-photo-1.jpg', 'site-photo-2-exif6.jpg', 'scan-100dpi.png', 'logo-alpha.png'];

  it('builds one page per image, valid for qpdf, with each page sized to fit', async () => {
    const steps: number[] = [];
    const bytes = await imagesToPdf(
      mod,
      { images: all.map((n) => buf(fixture(n))), size: 'fit', margin: true },
      slice,
      (p) => steps.push(p.done),
    );
    expect(steps).toEqual([1, 2, 3, 4]);
    expect(qpdfOk(bytes)).toBe(true);
    const pages = await pagesOf(bytes);
    expect(pages.map((p) => p.box)).toEqual([
      [0, 0, 640, 480],
      [0, 0, 480, 360], // 640 × 480 px at 96 dpi, turned upright
      [0, 0, 306, 432], // 425 × 600 px at 100 dpi
      [0, 0, 150, 90],
    ]);
    // The JPEG went in as it is (DCTDecode); the PNG with transparency has a soft mask.
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.match(/\/DCTDecode/g)?.length).toBe(2);
    expect(text).toContain('/SMask');
    // The first JPEG's bytes are in the file unchanged.
    const jpeg = new TextDecoder('latin1').decode(fixture('site-photo-1.jpg'));
    expect(text.includes(jpeg)).toBe(true);
  });

  it('renders the turned photo upright', async () => {
    const bytes = await imagesToPdf(
      mod,
      { images: [buf(fixture('site-photo-2-exif6.jpg'))], size: 'fit', margin: false },
      slice,
      noop,
    );
    // Render the page and compare its top right (sky) with its bottom (ground).
    const native = new PdfiumNative(mod, { fontFallback: null });
    const opened = await native
      .openDocumentBuffer({ id: 'turned', content: bytes.slice().buffer }, {})
      .toPromise();
    const page = rawCall(mod, 'FPDF_LoadPage', docPtrOf(native, 'turned'), 0);
    const [w, h] = [96, 72];
    const bmp = rawCall(mod, 'FPDFBitmap_Create', w, h, 0);
    rawCall(mod, 'FPDFBitmap_FillRect', bmp, 0, 0, w, h, 0xffffffff);
    rawCall(mod, 'FPDF_RenderPageBitmap', bmp, page, 0, 0, w, h, 0, 0);
    const heap = (mod.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8;
    const px = (x: number, y: number) => {
      const at =
        rawCall(mod, 'FPDFBitmap_GetBuffer', bmp) +
        y * rawCall(mod, 'FPDFBitmap_GetStride', bmp) +
        x * 4;
      return [heap[at + 2] ?? 0, heap[at + 1] ?? 0, heap[at] ?? 0]; // BGRA
    };
    const sky = px(90, 30); // right part of the sky, clear of the label
    const ground = px(90, 68);
    rawCall(mod, 'FPDFBitmap_Destroy', bmp);
    rawCall(mod, 'FPDF_ClosePage', page);
    await native.closeDocument(opened).toPromise();
    // Sky (240, 200, 160) above, grass (120, 150, 90) below: upright.
    expect(sky[0]).toBeGreaterThan(200);
    expect(ground[1]).toBeGreaterThan(ground[0] ?? 0);
    expect(sky[2]).toBeGreaterThan(ground[2] ?? 0);
  });

  it('A4 pages turn with each image', async () => {
    const bytes = await imagesToPdf(
      mod,
      {
        images: [buf(fixture('site-photo-1.jpg')), buf(fixture('scan-100dpi.png'))],
        size: 'a4',
        margin: true,
      },
      slice,
      noop,
    );
    expect((await pagesOf(bytes)).map((p) => p.box)).toEqual([
      [0, 0, 841.89, 595.28],
      [0, 0, 595.28, 841.89],
    ]);
  });

  it('two builds of the same images are different files (fresh /ID)', async () => {
    const spec = () => ({
      images: [buf(fixture('logo-alpha.png'))],
      size: 'fit' as const,
      margin: false,
    });
    const a = await imagesToPdf(mod, spec(), slice, noop);
    const b = await imagesToPdf(mod, spec(), slice, noop);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('refuses a file that is not a JPG or PNG, naming which one', async () => {
    const run = imagesToPdf(
      mod,
      {
        images: [buf(fixture('logo-alpha.png')), buf(new TextEncoder().encode('GIF89a....'))],
        size: 'fit',
        margin: false,
      },
      slice,
      noop,
    );
    await expect(run).rejects.toThrow(RpcError);
    await expect(run).rejects.toMatchObject({ code: 'images-unreadable:1' });
  });

  it('refuses an empty job and stops when cancelled', async () => {
    await expect(
      imagesToPdf(mod, { images: [], size: 'fit', margin: false }, slice, noop),
    ).rejects.toMatchObject({ code: 'images-count' });
    const big = { byteLength: 600 * 1024 * 1024 } as ArrayBuffer;
    await expect(
      imagesToPdf(mod, { images: [big], size: 'fit', margin: false }, slice, noop),
    ).rejects.toMatchObject({ code: 'images-bytes' });
    const cancelled = {
      checkpoint: () => Promise.reject(new RpcError('cancelled', 'cancelled')),
      signal: new AbortController().signal,
    };
    await expect(
      imagesToPdf(
        mod,
        { images: [buf(fixture('logo-alpha.png'))], size: 'fit', margin: false },
        cancelled,
        noop,
      ),
    ).rejects.toMatchObject({ code: 'cancelled' });
  });
});
