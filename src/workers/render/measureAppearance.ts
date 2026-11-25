// A measurement as one markup (M14-03, D-74, ADR-035 Amendment 1; route of
// spike S34's appearance.ts). After EmbedPDF has created or updated a Length
// (Line), Polylength or Perimeter (PolyLine) or Area (Polygon) carrying our
// `measure` field, its appearance is drawn again here with the value inside:
//
//  1. An Area's fill leaves /IC (a viewer that redraws must never paint an
//     opaque fill over the drawing) and is drawn see-through in the appearance.
//  2. The caption (its /Contents: the value, the label in front) is shaped with
//     HarfBuzz in the app's own font, Inter (fallbacks for other scripts from
//     the font library; only fonts that ship with the app), placed as
//     model/measureMarkup.ts says, and /Rect grows to hold it.
//  3. PDFium draws its own appearance for that /Rect (a Length with an offset:
//     the dimension line and leader lines, dimensionAppearance.ts), with its
//     numbers made plain (lineEndingAppearance.ts' reason), and an In line
//     caption breaks the line with an even-odd clip.
//  4. `assemble` (commentFonts/appearance.ts) wraps it as one form with
//     PDFium's resources, our see-through states and the font subsets.
//
// Two steps, as the comment fonts: `prepareMeasureCaption` (async: HarfBuzz
// and the faces) before the executor call, `applyMeasureAppearance`
// (synchronous) right after it. Anything unexpected keeps PDFium's own
// appearance (the value is still the markup's /Contents).
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import { PdfAnnotationColorType, PdfAnnotationSubtype } from '@embedpdf/models';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { dimensionGeometry, dimensionPoints, leaderOf, type Leader } from '../../model/dimension';
import { libraryFamily } from '../../model/fonts/library';
import { normalizeHex } from '../../model/freeTextStyle';
import {
  bounds,
  corners,
  unionBox,
  type Box,
  type CaptionBox,
  type Pt,
} from '../../model/measureGeometry';
import {
  CAPTION_LINE_HEIGHT,
  CAPTION_PAD,
  CAPTION_SIZE,
  FILL_ALPHA,
  captionPlace,
  captionSize,
  metaOf,
  type MeasureMeta,
} from '../../model/measureMarkup';
import { PdfName, type PdfDict, type PdfValue } from '../../model/pdf/objects';
import { plainNumbers } from '../../model/pdf/plainNumbers';
import { assemble, content, type Rgb, type Usage } from './commentFonts/appearance';
import type { CommentFaces, FaceStore } from './commentFonts/faces';
import type { Face, Line } from './commentFonts/layout';
import { layout } from './commentFonts/layout';
import type { Subsetter } from './commentFonts/hbsubset';
import { drawDimension, readLine } from './dimensionAppearance';
import { exportAppearance } from './freeTextColors';
import { acquirePage, rawCall, withWideString } from './pdfium';
import { latin1 } from './save/bytes';

interface MeasureArg {
  id?: unknown;
  type?: unknown;
  contents?: unknown;
  strokeColor?: unknown;
  strokeWidth?: unknown;
  opacity?: unknown;
  blendMode?: unknown;
  measure?: unknown;
  leader?: unknown;
}

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  HEAPU8: Uint8Array;
  getValue(ptr: number, t: 'float' | 'i32'): number;
  setValue(ptr: number, v: number, t: 'float'): void;
}

const SUBTYPES = new Set<unknown>([
  PdfAnnotationSubtype.LINE,
  PdfAnnotationSubtype.POLYLINE,
  PdfAnnotationSubtype.POLYGON,
]);

export interface MeasureCall {
  docId: string;
  pageIndex: number;
  id: string;
  type: PdfAnnotationSubtype;
  meta: MeasureMeta;
  text: string;
  arg: MeasureArg;
}

/** The measurement a create or update draws, or null (a move keeps its appearance). */
export function measureCallOf(method: string, args: readonly unknown[]): MeasureCall | null {
  if (method !== 'createPageAnnotation' && method !== 'updatePageAnnotation') return null;
  const a = args[2] as MeasureArg | undefined;
  if (!a || !SUBTYPES.has(a.type) || typeof a.id !== 'string') return null;
  const meta = metaOf(a);
  if (!meta) return null;
  const opts = args[3] as { regenerateAppearance?: unknown } | undefined;
  if (method === 'updatePageAnnotation' && opts?.regenerateAppearance === false) return null;
  const docId = (args[0] as { id?: unknown } | undefined)?.id;
  const pageIndex = (args[1] as { index?: unknown } | undefined)?.index;
  if (typeof docId !== 'string' || typeof pageIndex !== 'number') return null;
  const text = typeof a.contents === 'string' ? a.contents : '';
  return { docId, pageIndex, id: a.id, type: a.type as PdfAnnotationSubtype, meta, text, arg: a };
}

