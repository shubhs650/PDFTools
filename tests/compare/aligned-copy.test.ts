// M12-15 (D-62, Q16, Q43): aligned copy between a comparison's revisions —
// where a comment of one window lands in another window of its sheet, and in
// a text comparison on the matching text of the other side.
import { describe, expect, it } from 'vitest';
import {
  landingIn,
  mapBetween,
  matchPlace,
  sheetOf,
  sheetWindows,
  textLanding,
  type SheetPages,
} from '../../src/model/compare/alignedCopy';
import { mapPoint } from '../../src/model/compare/link';
import { IDENTITY, type Affine } from '../../src/model/compare/material';
import type { PageStack, SyncCurve } from '../../src/model/compare/textView';

/** A similarity in displayed space: k·R(deg)·p + (tx, ty). */
function sim(k: number, deg: number, tx: number, ty: number): Affine {
  const r = (deg * Math.PI) / 180;
  return [k * Math.cos(r), k * Math.sin(r), -k * Math.sin(r), k * Math.cos(r), tx, ty];
}

const near = (p: { x: number; y: number }, q: { x: number; y: number }) => {
  expect(p.x).toBeCloseTo(q.x, 6);
  expect(p.y).toBeCloseTo(q.y, 6);
};

// Sheet 0 pairs A1 with B1, sheet 1 is only in A (removed), sheet 2 pairs A2 with B0 (reordered).
const SHEETS: SheetPages[] = [
  { a: { docId: 'A', page: 1 }, b: { docId: 'B', page: 1 } },
  { a: { docId: 'A', page: 0 }, b: null },
  { a: { docId: 'A', page: 2 }, b: { docId: 'B', page: 0 } },
];
const PLACE = sim(0.5, 0.4, 30, -12);
const placeOf = (i: number): Affine => (i === 2 ? PLACE : IDENTITY);
const sheet = (i: number): SheetPages => {
  const s = SHEETS[i];
  if (!s) throw new Error(`no sheet ${String(i)}`);
  return s;
};

describe('the windows of a sheet', () => {
  it('lists the notes page, A through its alignment and B as it is', () => {
    const w = sheetWindows(sheet(2), 2, 'N', PLACE);
    expect(w.map((x) => [x.role, x.docId, x.page])).toEqual([
      ['overlay', 'N', 2],
      ['a', 'A', 2],
      ['b', 'B', 0],
    ]);
    expect(w[1]?.toRef).toEqual(PLACE);
    // A sheet only A has is drawn in A's own frame.
    expect(sheetWindows(sheet(1), 1, 'N', PLACE)[1]?.toRef).toEqual(IDENTITY);
  });

  it('finds the sheet of a page, the notes by their page index', () => {
    expect(sheetOf(SHEETS, 'N', { docId: 'A', page: 2 })).toBe(2);
    expect(sheetOf(SHEETS, 'N', { docId: 'B', page: 0 })).toBe(2);
    expect(sheetOf(SHEETS, 'N', { docId: 'N', page: 1 })).toBe(1);
    expect(sheetOf(SHEETS, 'N', { docId: 'N', page: 7 })).toBe(-1);
    expect(sheetOf(SHEETS, 'N', { docId: 'C', page: 0 })).toBe(-1);
  });
});

describe('Copy to new revision and back', () => {
  it('lands a comment of A on the matching spot of B (the sheet alignment)', () => {
    const l = landingIn(SHEETS, 'N', placeOf, { docId: 'A', page: 2 }, 'b');
    expect(l?.docId).toBe('B');
    expect(l?.page).toBe(0);
    const p = { x: 410, y: 222 };
    if (!l) throw new Error('no landing');
    near(mapPoint(l.map, p), mapPoint(PLACE, p));
  });

  it('copies back from B to A through the inverse', () => {
    const l = landingIn(SHEETS, 'N', placeOf, { docId: 'B', page: 0 }, 'a');
    if (!l) throw new Error('no landing');
    expect([l.docId, l.page]).toEqual(['A', 2]);
    const p = { x: 410, y: 222 };
    near(mapPoint(l.map, mapPoint(PLACE, p)), p);
  });

  it('lands a note of the overlay on either revision', () => {
    const toB = landingIn(SHEETS, 'N', placeOf, { docId: 'N', page: 2 }, 'b');
    expect(toB?.map).toEqual(IDENTITY);
    const toA = landingIn(SHEETS, 'N', placeOf, { docId: 'N', page: 2 }, 'a');
    if (!toA) throw new Error('no landing');
    near(mapPoint(toA.map, mapPoint(PLACE, { x: 5, y: 9 })), { x: 5, y: 9 });
  });

  it('has nowhere to go on a sheet only one revision has, or from a page on no sheet', () => {
    expect(landingIn(SHEETS, 'N', placeOf, { docId: 'A', page: 0 }, 'b')).toBeNull();
    expect(landingIn(SHEETS, 'N', placeOf, { docId: 'A', page: 9 }, 'b')).toBeNull();
    // Not onto its own window.
    expect(landingIn(SHEETS, 'N', placeOf, { docId: 'A', page: 2 }, 'a')).toBeNull();
  });
});

