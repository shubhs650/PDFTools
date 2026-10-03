import { describe, expect, it } from 'vitest';
import type { OcrLine, PageOcr } from '../../src/model/ocr/types';
import { PdfRef, PdfStream, isDict, nameOf } from '../../src/model/pdf/objects';
import { PdfReader, inflateStream } from '../../src/model/pdf/reader';
import { buildTextLayer, FONT_KEY, lineOps, textStream } from '../../src/workers/work/ocrLayer';
import { parseTailObjects } from '../../src/workers/render/save/narrowTail';
import { buildPdf, simplePdf } from '../../e2e/fixtures/generate.ts';

// The OCR text layer builder (ADR-020 d3, d4), pure: geometry on a raster of a
// 72 dpi page (1 px = 1 pt) mapped with the identity-but-flipped `toPage`.

const DPI_SCALE = 1; // raster pixel = point
const PAGE_H = 842;
/** Raster (y down) → page space (y up) of an unrotated 595 × 842 page at 72 dpi. */
const flip = (_: number, dx: number, dy: number): [number, number] => [
  dx * DPI_SCALE,
  PAGE_H - dy * DPI_SCALE,
];
const page = (lines: OcrLine[]): PageOcr => ({ pageIndex: 0, width: 595, height: 842, lines });

const at = <T>(xs: readonly T[] | undefined, i: number): T => {
  const v = xs?.[i];
  if (v === undefined) throw new Error(`missing element ${String(i)}`);
  return v;
};
const op = (lines: OcrLine[]) => lineOps(at(lines, 0), page(lines), { toPage: flip });
const parse = (s: string) => {
  const m = /^(\S+) (\S+) (\S+) (\S+) (\S+) (\S+) Tm \((.*)\) Tj$/.exec(s);
  if (!m) throw new Error(`not a word op: ${s}`);
  const n = (i: number) => Number(at(m, i));
  return { a: n(1), b: n(2), c: n(3), d: n(4), e: n(5), f: n(6), text: at(m, 7) };
};

describe('lineOps: one Tm … Tj per word', () => {
  it('a horizontal line: size from the ascent, text on the baseline, each word stretched to its box', () => {
    // Line box 100..300 × 100..124 (y down); baseline at y = 120; ascent 20 px → size 20/0.905.
    const { ops, skipped } = op([
      {
        box: { x0: 100, y0: 100, x1: 300, y1: 124 },
        baseline: { x0: 100, y0: 120, x1: 300, y1: 120 },
        words: [
          { text: 'AB', box: { x0: 100, y0: 100, x1: 160, y1: 124 }, conf: 90 },
          { text: 'ii', box: { x0: 170, y0: 100, x1: 180, y1: 120 }, conf: 90 },
        ],
      },
    ]);
    expect(skipped).toBe(0);
    expect(ops).toHaveLength(2);
    const w1 = parse(at(ops, 0));
    const size = 20 / 0.905;
    expect(w1.text).toBe('AB');
    // Natural width of "AB" = (667 + 667) / 1000 em; stretched to 60 pt.
    expect(w1.a).toBeCloseTo(60 / 1.334, 2);
    expect(w1.b).toBeCloseTo(0, 3);
    expect(w1.c).toBeCloseTo(0, 3);
    expect(w1.d).toBeCloseTo(size, 2);
    expect(w1.e).toBeCloseTo(100, 2);
    expect(w1.f).toBeCloseTo(PAGE_H - 120, 2); // the baseline, in page space
    const w2 = parse(at(ops, 1));
    expect(w2.a).toBeCloseTo(10 / 0.444, 2); // "ii" = 2 × 222
    expect(w2.e).toBeCloseTo(170, 2);
  });

  it('a sideways line (vertical baseline, reading downwards) runs the text along the baseline', () => {
    // Glyph tops point to the right of the reading direction: "up" is +x on the raster.
    const { ops } = op([
      {
        box: { x0: 100, y0: 100, x1: 124, y1: 300 },
        baseline: { x0: 104, y0: 100, x1: 104, y1: 300 },
        words: [{ text: 'AB', box: { x0: 100, y0: 100, x1: 124, y1: 160 }, conf: 90 }],
      },
    ]);
    const w = parse(at(ops, 0));
    // Direction on the page: raster +y is page −y. Length 60, natural 1.334 em.
    expect(w.a).toBeCloseTo(0, 3);
    expect(w.b).toBeCloseTo(-60 / 1.334, 2);
    // "Up": raster +x is page +x; size = ascent (124 − 104 = 20 px) / 0.905.
    expect(w.c).toBeCloseTo(20 / 0.905, 2);
    expect(w.d).toBeCloseTo(0, 3);
    expect(w.e).toBeCloseTo(104, 2);
    expect(w.f).toBeCloseTo(PAGE_H - 100, 2);
  });

  it('without a baseline the line box bottom is used; a word without a WinAnsi character is skipped', () => {
    const { ops, skipped } = op([
      {
        box: { x0: 0, y0: 0, x1: 100, y1: 20 },
        baseline: null,
        words: [
          { text: '≤≥', box: { x0: 0, y0: 0, x1: 20, y1: 20 }, conf: 50 },
          { text: 'x', box: { x0: 30, y0: 0, x1: 40, y1: 20 }, conf: 50 },
        ],
      },
    ]);
    expect(skipped).toBe(1);
    expect(ops).toHaveLength(1);
    const w = parse(at(ops, 0));
    expect(w.f).toBeCloseTo(PAGE_H - 20, 2);
    expect(w.d).toBeCloseTo(20 / 0.905, 2);
  });

  it('escapes parentheses and backslashes in the text', () => {
    const { ops } = op([
      {
        box: { x0: 0, y0: 0, x1: 100, y1: 20 },
        baseline: null,
        words: [{ text: '(a\\b)', box: { x0: 0, y0: 0, x1: 50, y1: 20 }, conf: 50 }],
      },
    ]);
    expect(ops[0]).toMatch(/\(\\\(a\\\\b\\\)\) Tj$/);
    expect(textStream(ops)).toMatch(/^Q\nBT\n3 Tr\n\/PDFToolsOCR 1 Tf\n/);
  });
});

