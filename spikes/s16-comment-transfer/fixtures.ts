// M4-19 fixtures: self-made Rev A / Rev B pairs (rule 13). Rev A carries one
// comment per M3 tool (made through EmbedPDF + our narrow Ctrl+S, so PDFium's
// own appearance streams) and, on page 3, hand-written annotations in the style
// of other viewers: custom /AP with font and image resources, /Popup, /RC,
// /IT + /Measure, a grouped label (/RT /Group), replies and a review state, a
// cloudy polygon, private keys, /OC and /StructParent, plus a link and a
// widget that must not be copied. Rev B is the same drawing re-issued, in
// several page geometries.
import { deflateSync } from 'node:zlib';
import { buildPdf, type PdfObject } from '../../e2e/fixtures/generate.ts';

export interface PageGeom {
  media: [number, number, number, number];
  crop?: [number, number, number, number];
  rotate?: number;
}

export const A4: PageGeom = { media: [0, 0, 595, 842] };

const flate = (s: string) => deflateSync(Buffer.from(s, 'latin1')).toString('latin1');

/**
 * `pages` pages with a few lines of text ("<label> page n …"), in the given
 * geometry. Text sits at the same place relative to the visible top-left
 * corner in every geometry, so Rev A comments land on the same words.
 */
export function revDoc(
  label: string,
  pages: number,
  geom: (i: number) => PageGeom = () => A4,
  extraPage2: PdfObject[] = [],
  page2Annots = '',
): Uint8Array {
  const objs: PdfObject[] = ['<< /Type /Catalog /Pages 2 0 R >>', ''];
  const font = 3;
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids: number[] = [];
  for (let i = 0; i < pages; i++) {
    const g = geom(i);
    const pageNum = objs.length + 1;
    kids.push(pageNum);
    const [x0, y0, , y1] = g.crop ?? g.media;
    // Visual top-left → user space, for rotations 0 and 90 (the fixtures' cases).
    const rot = g.rotate ?? 0;
    const lines: string[] = [];
    for (let k = 0; k < 12; k++) {
      const vx = 60;
      const vy = 62 + k * 16 + 40;
      const text = `${label} page ${String(i + 1)} line ${String(k + 1)}: flange bolt torque check`;
      if (rot === 90) {
        // visual (vx, vy) ↔ user (x0 + vy, y0 + vx) with the text running up the page.
        lines.push(
          `BT /F1 11 Tf 0 1 -1 0 ${String(x0 + vy + 10)} ${String(y0 + vx)} Tm (${text}) Tj ET`,
        );
      } else
        lines.push(`BT /F1 11 Tf ${String(x0 + vx)} ${String(y1 - vy - 10)} Td (${text}) Tj ET`);
    }
    const extra =
      (g.crop ? ` /CropBox [${g.crop.join(' ')}]` : '') + (rot ? ` /Rotate ${String(rot)}` : '');
    const annots = i === 2 && page2Annots ? ` /Annots ${page2Annots}` : '';
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [${g.media.join(' ')}]${extra} /Resources << /Font << /F1 ${String(font)} 0 R >> >> /Contents ${String(pageNum + 1)} 0 R /StructParents ${String(i)}${annots} >>`,
      { dict: '<< /Filter /FlateDecode >>', stream: flate(lines.join('\n')) },
    );
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.map((n) => `${String(n)} 0 R`).join(' ')}] /Count ${String(pages)} >>`;
  objs.push(...extraPage2);
  return buildPdf(objs);
}

/**
 * Rev A's page-3 annotations, written by hand like other viewers write them.
 * Object numbers start at `first` (after revDoc's own objects).
 */
export function foreignAnnotations(
  first: number,
  pageNum: number,
): { objs: PdfObject[]; annots: string } {
  const n = (k: number) => first + k;
  const R = (k: number) => `${String(n(k))} 0 R`;
  const P = `/P ${String(pageNum)} 0 R`;
  const date = '/CreationDate (D:20260920100000Z) /M (D:20260921110000Z)';
  // 8×8 RGB image, flate.
  const img = Buffer.alloc(8 * 8 * 3);
  for (let i = 0; i < 64; i++) img.set([30 + i * 3, 90, 200 - i * 2], i * 3);
  const objs: PdfObject[] = [
    // 0: Square, custom dashed appearance, popup, rich text, private key.
    `<< /Type /Annot /Subtype /Square /Rect [300 600 450 680] /NM (fx-square) /T (Acme Reviewer) /Subj (Rectangle) /Contents (Check weld size) /RC (<?xml version="1.0"?><body xmlns="http://www.w3.org/1999/xhtml"><p>Check <b>weld</b> size</p></body>) ${date} /F 4 /C [0 0.4 1] /BS << /W 3 /S /D /D [6 3] >> /AP << /N ${R(1)} >> /Popup ${R(2)} /PTX_Private << /Tool (Rect) /Rev 3 >> ${P} >>`,
    // 1: its appearance.
    {
      dict: '<< /Type /XObject /Subtype /Form /BBox [300 600 450 680] >>',
      stream: '0 0.4 1 RG 3 w [6 3] 0 d 301.5 601.5 147 77 re S',
    },
    // 2: popup.
    `<< /Type /Annot /Subtype /Popup /Rect [460 560 590 660] /Parent ${R(0)} /Open false ${P} >>`,
    // 3: FreeText callout with its own font resource.
    `<< /Type /Annot /Subtype /FreeText /IT /FreeTextCallout /Rect [60 420 260 520] /CL [70 430 120 470 150 470] /LE /OpenArrow /NM (fx-callout) /T (Acme Reviewer) /Contents (Torque to 120 Nm) /DA (/Helv 12 Tf 0 0 0 rg) /DS (font: Helvetica 12pt; color:#000000) ${date} /F 4 /C [1 1 0.8] /AP << /N ${R(4)} >> ${P} >>`,
    {
      dict: `<< /Type /XObject /Subtype /Form /BBox [60 420 260 520] /Resources << /Font << /Helv ${R(5)} >> >> >>`,
      stream:
        '1 1 0.8 rg 150 460 110 50 re f 0 0 0 RG 1 w 150 460 110 50 re S 70 430 m 120 470 l 150 470 l S BT /Helv 12 Tf 0 0 0 rg 155 490 Td (Torque to 120 Nm) Tj ET',
    },
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    // 6: image stamp: appearance form draws an image XObject.
    `<< /Type /Annot /Subtype /Stamp /Name /Approved /Rect [320 300 420 360] /NM (fx-stamp) /T (Acme QA) /Contents (Approved by QA) ${date} /F 4 /AP << /N ${R(7)} >> ${P} >>`,
    {
      dict: `<< /Type /XObject /Subtype /Form /BBox [0 0 100 60] /Resources << /XObject << /Im1 ${R(8)} >> >> >>`,
      stream: 'q 100 0 0 60 0 0 cm /Im1 Do Q 0 0.6 0 RG 2 w 1 1 98 58 re S',
    },
    {
      dict: '<< /Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode >>',
      stream: deflateSync(img).toString('latin1'),
    },
    // 9: distance measurement (Line, /IT /LineDimension, /Measure).
    `<< /Type /Annot /Subtype /Line /IT /LineDimension /Rect [60 200 360 240] /L [70 220 350 220] /LE [/OpenArrow /OpenArrow] /LL 10 /LLE 4 /Cap true /NM (fx-measure) /T (Acme Reviewer) /Contents (2.80 m) ${date} /F 4 /C [1 0 0] /Measure << /Type /Measure /Subtype /RL /R (1 in = 1 m) /X [<< /Type /NumberFormat /U (m) /C 0.0138889 /D 100 >>] /D [<< /Type /NumberFormat /U (m) /C 1 /D 100 >>] /A [<< /Type /NumberFormat /U (sq m) /C 1 /D 100 >>] >> /AP << /N ${R(10)} >> ${P} >>`,
    {
      dict: '<< /Type /XObject /Subtype /Form /BBox [60 200 360 240] >>',
      stream: '1 0 0 RG 1 w 70 220 m 350 220 l S 70 216 m 70 234 l S 350 216 m 350 234 l S',
    },
    // 11: its label, grouped with it.
    `<< /Type /Annot /Subtype /FreeText /Rect [180 236 260 252] /IRT ${R(9)} /RT /Group /NM (fx-measure-label) /T (Acme Reviewer) /Contents (2.80 m) /DA (/Helv 9 Tf 1 0 0 rg) ${date} /F 4 /AP << /N ${R(12)} >> ${P} >>`,
    {
      dict: `<< /Type /XObject /Subtype /Form /BBox [180 236 260 252] /Resources << /Font << /Helv ${R(5)} >> >> >>`,
      stream: 'BT /Helv 9 Tf 1 0 0 rg 185 240 Td (2.80 m) Tj ET',
    },
    // 13: a reply to the square, 14: a review state on it.
    `<< /Type /Annot /Subtype /Text /Rect [300 680 320 700] /IRT ${R(0)} /NM (fx-reply) /T (Vendor) /Contents (Weld upgraded to 6 mm) ${date} /F 28 /Name /Comment ${P} >>`,
    `<< /Type /Annot /Subtype /Text /Rect [300 680 320 700] /IRT ${R(0)} /NM (fx-state) /T (Acme Reviewer) /Contents (Accepted set by Acme Reviewer) /StateModel /Review /State /Accepted ${date} /F 30 ${P} >>`,
    // 15: cloudy polygon.
    `<< /Type /Annot /Subtype /Polygon /Rect [380 420 560 540] /Vertices [390 430 550 430 550 530 390 530] /BE << /S /C /I 1 >> /NM (fx-cloud) /T (Acme Reviewer) /Contents (Revise this area) ${date} /F 4 /C [1 0 0] /AP << /N ${R(16)} >> ${P} >>`,
    {
      dict: '<< /Type /XObject /Subtype /Form /BBox [380 420 560 540] >>',
      stream: '1 0 0 RG 1.5 w 390 430 m 550 430 l 550 530 l 390 530 l h S',
    },
    // 17: optional content + structure: both dropped on copy.
    `<< /Type /Annot /Subtype /Circle /Rect [80 60 180 140] /NM (fx-oc) /T (Acme Reviewer) /Contents (On a layer) ${date} /F 4 /C [0.5 0 0.5] /OC ${R(18)} /StructParent 7 /AP << /N ${R(19)} >> ${P} >>`,
    '<< /Type /OCG /Name (Review layer) >>',
    {
      dict: '<< /Type /XObject /Subtype /Form /BBox [80 60 180 140] >>',
      stream:
        '0.5 0 0.5 RG 2 w 130 100 m 130 127 107 138 80 100 c S 130 100 m 130 73 153 62 180 100 c S',
    },
    // 20: a link and 21: a widget (not comments).
    `<< /Type /Annot /Subtype /Link /Rect [60 740 200 760] /A << /S /URI /URI (https://example.com) >> ${P} >>`,
    `<< /Type /Annot /Subtype /Widget /FT /Tx /T (field) /Rect [400 740 560 760] /F 4 ${P} >>`,
  ];
  const annots = `[${[0, 2, 3, 6, 9, 11, 13, 14, 15, 17, 20, 21].map(R).join(' ')}]`;
  return { objs, annots };
}
