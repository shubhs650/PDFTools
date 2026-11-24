// M13-10 on real PDFium: a Distance with an offset. The file keeps the measured
// points in /L and the offset in /LL and /LLE; the appearance draws the
// dimension line beside the points with its arrows and the two leader lines,
// through Ctrl+S's tail; a reopened file reads the leader back.
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
import { boundsOf, dimensionGeometry, dimensionPoints } from '../../src/model/dimension';
import { applyDimensionAppearance } from '../../src/workers/render/dimensionAppearance';
import { installLeaderReadback } from '../../src/workers/render/leaderReadback';
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
  installLeaderReadback(mod, native);
  tracker = new SaveTracker(mod, native);
});

async function open(bytes: Uint8Array): Promise<PdfDocumentObject> {
  const id = `d${String(++seq)}`;
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

const A = { x: 100, y: 300 };
const B = { x: 300, y: 300 };
const LEADER = { ll: 60, lle: 3, llo: 0 };

/** A Distance from A to B, its dimension line 60 pt below (top-left page points). */
function distance(id: string, leader: typeof LEADER | null = LEADER) {
  const g = dimensionGeometry(A, B, leader, true);
  return {
    type: PdfAnnotationSubtype.LINE,
    id,
    pageIndex: 0,
    rect: boundsOf([A, B, ...dimensionPoints(g)], 10),
    flags: ['print'],
    color: 'transparent',
    opacity: 1,
    strokeWidth: 1,
    strokeColor: '#E44234',
    strokeStyle: PdfAnnotationBorderStyle.SOLID,
    intent: 'LineDimension',
    linePoints: { start: A, end: B },
    lineEndings: {
      start: PdfAnnotationLineEnding.OpenArrow,
      end: PdfAnnotationLineEnding.OpenArrow,
    },
    ...(leader ? { leader } : {}),
  };
}

async function create(doc: PdfDocumentObject, annot: Record<string, unknown>) {
  const page = doc.pages[0];
  if (!page) throw new Error('no page');
  const args: unknown[] = [doc, page, annot];
  await native.createPageAnnotation(doc, page, annot as never).toPromise();
  const outcome = applyDimensionAppearance(mod, native, 'createPageAnnotation', args);
  fixLineEndingAppearance(mod, native, 'createPageAnnotation', args);
  tracker.recordMutation('createPageAnnotation', args);
  return outcome;
}

describe('a Distance drawn as a dimension (M13-10)', () => {
  it('draws the dimension line beside the points, its arrows and the leader lines', async () => {
    const doc = await open(simplePdf(1));
    expect(await create(doc, distance('a'))).toBe('drawn');
    // The dimension line at y 360, not the measured line at y 300.
    expect(redIn(doc.id, 190, 358, 210, 362)).toBe(true);
    expect(redIn(doc.id, 190, 298, 210, 302)).toBe(false);
    // Leader lines from each point down past the dimension line.
    expect(redIn(doc.id, 99, 320, 101, 340)).toBe(true);
    expect(redIn(doc.id, 299, 320, 301, 340)).toBe(true);
    expect(redIn(doc.id, 99, 361, 101, 362.5)).toBe(true);
    // Open arrows at both ends of the dimension line (wings 4.5 pt off it, 7.8 pt in).
    expect(redIn(doc.id, 106, 354, 108, 357)).toBe(true);
    expect(redIn(doc.id, 292, 354, 294, 357)).toBe(true);
  });

  it('keeps /L on the measured points and writes /LL and /LLE; reads them back after Ctrl+S', async () => {
    const original = simplePdf(1);
    const doc = await open(original);
    await create(doc, distance('b'));
    const s = await tracker.save(doc.id);
    const saved = concatBytes([original, s.tail]);
    const text = Buffer.from(saved).toString('latin1');
    // User space: the page is 842 high, so y 300 from the top is 542.
    expect(text).toMatch(/\/L\s*\[\s*100\s+542\s+300\s+542\s*\]/u);
    // Positive /LL goes clockwise: down the page for a line drawn left to right.
    expect(text).toMatch(/\/LL\s+60\b/u);
    expect(text).toMatch(/\/LLE\s+3\b/u);
    expect(text).not.toMatch(/\de-\d/u);
    const back = await open(saved);
    expect(redIn(back.id, 99, 320, 101, 340)).toBe(true);
    const page = back.pages[0];
    if (!page) throw new Error('no page');
    const annots = (await native.getPageAnnotations(back, page).toPromise()) as {
      type: PdfAnnotationSubtype;
    }[];
    const line = annots.find((x) => x.type === PdfAnnotationSubtype.LINE) as
      { leader?: unknown; linePoints?: unknown } | undefined;
    expect(line?.leader).toEqual({ ll: 60, lle: 3, llo: 0 });
    expect(line?.linePoints).toEqual({ start: A, end: B });
  });

  it('a Distance without an offset is left to PDFium; other lines too', async () => {
    const doc = await open(simplePdf(1));
    expect(await create(doc, distance('c', null))).toBe('none');
    expect(redIn(doc.id, 190, 298, 210, 302)).toBe(true);
  });

  it('an edit that moves a point redraws the dimension; a move keeps it', async () => {
    const doc = await open(simplePdf(1));
    await create(doc, distance('e'));
    const page = doc.pages[0];
    if (!page) throw new Error('no page');
    const moved = { ...distance('e'), linePoints: { start: A, end: { x: 400, y: 300 } } };
    moved.rect = boundsOf(
      [
        A,
        { x: 400, y: 300 },
        ...dimensionPoints(dimensionGeometry(A, { x: 400, y: 300 }, LEADER, true)),
      ],
      10,
    );
    await native.updatePageAnnotation(doc, page, moved as never).toPromise();
    expect(applyDimensionAppearance(mod, native, 'updatePageAnnotation', [doc, page, moved])).toBe(
      'drawn',
    );
    expect(redIn(doc.id, 399, 320, 401, 340)).toBe(true);
    expect(
      applyDimensionAppearance(mod, native, 'updatePageAnnotation', [
        doc,
        page,
        moved,
        { regenerateAppearance: false },
      ]),
    ).toBe('none');
  });
});
