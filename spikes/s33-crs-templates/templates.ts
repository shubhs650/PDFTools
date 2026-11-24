// Spike S33 (M13-06): self-made project CRS templates, made by script (rule 13).
// Each one has what a real project form tends to have: merged header cells, a
// logo, borders, print area and print titles, drop-downs, conditional
// formatting, formulas, frozen panes, and a sign-off block below the table.
// The text is invented; no company's form is copied.
import type ExcelJS from 'exceljs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { logoPng } from './png';

type Lib = typeof ExcelJS;
type Border = Partial<ExcelJS.Borders>;

const thin = { style: 'thin' } as const;
const medium = { style: 'medium' } as const;
const BOX: Border = { top: thin, left: thin, bottom: thin, right: thin };
const HEAD_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFD9E1F2' },
};

/** The table layout of template A, used by the tests to check the results. */
export const A = {
  sheet: 'CRS',
  headerRow: 9,
  startRow: 10,
  lastPreDrawn: 24,
  signOffRow: 26,
  lastCol: 11,
  /** Column numbers of the fields this template has. */
  cols: {
    srNo: 1,
    page: 2,
    type: 3,
    discipline: 4,
    text: 5,
    snapshot: 6,
    author: 7,
    date: 8,
    status: 9,
    reply: 10,
    daysOpen: 11,
  },
  details: { docNo: 'C4', rev: 'G4', title: 'C5', reviewer: 'C6', date: 'G6' },
};

/** Template B: one start row, a totals row right under it, no pre-drawn rows. */
export const B = {
  sheet: 'Comments',
  headerRow: 6,
  startRow: 7,
  totalsRow: 8,
  cols: { srNo: 1, page: 2, text: 3, author: 4, status: 5, reply: 6, snapshot: 7 },
  details: { docNo: 'B2', rev: 'D2' },
};

function boxRange(ws: ExcelJS.Worksheet, r1: number, c1: number, r2: number, c2: number) {
  for (let r = r1; r <= r2; r++)
    for (let c = c1; c <= c2; c++) ws.getCell(r, c).border = { ...BOX };
}

