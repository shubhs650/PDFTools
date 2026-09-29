// Self-made extraction fixtures (CLAUDE.md rule 13), promoted from the S4 spike
// (spikes/s4-oxide/fixtures.ts, ADR-009) for the M4 exports and tables. Values
// are fictional (no copyrighted standard is reproduced).
//   page 1: lattice table (fully ruled), pipe-chart style
//   page 2: stream table (no rules), parts-list style
//   page 3: lattice table with a merged header cell
//   page 4: structure — headings, two columns, bullet and numbered lists
//   page 5: a heading, a paragraph, an image, a paragraph (M4-Q6 image order)
//   page 6: text that looks like markup (inert in every export)
//   page 7: no text at all (a "scanned" page)
import { deflateSync } from 'node:zlib';
import { buildPdf, type PdfObject } from './generate.ts';

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

export const IMAGE_PAGE = {
  heading: 'Figure page heading',
  before: 'Paragraph above the figure.',
  after: 'Paragraph below the figure.',
  /** The image's size in pixels and where it sits (x, y, w, h in points). */
  pixels: [48, 32] as const,
  box: [72, 520, 240, 160] as const,
};

export const HOSTILE = [
  '<script>alert(1)</script>',
  '[click](javascript:alert(2))',
  '<img src=x onerror=alert(3)>',
];

function page5(): string {
  const [x, y, w, h] = IMAGE_PAGE.box;
  return [
    text(72, 760, 20, IMAGE_PAGE.heading, 'F2'),
    text(72, 720, 11, IMAGE_PAGE.before),
    `q ${String(w)} 0 0 ${String(h)} ${String(x)} ${String(y)} cm /Im1 Do Q`,
    text(72, 480, 11, IMAGE_PAGE.after),
  ].join('\n');
}

function page6(): string {
  return HOSTILE.map((s, i) => text(72, 760 - i * 30, 12, s)).join('\n');
}

/** A gradient, so a copied image is recognisable. */
function rgb(w: number, h: number): string {
  let s = '';
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) s += String.fromCharCode((x * 5) & 255, (y * 7) & 255, 128);
  return s;
}

