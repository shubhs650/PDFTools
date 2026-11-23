// The change register (M12-21, D-65, Q34): one row per difference the list
// shows, in its order, with number, sheet or page, kind, old, new, percent
// and checked; a column set per comparison type; the CSV and workbook cells.
// TDD on self-made entries.
import { describe, expect, it } from 'vitest';
import type { DiffEntry } from '../../src/model/compare/detect/entries';
import type { TextChange } from '../../src/model/compare/text/match';
import {
  MAX_CELL,
  OVERLAY_COLUMNS,
  TEXT_COLUMNS,
  overlayRegister,
  registerCells,
  textRegister,
  valuePercent,
  type RegisterLabels,
} from '../../src/model/compare/register';

const entry = (over: Partial<DiffEntry>): DiffEntry => ({
  key: 'k',
  kind: 'changed',
  type: 'text',
  box: [0, 0, 10, 10],
  removed: 4,
  added: 4,
  old: '',
  new: '',
  ...over,
});

const labels: RegisterLabels = {
  kind: (k) => `K:${k}`,
  type: (t) => `T:${t}`,
  page: (side, ref) => `${side}${String(ref.file)}/${String(ref.page + 1)}`,
  yes: 'Yes',
  notes: (c) => (c.table ? [`row ${c.table.row}`] : []),
};

describe('valuePercent: the change of a value written as one number', () => {
  it('compares one number with one number', () => {
    expect(valuePercent('Ø120', 'Ø128')).toBe(6.67);
    expect(valuePercent('1,450.00', '1,500.00')).toBe(3.45);
    expect(valuePercent('6 mm', '3 mm')).toBe(-50);
  });

  it('gives nothing for words, several numbers, a missing side or an old 0', () => {
    expect(valuePercent('DOOR', 'WINDOW')).toBeNull();
    expect(valuePercent('120 x 80', '128 x 80')).toBeNull();
    expect(valuePercent('', '128')).toBeNull();
    expect(valuePercent('0', '5')).toBeNull();
    // Tags compare only when their letters agree.
    expect(valuePercent('M12', 'Ø16')).toBeNull();
  });

  it('rounds to two decimals', () => {
    expect(valuePercent('3', '4')).toBe(33.33);
  });
});

describe('overlayRegister: the differences of a PDF overlay', () => {
  const sheets = [
    { a: { file: 0, page: 0 }, b: { file: 0, page: 0 } },
    { a: null, b: { file: 1, page: 2 } },
    { a: { file: 0, page: 1 }, b: { file: 1, page: 0 } },
  ];

  it('numbers the rows in the list order and names sheet and pages', () => {
    const rows = overlayRegister(
      [
        {
          id: '0|a',
          sheet: 0,
          entry: entry({ kind: 'changed', type: 'text', old: 'Ø120', new: 'Ø128' }),
        },
        { id: '2|b', sheet: 2, entry: entry({ kind: 'added', type: 'geometry' }) },
      ],
      sheets,
      new Set(['2|b']),
      labels,
    );
    expect(rows).toEqual([
      ['1', '1', 'a0/1', 'b0/1', 'K:changed', 'T:text', 'Ø120', 'Ø128', '6.67', ''],
      ['2', '3', 'a0/2', 'b1/1', 'K:added', 'T:geometry', '', '', '', 'Yes'],
    ]);
    expect(rows[0]).toHaveLength(OVERLAY_COLUMNS.length);
  });

  it('leaves the page of a side that has none empty', () => {
    const rows = overlayRegister(
      [{ id: '1|c', sheet: 1, entry: entry({ kind: 'added' }) }],
      sheets,
      new Set(),
      labels,
    );
    expect(rows[0]?.slice(1, 4)).toEqual(['2', '', 'b1/3']);
  });

  it('cuts a very long text to what a spreadsheet cell holds', () => {
    const long = 'x'.repeat(MAX_CELL + 50);
    const rows = overlayRegister(
      [{ id: '0|d', sheet: 0, entry: entry({ old: long }) }],
      sheets,
      new Set(),
      labels,
    );
    expect(rows[0]?.[6]).toHaveLength(MAX_CELL);
    expect(rows[0]?.[6]?.endsWith('…')).toBe(true);
  });
});

