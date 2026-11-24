// M13-07 (D-71, plan M13 §6, ADR-034 Amendment 1): a project template filled
// by the Work worker's engine and read back with ExcelJS — pre-drawn rows
// first, then inserted rows that copy the start row (C2, C3, C11), totals,
// print area, formatting, names, tables, notes and links following; detail
// cells; snapshots fitted to their column (C9); one sheet per group (C5, C15)
// with Sr. No. per sheet (C6); the write fixes; refusals, lost parts, Cancel
// and progress. Templates are self-made by script (rule 13).
import ExcelJS from 'exceljs';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  fillTemplate,
  fitSnapshot,
  TemplateError,
  type TemplateCell,
  type TemplateFillSpec,
  type TemplateSnapshot,
} from '../../src/workers/work/crsTemplate/fill';
import { inspectTemplate } from '../../src/workers/work/crsTemplate/inspect';
import { lostParts, workbookKind } from '../../src/workers/work/crsTemplate/kind';
import {
  A,
  asXlsm,
  asXltx,
  B,
  fakeXls,
  snapshotPng,
  templateA,
  templateB,
  withTextBox,
} from '../../e2e/fixtures/crsTemplates';

const noop = () => Promise.resolve();
const buf = (b: Uint8Array): ArrayBuffer => b.slice().buffer;

async function read(bytes: ArrayBuffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  return wb;
}

const xml = (b: ArrayBuffer, part: string) =>
  strFromU8(unzipSync(new Uint8Array(b))[part] ?? new Uint8Array());

/** Template A's columns as the export writes them: Sr. No., Page, Type, Discipline, text, Snapshot, Reviewer, Date, Status, Response. */
const COLS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const rowOf = (i: number, page = 1): TemplateCell[] => [
  i + 1,
  page,
  'Cloud',
  'Piping',
  `Comment ${String(i + 1)}`,
  null,
  'R. Reviewer',
  new Date(2026, 10, 1 + (i % 20), 1, 30),
  i % 2 ? 'Closed' : 'Open',
  i % 4 === 0 ? 'Agreed' : null,
];

const specA = (rows: number, over: Partial<TemplateFillSpec> = {}): TemplateFillSpec => ({
  sheet: A.sheet,
  startRow: A.startRow,
  lastPreDrawn: null,
  columns: COLS,
  snapshotIndex: 5,
  snapshotMaxPx: 180,
  sheets: [
    {
      name: null,
      details: [
        { cell: A.details.docNo, value: 'PA-1200-ME-DWG-0042' },
        { cell: '$G$4', value: 'B' },
        { cell: A.details.date, value: new Date(2026, 10, 24) },
      ],
      rows: Array.from({ length: rows }, (_, i) => rowOf(i)),
    },
  ],
  ...over,
});

const shot = (w: number, h: number): TemplateSnapshot => ({
  png: snapshotPng(w, h, 1).slice().buffer,
  width: w,
  height: h,
});

