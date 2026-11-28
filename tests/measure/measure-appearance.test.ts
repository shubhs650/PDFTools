// M14-03 on real PDFium (D-74, ADR-035 Amendment 1): Length, Polylength,
// Perimeter and Area are each one markup with the value drawn in its own
// appearance, in the app's own font, through Ctrl+S's tail and back; an
// Area's fill is in the appearance only (no /IC); the page's /PieceInfo holds
// the Triya data and reads back.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { entryFromPdf, pageData, readItems } from '../../src/model/measureData';
import type { MeasureMeta } from '../../src/model/measureMarkup';
import { estimateWidth } from '../../src/model/measureMarkup';
import { fromJson, toJson } from '../../src/model/pdf/wire';
import { PdfStream } from '../../src/model/pdf/objects';
import { PdfReader } from '../../src/model/pdf/reader';
import { FaceStore } from '../../src/workers/render/commentFonts/faces';
import { layout } from '../../src/workers/render/commentFonts/layout';
import { libraryFamily } from '../../src/model/fonts/library';
import { installLeaderReadback } from '../../src/workers/render/leaderReadback';
import {
  applyMeasureAppearance,
  prepareMeasureCaption,
} from '../../src/workers/render/measureAppearance';
import { docPtrOf, rawCall } from '../../src/workers/render/pdfium';
import { concatBytes } from '../../src/workers/render/save/bytes';
import { SaveTracker } from '../../src/workers/render/save/tracker';
import { unzlibSync } from 'fflate';

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
  installLeaderReadback(mod, native);
  tracker = new SaveTracker(mod, native);
  faces = new FaceStore({
    harfbuzz: () => import('harfbuzzjs'),
    subsetWasm: () =>
      Promise.resolve(readFileSync(require.resolve('harfbuzzjs/dist/harfbuzz-subset.wasm'))),
    fontFile: (file) => Promise.resolve(new Uint8Array(readFileSync(join(VENDOR, file)))),
  });
});

async function open(bytes: Uint8Array): Promise<PdfDocumentObject> {
  const id = `m${String(++seq)}`;
  const doc = await native
    .openDocumentBuffer({ id, content: bytes.slice().buffer }, {})
    .toPromise();
  tracker.opened(id, bytes);
  await tracker.securityReady(id);
  return doc;
}

/** Ink of `colour` (r, g, b within 60) anywhere in a box (page points from the top-left). */
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
const tint = (r: number, g: number, b: number): boolean =>
  r > 240 && g > 180 && g < 240 && b > 170 && b < 235;

const STYLE = {
  pageIndex: 0,
  flags: ['print'],
  opacity: 1,
  strokeWidth: 1,
  strokeColor: RED,
  strokeStyle: PdfAnnotationBorderStyle.SOLID,
  color: 'transparent',
};

function length(id: string, text: string, measure: MeasureMeta, leader = false) {
  const A = { x: 100, y: 300 };
  const B = { x: 300, y: 300 };
  const L = leader ? { ll: 40, lle: 3, llo: 0 } : null;
  const g = dimensionGeometry(A, B, L, true);
  return {
    ...STYLE,
    type: PdfAnnotationSubtype.LINE,
    id,
    rect: boundsOf([A, B, ...dimensionPoints(g)], 10),
    intent: 'LineDimension',
    linePoints: { start: A, end: B },
    lineEndings: {
      start: PdfAnnotationLineEnding.OpenArrow,
      end: PdfAnnotationLineEnding.OpenArrow,
    },
    contents: text,
    measure,
    ...(L ? { leader: L } : {}),
  };
}

const SQUARE = [
  { x: 100, y: 500 },
  { x: 300, y: 500 },
  { x: 300, y: 700 },
  { x: 100, y: 700 },
];

function poly(
  id: string,
  type: PdfAnnotationSubtype,
  vertices: typeof SQUARE,
  measure: MeasureMeta,
  text: string,
) {
  return {
    ...STYLE,
    type,
    id,
    rect: boundsOf(vertices, 5),
    intent: type === PdfAnnotationSubtype.POLYGON ? 'PolygonDimension' : 'PolyLineDimension',
    vertices,
    contents: text,
    measure,
    ...(type === PdfAnnotationSubtype.POLYGON ? { color: RED } : {}),
  };
}

async function create(doc: PdfDocumentObject, annot: Record<string, unknown>) {
  const page = doc.pages[0];
  if (!page) throw new Error('no page');
  const args: unknown[] = [doc, page, annot];
  const f = await prepareMeasureCaption(faces, 'createPageAnnotation', args);
  await native.createPageAnnotation(doc, page, annot as never).toPromise();
  const outcome = applyMeasureAppearance(mod, native, 'createPageAnnotation', args, f);
  tracker.recordMutation('createPageAnnotation', args);
  return outcome;
}