export function extractionFixture(): Uint8Array {
  const pages = [page1(), page2(), page3(), page4(), page5(), page6(), ''];
  const n = pages.length;
  const fonts = 3 + n * 2;
  const image = fonts + 2;
  const objs: PdfObject[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${String(3 + i * 2)} 0 R`).join(' ')}] /Count ${String(n)} >>`,
  ];
  pages.forEach((c, i) => {
    const xobj = i === 4 ? ` /XObject << /Im1 ${String(image)} 0 R >>` : '';
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 ${String(fonts)} 0 R /F2 ${String(fonts + 1)} 0 R >>${xobj} >> /Contents ${String(4 + i * 2)} 0 R >>`,
    );
    objs.push({ dict: '<< >>', stream: c });
  });
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objs.push(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  );
  const [pw, ph] = IMAGE_PAGE.pixels;
  objs.push({
    dict: `<< /Type /XObject /Subtype /Image /Width ${String(pw)} /Height ${String(ph)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode >>`,
    stream: deflateSync(Buffer.from(rgb(pw, ph), 'latin1')).toString('latin1'),
  });
  return buildPdf(objs);
}

/** A 24 × 24 baseline JPEG gradient, drawn once by Chromium's canvas for these fixtures (self-made). */
export const JPEG_24 = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAYABgDASIAAhEBAxEB/8QAGAABAQEBAQAAAAAAAAAAAAAAAAcGAgj/xAAbEAABBQEBAAAAAAAAAAAAAAAABQYjMqEBIv/EABgBAAIDAAAAAAAAAAAAAAAAAAYIBQcJ/8QAIBEAAQMEAgMAAAAAAAAAAAAAAAMEIgUGITEBEhQkMv/aAAwDAQACEQMRAD8A8WojK55jwoCIyqx4b1EZXPMeFARGVWPC8X9e3kjLRub5kYJEZVY8BfURlVjwAEvXp7G4pVzetxI4RGVzzHhQERlVjwABX7xbOTLG0X68ZFARGVWPAAAK7xbvsbilP1/G4kf/2Q==',
  'base64',
);

/**
 * Image export (M4-06): page 1 a JPEG (DCTDecode), a Flate RGB image, a 4 × 4
 * dot (below the size limit) and a logo; page 2 the same logo again, an image
 * with a soft mask (alpha) and an inline image; page 3 an image inside a Form
 * XObject. Expected output: 6 files (logo once), 1 skipped, 1 duplicate.
 */
export function imagesPdf(): Uint8Array {
  const flate = (s: string) => deflateSync(Buffer.from(s, 'latin1')).toString('latin1');
  const img = (w: number, h: number, extra = '') => ({
    dict: `<< /Type /XObject /Subtype /Image /Width ${String(w)} /Height ${String(h)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${extra} >>`,
    stream: flate(rgb(w, h)),
  });
  let alpha = '';
  for (let i = 0; i < 20 * 20; i++) alpha += String.fromCharCode((i * 3) & 255);
  let inline = '';
  for (let i = 0; i < 16 * 16; i++) inline += String.fromCharCode(200, (i * 5) & 255, 40);
  // 1 catalog, 2 pages, 3-8 pages+contents, 9 JPEG, 10 RGB, 11 dot, 12 logo, 13 masked, 14 its SMask, 15 form, 16 the form's image
  const objs: PdfObject[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /J 9 0 R /R 10 0 R /D 11 0 R /L 12 0 R >> >> /Contents 4 0 R >>',
    {
      dict: '<< >>',
      stream:
        'q 96 0 0 96 50 600 cm /J Do Q q 160 0 0 80 200 600 cm /R Do Q q 8 0 0 8 400 600 cm /D Do Q q 64 0 0 64 50 400 cm /L Do Q',
    },
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /L 12 0 R /M 13 0 R >> >> /Contents 6 0 R >>',
    {
      dict: '<< >>',
      stream: `q 64 0 0 64 50 600 cm /L Do Q q 80 0 0 80 200 600 cm /M Do Q q 64 0 0 64 50 400 cm BI /W 16 /H 16 /CS /RGB /BPC 8 ID ${inline} EI Q`,
    },
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /F 15 0 R >> >> /Contents 8 0 R >>',
    { dict: '<< >>', stream: 'q 1 0 0 1 100 500 cm /F Do Q' },
    {
      dict: '<< /Type /XObject /Subtype /Image /Width 24 /Height 24 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode >>',
      stream: JPEG_24.toString('latin1'),
    },
    img(40, 20),
    img(4, 4),
    img(32, 32),
    img(20, 20, ' /SMask 14 0 R'),
    {
      dict: '<< /Type /XObject /Subtype /Image /Width 20 /Height 20 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode >>',
      stream: flate(alpha),
    },
    {
      dict: '<< /Type /XObject /Subtype /Form /BBox [0 0 200 200] /Resources << /XObject << /I 16 0 R >> >> >>',
      stream: 'q 120 0 0 60 0 0 cm /I Do Q',
    },
    img(30, 30),
  ];
  return buildPdf(objs);
}

/** `pages` pages, each with two distinct 64 × 64 images and one logo shared by all (M4-06 perf). */
export function imageHeavyPdf(pages: number): Uint8Array {
  const img = (seed: number) => {
    let s = '';
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++)
        s += String.fromCharCode(
          (x * 4 + seed) & 255,
          (y * 4 + seed * 3) & 255,
          ((seed >> 8) * 60 + 7) & 255,
        );
    return {
      dict: '<< /Type /XObject /Subtype /Image /Width 64 /Height 64 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode >>',
      stream: deflateSync(Buffer.from(s, 'latin1')).toString('latin1'),
    };
  };
  // 1 catalog, 2 pages, then per page: page, contents, image A, image B; last: the logo.
  const logo = 3 + pages * 4;
  const objs: PdfObject[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${String(3 + i * 4)} 0 R`).join(' ')}] /Count ${String(pages)} >>`,
  ];
  for (let i = 0; i < pages; i++) {
    const p = 3 + i * 4;
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /A ${String(p + 2)} 0 R /B ${String(p + 3)} 0 R /L ${String(logo)} 0 R >> >> /Contents ${String(p + 1)} 0 R >>`,
      {
        dict: '<< >>',
        stream:
          'q 200 0 0 200 50 500 cm /A Do Q q 200 0 0 200 300 500 cm /B Do Q q 40 0 0 40 50 50 cm /L Do Q',
      },
      img(i * 2 + 1),
      img(i * 2 + 2),
    );
  }
  objs.push(img(0));
  return buildPdf(objs);
}