describe('filling template A (C2, C3, C11)', () => {
  it('fills the 15 pre-drawn rows, inserts 25 more and moves everything below', async () => {
    const tpl = await templateA(ExcelJS);
    const progress: number[] = [];
    const asked: [number, number, number, number][] = [];
    const out = await fillTemplate(
      ExcelJS,
      buf(tpl),
      specA(40),
      (g, i, w, max) => {
        asked.push([g, i, w, max]);
        return Promise.resolve(i % 3 === 0 ? shot(480, 240) : null);
      },
      noop,
      (n) => progress.push(n),
    );
    expect(out.names).toEqual(['CRS']);
    expect(out.lastPreDrawn).toBe(A.lastPreDrawn);
    expect(progress.at(-1)).toBe(40);
    // The Snapshot column (F, 32 wide) in pixels; the height limit.
    expect(asked[0]).toEqual([0, 0, 224, 180]);

    const wb = await read(out.bytes);
    const ws = wb.getWorksheet('CRS');
    if (!ws) throw new Error('no sheet');
    // Rows: values, the formula column slid, the start row's look copied.
    expect(ws.getCell('E10').value).toBe('Comment 1');
    expect(ws.getCell('E49').value).toBe('Comment 40');
    expect(ws.getCell('A49').value).toBe(40);
    expect(ws.getCell('K40').formula).toBe('IF(H40="","",TODAY()-H40)');
    expect(ws.getCell('E40').border.left?.style).toBe('thin');
    expect(ws.getCell('E40').alignment.wrapText).toBe(true);
    // The closing medium edge moved from row 24 to the new last row.
    expect(ws.getCell('E49').border.bottom?.style).toBe('medium');
    expect(ws.getCell('E24').border.bottom?.style).toBe('thin');
    // Dates: the local day without the time, with the template's number format.
    const h10 = ws.getCell('H10').value as Date;
    expect(h10.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(ws.getCell('H10').numFmt).toBe('dd-mmm-yyyy');
    // Totals, print area, sign-off block, names and the other sheet follow.
    expect(ws.getCell('K4').formula).toBe('COUNTA(E10:E49)');
    expect(ws.getCell('K6').formula).toBe('COUNTIF(I10:I49,"Open")');
    expect(ws.pageSetup.printArea).toBe('A1:K55');
    expect(ws.getCell('A51').value).toBe('SIGN-OFF');
    expect(wb.getWorksheet('Notes')?.getCell('A3').formula).toBe("'CRS'!K4");
    expect(wb.definedNames.getRanges('CommentText').ranges).toEqual(['CRS!$E$10:$E$49']);
    // Detail cells (a $ address too); the review date as a date.
    expect(ws.getCell('C4').value).toBe('PA-1200-ME-DWG-0042');
    expect(ws.getCell('G4').value).toBe('B');
    expect((ws.getCell('G6').value as Date).getUTCDate()).toBe(24);
    // Snapshots: anchored in column F of their rows, fitted to the column, the row grown.
    const images = ws.getImages().filter((im) => im.range.tl.nativeCol === 5);
    expect(images.map((im) => im.range.tl.nativeRow + 1)).toEqual(
      Array.from({ length: 14 }, (_, k) => 10 + 3 * k),
    );
    expect(ws.getRow(10).height).toBe(
      Math.ceil((fitSnapshot(480, 240, 224, 180).height + 8) * 0.75),
    );
    // The sign-off picture moved with its block.
    const stamp = ws.getImages().find((im) => im.range.tl.nativeCol === 9);
    expect(stamp?.range.tl.nativeRow).toBe(27 + 25);
    // Conditional formatting grew with the table.
    expect(
      (ws as unknown as { conditionalFormattings: { ref: string }[] }).conditionalFormattings.map(
        (c) => c.ref,
      ),
    ).toEqual(['I10:I49', 'A10:K49']);
    // The fixes: drop-downs as non-overlapping column ranges, width 9 kept, recalculation asked.
    const sheet = xml(out.bytes, 'xl/worksheets/sheet1.xml');
    const sqrefs = [...sheet.matchAll(/<dataValidation [^>]*sqref="([^"]+)"/gu)].map((m) => m[1]);
    expect(sqrefs.sort()).toEqual(['D10:D49', 'H10:H49', 'I10:I49']);
    expect(sheet).toMatch(/<col min="11" max="11" width="9\.0001"/u);
    expect(xml(out.bytes, 'xl/workbook.xml')).toMatch(/fullCalcOnLoad="1"/u);
    expect(sheet).not.toMatch(/<v>0<\/v><\/c><c r="K5"/u);
  });

  it('fills fewer rows than drawn without inserting; the C3 override inserts earlier', async () => {
    const tpl = await templateA(ExcelJS);
    const five = await read(
      (await fillTemplate(ExcelJS, buf(tpl), specA(5), null, noop, () => undefined)).bytes,
    );
    const ws5 = five.getWorksheet('CRS');
    expect(ws5?.getCell('A26').value).toBe('SIGN-OFF');
    expect(ws5?.getCell('K4').formula).toBe('COUNTA(E10:E24)');
    expect(ws5?.getCell('E15').value).toBeNull();

    const over = await fillTemplate(
      ExcelJS,
      buf(tpl),
      specA(5, { lastPreDrawn: 12 }),
      null,
      noop,
      () => undefined,
    );
    expect(over.lastPreDrawn).toBe(12);
    const ws = (await read(over.bytes)).getWorksheet('CRS');
    expect(ws?.getCell('E14').value).toBe('Comment 5');
    expect(ws?.getCell('A28').value).toBe('SIGN-OFF');
  });

  it('fills a one-row form: the totals row and the note below move down (template B)', async () => {
    const tpl = await templateB(ExcelJS);
    const out = await fillTemplate(
      ExcelJS,
      buf(tpl),
      {
        sheet: B.sheet,
        startRow: B.startRow,
        lastPreDrawn: null,
        columns: [1, 2, 3, 4, 5, 7],
        snapshotIndex: 5,
        snapshotMaxPx: 120,
        sheets: [
          {
            name: null,
            details: [{ cell: B.details.docNo, value: 'PA-1200-CV-SPC-0007' }],
            rows: Array.from({ length: 12 }, (_, i) => [
              i + 1,
              1,
              `Text ${String(i)}`,
              'R',
              'Code A',
              null,
            ]),
          },
        ],
      },
      () => Promise.resolve(shot(240, 520)),
      noop,
      () => undefined,
    );
    const ws = (await read(out.bytes)).getWorksheet(B.sheet);
    if (!ws) throw new Error('no sheet');
    expect(ws.getCell('C18').value).toBe('Text 11');
    expect(ws.getCell('C19').formula).toBe('COUNTA(C7:C18)');
    expect(ws.getCell('A21').value).toMatch(/^Codes:/u);
    expect(ws.pageSetup.printArea).toBe('A1:G21');
    // A tall picture keeps to the height limit.
    const im = ws.getImages().find((x) => x.range.tl.nativeRow === 6);
    expect((im?.range as { ext?: { height: number } } | undefined)?.ext?.height).toBe(120);
    expect(ws.getCell('E18').dataValidation.formulae).toEqual(['$M$1:$M$3']);
  });
});

describe('one sheet per group (C5, C6, C15)', () => {
  it('fills the template sheet renamed and copies after it, each with its own rows and details', async () => {
    const tpl = await templateA(ExcelJS);
    const sheet = (name: string, n: number, docNo: string) => ({
      name,
      details: [{ cell: A.details.docNo, value: docNo }],
      rows: Array.from({ length: n }, (_, i) => rowOf(i)),
    });
    const out = await fillTemplate(
      ExcelJS,
      buf(tpl),
      {
        ...specA(0),
        sheets: [
          sheet('B:102/Sec*?', 20, 'D-1'),
          sheet('A-101', 3, 'D-2'),
          sheet('a-101', 2, 'D-3'),
        ],
      },
      null,
      noop,
      () => undefined,
    );
    expect(out.names).toEqual(['B-102-Sec--', 'A-101', 'a-101 (2)']);
    const wb = await read(out.bytes);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'B-102-Sec--',
      'A-101',
      'a-101 (2)',
      'Lists',
      'Notes',
    ]);
    const [first, second, third] = out.names.map((n) => wb.getWorksheet(n));
    expect(first?.getCell('A29').value).toBe(20);
    expect(first?.getCell('K4').formula).toBe('COUNTA(E10:E29)');
    // A copy is taken from the template as it was: no rows of the first sheet.
    expect(second?.getCell('A10').value).toBe(1);
    expect(second?.getCell('A13').value).toBeNull();
    expect(second?.getCell('K4').formula).toBe('COUNTA(E10:E24)');
    expect(second?.getCell('C4').value).toBe('D-2');
    expect(third?.getCell('C4').value).toBe('D-3');
    expect(third?.getImages().length).toBe(2); // the logo and the sign-off mark
    // References follow the renamed template sheet.
    expect(wb.getWorksheet('Notes')?.getCell('A3').formula).toBe("'B-102-Sec--'!K4");
  });
});

