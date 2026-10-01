import { describe, expect, it } from 'vitest';
import {
  addCol,
  addRow,
  assignText,
  bbox,
  cellAt,
  cellBox,
  colCount,
  joinWords,
  makeGrid,
  merge,
  mergeAt,
  moveCol,
  moveRow,
  parseGrid,
  removeCol,
  removeRow,
  rowCount,
  setHeaderRows,
  unmerge,
  type WordBox,
} from '../../src/model/tableGrid';

// M4-12 (§7.7): the table grid — dividers, header rows, merged cells, text
// assignment by word-box centre, serialisation.

/** 3 columns of 100 pt from x 100, 4 rows of 20 pt down from y 700. */
const g0 = () => makeGrid(0, [100, 620, 400, 700], 3, 4);

const word = (x: number, y: number, text: string, w = 20, h = 10): WordBox => ({
  x0: x,
  y0: y,
  x1: x + w,
  y1: y + h,
  text,
});

describe('grid geometry', () => {
  it('makes even dividers; top row first', () => {
    const g = g0();
    expect(g.cols).toEqual([100, 200, 300, 400]);
    expect(g.rows).toEqual([700, 680, 660, 640, 620]);
    expect(bbox(g)).toEqual([100, 620, 400, 700]);
    expect([rowCount(g), colCount(g)]).toEqual([4, 3]);
  });

  it('finds the cell at a point, null outside', () => {
    const g = g0();
    expect(cellAt(g, 150, 690)).toEqual([0, 0]);
    expect(cellAt(g, 350, 625)).toEqual([3, 2]);
    expect(cellAt(g, 50, 690)).toBeNull();
    expect(cellAt(g, 150, 710)).toBeNull();
  });

  it('adds, moves (clamped) and removes dividers', () => {
    let g = addCol(g0(), 250);
    expect(g.cols).toEqual([100, 200, 250, 300, 400]);
    expect(addCol(g, 251)).toBe(g); // too close to a divider
    g = moveCol(g, 2, 199); // clamped to the left neighbour + MIN_GAP
    expect(g.cols[2]).toBe(202);
    g = removeCol(g, 2);
    expect(g.cols).toEqual([100, 200, 300, 400]);
    expect(removeCol(g, 0)).toBe(g); // edges are not removable
    g = addRow(g, 675);
    expect(g.rows).toEqual([700, 680, 675, 660, 640, 620]);
    g = moveRow(g, 2, 690);
    expect(g.rows[2]).toBe(678);
    g = removeRow(g, 2);
    expect(g.rows).toEqual([700, 680, 660, 640, 620]);
  });

  it('moving an edge moves the table edge', () => {
    expect(moveCol(g0(), 0, 90).cols[0]).toBe(90);
    expect(moveRow(g0(), 4, 600).rows[4]).toBe(600);
  });
});

describe('merges', () => {
  it('merges a block (any corner order), finds it, unmerges', () => {
    const g = merge(g0(), 0, 2, 0, 0);
    expect(g.merges).toEqual([{ r: 0, c: 0, rs: 1, cs: 3 }]);
    expect(mergeAt(g, 0, 1)).toEqual({ r: 0, c: 0, rs: 1, cs: 3 });
    expect(cellBox(g, 0, 0)).toEqual([100, 680, 400, 700]);
    expect(unmerge(g, 0, 2).merges).toEqual([]);
  });

  it('a new merge replaces overlapped ones; single cells are not merges', () => {
    let g = merge(g0(), 0, 0, 1, 0);
    g = merge(g, 1, 0, 1, 1);
    expect(g.merges).toEqual([{ r: 1, c: 0, rs: 1, cs: 2 }]);
    expect(merge(g0(), 2, 2, 2, 2).merges).toEqual([]);
  });

  it('dividers added inside a merge widen it; removing one shrinks or drops it', () => {
    let g = merge(g0(), 0, 0, 0, 1); // spans columns 0–1
    g = addCol(g, 150); // splits column 0
    expect(g.merges).toEqual([{ r: 0, c: 0, rs: 1, cs: 3 }]);
    g = addCol(g, 350); // right of the merge: untouched
    expect(g.merges).toEqual([{ r: 0, c: 0, rs: 1, cs: 3 }]);
    g = removeCol(g, 1);
    expect(g.merges).toEqual([{ r: 0, c: 0, rs: 1, cs: 2 }]);
    g = removeCol(g, 1);
    expect(g.merges).toEqual([]); // one cell left
  });

  it('row dividers shift merges below and header rows', () => {
    let g = setHeaderRows(merge(g0(), 2, 0, 3, 0), 2);
    g = addRow(g, 690); // inside header row 0
    expect(g.headerRows).toBe(3);
    expect(g.merges).toEqual([{ r: 3, c: 0, rs: 2, cs: 1 }]);
    g = removeRow(g, 1);
    expect(g.headerRows).toBe(2);
  });
});

describe('text', () => {
  it('assigns words to cells by centre; merged cells collect into the anchor', () => {
    const g = merge(setHeaderRows(g0(), 1), 0, 1, 0, 2);
    const cells = assignText(g, [
      word(105, 685, 'NPS'),
      word(205, 685, 'Dimensions', 60),
      word(270, 685, 'mm'), // centre in column 2: same merged cell
      word(105, 665, '1/2'),
      word(305, 665, '3.61'),
      word(450, 665, 'outside'),
    ]);
    expect(cells[0]).toEqual(['NPS', 'Dimensions mm', '']);
    expect(cells[1]).toEqual(['1/2', '', '3.61']);
  });

  it('multi-line cells: lines top to bottom, words left to right', () => {
    expect(
      joinWords([
        word(130, 600, 'neck'),
        word(100, 612, 'Flange'),
        word(140, 612, 'weld'),
        word(100, 600, 'with'),
      ]),
    ).toBe('Flange weld\nwith neck');
  });
});

describe('serialisation', () => {
  it('round-trips through JSON and refuses broken grids', () => {
    const g = merge(setHeaderRows(g0(), 1), 0, 0, 0, 1);
    expect(parseGrid(JSON.parse(JSON.stringify(g)))).toEqual(g);
    expect(parseGrid({ ...g, cols: [100, 90] })).toBeNull();
    expect(parseGrid({ ...g, rows: [600, 700] })).toBeNull();
    expect(parseGrid({ ...g, source: 'magic' })).toBeNull();
    expect(parseGrid({ ...g, merges: [{ r: 0 }] })).toBeNull();
    expect(parseGrid(null)).toBeNull();
    // Out-of-range merges are dropped, header rows clamped.
    expect(
      parseGrid({ ...g, headerRows: 9, merges: [{ r: 9, c: 0, rs: 2, cs: 2 }] }),
    ).toMatchObject({
      headerRows: 4,
      merges: [],
    });
  });
});
