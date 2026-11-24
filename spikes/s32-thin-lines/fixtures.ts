// Spike S32 (M13-03, D-69): self-made fixtures (CLAUDE.md rule 13). Nothing
// here is committed as a PDF; run-node.ts builds them in memory.
import { deflateSync } from 'node:zlib';
import { buildPdf, type PdfObject } from '../../e2e/fixtures/generate.ts';

const flate = (text: string, dict = ''): PdfObject => ({
  dict: `<< ${dict} /Filter /FlateDecode >>`,
  stream: deflateSync(Buffer.from(text, 'latin1')).toString('latin1'),
});

/** Where each probe item is drawn (PDF user space, A4 portrait 595 × 842). */
export const PROBE = {
  /** 3 pt page line, horizontal. */
  page: { x: 300, y: 760 },
  /** 3 pt vertical line (x = 60). */
  vertical: { x: 60, y: 400 },
  /** 0.75 pt under a 4× `cm`: 3 pt on the page. */
  scaledCtm: { x: 300, y: 700 },
  /** Dashed 3 pt line (dash 12 on, 6 off, measured inside a dash). */
  dashed: { x: 303, y: 640 },
  /** Inside a form XObject. */
  form: { x: 300, y: 580 },
  /** Inside a form XObject drawn by another form XObject. */
  nested: { x: 300, y: 540 },
  /** Already a zero-width hairline in the file. */
  hairline: { x: 300, y: 500 },
  /** Fill-and-stroke rectangle: top edge (stroke) and centre (fill). */
  fillStrokeEdge: { x: 350, y: 450 },
  fillStrokeInside: { x: 350, y: 425 },
  /** Fill only, no stroke. */
  fillOnly: { x: 150, y: 425 },
  /** Text drawn with Tr 1 (stroked outlines): left unchanged (plan §3). */
  strokedText: { x: 90, y: 330 },
  /** Square comment with a 3 pt border (annotation appearance): left unchanged. */
  annot: { x: 450, y: 273.5 },
} as const;

/**
 * One A4 page with every kind of stroked line Thin Lines must handle, in two
 * content streams (so a content regeneration that rewrites a stream shows),
 * plus a Square comment with a 3 pt border.
 */
export function probePdf(): Uint8Array {
  const s1 = [
    '0 G 3 w 40 760 m 560 760 l S',
    '3 w 60 300 m 60 520 l S',
    'q 4 0 0 4 0 0 cm 0.75 w 10 175 m 140 175 l S Q',
    '[12 6] 0 d 3 w 40 640 m 560 640 l S [] 0 d',
    '0 w 40 500 m 560 500 l S',
    '0 0 1 rg 3 w 0 G 250 400 200 50 re B',
    '1 0 0 rg 100 400 100 50 re f',
  ].join('\n');
  const s2 = ['/Fm1 Do', 'BT /F1 72 Tf 1 Tr 2 w 0 G 40 300 Td (THIN) Tj ET'].join('\n');
  const fm2 = '0 G 3 w 40 540 m 560 540 l S';
  const fm1 = '0 G 3 w 40 580 m 560 580 l S\n/Fm2 Do';
  const ap = '1 0 0 RG 3 w 1.5 1.5 97 47 re S';
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
      '/Resources << /XObject << /Fm1 6 0 R >> /Font << /F1 8 0 R >> >> ' +
      '/Contents [4 0 R 5 0 R] /Annots [9 0 R] >>',
    flate(s1),
    flate(s2),
    flate(
      fm1,
      '/Type /XObject /Subtype /Form /BBox [0 0 595 842] /Resources << /XObject << /Fm2 7 0 R >> >>',
    ),
    flate(fm2, '/Type /XObject /Subtype /Form /BBox [0 0 595 842]'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Annot /Subtype /Square /Rect [400 225 500 275] /NM (s32-square) /F 4 ' +
      '/C [1 0 0] /BS << /W 3 >> /AP << /N 10 0 R >> >>',
    flate(ap, '/Type /XObject /Subtype /Form /BBox [0 0 100 50]'),
  ]);
}

export const A0 = { width: 3370, height: 2384 } as const;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * The worst case for walking page objects: an A0 sheet drawn the way many CAD
 * exporters write it, ONE path object per line (`lines` of them, mixed widths
 * 0.18 – 0.7 pt), plus a title block and `blocks` placed symbols, each a form
 * XObject with 12 lines (a block reference drawn with `Do`), and 2 content
 * streams. (The e2e a0Sheet groups 50 segments per path: 50× fewer objects.)
 */
