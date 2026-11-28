// M14-05 on real PDFium (D-73, ADR-035 Amendment 1): an Angle, a Radius and
// a Diameter are each one Stamp whose appearance is entirely ours (the arms
// and arc, or the circle or arc and its line, and the value in the app's own
// font), through Ctrl+S's tail and back; a move keeps the appearance; the
// Triya data holds the points and reads back, moved with a moved Stamp.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { PdfAnnotationSubtype, type PdfDocumentObject } from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { unzlibSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import { simplePdf } from '../../e2e/fixtures/generate';
import { libraryFamily } from '../../src/model/fonts/library';
import { BLANK_STAMP_PDF, curveDrawing } from '../../src/model/measureCurve';
import {
  curvePointsNow,
  entryFromPdf,
  entryToPdf,
  pageData,
  readItems,
} from '../../src/model/measureData';
import { bounds } from '../../src/model/measureGeometry';
import {
  captionBoundsEP,
  estimateWidth,
  mirror,
  type MeasureMeta,
} from '../../src/model/measureMarkup';
import { valueText } from '../../src/model/measurement';
import { PdfReader } from '../../src/model/pdf/reader';
import { fromJson, toJson } from '../../src/model/pdf/wire';
import { FaceStore } from '../../src/workers/render/commentFonts/faces';
import { layout } from '../../src/workers/render/commentFonts/layout';
import {
  applyMeasureAppearance,
  measureCallOf,
  prepareMeasureCaption,
} from '../../src/workers/render/measureAppearance';
import { docPtrOf, rawCall } from '../../src/workers/render/pdfium';
import { concatBytes } from '../../src/workers/render/save/bytes';
import { SaveTracker } from '../../src/workers/render/save/tracker';

const require = createRequire(import.meta.url);
const VENDOR = fileURLToPath(new URL('../../vendor/fonts/files/', import.meta.url));
let mod: WrappedPdfiumModule;
let native: PdfiumNative;
let tracker: SaveTracker;
let faces: FaceStore;
let seq = 0;
const RED = '#E44234';

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
  tracker = new SaveTracker(mod, native);
  faces = new FaceStore({
    harfbuzz: () => import('harfbuzzjs'),
    subsetWasm: () =>
      Promise.resolve(readFileSync(require.resolve('harfbuzzjs/dist/harfbuzz-subset.wasm'))),
    fontFile: (file) => Promise.resolve(new Uint8Array(readFileSync(join(VENDOR, file)))),
  });
});

async function open(bytes: Uint8Array): Promise<PdfDocumentObject> {
  const id = `c${String(++seq)}`;
  const doc = await native
    .openDocumentBuffer({ id, content: bytes.slice().buffer }, {})
    .toPromise();
  tracker.opened(id, bytes);
  await tracker.securityReady(id);
  return doc;
}

/** Ink matching `test` anywhere in a box (page points from the top-left of an A4 page). */
function inkIn(
  docId: string,
  box: [number, number, number, number],
  test: (r: number, g: number, b: number) => boolean,
): boolean {
  const [x0, y0, x1, y1] = box;
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
  let found = false;
  for (let y = y0; y <= y1 && !found; y += 0.5)
    for (let x = x0; x <= x1 && !found; x += 0.5) {
      const at = buf + Math.round(y * scale) * stride + Math.round(x * scale) * 4;
      if (test(heap[at + 2] ?? 0, heap[at + 1] ?? 0, heap[at] ?? 0)) found = true;
    }
  rawCall(mod, 'FPDFBitmap_Destroy', bmp);
  rawCall(mod, 'FPDF_ClosePage', page);
  return found;
}
const red = (r: number, g: number, b: number): boolean => r > 150 && g < 120 && b < 120;

const fmt = {
  number: (v: number, d = 2) => v.toFixed(d),
  fixed: (v: number, d: number) => v.toFixed(d),
};

/** A curve as the main thread commits it: its rect from its drawing and estimated caption. */
function curve(id: string, meta: MeasureMeta, text: string) {
  const pts = meta.pts ?? [];
  const tool = meta.tool as 'angle' | 'radius' | 'diameter';
  const d = curveDrawing(tool, pts.map(mirror), meta.shape ? { shape: meta.shape } : {});
  const ext = (d?.extent ?? []).map(mirror);
  let [x0, y0, x1, y1] = bounds(ext, 1.5);
  const cap = captionBoundsEP(meta, pts, null, text);
  if (cap) {
    x0 = Math.min(x0, cap[0]);
    y0 = Math.min(y0, cap[1]);
    x1 = Math.max(x1, cap[2]);
    y1 = Math.max(y1, cap[3]);
  }
  return {
    type: PdfAnnotationSubtype.STAMP,
    id,
    pageIndex: 0,
    flags: ['print'],
    opacity: 1,
    strokeWidth: 1,
    strokeColor: RED,
    rect: { origin: { x: x0, y: y0 }, size: { width: x1 - x0, height: y1 - y0 } },
    contents: text,
    subject: tool,
    measure: meta,
  };
}