const prepared = new WeakMap<readonly unknown[], Promise<CommentFaces | null>>();

/** Before the executor call: the faces the caption needs (null: no caption, or no call). */
export function prepareMeasureCaption(
  store: FaceStore,
  method: string,
  args: readonly unknown[],
): Promise<CommentFaces | null> {
  const call = measureCallOf(method, args);
  if (!call?.text.trim()) return Promise.resolve(null);
  let p = prepared.get(args);
  if (!p) {
    const inter = libraryFamily('inter');
    p = inter
      ? store.prepare(inter, false, false, call.text).catch(() => null)
      : Promise.resolve(null);
    prepared.set(args, p);
  }
  return p;
}

export type MeasureOutcome = 'none' | 'drawn' | 'fallback';

const heapOf = (mod: WrappedPdfiumModule): Heap => mod.pdfium as unknown as Heap;

const f = (n: number): string => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};
const xy = (p: Pt): string => `${f(p.x)} ${f(p.y)}`;

const rgbOf = (hex: unknown): Rgb => {
  const h = normalizeHex(typeof hex === 'string' ? hex : '') ?? '#000000';
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
};
const c3 = (c: Rgb): string => c.map((v) => f(v)).join(' ');

function readRect(mod: WrappedPdfiumModule, annot: number): Box | null {
  const heap = heapOf(mod);
  const p = heap.wasmExports.malloc(16);
  try {
    if (!rawCall(mod, 'FPDFAnnot_GetRect', annot, p)) return null;
    const v = (i: number): number => heap.getValue(p + i * 4, 'float');
    // FS_RECTF: left, top, right, bottom.
    return [Math.min(v(0), v(2)), Math.min(v(1), v(3)), Math.max(v(0), v(2)), Math.max(v(1), v(3))];
  } finally {
    heap.wasmExports.free(p);
  }
}

function setRect(mod: WrappedPdfiumModule, annot: number, r: Box): boolean {
  const heap = heapOf(mod);
  const p = heap.wasmExports.malloc(16);
  try {
    heap.setValue(p, r[0], 'float');
    heap.setValue(p + 4, r[3], 'float');
    heap.setValue(p + 8, r[2], 'float');
    heap.setValue(p + 12, r[1], 'float');
    return !!rawCall(mod, 'FPDFAnnot_SetRect', annot, p);
  } finally {
    heap.wasmExports.free(p);
  }
}

/** A PolyLine's or Polygon's /Vertices in user space. */
export function readVertices(mod: WrappedPdfiumModule, annot: number): Pt[] {
  const heap = heapOf(mod);
  const n = rawCall(mod, 'FPDFAnnot_GetVertices', annot, 0, 0);
  if (n <= 0) return [];
  const p = heap.wasmExports.malloc(n * 8);
  try {
    const got = rawCall(mod, 'FPDFAnnot_GetVertices', annot, p, n);
    const out: Pt[] = [];
    for (let i = 0; i < Math.min(n, got); i++)
      out.push({ x: heap.getValue(p + i * 8, 'float'), y: heap.getValue(p + i * 8 + 4, 'float') });
    return out;
  } finally {
    heap.wasmExports.free(p);
  }
}

function setAppearanceFile(mod: WrappedPdfiumModule, annot: number, file: Uint8Array): boolean {
  const heap = heapOf(mod);
  const ptr = heap.wasmExports.malloc(file.length);
  try {
    heap.HEAPU8.set(file, ptr);
    const tmp = rawCall(mod, 'FPDF_LoadMemDocument', ptr, file.length, '');
    if (!tmp) return false;
    try {
      return !!rawCall(mod, 'EPDFAnnot_SetAppearanceFromPage', annot, tmp, 0);
    } finally {
      rawCall(mod, 'FPDF_CloseDocument', tmp);
    }
  } finally {
    heap.wasmExports.free(ptr);
  }
}

function generate(mod: WrappedPdfiumModule, annot: number, blendMode: unknown): void {
  if (typeof blendMode === 'number')
    rawCall(mod, 'EPDFAnnot_GenerateAppearanceWithBlend', annot, blendMode);
  else rawCall(mod, 'EPDFAnnot_GenerateAppearance', annot);
}

