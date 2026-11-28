// M14-10 (D-76, plan M14 §10, Q32): the measurements export's fixed layout —
// real numbers with their scale's decimals and units, totals per group (real
// and at paper size apart, spanning ones left out), CSV's rows, the stamp of
// an attached copy — and the workbook read back with ExcelJS.
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  csvLines,
  csvText,
  decimalsOf,
  excelDate,
  exportBook,
  exportStamp,
  MEASURE_COLUMNS,
  numberFormat,
  readStamp,
  TOTAL_COLUMNS,
  unitText,
  type ExportItem,
  type ExportWords,
} from '../../src/model/measureExport';
import {
  groupMeasurements,
  measureEntry,
  type MeasureEntryInput,
} from '../../src/model/measureList';
import { MM_PER_POINT, type Scale } from '../../src/model/scale';
import { buildMeasureBook } from '../../src/workers/work/measureWorkbook';

const mm = (v: number): number => v / MM_PER_POINT;
const s100: Scale = { paper: 1, real: 100, unit: 'm', precision: 2 };
const s5: Scale = { paper: 1, real: 5, unit: 'mm', precision: 1 };
const ft: Scale = { paper: 1, real: 48, unit: 'ft', precision: 2, ftIn: 16 };

const line = (paperMm: number) => [
  { x: 100, y: 100 },
  { x: 100 + mm(paperMm), y: 100 },
];
const rect = (w: number, h: number) => [
  { x: 100, y: 100 },
  { x: 100 + mm(w), y: 100 },
  { x: 100 + mm(w), y: 100 + mm(h) },
  { x: 100, y: 100 + mm(h) },
];

let n = 0;
const entry = (o: Partial<MeasureEntryInput>) =>
  measureEntry({
    id: `m${String(++n)}`,
    page: 0,
    tool: 'length',
    points: line(10),
    scale: s100,
    spans: null,
    where: '',
    at: { x: 0, y: n },
    ...o,
  });

const WORDS: ExportWords = {
  measurementsSheet: 'Measurements',
  totalsSheet: 'Totals',
  measurementsTitle: 'Measurements — plan.pdf',
  totalsTitle: 'Totals — plan.pdf',
  columns: {
    number: 'No.',
    page: 'Page',
    area: 'Scale area',
    tool: 'Tool',
    group: 'Group or label',
    value: 'Value',
    unit: 'Unit',
    depth: 'Depth',
    scale: 'Scale',
    author: 'Author',
    date: 'Date',
  },
  picture: 'Picture',
  totalColumns: { group: 'Group', count: 'Count', total: 'Total', unit: 'Unit', note: 'Note' },
  tool: (t) => `${t.charAt(0).toUpperCase()}${t.slice(1)}`,
  atPaper: (name) => `${name} (at paper size)`,
  leftOut: (k) => `${String(k)} not in the total (spans 2 scales)`,
  noTotal: 'No total',
};

const item = (e: ReturnType<typeof entry>, o: Partial<ExportItem> = {}): ExportItem => ({
  entry: e,
  area: 'Page',
  scale: '1 : 100',
  group: '',
  depth: null,
  author: 'Ana',
  date: new Date(2026, 10, 28, 14, 5),
  region: { page: e.page, x: 10, y: 20, width: 30, height: 4 },
  ...o,
});

function sample() {
  const a = entry({ points: line(20) }); // 2.00 m
  const b = entry({ points: line(35), label: 'Wall W2' }); // 3.50 m
  const c = entry({ points: line(10), scale: null }); // paper size 10.0 mm
  const d = entry({ points: line(10), spans: ['Detail A', '(page)'] }); // no value
  const e = entry({ tool: 'area', points: rect(30, 20) }); // 6.00 m²
  const groups = groupMeasurements([a, b, c, d, e]);
  const items = groups.flatMap((g) => g.entries).map((x) => item(x, { group: x.label }));
  return { groups, items, book: exportBook(groups, items, WORDS, false) };
}