/** Template A: a full project form on sheet "CRS", with "Lists" and "Notes" sheets. */
export async function templateA(lib: Lib): Promise<Uint8Array> {
  const wb = new lib.Workbook();
  wb.creator = 'S33 spike';
  const ws = wb.addWorksheet(A.sheet, {
    pageSetup: {
      paperSize: 8 as ExcelJS.PaperSize, // A3
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printArea: 'A1:K30',
      printTitlesRow: '9:9',
    },
    headerFooter: { oddFooter: '&LProject Alpha CRS&RPage &P of &N' },
    views: [{ state: 'frozen', ySplit: A.headerRow, xSplit: 0 }],
  });
  ws.columns = [6, 7, 13, 13, 45, 32, 14, 12, 12, 36, 9].map((width) => ({ width }));

  // Header: logo (A1:B3), title (C1:H2), form number (I1:K1), project (I2:K3).
  const logo = wb.addImage({ buffer: logoPng(96) as unknown as ExcelJS.Buffer, extension: 'png' });
  ws.addImage(logo, { tl: { col: 0.2, row: 0.2 }, ext: { width: 64, height: 64 } });
  ws.mergeCells('A1:B3');
  ws.mergeCells('C1:H3');
  ws.getCell('C1').value = 'COMMENT RESOLUTION SHEET';
  ws.getCell('C1').font = { bold: true, size: 18, color: { argb: 'FF1F4EA0' } };
  ws.getCell('C1').alignment = { horizontal: 'center', vertical: 'middle' };
  ws.mergeCells('I1:K1');
  ws.getCell('I1').value = 'Form CRS-01 Rev 2';
  ws.mergeCells('I2:K3');
  ws.getCell('I2').value = 'Project Alpha — Plant Extension';
  ws.getCell('I2').alignment = { wrapText: true, vertical: 'middle' };
  boxRange(ws, 1, 1, 3, 11);

  // Detail block (rows 4–7): label cells merged, value cells merged and boxed.
  const label = (addr: string, text: string) => {
    ws.getCell(addr).value = text;
    ws.getCell(addr).font = { bold: true };
  };
  ws.mergeCells('A4:B4');
  label('A4', 'Document No.');
  ws.mergeCells('C4:E4');
  label('F4', 'Revision');
  ws.mergeCells('G4:H4');
  ws.mergeCells('A5:B5');
  label('A5', 'Title');
  ws.mergeCells('C5:K5');
  ws.mergeCells('A6:B6');
  label('A6', 'Reviewer');
  ws.mergeCells('C6:E6');
  label('F6', 'Review date');
  ws.mergeCells('G6:H6');
  ws.getCell('G6').numFmt = 'dd-mmm-yyyy';
  label('I4', 'Total comments');
  ws.getCell('K4').value = {
    formula: `COUNTA(E${String(A.startRow)}:E${String(A.lastPreDrawn)})`,
    result: 0,
  };
  label('I6', 'Open');
  ws.getCell('K6').value = {
    formula: `COUNTIF(I${String(A.startRow)}:I${String(A.lastPreDrawn)},"Open")`,
    result: 0,
  };
  boxRange(ws, 4, 1, 7, 11);

  // Table header (row 9).
  const heads = [
    'Sr. No.',
    'Page',
    'Type',
    'Discipline',
    'Reviewer comment',
    'Snapshot',
    'Reviewer',
    'Date',
    'Status',
    'Response',
    'Days open',
  ];
  const head = ws.getRow(A.headerRow);
  heads.forEach((h, i) => {
    const c = head.getCell(i + 1);
    c.value = h;
    c.font = { bold: true };
    c.fill = HEAD_FILL;
    c.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
    c.border = { top: medium, left: thin, bottom: medium, right: thin };
  });
  head.height = 30;

  // Pre-drawn rows (10–24): boxed, wrap, Days open formula; the last row closes
  // the table with a medium bottom edge.
  for (let r = A.startRow; r <= A.lastPreDrawn; r++) {
    const row = ws.getRow(r);
    row.height = 30;
    for (let c = 1; c <= A.lastCol; c++) {
      const cell = row.getCell(c);
      cell.border = { ...BOX, ...(r === A.lastPreDrawn ? { bottom: medium } : {}) };
      cell.alignment = { wrapText: true, vertical: 'top' };
    }
    row.getCell(A.cols.date).numFmt = 'dd-mmm-yyyy';
    // Written as one shared formula (master K10, the rest pointing at it),
    // as Excel saves a column filled down.
    row.getCell(A.cols.daysOpen).value =
      r === A.startRow
        ? ({
            formula: `IF(H${String(r)}="","",TODAY()-H${String(r)})`,
            shareType: 'shared',
            ref: `K${String(A.startRow)}:K${String(A.lastPreDrawn)}`,
            result: '',
          } as unknown as ExcelJS.CellValue)
        : { sharedFormula: `K${String(A.startRow)}`, result: '' };
  }
  // Drop-downs: status from the Lists sheet, discipline inline, date checked.
  for (let r = A.startRow; r <= A.lastPreDrawn; r++) {
    ws.getCell(r, A.cols.status).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['Lists!$A$1:$A$4'],
      showErrorMessage: true,
      errorTitle: 'Status',
      error: 'Pick a status from the list',
    };
    ws.getCell(r, A.cols.discipline).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"Civil,Mechanical,Electrical,Piping,Instrument"'],
    };
    ws.getCell(r, A.cols.date).dataValidation = {
      type: 'date',
      operator: 'greaterThan',
      allowBlank: true,
      formulae: [new Date(Date.UTC(2020, 0, 1))],
    };
  }
  // Conditional formatting: Closed green; open for more than 14 days red text.
  ws.addConditionalFormatting({
    ref: `I${String(A.startRow)}:I${String(A.lastPreDrawn)}`,
    rules: [
      {
        type: 'cellIs',
        operator: 'equal',
        formulae: ['"Closed"'],
        priority: 1,
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFC6EFCE' } } },
      },
    ],
  });
  ws.addConditionalFormatting({
    ref: `A${String(A.startRow)}:K${String(A.lastPreDrawn)}`,
    rules: [
      {
        type: 'expression',
        formulae: [
          `AND($I${String(A.startRow)}="Open",$K${String(A.startRow)}<>"",$K${String(A.startRow)}>14)`,
        ],
        priority: 2,
        style: { font: { color: { argb: 'FF9C0006' } } },
      },
    ],
  });

  // Sign-off block (rows 26–30).
  ws.mergeCells('A26:K26');
  ws.getCell('A26').value = 'SIGN-OFF';
  ws.getCell('A26').font = { bold: true };
  ws.getCell('A26').fill = HEAD_FILL;
  const blocks: [number, number, string][] = [
    [1, 4, 'Prepared by'],
    [5, 6, 'Checked by'],
    [7, 11, 'Approved by'],
  ];
  for (const [c1, c2, text] of blocks) {
    ws.mergeCells(27, c1, 27, c2);
    ws.getCell(27, c1).value = text;
    ws.getCell(27, c1).font = { bold: true };
    ws.mergeCells(28, c1, 29, c2); // signature box
    ws.mergeCells(30, c1, 30, c2);
    ws.getCell(30, c1).value = 'Date:';
  }
  boxRange(ws, 26, 1, 30, 11);
  ws.getRow(28).height = 24;
  ws.getRow(29).height = 24;
  // A small "approved" mark in the Approved by box: a picture below the table.
  ws.addImage(logo, { tl: { col: 9.2, row: 27.1 }, ext: { width: 28, height: 28 } });

  // Lists (drop-down source) and Notes (instructions; must stay untouched).
  const lists = wb.addWorksheet('Lists');
  ['Open', 'Closed', 'Hold', 'Info'].forEach((s, i) => (lists.getCell(i + 1, 1).value = s));
  const notes = wb.addWorksheet('Notes');
  notes.getCell('A1').value = 'How to fill this form';
  notes.getCell('A2').value = 'Responses go in column J. Days open is worked out by formula.';
  notes.getCell('A3').value = { formula: `'${A.sheet}'!K4`, result: 0 };
  // A workbook-level name that points into the table (must grow with it).
  wb.definedNames.add(
    `'${A.sheet}'!$E$${String(A.startRow)}:$E$${String(A.lastPreDrawn)}`,
    'CommentText',
  );
  // ExcelJS does not write a width of exactly 9 (column K); Excel does. The
  // column is put in as Excel would have saved it.
  return patch(new Uint8Array(await wb.xlsx.writeBuffer()), (f) => {
    const name = 'xl/worksheets/sheet1.xml';
    f[name] = strToU8(
      text(f, name).replace('</cols>', '<col min="11" max="11" width="9" customWidth="1"/></cols>'),
    );
  });
}

