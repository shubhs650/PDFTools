// M13-04 on real PDFium: an arrow head at the end of an exactly level or upright
// line. PDFium writes its turn as "8.74228e-08" (no exponent in PDF numbers), cannot
// read it back and drew no head; after our fix the appearance has plain numbers and
// both heads draw, through Ctrl+S's narrow tail too.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import {
  PdfAnnotationBorderStyle,
  PdfAnnotationLineEnding,
  PdfAnnotationSubtype,
  type PdfDocumentObject,
} from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { simplePdf } from '../../e2e/fixtures/generate';
import { fixLineEndingAppearance } from '../../src/workers/render/lineEndingAppearance';
import { docPtrOf, rawCall } from '../../src/workers/render/pdfium';
import { concatBytes } from '../../src/workers/render/save/bytes';
import { SaveTracker } from '../../src/workers/render/save/tracker';

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

async function open(bytes: Uint8Array): Promise<PdfDocumentObject> {
  const id = `l${String(++seq)}`;
  const doc = await native
    .openDocumentBuffer({ id, content: bytes.slice().buffer }, {})
    .toPromise();
  tracker.opened(id, bytes);
  await tracker.securityReady(id);
  return doc;
}

/** Red ink anywhere in a box (page points from the top-left). */
function redIn(docId: string, x0: number, y0: number, x1: number, y1: number): boolean {
  const doc = docPtrOf(native, docId);
  const page = rawCall(mod, 'FPDF_LoadPage', doc, 0);
  const scale = 2;
  const w = 595 * scale;
  const h = 842 * scale;
  const bmp = rawCall(mod, 'FPDFBitmap_Create', w, h, 0);
  rawCall(mod, 'FPDFBitmap_FillRect', bmp, 0, 0, w, h, 0xffffffff);
  rawCall(mod, 'FPDF_RenderPageBitmap', bmp, page, 0, 0, w, h, 0, 1);
  const buf = rawCall(mod, 'FPDFBitmap_GetBuffer', bmp);
  const stride = rawCall(mod, 'FPDFBitmap_GetStride', bmp);
  const heap = (mod.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8;
  let red = false;
  for (let y = y0; y <= y1 && !red; y += 0.5)
    for (let x = x0; x <= x1 && !red; x += 0.5) {
      const at = buf + Math.round(y * scale) * stride + Math.round(x * scale) * 4;
      const [b, g, r] = [heap[at] ?? 0, heap[at + 1] ?? 0, heap[at + 2] ?? 0];
      if (r > 150 && g < 120 && b < 120) red = true;
    }
  rawCall(mod, 'FPDFBitmap_Destroy', bmp);
  rawCall(mod, 'FPDF_ClosePage', page);
  return red;
}

/** A line from (x1, y1) to (x2, y2), top-left page points, an open arrow at each end. */
const line = (id: string, x1: number, y1: number, x2: number, y2: number) => ({
  type: PdfAnnotationSubtype.LINE,
  id,
  pageIndex: 0,
  rect: {
    origin: { x: Math.min(x1, x2) - 10, y: Math.min(y1, y2) - 10 },
    size: { width: Math.abs(x2 - x1) + 20, height: Math.abs(y2 - y1) + 20 },
  },
  flags: ['print'],
  color: 'transparent',
  opacity: 1,
  strokeWidth: 1,
  strokeColor: '#E44234',
  strokeStyle: PdfAnnotationBorderStyle.SOLID,
  linePoints: { start: { x: x1, y: y1 }, end: { x: x2, y: y2 } },
  lineEndings: { start: PdfAnnotationLineEnding.OpenArrow, end: PdfAnnotationLineEnding.OpenArrow },
});

async function create(doc: PdfDocumentObject, annot: Record<string, unknown>) {
  const page = doc.pages[0];
  if (!page) throw new Error('no page');
  const args: unknown[] = [doc, page, annot];
  await native.createPageAnnotation(doc, page, annot as never).toPromise();
  const outcome = fixLineEndingAppearance(mod, native, 'createPageAnnotation', args);
  tracker.recordMutation('createPageAnnotation', args);
  return outcome;
}

describe('arrow heads on level and upright lines (M13-04)', () => {
  it('PDFium alone loses the start head of a level line', async () => {
    const doc = await open(simplePdf(1));
    const page = doc.pages[0];
    if (!page) throw new Error('no page');
    await native
      .createPageAnnotation(doc, page, line('a', 100, 300, 300, 300) as never)
      .toPromise();
    // The end head's wings sit 4.5 pt above and below the line, 7.8 pt before its end.
    expect(redIn(doc.id, 292, 294, 294, 297)).toBe(true);
    expect(redIn(doc.id, 106, 294, 108, 297)).toBe(false);
  });

  it('after the fix: both heads, level and upright, and kept through Ctrl+S', async () => {
    const original = simplePdf(1);
    const doc = await open(original);
    expect(await create(doc, line('a', 100, 300, 300, 300))).toBe('fixed');
    expect(await create(doc, line('b', 400, 200, 400, 400))).toBe('fixed');
    // Level: start and end wings.
    expect(redIn(doc.id, 106, 294, 108, 297)).toBe(true);
    expect(redIn(doc.id, 292, 294, 294, 297)).toBe(true);
    // Upright: wings beside the line near both ends.
    expect(redIn(doc.id, 394, 206, 397, 208)).toBe(true);
    expect(redIn(doc.id, 394, 392, 397, 394)).toBe(true);
    // A slanted line needs nothing.
    expect(await create(doc, line('c', 100, 500, 300, 560))).toBe('unchanged');

    const s = await tracker.save(doc.id);
    const saved = concatBytes([original, s.tail]);
    expect(Buffer.from(saved).toString('latin1')).not.toMatch(/\de-\d/u);
    const back = await open(saved);
    expect(redIn(back.id, 106, 294, 108, 297)).toBe(true);
    expect(redIn(back.id, 394, 206, 397, 208)).toBe(true);
  });

  it('lines without endings and other comments are left alone', async () => {
    const doc = await open(simplePdf(1));
    const plain = { ...line('p', 100, 300, 300, 300), lineEndings: undefined };
    expect(await create(doc, plain)).toBe('none');
  });
});