interface Placed {
  lines: Line[];
  box: CaptionBox;
}

/** The caption shaped and placed (user space); null when there is no text. */
function placeCaption(
  call: MeasureCall,
  faces: CommentFaces,
  pts: Pt[],
  leader: Leader | null,
): Placed | null {
  if (!call.text.trim()) return null;
  const lines = call.text
    .split('\n')
    .flatMap((p) => layout(p, faces.primary, faces.fallbacks, CAPTION_SIZE, 100_000));
  const { width, height } = captionSize(Math.max(0, ...lines.map((l) => l.width)), lines.length);
  return { lines, box: captionPlace(call.meta, pts, leader, width, height) };
}

/** The caption's text ops in user space, with one font name per face. */
function captionOps(
  p: Placed,
  faces: CommentFaces,
  color: Rgb,
): { ops: string; usage: Usage; names: Map<Face, string> } {
  const { width: w, height: h, at, angle } = p.box;
  const t = content(p.lines, {
    textBox: [-w / 2 + CAPTION_PAD, -h / 2 + CAPTION_PAD, w / 2 - CAPTION_PAD, h / 2 - CAPTION_PAD],
    text: color,
    align: 1,
    valign: 1,
    size: CAPTION_SIZE,
    lineHeight: CAPTION_LINE_HEIGHT,
    primary: faces.primary,
    synthetic: faces.synthetic,
  });
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    ops: `q ${f(cos)} ${f(sin)} ${f(-sin)} ${f(cos)} ${xy(at)} cm\n${t.ops}\nQ`,
    usage: t.usage,
    names: t.names,
  };
}