describe('textRegister: the changes of a text comparison', () => {
  const span = (page: number, text: string) => ({ page, t0: 0, t1: 1, text, rects: [] });
  const changes: TextChange[] = [
    { kind: 'replaced', a: span(0, '1,450.00'), b: span(1, '1,500.00'), pct: 3.45 },
    { kind: 'deleted', a: span(2, 'Old clause.') },
    { kind: 'inserted', b: span(3, 'New clause.'), table: { row: '4' } },
  ] as unknown as TextChange[];

  it('maps the compared pages to the documents’ pages and keeps the order given', () => {
    const rows = textRegister(
      changes.map((change, i) => ({ key: ['r', 'd', 'i'][i] ?? '', change })),
      { a: (p) => [4, 5, 6][p], b: (p) => [0, 1, 2, 7][p] },
      new Set(['d']),
      labels,
    );
    expect(rows).toEqual([
      ['1', 'a0/5', 'b0/2', 'K:replaced', '1,450.00', '1,500.00', '3.45', '', ''],
      ['2', 'a0/7', '', 'K:deleted', 'Old clause.', '', '', '', 'Yes'],
      ['3', '', 'b0/8', 'K:inserted', '', 'New clause.', '', 'row 4', ''],
    ]);
    expect(rows[0]).toHaveLength(TEXT_COLUMNS.length);
  });

  it('works out the percent from the texts when the engine gave none', () => {
    const rows = textRegister(
      [
        {
          key: 'r',
          change: {
            kind: 'replaced',
            a: span(0, '200'),
            b: span(0, '250'),
          } as unknown as TextChange,
        },
      ],
      { a: (p) => p, b: (p) => p },
      new Set(),
      labels,
    );
    expect(rows[0]?.[6]).toBe('25');
  });
});

describe('registerCells: what a spreadsheet takes as numbers', () => {
  it('marks the number, sheet and percent columns as numbers', () => {
    expect(registerCells('overlay').numberColumns).toEqual([0, 1, 8]);
    expect(registerCells('text').numberColumns).toEqual([0, 6]);
  });

  it('lists the columns in the order of the rows', () => {
    expect(registerCells('overlay').columns).toEqual(OVERLAY_COLUMNS);
    expect(registerCells('text').columns).toEqual(TEXT_COLUMNS);
  });
});

describe('the register as a workbook (the CRS builder, ExcelJS read back)', () => {
  it('writes the number, sheet and percent as numbers and keeps texts as texts', async () => {
    const { default: ExcelJS } = await import('exceljs');
    const { buildWorkbook } = await import('../../src/workers/work/crsWorkbook');
    const rows = overlayRegister(
      [
        {
          id: '0|a',
          sheet: 0,
          entry: entry({ old: 'Ø120', new: 'Ø128' }),
        },
        { id: '0|b', sheet: 0, entry: entry({ old: '=SUM(A1)', new: '12' }) },
      ],
      [{ a: { file: 0, page: 0 }, b: { file: 0, page: 0 } }],
      new Set(),
      labels,
    );
    const { columns, numberColumns } = registerCells('overlay');
    const buf = await buildWorkbook(
      ExcelJS,
      {
        sheetName: 'Changes',
        title: 'Change register',
        header: [['Comparison', 'PDF Overlay']],
        columns: [...columns],
        snapshotColumn: -1,
        rows,
        widths: columns.map(() => 12),
        numberColumns,
      },
      null,
      () => Promise.resolve(),
      () => undefined,
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet('Changes');
    // Title, one header line, a blank line, the column titles, then the rows.
    const first = ws?.getRow(5);
    expect(first?.getCell(1).value).toBe(1);
    expect(first?.getCell(2).value).toBe(1);
    expect(first?.getCell(7).value).toBe('Ø120');
    expect(first?.getCell(9).value).toBe(6.67);
    // A formula-looking text is a string, never a formula.
    expect(ws?.getRow(6).getCell(7).value).toBe('=SUM(A1)');
  });
});
