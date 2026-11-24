// Thin Lines (M13-05, D-69, ADR-034 Amendment 2, route b) on the PDFium WASM and
// EmbedPDF engine the app ships: the Render worker's view-only thin copy.
/* eslint-disable @typescript-eslint/no-non-null-assertion -- test pages known to exist */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import {
  PdfAnnotationSubtype,
  type PdfDocumentObject,
  type PdfPageObject,
  type Rect,
} from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { PROBE, probePdf } from '../../spikes/s32-thin-lines/fixtures';
import { applyPageOp } from '../../src/workers/render/pages';
import { pageInfos } from '../../src/workers/render/pdfium';
import { SaveTracker } from '../../src/workers/render/save/tracker';
import { ThinCopies } from '../../src/workers/render/thinLines';

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

const copies = () =>
  new ThinCopies(mod, native, {
    openedLength: (id) => tracker.openedLength(id),
    password: (id) => tracker.copyPassword(id),
  });

async function open(bytes: Uint8Array): Promise<PdfDocumentObject> {
  const id = `thin-${String(++seq)}`;
  const doc = await native
    .openDocumentBuffer({ id, content: bytes.slice().buffer }, { normalizeRotation: true })
    .toPromise();
  tracker.opened(id, bytes);
  await tracker.securityReady(id);
  return doc;
}

const PAGE_H = 842;

/** A 21 × 21 pt window of page 0 around a probe point, as a tile (EmbedPDF's renderPageRect). */
async function tile(doc: PdfDocumentObject, at: { x: number; y: number }, scale: number) {
  const rect: Rect = {
    origin: { x: at.x - 10.5, y: PAGE_H - at.y - 10.5 },
    size: { width: 21, height: 21 },
  };
  const img = await native
    .renderPageRect(doc, doc.pages[0]!, rect, { scaleFactor: scale })
    .toPromise();
  return { data: img.data, w: img.width, h: img.height };
}

/** As the worker does: the thin copy's page held around a render of the copy. */
async function thinTile(
  c: ThinCopies,
  doc: PdfDocumentObject,
  at: { x: number; y: number },
  scale: number,
) {
  const p = c.page(doc.id, 0);
  try {
    return await tile({ ...doc, id: p.docId }, at, scale);
  } finally {
    p.release();
  }
}

type Win = Awaited<ReturnType<typeof tile>>;
const dark = (d: Uint8ClampedArray | Uint8Array, i: number): number =>
  1 - ((d[i] ?? 255) + (d[i + 1] ?? 255) + (d[i + 2] ?? 255)) / (3 * 255);
/** Ink down the centre column (across a horizontal line), in device px: a crisp 1 px line is 1. */
function inkAcross(win: Win): number {
  const x = Math.floor(win.w / 2);
  let ink = 0;
  for (let y = 0; y < win.h; y++) ink += dark(win.data, (y * win.w + x) * 4);
  return ink;
}
function differing(a: Win, b: Win): number {
  let n = 0;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) n++;
  return n;
}

const square = (page: PdfPageObject) => ({
  id: 'thin-square',
  type: PdfAnnotationSubtype.SQUARE,
  pageIndex: page.index,
  rect: { origin: { x: 100, y: 100 }, size: { width: 80, height: 40 } },
  strokeColor: '#E44234',
  color: 'transparent',
  strokeWidth: 3,
  opacity: 1,
  flags: ['print'],
  author: 'M13-05',
  created: new Date(Date.UTC(2026, 10, 24)),
  modified: new Date(Date.UTC(2026, 10, 24)),
});

async function comment(doc: PdfDocumentObject): Promise<void> {
  const page = doc.pages[0]!;
  const sq = square(page);
  tracker.checkAllowed('createPageAnnotation', doc.id, [doc, page, sq]);
  await native.createPageAnnotation(doc, page, sq as never).toPromise();
  tracker.recordMutation('createPageAnnotation', [doc, page, sq]);
}

