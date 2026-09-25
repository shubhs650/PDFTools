// Self-made S4 fixtures with known content (CLAUDE.md rule 13). Values are
// fictional (no copyrighted standards such as ASME B36.10 are reproduced).
//   page 1: lattice table (fully ruled), pipe-chart style
//   page 2: stream table (no rules), parts-list style
//   page 3: lattice table with a merged header cell
//   page 4: structure page — headings, two columns, bullet + numbered lists

import { buildPdf } from '../shared/mini-pdf.ts';

export const LATTICE = {
  header: ['NPS', 'OD mm', 'Sch 10 mm', 'Sch 40 mm', 'Sch 80 mm'],
  rows: [
    ['1/2', '20.9', '2.03', '2.71', '3.61'],
    ['3/4', '26.2', '2.07', '2.83', '3.87'],
    ['1', '33.1', '2.71', '3.32', '4.49'],
    ['1-1/2', '48.0', '2.73', '3.64', '5.03'],
    ['2', '60.1', '2.74', '3.87', '5.49'],
    ['3', '88.7', '3.03', '5.46', '7.58'],
    ['4', '114.1', '3.02', '6.00', '8.54'],
    ['6', '168.0', '3.39', '7.08', '10.93'],
  ],
};

export const STREAM = {
  header: ['ITEM', 'QTY', 'PART NUMBER', 'DESCRIPTION', 'MATERIAL'],
  rows: [
    ['1', '2', 'PT-1001', 'Flange weld neck', 'A105'],
    ['2', '4', 'PT-1002', 'Stud bolt with nuts', 'B7'],
    ['3', '1', 'PT-1003', 'Gasket spiral wound', 'SS316'],
    ['4', '1', 'PT-1004', 'Nozzle neck', 'A106 B'],
    ['5', '8', 'PT-1005', 'Hex nut heavy', '2H'],
    ['6', '1', 'PT-1006', 'Reinforcement pad', 'A516-70'],
    ['7', '2', 'PT-1007', 'Lifting lug', 'A36'],
    ['8', '1', 'PT-1008', 'Name plate bracket', 'SS304'],
  ],
};

export const MERGED = {
  header1: ['Mark', 'Dimensions mm', 'Weight'],
  header2: ['', 'L', 'W', 'H', 'kg'],
  rows: [
    ['B1', '1200', '300', '250', '41.5'],
    ['B2', '1500', '300', '250', '52.0'],
    ['C1', '800', '400', '400', '33.8'],
    ['C2', '950', '400', '400', '40.1'],
    ['P1', '600', '600', '20', '56.4'],
    ['P2', '700', '650', '25', '89.3'],
  ],
};

export const STRUCTURE = {
  h1: 'Section 1 Scope of Work',
  h2: '1.1 Purpose',
  left: [
    'This specification covers the design,',
    'fabrication and testing of pressure',
    'vessels supplied under this contract.',
    'Left column paragraph ends here.',
  ],
  right: [
    'Right column starts with this line',
    'and continues with the requirements',
    'for inspection and documentation.',
    'Right column paragraph ends here.',
  ],
  bullets: ['Materials shall be certified', 'Welds shall be examined', 'Records shall be retained'],
  numbered: ['Submit drawings', 'Obtain approval', 'Start fabrication'],
};

const esc = (s: string): string => s.replace(/[\\()]/g, (c) => `\\${c}`);
const text = (x: number, y: number, size: number, s: string, font = 'F1'): string =>
  `BT /${font} ${String(size)} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${esc(s)}) Tj ET`;

function lattice(
  x0: number,
  y0: number,
  colW: number[],
  rowH: number,
  cells: string[][],
): string[] {
  const out: string[] = ['0.8 w'];
  const W = colW.reduce((a, b) => a + b, 0);
  const H = rowH * cells.length;
  for (let r = 0; r <= cells.length; r++)
    out.push(
      `${String(x0)} ${String(y0 - r * rowH)} m ${String(x0 + W)} ${String(y0 - r * rowH)} l S`,
    );
  let x = x0;
  for (let c = 0; c <= colW.length; c++) {
    out.push(`${String(x)} ${String(y0)} m ${String(x)} ${String(y0 - H)} l S`);
    x += colW[c] ?? 0;
  }
  cells.forEach((row, r) => {
    let cx = x0;
    row.forEach((cell, c) => {
      if (cell) out.push(text(cx + 5, y0 - r * rowH - rowH + 6, 10, cell, r === 0 ? 'F2' : 'F1'));
      cx += colW[c] ?? 0;
    });
  });
  return out;
}

