// M14-02 (D-78, ADR-035): the state of a measurement being drawn, kept apart
// from the pointer handlers so that a zoom, a pan, a scroll or the view
// history (which rebuild the handlers) never loses its points. Test-first.
import { describe, expect, it } from 'vitest';
import {
  anchorOf,
  cancel,
  click,
  finish,
  move,
  owns,
  type Gesture,
  type Where,
} from '../../src/model/measureGesture';

const P0: Where = { doc: 'd1', tool: 'measureArea', page: 0 };
const area = (pts: { x: number; y: number }[]): Gesture => ({
  ...P0,
  kind: 'area',
  pts,
  pointer: pts[pts.length - 1] ?? null,
  offset: 0,
});

describe('a new measurement', () => {
  it('starts with its first click', () => {
    const r = click(null, P0, 'area', { x: 10, y: 20 }, 3);
    expect(r.gesture).toEqual({
      ...P0,
      kind: 'area',
      pts: [{ x: 10, y: 20 }],
      pointer: { x: 10, y: 20 },
      offset: 0,
    });
    expect(r.commit).toBeUndefined();
    expect(r.ended).toBeUndefined();
  });

  it('belongs to its document, tool and page only', () => {
    const g = area([{ x: 1, y: 1 }]);
    expect(owns(g, P0)).toBe(true);
    expect(owns(g, { ...P0, page: 1 })).toBe(false);
    expect(owns(g, { ...P0, doc: 'd2' })).toBe(false);
    expect(owns(g, { ...P0, tool: 'measurePerimeter' })).toBe(false);
    expect(owns(null, P0)).toBe(false);
  });
});

describe('view changes keep the points (Bug 1, Q19)', () => {
  it('the state is the same object however many handlers are made for the page', () => {
    // A zoom makes a new handler: it reads the same gesture, so the next click continues.
    let g = click(null, P0, 'perimeter', { x: 0, y: 0 }, 3).gesture;
    g = click(g, P0, 'perimeter', { x: 100, y: 0 }, 3).gesture;
    const afterZoom = move(g, P0, { x: 100, y: 50 });
    const r = click(afterZoom, P0, 'perimeter', { x: 100, y: 100 }, 3);
    expect(r.gesture?.pts).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]);
  });

  it('a pointer move on another page or tool leaves it alone', () => {
    const g = area([{ x: 1, y: 1 }]);
    expect(move(g, { ...P0, page: 2 }, { x: 9, y: 9 })).toBe(g);
    expect(move(g, { ...P0, tool: 'measureLength' }, { x: 9, y: 9 })).toBe(g);
  });

  it('the anchor for Shift is the last point placed on its own page', () => {
    const g = area([
      { x: 1, y: 1 },
      { x: 5, y: 7 },
    ]);
    expect(anchorOf(move(g, P0, { x: 50, y: 50 }), P0)).toEqual({ x: 5, y: 7 });
    expect(anchorOf(g, { ...P0, page: 1 })).toBeNull();
    expect(anchorOf(null, P0)).toBeNull();
  });
});

describe('only Esc, another tool or a page change ends it', () => {
  it('a click on another page ends it and starts a new one there, saying why', () => {
    const g = area([
      { x: 1, y: 1 },
      { x: 50, y: 1 },
    ]);
    const r = click(g, { ...P0, page: 3 }, 'area', { x: 7, y: 7 }, 3);
    expect(r.ended).toEqual({ gesture: g, reason: 'page' });
    expect(r.gesture).toMatchObject({ page: 3, pts: [{ x: 7, y: 7 }] });
    expect(r.commit).toBeUndefined();
  });

  it('a click with another tool or in another document replaces it without a page note', () => {
    const g = area([{ x: 1, y: 1 }]);
    const r = click(g, { ...P0, tool: 'measurePerimeter' }, 'perimeter', { x: 7, y: 7 }, 3);
    expect(r.ended).toEqual({ gesture: g, reason: 'other' });
  });

  it('Esc (or another tool) drops it', () => {
    expect(cancel()).toBeNull();
  });
});

describe('Distance: two points, then the offset', () => {
  const D: Where = { ...P0, tool: 'measureLength' };
  it('takes the second point, then commits with the offset on the third click', () => {
    let g = click(null, D, 'distance', { x: 0, y: 0 }, 3).gesture;
    g = click(g, D, 'distance', { x: 100, y: 0 }, 3).gesture;
    expect(g?.pts).toHaveLength(2);
    g = move(g, D, { x: 50, y: 30 });
    expect(g?.offset).toBeCloseTo(30);
    const r = click(g, D, 'distance', { x: 50, y: 40 }, 3);
    expect(r.gesture).toBeNull();
    expect(r.commit?.pts).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(r.commit?.offset).toBeCloseTo(40);
  });

  it('ignores a second point on the first', () => {
    const g = click(null, D, 'distance', { x: 0, y: 0 }, 3).gesture;
    expect(click(g, D, 'distance', { x: 0.5, y: 0 }, 3).gesture).toBe(g);
  });

  it('Enter places it with no offset once both points are there, else drops it', () => {
    let g = click(null, D, 'distance', { x: 0, y: 0 }, 3).gesture;
    expect(finish(g)).toEqual({ gesture: null });
    g = click(g, D, 'distance', { x: 100, y: 0 }, 3).gesture;
    const r = finish(g);
    expect(r.commit?.pts).toHaveLength(2);
  });
});

describe('Perimeter and Area by clicks', () => {
  it('a click on the last point adds nothing (a double-click)', () => {
    const g = area([{ x: 10, y: 10 }]);
    expect(click(g, P0, 'area', { x: 10.4, y: 10.2 }, 3).gesture).toBe(g);
  });

  it('an area closes on its first corner once it has three', () => {
    const g = area([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]);
    const r = click(g, P0, 'area', { x: 2, y: -2 }, 3);
    expect(r.gesture).toBeNull();
    expect(r.commit?.pts).toHaveLength(3);
    // Two corners: the first corner is just a point that is already there.
    const two = area([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(click(two, P0, 'area', { x: 2, y: -2 }, 3).commit).toBeUndefined();
  });

  it('finish needs two points for a polylength, three for a perimeter or an area', () => {
    const p: Gesture = { ...area([{ x: 0, y: 0 }]), tool: 'measurePerimeter', kind: 'perimeter' };
    expect(finish(p).commit).toBeUndefined();
    const p2 = { ...p, pts: [...p.pts, { x: 9, y: 0 }] };
    // M14-03: a Perimeter always closes, so it needs a third point.
    expect(finish(p2).commit).toBeUndefined();
    expect(finish({ ...p2, pts: [...p2.pts, { x: 9, y: 9 }] }).commit?.pts).toHaveLength(3);
    const l: Gesture = { ...p2, tool: 'measurePolylength', kind: 'polylength' };
    expect(finish(l).commit?.pts).toHaveLength(2);
    expect(
      finish(
        area([
          { x: 0, y: 0 },
          { x: 9, y: 0 },
        ]),
      ).commit,
    ).toBeUndefined();
    expect(
      finish(
        area([
          { x: 0, y: 0 },
          { x: 9, y: 0 },
          { x: 9, y: 9 },
        ]),
      ).commit?.pts,
    ).toHaveLength(3);
    expect(finish(null)).toEqual({ gesture: null });
  });
});
