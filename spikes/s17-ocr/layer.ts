// S17 variant B: the OCR text layer written by our own object layer (no
// PDFium content regeneration). Per page: a new content stream with the
// words as invisible text (3 Tr), appended to /Contents behind a `q` … `Q`
// wrap of the original streams (which stay byte for byte as they were), and
// one Helvetica/WinAnsi font added to the page's /Resources (inherited or
// shared resources are copied inline onto the page first). Pure: the caller
// supplies the device → page mapping and the glyph widths.
import {
  PdfName,
  PdfRef,
  PdfString,
  isDict,
  serialize,
  serializeIndirect,
  type PdfDict,
  type PdfValue,
} from '../../src/model/pdf/objects.ts';
import type { PdfReader } from '../../src/model/pdf/reader.ts';
import { concatBytes, encodeLatin1 } from '../../src/workers/render/save/bytes.ts';
import type { ExtraObject } from '../../src/workers/render/save/narrowTail.ts';
import { winAnsiBytes } from './winAnsi.ts';

export interface OcrBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface OcrWord {
  text: string;
  box: OcrBox;
  conf: number;
}
export interface OcrLine {
  box: OcrBox;
  baseline: OcrBox | null;
  words: OcrWord[];
}
export interface PageOcr {
  pageIndex: number;
  /** Size of the recognized raster (the displayed page, /Rotate applied). */
  width: number;
  height: number;
  lines: OcrLine[];
}

export const FONT_KEY = 'PDFToolsOCR';
/** Helvetica: ascender 0.905 em (AFM). */
const ASCENT = 0.905;

export interface LayerDeps {
  /** Device pixel of page `pageIndex`'s raster → unrotated page space (user units). */
  toPage(pageIndex: number, dx: number, dy: number): [number, number];
  /** Advance width of a WinAnsi byte in Helvetica, per 1000 em. */
  width(byte: number): number;
}

export interface LayerResult {
  objects: ExtraObject[];
  firstNew: number;
  words: number;
  skipped: number;
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

/**
 * One `Tm … Tj` per word. The text runs along the line's baseline in whatever
 * direction Tesseract found it (a sideways scan gives vertical baselines), so
 * nothing here assumes horizontal lines: positions are projections onto the
 * baseline direction and its "up" normal, in raster pixels, then mapped to
 * page space by the caller's `toPage` (which applies /Rotate and the scale).
 */
function wordOps(
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
  const corners = (b: OcrBox): [number, number][] => [
    [b.x0, b.y0],
    [b.x1, b.y0],
    [b.x0, b.y1],
    [b.x1, b.y1],
  ];
  const ascentPx = Math.max(4, ...corners(line.box).map(([x, y]) => above(x, y)));
  for (const word of line.words) {
    const bytes = winAnsiBytes(word.text);
    let natural = 0; // per 1 em
    for (const b of bytes) natural += deps.width(b) / 1000;
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
    if (!(size > 0.5) || !(len > 0)) {
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

/** Looks up an inheritable page attribute (/Resources) through the /Parent chain. */
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
  const genOf = (num: number) => {
    const e = reader.xref.get(num);
    return e?.type === 1 ? e.gen : 0;
  };
  const writeValue = (num: number, gen: number, v: PdfValue) => {
    const value = crypt ? crypt.mapStrings(v, num, gen, true) : v;
    objects.push({ num, gen, bytes: serializeIndirect(num, gen, value) });
  };
  const writeStream = (num: number, text: string) => {
    const raw = encodeLatin1(text);
    const data = crypt ? crypt.encryptStream(num, 0, raw) : raw;
    const d: PdfDict = new Map([['Length', data.length]]);
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
  const fontObj = (): PdfRef => {
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
  for (const page of pages) {
    const entry = pageDicts[page.pageIndex];
    if (!entry) continue;
    const ops: string[] = [];
    for (const line of page.lines) {
      const r = wordOps(line, page, deps);
      ops.push(...r.ops);
      skipped += r.skipped;
      words += r.ops.length;
    }
    if (ops.length === 0) continue;
    // Streams: `q` before the original content, `Q` + the text after it.
    const pre = next++;
    writeStream(pre, 'q\n');
    const post = next++;
    writeStream(post, `Q\nBT\n3 Tr\n/${FONT_KEY} 1 Tf\n${ops.join('\n')}\nET\n`);
    // The page dict: /Contents array, own /Resources with the font.
    const dict = new Map(entry.dict);
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
    fontDict.set(FONT_KEY, fontObj());
    res.set('Font', fontDict);
    dict.set('Resources', res);
    writeValue(entry.num, genOf(entry.num), dict);
  }
  return { objects, firstNew, words, skipped };
}