/** Template B: header row 6, ONE start row (7), a totals row (8) under it. */
export async function templateB(lib: Lib): Promise<Uint8Array> {
  const wb = new lib.Workbook();
  const ws = wb.addWorksheet(B.sheet, {
    pageSetup: {
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printArea: 'A1:G10',
      printTitlesRow: '6:6',
    },
    views: [{ state: 'frozen', ySplit: B.headerRow }],
  });
  ws.columns = [6, 7, 50, 14, 12, 40, 28, 4, 4, 4, 4, 4, 10].map((width) => ({ width }));
  ws.mergeCells('A1:G1');
  ws.getCell('A1').value = 'Review comments';
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A2').value = 'Doc No.';
  ws.getCell('C2').value = 'Rev';
  boxRange(ws, 2, 2, 2, 2);
  boxRange(ws, 2, 4, 2, 4);
  ['No.', 'Page', 'Comment', 'By', 'Status', 'Reply', 'Picture'].forEach((h, i) => {
    const c = ws.getCell(B.headerRow, i + 1);
    c.value = h;
    c.font = { bold: true };
    c.fill = HEAD_FILL;
    c.border = { ...BOX };
  });
  boxRange(ws, B.startRow, 1, B.startRow, 7);
  for (let c = 1; c <= 7; c++)
    ws.getCell(B.startRow, c).alignment = { wrapText: true, vertical: 'top' };
  ws.getRow(B.startRow).getCell(B.cols.status).dataValidation = {
    type: 'list',
    allowBlank: true,
    formulae: ['$M$1:$M$3'],
  };
  ['A', 'B', 'C'].forEach((s, i) => (ws.getCell(i + 1, 13).value = `Code ${s}`));
  ws.getColumn(13).hidden = true;
  ws.getCell(B.totalsRow, 2).value = 'Total';
  ws.getCell(B.totalsRow, 3).value = {
    formula: `COUNTA(C${String(B.startRow)}:C${String(B.startRow)})`,
    result: 0,
  };
  ws.getCell(B.totalsRow, 3).font = { bold: true };
  ws.mergeCells('A10:G10');
  ws.getCell('A10').value = 'Codes: A = no comment, B = revise and resubmit, C = rejected.';
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------------------
// Variants made by editing the zip: the same workbook saved as a template
// (.xltx), with macros (.xlsm), an old binary .xls, and parts ExcelJS has no
// model for (a text box shape, a cell note, a header picture). These are what
// a project might hand a reviewer.

const XLSX_MAIN = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
const XLTX_MAIN = 'application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml';
const XLSM_MAIN = 'application/vnd.ms-excel.sheet.macroEnabled.main+xml';

function patch(bytes: Uint8Array, edit: (files: Record<string, Uint8Array>) => void): Uint8Array {
  const files = unzipSync(bytes);
  edit(files);
  return zipSync(files, { level: 6 });
}

function text(files: Record<string, Uint8Array>, name: string): string {
  const f = files[name];
  if (!f) throw new Error(`no ${name} in the zip`);
  return strFromU8(f);
}

/** The same workbook as an Excel template (.xltx): only the main content type differs. */
export function asXltx(xlsx: Uint8Array): Uint8Array {
  return patch(xlsx, (f) => {
    f['[Content_Types].xml'] = strToU8(
      text(f, '[Content_Types].xml').replace(XLSX_MAIN, XLTX_MAIN),
    );
  });
}

/** A macro-enabled workbook (.xlsm): macro content type and a (dummy) VBA part. */
export function asXlsm(xlsx: Uint8Array): Uint8Array {
  return patch(xlsx, (f) => {
    f['[Content_Types].xml'] = strToU8(
      text(f, '[Content_Types].xml')
        .replace(XLSX_MAIN, XLSM_MAIN)
        .replace(
          '</Types>',
          '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>',
        ),
    );
    f['xl/vbaProject.bin'] = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    f['xl/_rels/workbook.xml.rels'] = strToU8(
      text(f, 'xl/_rels/workbook.xml.rels').replace(
        '</Relationships>',
        '<Relationship Id="rIdVba" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/></Relationships>',
      ),
    );
  });
}

/** The first bytes of an old binary workbook (.xls, OLE2 compound file). */
export function fakeXls(): Uint8Array {
  const b = new Uint8Array(1024);
  b.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  return b;
}

/**
 * Template A plus parts ExcelJS has no model for: a text box shape next to the
 * logo in the same drawing (a "Stamp here" box), and a theme colour. The
 * spike checks which of them survive a load and write.
 */
export function withTextBox(xlsx: Uint8Array): Uint8Array {
  return patch(xlsx, (f) => {
    const name = Object.keys(f).find((k) => /^xl\/drawings\/drawing\d+\.xml$/u.test(k));
    if (!name) throw new Error('template A has no drawing');
    const sp =
      '<xdr:twoCellAnchor><xdr:from><xdr:col>11</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>' +
      '<xdr:to><xdr:col>13</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>3</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>' +
      '<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="99" name="StampBox"/><xdr:cNvSpPr txBox="1"/></xdr:nvSpPr>' +
      '<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1200000" cy="600000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
      '<a:ln w="12700"><a:solidFill><a:srgbClr val="1F4EA0"/></a:solidFill></a:ln></xdr:spPr>' +
      '<xdr:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Stamp here</a:t></a:r></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:twoCellAnchor>';
    f[name] = strToU8(text(f, name).replace('</xdr:wsDr>', `${sp}</xdr:wsDr>`));
  });
}
