// Spike S33 (M13-06, D-71): project CRS templates with ExcelJS. The reference
// rules (a1.ts), the sheet-name rules, file kinds, and fills of the
// self-made templates read back with ExcelJS.
import ExcelJS from 'exceljs';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { renameSheetRefs, shiftRows, slideRows } from './a1';
import { checkWorkbook } from './check';
import { workbookKind } from './detect';
import { detectPreDrawn, sheetName } from './engine';
import { commentsA, commentsB, fillGroups, fillOne, load, specA, specB, write } from './scenarios';
import { A, asXlsm, asXltx, B, fakeXls, templateA, templateB } from './templates';

const at = (after: number, n: number, sheet = 'CRS', home: string | null = 'CRS') => ({
  sheet,
  home,
  after,
  n,
});
const xml = (b: Uint8Array, part: string) => strFromU8(unzipSync(b)[part] ?? new Uint8Array());

describe('S33 references', () => {
  it('moves rows below the table and grows ranges that reach its last row', () => {
    const s = at(24, 25);
    expect(shiftRows('COUNTA(E10:E24)', s)).toBe('COUNTA(E10:E49)');
    expect(shiftRows('SUM($E$10:$E$24)+A30', s)).toBe('SUM($E$10:$E$49)+A55');
    expect(shiftRows('A1+K4', s)).toBe('A1+K4');
    expect(shiftRows('A26:K26', s)).toBe('A51:K51');
    expect(shiftRows('$9:$9', s)).toBe('$9:$9');
    expect(shiftRows('A1:K30', s)).toBe('A1:K55');
    expect(shiftRows('E24', s)).toBe('E24');
  });

  it('leaves text, function names and other sheets alone', () => {
    const s = at(24, 5);
    expect(shiftRows('IF(A30="A30","x",LOG10(A30))', s)).toBe('IF(A35="A30","x",LOG10(A35))');
    expect(shiftRows('Lists!A30+CRS!A30', s)).toBe('Lists!A30+CRS!A35');
    expect(shiftRows("'My CRS'!A30", at(24, 5, 'My CRS', 'Notes'))).toBe("'My CRS'!A35");
    expect(shiftRows('A30', at(24, 5, 'CRS', 'Notes'))).toBe('A30');
    expect(shiftRows('Table1[Col 30]', s)).toBe('Table1[Col 30]');
  });

  it('slides relative rows like a fill down', () => {
    expect(slideRows('IF(H10="","",TODAY()-H10)', 15)).toBe('IF(H25="","",TODAY()-H25)');
    expect(slideRows('$A$1+A$1+$A1+SUM(B10:B11)', 2)).toBe('$A$1+A$1+$A3+SUM(B12:B13)');
  });

  it('renames sheet references, quoting when needed', () => {
    expect(renameSheetRefs("CRS!K4+'CRS'!K5+Lists!A1", 'CRS', 'A-101')).toBe(
      "'A-101'!K4+'A-101'!K5+Lists!A1",
    );
    expect(renameSheetRefs('"CRS!K4"&CRS!K4', 'CRS', 'Page1')).toBe('"CRS!K4"&Page1!K4');
  });
});

describe('S33 sheet names', () => {
  it("keeps to Excel's rules", () => {
    const taken = new Set(['lists']);
    expect(sheetName('B:102/Sec*?', taken)).toBe('B-102-Sec--');
    expect(sheetName("'quoted'", taken)).toBe('quoted');
    expect(sheetName('x'.repeat(40), taken)).toHaveLength(31);
    expect(sheetName('History', taken)).toBe('History 1');
    expect(sheetName('LISTS', taken)).toBe('LISTS (2)');
    expect(sheetName('', taken)).toBe('Sheet');
    expect(sheetName(`${'a'.repeat(30)}😀`, taken)).toBe('a'.repeat(30));
    expect(sheetName('y'.repeat(31), new Set(['y'.repeat(31)]))).toBe(`${'y'.repeat(27)} (2)`);
  });
});

