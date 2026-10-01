// M4-02 spike fixtures (ADR-017): a self-made adversarial file for redaction
// (rule 13). Every secret is a unique canary word, so a leak anywhere in the
// output — page content, annotations, metadata, outlines, names — can be
// found by name. Each page has one /Redact annotation (black /IC) over the
// rectangle R (or R6 on the offset page), as another viewer would leave it
// after "Mark for redaction" (M4-Q3).
import { deflateSync } from 'node:zlib';
import { buildPdf, type PdfObject } from './generate.ts';

/** Redaction rectangle in default user space: [x0, y0, x1, y1]. */
export const R: [number, number, number, number] = [140, 495, 330, 552];
/** The crop-offset page's rectangle (its MediaBox starts at 100, 100). */
export const R6: [number, number, number, number] = [240, 620, 430, 652];

/** Canaries that are inside a redacted rectangle and nowhere else. */
export const SECRETS = [
  'SECRETALPHA',
  'UNDERMIKE',
  'HIDDENBRAVO',
  'WHITECHARLIE',
  'FORMDELTA',
  'ROTATEDNOVEMBER',
  'OFFSETOSCAR',
  'ANNOTECHO',
  'FIELDFOXTROT',
  'LAYERPAPA',
] as const;
/** Inside a rectangle and also outside: must NOT fail the string check. */
export const REPEATED = 'REPEATKILO';
/** Hidden document-level data the sanitize step must remove. */
export const HIDDEN = [
  'INFOGOLF',
  'XMPHOTEL',
  'OUTLINEINDIA',
  'JSQUEBEC',
  'ATTACHROMEO',
  'PIECESIERRA',
  'ALTJULIET',
  'THUMBTANGO',
] as const;
/** Must survive: outside every rectangle. */
export const KEPT = ['PUBLICLEFT', 'PUBLICRIGHT', 'KEEPNOTE', 'SAFEOUTLINE'] as const;

const rect = (r: readonly number[]) => r.join(' ');

/** A w×h RGB image as a latin-1 string: a gradient, so a copied pixel is detectable. */
function rgb(w: number, h: number): string {
  let s = '';
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      s += String.fromCharCode((x * 7) & 255, (y * 13) & 255, ((x + y) * 5) & 255);
  return s;
}

const deflate = (s: string) => deflateSync(Buffer.from(s, 'latin1')).toString('latin1');

/**
 * Pages (1-based): 1 plain text, straddling word, repeated word; 2 text under
 * an image larger than R; 3 invisible (3 Tr), white and Form XObject text;
 * 4 inline image and vector paths through R; 5 /Rotate 90; 6 crop-offset
 * MediaBox; 7 annotations in R (FreeText, Link, Widget) and outside
 * (Square, Text); 8 text in a hidden optional-content layer; 9 a stroked line
 * crossing R inside a Form XObject.
 */
