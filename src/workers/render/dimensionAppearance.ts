// A Distance drawn as a dimension, in the file (M13-10, ADR-034 Amendment 3).
// The measured points stay the line's /L, the offset is the standard leader
// line entries /LL, /LLE and /LLO (model/dimension.ts), and the appearance
// draws what those entries describe, so every viewer shows the same picture:
// the dimension line beside the points, with its line endings (open arrows),
// and the two leader lines. PDFium's own appearance knows nothing of leader
// lines, so after EmbedPDF has created or updated such a line:
//   1. /L is set for a moment to the dimension line, and PDFium draws its
//      appearance (colour, width, dashes, endings, transparency: all PDFium's);
//   2. /L goes back to the measured points, and the leader lines are added to
//      that appearance (solid, in the same colour and width);
//   3. /LL, /LLE and /LLO are written.
// The annotation's /Rect (from the main thread) already holds the leader lines.
// Reading back: a Line annotation with /LL gets the same `leader` field
// (leaderReadback.ts), so editing it keeps its leader lines.
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import { PdfAnnotationSubtype } from '@embedpdf/models';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import {
  dimensionGeometry,
  leaderOf,
  leaderOperators,
  type Leader,
  type Pt,
} from '../../model/dimension';
import { plainNumbers } from '../../model/pdf/plainNumbers';
import { exportAppearance, setAppearanceContent } from './freeTextColors';
import { acquirePage, rawCall, withWideString } from './pdfium';
import { latin1 } from './save/bytes';

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  getValue(ptr: number, t: 'float'): number;
  setValue(ptr: number, v: number, t: 'float'): void;
}

interface LineArg {
  id?: unknown;
  type?: unknown;
  blendMode?: unknown;
  leader?: unknown;
}

export type DimensionOutcome = 'none' | 'drawn' | 'fallback';

const heapOf = (mod: WrappedPdfiumModule): Heap => mod.pdfium;

/** The line's /L in user space, or null. */
export function readLine(mod: WrappedPdfiumModule, annot: number): [Pt, Pt] | null {
  const heap = heapOf(mod);
  const buf = heap.wasmExports.malloc(16);
  try {
    if (!rawCall(mod, 'FPDFAnnot_GetLine', annot, buf, buf + 8)) return null;
    const f = (i: number): number => heap.getValue(buf + 4 * i, 'float');
    return [
      { x: f(0), y: f(1) },
      { x: f(2), y: f(3) },
    ];
  } finally {
    heap.wasmExports.free(buf);
  }
}

function writeLine(mod: WrappedPdfiumModule, annot: number, a: Pt, b: Pt): boolean {
  const heap = heapOf(mod);
  const buf = heap.wasmExports.malloc(16);
  try {
    heap.setValue(buf, a.x, 'float');
    heap.setValue(buf + 4, a.y, 'float');
    heap.setValue(buf + 8, b.x, 'float');
    heap.setValue(buf + 12, b.y, 'float');
    return !!rawCall(mod, 'EPDFAnnot_SetLine', annot, buf, buf + 8);
  } finally {
    heap.wasmExports.free(buf);
  }
}

function writeLeader(mod: WrappedPdfiumModule, annot: number, leader: Leader): void {
  rawCall(mod, 'EPDFAnnot_SetNumberValue', annot, 'LL', leader.ll);
  rawCall(mod, 'EPDFAnnot_SetNumberValue', annot, 'LLE', leader.lle);
  if (leader.llo > 0) rawCall(mod, 'EPDFAnnot_SetNumberValue', annot, 'LLO', leader.llo);
}

function generate(mod: WrappedPdfiumModule, annot: number, blendMode: unknown): void {
  if (typeof blendMode === 'number')
    rawCall(mod, 'EPDFAnnot_GenerateAppearanceWithBlend', annot, blendMode);
  else rawCall(mod, 'EPDFAnnot_GenerateAppearance', annot);
}

/** The dimension's appearance and leader entries, for a line annotation `annot`. */
export function drawDimension(
  mod: WrappedPdfiumModule,
  annot: number,
  leader: Leader,
  blendMode?: unknown,
): DimensionOutcome {
  const line = readLine(mod, annot);
  if (!line) return 'fallback';
  const [a, b] = line;
  const g = dimensionGeometry(a, b, leader, false);
  writeLeader(mod, annot, leader);
  let content: string | null = null;
  let exported: ReturnType<typeof exportAppearance> = null;
  try {
    if (!writeLine(mod, annot, g.start, g.end)) return 'fallback';
    generate(mod, annot, blendMode);
    exported = exportAppearance(mod, annot);
    if (exported) content = latin1(exported.ex.data);
  } finally {
    writeLine(mod, annot, a, b);
  }
  if (!exported || content === null) {
    // PDFium's own picture of the measured line: still a line with its value.
    generate(mod, annot, blendMode);
    return 'fallback';
  }
  const full = plainNumbers(`${content.replace(/\s*$/u, '')}\n${leaderOperators(g)}`).content;
  if (setAppearanceContent(mod, annot, exported, full)) return 'drawn';
  generate(mod, annot, blendMode);
  return 'fallback';
}

/** After EmbedPDF created or updated a line with a `leader`: its dimension appearance. */
export function applyDimensionAppearance(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  method: string,
  args: readonly unknown[],
): DimensionOutcome {
  if (method !== 'createPageAnnotation' && method !== 'updatePageAnnotation') return 'none';
  const annot = args[2] as LineArg | undefined;
  if (annot?.type !== PdfAnnotationSubtype.LINE || typeof annot.id !== 'string') return 'none';
  const leader = leaderOf(annot);
  if (!leader) return 'none';
  // A move keeps the appearance (the plugin moves it with /Rect).
  const opts = args[3] as { regenerateAppearance?: unknown } | undefined;
  if (method === 'updatePageAnnotation' && opts?.regenerateAppearance === false) return 'none';
  const docId = (args[0] as { id?: unknown } | undefined)?.id;
  const pageIndex = (args[1] as { index?: unknown } | undefined)?.index;
  if (typeof docId !== 'string' || typeof pageIndex !== 'number') return 'none';
  const ref = acquirePage(native, docId, pageIndex);
  try {
    const id = annot.id;
    const a = withWideString(mod, id, (p) =>
      rawCall(mod, 'EPDFPage_GetAnnotByName', ref.pagePtr, p),
    );
    if (!a) return 'none';
    try {
      return drawDimension(mod, a, leader, annot.blendMode);
    } finally {
      rawCall(mod, 'FPDFPage_CloseAnnot', a);
    }
  } finally {
    ref.release();
  }
}