describe('what the spike left to M13-07 (Amendment 1 item 8)', () => {
  it('grows an Excel table on the chosen sheet and keeps notes and links in moved rows', async () => {
    const src = new ExcelJS.Workbook();
    const ws = src.addWorksheet('Log');
    ws.addTable({
      name: 'Comments',
      ref: 'A3',
      headerRow: true,
      columns: [{ name: 'No.' }, { name: 'Comment' }, { name: 'Status' }],
      rows: [[null, null, null]],
    });
    for (const c of [1, 2, 3])
      ws.getCell(4, c).border = { left: { style: 'thin' }, right: { style: 'thin' } };
    ws.getCell('A6').value = { text: 'Project site', hyperlink: 'https://example.com/' };
    ws.getCell('B6').value = 'Approved by';
    ws.getCell('B6').note = 'Sign here';
    ws.getCell('C4').dataValidation = {
      type: 'custom',
      allowBlank: true,
      formulae: ['LEN(B4)<200'],
    };
    const tpl = await src.xlsx.writeBuffer();
    const out = await fillTemplate(
      ExcelJS,
      tpl,
      {
        sheet: 'Log',
        startRow: 4,
        lastPreDrawn: null,
        columns: [1, 2],
        snapshotIndex: -1,
        snapshotMaxPx: 240,
        sheets: [
          {
            name: null,
            details: [],
            rows: Array.from({ length: 10 }, (_, i) => [i + 1, `C${String(i)}`]),
          },
        ],
      },
      null,
      noop,
      () => undefined,
    );
    const back = (await read(out.bytes)).getWorksheet('Log');
    if (!back) throw new Error('no sheet');
    expect(back.getCell('B13').value).toBe('C9');
    expect(xml(out.bytes, 'xl/tables/table1.xml')).toMatch(/ref="A3:C13"/u);
    expect(back.getCell('A15').value).toEqual({
      text: 'Project site',
      hyperlink: 'https://example.com/',
    });
    expect(back.getCell('B15').note).toBe('Sign here');
    // A custom drop-down's relative formula stays right for the whole range.
    const sheet = xml(out.bytes, 'xl/worksheets/sheet1.xml');
    expect(sheet).toMatch(/sqref="C4:C13"[^>]*>(?:(?!<\/dataValidation>).)*LEN\(B4\)&lt;200/su);
  });

  it("keeps a cell to Excel's 32,767 characters", async () => {
    const tpl = await templateB(ExcelJS);
    const out = await fillTemplate(
      ExcelJS,
      buf(tpl),
      {
        sheet: B.sheet,
        startRow: B.startRow,
        lastPreDrawn: null,
        columns: [3],
        snapshotIndex: -1,
        snapshotMaxPx: 120,
        sheets: [{ name: null, details: [], rows: [['x'.repeat(40_000)]] }],
      },
      null,
      noop,
      () => undefined,
    );
    const v = (await read(out.bytes)).getWorksheet(B.sheet)?.getCell('C7').value as string;
    expect(v).toHaveLength(32767);
    expect(v.endsWith('…')).toBe(true);
  });
});