export function adversarialPdf(): Uint8Array {
  // Object numbers (1-based): fixed layout, written out explicitly.
  const CAT = 1;
  const PAGES = 2;
  const FONT = 3;
  const page = (i: number) => 4 + i * 2; // page i (0-based) → page dict; +1 = contents
  const N = 9;
  let next = 4 + N * 2; // 20
  const alloc = () => next++;
  const IMG = alloc(); // 20 image XObject (page 2)
  const FORMX = alloc(); // 21 form XObject (page 3)
  const OCG = alloc(); // 22
  const redact = Array.from({ length: N }, alloc); // 23..30
  const FREETEXT = alloc();
  const FREETEXT_AP = alloc();
  const LINK = alloc();
  const WIDGET = alloc();
  const SQUARE = alloc();
  const NOTE = alloc();
  const INFO = alloc();
  const XMP = alloc();
  const OUTLINES = alloc();
  const OUT1 = alloc();
  const OUT2 = alloc();
  const JS = alloc();
  const EMB = alloc();
  const EMBF = alloc();
  const THUMB = alloc();
  const STRUCT = alloc();
  const SELEM = alloc();
  const FORMPATH = alloc();

  const objs: PdfObject[] = [];
  const set = (num: number, o: PdfObject) => {
    objs[num - 1] = o;
  };
  set(
    CAT,
    `<< /Type /Catalog /Pages ${String(PAGES)} 0 R /Outlines ${String(OUTLINES)} 0 R /Metadata ${String(XMP)} 0 R` +
      ` /AcroForm << /Fields [${String(WIDGET)} 0 R] /DA (/Helv 12 Tf 0 g) >>` +
      ` /OCProperties << /OCGs [${String(OCG)} 0 R] /D << /OFF [${String(OCG)} 0 R] >> >>` +
      ` /Names << /JavaScript << /Names [(init) ${String(JS)} 0 R] >> /EmbeddedFiles << /Names [(orig.txt) ${String(EMB)} 0 R] >> >>` +
      ` /StructTreeRoot ${String(STRUCT)} 0 R /MarkInfo << /Marked true >> /PieceInfo << /App << /Private (PIECESIERRA) >> >> >>`,
  );
  set(
    PAGES,
    `<< /Type /Pages /Kids [${Array.from({ length: N }, (_, i) => `${String(page(i))} 0 R`).join(' ')}] /Count ${String(N)} >>`,
  );
  set(FONT, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  const T = (x: number, y: number, s: string, size = 14) =>
    `BT /F1 ${String(size)} Tf ${String(x)} ${String(y)} Td (${s}) Tj ET`;
  const contents: string[] = [
    // 1: plain, straddling, repeated inside and outside
    [
      T(72, 700, 'PUBLICLEFT'),
      T(150, 530, 'SECRETALPHA'),
      T(150, 505, 'REPEATKILO'),
      T(300, 515, 'STRADDLELIMA'),
      T(72, 300, 'REPEATKILO'),
      T(350, 700, 'PUBLICRIGHT'),
    ].join('\n'),
    // 2: text under an image that is larger than R
    [T(150, 520, 'UNDERMIKE'), 'q 300 0 0 100 100 480 cm /Im1 Do Q', T(72, 700, 'Page two')].join(
      '\n',
    ),
    // 3: invisible, white, and Form XObject text
    [
      'BT 3 Tr /F1 12 Tf 150 540 Td (HIDDENBRAVO) Tj ET',
      '1 1 1 rg',
      T(150, 520, 'WHITECHARLIE', 12),
      '0 0 0 rg',
      'q 1 0 0 1 150 500 cm /Fm1 Do Q',
    ].join('\n'),
    // 4: inline image across R; a line through R; a filled triangle in R; a curve through R
    [
      `q 200 0 0 60 120 490 cm BI /W 8 /H 8 /CS /RGB /BPC 8 ID ${rgb(8, 8)} EI Q`,
      '0 0 1 RG 2 w 50 520 m 500 520 l S',
      '1 0 0 rg 200 500 m 260 545 l 300 500 l f',
      '0 1 0 RG 60 400 m 150 600 250 450 520 540 c S',
    ].join('\n'),
    // 5: rotated page
    T(150, 520, 'ROTATEDNOVEMBER'),
    // 6: crop-offset MediaBox [100 100 695 942]
    T(250, 630, 'OFFSETOSCAR'),
    // 7: annotations page
    T(72, 700, 'Annotations page'),
    // 8: hidden layer
    `/OC /L1 BDC ${T(150, 520, 'LAYERPAPA')} EMC\n${T(72, 700, 'Layer page')}`,
    // 9: a line through R inside a Form XObject
    `${T(72, 700, 'Form path page')}\nq 1 0 0 1 0 0 cm /Fm2 Do Q`,
  ];

  for (let i = 0; i < N; i++) {
    const r = i === 5 ? R6 : R;
    const media = i === 5 ? '[100 100 695 942]' : '[0 0 595 842]';
    const extra: string[] = [];
    const annots = [redact[i] ?? 0];
    if (i === 0)
      extra.push(
        `/Thumb ${String(THUMB)} 0 R /PieceInfo << /App << /Private (PIECESIERRA) >> >> /StructParents 0`,
      );
    if (i === 4) extra.push('/Rotate 90');
    if (i === 6) annots.push(FREETEXT, LINK, WIDGET, SQUARE, NOTE);
    const xobj =
      i === 1
        ? ` /XObject << /Im1 ${String(IMG)} 0 R >>`
        : i === 2
          ? ` /XObject << /Fm1 ${String(FORMX)} 0 R >>`
          : i === 8
            ? ` /XObject << /Fm2 ${String(FORMPATH)} 0 R >>`
            : '';
    const props = i === 7 ? ` /Properties << /L1 ${String(OCG)} 0 R >>` : '';
    set(
      page(i),
      `<< /Type /Page /Parent ${String(PAGES)} 0 R /MediaBox ${media} /Resources << /Font << /F1 ${String(FONT)} 0 R >>${xobj}${props} >>` +
        ` /Contents ${String(page(i) + 1)} 0 R /Annots [${annots.map((a) => `${String(a)} 0 R`).join(' ')}] ${extra.join(' ')} >>`,
    );
    set(page(i) + 1, { dict: '<< >>', stream: contents[i] ?? '' });
    set(
      redact[i] ?? 0,
      `<< /Type /Annot /Subtype /Redact /Rect [${rect(r)}] /IC [0 0 0] /NM (redact-${String(i + 1)}) /T (Reviewer)${i === 0 ? ' /OverlayText (REDACTED)' : ''} /P ${String(page(i))} 0 R >>`,
    );
  }

  set(IMG, {
    dict: '<< /Type /XObject /Subtype /Image /Width 32 /Height 16 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode >>',
    stream: deflate(rgb(32, 16)),
  });
  set(FORMX, {
    dict: `<< /Type /XObject /Subtype /Form /BBox [0 0 200 20] /Resources << /Font << /F1 ${String(FONT)} 0 R >> >> >>`,
    stream: 'BT /F1 12 Tf 0 2 Td (FORMDELTA) Tj ET',
  });
  set(OCG, '<< /Type /OCG /Name (Hidden layer) >>');
  set(
    FREETEXT,
    `<< /Type /Annot /Subtype /FreeText /Rect [150 510 320 540] /Contents (ANNOTECHO) /DA (/Helv 12 Tf 0 g) /NM (ft-1) /AP << /N ${String(FREETEXT_AP)} 0 R >> /P ${String(page(6))} 0 R >>`,
  );
  set(FREETEXT_AP, {
    dict: `<< /Type /XObject /Subtype /Form /BBox [150 510 320 540] /Resources << /Font << /F1 ${String(FONT)} 0 R >> >> >>`,
    stream: 'BT /F1 12 Tf 155 520 Td (ANNOTECHO) Tj ET',
  });
  set(
    LINK,
    `<< /Type /Annot /Subtype /Link /Rect [160 500 200 510] /Border [0 0 0] /A << /S /URI /URI (https://example.com/secret) >> >>`,
  );
  set(
    WIDGET,
    `<< /Type /Annot /Subtype /Widget /FT /Tx /T (secretField) /V (FIELDFOXTROT) /Rect [220 500 320 520] /F 4 /DA (/Helv 12 Tf 0 g) /P ${String(page(6))} 0 R >>`,
  );
  set(
    SQUARE,
    `<< /Type /Annot /Subtype /Square /Rect [400 100 500 200] /C [1 0 0] /Contents (square outside) /NM (sq-out) >>`,
  );
  set(
    NOTE,
    `<< /Type /Annot /Subtype /Text /Rect [400 700 420 720] /Contents (KEEPNOTE) /NM (note-out) >>`,
  );
  set(INFO, '<< /Title (INFOGOLF) /Author (Someone) /Producer (spike) >>');
  set(XMP, {
    dict: '<< /Type /Metadata /Subtype /XML >>',
    stream:
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>XMPHOTEL</dc:title></rdf:Description></rdf:RDF></x:xmpmeta>',
  });
  set(
    OUTLINES,
    `<< /Type /Outlines /First ${String(OUT1)} 0 R /Last ${String(OUT2)} 0 R /Count 2 >>`,
  );
  set(
    OUT1,
    `<< /Title (OUTLINEINDIA) /Parent ${String(OUTLINES)} 0 R /Next ${String(OUT2)} 0 R /Dest [${String(page(0))} 0 R /XYZ 160 540 0] >>`,
  );
  set(
    OUT2,
    `<< /Title (SAFEOUTLINE) /Parent ${String(OUTLINES)} 0 R /Prev ${String(OUT1)} 0 R /Dest [${String(page(1))} 0 R /XYZ 0 842 0] >>`,
  );
  set(JS, '<< /S /JavaScript /JS (app.alert\\("JSQUEBEC"\\);) >>');
  set(EMB, `<< /Type /Filespec /F (orig.txt) /EF << /F ${String(EMBF)} 0 R >> >>`);
  set(EMBF, { dict: '<< /Type /EmbeddedFile >>', stream: 'ATTACHROMEO original unredacted text' });
  set(THUMB, {
    dict: '<< /Width 4 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /Metadata << /Note (THUMBTANGO) >> >>',
    stream: 'THUMBTAN',
  });
  set(STRUCT, `<< /Type /StructTreeRoot /K [${String(SELEM)} 0 R] >>`);
  set(
    SELEM,
    `<< /Type /StructElem /S /P /P ${String(STRUCT)} 0 R /Pg ${String(page(0))} 0 R /Alt (ALTJULIET) /ActualText (SECRETALPHA) /K 0 >>`,
  );
  set(FORMPATH, {
    dict: '<< /Type /XObject /Subtype /Form /BBox [0 0 595 842] >>',
    stream: '0 0 1 RG 2 w 50 520 m 500 520 l S',
  });
  for (let i = 0; i < objs.length; i++) objs[i] ??= 'null';
  return buildPdf(objs, ` /Info ${String(INFO)} 0 R`);
}

/**
 * Bulk timing input: `pages` A4 pages, each with 20 text lines and `perPage`
 * /Redact annotations over lines 3, 7, 11 … (self-made; like the contract stand-in).
 */
export function markedBulkPdf(pages: number, perPage: number): Uint8Array {
  const objs: PdfObject[] = [];
  const pageNum = (i: number) => 3 + i * (2 + perPage);
  const font = 3 + pages * (2 + perPage);
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push(
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${String(pageNum(i))} 0 R`).join(' ')}] /Count ${String(pages)} >>`,
  );
  for (let i = 0; i < pages; i++) {
    const p = pageNum(i);
    const marks = Array.from({ length: perPage }, (_, k) => p + 2 + k);
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${String(font)} 0 R >> >> /Contents ${String(p + 1)} 0 R /Annots [${marks.map((m) => `${String(m)} 0 R`).join(' ')}] >>`,
    );
    let text = '';
    for (let l = 0; l < 20; l++)
      text += `BT /F1 11 Tf 72 ${String(780 - l * 30)} Td (Page ${String(i + 1)} line ${String(l + 1)} clause text with some words) Tj ET\n`;
    objs.push({ dict: '<< >>', stream: text });
    for (let k = 0; k < perPage; k++) {
      const y = 780 - (2 + k * 4) * 30;
      objs.push(
        `<< /Type /Annot /Subtype /Redact /Rect [70 ${String(y - 4)} 400 ${String(y + 12)}] /IC [0 0 0] /P ${String(p)} 0 R >>`,
      );
    }
  }
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  return buildPdf(objs);
}