describe('S33 file kinds', () => {
  it('takes .xlsx and .xltx, refuses macros and OLE files', async () => {
    const a = await templateA(ExcelJS);
    expect(workbookKind(a)).toBe('xlsx');
    expect(workbookKind(asXltx(a))).toBe('xltx');
    expect(workbookKind(asXlsm(a))).toBe('macro');
    expect(workbookKind(fakeXls())).toBe('ole');
    expect(workbookKind(new TextEncoder().encode('%PDF-1.7'))).toBe('not-a-workbook');
    await expect(load(ExcelJS, asXlsm(a))).rejects.toThrow('refused: macro');
  });
});

describe('S33 fills', () => {
  it('detects the pre-drawn rows by their borders (closing edge included)', async () => {
    const wb = await load(ExcelJS, await templateA(ExcelJS));
    const ws = wb.getWorksheet(A.sheet);
    if (!ws) throw new Error('no sheet');
    expect(detectPreDrawn(ws, A.startRow, Object.values(A.cols), new Set([A.cols.daysOpen]))).toBe(
      A.lastPreDrawn,
    );
  });

  it('fills pre-drawn rows, then inserts rows that carry everything along', async () => {
    const { bytes, result } = await fillOne(
      ExcelJS,
      await templateA(ExcelJS),
      A.sheet,
      specA(),
      commentsA(40),
    );
    expect(result).toMatchObject({ lastPreDrawn: 24, inserted: 25, rows: 40 });
    expect(checkWorkbook(bytes)).toEqual([]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes.slice().buffer);
    const ws = wb.getWorksheet(A.sheet);
    if (!ws) throw new Error('no sheet');
    // Totals grow, the sign-off block moves down intact, print area grows.
    expect(ws.getCell('K4').formula).toBe('COUNTA(E10:E49)');
    expect(ws.getCell('A51').value).toBe('SIGN-OFF');
    expect(ws.getCell('A52').value).toBe('Prepared by');
    const m = ws.model as unknown as { merges: string[] };
    expect(m.merges).toEqual(expect.arrayContaining(['A51:K51', 'A53:D54', 'G55:K55']));
    expect(m.merges.some((r) => r.startsWith('A26'))).toBe(false);
    expect(ws.pageSetup.printArea).toBe('A1:K55');
    expect(ws.pageSetup.printTitlesRow).toBe('9:9');
    // A new row: formula slid, drop-downs, style; closing edge moved to row 49.
    expect(ws.getCell('K40').formula).toBe('IF(H40="","",TODAY()-H40)');
    expect(ws.getCell('I49').dataValidation.formulae).toEqual(['Lists!$A$1:$A$4']);
    expect(ws.getCell('D45').dataValidation.type).toBe('list');
    expect(ws.getCell('E30').border.left?.style).toBe('thin');
    expect(ws.getCell('E49').border.bottom?.style).toBe('medium');
    expect(ws.getCell('E24').border.bottom?.style).toBe('thin');
    expect(ws.getCell('E49').value).toBe('Show the drain valve on the low point. (#40)');
    // Conditional formatting grows with the table.
    const cf = (ws as unknown as { conditionalFormattings: { ref: string }[] })
      .conditionalFormattings;
    expect(cf.map((c) => c.ref)).toEqual(['I10:I49', 'A10:K49']);
    // Other sheets and names follow; detail cells filled; results dropped so readers recalculate.
    expect(wb.getWorksheet('Notes')?.getCell('A3').formula).toBe("'CRS'!K4");
    expect(
      (wb.definedNames as unknown as { model: { ranges: string[] }[] }).model[0]?.ranges,
    ).toEqual(['CRS!$E$10:$E$49']);
    expect(ws.getCell('C4').value).toBe('PA-1200-ME-DWG-0042');
    expect(xml(bytes, 'xl/workbook.xml')).toContain('fullCalcOnLoad="1"');
    expect(xml(bytes, 'xl/worksheets/sheet1.xml')).not.toMatch(/<f>COUNTA[^<]*<\/f><v>/u);
    // Logo, the mark in the sign-off block (moved down 25 rows), one snapshot per third comment.
    const images = ws.getImages();
    expect(images).toHaveLength(2 + 14);
    expect(images.filter((i) => i.range.tl.nativeRow === 52)).toHaveLength(1);
    // The template's shared formula (Excel's fill down) became plain formulas.
    expect(ws.getCell('K20').formula).toBe('IF(H20="","",TODAY()-H20)');
    expect(result.unshared).toBe(14);
    // Days open (column K) is 9 wide: ExcelJS would drop that width.
    expect(xml(bytes, 'xl/worksheets/sheet1.xml')).toMatch(
      /<col min="11" max="11" width="9.0001"/u,
    );
  });

  it('grows a one-row table and keeps the drop-down ranges apart', async () => {
    const { bytes, result } = await fillOne(
      ExcelJS,
      await templateB(ExcelJS),
      B.sheet,
      specB(),
      commentsB(12),
    );
    expect(result).toMatchObject({ lastPreDrawn: 7, inserted: 11 });
    expect(checkWorkbook(bytes)).toEqual([]);
    const sheet = xml(bytes, 'xl/worksheets/sheet1.xml');
    expect([...sheet.matchAll(/<dataValidation [^>]*sqref="([^"]+)"/gu)].map((x) => x[1])).toEqual([
      'E7:E18',
    ]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes.slice().buffer);
    const ws = wb.getWorksheet(B.sheet);
    expect(ws?.getCell('C19').formula).toBe('COUNTA(C7:C18)');
    expect(ws?.getCell('A21').value).toMatch(/^Codes:/u);
    expect(ws?.pageSetup.printArea).toBe('A1:G21');
    // Wrapped text gets an explicit height (two lines), so pictures below stay in their rows.
    expect(ws?.getRow(7).height).toBeGreaterThanOrEqual(29);
  });

  it('makes one sheet per page, renamed safely, references following', async () => {
    const { bytes, names, results } = await fillGroups(
      ExcelJS,
      await templateA(ExcelJS),
      A.sheet,
      [
        { name: 'A-101', rows: commentsA(5, 1) },
        { name: 'B:102', rows: commentsA(30, 2) },
        { name: 'a-101', rows: commentsA(2, 3) },
      ],
      () => specA(),
    );
    expect(names).toEqual(['A-101', 'B-102', 'a-101 (2)']);
    expect(results.map((r) => r.inserted)).toEqual([0, 15, 0]);
    expect(checkWorkbook(bytes)).toEqual([]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes.slice().buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'A-101',
      'B-102',
      'a-101 (2)',
      'Lists',
      'Notes',
    ]);
    expect(wb.getWorksheet('Notes')?.getCell('A3').formula).toBe("'A-101'!K4");
    const p2 = wb.getWorksheet('B-102');
    expect(p2?.getCell('K4').formula).toBe('COUNTA(E10:E39)');
    expect(p2?.getCell('A10').value).toBe(1); // Sr. No. restarts per sheet
    expect(p2?.getCell('B10').value).toBe(2);
    expect(p2?.pageSetup.printArea).toBe('A1:K45');
    expect(p2?.getImages().length).toBeGreaterThan(1); // the logo came along
    expect(wb.getWorksheet('a-101 (2)')?.views[0]).toMatchObject({ state: 'frozen', ySplit: 9 });
  });

  it('fixes ExcelJS writing drop-down ranges twice when they cross row 9 → 10', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('DV');
    for (let r = 5; r <= 14; r++) {
      ws.getCell(r, 5).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Yes,No"'] };
    }
    const plain = new Uint8Array(await wb.xlsx.writeBuffer());
    expect(checkWorkbook(plain).map((p) => p.what)).toContain('overlapping drop-down ranges');
    expect(checkWorkbook(await write(wb))).toEqual([]);
  });
});
