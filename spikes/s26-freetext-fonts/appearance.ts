// Spike S26, route R2: a text comment's appearance with the comment's own
// fonts embedded as subsets.
//
//  - Content: PDFium's own appearance (fill, border, callout line: its
//    geometry and ADR-024's colours stay PDFium's) with its text blocks
//    (`BT … ET`) taken out, then our text, laid out by layout.ts:
//    one BT block, a TJ per run of glyphs with one font and baseline, glyph
//    codes = glyph ids (Identity-H, /CIDToGIDMap /Identity), each line in a
//    `/Span << /ActualText … >>` so every viewer extracts the typed text even
//    where shaping reordered or merged glyphs (Devanagari).
//  - Fonts: per face, Type0 → CIDFontType2 (or CIDFontType0 for a CFF face)
//    → FontDescriptor → FontFile2 (or FontFile3 /OpenType): HarfBuzz's subset
//    of the used glyphs with their glyph ids kept, layout tables dropped,
//    Flate-compressed; /W from hmtx; a ToUnicode CMap (first glyph of a
//    cluster → the cluster's text).
//  - Assembly: as ADR-024 (freeTextColors.ts): PDFium's own appearance is
//    exported as a one-page document; an incremental update makes that page
//    draw our form `/EPDFWRAP` (PDFium's /BBox and /Matrix, so rotation and
//    placement stay PDFium's) with our /Resources; the result is set with
//    EPDFAnnot_SetAppearanceFromPage, which copies the fonts into the file.
import { zlibSync } from 'fflate';
import { createHash } from 'node:crypto';
import {
  fmtNum,
  isDict,
  PdfName,
  PdfRef,
  PdfString,
  serialize,
  type PdfDict,
  type PdfValue,
} from '../../src/model/pdf/objects';
import { concatBytes, encodeLatin1 } from '../../src/workers/render/save/bytes';
import {
  lastStartxref,
  newestTrailerDict,
  trailerRef,
  trailerSize,
  writeXrefSection,
} from '../../src/workers/render/save/xref';
import { EMBED_DROP, FLAG_NO_HINTING, FLAG_RETAIN_GIDS, type Subsetter } from './hbsubset.ts';
import { at, type Face, type Line } from './layout.ts';

export type Rgb = [number, number, number];

export interface BoxStyle {
  /** The text area in form space: PDFium's clip for a callout, its box inset by the border otherwise. */
  textBox: [number, number, number, number];
  text: Rgb;
  align: 0 | 1 | 2;
  size: number;
  /** CSS line-height of the on-page editor (EmbedPDF: 1.18). */
  lineHeight: number;
  primary: Face;
  bold?: boolean;
  italic?: boolean;
}

const c3 = (c: Rgb): string => c.map((v) => fmtNum(Math.round(v * 1000) / 1000)).join(' ');
const r2 = (n: number): string => fmtNum(Math.round(n * 1000) / 1000);
const hex4 = (n: number): string => n.toString(16).padStart(4, '0').toUpperCase();
const utf16hex = (s: string): string => {
  let o = '';
  for (let i = 0; i < s.length; i++) o += hex4(s.charCodeAt(i));
  return o;
};

/** Used glyphs per face, and the text each glyph stands for (first seen). */
export type Usage = Map<Face, Map<number, string>>;

/**
 * PDFium's appearance content without its text, and the text area it used
 * (the clip before its `BT`, if any).
 */
