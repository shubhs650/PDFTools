// M6-09 (ADR-021 D-38 c): Flatten Comments as a Render-worker page operation
// on real PDFium — what is drawn, what is removed, the drawing order, a note
// without an appearance, links and redaction marks untouched; then Ctrl+S's
// semantic tail (verified like the save flow) and undo from the snapshot.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { PdfDocumentObject } from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { flattenSourcePdf } from '../../e2e/fixtures/comments';
import { planFlatten } from '../../src/features/annotate/flatten/flattenModel';
import { readAnnotString } from '../../src/workers/render/annotTiles';
import { applyPageOp } from '../../src/workers/render/pages';
import { docPtrOf, rawCall } from '../../src/workers/render/pdfium';
import { concatBytes } from '../../src/workers/render/save/bytes';
import { digestDocument } from '../../src/workers/render/save/digest';
import { SaveTracker } from '../../src/workers/render/save/tracker';
import { compareDigests } from '../../src/workers/work/verifySave';

const require = createRequire(import.meta.url);
let mod: WrappedPdfiumModule;
let native: PdfiumNative;
let tracker: SaveTracker;
let seq = 0;

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
  tracker = new SaveTracker(mod, native);
});

async function open(bytes: Uint8Array, track = true): Promise<PdfDocumentObject> {
  const id = `f${String(++seq)}`;
  const doc = await native
    .openDocumentBuffer({ id, content: bytes.slice().buffer }, {})
    .toPromise();
  if (track) {
    tracker.opened(id, bytes);
    await tracker.securityReady(id);
  }
  return doc;
}

const noop = { signal: new AbortController().signal, progress: () => undefined };

/** /NM of every annotation per page (pop-ups without one as "popup"). */
function names(docId: string): string[][] {
  const doc = docPtrOf(native, docId);
  const n = rawCall(mod, 'FPDF_GetPageCount', doc);
  return Array.from({ length: n }, (_, i) => {
    const page = rawCall(mod, 'FPDF_LoadPage', doc, i);
    const out: string[] = [];
    for (let k = 0; k < rawCall(mod, 'FPDFPage_GetAnnotCount', page); k++) {
      const a = rawCall(mod, 'FPDFPage_GetAnnot', page, k);
      out.push(
        readAnnotString(mod, a, 'NM') ||
          (rawCall(mod, 'FPDFAnnot_GetSubtype', a) === 16 ? 'popup' : '?'),
      );
      rawCall(mod, 'FPDFPage_CloseAnnot', a);
    }
    rawCall(mod, 'FPDF_ClosePage', page);
    return out;
  });
}

