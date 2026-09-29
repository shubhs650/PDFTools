// M3-19 (ADR-015 d2): the CRS workbook built with ExcelJS and read back —
// title merged across the columns, the header block, the §7.5 column titles,
// one image anchored in the Snapshot column of each row, and cancel.
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildWorkbook, type WorkbookSpec } from '../../src/workers/work/crsWorkbook';

// A 2 × 2 white PNG.
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4//8/AxJgYmBgAAAhAgH+0sVhLwAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
).buffer;

const columns = [
  'No.',
  'Page',
  'Location/Type',
  'Reviewer',
  'Discipline',
  'Comment',
  'Replies',
  'Status',
  'Snapshot',
  'Vendor Response',
  'Final Status',
];

const spec = (rows: number): WorkbookSpec => ({
  sheetName: 'CRS',
  title: 'Comment Review Sheet — Pump P-101',
  header: [
    ['Document number', 'DOC-001'],
    ['Revision', 'B'],
    ['Reviewer', 'Ana de Vries'],
  ],
  columns,
  snapshotColumn: 8,
  rows: Array.from({ length: rows }, (_, i) => [
    String(i + 1),
    '1',
    'Highlight',
    'Ana',
    'Piping',
    `=cmd ${String(i)}`,
    '',
    'Accepted',
    '',
    '',
    '',
  ]),
});

const noop = () => Promise.resolve();

describe('CRS workbook', () => {
  it('reads back: merged title, header block, columns, images in the Snapshot column', async () => {
    const buf = await buildWorkbook(
      ExcelJS,
      spec(5),
      () => Promise.resolve({ png: PNG, width: 120, height: 80 }),
      noop,
      () => undefined,
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet('CRS');
    if (!ws) throw new Error('no sheet');
    expect(ws.getCell('A1').value).toBe('Comment Review Sheet — Pump P-101');
    expect(ws.getCell('K1').isMerged).toBe(true);
    expect(ws.getCell('A2').value).toBe('Document number');
    expect(ws.getCell('B2').value).toBe('DOC-001');
    const headRow = ws.getRow(6);
    expect(columns.map((_, i) => headRow.getCell(i + 1).value)).toEqual(columns);
    expect(ws.getCell('A7').value).toBe(1);
    // Text stays text: a comment that looks like a formula is not one.
    expect(ws.getCell('F7').value).toBe('=cmd 0');
    const images = ws.getImages();
    expect(images).toHaveLength(5);
    for (const [i, img] of images.entries()) {
      expect(Math.floor(img.range.tl.col)).toBe(8);
      expect(Math.floor(img.range.tl.row)).toBe(6 + i);
    }
    expect(ws.getRow(7).height).toBeGreaterThan(60);
  });

  it('without snapshots: no images; a cancelled build stops between rows', async () => {
    const buf = await buildWorkbook(ExcelJS, spec(3), null, noop, () => undefined);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    expect(wb.getWorksheet('CRS')?.getImages()).toHaveLength(0);
    let done = 0;
    const cancelled = buildWorkbook(
      ExcelJS,
      spec(100),
      null,
      () => (done >= 10 ? Promise.reject(new Error('cancelled')) : Promise.resolve()),
      (n) => {
        done = n;
      },
    );
    await expect(cancelled).rejects.toThrow('cancelled');
    expect(done).toBe(10);
  });
});
