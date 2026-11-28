import { describe, expect, it } from 'vitest';
import {
  canAddPoints,
  canRemovePoint,
  edgesOf,
  handlesOf,
  hitEdge,
  hitPoint,
  insertPoint,
  lockAnchor,
  movePoint,
  pointAction,
  removePoint,
  stepPoint,
  storedOf,
  touchedBy,
} from '../../src/model/measureEdit';
import type { PageLayout } from '../../src/model/scaleViewport';
import type { Scale } from '../../src/model/scale';

const p = (x: number, y: number) => ({ x, y });
const square = [p(0, 0), p(100, 0), p(100, 100), p(0, 100)];

describe('handles (M14-04, Q24)', () => {
  it('a Perimeter has no handle for its repeated first vertex, and gets it back', () => {
    const stored = [...square, p(0, 0)];
    const h = handlesOf('perimeter', stored);
    expect(h).toEqual(square);
    expect(storedOf('perimeter', h)).toEqual(stored);
  });

  it('other tools keep every stored point', () => {
    expect(handlesOf('area', square)).toEqual(square);
    expect(handlesOf('polylength', [p(0, 0), p(10, 0), p(0, 0), p(0, 0)])).toHaveLength(4);
    expect(storedOf('area', square)).toEqual(square);
  });

  it('a drag moves one handle only', () => {
    const m = movePoint(square, 2, p(120, 130));
    expect(m[2]).toEqual(p(120, 130));
    expect(m.filter((_, i) => i !== 2)).toEqual(square.filter((_, i) => i !== 2));
  });
});

describe('edges', () => {
  it('open shapes have n − 1 edges, closed ones n (the last joins the first)', () => {
    expect(edgesOf('polylength', 4)).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    expect(edgesOf('area', 4)).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
    ]);
    expect(edgesOf('perimeter', 3)).toHaveLength(3);
    expect(edgesOf('length', 2)).toEqual([[0, 1]]);
  });
});

describe('adding a point (right-click on an edge)', () => {
  it('goes between the edge’s two points', () => {
    const r = insertPoint('polylength', [p(0, 0), p(100, 0), p(100, 100)], 1, p(100, 50));
    expect(r).toEqual([p(0, 0), p(100, 0), p(100, 50), p(100, 100)]);
  });

  it('on the closing edge of an Area it goes last', () => {
    const r = insertPoint('area', square, 3, p(0, 50));
    expect(r).toEqual([...square, p(0, 50)]);
  });

  it('a Length takes no new points', () => {
    expect(canAddPoints('length')).toBe(false);
    expect(insertPoint('length', [p(0, 0), p(10, 0)], 0, p(5, 0))).toBeNull();
  });

  it('an edge that is not there adds nothing', () => {
    expect(insertPoint('polylength', [p(0, 0), p(10, 0)], 1, p(5, 0))).toBeNull();
  });
});

describe('removing a point (right-click on a point)', () => {
  it('a Polylength keeps at least two points, closed shapes three', () => {
    expect(canRemovePoint('polylength', 3)).toBe(true);
    expect(canRemovePoint('polylength', 2)).toBe(false);
    expect(canRemovePoint('area', 4)).toBe(true);
    expect(canRemovePoint('area', 3)).toBe(false);
    expect(canRemovePoint('perimeter', 3)).toBe(false);
    expect(canRemovePoint('length', 2)).toBe(false);
  });

  it('takes the point out', () => {
    expect(removePoint('area', square, 1)).toEqual([p(0, 0), p(100, 100), p(0, 100)]);
    expect(removePoint('area', square.slice(0, 3), 1)).toBeNull();
    expect(removePoint('area', square, 7)).toBeNull();
  });
});