function page1(): string {
  const cells = [LATTICE.header, ...LATTICE.rows];
  return [
    text(60, 780, 16, 'Table 1 Pipe wall thickness (fictional values)', 'F2'),
    ...lattice(60, 750, [70, 80, 90, 90, 90], 20, cells),
  ].join('\n');
}

function page2(): string {
  const xs = [60, 110, 160, 260, 450];
  const out = [text(60, 780, 16, 'Parts list', 'F2')];
  [STREAM.header, ...STREAM.rows].forEach((row, r) => {
    row.forEach((cell, c) =>
      out.push(text(xs[c] ?? 0, 740 - r * 18, 10, cell, r === 0 ? 'F2' : 'F1')),
    );
  });
  return out.join('\n');
}

function page3(): string {
  const colW = [70, 80, 80, 80, 80];
  const [c0 = 0, , , , c4 = 0] = colW;
  const x0 = 60;
  const y0 = 740;
  const rowH = 20;
  const all = [MERGED.header2, ...MERGED.rows];
  const out = [text(60, 780, 16, 'Table 3 Member schedule', 'F2'), '0.8 w'];
  const W = colW.reduce((a, b) => a + b, 0);
  // Merged first header row: Mark | Dimensions (3 cols) | Weight
  const rowsTotal = all.length + 1;
  for (let r = 0; r <= rowsTotal; r++) {
    const y = y0 - r * rowH;
    // Row 1's bottom border under "Mark" is omitted (Mark spans both header rows).
    if (r === 1) out.push(`${String(x0 + c0)} ${String(y)} m ${String(x0 + W)} ${String(y)} l S`);
    else out.push(`${String(x0)} ${String(y)} m ${String(x0 + W)} ${String(y)} l S`);
  }
  let x = x0;
  for (let c = 0; c <= colW.length; c++) {
    const inner = c === 2 || c === 3; // no verticals inside the merged "Dimensions" header cell
    out.push(
      `${String(x)} ${String(inner ? y0 - rowH : y0)} m ${String(x)} ${String(y0 - rowsTotal * rowH)} l S`,
    );
    x += colW[c] ?? 0;
  }
  out.push(text(x0 + 5, y0 - rowH - 6, 10, 'Mark', 'F2'));
  out.push(text(x0 + c0 + 5, y0 - rowH + 6, 10, 'Dimensions mm', 'F2'));
  out.push(text(x0 + W - c4 + 5, y0 - rowH + 6, 10, 'Weight', 'F2'));
  all.forEach((row, r) => {
    let cx = x0;
    row.forEach((cell, c) => {
      if (cell)
        out.push(text(cx + 5, y0 - (r + 1) * rowH - rowH + 6, 10, cell, r === 0 ? 'F2' : 'F1'));
      cx += colW[c] ?? 0;
    });
  });
  return out.join('\n');
}

function page4(): string {
  const S = STRUCTURE;
  const out = [text(60, 780, 22, S.h1, 'F2'), text(60, 745, 15, S.h2, 'F2')];
  S.left.forEach((l, i) => out.push(text(60, 715 - i * 14, 10, l)));
  S.right.forEach((l, i) => out.push(text(320, 715 - i * 14, 10, l)));
  // WinAnsiEncoding bullet is byte 0x95 (mini-pdf writes Latin-1 bytes).
  S.bullets.forEach((l, i) => out.push(text(60, 620 - i * 14, 10, `\u0095 ${l}`)));
  S.numbered.forEach((l, i) => out.push(text(60, 560 - i * 14, 10, `${String(i + 1)}. ${l}`)));
  return out.join('\n');
}

export function s4Fixture(): Uint8Array {
  const pages = [page1(), page2(), page3(), page4()];
  const objs: (string | { dict: string; stream: string })[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${String(3 + i * 2)} 0 R`).join(' ')}] /Count ${String(pages.length)} >>`,
  ];
  const fonts = 3 + pages.length * 2;
  pages.forEach((c, i) => {
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 ${String(fonts)} 0 R /F2 ${String(fonts + 1)} 0 R >> >> /Contents ${String(4 + i * 2)} 0 R >>`,
    );
    objs.push({ dict: '<< >>', stream: c });
  });
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objs.push(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  );
  return buildPdf(objs);
}