describe('Thin Lines copy (M13-05)', () => {
  it('draws a 3 pt line 1 device px wide at any zoom, in forms too; fills and text unchanged', async () => {
    const doc = await open(probePdf());
    const c = copies();
    for (const scale of [1, 4]) {
      for (const k of ['page', 'scaledCtm', 'dashed', 'form', 'nested'] as const) {
        expect(inkAcross(await tile(doc, PROBE[k], scale))).toBeCloseTo(3 * scale, 0);
        expect(inkAcross(await thinTile(c, doc, PROBE[k], scale))).toBeCloseTo(1, 0);
      }
      for (const k of ['fillOnly', 'fillStrokeInside', 'strokedText'] as const)
        expect(
          differing(await tile(doc, PROBE[k], scale), await thinTile(c, doc, PROBE[k], scale)),
        ).toBe(0);
    }
    // One copy, its one page walked once (the page stays parsed between tiles).
    expect(c.stats).toMatchObject({ opened: 1, walked: 1 });
    expect(c.stats.thinned).toBe(8);
    await c.closeAll();
    expect(c.openCount).toBe(0);
    await native.closeDocument(doc).toPromise();
  });

  it('never changes the document: Ctrl+S, keep-all and Save Optimized stay byte-identical', async () => {
    const bytes = probePdf();
    const run = async (thin: boolean) => {
      const doc = await open(bytes);
      const c = copies();
      if (thin) await thinTile(c, doc, PROBE.page, 2);
      await comment(doc);
      if (thin) await thinTile(c, doc, PROBE.form, 2);
      const ctrlS = (await tracker.save(doc.id)).tail;
      const keepAll = (await tracker.save(doc.id, { keepAll: true })).tail;
      const optimized = tracker.saveRewrite(doc.id);
      await c.replacing(doc.id);
      await native.closeDocument(doc).toPromise();
      c.replaced(doc.id);
      return [ctrlS, keepAll, optimized].map((b) => Buffer.from(b));
    };
    const plain = await run(false);
    const thin = await run(true);
    for (let i = 0; i < plain.length; i++) expect(thin[i]!.equals(plain[i]!)).toBe(true);
  });

  it('opens again with the current state after the page content changes (a rotation, a new page)', async () => {
    const doc = await open(probePdf());
    const c = copies();
    await thinTile(c, doc, PROBE.page, 1);
    const ctx = { signal: new AbortController().signal, progress: () => undefined };
    await applyPageOp(mod, native, doc.id, { kind: 'rotate', pages: [0], quarter: 1 }, ctx);
    await applyPageOp(
      mod,
      native,
      doc.id,
      { kind: 'insertBlank', at: 1, count: 1, width: 200, height: 300 },
      ctx,
    );
    c.contentChanged(doc.id);
    const p = c.page(doc.id, 1);
    try {
      const copyPages = pageInfos(mod, native, p.docId).map((i) => [i.size, i.rotation]);
      expect(copyPages).toEqual(pageInfos(mod, native, doc.id).map((i) => [i.size, i.rotation]));
      expect(copyPages.length).toBe(2);
    } finally {
      p.release();
    }
    expect(c.stats.opened).toBe(2);
    await c.closeAll();
    await native.closeDocument(doc).toPromise();
  });

  it('closes a copy in use only once its render is done, and none opens while the bytes are replaced', async () => {
    const doc = await open(probePdf());
    const c = copies();
    const held = c.page(doc.id, 0);
    let closed = false;
    const replacing = c.replacing(doc.id).then(() => {
      closed = true;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(closed).toBe(false);
    expect(c.openCount).toBe(1);
    expect(() => c.page(doc.id, 0)).toThrow(/reopened/);
    held.release();
    await replacing;
    expect(c.openCount).toBe(0);
    c.replaced(doc.id);
    // Open again afterwards.
    expect(inkAcross(await thinTile(c, doc, PROBE.page, 1))).toBeCloseTo(1, 0);
    await c.closeAll();
    await native.closeDocument(doc).toPromise();
  });
});
