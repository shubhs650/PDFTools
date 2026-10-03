// The OCR text layer by our object layer (ADR-020 decisions 3 and 4, amended
// 2026-10-03; from spikes/s17-ocr/layer.ts and glyphless.ts). Per recognized
// page: one new content stream with the words as invisible text (render mode
// 3, ISO 32000-1 9.3.6) appended to /Contents behind a `q` … `Q` wrap of the
// original streams, which stay byte for byte as they were. The font is
// Tesseract's GlyphLessFont, embedded once per document as a CIDFontType2
// with Identity-H (2-byte codes = UTF-16 code units) and an identity
// ToUnicode CMap, so words in any script are extracted as their Unicode text
// (Devanagari and Chinese included) while nothing is drawn. A page's own
// /Resources gets the font (inherited or shared resources are copied inline
// first, never modified); a layer this app wrote before is replaced. The
// objects go to the Render worker's `pagesApply` (reopen with objects, the
// ADR-018 route). Pure: the caller supplies the raster → page mapping
// (PDFium's FPDF_DeviceToPage); strings and streams are encrypted for an
// encrypted document.
import { zlibSync } from 'fflate';
import { GLYPHLESS_ASCENT, GLYPHLESS_DW, glyphlessFontBytes } from '../../model/ocr/glyphlessFont';
import type { OcrBox, OcrLine, PageOcr } from '../../model/ocr/types';
import {
  PdfName,
  PdfRef,
  PdfStream,
  PdfString,
  isDict,
  serialize,
  serializeIndirect,
  type PdfDict,
  type PdfValue,
} from '../../model/pdf/objects';
import type { PdfReader } from '../../model/pdf/reader';
import { concatBytes, encodeLatin1, latin1 } from '../render/save/bytes';
import type { ExtraObject } from '../render/save/narrowTail';

/** The font's resource name on the page (a collision is overwritten). */
export const FONT_KEY = 'PDFToolsOCR';
/** How the layer's streams start: a layer written before is recognized by them. */
const PRE_STREAM = 'q\n';
const POST_PREFIX = `Q\nBT\n3 Tr\n/${FONT_KEY} 1 Tf\n`;
/** Smallest font size written (points); a word that comes out smaller is dropped. */
const MIN_SIZE = 0.5;

export interface LayerDeps {
  /** Raster pixel (y down) of page `pageIndex`'s raster → unrotated page space (user units). */
  toPage(pageIndex: number, dx: number, dy: number): [number, number];
}

export interface LayerResult {
  objects: ExtraObject[];
  /** The first object number allocated (the Render worker refuses a stale state). */
  firstNew: number;
  /** Words written and words dropped (no BMP character, degenerate box). */
  words: number;
  skipped: number;
  /** Pages that received a layer. */
  pages: number[];
  /** Of them, pages whose earlier layer from this app was replaced. */
  replaced: number;
}

const fmt = (n: number): string => {
  const s = n.toFixed(3);
  return s.replace(/\.?0+$/, '') || '0';
};

/** Unit vector, or `fallback` for a zero vector. */
const unit = (x: number, y: number, fallback: [number, number]): [number, number] => {
  const n = Math.hypot(x, y);
  return n > 1e-6 ? [x / n, y / n] : fallback;
};

const corners = (b: OcrBox): [number, number][] => [
  [b.x0, b.y0],
  [b.x1, b.y0],
  [b.x0, b.y1],
  [b.x1, b.y1],
];

/** UTF-16BE code units of the text's BMP characters (others are left out). */
export function utf16Bytes(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp > 0xffff) continue;
    out.push(cp >> 8, cp & 0xff);
  }
  return Uint8Array.from(out);
}

/**
 * One `Tm … Tj` per word. The text runs along the line's baseline in whatever
 * direction Tesseract found it (a sideways scan has vertical baselines):
 * positions are projections onto the baseline direction and its "up" normal
 * in raster pixels, mapped to page space by `toPage`, which applies /Rotate
 * and the scale. Font size: the line's ascent above the baseline / the font's
 * ascent; each word is stretched to its box width (every glyph advances /DW).
 */
