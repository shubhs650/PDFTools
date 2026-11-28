// The summary table's appearance (M14-10, D-76, ADR-035 Amendment 1 decision
// 1; route of spike S34's summary): after EmbedPDF has created or updated the
// summary /FreeText (it carries our `summary` field), its /Rect is set to the
// table's size from its top-left corner (model/measureSummary.ts lays it out,
// as the main thread did) and its appearance is drawn again as a table: a
// white ground, a shaded head row, the grid, and each cell's text shaped with
// HarfBuzz in the app's own font, Inter (fallbacks from the font library:
// only fonts that ship with the app), embedded as subsets. Two steps, as the
// measurement captions: `prepareSummary` (async: the faces) before the
// executor call, `applySummaryAppearance` (synchronous) right after it.
// Anything unexpected keeps PDFium's own appearance (its /Contents rows).
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import { PdfAnnotationSubtype } from '@embedpdf/models';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { libraryFamily } from '../../model/fonts/library';
import {
  SUMMARY_PAD,
  SUMMARY_ROW,
  SUMMARY_SIZE,
  summaryLayout,
  summaryOf,
  type SummaryMeta,
} from '../../model/measureSummary';
import { PdfName, type PdfDict, type PdfValue } from '../../model/pdf/objects';
import { assemble, content, type Rgb, type Usage } from './commentFonts/appearance';
import type { CommentFaces, FaceStore } from './commentFonts/faces';
import { layout, type Face } from './commentFonts/layout';
import { exportAppearance } from './freeTextColors';
import { acquirePage, rawCall, withWideString } from './pdfium';

interface SummaryArg {
  id?: unknown;
  type?: unknown;
  summary?: unknown;
}

export interface SummaryCall {
  docId: string;
  pageIndex: number;
  id: string;
  meta: SummaryMeta;
}

/** The summary a create or update draws, or null (a move keeps its appearance). */
export function summaryCallOf(method: string, args: readonly unknown[]): SummaryCall | null {
  if (method !== 'createPageAnnotation' && method !== 'updatePageAnnotation') return null;
  const a = args[2] as SummaryArg | undefined;
  if (a?.type !== PdfAnnotationSubtype.FREETEXT || typeof a.id !== 'string') return null;
  const meta = summaryOf(a);
  if (!meta || meta.rows.length === 0) return null;
  const opts = args[3] as { regenerateAppearance?: unknown } | undefined;
  if (method === 'updatePageAnnotation' && opts?.regenerateAppearance === false) return null;
  const docId = (args[0] as { id?: unknown } | undefined)?.id;
  const pageIndex = (args[1] as { index?: unknown } | undefined)?.index;
  if (typeof docId !== 'string' || typeof pageIndex !== 'number') return null;
  return { docId, pageIndex, id: a.id, meta };
}

const prepared = new WeakMap<readonly unknown[], Promise<CommentFaces | null>>();

/** Before the executor call: the faces the table's text needs (null: no summary call). */
export function prepareSummary(
  store: FaceStore,
  method: string,
  args: readonly unknown[],
): Promise<CommentFaces | null> {
  const call = summaryCallOf(method, args);
  if (!call) return Promise.resolve(null);
  let p = prepared.get(args);
  if (!p) {
    const inter = libraryFamily('inter');
    const text = call.meta.rows.map((r) => r.join(' ')).join('\n');
    p = inter ? store.prepare(inter, false, false, text).catch(() => null) : Promise.resolve(null);
    prepared.set(args, p);
  }
  return p;
}

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  HEAPU8: Uint8Array;
  getValue(ptr: number, t: 'float'): number;
  setValue(ptr: number, v: number, t: 'float'): void;
}
const heapOf = (mod: WrappedPdfiumModule): Heap => mod.pdfium as unknown as Heap;

type Box = [number, number, number, number];

