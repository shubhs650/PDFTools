// Self-made table fixtures for M4-12 … M4-15 (§7.7, rule 13): fictional
// values in the style of a pipe dimension chart and a parts list. Each page's
// expected cells are exported so tests score detection (merged cells: text in
// the top-left cell, '' in the rest).
//   page 1 (landscape): two ruled tables side by side — merged headers (across
//          and down), dual units, a multi-line cell
//   page 2: an unruled parts list, two descriptions wrapping to a second line
//   page 3: two unruled tables side by side
//   page 4: a "scanned" page (an image, no text)
//   page 5: prose only (no table)
import { deflateSync } from 'node:zlib';
import { buildPdf, type PdfObject } from './generate.ts';

export interface ExpectedTable {
  cells: string[][];
  merges: { r: number; c: number; rs: number; cs: number }[];
  headerRows: number;
}

const esc = (s: string): string => s.replace(/[\\()]/g, (c) => `\\${c}`);
const text = (x: number, y: number, size: number, s: string, font = 'F1'): string =>
  `BT /${font} ${String(size)} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${esc(s)}) Tj ET`;

interface Ruled {
  /** x dividers, left to right. */
  cols: number[];
  /** y dividers, top to bottom. */
  rows: number[];
  table: ExpectedTable;
}

const inMerge = (t: ExpectedTable, r: number, c: number) =>
  t.merges.find((m) => r >= m.r && r < m.r + m.rs && c >= m.c && c < m.c + m.cs);

/** Rulings (none inside merged cells) and the cell texts, top-left aligned, lines 11 pt apart. */
export function ruled({ cols, rows, table }: Ruled): string[] {
  const out = ['0.6 w'];
  const nr = rows.length - 1;
  const nc = cols.length - 1;
  // Horizontal edges: row boundary k (between row k − 1 and k) under each column.
  for (let k = 0; k <= nr; k++)
    for (let c = 0; c < nc; c++) {
      const a = k > 0 ? inMerge(table, k - 1, c) : undefined;
      const b = k < nr ? inMerge(table, k, c) : undefined;
      if (a && a === b) continue;
      out.push(
        `${String(cols[c])} ${String(rows[k])} m ${String(cols[c + 1])} ${String(rows[k])} l S`,
      );
    }
  for (let k = 0; k <= nc; k++)
    for (let r = 0; r < nr; r++) {
      const a = k > 0 ? inMerge(table, r, k - 1) : undefined;
      const b = k < nc ? inMerge(table, r, k) : undefined;
      if (a && a === b) continue;
      out.push(
        `${String(cols[k])} ${String(rows[r])} m ${String(cols[k])} ${String(rows[r + 1])} l S`,
      );
    }
  table.cells.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (!cell) return;
      const font = r < table.headerRows ? 'F2' : 'F1';
      cell.split('\n').forEach((line, i) => {
        out.push(text((cols[c] ?? 0) + 4, (rows[r] ?? 0) - 13 - i * 11, 9, line, font));
      });
    });
  });
  return out;
}

export const PIPE: ExpectedTable = {
  headerRows: 2,
  merges: [
    { r: 0, c: 0, rs: 2, cs: 1 },
    { r: 0, c: 1, rs: 1, cs: 2 },
    { r: 0, c: 3, rs: 1, cs: 2 },
    { r: 0, c: 5, rs: 2, cs: 1 },
  ],
  cells: [
    ['NPS', 'OD', '', 'Wall Sch 40', '', 'Remarks'],
    ['', 'mm', 'in', 'mm', 'in', ''],
    ['1/2', '21.3', '0.840', '2.77', '0.109', ''],
    ['3/4', '26.7', '1.050', '2.87', '0.113', ''],
    ['1', '33.4', '1.315', '3.38', '0.133', 'Seamless\nonly'],
    ['2', '60.3', '2.375', '3.91', '0.154', ''],
    ['3', '88.9', '3.500', '5.49', '0.216', ''],
    ['4', '114.3', '4.500', '6.02', '0.237', 'Stock'],
  ],
};

export const FLANGE: ExpectedTable = {
  headerRows: 1,
  merges: [],
  cells: [
    ['Class', '150', '300', '600'],
    ['Steel', '19.6', '51.1', '102.1'],
    ['Alloy', '17.7', '46.2', '92.3'],
    ['Stainless', '15.9', '41.4', '82.7'],
    ['Duplex', '20.0', '51.7', '103.4'],
  ],
};

const pipeRows = [500, 480, 460, 440, 406, 386, 366, 346];
function page1(): string {
  const pipeCols = [40, 80, 130, 180, 250, 300, 380];
  const flangeCols = [500, 570, 620, 670, 720];
  return [
    text(40, 540, 14, 'Pipe chart (fictional values)', 'F2'),
    ...ruled({ cols: pipeCols, rows: [520, ...pipeRows], table: PIPE }),
    ...ruled({ cols: flangeCols, rows: [520, 500, 480, 460, 440, 420], table: FLANGE }),
  ].join('\n');
}