describe('the measurements sheet (M14-10, Q32)', () => {
  it('has the fixed columns in order', () => {
    const { book } = sample();
    expect(book.sheets[0]?.columns).toEqual(MEASURE_COLUMNS.map((c) => WORDS.columns[c]));
    expect(book.sheets[1]?.columns).toEqual(TOTAL_COLUMNS.map((c) => WORDS.totalColumns[c]));
  });

  it('writes values as real numbers with the scale decimals and unit', () => {
    const { book } = sample();
    const rows = book.sheets[0]?.rows ?? [];
    const col = (c: (typeof MEASURE_COLUMNS)[number]) => MEASURE_COLUMNS.indexOf(c);
    expect(rows[0]?.[col('number')]).toEqual({ n: 1, fmt: '0' });
    expect(rows[0]?.[col('page')]).toEqual({ n: 1, fmt: '0' });
    const v = rows[0]?.[col('value')] as { n: number; fmt: string };
    // Exact: the floating-point noise of the point maths is gone (2, not 1.9999999999999996).
    expect(v.n).toBe(2);
    expect(v.fmt).toBe('0.00');
    expect(rows[0]?.[col('unit')]).toBe('m');
    expect(rows[1]?.[col('group')]).toBe('Wall W2');
    // Paper size: millimetres, one decimal.
    const paper = rows[2]?.[col('value')] as { n: number; fmt: string };
    expect(paper.n).toBeCloseTo(10, 6);
    expect(paper.fmt).toBe('0.0');
    expect(rows[2]?.[col('unit')]).toBe('mm');
    // Spanning two scales: no number, no unit (Q30).
    expect(rows[3]?.[col('value')]).toBeNull();
    expect(rows[3]?.[col('unit')]).toBe('');
    // The area: m².
    expect(rows[4]?.[col('tool')]).toBe('Area');
    expect((rows[4]?.[col('value')] as { n: number }).n).toBeCloseTo(6, 9);
    expect(rows[4]?.[col('unit')]).toBe('m²');
    expect(rows[4]?.[col('date')]).toEqual({ date: excelDate(new Date(2026, 10, 28, 14, 5)) });
  });

  it('adds a Picture column only when asked', () => {
    const { groups, items } = sample();
    const book = exportBook(groups, items, WORDS, true);
    const s = book.sheets[0];
    expect(s?.columns.at(-1)).toBe('Picture');
    expect(s?.pictureColumn).toBe(MEASURE_COLUMNS.length);
    expect(s?.rows[0]).toHaveLength(MEASURE_COLUMNS.length + 1);
  });

  it('shows feet decimals at least to hundredths, and dates in local time', () => {
    expect(decimalsOf({ ...ft, precision: 0 }, 'length')).toBe(2);
    expect(decimalsOf(s5, 'length')).toBe(1);
    expect(numberFormat(0)).toBe('0');
    expect(numberFormat(3)).toBe('0.000');
    expect(unitText(s5, 'area')).toBe('mm²');
    // 1 January 2026, 00:00 local → Excel serial 46023.
    expect(excelDate(new Date(2026, 0, 1))).toBeCloseTo(46023, 9);
  });
});

describe('the totals sheet (M14-10)', () => {
  it('keeps real totals, paper-size totals and left-out ones apart', () => {
    const { book } = sample();
    const rows = book.sheets[1]?.rows ?? [];
    expect(rows).toHaveLength(3);
    const [real, paper, area] = rows;
    expect(real?.[0]).toBe('Length');
    expect(real?.[1]).toEqual({ n: 2, fmt: '0' });
    expect((real?.[2] as { n: number }).n).toBe(5.5);
    expect(real?.[3]).toBe('m');
    expect(real?.[4]).toBe('1 not in the total (spans 2 scales)');
    expect(paper?.[0]).toBe('Length (at paper size)');
    expect((paper?.[2] as { n: number }).n).toBeCloseTo(10, 6);
    expect(paper?.[3]).toBe('mm');
    expect(area?.[0]).toBe('Area');
    expect(area?.[3]).toBe('m²');
  });
});

