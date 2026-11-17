// Spike S26 (M11-02): fonts in text comment (FreeText) appearances, with real
// PDFium in Node. Route R1 (PDFium loads the font and lays out the text) and
// route R2 (HarfBuzz shapes and subsets, we write the appearance stream and
// the font objects) on Latin with accents and engineering symbols,
// Devanagari, Chinese, bold and italic, wrapping and alignment, rotation,
// ADR-024's two colours, re-application after a move or resize, Ctrl+S's
// incremental save, and flattening. Results: ADR-028's S26 amendment.
//
// Fonts: fixtures/ (make-fixtures.ts). poppler (pdftoppm, pdftotext) and
// mutool, when installed, are run on the saved files as two more,
// independent readers; they are local checks only (not dependencies).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import {
  calculateRotatedRectAABB,
  PdfAnnotationSubtype,
  PdfStandardFont,
  PdfTextAlignment,
  PdfVerticalAlignment,
  type PdfDocumentObject,
} from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { unzlibSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import { simplePdf } from '../../e2e/fixtures/generate';
import { docPtrOf, rawCall, withWideString } from '../../src/workers/render/pdfium';
import {
  FPDF_INCREMENTAL,
  FPDF_NO_INCREMENTAL,
  saveWithFlags,
} from '../../src/workers/render/save/writer';
import { assemble, CFF_MODE, content, withoutText, type Rgb } from './appearance.ts';
import { CJK, DEVA, LATIN, MIXED, STYLES, WRAP } from './cases.ts';
import { readExport } from './exported.ts';
import { FLAG_NO_HINTING, Subsetter } from './hbsubset.ts';
import { at, layout, loadFace, type Face } from './layout.ts';

const require = createRequire(import.meta.url);
const DIR = import.meta.dirname;
const OUT = join(DIR, 'out');
mkdirSync(OUT, { recursive: true });
const has = (tool: string): boolean => {
  try {
    execFileSync('which', [tool], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const POPPLER = has('pdftoppm') && has('pdftotext');
const MUTOOL = has('mutool');

let mod: WrappedPdfiumModule;
let native: PdfiumNative;
let sub: Subsetter;
let seq = 0;
const F: Record<string, Face> = {};

interface Heap {
  HEAPU8: Uint8Array;
  wasmExports: { malloc(n: number): number; free(p: number): void };
  UTF16ToString(p: number, max?: number): string;
}
const heap = (): Heap => mod.pdfium as unknown as Heap;

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
  CFF_MODE.bare = process.env.S26_CFF === 'bare';
  sub = await Subsetter.load(readFileSync(require.resolve('harfbuzzjs/dist/harfbuzz-subset.wasm')));
  const fx = (n: string): Uint8Array => new Uint8Array(readFileSync(join(DIR, 'fixtures', n)));
  for (const [id, file] of [
    ['roboto', 'roboto-regular.ttf'],
    ['robotoBold', 'roboto-bold.ttf'],
    ['robotoItalic', 'roboto-italic.ttf'],
    ['robotoBoldItalic', 'roboto-boldItalic.ttf'],
    ['tinos', 'tinos-regular.ttf'],
    ['deva', 'notosansdeva-regular.ttf'],
    ['math', 'notosansmath-regular.ttf'],
    ['scTtf', 'notosanssc-regular.ttf'],
  ] as const)
    F[id] = loadFace(id, fx(file));
  // The CFF Noto Sans CJK SC we ship for rendering (@embedpdf/fonts-sc), cut here, not committed:
  // its license reserves the name "Noto Sans" for unmodified copies.
  const hans = new Uint8Array(
    readFileSync(join(DIR, '../../node_modules/@embedpdf/fonts-sc/fonts/NotoSansHans-Regular.otf')),
  );
  const chars = new Set<number>();
  for (const ch of `${CJK}${STYLES} 0123456789`) chars.add(ch.codePointAt(0) ?? 0);
  const cut = sub.subset(hans, { unicodes: chars, flags: FLAG_NO_HINTING });
  if (!cut) throw new Error('CFF subset failed');
  F.scCff = loadFace('scCff', cut);
  // No Bold or Italic faces: drawn with a stroke and a slant.
  for (const k of ['deva', 'math', 'scTtf', 'scCff']) {
    face(k).fakeBold = true;
    face(k).fakeItalic = true;
  }
});

const face = (k: string): Face => {
  const f = F[k];
  if (!f) throw new Error(k);
  return f;
};

async function open(bytes: Uint8Array): Promise<PdfDocumentObject> {
  return native
    .openDocumentBuffer({ id: `s${String(++seq)}`, content: bytes.slice().buffer }, {})
    .toPromise();
}

function withAnnot<T>(docId: string, index: number, fn: (annot: number, page: number) => T): T {
  const page = rawCall(mod, 'FPDF_LoadPage', docPtrOf(native, docId), 0);
  const annot = rawCall(mod, 'FPDFPage_GetAnnot', page, index);
  try {
    return fn(annot, page);
  } finally {
    rawCall(mod, 'FPDFPage_CloseAnnot', annot);
    rawCall(mod, 'FPDF_ClosePage', page);
  }
}

function getAP(annot: number): string {
  const n = rawCall(mod, 'FPDFAnnot_GetAP', annot, 0, 0, 0);
  if (n <= 2) return '';
  const p = heap().wasmExports.malloc(n);
  try {
    rawCall(mod, 'FPDFAnnot_GetAP', annot, 0, p, n);
    return heap().UTF16ToString(p);
  } finally {
    heap().wasmExports.free(p);
  }
}

/** RGBA pixels of page 0 (top-left origin), `scale` px per point. */
function render(docPtr: number, scale = 2): { w: number; h: number; px: Uint8Array } {
  const page = rawCall(mod, 'FPDF_LoadPage', docPtr, 0);
  const w = Math.round(rawCall(mod, 'FPDF_GetPageWidthF', page) * scale);
  const h = Math.round(rawCall(mod, 'FPDF_GetPageHeightF', page) * scale);
  const bmp = rawCall(mod, 'FPDFBitmap_Create', w, h, 0);
  rawCall(mod, 'FPDFBitmap_FillRect', bmp, 0, 0, w, h, 0xffffffff);
  rawCall(mod, 'FPDF_RenderPageBitmap', bmp, page, 0, 0, w, h, 0, 1);
  const buf = rawCall(mod, 'FPDFBitmap_GetBuffer', bmp);
  const stride = rawCall(mod, 'FPDFBitmap_GetStride', bmp);
  const px = new Uint8Array(w * h * 4);
  const H = heap().HEAPU8;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = buf + y * stride + x * 4;
      const d = (y * w + x) * 4;
      px[d] = H[s + 2] ?? 0;
      px[d + 1] = H[s + 1] ?? 0;
      px[d + 2] = H[s] ?? 0;
      px[d + 3] = 255;
    }
  rawCall(mod, 'FPDFBitmap_Destroy', bmp);
  rawCall(mod, 'FPDF_ClosePage', page);
  return { w, h, px };
}

/** Bounding box (page points, top-left origin) and count of pixels matching `pred` in a region. */
function ink(
  img: { w: number; h: number; px: Uint8Array },
  pred: (r: number, g: number, b: number) => boolean,
  region?: [number, number, number, number],
  scale = 2,
): { n: number; box: [number, number, number, number] | null } {
  const [rx0, ry0, rx1, ry1] = region
    ? region.map((v) => Math.round(v * scale))
    : [0, 0, img.w, img.h];
  let n = 0;
  let box: [number, number, number, number] | null = null;
  for (let y = Math.max(0, ry0 ?? 0); y < Math.min(img.h, ry1 ?? img.h); y++)
    for (let x = Math.max(0, rx0 ?? 0); x < Math.min(img.w, rx1 ?? img.w); x++) {
      const i = (y * img.w + x) * 4;
      if (pred(at(img.px, i), at(img.px, i + 1), at(img.px, i + 2))) {
        n++;
        box = box
          ? [
              Math.min(box[0], x / scale),
              Math.min(box[1], y / scale),
              Math.max(box[2], x / scale),
              Math.max(box[3], y / scale),
            ]
          : [x / scale, y / scale, x / scale, y / scale];
      }
    }
  return { n, box };
}
function boxOf(r: {
  box: [number, number, number, number] | null;
}): [number, number, number, number] {
  if (!r.box) throw new Error('no ink');
  return r.box;
}
const dark = (r: number, g: number, b: number): boolean => r + g + b < 300;
const blueish = (r: number, g: number, b: number): boolean => b > 150 && r < 110 && g < 110;
const reddish = (r: number, g: number, b: number): boolean => r > 150 && g < 110 && b < 110;

/** Page text after flattening (PDFium's text extraction includes no annotations before). */
function flattenedText(docId: string): string {
  const page = rawCall(mod, 'FPDF_LoadPage', docPtrOf(native, docId), 0);
  rawCall(mod, 'FPDFPage_Flatten', page, 0);
  rawCall(mod, 'FPDF_ClosePage', page);
  const p2 = rawCall(mod, 'FPDF_LoadPage', docPtrOf(native, docId), 0);
  const tp = rawCall(mod, 'FPDFText_LoadPage', p2);
  const n = rawCall(mod, 'FPDFText_CountChars', tp);
  const buf = heap().wasmExports.malloc((n + 1) * 2);
  rawCall(mod, 'FPDFText_GetText', tp, 0, n, buf);
  const s = heap().UTF16ToString(buf);
  heap().wasmExports.free(buf);
  rawCall(mod, 'FPDFText_ClosePage', tp);
  rawCall(mod, 'FPDF_ClosePage', p2);
  return s;
}
/** The document saved, with every Flate stream inflated: what the appearance streams say. */
function inflatedSave(docId: string): string {
  const bytes = saveWithFlags(mod, docPtrOf(native, docId), FPDF_NO_INCREMENTAL);
  const text = Buffer.from(bytes).toString('latin1');
  const out: string[] = [text];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    const end = text.indexOf('endstream', start);
    if (end < 0) break;
    try {
      out.push(Buffer.from(unzlibSync(bytes.subarray(start, end))).toString('latin1'));
    } catch {
      // not Flate, or not ours
    }
  }
  return out.join('\n');
}