export const PARTS: ExpectedTable = {
  headerRows: 1,
  merges: [],
  cells: [
    ['ITEM', 'QTY', 'PART NUMBER', 'DESCRIPTION', 'MATERIAL'],
    ['1', '2', 'PT-1001', 'Flange weld neck', 'A105'],
    ['2', '4', 'PT-1002', 'Stud bolt with two\nheavy hex nuts', 'B7'],
    ['3', '1', 'PT-1003', 'Gasket spiral wound', 'SS316'],
    ['4', '1', 'PT-1004', 'Nozzle neck', 'A106 B'],
    ['5', '8', 'PT-1005', 'Hex nut heavy', '2H'],
    ['6', '1', 'PT-1006', 'Reinforcement pad,\nsee detail 4', 'A516-70'],
    ['7', '2', 'PT-1007', 'Lifting lug', 'A36'],
    ['8', '1', 'PT-1008', 'Name plate bracket', 'SS304'],
  ],
};

/** An unruled table: columns at `xs`, rows `rowH` apart, wrapped lines 11 pt below. */
function stream(xs: number[], top: number, rowH: number, t: ExpectedTable): string[] {
  const out: string[] = [];
  let y = top;
  t.cells.forEach((row, r) => {
    const lines = Math.max(...row.map((c) => c.split('\n').length));
    row.forEach((cell, c) => {
      cell.split('\n').forEach((line, i) => {
        out.push(text(xs[c] ?? 0, y - i * 11, 9, line, r < t.headerRows ? 'F2' : 'F1'));
      });
    });
    y -= rowH + (lines - 1) * 11;
  });
  return out;
}

function page2(): string {
  return [
    text(60, 780, 14, 'Parts list', 'F2'),
    text(60, 760, 9, 'Drawing 4711, sheet 2. Quantities per assembly.'),
    ...stream([60, 110, 160, 260, 450], 730, 18, PARTS),
  ].join('\n');
}

export const BOLTS: ExpectedTable = {
  headerRows: 1,
  merges: [],
  cells: [
    ['Size', 'Torque Nm'],
    ['M12', '85'],
    ['M16', '210'],
    ['M20', '410'],
    ['M24', '710'],
    ['M30', '1400'],
  ],
};

export const GASKETS: ExpectedTable = {
  headerRows: 1,
  merges: [],
  cells: [
    ['Type', 'Thickness mm'],
    ['Spiral wound', '4.5'],
    ['Ring joint', '8.0'],
    ['Sheet', '1.5'],
    ['PTFE envelope', '3.0'],
    ['Kammprofile', '4.0'],
  ],
};

function page3(): string {
  return [
    text(60, 780, 14, 'Bolting and gaskets', 'F2'),
    // Independent tables: their own row pitch.
    ...stream([60, 140], 740, 18, BOLTS),
    ...stream([330, 440], 736, 15, GASKETS),
  ].join('\n');
}

const PROSE = [
  'This specification covers the supply of piping components for the plant.',
  'All materials shall be new and supplied with mill certificates.',
  'The supplier shall submit drawings for approval before fabrication starts,',
  'and shall keep records of all inspections for at least ten years.',
  'Deviations from this specification require written approval.',
];

function page5(): string {
  return [
    text(60, 780, 14, 'General requirements', 'F2'),
    ...PROSE.map((l, i) => text(60, 750 - i * 14, 10, l)),
  ].join('\n');
}

/** The five pages. Fonts: F1 Helvetica, F2 Helvetica-Bold; page 4 is one image. */
export function tablesPdf(): Uint8Array {
  const contents = [page1(), page2(), page3(), 'q 595 0 0 842 0 0 cm /Im1 Do Q', page5()];
  const sizes = ['0 0 842 595', '0 0 595 842', '0 0 595 842', '0 0 595 842', '0 0 595 842'];
  const n = contents.length;
  const fonts = 3 + n * 2;
  const image = fonts + 2;
  const objs: PdfObject[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${contents.map((_, i) => `${String(3 + i * 2)} 0 R`).join(' ')}] /Count ${String(n)} >>`,
  ];
  contents.forEach((c, i) => {
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [${sizes[i] ?? ''}] /Resources << /Font << /F1 ${String(fonts)} 0 R /F2 ${String(fonts + 1)} 0 R >> /XObject << /Im1 ${String(image)} 0 R >> >> /Contents ${String(4 + i * 2)} 0 R >>`,
      { dict: '<< >>', stream: c },
    );
  });
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objs.push(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  );
  // A 64 × 64 grey "scan" with darker stripes.
  const px = Buffer.alloc(64 * 64);
  for (let i = 0; i < px.length; i++) px[i] = (Math.floor(i / 64) % 8 < 2 ? 80 : 230) & 0xff;
  objs.push({
    dict: '<< /Type /XObject /Subtype /Image /Width 64 /Height 64 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode >>',
    stream: deflateSync(px).toString('latin1'),
  });
  return buildPdf(objs);
}

/** Expected tables per 0-based page (page 4 → OCR note, page 5 → none). */
export const EXPECTED: Record<number, ExpectedTable[]> = {
  0: [PIPE, FLANGE],
  1: [PARTS],
  2: [BOLTS, GASKETS],
  3: [],
  4: [],
};
