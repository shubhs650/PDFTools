import { describe, expect, it } from 'vitest';
import type { OcrLine, PageOcr } from '../../src/model/ocr/types';
import { PdfReader, inflateStream } from '../../src/model/pdf/reader';
import {
  buildTextLayer,
  FONT_KEY,
  lineOps,
  textStream,
  utf16Bytes,
} from '../../src/workers/work/ocrLayer';
import { parseTailObjects, narrowTail } from '../../src/workers/render/save/narrowTail';
import { saveBaseOf } from '../../src/workers/render/save/xref';
import { concatBytes } from '../../src/workers/render/save/bytes';
import { buildPdf, simplePdf } from '../../e2e/fixtures/generate.ts';

// The OCR text layer builder (ADR-020 d3, d4 as amended: GlyphLessFont), pure:
// geometry on a raster of a 72 dpi page (1 px = 1 pt) mapped with `flip`.

const PAGE_H = 842;
/** Raster (y down) → page space (y up) of an unrotated 595 × 842 page at 72 dpi. */
const flip = (_: number, dx: number, dy: number): [number, number] => [dx, PAGE_H - dy];
const page = (lines: OcrLine[]): PageOcr => ({ pageIndex: 0, width: 595, height: 842, lines });
const at = <T>(xs: readonly T[] | undefined, i: number): T => {
  const v = xs?.[i];
  if (v === undefined) throw new Error(`missing element ${String(i)}`);
  return v;
};
const op = (lines: OcrLine[]) => lineOps(at(lines, 0), page(lines), { toPage: flip });
const parse = (s: string) => {
  const m = /^(\S+) (\S+) (\S+) (\S+) (\S+) (\S+) Tm <([0-9a-f]*)> Tj$/.exec(s);
  if (!m) throw new Error(`not a word op: ${s}`);
  const n = (i: number) => Number(at(m, i));
  return { a: n(1), b: n(2), c: n(3), d: n(4), e: n(5), f: n(6), hex: at(m, 7) };
};
const ASCENT = 0.8;