/** Draws the measurement's appearance on `annot` (steps 1–4 above). */
export function drawMeasureAppearance(
  mod: WrappedPdfiumModule,
  annot: number,
  call: MeasureCall,
  faces: CommentFaces | null,
): MeasureOutcome {
  const a = call.arg;
  const isLine = call.type === PdfAnnotationSubtype.LINE;
  const isArea = call.type === PdfAnnotationSubtype.POLYGON;
  const line = isLine ? readLine(mod, annot) : null;
  const pts = isLine ? (line ?? []) : readVertices(mod, annot);
  if (pts.length < 2) return 'fallback';
  const leader = isLine ? leaderOf(a) : null;
  if (call.text.trim() && !faces) return 'fallback';
  // 1. No /IC: the fill is ours, see-through, in the appearance only.
  if (isArea) rawCall(mod, 'EPDFAnnot_ClearColor', annot, PdfAnnotationColorType.InteriorColor);
  // 2. The caption, and /Rect that holds the geometry, the arrows and the caption.
  const placed = faces ? placeCaption(call, faces, pts, leader) : null;
  const width = typeof a.strokeWidth === 'number' ? a.strokeWidth : 1;
  const extent =
    isLine && pts[0] && pts[1]
      ? [...pts, ...dimensionPoints(dimensionGeometry(pts[0], pts[1], leader, false))]
      : pts;
  let rect = bounds(extent, width / 2 + (isArea ? 0 : 4 * Math.max(width, 1)));
  const now = readRect(mod, annot);
  if (now) rect = unionBox(rect, now);
  if (placed) rect = unionBox(rect, bounds(corners(placed.box), 1));
  rect = rect.map((v, i) => (i < 2 ? Math.floor(v) : Math.ceil(v))) as Box;
  if (!setRect(mod, annot, rect)) return 'fallback';
  // 3. PDFium's appearance (a Length with an offset: its dimension and leader lines).
  if (leader) drawDimension(mod, annot, leader, a.blendMode);
  else generate(mod, annot, a.blendMode);
  const exported = exportAppearance(mod, annot);
  if (!exported) return 'fallback';
  const base = plainNumbers(latin1(exported.ex.data)).content.trim();
  // PDFium's ops are in the exported form's own space; ours in user space.
  const [bx0, by0] = exported.ex.bbox;
  const dx = bx0 - rect[0];
  const dy = by0 - rect[1];
  const moved = Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01;
  const toForm = moved ? `1 0 0 1 ${f(dx)} ${f(dy)} cm\n` : '';
  const back = moved ? `1 0 0 1 ${f(-dx)} ${f(-dy)} cm\n` : '';
  const stroke = rgbOf(a.strokeColor);
  const opacity = typeof a.opacity === 'number' && a.opacity >= 0 && a.opacity <= 1 ? a.opacity : 1;
  const parts: string[] = [];
  const ours: string[] = [];
  const states: Record<string, { ca?: number; CA?: number }> = {};
  if (isArea && call.meta.fill) {
    states['TMFill'] = { ca: FILL_ALPHA * opacity };
    const ring = `${pts.map((p, i) => `${xy(p)} ${i ? 'l' : 'm'}`).join(' ')} h`;
    parts.push(`q ${toForm}/TMFill gs ${c3(rgbOf(call.meta.fill))} rg ${ring} f* Q`);
  }
  if (base && placed && isLine && call.meta.cap === 'inline') {
    // The line broken for an In line caption: an even-odd clip of /Rect minus the caption.
    const quad = corners(placed.box)
      .map((p, i) => `${xy(p)} ${i ? 'l' : 'm'}`)
      .join(' ');
    parts.push(
      `q ${toForm}${f(rect[0])} ${f(rect[1])} ${f(rect[2] - rect[0])} ${f(rect[3] - rect[1])} re ${quad} h W* n\n${back}${base}\nQ`,
    );
  } else if (base) parts.push(`q\n${base}\nQ`);
  let usage: Usage = new Map();
  let names = new Map<Face, string>();
  if (placed && faces) {
    const c = captionOps(placed, faces, stroke);
    usage = c.usage;
    names = c.names;
    if (opacity < 1) states['TMText'] = { ca: opacity, CA: opacity };
    ours.push(`${opacity < 1 ? '/TMText gs\n' : ''}${c.ops}`);
  }
  if (ours.length) parts.push(`q ${toForm}${ours.join('\n')}\nQ`);
  // 4. One form: PDFium's resources, our states, the font subsets.
  const res: PdfDict =
    exported.ex.resources instanceof Map
      ? new Map(exported.ex.resources)
      : new Map<string, PdfValue>();
  if (Object.keys(states).length) {
    const gs: PdfDict =
      res.get('ExtGState') instanceof Map
        ? new Map(res.get('ExtGState') as PdfDict)
        : new Map<string, PdfValue>();
    for (const [n, s] of Object.entries(states)) {
      const st: PdfDict = new Map<string, PdfValue>([['Type', new PdfName('ExtGState')]]);
      if (s.ca !== undefined) st.set('ca', s.ca);
      if (s.CA !== undefined) st.set('CA', s.CA);
      gs.set(n, st);
    }
    res.set('ExtGState', gs);
  }
  // With no caption, `assemble` embeds no font and never subsets.
  const sub = faces?.sub ?? (null as unknown as Subsetter);
  try {
    const { file } = assemble(
      exported.bytes,
      { ...exported.ex.page, bbox: exported.ex.bbox, matrix: exported.ex.matrix },
      res,
      parts.join('\n'),
      usage,
      names,
      sub,
      { italic: false },
    );
    if (!setAppearanceFile(mod, annot, file)) {
      generate(mod, annot, a.blendMode);
      return 'fallback';
    }
  } catch {
    generate(mod, annot, a.blendMode);
    return 'fallback';
  }
  return 'drawn';
}

const fallbacks = new Map<string, number>();

/** Measurements whose caption could not be drawn since the last call (diagnostics, never shown). */
export function takeMeasureFallbacks(docId: string): number {
  const n = fallbacks.get(docId) ?? 0;
  fallbacks.delete(docId);
  return n;
}

/** After the executor call: the measurement's own appearance (synchronous). */
export function applyMeasureAppearance(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  method: string,
  args: readonly unknown[],
  faces: CommentFaces | null,
): MeasureOutcome {
  const call = measureCallOf(method, args);
  if (!call) return 'none';
  const ref = acquirePage(native, call.docId, call.pageIndex);
  let out: MeasureOutcome = 'none';
  try {
    const annot = withWideString(mod, call.id, (p) =>
      rawCall(mod, 'EPDFPage_GetAnnotByName', ref.pagePtr, p),
    );
    if (!annot) return 'none';
    try {
      out = drawMeasureAppearance(mod, annot, call, faces);
    } catch {
      out = 'fallback';
    } finally {
      rawCall(mod, 'FPDFPage_CloseAnnot', annot);
    }
  } finally {
    ref.release();
  }
  if (out === 'fallback') fallbacks.set(call.docId, (fallbacks.get(call.docId) ?? 0) + 1);
  return out;
}