export function lineOps(
  line: OcrLine,
  page: PageOcr,
  deps: LayerDeps,
): { ops: string[]; skipped: number } {
  const ops: string[] = [];
  let skipped = 0;
  const base = line.baseline ?? {
    x0: line.box.x0,
    y0: line.box.y1,
    x1: line.box.x1,
    y1: line.box.y1,
  };
  const [dx, dy] = unit(base.x1 - base.x0, base.y1 - base.y0, [1, 0]);
  // "Up" for the glyphs (raster y grows downwards): the baseline direction turned 90° counterclockwise on screen.
  const ux = dy;
  const uy = -dx;
  const along = (x: number, y: number) => (x - base.x0) * dx + (y - base.y0) * dy;
  const above = (x: number, y: number) => (x - base.x0) * ux + (y - base.y0) * uy;
  const ascentPx = Math.max(4, ...corners(line.box).map(([x, y]) => above(x, y)));
  for (const word of line.words) {
    const bytes = utf16Bytes(word.text);
    const natural = (bytes.length / 2) * (GLYPHLESS_DW / 1000); // per em
    if (bytes.length === 0) {
      skipped++;
      continue;
    }
    const ts = corners(word.box).map(([x, y]) => along(x, y));
    const t0 = Math.min(...ts);
    const t1 = Math.max(...ts);
    const start: [number, number] = [base.x0 + dx * t0, base.y0 + dy * t0];
    const end: [number, number] = [base.x0 + dx * t1, base.y0 + dy * t1];
    const top: [number, number] = [start[0] + ux * ascentPx, start[1] + uy * ascentPx];
    const [sx, sy] = deps.toPage(page.pageIndex, start[0], start[1]);
    const [ex, ey] = deps.toPage(page.pageIndex, end[0], end[1]);
    const [tx, ty] = deps.toPage(page.pageIndex, top[0], top[1]);
    const size = Math.hypot(tx - sx, ty - sy) / GLYPHLESS_ASCENT;
    const len = Math.hypot(ex - sx, ey - sy);
    if (!(size >= MIN_SIZE) || !(len > 0)) {
      skipped++;
      continue;
    }
    const [dirX, dirY] = unit(ex - sx, ey - sy, [1, 0]);
    const [upX, upY] = unit(tx - sx, ty - sy, [-dirY, dirX]);
    const stretch = len / (natural * size);
    const a = dirX * size * stretch;
    const b = dirY * size * stretch;
    const c = upX * size;
    const d = upY * size;
    ops.push(
      `${fmt(a)} ${fmt(b)} ${fmt(c)} ${fmt(d)} ${fmt(sx)} ${fmt(sy)} Tm ${serialize(new PdfString(bytes, true))} Tj`,
    );
  }
  return { ops, skipped };
}

/** An inheritable page attribute (/Resources) through the /Parent chain. */
async function inherited(
  reader: PdfReader,
  dict: PdfDict,
  key: string,
): Promise<PdfValue | undefined> {
  let node: PdfValue | undefined = dict;
  for (let depth = 0; depth < 64 && isDict(node); depth++) {
    const v = node.get(key);
    if (v !== undefined) return v;
    node = await reader.resolve(node.get('Parent'));
  }
  return undefined;
}

/** The content of the text stream for `ops`. */
export const textStream = (ops: readonly string[]): string =>
  `${POST_PREFIX}${ops.join('\n')}\nET\n`;

/** Identity ToUnicode CMap for the BMP (what Tesseract's PDF output writes). */
export const TO_UNICODE_CMAP = [
  '/CIDInit /ProcSet findresource begin',
  '12 dict begin',
  'begincmap',
  '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
  '/CMapName /Adobe-Identity-UCS def',
  '/CMapType 2 def',
  '1 begincodespacerange',
  '<0000> <FFFF>',
  'endcodespacerange',
  '1 beginbfrange',
  '<0000> <FFFF> <0000>',
  'endbfrange',
  'endcmap',
  'CMapName currentdict /CMap defineresource pop',
  'end',
  'end',
  '',
].join('\n');

/** Every CID → glyph 1 (the font's one glyph), 64 K entries, Flate-compressed. */
function cidToGidMap(): Uint8Array {
  const raw = new Uint8Array(131072);
  for (let i = 1; i < raw.length; i += 2) raw[i] = 1;
  return zlibSync(raw);
}

const D = (o: Record<string, PdfValue>): PdfDict => new Map(Object.entries(o));
const N = (s: string): PdfName => new PdfName(s);

/**
 * The /Contents list of a page without the streams a layer of this app wrote
 * before (its `q` first and its `Q`+text last), so re-recognizing replaces it.
 */
async function withoutPreviousLayer(
  reader: PdfReader,
  list: PdfValue[],
): Promise<{ list: PdfValue[]; replaced: boolean }> {
  if (list.length < 3) return { list, replaced: false };
  const first = list[0];
  const last = list[list.length - 1];
  if (!(first instanceof PdfRef) || !(last instanceof PdfRef)) return { list, replaced: false };
  const [a, b] = await Promise.all([reader.get(first), reader.get(last)]);
  if (!(a instanceof PdfStream) || !(b instanceof PdfStream)) return { list, replaced: false };
  const pre = latin1(await reader.decode(a));
  if (pre !== PRE_STREAM) return { list, replaced: false };
  const post = await reader.decode(b);
  if (latin1(post.subarray(0, POST_PREFIX.length)) !== POST_PREFIX)
    return { list, replaced: false };
  return { list: list.slice(1, -1), replaced: true };
}

/**
 * Builds the layer's objects for `pages` on the document `reader` was opened
 * from (its current state: original + tail + live section). Pages with no
 * usable word get nothing.
 */
