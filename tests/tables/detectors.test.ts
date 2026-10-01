import { describe, expect, it } from 'vitest';
import { assignText } from '../../src/model/tableGrid';
import {
  cluster,
  coverage,
  gridInBox,
  mergesFromRulings,
  ruledRegions,
} from '../../src/workers/work/tables/lattice';
import { streamTables, toLines, type StreamWord } from '../../src/workers/work/tables/stream';

// M4-12 (§7.7): the detectors on synthetic input — ruling clusters, coverage,
// merges from missing rulings, ruled regions; stream lines, chunks, wrapped
// rows, side-by-side split, prose.

/** A word of `text` at (x, baseline y), 9 pt, ~5 pt per character. */
const w = (x: number, y: number, text: string, bold = false): StreamWord => ({
  x0: x,
  y0: y,
  x1: x + text.length * 5,
  y1: y + 9,
  text,
  bold,
  size: 9,
});
/** A line of words separated by single spaces. */
const phrase = (x: number, y: number, s: string, bold = false): StreamWord[] => {
  let cx = x;
  return s.split(' ').map((t) => {
    const word = w(cx, y, t, bold);
    cx = word.x1 + 2.5;
    return word;
  });
};

describe('lattice helpers', () => {
  it('clusters near values and measures coverage', () => {
    expect(cluster([10, 11, 50, 49.5, 100])).toEqual([10.5, 49.75, 100]);
    expect(
      coverage(
        [
          { at: 0, from: 0, to: 5 },
          { at: 0, from: 4, to: 8 },
        ],
        0,
        10,
      ),
    ).toBeCloseTo(0.8);
  });

  it('a 2 × 2 grid with the top row merged; ruled regions skip a plain frame', () => {
    // Table: x 0–200 (divider 100), y 0–40 (divider 20); the top row has no middle ruling.
    const segs = new Float32Array([
      0,
      40,
      200,
      40,
      0,
      20,
      200,
      20,
      0,
      0,
      200,
      0, // horizontals
      0,
      0,
      0,
      40,
      200,
      0,
      200,
      40,
      100,
      0,
      100,
      20, // verticals (middle only in the bottom row)
      300,
      300,
      500,
      300,
      300,
      400,
      500,
      400,
      300,
      300,
      300,
      400,
      500,
      300,
      500,
      400, // a frame
    ]);
    expect(ruledRegions(segs)).toEqual([[0, 0, 200, 40]]);
    const g = gridInBox(0, [0, 0, 200, 40], segs);
    expect(g?.cols).toEqual([0, 100, 200]);
    expect(g?.rows).toEqual([40, 20, 0]);
    expect(g?.merges).toEqual([{ r: 0, c: 0, rs: 1, cs: 2 }]);
  });

  it('merges are rectangles only', () => {
    const h = [
      { at: 30, from: 0, to: 30 },
      { at: 0, from: 0, to: 30 },
    ];
    const v = [
      { at: 0, from: 0, to: 30 },
      { at: 30, from: 0, to: 30 },
    ];
    // 3 × 3 with no inner rulings: one 3 × 3 merge.
    expect(mergesFromRulings([0, 10, 20, 30], [30, 20, 10, 0], h, v)).toEqual([
      { r: 0, c: 0, rs: 3, cs: 3 },
    ]);
  });
});

describe('stream detector', () => {
  it('lines and chunks: spaces join words, wide gaps split columns', () => {
    const [line] = toLines([...phrase(60, 700, 'Flange weld neck'), w(200, 700, 'A105')]);
    expect(line?.chunks.map((c) => c.words.map((x) => x.text).join(' '))).toEqual([
      'Flange weld neck',
      'A105',
    ]);
  });

  it('a table with a wrapped cell; titles and prose are not rows', () => {
    const words = [
      ...phrase(60, 760, 'Parts list title line', true),
      ...[
        ['ITEM', 'NAME', 'QTY'],
        ['1', 'Bolt', '4'],
        ['2', 'Long', '2'],
        ['3', 'Nut', '8'],
      ].flatMap((row, r) => row.map((t, c) => w(60 + c * 80, 730 - r * 18, t, r === 0))),
      w(140, 683, 'name'), // wraps the "Long" cell (row 2)
      ...phrase(60, 640, 'A closing remark in prose that is not part of the table.'),
    ];
    const [t, ...rest] = streamTables(0, words);
    expect(rest).toEqual([]);
    expect(t?.cols).toHaveLength(4);
    const cells = t ? assignText(t, words) : [];
    expect(cells.map((r) => r.join('|'))).toEqual([
      'ITEM|NAME|QTY',
      '1|Bolt|4',
      '2|Long\\nname|2'.replace('\\n', '\n'),
      '3|Nut|8',
    ]);
  });

  it('two tables side by side with their own rows are two tables; prose is none', () => {
    const left = [
      ['Size', 'Nm'],
      ['M12', '85'],
      ['M16', '210'],
      ['M20', '410'],
    ].flatMap((row, r) => row.map((t, c) => w(60 + c * 60, 740 - r * 18, t)));
    const right = [
      ['Type', 'mm'],
      ['A', '4.5'],
      ['B', '8.0'],
      ['C', '1.5'],
      ['D', '3.0'],
    ].flatMap((row, r) => row.map((t, c) => w(330 + c * 60, 736 - r * 13, t)));
    expect(streamTables(0, [...left, ...right])).toHaveLength(2);
    expect(
      streamTables(
        0,
        [0, 1, 2, 3].flatMap((i) => phrase(60, 700 - i * 14, 'Plain text in one column only.')),
      ),
    ).toEqual([]);
  });
});
