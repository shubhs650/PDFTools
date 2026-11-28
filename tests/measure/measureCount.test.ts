// M14-07 (D-75, plan M14 §7, Q11, Q14, Q15): Count's numbering and Renumber
// group, group names, the count's Triya data and `measure` field, its place in
// the Measurements pane's groups, the export and the summary, and the
// same-size numbers' label size. Written before the code they test.
import { describe, expect, it } from 'vitest';
import { labelPx, COUNT_LABEL_PX } from '../../src/features/measure/countNumbers';
import { parseCountGroups } from '../../src/features/measure/countGroups';
import { createFormatters } from '../../src/i18n/format';
import {
  cleanGroupName,
  countBounds,
  countCaption,
  countSymbol,
  COUNT_SHAPES,
  groupOf,
  hasGaps,
  MAX_GROUP_NAME,
  nextNumber,
  placeOnPage,
  renumber,
  sameGroupName,
  symbolBounds,
  type Counted,
} from '../../src/model/measureCount';
import { entryFromPdf, entryToPdf, metaFromEntry } from '../../src/model/measureData';
import { itemCells, totalRows, type ExportWords } from '../../src/model/measureExport';
import {
  groupMeasurements,
  measureEntry,
  type MeasureEntryInput,
} from '../../src/model/measureList';
import { metaOf, sameMeta, type MeasureMeta } from '../../src/model/measureMarkup';
import { summaryRows, type SummaryWords } from '../../src/model/measureSummary';
import type { Scale } from '../../src/model/scale';

const en = createFormatters('en-US');
const s100: Scale = { paper: 1, real: 100, unit: 'm', precision: 2 };

const c = (id: string, n: number, page = 0, x = 0, y = 0): Counted => ({
  id,
  n,
  page,
  at: { x, y },
});

describe('numbering (Q15)', () => {
  it('starts at 1 and takes the highest number plus one', () => {
    expect(nextNumber([])).toBe(1);
    expect(nextNumber([1, 2, 3])).toBe(4);
  });

  it('leaves a deleted count’s gap: the next is the highest plus one', () => {
    expect(nextNumber([1, 2, 4])).toBe(5);
    expect(nextNumber([7])).toBe(8);
  });

  it('ignores numbers that are not numbers', () => {
    expect(nextNumber([Number.NaN, 2, Number.POSITIVE_INFINITY])).toBe(3);
  });
});

describe('Renumber group (Q15)', () => {
  it('closes the gaps in number order and returns only the counts that change', () => {
    expect(renumber([c('a', 1), c('b', 3), c('c', 6)])).toEqual([
      { id: 'b', n: 2 },
      { id: 'c', n: 3 },
    ]);
  });

  it('changes nothing when there are no gaps', () => {
    expect(renumber([c('a', 2), c('b', 1), c('c', 3)])).toEqual([]);
    expect(hasGaps([c('a', 1), c('b', 2)])).toBe(false);
  });

  it('runs across pages: numbers are per group, not per page', () => {
    const out = renumber([c('p2', 5, 1), c('p1', 2, 0), c('p3', 9, 2)]);
    expect(out).toEqual([
      { id: 'p1', n: 1 },
      { id: 'p2', n: 2 },
      { id: 'p3', n: 3 },
    ]);
  });

  it('splits shared numbers by page, then top to bottom, then left to right', () => {
    const out = renumber([
      c('right', 1, 0, 200, 100),
      c('left', 1, 0, 100, 100),
      c('lower', 1, 0, 50, 300),
      c('earlier', 1, 0, 900, 50),
    ]);
    expect(out).toEqual([
      { id: 'left', n: 2 },
      { id: 'right', n: 3 },
      { id: 'lower', n: 4 },
    ]);
    expect(hasGaps([c('a', 1), c('b', 1)])).toBe(true);
  });

  it('then the next count takes the next number', () => {
    const counts = [c('a', 1), c('b', 3), c('c', 6)];
    const changed = new Map(renumber(counts).map((r) => [r.id, r.n]));
    expect(nextNumber(counts.map((x) => changed.get(x.id) ?? x.n))).toBe(4);
  });
});

