// M3-05 (ADR-014 decision 3): an annotation tile composited over the content
// tile equals PDFium's own render with annotations, on pages loaded the way the
// Render worker loads them (rotation-normalized), including a rotated page and
// a crop box that doesn't start at 0, 0. Real PDFium.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { PdfAnnotationObject, PdfDocumentObject } from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildPdf } from '../../e2e/fixtures/generate';
import { acquirePage } from '../../src/workers/render/pdfium';
import { annotBoxes, renderAnnotTile } from '../../src/workers/render/annotTiles';
import { ensureName } from '../../src/workers/render/annotIds';
import { listAnnotations } from '../../src/workers/work/annotations';

const require = createRequire(import.meta.url);
let mod: WrappedPdfiumModule;
let native: PdfiumNative;
let seq = 0;

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
});

/** A page with content, three markups (one hidden, one link) and optional /Rotate and crop box. */
function sheet(extra: string): Uint8Array {
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 400] ${extra} /Contents 4 0 R /Annots [5 0 R 7 0 R 8 0 R] >>`,
    { dict: '<< >>', stream: '0 0 1 rg 50 50 500 20 re f' },
    '<< /Type /Annot /Subtype /Square /Rect [100 100 300 220] /NM (sq) /F 4 /AP << /N 6 0 R >> >>',
    {
      dict: '<< /Type /XObject /Subtype /Form /BBox [0 0 200 120] >>',
      stream: '1 0 0 RG 6 w 3 3 194 114 re S',
    },
    '<< /Type /Annot /Subtype /Square /Rect [350 100 450 200] /NM (hidden) /F 6 /AP << /N 6 0 R >> >>',
    '<< /Type /Annot /Subtype /Link /Rect [0 0 50 50] /NM (link) /Border [0 0 0] >>',
  ]);
}

async function open(bytes: Uint8Array): Promise<PdfDocumentObject> {
  return native
    .openDocumentBuffer(
      { id: `t${String(++seq)}`, content: bytes.slice().buffer },
      {
        normalizeRotation: true,
      },
    )
    .toPromise();
}

describe.each([
  ['plain', ''],
  ['rotated 90°', '/Rotate 90'],
  ['crop box offset', '/CropBox [20 10 580 390]'],
])('annotation tiles: %s', (_name, extra) => {
  it('match PDFium’s render with annotations; hidden markups and links are left out', async () => {
    const doc = await open(sheet(extra));
    const page = doc.pages[0];
    if (!page) throw new Error('no page');
    const crop = page.boxes?.crop;
    const frame = {
      height: page.size.height,
      originX: crop?.left ?? 0,
      originY: crop?.bottom ?? 0,
    };
    const ref = acquirePage(native, doc.id, 0);
    const boxes = annotBoxes(mod, ref.pagePtr, frame);
    ref.release();
    expect(boxes.map((b) => b.nm)).toEqual(['sq']);

    let maxDiff = 0;
    let drawnTotal = 0;
    for (const scale of [0.5, 1, 3]) {
      const w = 256 / scale;
      for (const [x, y] of [
        [0, 0],
        [w / 2, w / 3],
        [page.size.width - w, page.size.height - w],
      ] as const) {
        const rect = { origin: { x, y }, size: { width: w, height: w } };
        const base = await native
          .renderPageRect(doc, page, rect, { scaleFactor: scale })
          .toPromise();
        const full = await native
          .renderPageRect(doc, page, rect, { scaleFactor: scale, withAnnotations: true })
          .toPromise();
        const tile = renderAnnotTile(mod, native, doc.id, boxes, {
          pageIndex: 0,
          x,
          y,
          w,
          h: w,
          width: base.width,
          height: base.height,
          exclude: [],
        });
        drawnTotal += tile?.drawn ?? 0;
        for (let p = 0; p < base.data.length; p += 4) {
          const alpha = (tile?.data[p + 3] ?? 0) / 255;
          for (let c = 0; c < 3; c++) {
            const v = (tile?.data[p + c] ?? 0) * alpha + (base.data[p + c] ?? 0) * (1 - alpha);
            maxDiff = Math.max(maxDiff, Math.abs(v - (full.data[p + c] ?? 0)));
          }
        }
      }
    }
    expect(drawnTotal).toBeGreaterThan(0);
    expect(maxDiff).toBeLessThanOrEqual(4);
    // Excluding the selected markup leaves nothing to draw.
    const none = renderAnnotTile(mod, native, doc.id, boxes, {
      pageIndex: 0,
      x: 0,
      y: 0,
      w: page.size.width,
      h: page.size.height,
      width: 64,
      height: 64,
      exclude: ['sq'],
    });
    expect(none).toBeNull();
    await native.closeDocument(doc).toPromise();
  });
});

describe('stable ids across the workers (ADR-014 decision 2)', () => {
  const noNm = buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 400] /Annots [4 0 R] >>',
    '<< /Type /Annot /Subtype /Square /Rect [100 100 300 220] /C [1 0 0] >>',
  ]);

  it('the Work listing says obj-4; the Render side names it before an edit', async () => {
    const work = await open(noNm);
    const listed = await listAnnotations(
      mod,
      native,
      work,
      { checkpoint: () => Promise.resolve(), signal: new AbortController().signal },
      () => undefined,
    );
    expect(listed[0]?.map((a) => a.id)).toEqual(['obj-4']);
    await native.closeDocument(work).toPromise();

    const render = await open(noNm);
    expect(ensureName(mod, native, render.id, 0, 'obj-4')).toBe(true);
    expect(ensureName(mod, native, render.id, 0, 'obj-4')).toBe(false); // already named
    const page = render.pages[0];
    if (!page) throw new Error('no page');
    const [annot] = (await native
      .getPageAnnotations(render, page)
      .toPromise()) as PdfAnnotationObject[];
    expect(annot?.id).toBe('obj-4');
    expect(ensureName(mod, native, render.id, 0, 'not-stable')).toBe(false);
    await native.closeDocument(render).toPromise();
  });
});
