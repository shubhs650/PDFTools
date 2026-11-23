import { describe, expect, it } from 'vitest';
import { PdfReader } from '../../src/model/pdf/reader';
import {
  apply,
  invert,
  isIdentity,
  mapNoRotateRect,
  mapRect,
  mul,
  pageBox,
  placement,
  alignedPlacement,
  skeletonPdf,
  visual,
  type Mat,
} from '../../src/workers/work/transfer';

// M4-20 (ported from the M4-19 spike): the placement math of the object-copy route (ADR-018 decision 4).

const A4 = { crop: [0, 0, 595, 842] as [number, number, number, number], rotate: 0 };
const near = (a: [number, number], b: [number, number]) => {
  expect(a[0]).toBeCloseTo(b[0], 6);
  expect(a[1]).toBeCloseTo(b[1], 6);
};

describe('placement', () => {
  it('is the identity for the same page box', () => {
    expect(isIdentity(placement(A4, A4))).toBe(true);
  });

  it('inverts and multiplies', () => {
    const m: Mat = [0, -1, 1, 0, 10, 20];
    expect(isIdentity(mul(m, invert(m)))).toBe(true);
  });

  it('visual space: top-left origin, y down, for every rotation', () => {
    near(apply(visual(A4), 0, 842), [0, 0]);
    near(apply(visual(A4), 595, 0), [595, 842]);
    // Landscape media rotated 90° clockwise shows as portrait 595 × 842.
    const r90 = { crop: [0, 0, 842, 595] as [number, number, number, number], rotate: 90 };
    near(apply(visual(r90), 0, 0), [0, 0]); // user bottom-left → visual top-left
    near(apply(visual(r90), 842, 0), [0, 842]);
    near(apply(visual(r90), 0, 595), [595, 0]);
    const r270 = { crop: [0, 0, 842, 595] as [number, number, number, number], rotate: 270 };
    near(apply(visual(r270), 842, 595), [0, 0]);
    const r180 = { crop: [0, 0, 595, 842] as [number, number, number, number], rotate: 180 };
    near(apply(visual(r180), 595, 0), [0, 0]);
  });

  it('maps an A4 comment onto a rotated landscape page at the same visual spot', () => {
    const r90 = { crop: [0, 0, 842, 595] as [number, number, number, number], rotate: 90 };
    const m = placement(A4, r90);
    // A point 100 pt from the left and 50 pt from the top of the A4 page …
    const [x, y] = apply(m, 100, 842 - 50);
    // … is 100 from the visual left and 50 from the visual top of the rotated page.
    near(apply(visual(r90), x, y), [100, 50]);
  });

  it('follows a crop box offset and keeps the distance from the top-left corner', () => {
    const cropped = { crop: [50, 60, 645, 902] as [number, number, number, number], rotate: 0 };
    near(apply(placement(A4, cropped), 100, 800), [150, 860]);
    const letter = { crop: [0, 0, 612, 792] as [number, number, number, number], rotate: 0 };
    near(apply(placement(A4, letter), 100, 800), [100, 750]);
  });

  it('keeps a rect a rect (normalized) under rotation', () => {
    const r90 = { crop: [0, 0, 842, 595] as [number, number, number, number], rotate: 90 };
    const r = mapRect([100, 700, 300, 750], placement(A4, r90)) as number[];
    expect(r[2]).toBeGreaterThan(r[0] ?? 0);
    expect(r[3]).toBeGreaterThan(r[1] ?? 0);
    expect((r[2] ?? 0) - (r[0] ?? 0)).toBeCloseTo(50, 4); // width ↔ height swap
    expect((r[3] ?? 0) - (r[1] ?? 0)).toBeCloseTo(200, 4);
  });
});

describe('NoRotate and the clipboard skeleton', () => {
  it('moves a NoRotate rect by its upper-left corner, size kept', () => {
    const r90 = { crop: [0, 0, 842, 595] as [number, number, number, number], rotate: 90 };
    const r = mapNoRotateRect([100, 700, 120, 720], placement(A4, r90)) as number[];
    expect((r[2] ?? 0) - (r[0] ?? 0)).toBeCloseTo(20, 4);
    expect((r[3] ?? 0) - (r[1] ?? 0)).toBeCloseTo(20, 4);
  });

  it('writes a readable, unencrypted PDF with the given boxes', async () => {
    const bytes = skeletonPdf([
      { crop: [0, 0, 595, 842], rotate: 0 },
      { crop: [10, 20, 852, 615], rotate: 90 },
    ]);
    const r = await PdfReader.open(bytes);
    const pages = await r.pages();
    expect(pages).toHaveLength(2);
    expect(r.encrypted).toBe(false);
    const page = pages[1];
    if (!page) throw new Error('page');
    expect(await pageBox(r, page.dict)).toEqual({
      crop: [10, 20, 852, 615],
      rotate: 90,
    });
  });
});

// M12-15 (D-62): aligned copy between revisions. The map between the pages as
// displayed (a sheet's alignment) is folded between the two pages' own spaces.
describe('aligned placement', () => {
  it('is the usual placement for the identity map', () => {
    const r90 = { crop: [0, 0, 842, 595] as [number, number, number, number], rotate: 90 };
    const a = alignedPlacement(A4, [1, 0, 0, 1, 0, 0], r90);
    const p = placement(A4, r90);
    a.forEach((v, i) => {
      expect(v).toBeCloseTo(p[i] ?? 0, 9);
    });
  });

  it('puts a point where the displayed map sends it', () => {
    // A is shown 20 pt right, 10 pt down and at half size on B (A displayed → B displayed).
    const d: Mat = [0.5, 0, 0, 0.5, 20, 10];
    const b = { crop: [0, 0, 842, 595] as [number, number, number, number], rotate: 0 };
    const m = alignedPlacement(A4, d, b);
    // A's displayed (100, 200) is user (100, 642); on B displayed (70, 110) is user (70, 485).
    near(apply(m, 100, 642), [70, 485]);
  });

  it('follows /Rotate on both sides', () => {
    const r90 = { crop: [0, 0, 842, 595] as [number, number, number, number], rotate: 90 };
    const d: Mat = [1, 0, 0, 1, 5, 7];
    const m = alignedPlacement(r90, d, A4);
    // r90's user (0, 0) is its displayed top-left (0, 0) → B displayed (5, 7) = user (5, 835).
    near(apply(m, 0, 0), [5, 835]);
    // Every point: displayed through d.
    const [ux, uy] = apply(m, 300, 100);
    const [dx, dy] = apply(visual(r90), 300, 100);
    near(apply(visual(A4), ux, uy), [dx + 5, dy + 7]);
  });
});