export function withoutText(pdfium: string): {
  ops: string;
  clip: [number, number, number, number] | null;
} {
  const m = /(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re\s+W\s+n\s+BT\b/u.exec(pdfium);
  const clip = m
    ? ([Number(m[1]), Number(m[2]), Number(m[1]) + Number(m[3]), Number(m[2]) + Number(m[4])] as [
        number,
        number,
        number,
        number,
      ])
    : null;
  return { ops: pdfium.replace(/\bBT\b[\s\S]*?\bET\b/gu, ''), clip };
}

/** Our text in form space, and the glyphs it uses. */
export function content(
  lines: Line[],
  s: BoxStyle,
): { ops: string; usage: Usage; names: Map<Face, string> } {
  const [x0, y0, x1, y1] = s.textBox;
  const h = y1 - y0;
  const out: string[] = [];
  const usage: Usage = new Map();
  const names = new Map<Face, string>();
  const nameOf = (f: Face): string => {
    let n = names.get(f);
    if (!n) names.set(f, (n = `F${String(names.size + 1)}`));
    return n;
  };
  const p = s.primary;
  const asc = (p.ascender / p.upem) * s.size;
  const desc = (-p.descender / p.upem) * s.size;
  const lineH = s.lineHeight * s.size;
  const first = y1 - ((lineH - (asc + desc)) / 2 + asc);
  const innerW = x1 - x0;
  // Synthetic styles: a slant of 12° and a stroke of 1/30 em, as browsers draw them.
  out.push('/Tx BMC q');
  out.push(`${r2(x0)} ${r2(y0)} ${r2(innerW)} ${r2(h)} re W n`);
  out.push(`BT ${c3(s.text)} rg`);
  let curFont: Face | null = null;
  let curMode = 0;
  lines.forEach((line, i) => {
    const base = first - i * lineH;
    const ox =
      x0 + (s.align === 0 ? 0 : s.align === 1 ? (innerW - line.width) / 2 : innerW - line.width);
    if (!line.glyphs.length) return;
    // One marked span per text run (one font, one baseline): PDFium applies a
    // span's /ActualText to each text object inside it, so a span per line
    // would repeat a line's text once per font change.
    let tj: string[] = [];
    let pen = NaN;
    let penY = NaN;
    let spanFrom = -1;
    let spanTo = -1;
    let spanAt = -1;
    const flush = (): void => {
      if (tj.length) {
        const actual = line.text.slice(spanFrom, spanTo);
        out.splice(spanAt, 0, `/Span << /ActualText <FEFF${utf16hex(actual)}> >> BDC`);
        out.push(`[${tj.join('')}] TJ`, 'EMC');
      }
      tj = [];
    };
    const lineStart = line.glyphs[0]?.cluster ?? 0;
    const seen = new Set<number>();
    for (const g of line.glyphs) {
      const f = g.face;
      const fakeBold = !!s.bold && !!f.fakeBold;
      const fakeItalic = !!s.italic && !!f.fakeItalic;
      const used = usage.get(f) ?? new Map<number, string>();
      usage.set(f, used);
      // ToUnicode: the first glyph drawn of a cluster stands for its text, the
      // others for nothing (else readers that ignore /ActualText repeat it).
      const firstOfCluster = !seen.has(g.cluster);
      seen.add(g.cluster);
      const t = firstOfCluster ? g.text : '';
      if (!used.has(g.gid)) used.set(g.gid, t);
      else if (t && !used.get(g.gid)) used.set(g.gid, t);
      const gx = ox + g.x + g.dx;
      const gy = base + g.dy;
      const mode = fakeBold ? 2 : 0;
      const from = g.cluster - lineStart;
      const to = from + g.text.length;
      if (f !== curFont || mode !== curMode || Math.abs(gy - penY) > 1e-6 || Number.isNaN(pen)) {
        flush();
        spanAt = out.length;
        spanFrom = from;
        spanTo = to;
        if (f !== curFont) out.push(`/${nameOf(f)} ${r2(s.size)} Tf`);
        if (mode !== curMode)
          out.push(mode ? `2 Tr ${c3(s.text)} RG ${r2(s.size / 30)} w` : '0 Tr');
        out.push(`1 0 ${fakeItalic ? '0.2126' : '0'} 1 ${r2(gx)} ${r2(gy)} Tm`);
        curFont = f;
        curMode = mode;
        pen = gx;
        penY = gy;
      } else if (Math.abs(gx - pen) > 1e-3) {
        const adj = Math.round(((-(gx - pen) * 1000) / s.size) * 100) / 100;
        tj.push(` ${fmtNum(adj)} `);
        pen -= (adj * s.size) / 1000;
      }
      spanFrom = Math.min(spanFrom, from);
      spanTo = Math.max(spanTo, to);
      tj.push(`<${hex4(g.gid)}>`);
      pen += (f.font.glyphHAdvance(g.gid) / f.upem) * s.size;
    }
    flush();
  });
  out.push('ET Q EMC');
  return { ops: out.join('\n'), usage, names };
}

// ------------------------------------------------------------------ font objects

interface Table {
  u16(o: number): number;
  i16(o: number): number;
  u32(o: number): number;
}
const table = (b: Uint8Array | undefined): Table | null => {
  if (!b) return null;
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { u16: (o) => d.getUint16(o), i16: (o) => d.getInt16(o), u32: (o) => d.getUint32(o) };
};

/** How a CFF face is embedded: the whole OpenType file (FontFile3 /OpenType) or its bare CFF table (/CIDFontType0C). */
export const CFF_MODE = { bare: false };

/** One table of an OpenType file. */
function tableOf(font: Uint8Array, tagName: string): Uint8Array {
  const d = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const n = d.getUint16(4);
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16;
    const t = String.fromCharCode(at(font, r), at(font, r + 1), at(font, r + 2), at(font, r + 3));
    if (t === tagName)
      return font.subarray(d.getUint32(r + 8), d.getUint32(r + 8) + d.getUint32(r + 12));
  }
  throw new Error(`no ${tagName} table`);
}

