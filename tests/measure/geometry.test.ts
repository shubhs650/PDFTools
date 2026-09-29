// M3-18 (ADR-008): snap geometry extracted with real PDFium, as the Work
// worker does, from the S7 known-geometry sheet: 13 stroked segments, the
// fill-only triangle, the circle within 0.2 pt, exact snaps.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { SNAP_CIRCLE, SNAP_FILL_ONLY, SNAP_SEGMENTS, snapSheet } from '../../e2e/fixtures/generate';
import { buildGrid, snap } from '../../src/model/snapIndex';
import { docPtrOf } from '../../src/workers/render/pdfium';
import { extractGeometry } from '../../src/workers/work/geometry';

const require = createRequire(import.meta.url);
let mod: WrappedPdfiumModule;
let segs: Float32Array;

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  const native = new PdfiumNative(mod, { fontFallback: null });
  const doc = await native
    .openDocumentBuffer({ id: 'snap', content: snapSheet().slice().buffer })
    .toPromise();
  segs = (await extractGeometry(mod, docPtrOf(native, doc.id), 0, null)).segs;
});

const list = (): [number, number, number, number][] => {
  const out: [number, number, number, number][] = [];
  for (let i = 0; i < segs.length; i += 4)
    out.push([segs[i] ?? 0, segs[i + 1] ?? 0, segs[i + 2] ?? 0, segs[i + 3] ?? 0]);
  return out;
};

const same = (a: number[], b: number[]): boolean =>
  (Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0)) < 0.01 &&
    Math.hypot((a[2] ?? 0) - (b[2] ?? 0), (a[3] ?? 0) - (b[3] ?? 0)) < 0.01) ||
  (Math.hypot((a[0] ?? 0) - (b[2] ?? 0), (a[1] ?? 0) - (b[3] ?? 0)) < 0.01 &&
    Math.hypot((a[2] ?? 0) - (b[0] ?? 0), (a[3] ?? 0) - (b[1] ?? 0)) < 0.01);

describe('extractGeometry (real PDFium)', () => {
  it('finds all 13 known segments (cm, rotation, forms with /Matrix) and the fill-only triangle', () => {
    const got = list();
    for (const e of [...SNAP_SEGMENTS, ...SNAP_FILL_ONLY])
      expect(
        got.some((g) => same(g, e)),
        e.join(' '),
      ).toBe(true);
  });

  it('flattens the circle within 0.2 pt', () => {
    const { cx, cy, r } = SNAP_CIRCLE;
    const onCircle = list().filter(
      ([x1, y1]) =>
        Math.abs(Math.hypot(x1 - cx, y1 - cy) - r) < 1 && Math.hypot(x1 - cx, y1 - cy) > 1,
    );
    expect(onCircle.length).toBeGreaterThan(8);
    for (const [x1, y1] of onCircle)
      expect(Math.abs(Math.hypot(x1 - cx, y1 - cy) - r)).toBeLessThan(0.2);
  });

  it('snaps exactly to an endpoint, the intersection and a midpoint', () => {
    const g = buildGrid(segs);
    expect(snap(g, 102, 98, 6)).toMatchObject({ kind: 'endpoint', x: 100, y: 100 });
    expect(snap(g, 201, 202, 5)).toMatchObject({ kind: 'intersection' });
    const i = snap(g, 201, 202, 5);
    expect(i?.x).toBeCloseTo(200, 3);
    expect(i?.y).toBeCloseTo(200, 3);
    expect(snap(g, 199, 103, 5)).toMatchObject({ kind: 'midpoint', x: 200, y: 100 });
  });
});
