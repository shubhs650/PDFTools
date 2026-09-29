import { describe, expect, it } from 'vitest';
import { measuredValue, toUserSpace } from '../../src/model/measurement';
import { MM_PER_POINT, type PageViewport, type Scale } from '../../src/model/scale';
import {
  coversPage,
  layoutOf,
  nextViewportName,
  normBox,
  scaleChoice,
  scaleOfChoice,
  withEntry,
  withoutEntry,
  type Box,
} from '../../src/model/scaleViewport';

// M3-17 (§7.4, ADR-007): viewport choice — inside, outside, overlapping
// (smallest wins), spanning, and points from a page with a crop box/rotation.
const mm = (v: number): number => v / MM_PER_POINT;
const s100: Scale = { paper: 1, real: 100, unit: 'm', precision: 2 };
const s5: Scale = { paper: 1, real: 5, unit: 'mm', precision: 1 };
const A4: Box = [0, 0, 595, 842];
const DETAIL: Box = [300, 400, 550, 700];
const list: PageViewport[] = [
  { name: 'Page', bbox: A4, scale: s100 },
  { name: 'Detail A', bbox: DETAIL, scale: s5 },
  { name: 'Legend', bbox: [0, 0, 100, 100], scale: null },
];

describe('page layout', () => {
  it('splits the page default from detail viewports (unscaled entries ignored)', () => {
    const l = layoutOf(list, A4);
    expect(l.pageDefault).toEqual(s100);
    expect(l.details.map((d) => [d.name, d.index])).toEqual([['Detail A', 1]]);
    expect(coversPage([-1, -1, 596, 843], A4)).toBe(true);
    expect(coversPage(DETAIL, A4)).toBe(false);
  });

  it('inside → the viewport; outside → the page; spanning → page scale, flagged', () => {
    const l = layoutOf(list, A4);
    const plate = [
      { x: 320, y: 450 },
      { x: 320 + mm(80), y: 450 },
    ];
    const c = scaleChoice(plate, l);
    expect(c.kind === 'viewport' && c.viewport.name).toBe('Detail A');
    expect(measuredValue('distance', plate, scaleOfChoice(c))).toBeCloseTo(400, 6);
    expect(scaleChoice([{ x: 50, y: 50 }], l)).toEqual({ kind: 'page', scale: s100 });
    const span = scaleChoice(
      [
        { x: 100, y: 100 },
        { x: 400, y: 500 },
      ],
      l,
    );
    expect(span.kind).toBe('spanning');
    expect(scaleOfChoice(span)).toEqual(s100);
    expect(scaleOfChoice(scaleChoice([{ x: 1, y: 1 }], layoutOf([], A4)))).toBeNull();
  });

  it('overlapping: the smallest wins', () => {
    const l = layoutOf(
      withEntry(list, { name: 'Bolt', bbox: [400, 500, 450, 550], scale: s100 }),
      A4,
    );
    const c = scaleChoice([{ x: 420, y: 520 }], l);
    expect(c.kind === 'viewport' && c.viewport.name).toBe('Bolt');
  });

  it('a page with a crop box origin and rotation: EmbedPDF points → user space first', () => {
    // EmbedPDF points are in the unrotated crop box, top-left origin; /Rotate
    // turns the view only. Crop box origin (20, 30), height 800.
    const frame = { height: 800, originX: 20, originY: 30 };
    const pts = toUserSpace(
      [
        { x: 310, y: 380 },
        { x: 400, y: 380 },
      ],
      frame,
    );
    expect(pts[0]).toEqual({ x: 330, y: 450 });
    expect(scaleChoice(pts, layoutOf(list, A4)).kind).toBe('viewport');
  });
});

describe('editing the list', () => {
  it('adds, replaces and removes entries', () => {
    const added = withEntry(list, { name: 'B', bbox: [5, 1, 10, 20], scale: s5 });
    expect(added.map((v) => v.name)).toEqual(['Page', 'Detail A', 'Legend', 'B']);
    const detail = added[1];
    if (!detail) throw new Error('missing');
    const renamed = withEntry(added, { ...detail, name: 'Detail X' }, 1);
    expect(renamed[1]?.name).toBe('Detail X');
    expect(withoutEntry(renamed, 1).map((v) => v.name)).toEqual(['Page', 'Legend', 'B']);
    expect(normBox([10, 20, 5, 1])).toEqual([5, 1, 10, 20]);
    // Unreadable entries keep their place.
    expect(layoutOf([null, ...list], A4).details[0]?.index).toBe(2);
  });

  it('suggests the next free name', () => {
    expect(nextViewportName(list, 'Detail')).toBe('Detail B');
    expect(nextViewportName([], 'Detail')).toBe('Detail A');
  });
});