function readRect(mod: WrappedPdfiumModule, annot: number): Box | null {
  const heap = heapOf(mod);
  const p = heap.wasmExports.malloc(16);
  try {
    if (!rawCall(mod, 'FPDFAnnot_GetRect', annot, p)) return null;
    const v = (i: number): number => heap.getValue(p + i * 4, 'float');
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

const f = (n: number): string => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

const INK: Rgb = [0.1, 0.1, 0.1];
const GRID = '0.15 0.15 0.15';
const HEAD = '0.93 0.93 0.93';

/**
 * The table's ops in user space (top-left at `x0`, `y1`) and the glyphs they
 * use, one font name per face across every cell.
 */
export function tableOps(
  rows: readonly (readonly string[])[],
  x0: number,
  y1: number,
  faces: CommentFaces,
): { ops: string; usage: Usage; names: Map<Face, string> } {
  const { widths, width: W, height: H } = summaryLayout(rows);
  const out: string[] = [
    `1 1 1 rg ${f(x0)} ${f(y1 - H)} ${f(W)} ${f(H)} re f`,
    `${HEAD} rg ${f(x0)} ${f(y1 - SUMMARY_ROW)} ${f(W)} ${f(SUMMARY_ROW)} re f`,
  ];
  const lines: string[] = [];
  for (let i = 1; i < rows.length; i++)
    lines.push(`${f(x0)} ${f(y1 - SUMMARY_ROW * i)} m ${f(x0 + W)} ${f(y1 - SUMMARY_ROW * i)} l`);
  let x = x0;
  for (const w of widths.slice(0, -1)) {
    x += w;
    lines.push(`${f(x)} ${f(y1)} m ${f(x)} ${f(y1 - H)} l`);
  }
  out.push(`${GRID} RG 0.5 w ${lines.join(' ')} S`);
  out.push(`${GRID} RG 0.75 w ${f(x0)} ${f(y1 - H)} ${f(W)} ${f(H)} re S`);
  const usage: Usage = new Map();
  const names = new Map<Face, string>();
  const globalName = (face: Face): string => {
    let n = names.get(face);
    if (!n) names.set(face, (n = `F${String(names.size + 1)}`));
    return n;
  };
  rows.forEach((row, i) => {
    const top = y1 - SUMMARY_ROW * i;
    let left = x0;
    row.forEach((cell, c) => {
      const w = widths[c] ?? 0;
      const box: Box = [left + SUMMARY_PAD, top - SUMMARY_ROW, left + w - SUMMARY_PAD, top];
      left += w;
      if (!cell.trim()) return;
      const lines = layout(cell, faces.primary, faces.fallbacks, SUMMARY_SIZE, 100_000);
      const t = content(lines, {
        textBox: box,
        text: INK,
        // The first column and the head row read from the left; numbers line up on the right.
        align: c === 0 || i === 0 ? 0 : 2,
        valign: 1,
        size: SUMMARY_SIZE,
        lineHeight: 1.18,
        primary: faces.primary,
        synthetic: faces.synthetic,
      });
      // This cell's font names → the table's.
      const local = new Map([...t.names].map(([face, n]) => [n, globalName(face)]));
      out.push(t.ops.replace(/\/(F\d+) /gu, (_m, n: string) => `/${local.get(n) ?? n} `));
      for (const [face, used] of t.usage) {
        const all = usage.get(face) ?? new Map<number, string>();
        usage.set(face, all);
        for (const [gid, text] of used)
          if (!all.has(gid) || (!all.get(gid) && text)) all.set(gid, text);
      }
    });
  });
  return { ops: out.join('\n'), usage, names };
}

export type SummaryOutcome = 'none' | 'drawn' | 'fallback';

/** Draws the summary table on `annot`. */
export function drawSummary(
  mod: WrappedPdfiumModule,
  annot: number,
  meta: SummaryMeta,
  faces: CommentFaces | null,
): SummaryOutcome {
  if (!faces) return 'fallback';
  const now = readRect(mod, annot);
  if (!now) return 'fallback';
  const { width, height } = summaryLayout(meta.rows);
  const x0 = now[0];
  const y1 = now[3];
  const rect: Box = [x0, y1 - height, x0 + width, y1];
  if (!setRect(mod, annot, rect)) return 'fallback';
  // PDFium's own appearance for that /Rect gives the form (its box, matrix, resources).
  rawCall(mod, 'EPDFAnnot_GenerateAppearance', annot);
  const exported = exportAppearance(mod, annot);
  if (!exported) return 'fallback';
  const [bx0, by0] = exported.ex.bbox;
  const dx = bx0 - rect[0];
  const dy = by0 - rect[1];
  const toForm = Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01 ? `1 0 0 1 ${f(dx)} ${f(dy)} cm\n` : '';
  const t = tableOps(meta.rows, x0, y1, faces);
  const res: PdfDict =
    exported.ex.resources instanceof Map
      ? new Map(exported.ex.resources)
      : new Map<string, PdfValue>();
  res.set('ProcSet', [new PdfName('PDF'), new PdfName('Text')]);
  try {
    const { file } = assemble(
      exported.bytes,
      { ...exported.ex.page, bbox: exported.ex.bbox, matrix: exported.ex.matrix },
      res,
      `q ${toForm}${t.ops}\nQ`,
      t.usage,
      t.names,
      faces.sub,
      { italic: false },
    );
    return setAppearanceFile(mod, annot, file) ? 'drawn' : 'fallback';
  } catch {
    return 'fallback';
  }
}

/** After the executor call: the summary's own table appearance (synchronous). */
export function applySummaryAppearance(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  method: string,
  args: readonly unknown[],
  faces: CommentFaces | null,
): SummaryOutcome {
  const call = summaryCallOf(method, args);
  if (!call) return 'none';
  const ref = acquirePage(native, call.docId, call.pageIndex);
  try {
    const annot = withWideString(mod, call.id, (p) =>
      rawCall(mod, 'EPDFPage_GetAnnotByName', ref.pagePtr, p),
    );
    if (!annot) return 'none';
    try {
      return drawSummary(mod, annot, call.meta, faces);
    } catch {
      return 'fallback';
    } finally {
      rawCall(mod, 'FPDFPage_CloseAnnot', annot);
    }
  } finally {
    ref.release();
  }
}