/** Every form stream an annotation's appearance draws (nested forms too), inflated, as text. */
async function appearances(bytes: Uint8Array): Promise<string> {
  const r = await PdfReader.open(bytes, (b) => Promise.resolve(unzlibSync(b)));
  const out: string[] = [];
  const seen = new Set<unknown>();
  const walk = async (v: unknown, depth: number): Promise<void> => {
    const x = await r.resolve(v as never);
    if (depth > 16 || !x || seen.has(x)) return;
    seen.add(x);
    if (x instanceof PdfStream) {
      out.push(Buffer.from(await r.decode(x)).toString('latin1'));
      await walk(x.dict.get('Resources'), depth + 1);
      return;
    }
    if (x instanceof Map) for (const e of x.values()) await walk(e, depth + 1);
  };
  for (const p of await r.pages()) {
    const annots = await r.resolve(p.dict.get('Annots'));
    if (!Array.isArray(annots)) continue;
    for (const a of annots) {
      const d = await r.resolve(a);
      if (d instanceof Map) await walk(d.get('AP'), 0);
    }
  }
  return out.join('\n');
}

describe('a measurement is one markup with its value in its appearance (M14-03)', () => {
  it('Length: Above draws the value over the line, In line breaks the line for it', async () => {
    const doc = await open(simplePdf(1));
    expect(await create(doc, length('l1', '20,000 mm', { tool: 'length', cap: 'top' }))).toBe(
      'drawn',
    );
    // The value sits above the line (y 300 from the top), centred on its middle.
    expect(inkIn(doc.id, [180, 286, 220, 297], red)).toBe(true);
    const inl = await open(simplePdf(1));
    expect(await create(inl, length('l2', '20,000 mm', { tool: 'length', cap: 'inline' }))).toBe(
      'drawn',
    );
    // In line: the text on the line; the line itself still drawn left and right of it.
    expect(inkIn(inl.id, [180, 296, 220, 304], red)).toBe(true);
    expect(inkIn(inl.id, [120, 299, 140, 301], red)).toBe(true);
    expect(inkIn(inl.id, [150, 299.5, 154, 300.5], red)).toBe(true);
  });

  it('Length with an offset: the caption follows the dimension line', async () => {
    const doc = await open(simplePdf(1));
    expect(await create(doc, length('l3', '20,000 mm', { tool: 'length', cap: 'top' }, true))).toBe(
      'drawn',
    );
    // Leader lines go 40 pt down the page; the value sits over the dimension line.
    expect(inkIn(doc.id, [99, 320, 101, 330], red)).toBe(true);
    expect(inkIn(doc.id, [180, 326, 220, 337], red)).toBe(true);
    expect(inkIn(doc.id, [180, 286, 220, 297], red)).toBe(false);
  });

  it('Area: a see-through fill and the value in the middle; no /IC', async () => {
    const original = simplePdf(1);
    const doc = await open(original);
    expect(
      await create(
        doc,
        poly(
          'a1',
          PdfAnnotationSubtype.POLYGON,
          SQUARE,
          { tool: 'area', fill: RED, label: 'Room' },
          'Room: 40.0 m²',
        ),
      ),
    ).toBe('drawn');
    expect(inkIn(doc.id, [120, 520, 160, 560], tint)).toBe(true);
    expect(inkIn(doc.id, [170, 594, 230, 606], red)).toBe(true);
    const s = await tracker.save(doc.id);
    const saved = concatBytes([original, s.tail]);
    const text = Buffer.from(saved).toString('latin1');
    expect(text).not.toMatch(/\/IC\s*\[/u);
    // The value is drawn in an embedded subset of the app's own font, and named for copying.
    expect(text).toMatch(/\/FontFile2/u);
    expect(await appearances(saved)).toMatch(/ActualText <FEFF0052006F006F006D/u);
  });

  it('Area with a cutout: no fill in the hole, its edge dashed, the value clear of it (M14-06)', async () => {
    const original = simplePdf(1);
    const doc = await open(original);
    // A 100 × 100 pt hole in the middle of the 200 × 200 pt square (page points, y down).
    const hole = [
      { x: 150, y: 550 },
      { x: 250, y: 550 },
      { x: 250, y: 650 },
      { x: 150, y: 650 },
    ];
    expect(
      await create(
        doc,
        poly(
          'h1',
          PdfAnnotationSubtype.POLYGON,
          SQUARE,
          { tool: 'area', fill: RED, holes: [hole] },
          '3.00 m²',
        ),
      ),
    ).toBe('drawn');
    // The fill outside the hole, none inside it (away from its dashed edge and the caption).
    expect(inkIn(doc.id, [110, 510, 140, 540], tint)).toBe(true);
    expect(inkIn(doc.id, [170, 570, 230, 630], tint)).toBe(false);
    expect(inkIn(doc.id, [170, 570, 230, 630], red)).toBe(false);
    // The hole's edge: dashes of red along its left side.
    expect(inkIn(doc.id, [149.5, 555, 150.5, 645], red)).toBe(true);
    expect(await appearances(concatBytes([original, (await tracker.save(doc.id)).tail]))).toMatch(
      /\[4 3\] 0 d/u,
    );
  });

  it('Polylength and Perimeter: the value on the longest segment', async () => {
    const doc = await open(simplePdf(1));
    const path = [
      { x: 100, y: 200 },
      { x: 400, y: 200 },
      { x: 400, y: 260 },
    ];
    expect(
      await create(
        doc,
        poly('p1', PdfAnnotationSubtype.POLYLINE, path, { tool: 'polylength' }, '360 mm'),
      ),
    ).toBe('drawn');
    expect(inkIn(doc.id, [230, 186, 270, 197], red)).toBe(true);
    const closed = [...SQUARE, SQUARE[0] ?? { x: 0, y: 0 }];
    const doc2 = await open(simplePdf(1));
    expect(
      await create(
        doc2,
        poly('p2', PdfAnnotationSubtype.POLYLINE, closed, { tool: 'perimeter' }, '800 mm'),
      ),
    ).toBe('drawn');
    // The closing side is drawn (the PolyLine repeats its first vertex).
    expect(inkIn(doc2.id, [99, 600, 101, 620], red)).toBe(true);
  });

  it('a markup without our field is left to PDFium; a move keeps the appearance', async () => {
    const doc = await open(simplePdf(1));
    const plain = { ...length('x', '1 mm', { tool: 'length' }), measure: undefined };
    expect(await create(doc, plain)).toBe('none');
    const page = doc.pages[0];
    expect(
      applyMeasureAppearance(
        mod,
        native,
        'updatePageAnnotation',
        [doc, page, length('x', '1 mm', { tool: 'length' }), { regenerateAppearance: false }],
        null,
      ),
    ).toBe('none');
  });

  it('the estimated caption width is never narrower than the shaped text', async () => {
    const inter = libraryFamily('inter');
    if (!inter) throw new Error('no Inter');
    const samples = [
      '20,000 mm',
      '1,234,567.89 mm',
      'Slab S1: 42.50 m²',
      '12\' 6 1/2"',
      'WWW MMM www mmm',
      'Office: 30,000 mm',
      '0.0985 m²',
    ];
    const f = await faces.prepare(inter, false, false, samples.join(''));
    for (const s of samples) {
      const [line] = layout(s, f.primary, f.fallbacks, 10, 100_000);
      expect(estimateWidth(s), s).toBeGreaterThanOrEqual(line?.width ?? 0);
    }
  });
});

describe('the Triya data in the page’s /PieceInfo (M14-03)', () => {
  it('is staged on the page, survives Ctrl+S and reads back; other applications’ entries stay', async () => {
    const original = simplePdf(1);
    const doc = await open(original);
    await create(doc, length('n1', '20,000 mm', { tool: 'length', cap: 'top' }));
    const items = new Map([
      [
        'n1',
        {
          dict: { T: { name: 'Length' }, Lb: { text: 'Wall A' }, F: { text: 'abcd1234' } },
        } as const,
      ],
    ]);
    const other = { dict: { OtherApp: { dict: { LastModified: { text: 'D:2020' } } } } };
    const { set } = pageData(other, items, 'D:20261125120000Z');
    tracker.stagePatch(
      doc.id,
      { page: 0 },
      new Map(Object.entries(set).map(([k, v]) => [k, fromJson(v)])),
    );
    const s = await tracker.save(doc.id);
    const saved = concatBytes([original, s.tail]);
    const r = await PdfReader.open(saved, (b) => Promise.resolve(unzlibSync(b)));
    const [page] = await r.pages();
    const pi = page?.dict.get('PieceInfo');
    const json = pi === undefined ? null : toJson((await r.resolve(pi)) ?? null);
    const back = readItems(json ?? null);
    expect(entryFromPdf(back.get('n1'))).toEqual({
      meta: { tool: 'length', label: 'Wall A' },
      fp: 'abcd1234',
    });
    expect(JSON.stringify(json)).toContain('OtherApp');
    expect(Buffer.from(saved).toString('latin1')).toMatch(/\/LastModified\s*\(D:2026/u);
  });
});