describe('CSV of the measurements (M14-10)', () => {
  it('has the titles and the rows, numbers with a point, no pictures', () => {
    const { groups, items } = sample();
    const lines = csvLines(exportBook(groups, items, WORDS, true));
    expect(lines[0]).toEqual(MEASURE_COLUMNS.map((c) => WORDS.columns[c]));
    expect(lines[1]?.[5]).toBe('2.00');
    expect(lines[1]?.[10]).toBe('2026-11-28 14:05');
    expect(lines[4]?.[5]).toBe('');
    expect(lines).toHaveLength(6);
    expect(csvText({ n: 3.14159, fmt: '0.0' })).toBe('3.1');
  });
});

describe('the stamp of an attached copy (Q18)', () => {
  it('changes with the measurements, not with the title', () => {
    const { groups, items, book } = sample();
    const again = exportBook(groups, items, { ...WORDS, measurementsTitle: 'Another day' }, false);
    const all = { pictures: false, scope: { all: true } } as const;
    expect(exportStamp(again, all)).toBe(exportStamp(book, all));
    const moved = exportBook(
      groups,
      items.map((x, i) => (i === 0 ? { ...x, author: 'Ben' } : x)),
      WORDS,
      false,
    );
    expect(exportStamp(moved, all)).not.toBe(exportStamp(book, all));
    // A value that differs past its shown decimals (a reopened file's float32 points) matches.
    const nudged = exportBook(
      groups,
      items.map((x, i) =>
        i === 0 ? { ...x, entry: { ...x.entry, value: (x.entry.value ?? 0) + 1e-7 } } : x,
      ),
      WORDS,
      false,
    );
    expect(exportStamp(nudged, all)).toBe(exportStamp(book, all));
    expect(
      readStamp(exportStamp(book, { pictures: true, scope: { all: false, page: 3 } })),
    ).toEqual({ pictures: true, scope: { all: false, page: 3 } });
    expect(readStamp(exportStamp(book, all))).toEqual(all);
    expect(readStamp('something else')).toBeNull();
  });
});

// A 2 × 2 white PNG.
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4//8/AxJgYmBgAAAhAgH+0sVhLwAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
).buffer;

describe('the workbook read back (M14-10)', () => {
  it('has both sheets, real numbers and dates, and pictures in their column', async () => {
    const { groups, items } = sample();
    const spec = exportBook(groups, items, WORDS, true);
    const done: number[] = [];
    const bytes = await buildMeasureBook(
      ExcelJS,
      spec,
      (i) => Promise.resolve(i === 1 ? null : { png: PNG, width: 120, height: 80 }),
      () => Promise.resolve(),
      (d) => done.push(d),
    );
    expect(done.at(-1)).toBe(5);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Measurements', 'Totals']);
    const ws = wb.getWorksheet('Measurements');
    if (!ws) throw new Error('no sheet');
    expect(ws.getCell('A1').value).toBe('Measurements — plan.pdf');
    expect(ws.getRow(3).getCell(1).value).toBe('No.');
    const first = ws.getRow(4);
    expect(first.getCell(1).value).toBe(1);
    expect(first.getCell(6).value).toBeCloseTo(2, 9);
    expect(first.getCell(6).numFmt).toBe('0.00');
    expect(first.getCell(7).value).toBe('m');
    expect(first.getCell(11).numFmt).toBe('yyyy-mm-dd hh:mm');
    expect(
      typeof first.getCell(11).value === 'number' || first.getCell(11).value instanceof Date,
    ).toBe(true);
    const images = ws.getImages();
    expect(images).toHaveLength(4);
    expect(images.every((im) => Math.floor(im.range.tl.col) === MEASURE_COLUMNS.length)).toBe(true);
    const totals = wb.getWorksheet('Totals');
    expect(totals?.getRow(4).getCell(1).value).toBe('Length');
    expect(totals?.getRow(4).getCell(3).value).toBeCloseTo(5.5, 9);
  });

  it('stops between rows when cancelled', async () => {
    const { groups, items } = sample();
    let k = 0;
    await expect(
      buildMeasureBook(
        ExcelJS,
        exportBook(groups, items, WORDS, false),
        null,
        () => (++k > 2 ? Promise.reject(new Error('cancelled')) : Promise.resolve()),
        () => undefined,
      ),
    ).rejects.toThrow('cancelled');
  });
});
