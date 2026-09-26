// Self-made test PDFs, generated deterministically at test time (CLAUDE.md
// rule 13, ADR-001 B15, M1-Q7). Nothing produced here is committed. Promoted
// from the M0 spikes: spikes/shared/mini-pdf.ts, spikes/s5-search/make-contract.ts
// and spikes/s7-snap/test-sheet.ts.

import { deflateSync } from 'node:zlib';

export type PdfObject = string | { dict: string; stream: string };

/** Writes a classic-xref PDF. Object 1 must be the catalog. */
export function buildPdf(objects: PdfObject[]): Uint8Array {
  const parts: string[] = ['%PDF-1.7\n%âãÏÓ\n'];
  const offsets: number[] = [];
  let length = (parts[0] ?? '').length;
  objects.forEach((obj, i) => {
    offsets.push(length);
    const body =
      typeof obj === 'string'
        ? obj
        : `${obj.dict.replace(/>>\s*$/, '')} /Length ${String(obj.stream.length)} >>\nstream\n${obj.stream}\nendstream`;
    const s = `${String(i + 1)} 0 obj\n${body}\nendobj\n`;
    parts.push(s);
    length += s.length;
  });
  let xref = `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(length)}\n%%EOF\n`;
  parts.push(xref);
  return latin1(parts.join(''));
}

/** Every string built here is Latin-1 by construction (CJK text is hex-encoded). */
function latin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

const flate = (text: string): { dict: string; stream: string } => ({
  dict: '<< /Filter /FlateDecode >>',
  stream: deflateSync(Buffer.from(text, 'latin1')).toString('latin1'),
});

