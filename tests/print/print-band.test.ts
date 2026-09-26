// M2-15: banded print renders with the Print flag, markups on / off / only,
// regions and rotation (real PDFium, as in the Work worker).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { printPdf } from '../../e2e/fixtures/generate';
import { docPtrOf } from '../../src/workers/render/pdfium';
import { markupsOnly, pageBox, renderBand, type Band } from '../../src/workers/work/print';

const require = createRequire(import.meta.url);
let mod: WrappedPdfiumModule;
let ptr: number;

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  const native = new PdfiumNative(mod, { fontFallback: null });
  const doc = await native
    .openDocumentBuffer({ id: 'p', content: printPdf().slice().buffer })
    .toPromise();
  ptr = docPtrOf(native, doc.id);
});

/** RGBA at a point (in points from the page's top left) of a whole-page band at 1 px/pt. */
const at = (b: Band, x: number, y: number): number[] => {
  const i = (y * b.width + x) * 4;
  return [...b.data.subarray(i, i + 4)];
};
const RED = [255, 0, 0, 255];
const BLUE = [0, 0, 255, 255];
const BLACK = [0, 0, 0, 255];
const WHITE = [255, 255, 255, 255];

const band = (markups: 'on' | 'off' | 'only', top = 0, rows = 842) =>
  renderBand(mod, ptr, { pageIndex: 0, scale: 1, region: null, top, rows, markups });

describe('renderBand', () => {
  it('markups on: page content and printable annotations; screen-only ones dropped', () => {
    const b = band('on');
    expect([b.width, b.height]).toEqual([595, 842]);
    expect(at(b, 100, 90)).toEqual(RED);
    expect(at(b, 100, 220)).toEqual(BLACK);
    expect(at(b, 450, 740)).not.toEqual(BLUE);
    expect(at(b, 450, 740)).toEqual(WHITE);
  });

  it('markups off: page content only', () => {
    const b = band('off');
    expect(at(b, 100, 90)).toEqual(WHITE);
    expect(at(b, 100, 220)).toEqual(BLACK);
  });

  it('markups only: annotations on white', () => {
    const b = band('only');
    expect(at(b, 100, 90)).toEqual(RED);
    expect(at(b, 100, 220)).toEqual(WHITE);
  });

  it('a band is the same pixels as that slice of the whole page', () => {
    const whole = band('on');
    const part = band('on', 80, 20);
    expect([part.width, part.height]).toEqual([595, 20]);
    expect(at(part, 100, 10)).toEqual(at(whole, 100, 90));
    expect(at(part, 100, 19)).toEqual(at(whole, 100, 99));
  });

  it('a region prints just that part of the page', () => {
    const b = renderBand(mod, ptr, {
      pageIndex: 0,
      scale: 2,
      region: { x: 40, y: 30, width: 30, height: 20 },
      top: 0,
      rows: 40,
      markups: 'on',
    });
    expect([b.width, b.height]).toEqual([60, 40]);
    expect(at(b, 5, 5)).toEqual(WHITE); // x 42.5, y 32.5: left of the square
    expect(at(b, 40, 30)).toEqual(RED); // x 60, y 45
  });
});

describe('pageBox', () => {
  it('gives displayed sizes: landscape pages and /Rotate 90', () => {
    expect(pageBox(mod, ptr, 0)).toEqual({ width: 595, height: 842, rotation: 0 });
    expect(pageBox(mod, ptr, 1)).toEqual({ width: 842, height: 595, rotation: 0 });
    expect(pageBox(mod, ptr, 2)).toEqual({ width: 842, height: 595, rotation: 1 });
  });
});

describe('markupsOnly', () => {
  it('whitens unchanged pixels, keeps changed ones, forces opaque', () => {
    const on = new Uint8ClampedArray([10, 10, 10, 0, 200, 0, 0, 255]);
    const off = new Uint8ClampedArray([12, 9, 10, 255, 255, 255, 255, 255]);
    expect([...markupsOnly(on, off)]).toEqual([255, 255, 255, 255, 200, 0, 0, 255]);
  });
});
