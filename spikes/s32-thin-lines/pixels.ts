// Spike S32: render a small window of a page around a point and measure the
// drawn width of a line through it ("ink": the darkness summed across the
// line, in device pixels; a crisp 1 px black line is 1.0).
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { call } from './thin.ts';

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
}

const FPDF_ANNOT = 0x01;
const FPDF_REVERSE_BYTE_ORDER = 0x10;

export interface Window {
  /** RGBA. */
  data: Uint8Array;
  w: number;
  h: number;
}

/**
 * Renders `wPt` × `hPt` points of the page centred on user-space (x, y) at
 * `scale` px/pt. `pageH` is the page height (display space is top-down).
 */
export function renderWindow(
  mod: WrappedPdfiumModule,
  page: number,
  pageH: number,
  x: number,
  y: number,
  scale: number,
  opts: { wPt?: number; hPt?: number; annots?: boolean } = {},
): Window {
  const heap = mod.pdfium as unknown as Heap;
  const w = Math.max(9, Math.ceil((opts.wPt ?? 16) * scale)) | 1;
  const h = Math.max(9, Math.ceil((opts.hPt ?? 16) * scale)) | 1;
  const px = heap.wasmExports.malloc(w * h * 4);
  const mp = heap.wasmExports.malloc(24);
  const cp = heap.wasmExports.malloc(16);
  const bmp = call(mod, 'FPDFBitmap_CreateEx', w, h, 4, px, w * 4);
  try {
    call(mod, 'FPDFBitmap_FillRect', bmp, 0, 0, w, h, 0xffffffff);
    // Display → device: the point lands on the centre pixel's centre.
    const dx = w / 2 - x * scale;
    const dy = h / 2 - (pageH - y) * scale;
    heap.HEAPF32.set([scale, 0, 0, scale, dx, dy], mp >> 2);
    heap.HEAPF32.set([0, 0, w, h], cp >> 2);
    call(
      mod,
      'FPDF_RenderPageBitmapWithMatrix',
      bmp,
      page,
      mp,
      cp,
      FPDF_REVERSE_BYTE_ORDER | (opts.annots ? FPDF_ANNOT : 0),
    );
    return { data: heap.HEAPU8.slice(px, px + w * h * 4), w, h };
  } finally {
    call(mod, 'FPDFBitmap_Destroy', bmp);
    heap.wasmExports.free(cp);
    heap.wasmExports.free(mp);
    heap.wasmExports.free(px);
  }
}

const dark = (d: Uint8Array, i: number): number =>
  1 - ((d[i] ?? 255) + (d[i + 1] ?? 255) + (d[i + 2] ?? 255)) / (3 * 255);

/** Ink across a horizontal line (down the centre column), in device pixels. */
export function inkAcrossH(win: Window): number {
  const x = (win.w - 1) / 2;
  let ink = 0;
  for (let y = 0; y < win.h; y++) ink += dark(win.data, (y * win.w + x) * 4);
  return ink;
}

/** Ink across a vertical line (along the centre row), in device pixels. */
export function inkAcrossV(win: Window): number {
  const y = (win.h - 1) / 2;
  let ink = 0;
  for (let x = 0; x < win.w; x++) ink += dark(win.data, (y * win.w + x) * 4);
  return ink;
}

/** Number of pixels whose colour differs between two renders of the same window. */
export function differingPixels(a: Window, b: Window): number {
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4)
    if (
      a.data[i] !== b.data[i] ||
      a.data[i + 1] !== b.data[i + 1] ||
      a.data[i + 2] !== b.data[i + 2]
    )
      n++;
  return n;
}
