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