describe('groups (Q14)', () => {
  it('cleans a name: trimmed, single spaces, capped', () => {
    expect(cleanGroupName('  Fire   door ')).toBe('Fire door');
    expect(Array.from(cleanGroupName('x'.repeat(200)))).toHaveLength(MAX_GROUP_NAME);
  });

  it('compares names ignoring case and spacing', () => {
    expect(sameGroupName('Door', ' door ')).toBe(true);
    expect(sameGroupName('Door', 'Doors')).toBe(false);
  });

  it('reads only well-formed groups, the size kept in range', () => {
    expect(groupOf({ name: 'Door', shape: 'square', color: '#0055cc', size: 12 })).toEqual({
      name: 'Door',
      shape: 'square',
      color: '#0055cc',
      size: 12,
    });
    expect(groupOf({ name: 'Door', shape: 'star', color: '#0055cc', size: 12 })).toBeNull();
    expect(groupOf({ name: ' ', shape: 'circle', color: '#0055cc', size: 12 })).toBeNull();
    expect(groupOf({ name: 'Door', shape: 'circle', color: 'red', size: 12 })).toBeNull();
    expect(groupOf({ name: 'Big', shape: 'circle', color: '#000000', size: 500 })?.size).toBe(72);
  });

  it('keeps the device’s groups and the last used, dropping bad and repeated ones', () => {
    const raw = JSON.stringify({
      groups: [
        { name: 'Door', shape: 'circle', color: '#d13438', size: 12 },
        { name: 'door', shape: 'square', color: '#0078d4', size: 10 },
        { name: 'Bad', shape: 'blob', color: '#000000', size: 10 },
        { name: 'Window', shape: 'diamond', color: '#107c10', size: 16 },
      ],
      current: ' Window ',
    });
    const s = parseCountGroups(raw);
    expect(s.groups.map((g) => g.name)).toEqual(['Door', 'Window']);
    expect(s.current).toBe('Window');
    expect(parseCountGroups('not json')).toEqual({ groups: [], current: '' });
    expect(parseCountGroups(null)).toEqual({ groups: [], current: '' });
  });
});

describe('symbol and number (D-75)', () => {
  it('draws every shape inside its size', () => {
    for (const shape of COUNT_SHAPES) {
      const sym = countSymbol(shape, { x: 100, y: 100 }, 12, 1);
      const pts = [...sym.closed.flat(), ...sym.open.flat()];
      for (const p of pts) {
        expect(Math.abs(p.x - 100)).toBeLessThanOrEqual(6.01);
        expect(Math.abs(p.y - 100)).toBeLessThanOrEqual(6.01);
      }
      if (sym.circle) expect(sym.circle.r).toBeLessThanOrEqual(6);
      expect(pts.length > 0 || sym.circle !== null).toBe(true);
    }
  });

  it('puts the number beside the symbol, to the right, and bounds both', () => {
    const box = countCaption({ x: 100, y: 50 }, 12, 30, 12);
    expect(box.angle).toBe(0);
    expect(box.at.x - 15).toBeGreaterThan(106);
    expect(box.at.y).toBe(50);
    const all = countBounds({ x: 100, y: 50 }, 12, [box.at.x - 15, 44, box.at.x + 15, 56]);
    expect(all[0]).toBe(symbolBounds({ x: 100, y: 50 }, 12)[0]);
    expect(all[2]).toBe(box.at.x + 15);
  });

  it('keeps a symbol clicked at the edge on the page', () => {
    expect(placeOnPage({ x: 1, y: 799 }, 12, { width: 600, height: 800 })).toEqual({
      x: 6,
      y: 794,
    });
  });
});

describe('the count’s data', () => {
  const meta: MeasureMeta = {
    tool: 'count',
    group: 'Door',
    n: 7,
    sym: 'triangle',
    size: 16,
    hideN: true,
    pts: [{ x: 120, y: 80 }],
  };

  it('reads its `measure` field: one point, group, number, symbol, size, number hidden', () => {
    expect(metaOf({ measure: meta })).toEqual(meta);
    expect(metaOf({ measure: { ...meta, n: 0, sym: 'blob', size: 'x' } })).toEqual({
      tool: 'count',
      group: 'Door',
      hideN: true,
      pts: [{ x: 120, y: 80 }],
    });
    expect(sameMeta(meta, { ...meta })).toBe(true);
    expect(sameMeta(meta, { ...meta, n: 8 })).toBe(false);
    expect(sameMeta(meta, { ...meta, group: 'Window' })).toBe(false);
  });

  it('round-trips its Triya data (/G /N /Sy /Sz /Hn and its centre)', () => {
    const { pts, ...rest } = meta;
    const entry = {
      meta: rest,
      fp: 'fp',
      curve: { pts: pts ?? [], rect: [110, 70, 150, 90] as [number, number, number, number] },
    };
    const back = entryFromPdf(entryToPdf(entry));
    expect(back?.meta).toEqual(rest);
    expect(back?.curve?.pts).toEqual(pts);
    expect(metaFromEntry(back ?? entry, 'fp').tool).toBe('count');
  });
});

