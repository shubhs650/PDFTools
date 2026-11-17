// Copy or save an image on the page (M11-08·O6, ADR-028): the picture under a
// page point as a PNG at its own resolution, from the Work worker's copy (the
// caller syncs it first and checks the copy permission, rule 9). An image whose
// mask leaves pixels transparent is rendered by PDFium with its alpha, one
// device pixel per image pixel and upright; any other image gives its decoded
// pixels exactly. Either way the picture is the image itself, not how the page
// turns or stretches it.
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { RpcError } from '../../engine/errors';
import { rawCall } from '../render/pdfium';
import { imageUnder } from '../shared/pageImages';
import { bitmapHasAlpha, bitmapPng } from './images';
import type { JobSlice } from './scheduler';

/**
 * Above this many pixels the mask is not applied (the rendering would need a
 * second full-size bitmap); the decoded pixels are given instead.
 */
export const MAX_RENDERED_PX = 64_000_000;

export interface PageImagePng {
  png: Uint8Array;
  width: number;
  height: number;
}

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  getValue(ptr: number, t: 'float'): number;
  setValue(ptr: number, v: number, t: 'float'): void;
}

export async function pageImagePng(
  mod: WrappedPdfiumModule,
  docPtr: number,
  pageIndex: number,
  at: { x: number; y: number },
  slice: JobSlice,
): Promise<PageImagePng | null> {
  const call = (name: string, ...a: number[]) => rawCall(mod, name, ...a);
  if (
    !Number.isInteger(pageIndex) ||
    pageIndex < 0 ||
    pageIndex >= call('FPDF_GetPageCount', docPtr)
  )
    throw new RpcError('page-not-loaded', 'The page could not be loaded');
  const page = call('FPDF_LoadPage', docPtr, pageIndex);
  if (!page) throw new RpcError('page-not-loaded', 'The page could not be loaded');
  let bmp = 0;
  let size: { width: number; height: number };
  try {
    const hit = imageUnder(mod, page, at);
    if (!hit) return null;
    size = { width: hit.width, height: hit.height };
    const rendered =
      hit.width * hit.height <= MAX_RENDERED_PX ? renderUpright(mod, docPtr, page, hit) : 0;
    if (rendered && bitmapHasAlpha(mod, rendered)) bmp = rendered;
    else {
      if (rendered) call('FPDFBitmap_Destroy', rendered);
      bmp = call('FPDFImageObj_GetBitmap', hit.obj);
    }
  } finally {
    call('FPDF_ClosePage', page);
  }
  if (!bmp) throw new RpcError('image-unreadable', 'The image could not be decoded');
  try {
    await slice.checkpoint();
  } catch (err) {
    call('FPDFBitmap_Destroy', bmp);
    throw err;
  }
  return { png: await bitmapPng(mod, bmp), ...size };
}

/**
 * PDFium's rendering of the image with its mask (`FPDFImageObj_GetRenderedBitmap`
 * makes a bitmap of the image matrix's a × d): the matrix is set to the pixel
 * size for the call and put back after (the page is closed unsaved).
 */
function renderUpright(
  mod: WrappedPdfiumModule,
  docPtr: number,
  page: number,
  hit: { obj: number; width: number; height: number },
): number {
  const heap = mod.pdfium as unknown as Heap;
  const call = (name: string, ...a: number[]) => rawCall(mod, name, ...a);
  const own = heap.wasmExports.malloc(24);
  const full = heap.wasmExports.malloc(24);
  try {
    if (!call('FPDFPageObj_GetMatrix', hit.obj, own)) return 0;
    [hit.width, 0, 0, hit.height, 0, 0].forEach((v, i) => {
      heap.setValue(full + 4 * i, v, 'float');
    });
    if (!call('FPDFPageObj_SetMatrix', hit.obj, full)) return 0;
    try {
      return call('FPDFImageObj_GetRenderedBitmap', docPtr, page, hit.obj);
    } finally {
      call('FPDFPageObj_SetMatrix', hit.obj, own);
    }
  } finally {
    heap.wasmExports.free(own);
    heap.wasmExports.free(full);
  }
}
