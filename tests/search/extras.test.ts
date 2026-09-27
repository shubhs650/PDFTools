import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { PdfActionType, type PdfDocumentObject } from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { BOOKMARK_WORD, COMMENT_WORD, annotatedPdf } from '../../e2e/fixtures/generate';
import { SearchEngine, targetPage } from '../../src/workers/work/search';
import type { JobSlice } from '../../src/workers/work/scheduler';

// M2-09: Advanced Search in comment text and bookmark titles (M2-Q3, read-only).

const require = createRequire(import.meta.url);
let mod: WrappedPdfiumModule;
let native: PdfiumNative;
let doc: PdfDocumentObject;

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
  doc = await native
    .openDocumentBuffer(
      { id: 'a', content: annotatedPdf().slice().buffer },
      { normalizeRotation: true },
    )
    .toPromise();
});

const slice = (): JobSlice => ({
  signal: new AbortController().signal,
  checkpoint: () => Promise.resolve(),
});
const engine = () =>
  new SearchEngine(
    () => mod,
    () => native,
  );
const req = (query: string, annotations: boolean, bookmarks: boolean) => ({
  docId: 'a',
  query,
  options: {},
  annotations,
  bookmarks,
});

describe('search extras', () => {
  it('finds comment text with the comment rectangle', async () => {
    const hits = await engine().extras(req(COMMENT_WORD.toLowerCase(), true, false), doc, slice());
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ source: 'annotation', page: 1, match: COMMENT_WORD });
    expect(hits[0]?.before).toContain('check the');
    expect(hits[0]?.rect?.width).toBeGreaterThan(0); // PDFium sizes a note to its icon
  });

  it('finds bookmark titles with their target page', async () => {
    const hits = await engine().extras(req(BOOKMARK_WORD, false, true), doc, slice());
    expect(hits).toEqual([
      expect.objectContaining({ source: 'bookmark', page: 2, match: BOOKMARK_WORD }),
    ]);
    // "Introduction" is a bookmark too, but only the query matches.
    expect(await engine().extras(req('introduction', false, true), doc, slice())).toHaveLength(1);
  });

  it('looks only where asked', async () => {
    expect(await engine().extras(req(COMMENT_WORD, false, true), doc, slice())).toEqual([]);
    expect(await engine().extras(req(BOOKMARK_WORD, true, false), doc, slice())).toEqual([]);
  });

  it('maps link targets to pages (other files and URIs go nowhere)', () => {
    const dest = { pageIndex: 4, zoom: { mode: 0 }, view: [] } as never;
    expect(targetPage(undefined)).toBe(-1);
    expect(targetPage({ type: 'destination', destination: dest })).toBe(4);
    expect(
      targetPage({ type: 'action', action: { type: PdfActionType.Goto, destination: dest } }),
    ).toBe(4);
    expect(targetPage({ type: 'action', action: { type: PdfActionType.URI, uri: 'x' } })).toBe(-1);
  });
});
