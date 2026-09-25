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