/** Objects a face needs, numbered from `first`: Type0 is `first`. */
export function fontObjects(
  face: Face,
  used: Map<number, string>,
  first: number,
  sub: Subsetter,
  styleFlags: { italic: boolean },
): { objects: Uint8Array[]; type0: PdfRef; bytes: { program: number; compressed: number } } {
  const hbFace = face.font.face;
  const isCff = !!hbFace.referenceTable('CFF ');
  const program = sub.subset(face.bytes, {
    glyphs: used.keys(),
    flags: FLAG_RETAIN_GIDS | FLAG_NO_HINTING,
    drop: [...EMBED_DROP, 'name', 'post', 'cmap', 'OS/2'].filter(
      (t) => !(isCff && (t === 'cmap' || t === 'OS/2' || t === 'post' || t === 'name')),
    ),
  });
  if (!program) throw new Error(`${face.id}: subset failed`);
  const cffBare = isCff && CFF_MODE.bare;
  const embedded = cffBare ? tableOf(program, 'CFF ') : program;
  const k = 1000 / face.upem;
  const head = table(hbFace.referenceTable('head'));
  const post = table(hbFace.referenceTable('post'));
  const os2 = table(hbFace.referenceTable('OS/2'));
  const bbox = head
    ? [head.i16(36), head.i16(38), head.i16(40), head.i16(42)].map((v) => Math.round(v * k))
    : [0, -250, 1000, 1000];
  const italicAngle = post ? post.u32(4) / 65536 - (post.u32(4) >= 0x80000000 ? 65536 : 0) : 0;
  const fixed = post ? post.u32(12) !== 0 : false;
  const capHeight =
    os2 && os2.u16(0) >= 2 ? Math.round(os2.i16(88) * k) : Math.round(face.ascender * k);
  const weight = os2 ? os2.u16(4) : 400;
  const psName = (hbFace.getName(6, 'en') || face.id).replace(/[^!-~]|[#()<>[\]{}/%]/g, '');
  const gids = [...used.keys()].sort((a, b) => a - b);
  const tag = createHash('sha1')
    .update(`${psName}:${gids.join(',')}`)
    .digest()
    .subarray(0, 6);
  const subsetTag = [...tag].map((b) => String.fromCharCode(65 + (b % 26))).join('');
  const baseFont = `${subsetTag}+${psName}`;
  // /W: [gid [w]] runs.
  const W: PdfValue[] = [];
  let runStart = -1;
  let runWidths: number[] = [];
  for (const g of gids) {
    const wv = Math.round(face.font.glyphHAdvance(g) * k);
    if (runStart >= 0 && g === runStart + runWidths.length) runWidths.push(wv);
    else {
      if (runStart >= 0) W.push(runStart, runWidths);
      runStart = g;
      runWidths = [wv];
    }
  }
  if (runStart >= 0) W.push(runStart, runWidths);
  const n = {
    type0: first,
    cid: first + 1,
    desc: first + 2,
    file: first + 3,
    tounicode: first + 4,
  };
  const flags = 32 | (fixed ? 1 : 0) | (styleFlags.italic || italicAngle !== 0 ? 64 : 0);
  const compressed = zlibSync(embedded, { level: 9 });
  const N = (s: string): PdfName => new PdfName(s);
  const obj = (num: number, v: PdfDict): Uint8Array =>
    encodeLatin1(`${String(num)} 0 obj\n${serialize(v)}\nendobj\n`);
  const stream = (num: number, d: PdfDict, data: Uint8Array): Uint8Array =>
    concatBytes([
      encodeLatin1(`${String(num)} 0 obj\n${serialize(d)}\nstream\n`),
      data,
      encodeLatin1('\nendstream\nendobj\n'),
    ]);
  const cmapLines: string[] = [];
  const entries = [...used.entries()].filter(([, t]) => t.length > 0).sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100);
    cmapLines.push(`${String(chunk.length)} beginbfchar`);
    for (const [g, t] of chunk) cmapLines.push(`<${hex4(g)}> <${utf16hex(t)}>`);
    cmapLines.push('endbfchar');
  }
  const cmap = encodeLatin1(
    [
      '/CIDInit /ProcSet findresource begin',
      '12 dict begin',
      'begincmap',
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
      '/CMapName /Adobe-Identity-UCS def',
      '/CMapType 2 def',
      '1 begincodespacerange',
      '<0000> <FFFF>',
      'endcodespacerange',
      ...cmapLines,
      'endcmap',
      'CMapName currentdict /CMap defineresource pop',
      'end',
      'end',
    ].join('\n'),
  );
  const cmapZ = zlibSync(cmap);
  const objects = [
    obj(
      n.type0,
      new Map<string, PdfValue>([
        ['Type', N('Font')],
        ['Subtype', N('Type0')],
        ['BaseFont', N(baseFont)],
        ['Encoding', N('Identity-H')],
        ['DescendantFonts', [new PdfRef(n.cid, 0)]],
        ['ToUnicode', new PdfRef(n.tounicode, 0)],
      ]),
    ),
    obj(
      n.cid,
      new Map<string, PdfValue>([
        ['Type', N('Font')],
        ['Subtype', N(isCff ? 'CIDFontType0' : 'CIDFontType2')],
        ['BaseFont', N(baseFont)],
        [
          'CIDSystemInfo',
          new Map<string, PdfValue>([
            ['Registry', encodeStr('Adobe')],
            ['Ordering', encodeStr('Identity')],
            ['Supplement', 0],
          ]),
        ],
        ['FontDescriptor', new PdfRef(n.desc, 0)],
        ['DW', 0],
        ['W', W],
        ...(isCff ? [] : ([['CIDToGIDMap', N('Identity')]] as [string, PdfValue][])),
      ]),
    ),
    obj(
      n.desc,
      new Map<string, PdfValue>([
        ['Type', N('FontDescriptor')],
        ['FontName', N(baseFont)],
        ['Flags', flags],
        ['FontBBox', bbox],
        ['ItalicAngle', Math.round(italicAngle * 100) / 100],
        ['Ascent', Math.round(face.ascender * k)],
        ['Descent', Math.round(face.descender * k)],
        ['CapHeight', capHeight],
        ['StemV', weight >= 600 ? 140 : 80],
        [isCff ? 'FontFile3' : 'FontFile2', new PdfRef(n.file, 0)],
      ]),
    ),
    stream(
      n.file,
      new Map<string, PdfValue>([
        ['Length', compressed.length],
        ['Filter', N('FlateDecode')],
        ...(isCff
          ? ([['Subtype', N(cffBare ? 'CIDFontType0C' : 'OpenType')]] as [string, PdfValue][])
          : ([['Length1', program.length]] as [string, PdfValue][])),
      ]),
      compressed,
    ),
    stream(
      n.tounicode,
      new Map<string, PdfValue>([
        ['Length', cmapZ.length],
        ['Filter', N('FlateDecode')],
      ]),
      cmapZ,
    ),
  ];
  return {
    objects,
    type0: new PdfRef(n.type0, 0),
    bytes: { program: program.length, compressed: compressed.length },
  };
}

