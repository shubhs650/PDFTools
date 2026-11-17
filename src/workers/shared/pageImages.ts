// Copy or save an image on the page (M11-08·O6, ADR-028): the picture of the
// page content under a page point, found over the page's objects (images
// inside Form XObjects too, rotated or skewed ones by their own matrix). The
// last one drawn is on top. Used by the Render worker for the page menu (its
// copy is the current state) and by the Work worker for the extraction (its
// copy synced first), so both pick the same image.
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import {
  IDENTITY,
  MIN_IMAGE_PX,
  mul,
  onImage,
  toUserSpace,
  type Matrix,
  type PageImageHit,
} from '../../model/pageImageHit';
import { rawCall } from '../render/pdfium';

const IMAGE = 3;
const FORM = 5;
/** Nested forms deeper than this are not looked into (as Export Images). */
const MAX_DEPTH = 12;

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  getValue(ptr: number, t: 'i32' | 'float'): number;
}

export interface ImageUnder extends PageImageHit {
  /** The image object (valid while the page stays loaded). */
  obj: number;
}

/**
 * The image under page point `at` (points from the visible page's top-left
 * corner, unrotated) on a loaded page, or null. Images smaller than
 * MIN_IMAGE_PX (rules, dots, bullets) don't count.
 */
export function imageUnder(
  mod: WrappedPdfiumModule,
  page: number,
  at: { x: number; y: number },
): ImageUnder | null {
  const heap = mod.pdfium as unknown as Heap;
  const call = (name: string, ...a: number[]) => rawCall(mod, name, ...a);
  const buf = heap.wasmExports.malloc(24);
  try {
    const f = (i: number): number => heap.getValue(buf + 4 * i, 'float');
    // The visible page area (crop box ∩ media box) gives the top-left origin.
    if (!call('FPDF_GetPageBoundingBox', page, buf)) return null;
    const p = toUserSpace(at, { left: f(0), top: f(1) });
    const matrixOf = (obj: number): Matrix =>
      call('FPDFPageObj_GetMatrix', obj, buf) ? [f(0), f(1), f(2), f(3), f(4), f(5)] : IDENTITY;
    const sizeOf = (obj: number): PageImageHit | null =>
      call('FPDFImageObj_GetImagePixelSize', obj, buf, buf + 4)
        ? { width: heap.getValue(buf, 'i32'), height: heap.getValue(buf + 4, 'i32') }
        : null;
    let top: ImageUnder | null = null;
    const walk = (get: (k: number) => number, n: number, parent: Matrix, depth: number) => {
      for (let k = 0; k < n; k++) {
        const o = get(k);
        if (!o) continue;
        const type = call('FPDFPageObj_GetType', o);
        if (type === IMAGE) {
          if (!onImage(mul(matrixOf(o), parent), p.x, p.y)) continue;
          const size = sizeOf(o);
          if (size && size.width >= MIN_IMAGE_PX && size.height >= MIN_IMAGE_PX)
            top = { obj: o, ...size };
        } else if (type === FORM && depth < MAX_DEPTH) {
          walk(
            (j) => call('FPDFFormObj_GetObject', o, j),
            call('FPDFFormObj_CountObjects', o),
            mul(matrixOf(o), parent),
            depth + 1,
          );
        }
      }
    };
    walk(
      (k) => call('FPDFPage_GetObject', page, k),
      call('FPDFPage_CountObjects', page),
      IDENTITY,
      0,
    );
    return top;
  } finally {
    heap.wasmExports.free(buf);
  }
}
