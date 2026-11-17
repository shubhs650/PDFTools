// Comment fonts on the Render side (M11-07, D-52, ADR-028 and its S26
// amendment, route R2). A text box, typewriter or callout whose
// `libraryFont` names a family of the library (src/model/fonts/library.ts)
// keeps everything standard: /Contents, /DA with the family's standard
// fallback font (Helvetica, Times or Courier, which PDFium and other viewers
// use when they redraw it), /DS with the family's name. After EmbedPDF has
// created or updated it and PDFium has made its own appearance, the
// appearance is replaced by ours: PDFium's fill, border and callout line, and
// the text shaped with HarfBuzz in the family's face (and the fallbacks the
// text needs), each face embedded as a subset.
//
// Two steps, so no other call can run between PDFium's appearance and ours:
// `prepareCommentFont` (async: loads HarfBuzz and the faces before the
// executor call) and `applyCommentFont` (synchronous, right after it). If
// anything is not as expected, PDFium's appearance stays (Helvetica, Times or
// Courier) and a count is kept for the next save's diagnostics event.
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import { PdfAnnotationSubtype } from '@embedpdf/models';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { normalizeHex } from '../../../model/freeTextStyle';
import { libraryFamily, standardStyle, type LibraryFamily } from '../../../model/fonts/library';
import { acquirePage, rawCall, withWideString } from '../pdfium';
import { readExport } from '../freeTextColors';
import { latin1 } from '../save/bytes';
import { FPDF_NO_INCREMENTAL, saveWithFlags } from '../save/writer';
import { assemble, content, withoutText, type Rgb } from './appearance';
import type { CommentFaces, FaceStore } from './faces';
import { layout } from './layout';

/** The editor's CSS line height (EmbedPDF's FreeText: 1.18). */
export const LINE_HEIGHT = 1.18;

interface FreeTextArg {
  id?: unknown;
  type?: unknown;
  intent?: unknown;
  calloutLine?: unknown;
  rectangleDifferences?: unknown;
  libraryFont?: unknown;
  fontFamily?: unknown;
  fontSize?: unknown;
  fontColor?: unknown;
  strokeColor?: unknown;
  strokeWidth?: unknown;
  textAlign?: unknown;
  verticalAlign?: unknown;
  contents?: unknown;
}

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  HEAPU8: Uint8Array;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export interface CommentFontSpec {
  family: LibraryFamily;
  bold: boolean;
  italic: boolean;
  text: string;
}

/**
 * The library family a create or update draws a text comment in, or null:
 * not a FreeText, no library font, or a move that keeps the appearance.
 */
export function commentFontOf(method: string, args: readonly unknown[]): CommentFontSpec | null {
  if (method !== 'createPageAnnotation' && method !== 'updatePageAnnotation') return null;
  const a = args[2] as FreeTextArg | undefined;
  if (a?.type !== PdfAnnotationSubtype.FREETEXT || typeof a.id !== 'string') return null;
  const opts = args[3] as { regenerateAppearance?: unknown } | undefined;
  if (method === 'updatePageAnnotation' && opts?.regenerateAppearance === false) return null;
  const family = libraryFamily(str(a.libraryFont));
  if (!family?.group) return null;
  const { bold, italic } = standardStyle(num(a.fontFamily));
  return { family, bold, italic, text: str(a.contents) ?? '' };
}

const prepared = new WeakMap<readonly unknown[], Promise<CommentFaces | null>>();

/** Before the executor call: loads what the comment's text needs (nothing for other calls). */
export async function prepareCommentFont(
  store: FaceStore,
  method: string,
  args: readonly unknown[],
): Promise<CommentFaces | null> {
  const spec = commentFontOf(method, args);
  if (!spec?.text.trim()) return null;
  let p = prepared.get(args);
  if (!p) {
    p = store.prepare(spec.family, spec.bold, spec.italic, spec.text).catch(() => null);
    prepared.set(args, p);
  }
  return p;
}

export type CommentFontOutcome = 'none' | 'applied' | 'fallback';

const fallbacks = new Map<string, number>();

/** Comments whose library font could not be drawn since the last call (diagnostics, never shown). */
export function takeCommentFontFallbacks(docId: string): number {
  const n = fallbacks.get(docId) ?? 0;
  fallbacks.delete(docId);
  return n;
}

const rgbOf = (hex: string | undefined): Rgb => {
  const h = normalizeHex(hex ?? '') ?? '#000000';
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
};

const align = (v: number | undefined): 0 | 1 | 2 => (v === 1 || v === 2 ? v : 0);