const encodeStr = (s: string): PdfString => PdfString.of(s);

// ------------------------------------------------------------------ assembly

export interface ExportedPage {
  num: number;
  gen: number;
  dict: PdfDict;
  bbox: [number, number, number, number];
  matrix: number[];
}

/**
 * `exported` (PDFium's one-page export of the comment's appearance) with an
 * incremental update: the page draws `/EPDFWRAP`, our form with `ops`, PDFium's
 * resources and our fonts. See freeTextColors.ts's
 * pageDrawing for why the page must draw exactly that one form.
 */
export function assemble(
  exported: Uint8Array,
  page: ExportedPage,
  baseResources: PdfValue,
  ops: string,
  usage: Usage,
  names: Map<Face, string>,
  sub: Subsetter,
  opts: { italic: boolean },
): { file: Uint8Array; fontBytes: number } {
  const size = trailerSize(exported);
  let next = size;
  const contentNum = next++;
  const formNum = next++;
  const fontRefs = new Map<string, PdfValue>();
  const extra: Uint8Array[] = [];
  let fontBytes = 0;
  for (const [face, used] of usage) {
    const r = fontObjects(face, used, next, sub, { italic: opts.italic });
    next += 5;
    fontRefs.set(names.get(face) ?? 'F0', r.type0);
    extra.push(...r.objects);
    fontBytes += r.objects.reduce((a, b) => a + b.length, 0);
  }
  // EPDFAnnot_SetAppearanceFromPage makes the page's MediaBox the appearance's /BBox, with no
  // /Matrix, and viewers fit that box to /Rect. /Rect is the bounds of PDFium's box after its
  // matrix (a turned comment's /Rect is larger than the box), so the page is that size and the
  // form keeps PDFium's matrix, moved to the bounds' corner.
  const [x0, y0, x1, y1] = page.bbox;
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = page.matrix;
  const corners = [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
  ].map(([x = 0, y = 0]) => [a * x + c * y + e, b * x + d * y + f] as const);
  const minX = Math.min(...corners.map((p) => p[0]));
  const minY = Math.min(...corners.map((p) => p[1]));
  const maxX = Math.max(...corners.map((p) => p[0]));
  const maxY = Math.max(...corners.map((p) => p[1]));
  const round = (v: number): number => Math.round(v * 10000) / 10000;
  const matrix = [a, b, c, d, e - minX, f - minY].map(round);
  // PDFium's resources (its /GS for the opacity), with our fonts in place of its own.
  const resources: PdfDict = isDict(baseResources)
    ? new Map(baseResources)
    : new Map<string, PdfValue>();
  resources.set('Font', fontRefs);
  const body = encodeLatin1(`${ops}\n`);
  const zbody = zlibSync(body);
  const form: PdfDict = new Map<string, PdfValue>([
    ['Type', new PdfName('XObject')],
    ['Subtype', new PdfName('Form')],
    ['BBox', [...page.bbox]],
    ['Matrix', matrix],
    ['Resources', resources],
    ['Filter', new PdfName('FlateDecode')],
    ['Length', zbody.length],
  ]);
  const pageDict: PdfDict = new Map(page.dict);
  pageDict.set('MediaBox', [0, 0, round(maxX - minX), round(maxY - minY)]);
  pageDict.delete('CropBox');
  pageDict.set(
    'Resources',
    new Map([['XObject', new Map([['EPDFWRAP', new PdfRef(formNum, 0)]])]]),
  );
  pageDict.set('Contents', new PdfRef(contentNum, 0));
  const pageContent = encodeLatin1('/EPDFWRAP Do\n');
  const eol = exported[exported.length - 1] === 0x0a ? '' : '\n';
  const parts: Uint8Array[] = [exported];
  const offsets = new Map<number, [number, number]>();
  let at = exported.length;
  const add = (num: number, gen: number, bytes: Uint8Array): void => {
    offsets.set(num, [at, gen]);
    parts.push(bytes);
    at += bytes.length;
  };
  parts.push(encodeLatin1(eol));
  at += eol.length;
  add(
    page.num,
    page.gen,
    encodeLatin1(`${String(page.num)} ${String(page.gen)} obj\n${serialize(pageDict)}\nendobj\n`),
  );
  add(
    contentNum,
    0,
    concatBytes([
      encodeLatin1(
        `${String(contentNum)} 0 obj\n<< /Length ${String(pageContent.length)} >>\nstream\n`,
      ),
      pageContent,
      encodeLatin1('\nendstream\nendobj\n'),
    ]),
  );
  add(
    formNum,
    0,
    concatBytes([
      encodeLatin1(`${String(formNum)} 0 obj\n${serialize(form)}\nstream\n`),
      zbody,
      encodeLatin1('\nendstream\nendobj\n'),
    ]),
  );
  let num = formNum + 1;
  for (const o of extra) add(num++, 0, o);
  const root = trailerRef(newestTrailerDict(exported), 'Root');
  if (!root) throw new Error('no /Root');
  const xref = writeXrefSection(
    'table',
    at,
    offsets,
    next,
    `/Root ${root} /Prev ${String(lastStartxref(exported))}`,
  );
  parts.push(xref.bytes);
  return { file: concatBytes(parts), fontBytes };
}