async function create(doc: PdfDocumentObject, annot: Record<string, unknown>) {
  const page = doc.pages[0];
  if (!page) throw new Error('no page');
  const args: unknown[] = [doc, page, annot];
  const f = await prepareMeasureCaption(faces, 'createPageAnnotation', args);
  await native
    .createPageAnnotation(
      doc,
      page,
      annot as never,
      {
        data: BLANK_STAMP_PDF.slice().buffer,
        mimeType: 'application/pdf',
      } as never,
    )
    .toPromise();
  const outcome = applyMeasureAppearance(mod, native, 'createPageAnnotation', args, f);
  tracker.recordMutation('createPageAnnotation', args);
  return outcome;
}

describe('Angle, Radius and Diameter are one Stamp with their own appearance (M14-05)', () => {
  it('an Angle: arms, arc and "∠ 90.0°" drawn; saved as a Stamp with no /IT', async () => {
    const original = simplePdf(1);
    const doc = await open(original);
    const pts = [
      { x: 300, y: 300 },
      { x: 200, y: 300 },
      { x: 200, y: 200 },
    ];
    const text = `∠ ${valueText('angle', pts.map(mirror), null, fmt).value}°`;
    expect(text).toBe('∠ 90.0°');
    expect(await create(doc, curve('a1', { tool: 'angle', pts }, text))).toBe('drawn');
    // The arms (along y 300 and x 200), the arc 28 pt from the corner, the value beyond it.
    expect(inkIn(doc.id, [250, 299, 260, 301], red)).toBe(true);
    expect(inkIn(doc.id, [199, 240, 201, 250], red)).toBe(true);
    expect(inkIn(doc.id, [215, 275, 225, 285], red)).toBe(true);
    expect(inkIn(doc.id, [220, 252, 250, 270], red)).toBe(true);
    const s = await tracker.save(doc.id);
    const saved = Buffer.from(concatBytes([original, s.tail])).toString('latin1');
    expect(saved).toMatch(/\/Subtype\s*\/Stamp/u);
    expect(saved).not.toMatch(/\/IT\s*\//u);
    expect(saved).toMatch(/\/FontFile2/u);
  });

  it('a Radius by three points: the arc, its line and the value; a Diameter: the circle', async () => {
    const doc = await open(simplePdf(1));
    // An arc about (300, 400) of radius 80, from 0° through 45° to 90° (page y down).
    const c = { x: 300, y: 400 };
    const at = (deg: number) => ({
      x: c.x + 80 * Math.cos((deg * Math.PI) / 180),
      y: c.y - 80 * Math.sin((deg * Math.PI) / 180),
    });
    const pts = [at(0), at(45), at(90)];
    expect(await create(doc, curve('r1', { tool: 'radius', pts }, 'R 80.0 mm'))).toBe('drawn');
    // On the arc at 30°, nothing at 200° (an arc, not a circle); the line from the centre.
    const p30 = at(30);
    const p200 = at(200);
    expect(inkIn(doc.id, [p30.x - 1.5, p30.y - 1.5, p30.x + 1.5, p30.y + 1.5], red)).toBe(true);
    expect(inkIn(doc.id, [p200.x - 1.5, p200.y - 1.5, p200.x + 1.5, p200.y + 1.5], red)).toBe(
      false,
    );
    const mid = at(45);
    expect(
      inkIn(
        doc.id,
        [
          (c.x + mid.x) / 2 - 1,
          (c.y + mid.y) / 2 - 1,
          (c.x + mid.x) / 2 + 1,
          (c.y + mid.y) / 2 + 1,
        ],
        red,
      ),
    ).toBe(true);
    const d = await open(simplePdf(1));
    expect(await create(d, curve('d1', { tool: 'diameter', pts }, 'Ø 160.0 mm'))).toBe('drawn');
    expect(inkIn(d.id, [p200.x - 1.5, p200.y - 1.5, p200.x + 1.5, p200.y + 1.5], red)).toBe(true);
  });

  it('a move (no new appearance) keeps the drawing, shifted with the Stamp', async () => {
    const doc = await open(simplePdf(1));
    const pts = [
      { x: 300, y: 300 },
      { x: 200, y: 300 },
      { x: 200, y: 200 },
    ];
    const a = curve('a2', { tool: 'angle', pts }, '∠ 90.0°');
    await create(doc, a);
    const page = doc.pages[0];
    if (!page) throw new Error('no page');
    const moved = {
      ...a,
      rect: { ...a.rect, origin: { x: a.rect.origin.x + 100, y: a.rect.origin.y + 100 } },
    };
    const args = [doc, page, moved, { regenerateAppearance: false }];
    expect(measureCallOf('updatePageAnnotation', args)).toBeNull();
    await native
      .updatePageAnnotation(doc, page, moved as never, { regenerateAppearance: false })
      .toPromise();
    expect(inkIn(doc.id, [350, 399, 360, 401], red)).toBe(true);
    expect(inkIn(doc.id, [250, 299, 260, 301], red)).toBe(false);
  });

  it('a Stamp that is not a curve with its points is left alone', () => {
    const plain = { type: PdfAnnotationSubtype.STAMP, id: 'x', measure: { tool: 'angle' } };
    expect(measureCallOf('createPageAnnotation', [{ id: 'd' }, { index: 0 }, plain])).toBeNull();
    const other = { ...plain, measure: { tool: 'length' } };
    expect(measureCallOf('createPageAnnotation', [{ id: 'd' }, { index: 0 }, other])).toBeNull();
  });

  it('the estimated caption width holds the shaped "∠", "R" and "Ø" captions', async () => {
    const inter = libraryFamily('inter');
    if (!inter) throw new Error('no Inter');
    const samples = ['∠ 142.5°', '∠ 37.5°', 'R 1,200 mm', 'Ø 3,000 mm', 'Bend B: R 1,200 mm'];
    const f = await faces.prepare(inter, false, false, samples.join(''));
    for (const s of samples) {
      const [line] = layout(s, f.primary, f.fallbacks, 10, 100_000);
      expect(estimateWidth(s), s).toBeGreaterThanOrEqual(line?.width ?? 0);
    }
  });
});

describe('a curve’s Triya data (M14-05)', () => {
  it('holds its points, rect, style and scale; survives Ctrl+S and reads back', async () => {
    const original = simplePdf(1);
    const doc = await open(original);
    const entry = entryToPdf({
      meta: { tool: 'radius', label: 'Bend B', shape: 'circle' },
      fp: 'f00d',
      curve: {
        pts: [
          { x: 100.12345, y: 200 },
          { x: 150, y: 250 },
          { x: 100, y: 300 },
        ],
        rect: [40, 190, 160, 310],
        color: '#112233',
        width: 2,
        scale: { paper: 1, real: 50, unit: 'mm' },
      },
    });
    const { set } = pageData(null, new Map([['r9', entry]]), 'D:20261128120000Z');
    tracker.stagePatch(
      doc.id,
      { page: 0 },
      new Map(Object.entries(set).map(([k, v]) => [k, fromJson(v)])),
    );
    const s = await tracker.save(doc.id);
    const r = await PdfReader.open(concatBytes([original, s.tail]), (b) =>
      Promise.resolve(unzlibSync(b)),
    );
    const [p] = await r.pages();
    const pi = p?.dict.get('PieceInfo');
    const back = entryFromPdf(
      readItems(pi === undefined ? null : toJson((await r.resolve(pi)) ?? null)).get('r9'),
    );
    expect(back?.meta).toEqual({ tool: 'radius', label: 'Bend B', shape: 'circle' });
    expect(back?.curve?.pts[0]?.x).toBeCloseTo(100.123, 3);
    expect(back?.curve?.rect).toEqual([40, 190, 160, 310]);
    expect(back?.curve?.color).toBe('#112233');
    expect(back?.curve?.width).toBe(2);
  });

  it('moved elsewhere (same size) its points move with it; resized, they are dropped', () => {
    const saved = {
      pts: [
        { x: 10, y: 10 },
        { x: 20, y: 10 },
      ],
      rect: [0, 0, 30, 20] as [number, number, number, number],
    };
    expect(curvePointsNow(saved, [0, 0, 30, 20])).toEqual(saved.pts);
    expect(curvePointsNow(saved, [100, 50, 130, 70])).toEqual([
      { x: 110, y: 60 },
      { x: 120, y: 60 },
    ]);
    expect(curvePointsNow(saved, [0, 0, 60, 40])).toBeNull();
    expect(curvePointsNow(undefined, [0, 0, 30, 20])).toBeNull();
  });

  it('an entry with no usable points reads back as its tool only', () => {
    const e = entryFromPdf({ dict: { T: { name: 'Angle' }, P: [1, 2, 3], F: { text: 'x' } } });
    expect(e?.meta.tool).toBe('angle');
    expect(e?.curve).toBeUndefined();
  });
});