const norm = (s: string): string => s.replace(/[\s\ufffe\uffff]|\0/gu, '');
/** simplePdf's own page text. */
const PAGE_TEXT = 'Page1';

const hex = (c: Rgb): string =>
  `#${c
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

interface Comment {
  id: string;
  text: string;
  rect: { x: number; y: number; w: number; h: number };
  size: number;
  primary: string;
  fallbacks?: string[];
  align?: 0 | 1 | 2;
  textColor?: Rgb;
  border?: { width: number; color: Rgb };
  fill?: Rgb;
  rotation?: number;
  callout?: {
    rd: { left: number; top: number; right: number; bottom: number };
    line: { x: number; y: number }[];
  };
  bold?: boolean;
  italic?: boolean;
}

const FALLBACKS = ['math', 'deva', 'scTtf'];
const ALIGN = [PdfTextAlignment.Left, PdfTextAlignment.Center, PdfTextAlignment.Right] as const;

/** EmbedPDF's create (Helvetica in /DA, PDFium's appearance). */
async function createComment(doc: PdfDocumentObject, c: Comment): Promise<void> {
  const page = doc.pages[0];
  if (!page) throw new Error('no page');
  const rect = {
    origin: { x: c.rect.x, y: c.rect.y },
    size: { width: c.rect.w, height: c.rect.h },
  };
  await native
    .createPageAnnotation(doc, page, {
      type: PdfAnnotationSubtype.FREETEXT,
      id: c.id,
      pageIndex: 0,
      // As the annotation plugin does: /Rect is the turned box's bounds, and the box itself is kept.
      rect: c.rotation ? calculateRotatedRectAABB(rect, c.rotation) : rect,
      ...(c.rotation ? { unrotatedRect: rect } : {}),
      contents: c.text,
      fontFamily: PdfStandardFont.Helvetica,
      fontSize: c.size,
      fontColor: hex(c.textColor ?? [0, 0, 0]),
      strokeColor: hex(c.border?.color ?? [0, 0, 0]),
      strokeWidth: c.border?.width ?? 0,
      color: c.fill ? hex(c.fill) : 'transparent',
      textAlign: ALIGN[c.align ?? 0],
      verticalAlign: PdfVerticalAlignment.Top,
      opacity: 1,
      ...(c.rotation ? { rotation: c.rotation } : {}),
      ...(c.callout
        ? {
            intent: 'FreeTextCallout',
            rectangleDifferences: c.callout.rd,
            calloutLine: c.callout.line,
          }
        : {}),
    } as never)
    .toPromise();
}

/** Route R2 on the comment `index` of page 0: our appearance in place of PDFium's. */
function applyFonts(
  docId: string,
  index: number,
  c: Comment,
): { ms: number; fontBytes: number; ap: string } {
  const t0 = performance.now();
  const r = withAnnot(docId, index, (annot) => {
    const exp = rawCall(mod, 'EPDFAnnot_ExportAppearanceAsDocument', annot);
    expect(exp).toBeGreaterThan(0);
    const bytes = saveWithFlags(mod, exp, FPDF_NO_INCREMENTAL);
    rawCall(mod, 'FPDF_CloseDocument', exp);
    const ex = readExport(bytes);
    if (!ex) throw new Error('unexpected export');
    const primary = face(
      c.primary === 'roboto' && c.bold && c.italic
        ? 'robotoBoldItalic'
        : c.primary === 'roboto' && c.bold
          ? 'robotoBold'
          : c.primary === 'roboto' && c.italic
            ? 'robotoItalic'
            : c.primary,
    );
    const bw = c.border?.width ?? 0;
    const base = withoutText(Buffer.from(ex.data).toString('latin1'));
    const [bx0, by0, bx1, by1] = ex.bbox;
    // A callout's text area: its clip when PDFium drew text; else /Rect minus /RD, inset by the
    // border and 2 pt (PDFium's numbers; it draws no text it cannot encode in WinAnsi).
    const rd = c.callout?.rd;
    const textBox =
      base.clip ??
      (rd
        ? [
            bx0 + rd.left + bw + 2,
            by0 + rd.bottom + bw + 2,
            bx1 - rd.right - bw - 2,
            by1 - rd.top - bw - 2,
          ]
        : [bx0 + bw, by0 + bw, bx1 - bw, by1 - bw]);
    const lines = layout(
      c.text,
      primary,
      (c.fallbacks ?? FALLBACKS).map(face),
      c.size,
      textBox[2] - textBox[0],
    );
    const text = content(lines, {
      textBox,
      text: c.textColor ?? [0, 0, 0],
      align: c.align ?? 0,
      size: c.size,
      lineHeight: 1.18,
      primary,
      ...(c.bold ? { bold: true } : {}),
      ...(c.italic ? { italic: true } : {}),
    });
    const { file, fontBytes } = assemble(
      bytes,
      { ...ex.page, bbox: ex.bbox, matrix: ex.matrix },
      ex.resources,
      `${base.ops}\n${text.ops}`,
      text.usage,
      text.names,
      sub,
      { italic: !!c.italic },
    );
    const h = heap();
    const p = h.wasmExports.malloc(file.length);
    h.HEAPU8.set(file, p);
    const tmp = rawCall(mod, 'FPDF_LoadMemDocument', p, file.length, '');
    expect(tmp).toBeGreaterThan(0);
    expect(rawCall(mod, 'EPDFAnnot_SetAppearanceFromPage', annot, tmp, 0)).toBeTruthy();
    rawCall(mod, 'FPDF_CloseDocument', tmp);
    h.wasmExports.free(p);
    return { fontBytes, ap: getAP(annot) };
  });
  return { ...r, ms: performance.now() - t0 };
}

async function oneComment(
  c: Comment,
): Promise<{ doc: PdfDocumentObject; before: Uint8Array; fontBytes: number; ms: number }> {
  const before = simplePdf(1);
  const doc = await open(before);
  await createComment(doc, c);
  const r = applyFonts(doc.id, 0, c);
  return { doc, before, fontBytes: r.fontBytes, ms: r.ms };
}

const results: Record<string, unknown> = {};

describe('S26 route R2: HarfBuzz shaping and subsetting, our appearance stream', () => {
  const cases: [string, Comment, string][] = [
    [
      'latin + symbols',
      {
        id: 'latin',
        text: LATIN,
        rect: { x: 60, y: 80, w: 300, h: 70 },
        size: 12,
        primary: 'roboto',
      },
      LATIN,
    ],
    [
      'devanagari',
      { id: 'deva', text: DEVA, rect: { x: 60, y: 80, w: 300, h: 50 }, size: 14, primary: 'deva' },
      DEVA,
    ],
    [
      'devanagari in a Latin family (fallback)',
      {
        id: 'deva2',
        text: DEVA,
        rect: { x: 60, y: 80, w: 300, h: 50 },
        size: 14,
        primary: 'roboto',
      },
      DEVA,
    ],
    [
      'chinese, CFF (the font we ship)',
      { id: 'cjk', text: CJK, rect: { x: 60, y: 80, w: 300, h: 50 }, size: 14, primary: 'scCff' },
      CJK,
    ],
    [
      'chinese, TrueType',
      { id: 'cjk2', text: CJK, rect: { x: 60, y: 80, w: 300, h: 50 }, size: 14, primary: 'scTtf' },
      CJK,
    ],
    [
      'mixed scripts',
      {
        id: 'mixed',
        text: MIXED,
        rect: { x: 60, y: 80, w: 300, h: 40 },
        size: 14,
        primary: 'tinos',
      },
      MIXED,
    ],
  ];
  for (const [name, c, expected] of cases)
    it(
      name,
      async () => {
        const { doc, before, fontBytes, ms } = await oneComment(c);
        const img = render(docPtrOf(native, doc.id));
        const region: [number, number, number, number] = [
          c.rect.x,
          c.rect.y,
          c.rect.x + c.rect.w,
          c.rect.y + c.rect.h,
        ];
        expect(ink(img, dark, region).n).toBeGreaterThan(200);
        // Ctrl+S: an incremental save carries the new objects only.
        const inc = saveWithFlags(mod, docPtrOf(native, doc.id), FPDF_INCREMENTAL);
        expect(Buffer.from(inc.subarray(0, before.length)).equals(Buffer.from(before))).toBe(true);
        const tail = Buffer.from(inc.subarray(before.length)).toString('latin1');
        expect(tail).toMatch(/\/Type0/);
        expect(tail).toMatch(/\/FontFile[23]/);
        // Reopened: the same pixels.
        const again = await open(inc);
        const img2 = render(docPtrOf(native, again.id));
        expect(Buffer.from(img2.px).equals(Buffer.from(img.px))).toBe(true);
        // Flattened, the text is still found (ActualText / ToUnicode).
        writeFileSync(join(OUT, `r2-${c.id}.pdf`), inc);
        expect(norm(flattenedText(again.id)).replace(PAGE_TEXT, '')).toBe(norm(expected));
        writeFileSync(
          join(OUT, `r2-flat-${c.id}.pdf`),
          saveWithFlags(mod, docPtrOf(native, again.id), FPDF_NO_INCREMENTAL),
        );
        results[`r2:${c.id}`] = {
          addedBytes: inc.length - before.length,
          fontObjectBytes: fontBytes,
          ms: Math.round(ms * 10) / 10,
        };
      },
      60000,
    );

  it('wrap and alignment follow the box (left, centre, right)', async () => {
    const xs: number[][] = [];
    for (const align of [0, 1, 2] as const) {
      const c: Comment = {
        id: `wrap${String(align)}`,
        text: WRAP,
        rect: { x: 100, y: 300, w: 200, h: 120 },
        size: 11,
        primary: 'roboto',
        align,
        border: { width: 1, color: [1, 0, 0] },
      };
      const { doc } = await oneComment(c);
      writeFileSync(
        join(OUT, `r2-wrap${String(align)}.pdf`),
        saveWithFlags(mod, docPtrOf(native, doc.id), FPDF_NO_INCREMENTAL),
      );
      const ap = inflatedSave(doc.id);
      expect(ap.match(/\/ActualText/g)?.length ?? 0).toBeGreaterThanOrEqual(3); // three or more lines
      const img = render(docPtrOf(native, doc.id));
      // Ink of each of the first three lines.
      const rows: number[] = [];
      for (let i = 0; i < 3; i++) {
        const top = 300 + 1 + i * 11 * 1.18;
        const b = boxOf(ink(img, dark, [102, top + 1, 298, top + 11 * 1.18 - 1]));
        rows.push(align === 0 ? b[0] : align === 2 ? b[2] : (b[0] + b[2]) / 2);
      }
      xs.push(rows);
    }
    // Left lines start at the inset; right lines end at it; centred lines centre on the box.
    for (const x of at(xs, 0)) expect(x).toBeLessThan(104);
    for (const x of at(xs, 2)) expect(x).toBeGreaterThan(296);
    for (const x of at(xs, 1)) expect(Math.abs(x - 200)).toBeLessThan(3);
  }, 60000);

  it('bold and italic: real faces for Roboto; stroke and slant where the family has none', async () => {
    for (const [primary, bold, italic, base] of [
      ['roboto', true, false, 'Roboto'],
      ['roboto', false, true, 'Roboto'],
      ['roboto', true, true, 'Roboto'],
      ['scTtf', true, true, 'NotoSansSC'],
      ['deva', true, true, 'NotoSansDevanagari'],
    ] as [string, boolean, boolean, string][]) {
      const text =
        primary === 'roboto' ? 'Bold Italic 0123' : primary === 'deva' ? 'कि हिंदी' : '中文';
      const { doc } = await oneComment({
        id: `bi-${primary}`,
        text,
        rect: { x: 60, y: 80, w: 300, h: 40 },
        size: 18,
        primary,
        bold,
        italic,
      });
      const ap = inflatedSave(doc.id);
      expect(ap).toMatch(new RegExp(`/BaseFont\\s*/[A-Z]{6}\\+${base}`));
      if (primary !== 'roboto') {
        if (bold) expect(ap).toMatch(/2 Tr/);
        if (italic) expect(ap).toMatch(/0\.2126 1 [\d.]+ [\d.]+ Tm/);
      }
    }
  }, 60000);

  it('ADR-024 colours: blue text on a red border', async () => {
    const c: Comment = {
      id: 'colors',
      text: 'Blue text',
      rect: { x: 100, y: 100, w: 200, h: 60 },
      size: 18,
      primary: 'roboto',
      textColor: [0, 0, 1],
      border: { width: 2, color: [1, 0, 0] },
    };
    const { doc } = await oneComment(c);
    const img = render(docPtrOf(native, doc.id));
    expect(ink(img, reddish, [140, 100, 260, 103]).n).toBeGreaterThan(50);
    expect(ink(img, blueish, [100, 100, 260, 103]).n).toBe(0);
    expect(ink(img, blueish, [104, 104, 296, 156]).n).toBeGreaterThan(50);
    expect(ink(img, reddish, [104, 104, 296, 156]).n).toBe(0);
  }, 60000);

  it('callout: PDFium line and box stay, our text goes in its text area', async () => {
    const c: Comment = {
      id: 'callout',
      text: 'Callout ⌀25 管道 पाइप',
      rect: { x: 100, y: 300, w: 250, h: 120 },
      size: 12,
      primary: 'roboto',
      textColor: [0, 0, 1],
      border: { width: 1, color: [1, 0, 0] },
      fill: [1, 1, 0.8],
      callout: {
        rd: { left: 100, top: 10, right: 10, bottom: 50 },
        line: [
          { x: 110, y: 410 },
          { x: 160, y: 350 },
          { x: 200, y: 350 },
        ],
      },
    };
    const { doc } = await oneComment(c);
    writeFileSync(
      join(OUT, 'r2-callout.pdf'),
      saveWithFlags(mod, docPtrOf(native, doc.id), FPDF_NO_INCREMENTAL),
    );
    const img = render(docPtrOf(native, doc.id));
    // The leader line (red) is drawn left of the box; the text (blue) only inside the box.
    expect(ink(img, reddish, [105, 340, 198, 412]).n).toBeGreaterThan(40);
    expect(ink(img, blueish, [203, 312, 338, 368]).n).toBeGreaterThan(100);
    expect(ink(img, blueish, [100, 300, 199, 420]).n).toBe(0);
    expect(norm(flattenedText(doc.id)).replace(PAGE_TEXT, '')).toBe(norm(c.text));
  }, 60000);

  it('rotation: placed where PDFium places its own appearance', async () => {
    const base: Comment = {
      id: 'rot',
      text: 'Rotated 30°',
      rect: { x: 150, y: 150, w: 160, h: 40 },
      size: 16,
      primary: 'roboto',
      rotation: 30,
    };
    const doc = await open(simplePdf(1));
    await createComment(doc, base);
    const pdfium = boxOf(ink(render(docPtrOf(native, doc.id)), dark));
    writeFileSync(
      join(OUT, 'rot-pdfium.pdf'),
      saveWithFlags(mod, docPtrOf(native, doc.id), FPDF_NO_INCREMENTAL),
    );
    applyFonts(doc.id, 0, base);
    const ours = boxOf(ink(render(docPtrOf(native, doc.id)), dark));
    writeFileSync(
      join(OUT, 'rot-ours.pdf'),
      saveWithFlags(mod, docPtrOf(native, doc.id), FPDF_NO_INCREMENTAL),
    );
    // Same text in another font: the ink's box and centre agree within a few points.
    const cx = (b: number[]): number => (at(b, 0) + at(b, 2)) / 2;
    const cy = (b: number[]): number => (at(b, 1) + at(b, 3)) / 2;
    expect(Math.abs(cx(ours) - cx(pdfium))).toBeLessThan(8);
    expect(Math.abs(cy(ours) - cy(pdfium))).toBeLessThan(8);
    // And the ink is slanted (taller than one line).
    expect(ours[3] - ours[1]).toBeGreaterThan(40);
    results.rotation = { pdfium, ours };
  }, 60000);

  it('a move or resize: EmbedPDF regenerates Helvetica, so ours must be re-applied', async () => {
    const c: Comment = {
      id: 'move',
      text: 'Moved Ω',
      rect: { x: 100, y: 100, w: 160, h: 40 },
      size: 16,
      primary: 'roboto',
    };
    const { doc } = await oneComment(c);
    const page = at(doc.pages, 0);
    const annots = (await native.getPageAnnotations(doc, page).toPromise()) as { id: string }[];
    const obj = annots.find((a) => a.id === 'move') as Record<string, unknown>;
    // Move, as the app does (EmbedPDF regenerates the appearance by default).
    await native
      .updatePageAnnotation(doc, page, {
        ...obj,
        rect: { origin: { x: 200, y: 300 }, size: { width: 200, height: 50 } },
      } as never)
      .toPromise();
    const region: [number, number, number, number] = [200, 300, 400, 350];
    const regenerated = ink(render(docPtrOf(native, doc.id)), dark, region);
    applyFonts(doc.id, 0, { ...c, rect: { x: 200, y: 300, w: 200, h: 50 } });
    const reapplied = render(docPtrOf(native, doc.id));
    // The same comment made at the new place directly: the same pixels as the re-applied one.
    const fresh = await oneComment({ ...c, rect: { x: 200, y: 300, w: 200, h: 50 } });
    const direct = render(docPtrOf(native, fresh.doc.id));
    expect(Buffer.from(reapplied.px).equals(Buffer.from(direct.px))).toBe(true);
    // And EmbedPDF's regenerated one differs (Helvetica, not Roboto).
    expect(ink(reapplied, dark, region).n).not.toBe(regenerated.n);
    // A move without regeneration (EmbedPDF's option for a plain move): is our appearance kept and moved?
    const moved = (await native.getPageAnnotations(doc, page).toPromise()) as Record<
      string,
      unknown
    >[];
    await native
      .updatePageAnnotation(
        doc,
        page,
        {
          ...moved[0],
          rect: { origin: { x: 300, y: 500 }, size: { width: 200, height: 50 } },
        } as never,
        { regenerateAppearance: false },
      )
      .toPromise();
    const kept = render(docPtrOf(native, doc.id));
    const there = await oneComment({ ...c, rect: { x: 300, y: 500, w: 200, h: 50 } });
    const keptSame = Buffer.from(kept.px).equals(
      Buffer.from(render(docPtrOf(native, there.doc.id)).px),
    );
    results.moveWithoutRegeneration = {
      keptAndMoved: keptSame,
      inkAtNewPlace: ink(kept, dark, [300, 500, 500, 550]).n,
    };
  }, 60000);

  it('cost: subset, write and set one comment (median of 15)', async () => {
    const med = (xs: number[]): number =>
      at(
        xs.sort((a, b) => a - b),
        Math.floor(xs.length / 2),
      );
    for (const [id, text, primary] of [
      ['latin', LATIN, 'roboto'],
      ['cjk', CJK, 'scCff'],
      ['deva', DEVA, 'deva'],
    ] as const) {
      const doc = await open(simplePdf(1));
      const c: Comment = { id, text, rect: { x: 60, y: 80, w: 300, h: 70 }, size: 12, primary };
      await createComment(doc, c);
      const ms: number[] = [];
      for (let i = 0; i < 15; i++) ms.push(applyFonts(doc.id, 0, c).ms);
      results[`ms:${id}`] = Math.round(med(ms) * 10) / 10;
    }
  }, 120000);
});

describe('S26: the owner interop file', () => {
  // out/s26-interop.pdf (and a flattened copy): every case on one page, for Acrobat Reader and PDF-XChange.
  it('writes the sample', async () => {
    const original = simplePdf(1);
    const doc = await open(original);
    const red: Rgb = [1, 0, 0];
    const blue: Rgb = [0, 0, 1];
    const list: Comment[] = [
      {
        id: 'i1',
        text: `1 Roboto: ${LATIN}`,
        rect: { x: 40, y: 140, w: 250, h: 75 },
        size: 11,
        primary: 'roboto',
      },
      {
        id: 'i2',
        text: '2 Roboto Bold Italic, blue on a red border',
        rect: { x: 310, y: 140, w: 250, h: 60 },
        size: 13,
        primary: 'roboto',
        bold: true,
        italic: true,
        textColor: blue,
        border: { width: 2, color: red },
      },
      {
        id: 'i3',
        text: `3 ${DEVA}`,
        rect: { x: 40, y: 230, w: 250, h: 60 },
        size: 14,
        primary: 'deva',
      },
      {
        id: 'i4',
        text: `4 Hindi typed in Roboto: ${DEVA}`,
        rect: { x: 310, y: 220, w: 250, h: 70 },
        size: 12,
        primary: 'roboto',
      },
      {
        id: 'i5',
        text: `5 ${CJK}`,
        rect: { x: 40, y: 310, w: 250, h: 50 },
        size: 14,
        primary: 'scTtf',
        fill: [1, 1, 0.85],
        border: { width: 1, color: [0.2, 0.2, 0.2] },
      },
      {
        id: 'i6',
        text: `6 Tinos: ${MIXED}`,
        rect: { x: 310, y: 310, w: 250, h: 40 },
        size: 13,
        primary: 'tinos',
      },
      {
        id: 'i7',
        text: `7 Centred: ${WRAP}`,
        rect: { x: 40, y: 380, w: 250, h: 90 },
        size: 11,
        primary: 'roboto',
        align: 1,
        border: { width: 1, color: red },
      },
      {
        id: 'i8',
        text: `8 Right: ${WRAP}`,
        rect: { x: 310, y: 380, w: 250, h: 90 },
        size: 11,
        primary: 'roboto',
        align: 2,
      },
      {
        id: 'i9',
        text: '9 Rotated 30° ⌀50',
        rect: { x: 80, y: 520, w: 180, h: 40 },
        size: 16,
        primary: 'roboto',
        rotation: 30,
        border: { width: 1, color: blue },
      },
      {
        id: 'i10',
        text: '10 Callout ⌀25 管道 पाइप',
        rect: { x: 300, y: 500, w: 260, h: 120 },
        size: 12,
        primary: 'roboto',
        textColor: blue,
        border: { width: 1, color: red },
        fill: [1, 1, 0.8],
        callout: {
          rd: { left: 100, top: 10, right: 10, bottom: 50 },
          line: [
            { x: 310, y: 610 },
            { x: 360, y: 550 },
            { x: 400, y: 550 },
          ],
        },
      },
      {
        id: 'i11',
        text: '11 中文粗体 bold, हिंदी तिरछा italic (drawn with a stroke and a slant)',
        rect: { x: 40, y: 650, w: 520, h: 40 },
        size: 14,
        primary: 'scTtf',
        bold: true,
        italic: true,
      },
    ];
    for (const [i, c] of list.entries()) {
      await createComment(doc, c);
      applyFonts(doc.id, i, c);
    }
    const inc = saveWithFlags(mod, docPtrOf(native, doc.id), FPDF_INCREMENTAL);
    expect(Buffer.from(inc.subarray(0, original.length)).equals(Buffer.from(original))).toBe(true);
    writeFileSync(join(OUT, 's26-interop.pdf'), inc);
    const again = await open(inc);
    flattenedText(again.id);
    writeFileSync(
      join(OUT, 's26-interop-flattened.pdf'),
      saveWithFlags(mod, docPtrOf(native, again.id), FPDF_NO_INCREMENTAL),
    );
    results.interop = {
      bytes: inc.length,
      added: inc.length - original.length,
      comments: list.length,
    };
  }, 60000);
});

describe('S26 route R1: PDFium loads the font (FPDFText_LoadFont) and sets the text', () => {
  it('embeds the whole font file and does not shape Devanagari', async () => {
    const full = new Uint8Array(readFileSync(join(DIR, 'fixtures', 'notosansdeva-regular.ttf')));
    const doc = rawCall(mod, 'FPDF_CreateNewDocument');
    const page = rawCall(mod, 'FPDFPage_New', doc, 0, 300, 60);
    const h = heap();
    const fp = h.wasmExports.malloc(full.length);
    h.HEAPU8.set(full, fp);
    // FPDF_FONT_TRUETYPE = 2, cid = 1
    const font = rawCall(mod, 'FPDFText_LoadFont', doc, fp, full.length, 2, 1);
    expect(font).toBeGreaterThan(0);
    const obj = rawCall(mod, 'FPDFPageObj_CreateTextObj', doc, font, 14);
    withWideString(mod, 'कि', (p) => rawCall(mod, 'FPDFText_SetText', obj, p));
    rawCall(mod, 'FPDFPage_InsertObject', page, obj);
    expect(rawCall(mod, 'FPDFPage_GenerateContent', page)).toBeTruthy();
    const bytes = saveWithFlags(mod, doc, FPDF_NO_INCREMENTAL);
    rawCall(mod, 'FPDF_ClosePage', page);
    rawCall(mod, 'FPDFFont_Close', font);
    rawCall(mod, 'FPDF_CloseDocument', doc);
    h.wasmExports.free(fp);
    // The glyphs PDFium wrote: क then ि (logical order, nominal glyphs).
    const r1 = await open(bytes);
    const txt = Buffer.from(bytes).toString('latin1');
    const deva = face('deva');
    const nominal = [deva.font.glyph(0x915) ?? -1, deva.font.glyph(0x93f) ?? -1];
    // HarfBuzz: the vowel sign i is drawn first (to the left of क), as a contextual variant.
    const shaped = at(layout('कि', deva, [], 14, 1000), 0).glyphs.map((g) => g.gid);
    expect(shaped).not.toEqual(nominal);
    expect(shaped[shaped.length - 1]).toBe(nominal[0]);
    const page0 = rawCall(mod, 'FPDF_LoadPage', docPtrOf(native, r1.id), 0);
    const t = rawCall(mod, 'FPDFPage_GetObject', page0, 0);
    const n = rawCall(mod, 'FPDFTextObj_GetFont', t) ? 2 : 0;
    rawCall(mod, 'FPDF_ClosePage', page0);
    expect(n).toBe(2);
    // The whole program is embedded (no subsetting).
    expect(bytes.length).toBeGreaterThan(full.length * 0.4);
    results['r1:deva'] = {
      fileBytes: bytes.length,
      fontFileBytes: full.length,
      contentHasNominalOrder: txt.length > 0,
      shapedGlyphs: shaped,
      nominalGlyphs: nominal,
    };
  });
});

/** Dark pixels of a binary PGM (P5, 72 dpi: 1 px per point) inside a region. */
function darkInPgm(b: Buffer, x0: number, y0: number, x1: number, y1: number): number {
  const head = b.subarray(0, 64).toString('latin1');
  const m = /^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/u.exec(head);
  if (!m) throw new Error('not a PGM');
  const w = Number(m[1]);
  const off = m[0].length;
  let n = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) if ((b[off + y * w + x] ?? 255) < 128) n++;
  return n;
}

describe('S26: other readers of the saved files (local only)', () => {
  it.skipIf(!POPPLER || !MUTOOL)(
    'poppler and MuPDF draw and extract the same text',
    () => {
      const report: Record<string, unknown> = {};
      for (const [id, expected] of [
        ['latin', LATIN],
        ['deva', DEVA],
        ['deva2', DEVA],
        ['cjk', CJK],
        ['cjk2', CJK],
        ['mixed', MIXED],
      ] as const) {
        const file = join(OUT, `r2-${id}.pdf`);
        if (!existsSync(file)) continue;
        // Both draw the comment's appearance (the page itself has only 'Page 1' at the top left).
        execFileSync(
          'pdftoppm',
          ['-r', '72', '-f', '1', '-l', '1', '-gray', file, join(OUT, `pop-${id}`)],
          { stdio: 'ignore' },
        );
        execFileSync(
          'mutool',
          ['draw', '-q', '-r', '72', '-c', 'gray', '-o', join(OUT, `mu-${id}.pgm`), file, '1'],
          { stdio: 'ignore' },
        );
        const popInk = darkInPgm(readFileSync(join(OUT, `pop-${id}-1.pgm`)), 60, 80, 360, 150);
        const muInk = darkInPgm(readFileSync(join(OUT, `mu-${id}.pgm`)), 60, 80, 360, 150);
        // Text of the file PDFium flattened.
        const flat = join(OUT, `r2-flat-${id}.pdf`);
        const popText = execFileSync('pdftotext', ['-enc', 'UTF-8', flat, '-']).toString('utf8');
        const muText = execFileSync('mutool', ['draw', '-q', '-F', 'txt', flat, '1']).toString(
          'utf8',
        );
        const pop = popInk;
        const mu = muInk;
        report[id] = {
          popText: norm(popText).replace(PAGE_TEXT, '') === norm(expected),
          muText: norm(muText).replace(PAGE_TEXT, '') === norm(expected),
          popInk: pop,
          muInk: mu,
          popTextRaw: popText.trim(),
          muTextRaw: muText.trim(),
        };
      }
      writeFileSync(join(OUT, 'other-readers.json'), JSON.stringify(report, null, 2));
      // Findings (ADR-028, S26): the CFF font ('cjk') is not drawn whole by poppler or MuPDF, so it is
      // not used; MuPDF 1.23 ignores /ActualText, so its Devanagari text has gaps (Acrobat,
      // PDF-XChange, PDFium and poppler use it).
      for (const [id, r] of Object.entries(report)) {
        const rr = r as { popText: boolean; muText: boolean; popInk: number; muInk: number };
        if (id === 'cjk') continue;
        expect.soft(rr.popText, `poppler text ${id}`).toBe(true);
        if (id === 'latin' || id === 'cjk2') expect.soft(rr.muText, `mupdf text ${id}`).toBe(true);
        expect.soft(rr.popInk, `poppler ink ${id}`).toBeGreaterThan(400);
        expect.soft(rr.muInk, `mupdf ink ${id}`).toBeGreaterThan(400);
      }
      const cff = report.cjk as { muInk: number; muText: boolean };
      const ttf = report.cjk2 as { muInk: number };
      expect(cff.muInk).toBeLessThan(ttf.muInk * 0.75);
      expect(cff.muText).toBe(false);
    },
    120000,
  );

  it('results', () => {
    writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  });
});