const escText = (s: string): string => s.replace(/[\\()]/g, (c) => `\\${c}`);

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** `pages` A4 pages, each with a "Page n" heading in Helvetica. */
export function simplePdf(pages = 1): Uint8Array {
  const fontNum = 3 + pages * 2;
  const objs: PdfObject[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${String(3 + i * 2)} 0 R`).join(' ')}] /Count ${String(pages)} >>`,
  ];
  for (let i = 0; i < pages; i++) {
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${String(fontNum)} 0 R >> >> /Contents ${String(4 + i * 2)} 0 R >>`,
      { dict: '<< >>', stream: `BT /F1 36 Tf 72 740 Td (Page ${String(i + 1)}) Tj ET` },
    );
  }
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  return buildPdf(objs);
}

/** Words found only in annotatedPdf's comment and in its bookmark title. */
export const COMMENT_WORD = 'MARGINALIA';
export const BOOKMARK_WORD = 'GLOSSARIUM';

/**
 * Three pages ("Page n") with a sticky-note comment on page 2 whose text
 * holds COMMENT_WORD, and a two-entry outline: "Introduction" → page 1 and
 * "Appendix <BOOKMARK_WORD>" → page 3 (M2-09 search in comments and bookmarks).
 */
export function annotatedPdf(): Uint8Array {
  const page = (contents: number, extra = '') =>
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 13 0 R >> >> /Contents ${String(contents)} 0 R${extra} >>`;
  const text = (n: number) => ({
    dict: '<< >>',
    stream: `BT /F1 36 Tf 72 740 Td (Page ${String(n)}) Tj ET`,
  });
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R /Outlines 10 0 R /PageMode /UseOutlines >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>',
    page(4),
    text(1),
    page(6, ' /Annots [9 0 R]'),
    text(2),
    page(8),
    text(3),
    `<< /Type /Annot /Subtype /Text /Rect [300 600 324 624] /P 5 0 R /Name /Comment /Contents (Please check the ${COMMENT_WORD} note) /T (Tester) >>`,
    '<< /Type /Outlines /First 11 0 R /Last 12 0 R /Count 2 >>',
    '<< /Title (Introduction) /Parent 10 0 R /Next 12 0 R /Dest [3 0 R /XYZ 0 842 null] >>',
    `<< /Title (Appendix ${BOOKMARK_WORD}) /Parent 10 0 R /Prev 11 0 R /Dest [7 0 R /XYZ 0 842 null] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);
}

/** The external address of outlinedPdf's URI link. */
export const LINK_URL = 'https://example.com/spec?section=4.2';

/**
 * 50 pages ("Page n") with a 500-entry, 3-level outline — 5 parts × 9
 * sections × 10 items, "Item p.s.i" → page (p·9+s) mod 50 at the top (/XYZ) —
 * and three links on page 1: to page 30 (/XYZ), to the named destination
 * "chap3" (page 3, /Fit) and to LINK_URL (M2-10).
 */
export function outlinedPdf(): Uint8Array {
  const pages = 50;
  // Objects: 1 catalog, 2 pages, 3.. pages (page, contents) pairs, then font,
  // 3 link annotations, the outline root and the outline items.
  const pageObj = (i: number) => 3 + i * 2;
  const font = 3 + pages * 2;
  const links = [font + 1, font + 2, font + 3];
  const root = font + 4;
  const objs: PdfObject[] = [
    `<< /Type /Catalog /Pages 2 0 R /Outlines ${String(root)} 0 R /Dests << /chap3 [${String(pageObj(2))} 0 R /Fit] >> >>`,
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${String(pageObj(i))} 0 R`).join(' ')}] /Count ${String(pages)} >>`,
  ];
  for (let i = 0; i < pages; i++) {
    const annots = i === 0 ? ` /Annots [${links.map((n) => `${String(n)} 0 R`).join(' ')}]` : '';
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${String(font)} 0 R >> >> /Contents ${String(4 + i * 2)} 0 R${annots} >>`,
      {
        dict: '<< >>',
        stream:
          `BT /F1 36 Tf 72 740 Td (Page ${String(i + 1)}) Tj ET` +
          (i === 0
            ? ' BT /F1 14 Tf 72 600 Td (Go to page 30) Tj 0 -40 Td (Chapter 3) Tj 0 -40 Td (Specification online) Tj ET'
            : ''),
      },
    );
  }
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objs.push(
    `<< /Type /Annot /Subtype /Link /Rect [70 595 250 615] /Border [0 0 0] /Dest [${String(pageObj(29))} 0 R /XYZ 0 842 0] >>`,
    '<< /Type /Annot /Subtype /Link /Rect [70 555 250 575] /Border [0 0 0] /Dest /chap3 >>',
    `<< /Type /Annot /Subtype /Link /Rect [70 515 250 535] /Border [0 0 0] /A << /S /URI /URI (${LINK_URL}) >> >>`,
  );
  // Outline tree, depth-first object numbers after the root.
  interface Node {
    title: string;
    page: number;
    children: Node[];
    num?: number;
  }
  const tree: Node[] = Array.from({ length: 5 }, (_, p) => ({
    title: `Part ${String(p + 1)}`,
    page: (p * 9) % pages,
    children: Array.from({ length: 9 }, (_, s) => ({
      title: `Section ${String(p + 1)}.${String(s + 1)}`,
      page: (p * 9 + s) % pages,
      children: Array.from({ length: 10 }, (_, k) => ({
        title: `Item ${String(p + 1)}.${String(s + 1)}.${String(k + 1)}`,
        page: (p * 9 + s) % pages,
        children: [],
      })),
    })),
  }));
  let next = root + 1;
  const number = (list: Node[]) => {
    for (const n of list) {
      n.num = next++;
      number(n.children);
    }
  };
  number(tree);
  const items: string[] = [];
  const emit = (list: Node[], parent: number) => {
    list.forEach((n, i) => {
      const prev = list[i - 1]?.num;
      const nxt = list[i + 1]?.num;
      const kids = n.children.length
        ? ` /First ${String(n.children[0]?.num)} 0 R /Last ${String(n.children[n.children.length - 1]?.num)} 0 R /Count -${String(n.children.length)}`
        : '';
      items[(n.num ?? 0) - root - 1] =
        `<< /Title (${n.title}) /Parent ${String(parent)} 0 R` +
        (prev ? ` /Prev ${String(prev)} 0 R` : '') +
        (nxt ? ` /Next ${String(nxt)} 0 R` : '') +
        kids +
        ` /Dest [${String(pageObj(n.page))} 0 R /XYZ 0 842 0] >>`;
      emit(n.children, n.num ?? 0);
    });
  };
  emit(tree, root);
  objs.push(
    `<< /Type /Outlines /First ${String(tree[0]?.num)} 0 R /Last ${String(tree[tree.length - 1]?.num)} 0 R /Count 5 >>`,
    ...items,
  );
  return buildPdf(objs);
}

// ------------------------------------------------------------ contract profile

/** Appears only on the 0-based pages in NEEDLE_PAGES; "Contractor" is on every page. */
export const NEEDLE = 'PDFTOOLS-NEEDLE';
export const NEEDLE_PAGES = [6, 999, 1998];

const WORDS = (
  'the contractor shall provide all labor materials equipment and services necessary ' +
  'to perform the work in accordance with the terms and conditions of this contract ' +
  'including any modifications issued by the contracting officer pursuant to clause ' +
  'government may terminate for convenience subject to equitable adjustment payment ' +
  'invoice acceptance inspection warranty delivery schedule subcontract flowdown ' +
  'records audit examination disputes changes notice written determination period ' +
  'offeror solicitation evaluation factors price technical past performance small business'
).split(' ');