describe('aligned paste between the windows', () => {
  it('maps between two windows of one sheet', () => {
    const m = mapBetween(SHEETS, 'N', placeOf, { docId: 'A', page: 2 }, { docId: 'B', page: 0 });
    expect(m).toEqual(PLACE);
    expect(
      mapBetween(SHEETS, 'N', placeOf, { docId: 'B', page: 1 }, { docId: 'N', page: 0 }),
    ).toEqual(IDENTITY);
  });

  it('is the usual paste between pages of different sheets, or onto the same page', () => {
    expect(
      mapBetween(SHEETS, 'N', placeOf, { docId: 'A', page: 2 }, { docId: 'B', page: 1 }),
    ).toBeNull();
    expect(
      mapBetween(SHEETS, 'N', placeOf, { docId: 'A', page: 2 }, { docId: 'A', page: 2 }),
    ).toBeNull();
  });
});

describe('text comparison: the matching text', () => {
  // Two 800 pt pages with 20 pt gaps on each side; B has 100 pt more text before the
  // second paragraph, so everything after it sits 100 pt lower.
  const stacks: { a: PageStack; b: PageStack } = {
    a: { tops: [0, 820], heights: [800, 800] },
    b: { tops: [0, 820], heights: [800, 800] },
  };
  const curve: SyncCurve = {
    a: Float64Array.from([50, 300, 1000]),
    b: Float64Array.from([50, 400, 1100]),
  };

  it('moves a comment with its paragraph onto the matching page', () => {
    const l = textLanding(curve, stacks, 'a', 0, 300);
    expect(l?.page).toBe(0);
    expect(l?.map).toEqual([1, 0, 0, 1, 0, 100]);
    // A's 750 is 100 lower on B: past B's first page, 30 pt down its second.
    const m = textLanding(curve, stacks, 'a', 0, 750);
    expect(m?.page).toBe(1);
    if (!m) throw new Error('no landing');
    near(mapPoint(m.map, { x: 72, y: 750 }), { x: 72, y: 30 });
  });

  it('maps back from B to A', () => {
    const l = textLanding(curve, stacks, 'b', 1, 280);
    if (!l) throw new Error('no landing');
    expect(l.page).toBe(1);
    near(mapPoint(l.map, { x: 0, y: 280 }), { x: 0, y: 180 });
  });

  it('keeps a place in the gap on the foot of the page above', () => {
    const l = textLanding(curve, stacks, 'b', 0, 905 - 0);
    // B's 905 is A's 805: in A's gap below page 0.
    expect(l?.page).toBe(0);
    if (!l) throw new Error('no landing');
    expect(mapPoint(l.map, { x: 0, y: 905 }).y).toBeCloseTo(800, 6);
  });

  it('has no landing off the stack', () => {
    expect(textLanding(curve, stacks, 'a', 5, 10)).toBeNull();
    expect(
      textLanding(curve, { a: stacks.a, b: { tops: [], heights: [] } }, 'a', 0, 10),
    ).toBeNull();
  });
});

describe('text comparison: changed and moved text', () => {
  const curve: SyncCurve = { a: Float64Array.from([0, 1000]), b: Float64Array.from([0, 1000]) };
  // A paragraph at A 200–260 moved to B 700–760; a replaced word at A 400–410 is B 380–400.
  const spans = [
    { a: { top: 200, bottom: 260 }, b: { top: 700, bottom: 760 } },
    { a: { top: 400, bottom: 410 }, b: { top: 380, bottom: 400 } },
    // A whole section changed around both: the smaller span wins.
    { a: { top: 150, bottom: 450 }, b: { top: 150, bottom: 450 } },
    null,
  ];

  it('follows a moved paragraph to where it went, at the same share of it', () => {
    expect(matchPlace(curve, spans, 'a', 230)).toBeCloseTo(730, 9);
    expect(matchPlace(curve, spans, 'b', 745)).toBeCloseTo(245, 9);
  });

  it('takes the smallest change that holds the place', () => {
    expect(matchPlace(curve, spans, 'a', 405)).toBeCloseTo(390, 9);
    expect(matchPlace(curve, spans, 'a', 300)).toBeCloseTo(300, 9);
  });

  it('uses the content-sync curve elsewhere', () => {
    expect(matchPlace(curve, spans, 'a', 900)).toBeCloseTo(900, 9);
  });

  it('lands a comment on moved text on the page it moved to', () => {
    const stacks = {
      a: { tops: [0, 520], heights: [500, 500] },
      b: { tops: [0, 520], heights: [500, 500] },
    };
    const l = textLanding(curve, stacks, 'a', 0, 230, spans);
    expect(l?.page).toBe(1);
    if (!l) throw new Error('no landing');
    expect(mapPoint(l.map, { x: 50, y: 230 }).y).toBeCloseTo(730 - 520, 9);
  });
});