describe('lineOps: one Tm … Tj per word', () => {
  it('a horizontal line: size from the ascent, text on the baseline, each word stretched to its box', () => {
    // Line box 100..300 × 100..124 (y down); baseline at y = 120; ascent 20 px → size 20/0.8.
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
    const size = 20 / ASCENT;
    expect(w1.hex).toBe('00410042'); // UTF-16BE "AB"
    // Natural width of two glyphs = 2 em; stretched to 60 pt.
    expect(w1.a).toBeCloseTo(60 / 2, 2);
    expect(w1.b).toBeCloseTo(0, 3);
    expect(w1.c).toBeCloseTo(0, 3);
    expect(w1.d).toBeCloseTo(size, 2);
    expect(w1.e).toBeCloseTo(100, 2);
    expect(w1.f).toBeCloseTo(PAGE_H - 120, 2); // the baseline, in page space
    const w2 = parse(at(ops, 1));
    expect(w2.a).toBeCloseTo(10 / 2, 2);
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
    // Direction on the page: raster +y is page −y. Length 60, natural 2 em.
    expect(w.a).toBeCloseTo(0, 3);
    expect(w.b).toBeCloseTo(-60 / 2, 2);
    // "Up": raster +x is page +x; size = ascent (124 − 104 = 20 px) / 0.8.
    expect(w.c).toBeCloseTo(20 / ASCENT, 2);
    expect(w.d).toBeCloseTo(0, 3);
    expect(w.e).toBeCloseTo(104, 2);
    expect(w.f).toBeCloseTo(PAGE_H - 100, 2);
  });

  it('without a baseline the line box bottom is used; any script is written; a non-BMP-only word is skipped', () => {
    const { ops, skipped } = op([
      {
        box: { x0: 0, y0: 0, x1: 100, y1: 20 },
        baseline: null,
        words: [
          { text: '\u{1F600}', box: { x0: 0, y0: 0, x1: 20, y1: 20 }, conf: 50 },
          { text: 'पंप', box: { x0: 30, y0: 0, x1: 60, y1: 20 }, conf: 50 },
          { text: '数据', box: { x0: 70, y0: 0, x1: 90, y1: 20 }, conf: 50 },
        ],
      },
    ]);
    expect(skipped).toBe(1);
    expect(ops).toHaveLength(2);
    const w = parse(at(ops, 0));
    expect(w.hex).toBe('092a0902092a');
    expect(w.f).toBeCloseTo(PAGE_H - 20, 2);
    expect(w.d).toBeCloseTo(20 / ASCENT, 2);
    expect(parse(at(ops, 1)).hex).toBe('6570636e');
    expect(Array.from(utf16Bytes('A\u{1F600}'))).toEqual([0, 0x41]);
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
  const parsed = new Map<number, string>();
  for (const o of r.objects) parsed.set(o.num, Buffer.from(o.bytes).toString('latin1'));
  return { r, parsed };
}

/** The document with the layer appended as the Render worker appends it. */
async function applied(pdf: Uint8Array, pages: PageOcr[]): Promise<Uint8Array> {
  const reader = await PdfReader.open(pdf, inflateStream);
  const r = await buildTextLayer(reader, pages, { toPage: flip });
  const tail = narrowTail(saveBaseOf(pdf), pdf, pdf.length, [], {
    extra: r.objects,
    onlyExtra: true,
  }).tail;
  return concatBytes([pdf, tail]);
}

describe('buildTextLayer: objects for the Render worker', () => {
  it('writes the font (six objects, once), q, the text stream and the page dict with /Contents [q … Q+text]', async () => {
    const { r, parsed } = await layerOf(simplePdf(1), [page([LINE])]);
    expect(r.pages).toEqual([0]);
    expect(r.words).toBe(1);
    expect(r.skipped).toBe(0);
    expect(r.replaced).toBe(0);
    // simplePdf: objects 1 catalog, 2 pages, 3 page, 4 contents, 5 font → new from 6:
    // 6 Type0, 7 CIDFontType2, 8 descriptor, 9 font program, 10 CIDToGIDMap, 11 ToUnicode, 12 q, 13 text.
    expect(r.firstNew).toBe(6);
    expect([...parsed.keys()].sort((a, b) => a - b)).toEqual([3, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(parsed.get(6)).toMatch(
      /\/Type \/Font \/Subtype \/Type0 \/BaseFont \/GlyphLessFont \/Encoding \/Identity-H \/DescendantFonts \[7 0 R\] \/ToUnicode 11 0 R/,
    );
    expect(parsed.get(7)).toMatch(/\/Subtype \/CIDFontType2 .*\/DW 1000 \/CIDToGIDMap 10 0 R/);
    expect(parsed.get(8)).toMatch(
      /\/FontDescriptor .*\/Ascent 800 \/Descent -200 .*\/FontFile2 9 0 R/,
    );
    expect(parsed.get(9)).toMatch(/\/Length1 572 \/Length 572/);
    expect(parsed.get(11)).toMatch(/<0000> <FFFF> <0000>/);
    expect(parsed.get(12)).toMatch(/stream\r\nq\n\r\nendstream/);
    expect(parsed.get(13)).toMatch(
      /stream\r\nQ\nBT\n3 Tr\n\/PDFToolsOCR 1 Tf\n[^\n]+ Tm <00480065006c006c006f> Tj\nET\n\r\nendstream/,
    );
    const pageDict = parsed.get(3) ?? '';
    expect(pageDict).toMatch(/\/Contents \[12 0 R 4 0 R 13 0 R\]/);
    expect(pageDict).toMatch(/\/Font <<\/F1 5 0 R \/PDFToolsOCR 6 0 R>>/);
  });

  it('a page with no usable word gets nothing; the font is written only when used', async () => {
    const { r } = await layerOf(simplePdf(2), [
      page([{ ...LINE, words: [{ text: '\u{1F600}', box: at(LINE.words, 0).box, conf: 50 }] }]),
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
    expect(pageDict).toMatch(/\/Contents \[15 0 R 4 0 R 16 0 R\]/);
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
    expect(parsed.get(3)).toMatch(/\/Contents \[12 0 R 4 0 R 5 0 R 13 0 R\]/);
  });

  it('re-recognizing replaces the layer this app wrote before (its q and Q+text streams), keeping the rest', async () => {
    const once = await applied(simplePdf(1), [page([LINE])]);
    const reader = await PdfReader.open(once, inflateStream);
    const r = await buildTextLayer(reader, [page([LINE])], { toPage: flip });
    expect(r.replaced).toBe(1);
    const pageDict = Buffer.from(
      at(
        r.objects.filter((o) => o.num === 3),
        0,
      ).bytes,
    ).toString('latin1');
    // Objects 6–13 were the first layer; the second allocates its font at 14–19, q at 20, text at 21, and drops 12 and 13.
    expect(pageDict).toMatch(/\/Contents \[20 0 R 4 0 R 21 0 R\]/);
    expect(pageDict).toMatch(/\/PDFToolsOCR 14 0 R/);
    // A foreign /Contents array of three streams is not mistaken for ours.
    const foreign = buildPdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents [4 0 R 5 0 R 6 0 R] >>',
      { dict: '<< >>', stream: 'q\n' },
      { dict: '<< >>', stream: '0 0 m 1 1 l S' },
      { dict: '<< >>', stream: 'Q' },
    ]);
    const { r: r2, parsed } = await layerOf(foreign, [page([LINE])]);
    expect(r2.replaced).toBe(0);
    expect(parsed.get(3)).toMatch(/\/Contents \[13 0 R 4 0 R 5 0 R 6 0 R 14 0 R\]/);
  });

  it('the objects parse as a tail', async () => {
    const { r } = await layerOf(simplePdf(1), [page([LINE])]);
    const tail = Buffer.concat(
      r.objects.map((o) => Buffer.concat([Buffer.from(o.bytes), Buffer.from('\n')])),
    );
    const objs = parseTailObjects(new Uint8Array(tail), 0);
    expect(objs.map((o) => o.num).sort((a, b) => a - b)).toEqual([3, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(FONT_KEY).toBe('PDFToolsOCR');
  });
});