/** After the executor call: our appearance in place of PDFium's (synchronous). */
export function applyCommentFont(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  method: string,
  args: readonly unknown[],
  faces: CommentFaces | null,
): CommentFontOutcome {
  const spec = commentFontOf(method, args);
  if (!spec?.text.trim()) return 'none';
  const docId = (args[0] as { id?: unknown } | undefined)?.id;
  const pageIndex = (args[1] as { index?: unknown } | undefined)?.index;
  const a = args[2] as FreeTextArg;
  if (typeof docId !== 'string' || typeof pageIndex !== 'number' || typeof a.id !== 'string')
    return 'none';
  const fail = (): CommentFontOutcome => {
    fallbacks.set(docId, (fallbacks.get(docId) ?? 0) + 1);
    return 'fallback';
  };
  if (!faces) return fail();
  const ref = acquirePage(native, docId, pageIndex);
  try {
    const annot = withWideString(mod, a.id, (p) =>
      rawCall(mod, 'EPDFPage_GetAnnotByName', ref.pagePtr, p),
    );
    if (!annot) return 'none';
    try {
      return setAppearance(mod, annot, a, spec, faces) ? 'applied' : fail();
    } finally {
      rawCall(mod, 'FPDFPage_CloseAnnot', annot);
    }
  } catch {
    return fail();
  } finally {
    ref.release();
  }
}

function setAppearance(
  mod: WrappedPdfiumModule,
  annot: number,
  a: FreeTextArg,
  spec: CommentFontSpec,
  faces: CommentFaces,
): boolean {
  const exported = rawCall(mod, 'EPDFAnnot_ExportAppearanceAsDocument', annot);
  if (!exported) return false;
  let bytes: Uint8Array;
  try {
    bytes = saveWithFlags(mod, exported, FPDF_NO_INCREMENTAL);
  } finally {
    rawCall(mod, 'FPDF_CloseDocument', exported);
  }
  const ex = readExport(bytes);
  if (!ex) return false;
  const size = num(a.fontSize) && (num(a.fontSize) ?? 0) > 0 ? (num(a.fontSize) ?? 12) : 12;
  const base = withoutText(latin1(ex.data));
  const textBox = textBoxOf(a, ex.bbox, base.clip);
  const lines = layout(spec.text, faces.primary, faces.fallbacks, size, textBox[2] - textBox[0]);
  const text = content(lines, {
    textBox,
    text: rgbOf(str(a.fontColor)),
    align: align(num(a.textAlign)),
    valign: align(num(a.verticalAlign)),
    size,
    lineHeight: LINE_HEIGHT,
    primary: faces.primary,
    synthetic: faces.synthetic,
  });
  const { file } = assemble(
    bytes,
    { ...ex.page, bbox: ex.bbox, matrix: ex.matrix },
    ex.resources,
    `${base.ops}\n${text.ops}`,
    text.usage,
    text.names,
    faces.sub,
    { italic: spec.italic },
  );
  const heap = mod.pdfium as unknown as Heap;
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

/**
 * The text area in the appearance's form space: PDFium's own clip when it
 * drew text; else (PDFium draws no text it cannot encode in WinAnsi) the box
 * inset by the border, or a callout's /Rect minus /RD inset by the border and
 * 2 pt (PDFium's numbers, S26).
 */
export function textBoxOf(
  a: FreeTextArg,
  bbox: readonly [number, number, number, number],
  clip: [number, number, number, number] | null,
): [number, number, number, number] {
  if (clip) return clip;
  const [x0, y0, x1, y1] = bbox;
  const typewriter = a.intent === 'FreeTextTypeWriter';
  const stroke = str(a.strokeColor);
  const bw = typewriter || !stroke || stroke === 'transparent' ? 0 : (num(a.strokeWidth) ?? 0);
  const rd = a.rectangleDifferences as
    { left?: unknown; top?: unknown; right?: unknown; bottom?: unknown } | undefined;
  const callout =
    a.intent === 'FreeTextCallout' || (Array.isArray(a.calloutLine) && a.calloutLine.length > 0);
  if (callout && rd) {
    const d = (v: unknown): number => num(v) ?? 0;
    return [
      x0 + d(rd.left) + bw + 2,
      y0 + d(rd.bottom) + bw + 2,
      x1 - d(rd.right) - bw - 2,
      y1 - d(rd.top) - bw - 2,
    ];
  }
  return [x0 + bw, y0 + bw, x1 - bw, y1 - bw];
}
