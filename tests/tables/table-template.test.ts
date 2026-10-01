// M4-15 (§7.7, M4-Q9): templates ↔ grids, page matching, validation.
import { describe, expect, it } from 'vitest';
import { makeGrid, merge, setHeaderRows } from '../../src/model/tableGrid';
import {
  applyTemplate,
  fits,
  gridFromTemplate,
  parseTemplate,
  templateFromGrid,
  type PageFrame,
} from '../../src/model/tableTemplate';

const A4: PageFrame = { width: 595, height: 842, originX: 0, originY: 0, rotation: 0 };
const grid = setHeaderRows(merge(makeGrid(1, [50, 400, 300, 700], 3, 4, 'stream'), 0, 0, 0, 1), 1);

describe('table templates', () => {
  it('round-trips a grid through a template on a page of the same size', () => {
    const t = templateFromGrid(grid, A4, '  Parts list  ', 'x1', 1000);
    expect(t.name).toBe('Parts list');
    expect(gridFromTemplate(t, 3, A4)).toEqual({ ...grid, page: 3, source: 'template' });
  });

  it('is relative to the page origin (a cropped page with the same size fits)', () => {
    const cropped: PageFrame = { ...A4, originX: 20, originY: 30 };
    const t = templateFromGrid(
      { ...grid, cols: grid.cols.map((x) => x + 20), rows: grid.rows.map((y) => y + 30) },
      cropped,
      'c',
      'x',
      0,
    );
    expect(t.cols[0]).toBe(50);
    expect(gridFromTemplate(t, 0, A4)?.cols).toEqual(grid.cols);
  });

  it('skips pages whose size (beyond 1 pt) or rotation differs', () => {
    const t = templateFromGrid(grid, A4, 'p', 'x', 0);
    expect(fits(t, { ...A4, width: 595.8 })).toBe(true);
    expect(fits(t, { ...A4, width: 597 })).toBe(false);
    expect(fits(t, { ...A4, rotation: 90 })).toBe(false);
    expect(fits(t, { ...A4, rotation: 360 })).toBe(true);
    const landscape: PageFrame = { ...A4, width: 842, height: 595 };
    const r = applyTemplate(t, [0, 1, 2], (p) => (p === 0 ? landscape : A4));
    expect(r.skipped).toEqual([0]);
    expect(r.grids.map((g) => g.page)).toEqual([1, 2]);
  });

  it('validates stored templates', () => {
    const t = templateFromGrid(grid, A4, 'p', 'x', 5);
    expect(parseTemplate(JSON.parse(JSON.stringify(t)))).toEqual(t);
    expect(parseTemplate({ ...t, name: ' ' })).toBeNull();
    expect(parseTemplate({ ...t, cols: [10, 5] })).toBeNull();
    expect(parseTemplate({ ...t, page: { width: 0, height: 1, rotation: 0 } })).toBeNull();
    expect(parseTemplate({ ...t, page: { ...t.page, rotation: 45 } })).toBeNull();
    expect(parseTemplate('nope')).toBeNull();
    // Out-of-range merges are dropped, header rows clamped.
    expect(
      parseTemplate({ ...t, merges: [{ r: 9, c: 0, rs: 2, cs: 2 }], headerRows: 99 }),
    ).toMatchObject({
      merges: [],
      headerRows: 4,
    });
  });
});
