// Self-made review fixture for comment transfer (M4-20, M4-21; rule 13).
import { buildPdf, type PdfObject } from './generate.ts';

/**
 * Three pages; Ana's rectangle on page 1 with Bo's reply and an Accepted
 * state, Bo's oval on page 2, Ana's note on page 3.
 */
export function reviewSourcePdf(): Uint8Array {
  const page = (n: number, annots: string) =>
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Annots [${annots}] /Contents ${String(n)} 0 R >>`;
  const date = '/CreationDate (D:20260920100000Z) /M (D:20260921110000Z)';
  const objs: PdfObject[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>',
    page(4, '9 0 R 11 0 R 12 0 R'),
    { dict: '<< >>', stream: '' },
    page(6, '13 0 R'),
    { dict: '<< >>', stream: '' },
    page(8, '15 0 R'),
    { dict: '<< >>', stream: '' },
    `<< /Type /Annot /Subtype /Square /Rect [100 600 250 680] /NM (src-square) /T (Ana) /Contents (Check weld size) ${date} /F 4 /C [1 0 0] /AP << /N 10 0 R >> /P 3 0 R >>`,
    {
      dict: '<< /Type /XObject /Subtype /Form /BBox [100 600 250 680] >>',
      stream: '1 0 0 RG 2 w 101 601 148 78 re S',
    },
    `<< /Type /Annot /Subtype /Text /Rect [100 680 120 700] /IRT 9 0 R /NM (src-reply) /T (Bo) /Contents (Upgraded to 6 mm) ${date} /F 28 /P 3 0 R >>`,
    `<< /Type /Annot /Subtype /Text /Rect [100 680 120 700] /IRT 9 0 R /NM (src-state) /T (Ana) /Contents (Accepted set by Ana) /StateModel /Review /State /Accepted ${date} /F 30 /P 3 0 R >>`,
    `<< /Type /Annot /Subtype /Circle /Rect [300 300 400 380] /NM (src-oval) /T (Bo) /Contents (Too close) ${date} /F 4 /C [0 0 1] /AP << /N 14 0 R >> /P 5 0 R >>`,
    {
      dict: '<< /Type /XObject /Subtype /Form /BBox [300 300 400 380] >>',
      stream: '0 0 1 RG 2 w 350 301 m 399 340 l 350 379 l 301 340 l h S',
    },
    `<< /Type /Annot /Subtype /Text /Rect [60 60 80 80] /NM (src-note) /T (Ana) /Contents (Last page) ${date} /F 28 /Name /Comment /P 7 0 R >>`,
  ];
  return buildPdf(objs);
}

/**
 * Flatten fixture (M6-09). Page 1: a red rectangle with a pop-up, a reply and
 * an Accepted state; a blue filled rectangle over it (later in /Annots, so
 * drawn above) with a grouped part; a locked and a hidden rectangle; a link
 * and a redaction mark (never flattened). Page 2: an oval. Page 3: a note
 * without an appearance stream.
 */
export function flattenSourcePdf(): Uint8Array {
  const date = '/CreationDate (D:20261101100000Z) /M (D:20261101110000Z)';
  const ap = (rect: string, ops: string): PdfObject => ({
    dict: `<< /Type /XObject /Subtype /Form /BBox [${rect}] >>`,
    stream: ops,
  });
  const objs: PdfObject[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 18 0 R 21 0 R] /Count 3 >>',
    // 3: page 1
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Annots [5 0 R 7 0 R 8 0 R 10 0 R 11 0 R 12 0 R 13 0 R 14 0 R 15 0 R 16 0 R] >>',
    { dict: '<< >>', stream: '0 g 50 50 20 20 re f' },
    // 5: red rectangle, its pop-up 7
    `<< /Type /Annot /Subtype /Square /Rect [100 600 250 680] /NM (fl-red) /T (Ana) /Contents (Red) ${date} /F 4 /C [1 0 0] /AP << /N 6 0 R >> /Popup 7 0 R /P 3 0 R >>`,
    ap('100 600 250 680', '1 0 0 rg 100 600 150 80 re f'),
    '<< /Type /Annot /Subtype /Popup /Rect [260 600 400 680] /Parent 5 0 R /Open false >>',
    // 8: blue rectangle over the red one, drawn above it
    `<< /Type /Annot /Subtype /Square /Rect [200 640 300 720] /NM (fl-blue) /T (Bo) /Contents (Blue) ${date} /F 4 /C [0 0 1] /AP << /N 9 0 R >> /P 3 0 R >>`,
    ap('200 640 300 720', '0 0 1 rg 200 640 100 80 re f'),
    // 10, 11: the red one's reply and review state
    `<< /Type /Annot /Subtype /Text /Rect [100 680 120 700] /IRT 5 0 R /NM (fl-reply) /T (Bo) /Contents (Agreed) ${date} /F 28 /P 3 0 R >>`,
    `<< /Type /Annot /Subtype /Text /Rect [100 680 120 700] /IRT 5 0 R /NM (fl-state) /T (Ana) /Contents (Accepted set by Ana) /StateModel /Review /State /Accepted ${date} /F 30 /P 3 0 R >>`,
    // 12: a link; 13: a redaction mark
    '<< /Type /Annot /Subtype /Link /Rect [0 0 40 40] /NM (fl-link) /Border [0 0 0] /A << /S /URI /URI (https://example.com/) >> >>',
    '<< /Type /Annot /Subtype /Redact /Rect [400 400 450 450] /NM (fl-redact) /T (Ana) /QuadPoints [400 450 450 450 400 400 450 400] >>',
    // 14: locked; 15: hidden; 16: grouped with the blue one
    `<< /Type /Annot /Subtype /Square /Rect [100 100 150 150] /NM (fl-locked) /T (Ana) ${date} /F 132 /C [0 1 0] /AP << /N 17 0 R >> /P 3 0 R >>`,
    `<< /Type /Annot /Subtype /Square /Rect [200 100 250 150] /NM (fl-hidden) /T (Ana) ${date} /F 6 /C [0 1 0] /AP << /N 17 0 R >> /P 3 0 R >>`,
    `<< /Type /Annot /Subtype /Square /Rect [320 640 360 680] /NM (fl-group) /T (Bo) /IRT 8 0 R /RT /Group ${date} /F 4 /C [0 0 1] /AP << /N 17 0 R >> /P 3 0 R >>`,
    ap('0 0 50 50', '0 0.6 0 rg 0 0 50 50 re f'),
    // 18: page 2 with an oval
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 19 0 R /Annots [20 0 R] >>',
    { dict: '<< >>', stream: '' },
    `<< /Type /Annot /Subtype /Circle /Rect [300 300 400 380] /NM (fl-oval) /T (Bo) /Contents (Oval) ${date} /F 4 /C [0 0 1] /AP << /N 23 0 R >> /P 18 0 R >>`,
    // 21: page 3 with a note that has no appearance
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 22 0 R /Annots [24 0 R] >>',
    { dict: '<< >>', stream: '' },
    ap('300 300 400 380', '0 0 1 RG 4 w 350 302 m 398 340 l 350 378 l 302 340 l h S'),
    `<< /Type /Annot /Subtype /Text /Rect [60 60 80 80] /NM (fl-note) /T (Ana) /Contents (Last page) ${date} /F 28 /Name /Comment /P 21 0 R >>`,
  ];
  return buildPdf(objs);
}
