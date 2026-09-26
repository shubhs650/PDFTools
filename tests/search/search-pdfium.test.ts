import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { PdfDocumentObject } from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { NEEDLE, buildPdf, contractPdf } from '../../e2e/fixtures/generate';
import { AbortError, RpcError } from '../../src/engine/errors';
import type { JobSlice } from '../../src/workers/work/scheduler';
import { SearchEngine, type SearchBatch } from '../../src/workers/work/search';
import { compileQuery, findInPage } from '../../src/workers/work/searchCore';

// M2-05: the Work worker's search on real PDFium (the workers' WASM), with
// self-made fixtures (rule 13). Documents open like the Work copy does
// (normalizeRotation, so rectangles are in the viewer's page space).

const require = createRequire(import.meta.url);
let mod: WrappedPdfiumModule;
let native: PdfiumNative;
let engine: SearchEngine;
let seq = 0;

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
  engine = new SearchEngine(
    () => mod,
    () => native,
  );
});

async function open(bytes: Uint8Array): Promise<PdfDocumentObject> {
  return native
    .openDocumentBuffer(
      { id: `s${String(++seq)}`, content: bytes.slice().buffer },
      { normalizeRotation: true },
    )
    .toPromise();
}

/** A slice that never waits; `abortAfter` pages → AbortError, like a cancel. */
function slice(abortAfter = Number.POSITIVE_INFINITY): JobSlice & { pages: number } {
  const ac = new AbortController();
  const s = {
    pages: 0,
    signal: ac.signal,
    checkpoint: () => {
      if (s.pages++ >= abortAfter) return Promise.reject(new AbortError());
      return Promise.resolve();
    },
  };
  return s;
}

const run = async (doc: PdfDocumentObject, query: string, extra: object = {}) => {
  const batches: SearchBatch[] = [];
  const summary = await engine.search(
    { docId: doc.id, searchId: 7, query, options: {}, visible: [0], ...extra },
    doc,
    slice(),
    (b) => batches.push(b),
  );
  return { summary, batches };
};

describe('search on real PDFium (ADR-006)', () => {
  it('finds the needle, in viewport order, and streams it with context', async () => {
    const doc = await open(contractPdf(60)); // the needle is on page 7 (index 6)
    const { summary, batches } = await run(doc, NEEDLE, { visible: [40, 41] });
    const hits = batches.flatMap((b) => b.hits);
    expect(summary).toMatchObject({ searchId: 7, totalHits: 1, detailedHits: 1, pageCount: 60 });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ page: 6, match: NEEDLE });
    expect(hits[0]?.after).toMatch(/^ reference 6/);
    expect(batches.every((b) => b.searchId === 7)).toBe(true);
    expect(batches.at(-1)?.pagesDone).toBe(60);
    await native.closeDocument(doc).toPromise();
  });

  it('streams at most `detailLimit` hits with context; the count stays exact', async () => {
    const doc = await open(contractPdf(30));
    const { summary, batches } = await run(doc, 'the', { detailLimit: 100 });
    let exact = 0;
    for (let p = 0; p < 30; p++)
      exact += findInPage(engine.text(doc.id, doc, p), p, compileQuery('the')).length;
    const detailed = batches.flatMap((b) => b.hits);
    const counted = batches.flatMap((b) => b.counts).reduce((n, [, c]) => n + c, 0);
    expect(detailed).toHaveLength(100);
    expect(summary.detailedHits).toBe(100);
    expect(summary.totalHits).toBe(exact);
    expect(detailed.length + counted).toBe(exact);
    // Context for pages past the cap, on demand.
    const later = batches.flatMap((b) => b.counts).at(-1);
    if (!later) throw new Error('no counted page');
    const ctx = await engine.context(doc.id, doc, 'the', {}, [later[0]], slice());
    expect(ctx).toHaveLength(later[1] + (detailed.filter((h) => h.page === later[0]).length || 0));
    await native.closeDocument(doc).toPromise();
  });

  it('stops at a page boundary when cancelled', async () => {
    const doc = await open(contractPdf(20));
    const s = slice(3);
    const batches: SearchBatch[] = [];
    await expect(
      engine.search(
        { docId: doc.id, searchId: 1, query: 'contractor', options: {}, visible: [] },
        doc,
        s,
        (b) => batches.push(b),
      ),
    ).rejects.toBeInstanceOf(AbortError);
    expect(s.pages).toBe(4); // three pages searched, the fourth checkpoint threw
    await native.closeDocument(doc).toPromise();
  });

  it('a bad query rejects with a code, not a message (rule 10)', async () => {
    const doc = await open(contractPdf(1));
    const err = await engine
      .search(
        { docId: doc.id, searchId: 1, query: '(', options: { regex: true }, visible: [] },
        doc,
        slice(),
        () => undefined,
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).code).toBe('search-invalid-query');
    await native.closeDocument(doc).toPromise();
  });

  it('hit rectangles are in the viewer’s page space, also on a rotated page', async () => {
    const pdf = (rotate: number) =>
      buildPdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Rotate ${String(rotate)} /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
        { dict: '<< >>', stream: 'BT /F1 24 Tf 72 760 Td (Hello rotated) Tj ET' },
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      ]);
    for (const rotate of [0, 90]) {
      const doc = await open(pdf(rotate));
      const { batches } = await run(doc, 'rotated');
      const hit = batches.flatMap((b) => b.hits)[0];
      if (!hit) throw new Error('no hit');
      const [rects] = engine.rects(doc.id, doc, 0, [hit]);
      const page = doc.pages[0];
      if (!page) throw new Error('no page');
      const geo = await native.getPageGeometry(doc, page).toPromise();
      const run0 = geo.runs[0];
      if (!run0 || !rects?.[0]) throw new Error('no rect');
      // Same space as the text layer (selection) and the page the viewer draws.
      expect(rects).toHaveLength(1);
      expect(Math.abs(rects[0].y - run0.rect.y)).toBeLessThan(6);
      expect(rects[0].x).toBeGreaterThan(run0.rect.x); // "rotated" starts after "Hello "
      expect(rects[0].x + rects[0].width).toBeLessThanOrEqual(run0.rect.x + run0.rect.width + 2);
      await native.closeDocument(doc).toPromise();
    }
  });

  it('maps hits after a non-BMP character to the right PDFium chars', async () => {
    // "BAB" in Helvetica, where /ToUnicode maps A to U+1D400 (a surrogate pair in UTF-16).
    const cmap = [
      '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
      '/CMapName /T def 1 begincodespacerange <00> <FF> endcodespacerange',
      '3 beginbfchar <41> <D835DC00> <42> <0042> <20> <0020> endbfchar',
      'endcmap CMapName currentdict /CMap defineresource pop end end',
    ].join('\n');
    const doc = await open(
      buildPdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
        { dict: '<< >>', stream: 'BT /F1 48 Tf 72 700 Td (BAB) Tj ET' },
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode 6 0 R >>',
        { dict: '<< >>', stream: cmap },
      ]),
    );
    expect(engine.text(doc.id, doc, 0)).toBe('B\u{1D400}B');
    const { batches } = await run(doc, 'B', { options: { matchCase: true } });
    const hits = batches.flatMap((b) => b.hits);
    expect(hits.map((h) => h.start)).toEqual([0, 3]); // UTF-16 indices
    const [first, second] = engine.rects(doc.id, doc, 0, hits);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    // The second B is the third glyph: well right of the first.
    expect((second?.[0]?.x ?? 0) - (first?.[0]?.x ?? 0)).toBeGreaterThan(40);
    await native.closeDocument(doc).toPromise();
  });
});
