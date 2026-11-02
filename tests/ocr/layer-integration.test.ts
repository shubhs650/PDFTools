import { describe, expect, it } from 'vitest';
import { LINES, TITLE, scannedFixture } from '../../e2e/fixtures/scanned.ts';
import { OCR_DPI, type PageOcr } from '../../src/model/ocr/types';
import { PdfReader, inflateStream } from '../../src/model/pdf/reader';
import { PdfRef, PdfStream } from '../../src/model/pdf/objects';
import { rawCall } from '../../src/workers/render/pdfium';
import { concatBytes } from '../../src/workers/render/save/bytes';
import { narrowTail } from '../../src/workers/render/save/narrowTail';
import { saveBaseOf } from '../../src/workers/render/save/xref';
import { buildTextLayer } from '../../src/workers/work/ocrLayer';
import { pageMapper, rasterForOcr, textChars } from '../../src/workers/work/ocrRaster';
import { nodePdfium } from '../../e2e/fixtures/scanned.ts';

// The Work worker's OCR pieces on real PDFium (the WASM the workers load) and
// the self-made scanned fixture (ADR-020 d3): the raster of a page as
// displayed, text-page detection, and the text layer applied as the Render
// worker does (narrowTail with the objects, reopen): FPDFText finds the words
// at the right places, the page's pixels do not change. Tesseract itself is
// not run here (the browser e2e covers it): the words are the fixture's,
// placed where the source page drew them.

const mod = await nodePdfium();
const heap = mod.pdfium as unknown as {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  HEAPU8: Uint8Array;
  getValue(ptr: number, t: 'double'): number;
};
const call = (name: string, ...a: (number | string)[]) => rawCall(mod, name, ...a);

function openDoc(bytes: Uint8Array): number {
  const p = heap.wasmExports.malloc(bytes.length);
  heap.HEAPU8.set(bytes, p);
  const doc = call('FPDF_LoadMemDocument', p, bytes.length, '');
  if (!doc) throw new Error('open failed');
  return doc;
}

function pageText(doc: number, index: number): string {
  const page = call('FPDF_LoadPage', doc, index);
  const tp = call('FPDFText_LoadPage', page);
  try {
    const n = call('FPDFText_CountChars', tp);
    if (n <= 0) return '';
    const buf = heap.wasmExports.malloc((n + 1) * 2);
    try {
      const written = call('FPDFText_GetText', tp, 0, n, buf);
      return String.fromCharCode(
        ...new Uint16Array(heap.HEAPU8.buffer, buf, Math.max(0, written - 1)),
      );
    } finally {
      heap.wasmExports.free(buf);
    }
  } finally {
    call('FPDFText_ClosePage', tp);
    call('FPDF_ClosePage', page);
  }
}

function renderBgra(doc: number, index: number, dpi: number): Uint8Array {
  const page = call('FPDF_LoadPage', doc, index);
  const width = Math.round((call('FPDF_GetPageWidthF', page) * dpi) / 72);
  const height = Math.round((call('FPDF_GetPageHeightF', page) * dpi) / 72);
  const bmp = call('FPDFBitmap_CreateEx', width, height, 4, 0, 0);
  try {
    call('FPDFBitmap_FillRect', bmp, 0, 0, width, height, 0xffffffff);
    call('FPDF_RenderPageBitmap', bmp, page, 0, 0, width, height, 0, 0);
    const buf = call('FPDFBitmap_GetBuffer', bmp);
    return heap.HEAPU8.slice(buf, buf + width * height * 4);
  } finally {
    call('FPDFBitmap_Destroy', bmp);
    call('FPDF_ClosePage', page);
  }
}

const at = <T>(xs: readonly T[] | undefined, i: number): T => {
  const v = xs?.[i];
  if (v === undefined) throw new Error(`missing element ${String(i)}`);
  return v;
};

/**
 * Text lines of a gray raster by row projection (bands of rows with ink,
 * closer than 6 px joined), each as one "word" spanning its ink: enough to
 * place the fixture's line texts where the page drew them. Upright text only.
 */
function linesFromRaster(width: number, height: number, data: Uint8Array): PageOcr['lines'] {
  const dark = (x: number, y: number) => (data[y * width + x] ?? 255) < 128;
  const bands: [number, number][] = [];
  let y = 0;
  while (y < height) {
    let any = false;
    for (let x = 0; x < width && !any; x += 2) any = dark(x, y);
    if (!any) {
      y++;
      continue;
    }
    const y0 = y;
    let gap = 0;
    let y1 = y;
    while (y < height && gap < 6) {
      let ink = false;
      for (let x = 0; x < width && !ink; x += 2) ink = dark(x, y);
      if (ink) {
        gap = 0;
        y1 = y + 1;
      } else gap++;
      y++;
    }
    bands.push([y0, y1]);
  }
  return bands.map(([y0, y1]) => {
    let x0 = width;
    let x1 = 0;
    for (let yy = y0; yy < y1; yy++)
      for (let x = 0; x < width; x++)
        if (dark(x, yy)) {
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x + 1);
        }
    const box = { x0, y0, x1, y1 };
    return {
      box,
      baseline: { x0, y0: y1 - 2, x1, y1: y1 - 2 },
      words: [{ text: '', box, conf: 90 }],
    };
  });
}