function contractPage(i: number, rand: () => number): string {
  const lines: string[] = [
    `52.${String(200 + (i % 90))}-${String(1 + (i % 9))} Clause ${String(i + 1)}. Contractor obligations (Part ${String(1 + Math.floor(i / 40))})`,
  ];
  for (let l = 0; l < 52; l++) {
    let line = '';
    while (line.length < 88) line += `${WORDS[Math.floor(rand() * WORDS.length)] ?? ''} `;
    if (l === 20 && NEEDLE_PAGES.includes(i)) line = `See ${NEEDLE} reference ${String(i)} ${line}`;
    lines.push(line.trim());
  }
  const out = ['BT /F1 13 Tf 50 800 Td'];
  lines.forEach((t, n) => out.push(`${n === 0 ? '' : '0 -14.5 Td '}(${escText(t)}) Tj`));
  out.push('ET');
  return out.join('\n');
}

/**
 * Contract-profile stand-in (D-02): text-heavy A4-ish pages with FAR-style clause
 * numbers. 2,000 pages ≈ 3.5 MB. The real FAR is an owner run.
 */
export function contractPdf(pages = 2000): Uint8Array {
  const rand = rng(42);
  const fontNum = 3 + pages * 2;
  const objs: PdfObject[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${String(3 + i * 2)} 0 R`).join(' ')}] /Count ${String(pages)} >>`,
  ];
  for (let i = 0; i < pages; i++) {
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 ${String(fontNum)} 0 R >> >> /Contents ${String(4 + i * 2)} 0 R >>`,
      flate(contractPage(i, rand)),
    );
  }
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>');
  return buildPdf(objs);
}

// ------------------------------------------------------------ drawing profile

export const A0 = { width: 3370, height: 2384 } as const;

/**
 * Synthetic A0 sheet with `segments` short stroked lines grouped into path
 * objects of 50, clustered like CAD entities. 20k is "typical", 200k "dense".
 * Not a stand-in for real P&IDs, which are owner runs (ADR-002).
 */
export function a0Sheet(segments: number): Uint8Array {
  const rand = rng(7);
  const lines: string[] = ['0.2 w 0 G'];
  let path: string[] = [];
  let ox = 0;
  let oy = 0;
  for (let i = 0; i < segments; i++) {
    if (path.length === 0) {
      ox = 60 + rand() * (A0.width - 180);
      oy = 60 + rand() * (A0.height - 180);
    }
    const x = ox + rand() * 60;
    const y = oy + rand() * 60;
    const a = rand() < 0.5 ? 0 : (Math.PI / 2) * (rand() < 0.5 ? 1 : 0.5);
    const len = 4 + rand() * 30;
    path.push(
      `${x.toFixed(2)} ${y.toFixed(2)} m ${(x + Math.cos(a) * len).toFixed(2)} ${(y + Math.sin(a) * len).toFixed(2)} l`,
    );
    if (path.length === 50) {
      lines.push(`${path.join(' ')} S`);
      path = [];
    }
  }
  if (path.length) lines.push(`${path.join(' ')} S`);
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(A0.width)} ${String(A0.height)}] /Contents 4 0 R >>`,
    flate(lines.join('\n')),
  ]);
}

// ------------------------------------------------------------ font fallback

function ucs2Hex(text: string): string {
  let hex = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp > 0xffff) throw new Error('BMP only');
    hex += cp.toString(16).padStart(4, '0').toUpperCase();
  }
  return `<${hex}>`;
}

/**
 * One A4 page with a Helvetica line and Simplified Chinese text in a
 * non-embedded CID font, so PDFium must use the fallback-font path (ADR-003).
 */
export function cjkFallbackPdf(): Uint8Array {
  const content = [
    'BT /F1 24 Tf 60 760 Td (PDFTools font fallback fixture) Tj ET',
    `BT /F2 96 Tf 60 560 Td ${ucs2Hex('中文测试')} Tj ET`,
    `BT /F2 96 Tf 60 400 Td ${ucs2Hex('工程图纸')} Tj ET`,
  ].join('\n');
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    { dict: '<< >>', stream: content },
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [7 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor 8 0 R /DW 1000 >>',
    '<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [-25 -254 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 93 >>',
  ]);
}

// ------------------------------------------------------------ forms (M2-02, M2-14)

const FORM_PAGE = '/MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /Helv 3 0 R >> >>';

const formBox = (w: number, h: number, body: string): PdfObject => ({
  dict: `<< /Type /XObject /Subtype /Form /BBox [0 0 ${String(w)} ${String(h)}] /Resources << /Font << /Helv 3 0 R >> >> >>`,
  stream: body,
});

/**
 * One page with every AcroForm field type §7.10 names: text (plus read-only and
 * required text), checkbox, a two-button radio group, a combo box and a list
 * box. `/Tabs /R`, and `/Annots` deliberately **not** in row order, so tab
 * order can be checked. Object numbers are fixed (see comments).
 */