export async function buildTextLayer(
  reader: PdfReader,
  pages: readonly PageOcr[],
  deps: LayerDeps,
): Promise<LayerResult> {
  const pageDicts = await reader.pages();
  let next = Math.max(reader.maxObjNum(), ...[...reader.xref.keys()].map((k) => k + 1));
  const firstNew = next;
  const objects: ExtraObject[] = [];
  const crypt = reader.crypt;
  const genOf = (num: number): number => {
    const e = reader.xref.get(num);
    return e?.type === 1 ? e.gen : 0;
  };
  const writeValue = (num: number, gen: number, v: PdfValue): void => {
    const value = crypt ? crypt.mapStrings(v, num, gen, true) : v;
    objects.push({ num, gen, bytes: serializeIndirect(num, gen, value) });
  };
  const writeStream = (num: number, raw: Uint8Array, dict: PdfDict = new Map()): void => {
    const data = crypt ? crypt.encryptStream(num, 0, raw) : raw;
    const d: PdfDict = new Map<string, PdfValue>(dict);
    d.set('Length', data.length);
    objects.push({
      num,
      gen: 0,
      bytes: concatBytes([
        encodeLatin1(`${String(num)} 0 obj\r\n${serialize(d)}\r\nstream\r\n`),
        data,
        encodeLatin1('\r\nendstream\r\nendobj'),
      ]),
    });
  };
  let words = 0;
  let skipped = 0;
  let replaced = 0;
  let fontRef: PdfRef | null = null;
  /** The font once per document, on first use: Type0 → CIDFontType2 → descriptor → program. */
  const font = (): PdfRef => {
    if (fontRef) return fontRef;
    const type0 = next++;
    const cid = next++;
    const desc = next++;
    const program = next++;
    const c2g = next++;
    const toUni = next++;
    const name = N('GlyphLessFont');
    writeValue(
      type0,
      0,
      D({
        Type: N('Font'),
        Subtype: N('Type0'),
        BaseFont: name,
        Encoding: N('Identity-H'),
        DescendantFonts: [new PdfRef(cid, 0)],
        ToUnicode: new PdfRef(toUni, 0),
      }),
    );
    writeValue(
      cid,
      0,
      D({
        Type: N('Font'),
        Subtype: N('CIDFontType2'),
        BaseFont: name,
        CIDSystemInfo: D({
          Registry: PdfString.of('Adobe'),
          Ordering: PdfString.of('Identity'),
          Supplement: 0,
        }),
        FontDescriptor: new PdfRef(desc, 0),
        DW: GLYPHLESS_DW,
        CIDToGIDMap: new PdfRef(c2g, 0),
      }),
    );
    writeValue(
      desc,
      0,
      D({
        Type: N('FontDescriptor'),
        FontName: name,
        Flags: 5,
        FontBBox: [0, -200, 1000, 800],
        Ascent: 800,
        Descent: -200,
        CapHeight: 800,
        ItalicAngle: 0,
        StemV: 80,
        FontFile2: new PdfRef(program, 0),
      }),
    );
    const ttf = glyphlessFontBytes();
    writeStream(program, ttf, D({ Length1: ttf.length }));
    writeStream(c2g, cidToGidMap(), D({ Filter: N('FlateDecode') }));
    writeStream(toUni, encodeLatin1(TO_UNICODE_CMAP));
    fontRef = new PdfRef(type0, 0);
    return fontRef;
  };
  const done: number[] = [];
  for (const page of pages) {
    const entry = pageDicts[page.pageIndex];
    if (!entry) continue;
    const ops: string[] = [];
    for (const line of page.lines) {
      const r = lineOps(line, page, deps);
      ops.push(...r.ops);
      skipped += r.skipped;
    }
    if (ops.length === 0) continue;
    words += ops.length;
    // The font once (first use), then per page: `q` before the original content, `Q` and the text after it.
    const fontRefNow = font();
    const pre = next++;
    writeStream(pre, encodeLatin1(PRE_STREAM));
    const post = next++;
    writeStream(post, encodeLatin1(textStream(ops)));
    // The page dict: /Contents array (an earlier layer of ours dropped), its own /Resources with the font.
    const dict = new Map<string, PdfValue>(entry.dict);
    const contents = dict.get('Contents');
    const previous =
      contents instanceof PdfRef ? [contents] : Array.isArray(contents) ? [...contents] : [];
    const kept = await withoutPreviousLayer(reader, previous);
    if (kept.replaced) replaced++;
    dict.set('Contents', [new PdfRef(pre, 0), ...kept.list, new PdfRef(post, 0)]);
    const resources = await reader.resolve(await inherited(reader, entry.dict, 'Resources'));
    const res: PdfDict = isDict(resources)
      ? new Map<string, PdfValue>(resources)
      : new Map<string, PdfValue>();
    const fonts = await reader.resolve(res.get('Font'));
    const fontDict: PdfDict = isDict(fonts)
      ? new Map<string, PdfValue>(fonts)
      : new Map<string, PdfValue>();
    fontDict.set(FONT_KEY, fontRefNow);
    res.set('Font', fontDict);
    dict.set('Resources', res);
    writeValue(entry.num, genOf(entry.num), dict);
    done.push(page.pageIndex);
  }
  return { objects, firstNew, words, skipped, pages: done, replaced };
}