const fixture = await scannedFixture(150); // smaller than 300 dpi, enough for geometry

describe('OCR raster and text layer on real PDFium (ADR-020 d3)', () => {
  it('rasterForOcr renders scanned pages as displayed and reports pages with text', () => {
    const doc = openDoc(fixture);
    try {
      const p1 = rasterForOcr(mod, doc, 0, OCR_DPI);
      expect(p1.hasText).toBe(false);
      expect(Math.abs(p1.width - 2480)).toBeLessThanOrEqual(1);
      expect(p1.height).toBe(3508);
      expect(p1.data.length).toBe(p1.width * p1.height);
      // Ink somewhere near the title (top-left of an A4 page at 300 dpi).
      let ink = 0;
      for (let y = 250; y < 330; y++)
        for (let x = 250; x < 1200; x++) if ((p1.data[y * p1.width + x] ?? 255) < 128) ink++;
      expect(ink).toBeGreaterThan(500);
      const p3 = rasterForOcr(mod, doc, 2, OCR_DPI);
      expect(p3.width).toBe(3508); // the /Rotate 90 page is landscape as displayed
      expect(Math.abs(p3.height - 2480)).toBeLessThanOrEqual(1);
      const p4 = rasterForOcr(mod, doc, 3, OCR_DPI);
      expect(p4.hasText).toBe(true);
      expect(p4.data.length).toBe(0);
      const page4 = call('FPDF_LoadPage', doc, 3);
      expect(textChars(mod, page4)).toBeGreaterThan(0);
      call('FPDF_ClosePage', page4);
    } finally {
      call('FPDF_CloseDocument', doc);
    }
  });

  it('the layer applied as the Render worker applies it: words found where the ink is, pixels unchanged, originals kept', async () => {
    const doc = openDoc(fixture);
    const before = [0, 1].map((i) => renderBgra(doc, i, 72));
    // Line boxes from the raster itself (no Tesseract here), with the fixture's lines in reading order.
    const lineTexts = [TITLE, ...LINES];
    const pages: PageOcr[] = [];
    for (const pageIndex of [0, 1]) {
      const r = rasterForOcr(mod, doc, pageIndex, OCR_DPI);
      const lines = linesFromRaster(r.width, r.height, r.data);
      // Page 2 also has a vector line and a filled box: bands with no text get an empty word.
      expect(lines.length).toBeGreaterThanOrEqual(lineTexts.length);
      for (const [k, l] of lines.entries()) at(l.words, 0).text = lineTexts[k] ?? '';
      pages.push({ pageIndex, width: r.width, height: r.height, lines });
    }
    const reader = await PdfReader.open(fixture, inflateStream);
    const mappers = new Map<number, ReturnType<typeof pageMapper>>();
    const layer = await buildTextLayer(reader, pages, {
      toPage: (i, dx, dy) => {
        let m = mappers.get(i);
        if (!m) {
          const p = pages.find((x) => x.pageIndex === i);
          if (!p) throw new Error('page');
          mappers.set(i, (m = pageMapper(mod, doc, i, p.width, p.height)));
        }
        return m.toPage(dx, dy);
      },
    });
    for (const m of mappers.values()) m.release();
    call('FPDF_CloseDocument', doc);
    expect(layer.pages).toEqual([0, 1]);

    const tail = narrowTail(saveBaseOf(fixture), fixture, fixture.length, [], {
      extra: layer.objects,
      onlyExtra: true,
    }).tail;
    const saved = concatBytes([fixture, tail]);
    const re = openDoc(saved);
    try {
      for (const pageIndex of [0, 1]) {
        const text = pageText(re, pageIndex);
        for (const line of lineTexts) expect(text).toContain(line);
        expect(Buffer.compare(renderBgra(re, pageIndex, 72), at(before, pageIndex))).toBe(0);
      }
      expect(pageText(re, 2)).toBe('');
      expect(pageText(re, 3)).toContain('text layer');
    } finally {
      call('FPDF_CloseDocument', re);
    }
    // The original content streams are referenced unchanged.
    const r2 = await PdfReader.open(saved, inflateStream);
    const [p0, p1] = await r2.pages();
    const c1 = p1?.dict.get('Contents');
    expect(Array.isArray(c1) && c1.length === 4).toBe(true);
    const orig = await r2.get(6);
    expect(orig).toBeInstanceOf(PdfStream);
    expect(Buffer.from(await r2.decode(orig as PdfStream)).toString('latin1')).toMatch(
      /^q .* cm \/Im1 Do Q$/,
    );
    const c0 = p0?.dict.get('Contents');
    expect(Array.isArray(c0) && c0[1] instanceof PdfRef && c0[1].num === 4).toBe(true);
  });
});
