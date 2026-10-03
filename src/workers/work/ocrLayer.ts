// The OCR text layer by our object layer (ADR-020 decisions 3 and 4; from
// spikes/s17-ocr/layer.ts). Per recognized page: one new content stream with
// the words as invisible text (render mode 3, ISO 32000-1 9.3.6) appended to
// /Contents behind a `q` … `Q` wrap of the original streams, which stay byte
// for byte as they were; one non-embedded Helvetica (WinAnsiEncoding) added
// to the page's own /Resources (inherited or shared resources are copied
// inline first, never modified). The objects go to the Render worker's
// `pagesApply` (reopen with objects, the ADR-018 route). Pure: the caller
// supplies the raster → page mapping (PDFium's FPDF_DeviceToPage) and the
// glyph widths; strings and streams are encrypted for an encrypted document.
import { helveticaWidth } from '../../model/ocr/helveticaWidths';
import type { OcrBox, OcrLine, PageOcr } from '../../model/ocr/types';
import { winAnsiBytes } from '../../model/ocr/winAnsi';
import {
  PdfName,
  PdfRef,
  PdfString,
  isDict,
  serialize,
  serializeIndirect,
  type PdfDict,
  type PdfValue,
} from '../../model/pdf/objects';
import type { PdfReader } from '../../model/pdf/reader';
import { concatBytes, encodeLatin1 } from '../render/save/bytes';
import type { ExtraObject } from '../render/save/narrowTail';

/** The font's resource name on the page (unlikely to collide; a collision is overwritten). */
export const FONT_KEY = 'PDFToolsOCR';
/** Helvetica's ascender, per em (the standard-14 AFM value). */
const ASCENT = 0.905;
/** Smallest font size written (points); a word that comes out smaller is dropped. */
const MIN_SIZE = 0.5;

export interface LayerDeps {
  /** Raster pixel (y down) of page `pageIndex` → unrotated page space (user units). */
  toPage(pageIndex: number, dx: number, dy: number): [number, number];
  /** Advance width of a WinAnsi byte, per 1000 em. Defaults to Helvetica's. */
  width?: (byte: number) => number;
}

export interface LayerResult {
  objects: ExtraObject[];
  /** The first object number allocated (the Render worker refuses a stale state). */
  firstNew: number;
  /** Words written and words dropped (no WinAnsi character, degenerate box). */
  words: number;
  skipped: number;
  /** Pages that received a layer. */
  pages: number[];
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

/**
 * One `Tm … Tj` per word. The text runs along the line's baseline in whatever
 * direction Tesseract found it (a sideways scan has vertical baselines):
 * positions are projections onto the baseline direction and its "up" normal
 * in raster pixels, mapped to page space by `toPage`, which applies /Rotate
 * and the scale. Font size: the line's ascent above the baseline / 0.905;
 * each word is stretched to its box width.
 */
export function lineOps(
  line: OcrLine,
  page: PageOcr,
  deps: LayerDeps,
): { ops: string[]; skipped: number } {
  const width = deps.width ?? helveticaWidth;
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
    const bytes = winAnsiBytes(word.text);
    let natural = 0; // per em
    for (const b of bytes) natural += width(b) / 1000;
    if (bytes.length === 0 || !(natural > 0)) {
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
    const size = Math.hypot(tx - sx, ty - sy) / ASCENT;
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
      `${fmt(a)} ${fmt(b)} ${fmt(c)} ${fmt(d)} ${fmt(sx)} ${fmt(sy)} Tm ${serialize(new PdfString(bytes, false))} Tj`,
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
  `Q\nBT\n3 Tr\n/${FONT_KEY} 1 Tf\n${ops.join('\n')}\nET\n`;

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
  const writeStream = (num: number, text: string): void => {
    const raw = encodeLatin1(text);
    const data = crypt ? crypt.encryptStream(num, 0, raw) : raw;
    const d: PdfDict = new Map<string, PdfValue>([['Length', data.length]]);
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
  let fontRef: PdfRef | null = null;
  const font = (): PdfRef => {
    if (fontRef) return fontRef;
    const num = next++;
    writeValue(
      num,
      0,
      new Map<string, PdfValue>([
        ['Type', new PdfName('Font')],
        ['Subtype', new PdfName('Type1')],
        ['BaseFont', new PdfName('Helvetica')],
        ['Encoding', new PdfName('WinAnsiEncoding')],
      ]),
    );
    fontRef = new PdfRef(num, 0);
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
    writeStream(pre, 'q\n');
    const post = next++;
    writeStream(post, textStream(ops));
    // The page dict: /Contents array, its own /Resources with the font.
    const dict = new Map<string, PdfValue>(entry.dict);
    const contents = dict.get('Contents');
    const list =
      contents instanceof PdfRef ? [contents] : Array.isArray(contents) ? [...contents] : [];
    dict.set('Contents', [new PdfRef(pre, 0), ...list, new PdfRef(post, 0)]);
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
  return { objects, firstNew, words, skipped, pages: done };
}
