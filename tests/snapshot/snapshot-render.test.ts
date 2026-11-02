// M6-09 (ADR-021 D-38 e): the snapshot region as the view shows it, on real
// PDFium — page content and the drawn markups (in /Annots order), but not what
// the view leaves out (a reply's note icon, pop-ups, hidden markups); sizes
// follow the scale and the rotation.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { Rotation, type Rect } from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { flattenSourcePdf } from '../../e2e/fixtures/comments';
import { renderSnapshot, type SnapshotPixels } from '../../src/workers/render/snapshot';

const require = createRequire(import.meta.url);
let mod: WrappedPdfiumModule;
let native: PdfiumNative;
const DOC = 'snap';
const frame = { height: 842, originX: 0, originY: 0 };

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
  await native
    .openDocumentBuffer({ id: DOC, content: flattenSourcePdf().slice().buffer }, {})
    .toPromise();
});

const rect = (x: number, y: number, w: number, h: number): Rect => ({
  origin: { x, y },
  size: { width: w, height: h },
});

/** RGB of the picture at a page point (device space), for a rotation-0 snapshot. */
function at(img: SnapshotPixels, r: Rect, scale: number, x: number, y: number): number[] {
  const px = Math.floor((x - r.origin.x) * scale);
  const py = Math.floor((y - r.origin.y) * scale);
  const i = (py * img.width + px) * 4;
  return [img.data[i] ?? -1, img.data[i + 1] ?? -1, img.data[i + 2] ?? -1];
}

const WHITE = [255, 255, 255];
const RED = [255, 0, 0];
const BLUE = [0, 0, 255];

describe('renderSnapshot', () => {
  it('draws the markups the view shows, in order, and leaves out the reply note', () => {
    // The red rectangle (x 100–250, y 162–242), the blue one over its corner,
    // and the reply note's place above it (x 100–120, y 142–162).
    const r = rect(95, 135, 165, 115);
    const img = renderSnapshot(mod, native, DOC, {
      pageIndex: 0,
      frame,
      rect: r,
      scale: 2,
      rotation: Rotation.Degree0,
    });
    expect([img.width, img.height]).toEqual([330, 230]);
    expect(img.drawn).toBe(2);
    expect(at(img, r, 2, 150, 220)).toEqual(RED);
    expect(at(img, r, 2, 230, 190)).toEqual(BLUE);
    // The note icon PDFium's annotation flag would draw there: nothing.
    for (let y = 137; y < 160; y += 2)
      for (let x = 97; x < 125; x += 2) expect(at(img, r, 2, x, y)).toEqual(WHITE);
  });

  it('draws the page content', () => {
    // The page's own black square (x 50–70, y 772–792).
    const r = rect(45, 767, 30, 30);
    const img = renderSnapshot(mod, native, DOC, {
      pageIndex: 0,
      frame,
      rect: r,
      scale: 1,
      rotation: Rotation.Degree0,
    });
    expect(img.drawn).toBe(0);
    expect(at(img, r, 1, 60, 782)).toEqual([0, 0, 0]);
    expect(at(img, r, 1, 46, 768)).toEqual(WHITE);
  });

  it('turns with the view: sides swap at a quarter turn', () => {
    const r = rect(110, 170, 130, 65);
    const img = renderSnapshot(mod, native, DOC, {
      pageIndex: 0,
      frame,
      rect: r,
      scale: 1,
      rotation: Rotation.Degree90,
    });
    expect([img.width, img.height]).toEqual([65, 130]);
    const mid = (Math.floor(img.height / 2) * img.width + Math.floor(img.width / 2)) * 4;
    expect([img.data[mid], img.data[mid + 1], img.data[mid + 2]]).toEqual(RED);
  });

  it('refuses a region larger than the cap', () => {
    expect(() =>
      renderSnapshot(mod, native, DOC, {
        pageIndex: 0,
        frame,
        rect: rect(0, 0, 595, 842),
        scale: 10,
        rotation: Rotation.Degree0,
      }),
    ).toThrow(/too large/);
  });
});
