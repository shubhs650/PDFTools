// Spike S29: the few direct PDFium calls the overlay needs (D-59), usable in
// Node (run-node.ts) and in a worker (overlay.worker.ts). The app's Render
// worker reaches the same functions through src/workers/render/pdfium.ts
// (rawCall, acquirePage); here documents are opened directly so the spike
// runs without EmbedPDF's engine.
//
// Coordinates: "display space" is PDFium's page display space — points,
// top-left origin, the page's /Rotate and crop box applied. A matrix maps
// display space to bitmap pixels.
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
  HEAPF64: Float64Array;
}

type RawFn = (...a: (number | string)[]) => number;

export function call(mod: WrappedPdfiumModule, name: string, ...args: (number | string)[]): number {
  const fn = (mod as unknown as Record<string, RawFn | undefined>)[name];
  if (typeof fn !== 'function') throw new Error(`PDFium export ${name} is missing`);
  return fn(...args);
}

const heapOf = (mod: WrappedPdfiumModule): Heap => mod.pdfium as unknown as Heap;

export type Matrix = readonly [number, number, number, number, number, number];
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m1 then m2 (row vectors: p · m1 · m2). */
export function mul(m1: Matrix, m2: Matrix): Matrix {
  const [a, b, c, d, e, f] = m1;
  const [A, B, C, D, E, F] = m2;
  return [
    a * A + b * C,
    a * B + b * D,
    c * A + d * C,
    c * B + d * D,
    e * A + f * C + E,
    e * B + f * D + F,
  ];
}

export function invert(m: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/** A similarity (shift, one scale, rotation in degrees) as a matrix. */
export function similarity(scale: number, deg: number, dx: number, dy: number): Matrix {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r) * scale;
  const s = Math.sin(r) * scale;
  return [c, s, -s, c, dx, dy];
}

export interface OpenDoc {
  doc: number;
  close(): void;
}

export function openDoc(mod: WrappedPdfiumModule, bytes: Uint8Array, password = ''): OpenDoc {
  const heap = heapOf(mod);
  const p = heap.wasmExports.malloc(bytes.length);
  heap.HEAPU8.set(bytes, p);
  const doc = call(mod, 'FPDF_LoadMemDocument', p, bytes.length, password);
  if (!doc) {
    heap.wasmExports.free(p);
    throw new Error(
      `PDFium could not open the file (error ${String(call(mod, 'FPDF_GetLastError'))})`,
    );
  }
  return {
    doc,
    close() {
      call(mod, 'FPDF_CloseDocument', doc);
      heap.wasmExports.free(p);
    },
  };
}

/** Display size of a page (points, /Rotate applied). */
export function pageSize(
  mod: WrappedPdfiumModule,
  doc: number,
  index: number,
): { w: number; h: number } {
  const heap = heapOf(mod);
  const p = heap.wasmExports.malloc(8);
  try {
    if (!call(mod, 'FPDF_GetPageSizeByIndexF', doc, index, p)) throw new Error('no page');
    return { w: heap.HEAPF32[p >> 2] ?? 0, h: heap.HEAPF32[(p >> 2) + 1] ?? 0 };
  } finally {
    heap.wasmExports.free(p);
  }
}

const FPDFBitmap_Gray = 1;
const FPDFBitmap_BGRA = 4;
const FPDF_REVERSE_BYTE_ORDER = 0x10;

/**
 * Renders a page through `m` (display space → pixels) into a w × h bitmap,
 * page content only (no FPDF_ANNOT flag: comments are not part of the
 * comparison, Q10). `grey`: an 8-bit FPDFBitmap_Gray, PDFium converting
 * colour to grey as it draws; otherwise RGBA.
 */
export function renderPage(
  mod: WrappedPdfiumModule,
  page: number,
  m: Matrix,
  w: number,
  h: number,
  grey: boolean,
): Uint8Array {
  const heap = heapOf(mod);
  const bpp = grey ? 1 : 4;
  const stride = grey ? (w + 3) & ~3 : w * 4;
  const px = heap.wasmExports.malloc(stride * h);
  const mp = heap.wasmExports.malloc(24);
  const cp = heap.wasmExports.malloc(16);
  const bmp = call(
    mod,
    'FPDFBitmap_CreateEx',
    w,
    h,
    grey ? FPDFBitmap_Gray : FPDFBitmap_BGRA,
    px,
    stride,
  );
  try {
    if (!bmp) throw new Error('bitmap');
    call(mod, 'FPDFBitmap_FillRect', bmp, 0, 0, w, h, 0xffffffff);
    heap.HEAPF32.set(m, mp >> 2);
    heap.HEAPF32.set([0, 0, w, h], cp >> 2);
    call(
      mod,
      'FPDF_RenderPageBitmapWithMatrix',
      bmp,
      page,
      mp,
      cp,
      grey ? 0 : FPDF_REVERSE_BYTE_ORDER,
    );
    const src = heap.HEAPU8;
    if (stride === w * bpp) return src.slice(px, px + w * h * bpp);
    const out = new Uint8Array(w * h * bpp);
    for (let y = 0; y < h; y++)
      out.set(src.subarray(px + y * stride, px + y * stride + w * bpp), y * w * bpp);
    return out;
  } finally {
    if (bmp) call(mod, 'FPDFBitmap_Destroy', bmp);
    heap.wasmExports.free(cp);
    heap.wasmExports.free(mp);
    heap.wasmExports.free(px);
  }
}

export function withPage<T>(
  mod: WrappedPdfiumModule,
  doc: number,
  index: number,
  fn: (page: number) => T,
): T {
  const page = call(mod, 'FPDF_LoadPage', doc, index);
  if (!page) throw new Error(`page ${String(index)} could not be loaded`);
  try {
    return fn(page);
  } finally {
    call(mod, 'FPDF_ClosePage', page);
  }
}

/** Number of annotations on a page (to show they are left out). */
export function annotCount(mod: WrappedPdfiumModule, page: number): number {
  return call(mod, 'FPDFPage_GetAnnotCount', page);
}