describe('hit tests', () => {
  it('finds the nearest point within the tolerance', () => {
    expect(hitPoint(square, p(98, 3), 5)).toBe(1);
    expect(hitPoint(square, p(50, 50), 5)).toBe(-1);
  });

  it('finds the nearest edge and the point on it', () => {
    expect(hitEdge('area', square, p(50, 2), 4)).toEqual({ edge: 0, at: p(50, 0) });
    expect(hitEdge('area', square, p(2, 50), 4)).toEqual({ edge: 3, at: p(0, 50) });
    // An open shape has no closing edge.
    expect(hitEdge('polylength', square, p(2, 50), 4)).toBeNull();
  });

  it('a right-click on a point removes it, on an edge adds one', () => {
    const r = pointAction('area', square, p(101, 99), 6, 4);
    expect(r).toMatchObject({ kind: 'remove', index: 2 });
    expect(r?.handles).toHaveLength(3);
    const a = pointAction('area', square, p(50, 101), 6, 4);
    expect(a).toMatchObject({ kind: 'add', edge: 2, at: p(50, 100) });
    expect(a?.handles).toHaveLength(5);
  });

  it('a point that can’t go, a Length, or a click away from the shape: nothing', () => {
    const tri = square.slice(0, 3);
    expect(pointAction('area', tri, p(0, 0), 6, 4)).toBeNull();
    expect(pointAction('length', [p(0, 0), p(100, 0)], p(50, 0), 6, 4)).toBeNull();
    expect(pointAction('area', square, p(50, 50), 6, 4)).toBeNull();
  });
});

describe('Shift while dragging a point', () => {
  it('locks from the point before; an open shape’s first from the second', () => {
    expect(lockAnchor('polylength', square, 2)).toEqual(square[1]);
    expect(lockAnchor('polylength', square, 0)).toEqual(square[1]);
    expect(lockAnchor('area', square, 0)).toEqual(square[3]);
    expect(lockAnchor('length', [p(0, 0)], 0)).toBeNull();
  });
});

describe('keyboard steps', () => {
  it('move by the step and stay on the page', () => {
    expect(stepPoint(p(5, 5), -10, 1, { width: 100, height: 100 })).toEqual(p(0, 6));
    expect(stepPoint(p(95, 50), 10, 0, { width: 100, height: 100 })).toEqual(p(100, 50));
  });
});

describe('which measurements a scale change touches (D-77, Q23)', () => {
  const s = (real: number): Scale => ({ paper: 1, real, unit: 'mm', precision: 1 });
  const layout = (page: Scale | null, details: PageLayout['details'] = []): PageLayout => ({
    pageDefault: page,
    details,
  });
  const detail = (real: number, bbox: [number, number, number, number]) => ({
    name: 'Detail A',
    bbox,
    scale: s(real),
    index: 1,
  });
  const inDetail = { id: 'in', pts: [p(110, 110), p(150, 110)] };
  const outside = { id: 'out', pts: [p(400, 400), p(450, 400)] };
  const spanning = { id: 'span', pts: [p(150, 150), p(400, 150)] };
  const items = [inDetail, outside, spanning];

  it('a new page scale touches what the page values, not what a viewport values', () => {
    const vp = [detail(5, [100, 100, 200, 200])];
    expect(touchedBy(items, layout(s(100), vp), layout(s(50), vp))).toEqual(['out', 'span']);
  });

  it('a viewport’s new scale touches only what is inside it', () => {
    const before = layout(s(100), [detail(5, [100, 100, 200, 200])]);
    const after = layout(s(100), [detail(10, [100, 100, 200, 200])]);
    expect(touchedBy(items, before, after)).toEqual(['in']);
  });

  it('a viewport moved or made larger touches what goes in or out, and what spans', () => {
    const before = layout(s(100), [detail(5, [100, 100, 200, 200])]);
    const after = layout(s(100), [detail(5, [100, 100, 500, 500])]);
    // The spanning one is now inside the viewport; the outside one is too.
    expect(touchedBy(items, before, after)).toEqual(['out', 'span']);
  });

  it('the same layout touches nothing; a first scale touches everything', () => {
    const l = layout(s(100), [detail(5, [100, 100, 200, 200])]);
    expect(touchedBy(items, l, l)).toEqual([]);
    expect(touchedBy([outside], layout(null), layout(s(100)))).toEqual(['out']);
  });
});