export function fullFormPdf(): Uint8Array {
  const tx = (n: number, name: string, y: number, v: string, ff = 0) =>
    `<< /Type /Annot /Subtype /Widget /FT /Tx /T (${name}) /TU (${name} field) /V (${v}) /Ff ${String(ff)} /DA (/Helv 12 Tf 0 g) /Rect [60 ${String(y)} 300 ${String(y + 24)}] /F 4 /P 4 0 R /AP << /N ${String(n)} 0 R >> >>`;
  const objs: PdfObject[] = [
    // 1 catalog, 2 pages, 3 font, 4 page, 5 content
    '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [8 0 R 6 0 R 7 0 R 9 0 R 10 0 R 13 0 R 14 0 R] /DA (/Helv 12 Tf 0 g) /DR << /Font << /Helv 3 0 R >> >> >> >>',
    '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Type /Page /Parent 2 0 R ${FORM_PAGE} /Contents 5 0 R /Tabs /R /Annots [9 0 R 8 0 R 6 0 R 7 0 R 11 0 R 12 0 R 14 0 R 10 0 R] >>`,
    { dict: '<< >>', stream: 'BT /F1 16 Tf 60 790 Td (PDFTools M2 form) Tj ET' },
    // 6 name (row 2), 7 readonly (row 3), 8 first (row 1), 9 required (row 4)
    tx(15, 'name', 700, 'Initial'),
    tx(16, 'readonly', 660, 'Fixed', 1),
    tx(17, 'first', 740, 'Top'),
    tx(18, 'required', 620, '', 2),
    // 10 checkbox; 11 and 12 radio buttons, kids of the field 13
    '<< /Type /Annot /Subtype /Widget /FT /Btn /T (agree) /TU (Agree) /V /Off /AS /Off /Rect [60 580 76 596] /F 4 /P 4 0 R /MK << /CA (4) >> /AP << /N << /Yes 19 0 R /Off 20 0 R >> >> >>',
    '<< /Type /Annot /Subtype /Widget /Parent 13 0 R /AS /A /Rect [60 540 76 556] /F 4 /P 4 0 R /MK << /CA (l) >> /AP << /N << /A 19 0 R /Off 20 0 R >> >> >>',
    '<< /Type /Annot /Subtype /Widget /Parent 13 0 R /AS /Off /Rect [120 540 136 556] /F 4 /P 4 0 R /MK << /CA (l) >> /AP << /N << /B 19 0 R /Off 20 0 R >> >> >>',
    '<< /FT /Btn /Ff 49152 /T (choice) /TU (Choice) /V /A /Kids [11 0 R 12 0 R] >>',
    // 14 combo box (/Ff bit 18 = combo); 15–21 appearance streams
    '<< /Type /Annot /Subtype /Widget /FT /Ch /Ff 131072 /T (size) /TU (Size) /Opt [(DN50) (DN80) (DN100)] /V (DN80) /DA (/Helv 12 Tf 0 g) /Rect [60 490 300 514] /F 4 /P 4 0 R /AP << /N 21 0 R >> >>',
    formBox(240, 24, '/Tx BMC BT /Helv 12 Tf 0 g 2 7 Td (Initial) Tj ET EMC'),
    formBox(240, 24, '/Tx BMC BT /Helv 12 Tf 0 g 2 7 Td (Fixed) Tj ET EMC'),
    formBox(240, 24, '/Tx BMC BT /Helv 12 Tf 0 g 2 7 Td (Top) Tj ET EMC'),
    formBox(240, 24, '/Tx BMC EMC'),
    formBox(16, 16, '0 g 1 w 0.5 0.5 15 15 re S 3 8 m 7 3 l 13 13 l S'),
    formBox(16, 16, '0 g 1 w 0.5 0.5 15 15 re S'),
    formBox(240, 24, '/Tx BMC BT /Helv 12 Tf 0 g 2 7 Td (DN80) Tj ET EMC'),
  ];
  // 22 list box (added last so the numbers above stay fixed), in /Fields and /Annots.
  objs.push(
    '<< /Type /Annot /Subtype /Widget /FT /Ch /T (material) /TU (Material) /Opt [(Carbon steel) (Stainless) (Duplex)] /V (Stainless) /DA (/Helv 12 Tf 0 g) /Rect [60 400 300 470] /F 4 /P 4 0 R >>',
  );
  objs[0] = (objs[0] as string).replace('14 0 R]', '14 0 R 22 0 R]');
  objs[3] = (objs[3] as string).replace('10 0 R]', '10 0 R 22 0 R]');
  return buildPdf(objs);
}

/** The field names in reading (row) order, i.e. `/Tabs /R` order. */
export const ROW_ORDER = [
  'first',
  'name',
  'readonly',
  'required',
  'agree',
  'choice',
  'size',
  'material',
];
