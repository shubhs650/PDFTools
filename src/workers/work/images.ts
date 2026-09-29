// Export Images (M4-06, §7.6): every image on the chosen pages as a file, from
// the Work worker's PDFium copy (B14) — its raw streams make a JPEG a JPEG
// again, byte for byte, and let a logo repeated on every page be written once.
// Everything else becomes a PNG (png.ts): the decoded pixels, or, for an image
// whose mask leaves pixels transparent, PDFium's rendering of it with its
// alpha (at the size it is drawn on the page). Images inside Form XObjects count too.
// Cancel between pages (rule 2); the copy permission is checked by the caller.
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { RpcError } from '../../engine/errors';
import { rawCall } from '../render/pdfium';
import type { ExportFile } from './extract';
import { MIN_IMAGE_PX } from './extract';
import { encodePng, toRgba } from './png';
import type { JobSlice } from './scheduler';
import { crc32 } from './zip';

const IMAGE = 3;
const FORM = 5;

export interface ImageExportResult {
  files: ExportFile[];
  pages: number;
  images: number;
  duplicates: number;
  skipped: number;
}

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  HEAPU8: Uint8Array;
  getValue(ptr: number, t: 'i32'): number;
  UTF8ToString(ptr: number): string;
}

export async function exportImages(
  mod: WrappedPdfiumModule,
  docPtr: number,
  pages: readonly number[],
  slice: JobSlice,
  progress: (p: { done: number; total: number }) => void,
): Promise<ImageExportResult> {
  const heap = mod.pdfium as unknown as Heap;
  const call = (name: string, ...a: number[]) => rawCall(mod, name, ...a);
  const count = call('FPDF_GetPageCount', docPtr);
  const list = pages.filter((p) => Number.isInteger(p) && p >= 0 && p < count);
  const out: ImageExportResult = {
    files: [],
    pages: list.length,
    images: 0,
    duplicates: 0,
    skipped: 0,
  };
  const seen = new Set<string>();
  const buf = heap.wasmExports.malloc(16);

  const bytesOf = (read: (ptr: number, len: number) => number): Uint8Array => {
    const len = read(0, 0);
    if (len <= 0) return new Uint8Array();
    const p = heap.wasmExports.malloc(len);
    try {
      read(p, len);
      return heap.HEAPU8.slice(p, p + len);
    } finally {
      heap.wasmExports.free(p);
    }
  };
  const filters = (obj: number): string[] =>
    Array.from({ length: call('FPDFImageObj_GetImageFilterCount', obj) }, (_, i) => {
      const b = bytesOf((p, l) => call('FPDFImageObj_GetImageFilter', obj, i, p, l));
      return new TextDecoder().decode(b.subarray(0, Math.max(0, b.length - 1)));
    });
  const hasAlpha = (bmp: number): boolean => {
    if (call('FPDFBitmap_GetFormat', bmp) !== 4) return false;
    const w = call('FPDFBitmap_GetWidth', bmp);
    const h = call('FPDFBitmap_GetHeight', bmp);
    const stride = call('FPDFBitmap_GetStride', bmp);
    const at = call('FPDFBitmap_GetBuffer', bmp);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if ((heap.HEAPU8[at + y * stride + x * 4 + 3] ?? 255) < 255) return true;
    return false;
  };
  const pngOf = async (bmp: number): Promise<Uint8Array> => {
    try {
      const w = call('FPDFBitmap_GetWidth', bmp);
      const h = call('FPDFBitmap_GetHeight', bmp);
      const stride = call('FPDFBitmap_GetStride', bmp);
      const at = call('FPDFBitmap_GetBuffer', bmp);
      const rgba = toRgba(
        heap.HEAPU8.subarray(at, at + stride * h),
        w,
        h,
        stride,
        call('FPDFBitmap_GetFormat', bmp),
      );
      return await encodePng(rgba, w, h);
    } finally {
      call('FPDFBitmap_Destroy', bmp);
    }
  };

  try {
    progress({ done: 0, total: list.length });
    for (const [i, p] of list.entries()) {
      await slice.checkpoint();
      const page = call('FPDF_LoadPage', docPtr, p);
      if (!page) throw new RpcError('page-not-loaded', 'The page could not be loaded');
      try {
        const objs: number[] = [];
        const walk = (get: (k: number) => number, n: number, depth: number) => {
          for (let k = 0; k < n; k++) {
            const o = get(k);
            const type = call('FPDFPageObj_GetType', o);
            if (type === IMAGE) objs.push(o);
            else if (type === FORM && depth < 12)
              walk(
                (j) => call('FPDFFormObj_GetObject', o, j),
                call('FPDFFormObj_CountObjects', o),
                depth + 1,
              );
          }
        };
        walk((k) => call('FPDFPage_GetObject', page, k), call('FPDFPage_CountObjects', page), 0);
        let k = 0;
        for (const obj of objs) {
          if (!call('FPDFImageObj_GetImagePixelSize', obj, buf, buf + 4)) continue;
          const w = heap.getValue(buf, 'i32');
          const h = heap.getValue(buf + 4, 'i32');
          if (w < MIN_IMAGE_PX || h < MIN_IMAGE_PX) {
            out.skipped++;
            continue;
          }
          const raw = bytesOf((ptr, len) => call('FPDFImageObj_GetImageDataRaw', obj, ptr, len));
          const key = `${String(raw.length)}:${String(crc32(raw))}:${String(w)}x${String(h)}`;
          if (seen.has(key)) {
            out.duplicates++;
            continue;
          }
          seen.add(key);
          const f = filters(obj);
          k++;
          const name = `page-${String(p + 1)}-image-${String(k)}`;
          // PDFium's rendering applies the soft mask / mask; if it leaves any pixel
          // transparent, that rendering (with alpha) is the image. Otherwise the
          // native pixels — or, for a plain JPEG, its own bytes.
          const rendered = call('FPDFImageObj_GetRenderedBitmap', docPtr, page, obj);
          const transparent = rendered !== 0 && hasAlpha(rendered);
          if (rendered && !transparent) call('FPDFBitmap_Destroy', rendered);
          if (!transparent && f.length === 1 && f[0] === 'DCTDecode' && raw.length > 0) {
            out.files.push({ path: `${name}.jpg`, data: raw, type: 'image/jpeg' });
          } else {
            const bmp = transparent ? rendered : call('FPDFImageObj_GetBitmap', obj);
            if (!bmp) continue;
            out.files.push({ path: `${name}.png`, data: await pngOf(bmp), type: 'image/png' });
          }
          out.images++;
        }
      } finally {
        call('FPDF_ClosePage', page);
      }
      progress({ done: i + 1, total: list.length });
    }
  } finally {
    heap.wasmExports.free(buf);
  }
  return out;
}
