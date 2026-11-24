// Spike S32 (M13-03, D-69): find every stroked path of a page, including
// those inside form XObjects (recursively), and set their line width to 0.
// A width of 0 is the PDF's "thinnest line the device can draw" (ISO 32000-2
// §8.4.3.2): PDFium draws it one device pixel wide at any zoom.
//
// Text (also text drawn as stroked outlines), images and shadings are left
// alone (plan §3), and so are annotations: their appearances are not page
// objects of the page.
/* eslint-disable @typescript-eslint/non-nullable-type-assertion-style -- WASM exports and test pages known to exist (spike code) */
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';

type RawFn = (...a: number[]) => number;
export function call(mod: WrappedPdfiumModule, name: string, ...args: number[]): number {
  const fn = (mod as unknown as Record<string, RawFn | undefined>)[name];
  if (typeof fn !== 'function') throw new Error(`PDFium export ${name} is missing`);
  return fn(...args);
}

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  HEAP32: Int32Array;
  HEAPF32: Float32Array;
}
const heapOf = (mod: WrappedPdfiumModule): Heap => mod.pdfium as unknown as Heap;

/**
 * The WASM exports themselves: the walk makes several calls per page object,
 * and the module's wrapped (cwrap) functions cost about 3x more per call.
 */
function exportsOf(mod: WrappedPdfiumModule): Record<string, RawFn> {
  return mod.pdfium.wasmExports as unknown as Record<string, RawFn>;
}

const FPDF_PAGEOBJ_PATH = 2;
const FPDF_PAGEOBJ_FORM = 5;

/** Stroked paths of one loaded page with their widths as read from the file. */
export interface StrokeList {
  objects: Int32Array;
  widths: Float32Array;
  /** Form XObjects walked (each placement counts, as PDFium parses each placement). */
  forms: number;
  /** All page objects visited. */
  visited: number;
}

/** Walks the page (and every form XObject in it) once. */
export function collectStrokes(mod: WrappedPdfiumModule, page: number): StrokeList {
  const heap = heapOf(mod);
  const x = exportsOf(mod);
  const getType = x.FPDFPageObj_GetType as RawFn;
  const countForm = x.FPDFFormObj_CountObjects as RawFn;
  const getFormObj = x.FPDFFormObj_GetObject as RawFn;
  const drawMode = x.FPDFPath_GetDrawMode as RawFn;
  const getWidth = x.FPDFPageObj_GetStrokeWidth as RawFn;
  const scratch = heap.wasmExports.malloc(8);
  const objs: number[] = [];
  const widths: number[] = [];
  let forms = 0;
  let visited = 0;
  const visit = (obj: number): void => {
    visited++;
    const type = getType(obj);
    if (type === FPDF_PAGEOBJ_FORM) {
      forms++;
      const n = countForm(obj);
      for (let i = 0; i < n; i++) visit(getFormObj(obj, i));
      return;
    }
    if (type !== FPDF_PAGEOBJ_PATH) return;
    // FPDFPath_GetDrawMode(path, int* fillmode, FPDF_BOOL* stroke)
    if (!drawMode(obj, scratch, scratch + 4)) return;
    if (!heap.HEAP32[(scratch + 4) >> 2]) return;
    if (!getWidth(obj, scratch)) return;
    objs.push(obj);
    widths.push(heap.HEAPF32[scratch >> 2] ?? 0);
  };
  try {
    const n = (x.FPDFPage_CountObjects as RawFn)(page);
    const get = x.FPDFPage_GetObject as RawFn;
    for (let i = 0; i < n; i++) visit(get(page, i));
  } finally {
    heap.wasmExports.free(scratch);
  }
  return { objects: Int32Array.from(objs), widths: Float32Array.from(widths), forms, visited };
}

/** Sets every collected stroke to width 0. */
export function thin(mod: WrappedPdfiumModule, list: StrokeList): void {
  const set = exportsOf(mod).FPDFPageObj_SetStrokeWidth;
  if (!set) throw new Error('FPDFPageObj_SetStrokeWidth is missing');
  for (const obj of list.objects) set(obj, 0);
}

/** Puts every collected stroke back to its own width. */
export function restore(mod: WrappedPdfiumModule, list: StrokeList): void {
  const set = exportsOf(mod).FPDFPageObj_SetStrokeWidth;
  if (!set) throw new Error('FPDFPageObj_SetStrokeWidth is missing');
  for (let i = 0; i < list.objects.length; i++) set(list.objects[i] ?? 0, list.widths[i] ?? 0);
}
