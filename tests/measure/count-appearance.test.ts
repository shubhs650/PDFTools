// M14-07 on real PDFium (D-75, ADR-035 Amendment 1): a Count is one Stamp
// whose appearance is its symbol and its number; Ctrl+S shares one font object
// per face across the document's measurement captions, rewritten with the
// union subset when a later save adds glyphs, and every caption still draws
// from the saved file.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { PdfAnnotationSubtype, type PdfDocumentObject } from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { simplePdf } from '../../e2e/fixtures/generate';
import { BLANK_STAMP_PDF } from '../../src/model/measureCurve';
import { countBounds } from '../../src/model/measureCount';
import { captionBoundsEP, type MeasureMeta } from '../../src/model/measureMarkup';
import { FaceStore } from '../../src/workers/render/commentFonts/faces';
import {
  applyMeasureAppearance,
  prepareMeasureCaption,
} from '../../src/workers/render/measureAppearance';
import { docPtrOf, rawCall } from '../../src/workers/render/pdfium';
import { concatBytes } from '../../src/workers/render/save/bytes';
import { shareState } from '../../src/workers/render/save/sharedFonts';
import { SaveTracker } from '../../src/workers/render/save/tracker';

const require = createRequire(import.meta.url);
const VENDOR = fileURLToPath(new URL('../../vendor/fonts/files/', import.meta.url));
let mod: WrappedPdfiumModule;
let native: PdfiumNative;
let tracker: SaveTracker;
let faces: FaceStore;
let seq = 0;
const BLUE = '#0000ff';

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
  const id = `n${String(++seq)}`;
  const doc = await native
    .openDocumentBuffer({ id, content: bytes.slice().buffer }, {})
    .toPromise();
  tracker.opened(id, bytes);
  await tracker.securityReady(id);
  return doc;
}

/** Ink matching `test` in a box (page points from the top-left of an A4 page). */
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
  // FPDF_ANNOT (1): annotations drawn from their appearances.
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
const blue = (r: number, g: number, b: number): boolean => b > 150 && r < 120 && g < 120;

/** A count as the main thread commits it (measurements.ts): its rect from its symbol and caption. */
function count(
  id: string,
  at: { x: number; y: number },
  n: number,
  opts: Partial<MeasureMeta> = {},
) {
  const meta: MeasureMeta = {
    tool: 'count',
    pts: [at],
    group: 'Door',
    n,
    sym: 'circle',
    size: 12,
    ...opts,
  };
  const text = `${meta.group ?? ''} ${String(n)}`;
  const cap = meta.hideN ? null : captionBoundsEP(meta, [at], null, text);
  const [x0, y0, x1, y1] = countBounds(at, meta.size ?? 12, cap);
  return {
    type: PdfAnnotationSubtype.STAMP,
    id,
    pageIndex: 0,
    flags: ['print'],
    opacity: 1,
    strokeColor: BLUE,
    rect: { origin: { x: x0, y: y0 }, size: { width: x1 - x0, height: y1 - y0 } },
    contents: text,
    subject: 'Count',
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
      { data: BLANK_STAMP_PDF.slice().buffer, mimeType: 'application/pdf' } as never,
    )
    .toPromise();
  const outcome = applyMeasureAppearance(mod, native, 'createPageAnnotation', args, f);
  tracker.recordMutation('createPageAnnotation', args);
  return outcome;
}

const fontFiles = (bytes: Uint8Array): number =>
  (
    Buffer.from(bytes)
      .toString('latin1')
      .match(/\/FontFile2\b/gu) ?? []
  ).length;

/** Saves and commits; the file as it now is on disk. */
async function save(
  docId: string,
  file: Uint8Array,
): Promise<{ file: Uint8Array; tail: Uint8Array }> {
  const s = await tracker.save(docId);
  tracker.commit(docId, s.tail.length);
  return { file: concatBytes([file, s.tail]), tail: s.tail };
}