/** RGB of a page point (PDF user space), rendered without annotations: page content only. */
function pixel(docId: string, pageIndex: number, x: number, y: number): [number, number, number] {
  const doc = docPtrOf(native, docId);
  const page = rawCall(mod, 'FPDF_LoadPage', doc, pageIndex);
  const w = 595;
  const h = 842;
  const bmp = rawCall(mod, 'FPDFBitmap_Create', w, h, 0);
  rawCall(mod, 'FPDFBitmap_FillRect', bmp, 0, 0, w, h, 0xffffffff);
  rawCall(mod, 'FPDF_RenderPageBitmap', bmp, page, 0, 0, w, h, 0, 0);
  const buf = rawCall(mod, 'FPDFBitmap_GetBuffer', bmp);
  const stride = rawCall(mod, 'FPDFBitmap_GetStride', bmp);
  const heap = (mod.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8;
  const at = buf + (h - Math.round(y)) * stride + Math.round(x) * 4;
  const bgr: [number, number, number] = [heap[at + 2] ?? 0, heap[at + 1] ?? 0, heap[at] ?? 0];
  rawCall(mod, 'FPDFBitmap_Destroy', bmp);
  rawCall(mod, 'FPDF_ClosePage', page);
  return bgr;
}

const RED: [number, number, number] = [255, 0, 0];
const BLUE: [number, number, number] = [0, 0, 255];
const WHITE: [number, number, number] = [255, 255, 255];

/** The plan from EmbedPDF's own listing (what the viewer's annotation store holds). */
async function planOf(doc: PdfDocumentObject, keepReplies: boolean, pages: number[] | null = null) {
  const batch = await native.getAnnotationsBatch(doc, doc.pages).toPromise();
  const list = Object.values(batch).flat();
  return planFlatten(
    list.map((a) => ({ ...a, stateModel: (a as { stateModel?: string }).stateModel })),
    { scope: { kind: 'pages', pages }, keepReplies },
  );
}

describe('Flatten Comments in the Render worker', () => {
  it('draws the comments into the page in their order, removes their pop-up, reply and state; the rest stays', async () => {
    const doc = await open(flattenSourcePdf());
    expect(pixel(doc.id, 0, 120, 620)).toEqual(WHITE);
    const plan = await planOf(doc, false);
    expect(plan.comments).toBe(4); // red, blue, oval, note
    const r = await applyPageOp(mod, native, doc.id, { kind: 'flatten', pages: plan.pages }, noop);
    expect(r.flattened).toEqual({ flattened: 5, removed: 3, failed: 0 });
    expect(names(doc.id)).toEqual([['fl-link', 'fl-redact', 'fl-locked', 'fl-hidden'], [], []]);
    // Page content now: red, with the blue one above it where they overlap.
    expect(pixel(doc.id, 0, 120, 620)).toEqual(RED);
    expect(pixel(doc.id, 0, 220, 660)).toEqual(BLUE);
    // The redaction mark was not drawn (rule 8).
    expect(pixel(doc.id, 0, 425, 425)).toEqual(WHITE);
    // The note without an appearance got PDFium's and was drawn.
    expect(r.map).toEqual([0, 1, 2]);
  });

  it('keep replies: the reply stays as a note without /IRT; the state goes', async () => {
    const doc = await open(flattenSourcePdf());
    const plan = await planOf(doc, true, [0]);
    await applyPageOp(mod, native, doc.id, { kind: 'flatten', pages: plan.pages }, noop);
    expect(names(doc.id)[0]).toEqual([
      'fl-reply',
      'fl-link',
      'fl-redact',
      'fl-locked',
      'fl-hidden',
    ]);
    const page = rawCall(mod, 'FPDF_LoadPage', docPtrOf(native, doc.id), 0);
    const reply = rawCall(mod, 'FPDFPage_GetAnnot', page, 0);
    expect(rawCall(mod, 'FPDFAnnot_GetLinkedAnnot', reply, 'IRT')).toBe(0);
    rawCall(mod, 'FPDFPage_CloseAnnot', reply);
    rawCall(mod, 'FPDF_ClosePage', page);
  });

  it('a plan naming a link or a redaction mark leaves them; bad pages are refused', async () => {
    const doc = await open(flattenSourcePdf());
    const r = await applyPageOp(
      mod,
      native,
      doc.id,
      {
        kind: 'flatten',
        pages: [{ page: 0, flatten: ['fl-link', 'fl-redact'], remove: [], unlink: [] }],
      },
      noop,
    );
    expect(r.flattened).toEqual({ flattened: 0, removed: 0, failed: 0 });
    expect(names(doc.id)[0]).toContain('fl-link');
    expect(names(doc.id)[0]).toContain('fl-redact');
    await expect(
      applyPageOp(
        mod,
        native,
        doc.id,
        { kind: 'flatten', pages: [{ page: 9, flatten: [], remove: [], unlink: [] }] },
        noop,
      ),
    ).rejects.toMatchObject({ code: 'pages-range' });
    await expect(
      applyPageOp(mod, native, doc.id, { kind: 'flatten', pages: [] }, noop),
    ).rejects.toMatchObject({ code: 'pages-empty' });
  });

  it('Ctrl+S writes one verified revision that reopens flattened; undo restores the comments', async () => {
    const original = flattenSourcePdf();
    const doc = await open(original);
    const snap = await tracker.takeSnapshot(doc.id);
    const plan = await planOf(doc, false);
    await applyPageOp(mod, native, doc.id, { kind: 'flatten', pages: plan.pages }, noop);
    tracker.pageOperation(doc.id, (p) => p);

    const s = await tracker.save(doc.id);
    expect(s.tail.length).toBeGreaterThan(0);
    const saved = concatBytes([original, s.tail]);
    expect(
      (
        Buffer.from(saved.subarray(original.length))
          .toString('latin1')
          .match(/startxref/g) ?? []
      ).length,
    ).toBe(1);
    const back = await open(saved, false);
    if (!s.expected) throw new Error('no digest');
    expect(compareDigests(s.expected, digestDocument(mod, native, back.id, 'all')).ok).toBe(true);
    expect(names(back.id)).toEqual([['fl-link', 'fl-redact', 'fl-locked', 'fl-hidden'], [], []]);
    expect(pixel(back.id, 0, 120, 620)).toEqual(RED);
    expect(pixel(back.id, 1, 350, 302)).not.toEqual(WHITE);
    await native.closeDocument(back).toPromise();
    tracker.commit(doc.id, s.tail.length);

    // Undo: the document as it was, comments and all, page content untouched.
    await tracker.restore(doc.id, snap.token);
    expect(names(doc.id)[0]).toContain('fl-red');
    expect(names(doc.id)[1]).toEqual(['fl-oval']);
    expect(pixel(doc.id, 0, 120, 620)).toEqual(WHITE);
  });
});