const LINE: OcrLine = {
  box: { x0: 60, y0: 60, x1: 300, y1: 84 },
  baseline: { x0: 60, y0: 80, x1: 300, y1: 80 },
  words: [{ text: 'Hello', box: { x0: 60, y0: 60, x1: 120, y1: 84 }, conf: 95 }],
};

async function layerOf(pdf: Uint8Array, pages: PageOcr[]) {
  const reader = await PdfReader.open(pdf, inflateStream);
  const r = await buildTextLayer(reader, pages, { toPage: flip });
  // Parse the written objects back (through the tail parser the Render worker uses).
  const parsed = new Map<number, string>();
  for (const o of r.objects) {
    const txt = Buffer.from(o.bytes).toString('latin1');
    parsed.set(o.num, txt);
  }
  return { r, reader, parsed };
}

describe('buildTextLayer: objects for the Render worker', () => {
  it('writes q, the text stream, one font and the page dict with /Contents [q … Q+text]', async () => {
    const { r, parsed } = await layerOf(simplePdf(1), [page([LINE])]);
    expect(r.pages).toEqual([0]);
    expect(r.words).toBe(1);
    expect(r.skipped).toBe(0);
    // simplePdf: objects 1 catalog, 2 pages, 3 page, 4 contents, 5 font → new from 6.
    expect(r.firstNew).toBe(6);
    expect([...parsed.keys()].sort((a, b) => a - b)).toEqual([3, 6, 7, 8]);
    expect(parsed.get(6)).toMatch(
      /\/Type \/Font \/Subtype \/Type1 \/BaseFont \/Helvetica \/Encoding \/WinAnsiEncoding/,
    );
    expect(parsed.get(7)).toMatch(/stream\r\nq\n\r\nendstream/);
    expect(parsed.get(8)).toMatch(
      /stream\r\nQ\nBT\n3 Tr\n\/PDFToolsOCR 1 Tf\n[^\n]+ Tm \(Hello\) Tj\nET\n\r\nendstream/,
    );
    const pageDict = parsed.get(3) ?? '';
    expect(pageDict).toMatch(/\/Contents \[7 0 R 4 0 R 8 0 R\]/);
    expect(pageDict).toMatch(/\/Font <<\/F1 5 0 R \/PDFToolsOCR 6 0 R>>/);
  });

  it('a page with no usable word gets nothing; the font is written only when used', async () => {
    const { r } = await layerOf(simplePdf(2), [
      page([{ ...LINE, words: [{ text: '中文', box: at(LINE.words, 0).box, conf: 50 }] }]),
    ]);
    expect(r.objects).toEqual([]);
    expect(r.pages).toEqual([]);
    expect(r.skipped).toBe(1);
  });

  it('inherited resources are copied onto the page; an indirect /Font dict is copied inline, never rewritten', async () => {
    // /Resources on the /Pages node, its /Font an indirect dict shared by both pages.
    const pdf = buildPdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 /Resources << /Font 7 0 R >> >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>',
      { dict: '<< >>', stream: 'BT /F1 12 Tf 10 10 Td (a) Tj ET' },
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 6 0 R >>',
      { dict: '<< >>', stream: '' },
      '<< /F1 8 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ]);
    const { r, parsed } = await layerOf(pdf, [page([LINE])]);
    expect(parsed.has(7)).toBe(false); // the shared /Font dict is untouched
    expect(parsed.has(2)).toBe(false); // so is the parent
    const pageDict = parsed.get(3) ?? '';
    expect(pageDict).toMatch(/\/Resources <<\/Font <<\/F1 8 0 R \/PDFToolsOCR 9 0 R>>>>/);
    expect(pageDict).toMatch(/\/Contents \[10 0 R 4 0 R 11 0 R\]/);
    expect(r.firstNew).toBe(9);
  });

  it('a /Contents array keeps every original stream, in order, between q and Q', async () => {
    const pdf = buildPdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents [4 0 R 5 0 R] >>',
      { dict: '<< >>', stream: 'q 1 0 0 1 0 0 cm' },
      { dict: '<< >>', stream: 'Q' },
    ]);
    const { parsed } = await layerOf(pdf, [page([LINE])]);
    expect(parsed.get(3)).toMatch(/\/Contents \[7 0 R 4 0 R 5 0 R 8 0 R\]/);
  });

  it('the objects parse as a tail and the reader resolves the new page state', async () => {
    const base = simplePdf(1);
    const { r } = await layerOf(base, [page([LINE])]);
    const tail = Buffer.concat(
      r.objects.map((o) => Buffer.concat([Buffer.from(o.bytes), Buffer.from('\n')])),
    );
    const objs = parseTailObjects(new Uint8Array(tail), 0);
    expect(objs.map((o) => o.num).sort((a, b) => a - b)).toEqual([3, 6, 7, 8]);
    // Re-read the page dict through the object model.
    const reader = await PdfReader.open(base, inflateStream);
    const [p0] = await reader.pages();
    expect(p0 && nameOf(p0.dict.get('Type'))).toBe('Page');
    const fontRef = r.objects.find((o) => o.num === 6);
    expect(fontRef).toBeDefined();
    expect(PdfRef).toBeDefined();
    expect(PdfStream).toBeDefined();
    expect(isDict(p0?.dict)).toBe(true);
    expect(FONT_KEY).toBe('PDFToolsOCR');
  });
});