describe('Count is one Stamp with its symbol and number (M14-07)', () => {
  it('draws the symbol in the group colour and its number beside it', async () => {
    const doc = await open(simplePdf(1));
    expect(await create(doc, count('c1', { x: 100, y: 100 }, 7))).toBe('drawn');
    // The circle's edge (radius 6), and the number to the right of the symbol.
    expect(inkIn(doc.id, [93, 99, 95, 101], blue)).toBe(true);
    expect(inkIn(doc.id, [110, 95, 140, 105], blue)).toBe(true);
    expect(inkIn(doc.id, [60, 95, 90, 105], blue)).toBe(false);
  });

  it('with its number switched off, draws the symbol alone', async () => {
    const doc = await open(simplePdf(1));
    expect(
      await create(doc, count('c2', { x: 100, y: 100 }, 3, { hideN: true, sym: 'square' })),
    ).toBe('drawn');
    expect(inkIn(doc.id, [94, 94, 106, 96], blue)).toBe(true);
    expect(inkIn(doc.id, [110, 95, 140, 105], blue)).toBe(false);
  });

  it.each(['circle', 'square', 'triangle', 'diamond', 'cross', 'tick'] as const)(
    'draws a %s',
    async (sym) => {
      const doc = await open(simplePdf(1));
      expect(await create(doc, count(`s-${sym}`, { x: 200, y: 200 }, 1, { sym, size: 20 }))).toBe(
        'drawn',
      );
      expect(inkIn(doc.id, [189, 189, 211, 211], blue)).toBe(true);
    },
  );
});

describe('one font object per face across measurement captions (M14-07, ADR-035 Amendment 1 d2)', () => {
  it('three counts save one font; a later count with new glyphs rewrites it with the union', async () => {
    const original = simplePdf(1);
    const doc = await open(original);
    await create(doc, count('d1', { x: 100, y: 100 }, 1));
    await create(doc, count('d2', { x: 100, y: 200 }, 2));
    await create(doc, count('d3', { x: 100, y: 300 }, 13));
    const first = await save(doc.id, original);
    expect(fontFiles(first.tail)).toBe(1);
    expect(shareState(doc.id).shared).toHaveLength(1);
    // Every number still draws from the saved file.
    const again = await open(first.file);
    for (const y of [100, 200, 300])
      expect(inkIn(again.id, [110, y - 5, 145, y + 5], blue)).toBe(true);

    // New glyphs ("W", "i", "n", "w"): the shared font is written again, no new font.
    await create(doc, count('w1', { x: 300, y: 400 }, 1, { group: 'Window' }));
    const second = await save(doc.id, first.file);
    expect(fontFiles(second.tail)).toBe(1);
    expect(shareState(doc.id).shared).toHaveLength(1);
    const text = Buffer.from(second.tail).toString('latin1');
    const type0 = shareState(doc.id).shared[0]?.type0 ?? -1;
    expect(text).toMatch(new RegExp(`(^|\\s)${String(type0)} 0 obj`, 'u'));
    const reread = await open(second.file);
    for (const y of [100, 200, 300])
      expect(inkIn(reread.id, [110, y - 5, 145, y + 5], blue)).toBe(true);
    expect(inkIn(reread.id, [310, 395, 360, 405], blue)).toBe(true);
    expect(fontFiles(second.file)).toBe(2);
  });

  it('a save with nothing new to share leaves the shared font alone', async () => {
    const original = simplePdf(1);
    const doc = await open(original);
    await create(doc, count('e1', { x: 100, y: 100 }, 1));
    const first = await save(doc.id, original);
    await create(doc, count('e2', { x: 100, y: 200 }, 2));
    const second = await save(doc.id, first.file);
    // "Door 2" needs no glyph "Door 1" lacks but "2": still one font in the file.
    expect(fontFiles(second.file)).toBeLessThanOrEqual(2);
    const reread = await open(second.file);
    expect(inkIn(reread.id, [110, 195, 145, 205], blue)).toBe(true);
  });

  it('1,000 counts save about one font, not a thousand', async () => {
    const original = simplePdf(1);
    const doc = await open(original);
    for (let i = 0; i < 1000; i++)
      await create(
        doc,
        count(`k${String(i)}`, { x: 30 + (i % 25) * 22, y: 30 + Math.floor(i / 25) * 19 }, i + 1),
      );
    const s = await save(doc.id, original);
    // Without sharing, each caption's font (about 1.7 kB) would be in the file once per count.
    expect(shareState(doc.id).dropped).toHaveLength(999 * 5);
    expect(fontFiles(s.tail)).toBe(1);
    const again = await open(s.file);
    // The last count ("Door 1000") draws from the shared font.
    expect(
      inkIn(
        again.id,
        [30 + 24 * 22 + 8, 30 + 39 * 19 - 5, 30 + 24 * 22 + 45, 30 + 39 * 19 + 5],
        blue,
      ),
    ).toBe(true);
  }, 120_000);
});