const count = (id: string, group: string, n: number, page = 0): MeasureEntryInput => ({
  id,
  page,
  tool: 'count',
  points: [{ x: 10 * n, y: 10 }],
  scale: s100,
  spans: null,
  where: 'No scale needed',
  at: { x: 10 * n, y: 10 },
  group,
  n,
});

describe('the Measurements pane, export and summary', () => {
  const entries = [
    measureEntry(count('d2', 'Door', 2)),
    measureEntry(count('w1', 'Window', 1, 1)),
    measureEntry(count('d1', 'door', 1, 1)),
    measureEntry(count('d4', 'Door', 4)),
  ];

  it('makes one group per count group, by name (case ignored), in number order', () => {
    const groups = groupMeasurements(entries);
    expect(groups.map((g) => [g.group, g.entries.map((e) => e.n)])).toEqual([
      ['door', [1, 2, 4]],
      ['Window', [1]],
    ]);
    expect(groups[0]?.total).toEqual({ real: null, paper: null, left: 0 });
    // A count is never at paper size and never spans scales.
    expect(entries.every((e) => !e.paper && !e.spans)).toBe(true);
    expect(entries[0]?.value).toBe(2);
  });

  it('keeps a group to one page for This page', () => {
    const groups = groupMeasurements(entries, { page: 0 });
    expect(groups.map((g) => [g.group, g.entries.length])).toEqual([['Door', 2]]);
  });

  it('exports a count’s number with no unit, and its group’s count as its total', () => {
    const words: ExportWords = {
      measurementsSheet: 'M',
      totalsSheet: 'T',
      measurementsTitle: 'M',
      totalsTitle: 'T',
      columns: {
        number: 'No.',
        page: 'Page',
        area: 'Area',
        tool: 'Tool',
        group: 'Group',
        value: 'Value',
        unit: 'Unit',
        depth: 'Depth',
        scale: 'Scale',
        author: 'Author',
        date: 'Date',
      },
      picture: 'Picture',
      totalColumns: { group: 'Group', count: 'Count', total: 'Total', unit: 'Unit', note: 'Note' },
      tool: () => 'Count',
      atPaper: (n) => n,
      leftOut: () => '',
      noTotal: 'No total',
    };
    const e = entries[0];
    if (!e) throw new Error('missing');
    const cells = itemCells(
      {
        entry: e,
        area: '',
        scale: '',
        group: 'Door',
        author: '',
        date: null,
        region: { page: 0, x: 0, y: 0, width: 1, height: 1 },
      },
      1,
      'Count',
    );
    expect(cells).toContain('Door');
    expect(cells).toContainEqual({ n: 2, fmt: '0' });
    const rows = totalRows(groupMeasurements(entries), words);
    expect(rows[0]).toEqual(['door', { n: 3, fmt: '0' }, null, '', '']);
  });

  it('puts each count group in the summary with its count', () => {
    const words: SummaryWords = {
      head: ['All pages', 'Count', 'Total'],
      tool: (g) => g.group ?? g.tool,
      atPaper: (n) => n,
      leftOut: () => '',
      noTotal: 'No total',
      none: 'None',
    };
    expect(summaryRows(groupMeasurements(entries), words, en).slice(1)).toEqual([
      ['door', '3', ''],
      ['Window', '1', ''],
    ]);
  });
});

describe('same-size count numbers (screen only)', () => {
  it('labels only numbers drawn smaller than the label', () => {
    expect(labelPx(10, 2)).toBeNull();
    expect(labelPx(10, 1.1)).toBeNull();
    expect(labelPx(10, 0.5)).toBe(COUNT_LABEL_PX);
  });

  it('never grows a label past about 4× the number’s size on screen', () => {
    expect(labelPx(10, 0.1)).toBeCloseTo(4);
    expect(labelPx(10, 0.25)).toBe(Math.min(COUNT_LABEL_PX, 10));
    expect(labelPx(10, 0)).toBeNull();
  });
});