export function cadSheetPdf(lines: number, blocks: number): Uint8Array {
  const rand = rng(32);
  const widths = ['0.18', '0.25', '0.35', '0.5', '0.7'];
  const a: string[] = ['0 G'];
  const b: string[] = ['0 G'];
  for (let i = 0; i < lines; i++) {
    const x = 60 + rand() * (A0.width - 160);
    const y = 60 + rand() * (A0.height - 160);
    const horiz = rand() < 0.5;
    const len = 5 + rand() * 80;
    const w = widths[i % widths.length] ?? '0.25';
    (i % 2 ? b : a).push(
      `${w} w ${x.toFixed(2)} ${y.toFixed(2)} m ${(horiz ? x + len : x).toFixed(2)} ${(horiz ? y : y + len).toFixed(2)} l S`,
    );
  }
  for (let i = 0; i < blocks; i++) {
    const x = 80 + rand() * (A0.width - 200);
    const y = 80 + rand() * (A0.height - 200);
    b.push(`q 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} cm /Sym Do Q`);
  }
  b.push(`q 1 0 0 1 ${String(A0.width - 900)} 40 cm /TB Do Q`);
  const sym: string[] = ['0.35 w'];
  for (let k = 0; k < 12; k++) {
    const t = (k / 12) * Math.PI * 2;
    sym.push(
      `${(20 + 15 * Math.cos(t)).toFixed(2)} ${(20 + 15 * Math.sin(t)).toFixed(2)} m 20 20 l S`,
    );
  }
  sym.push('0.5 w 0 0 40 40 re S');
  const tb: string[] = ['1 w 0 0 860 300 re S', '0.5 w'];
  for (let r = 1; r < 10; r++) tb.push(`0 ${String(r * 30)} m 860 ${String(r * 30)} l S`);
  for (let c = 1; c < 6; c++) tb.push(`${String(c * 140)} 0 m ${String(c * 140)} 300 l S`);
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(A0.width)} ${String(A0.height)}] ` +
      '/Resources << /XObject << /Sym 6 0 R /TB 7 0 R >> >> /Contents [4 0 R 5 0 R] >>',
    flate(a.join('\n')),
    flate(b.join('\n')),
    flate(sym.join('\n'), '/Type /XObject /Subtype /Form /BBox [0 0 40 40]'),
    flate(tb.join('\n'), '/Type /XObject /Subtype /Form /BBox [0 0 860 300]'),
  ]);
}

/**
 * A large file for the memory check: the probe's two page lines plus `mb`
 * megabytes of incompressible data in an image XObject the page draws in a
 * corner (like a scanned or photo-heavy drawing set: most bytes are images).
 */
export function bigFilePdf(mb: number): Uint8Array {
  const rand = rng(64);
  const side = Math.floor(Math.sqrt((mb * 2 ** 20) / 3));
  const data = new Uint8Array(side * side * 3);
  for (let i = 0; i < data.length; i += 4) {
    const v = Math.floor(rand() * 2 ** 32);
    data[i] = v & 255;
    data[i + 1] = (v >>> 8) & 255;
    data[i + 2] = (v >>> 16) & 255;
    data[i + 3] = v >>> 24;
  }
  const content =
    '0 G 3 w 40 760 m 560 760 l S\nq 100 0 0 100 450 40 cm /Im1 Do Q\n3 w 60 300 m 60 520 l S';
  const parts: (string | Uint8Array)[] = [];
  const offsets: number[] = [];
  let len = 0;
  const push = (x: string | Uint8Array) => {
    parts.push(x);
    len += x.length;
  };
  push('%PDF-1.7\n');
  const objs: (string | [string, Uint8Array])[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>',
    [`<< /Length ${String(content.length)} >>`, Uint8Array.from(content, (c) => c.charCodeAt(0))],
    [
      `<< /Type /XObject /Subtype /Image /Width ${String(side)} /Height ${String(side)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${String(data.length)} >>`,
      data,
    ],
  ];
  objs.forEach((o, i) => {
    offsets.push(len);
    if (typeof o === 'string') push(`${String(i + 1)} 0 obj\n${o}\nendobj\n`);
    else {
      push(`${String(i + 1)} 0 obj\n${o[0]}\nstream\n`);
      push(o[1]);
      push('\nendstream\nendobj\n');
    }
  });
  const xref = len;
  let x = `xref\n0 ${String(objs.length + 1)}\n0000000000 65535 f \n`;
  for (const off of offsets) x += `${String(off).padStart(10, '0')} 00000 n \n`;
  x += `trailer\n<< /Size ${String(objs.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  push(x);
  const out = new Uint8Array(len);
  let at = 0;
  for (const p of parts) {
    if (typeof p === 'string') for (let i = 0; i < p.length; i++) out[at + i] = p.charCodeAt(i);
    else out.set(p, at);
    at += p.length;
  }
  return out;
}