describe('files taken and refused (Amendment 1 items 1, 2)', () => {
  it('takes .xlsx and .xltx by their bytes and refuses the rest', async () => {
    const a = await templateA(ExcelJS);
    expect(workbookKind(a)).toBe('xlsx');
    expect(workbookKind(asXltx(a))).toBe('xltx');
    expect(workbookKind(asXlsm(a))).toBe('macro');
    expect(workbookKind(fakeXls())).toBe('ole');
    expect(workbookKind(new TextEncoder().encode('%PDF-1.7'))).toBe('not-a-workbook');
    const fill = (b: Uint8Array) =>
      fillTemplate(ExcelJS, buf(b), specA(1), null, noop, () => undefined);
    await expect(fill(asXlsm(a))).rejects.toThrow(TemplateError);
    await expect(fill(fakeXls())).rejects.toThrow('crs-template-refused');
    // An .xltx fills like an .xlsx (written back as a workbook).
    const out = await fill(asXltx(a));
    expect(workbookKind(new Uint8Array(out.bytes))).toBe('xlsx');
    await expect(
      fillTemplate(ExcelJS, buf(a), { ...specA(1), sheet: 'Gone' }, null, noop, () => undefined),
    ).rejects.toThrow('crs-template-no-sheet');
  });

  it('inspects: sheets, lost parts, tables and the pre-drawn rows (C3)', async () => {
    const a = await templateA(ExcelJS);
    const res = await inspectTemplate(ExcelJS, buf(withTextBox(a)), {
      sheet: 'CRS',
      startRow: 10,
      columns: COLS,
      lastPreDrawn: null,
    });
    expect(res).toMatchObject({ ok: true, kind: 'xlsx', lost: ['shapes'], lastPreDrawn: 24 });
    if (!res.ok) return;
    expect(res.sheets.map((s) => s.name)).toEqual(['CRS', 'Lists', 'Notes']);
    expect(lostParts(a)).toEqual([]);
    expect(await inspectTemplate(ExcelJS, buf(asXlsm(a)), null)).toEqual({
      ok: false,
      kind: 'macro',
    });
    // A zip that is not a workbook ExcelJS can read.
    const broken = new Uint8Array(a);
    broken.set(new TextEncoder().encode('garbage!'), 200);
    const r = await inspectTemplate(ExcelJS, buf(broken), null);
    expect(r.ok).toBe(false);
  });
});

describe('Cancel and progress (rule 2)', () => {
  it('stops between rows', async () => {
    const tpl = await templateA(ExcelJS);
    let calls = 0;
    const checkpoint = () => {
      calls++;
      return calls > 3 ? Promise.reject(new Error('aborted')) : Promise.resolve();
    };
    const seen: number[] = [];
    await expect(
      fillTemplate(ExcelJS, buf(tpl), specA(200), null, checkpoint, (n) => seen.push(n)),
    ).rejects.toThrow('aborted');
    expect(seen.length).toBeLessThan(200);
  });

  it('fits pictures to the column with a height limit', () => {
    expect(fitSnapshot(480, 240, 229, 180)).toEqual({ width: 221, height: 111 });
    expect(fitSnapshot(240, 520, 229, 180)).toEqual({ width: 83, height: 180 });
    expect(fitSnapshot(10, 10, 10, 180)).toEqual({ width: 16, height: 16 });
  });
});
