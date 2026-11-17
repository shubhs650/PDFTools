// Images to PDF (M11-08·O8, D-55, §7.8): a new document with one JPG or PNG
// per page, built in the Work worker (rule 1) on Create Blank's route (an
// empty PDFium document, written by its full save). A JPEG goes in as it is
// (DCTDecode, no re-encoding); a PNG is decoded by PDFium and stored with
// Flate, its transparency as a soft mask. The camera's EXIF orientation is
// applied by the image's matrix. Progress per image, cancellable between
// images (rule 2). Insert from Image builds the same document and the
// Render worker imports its pages.
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { RpcError } from '../../engine/errors';
import { readImageInfo, IMAGE_HEADER_BYTES } from '../../model/imageFile';
import {
  IMAGES_MAX,
  IMAGES_MAX_BYTES,
  placeImage,
  type ImagePageSize,
} from '../../model/imagePages';
import { rawCall } from '../render/pdfium';
import { FPDF_NO_INCREMENTAL, saveWithFlags } from '../render/save/writer';
import { withFreshId } from './blank';
import type { JobSlice } from './scheduler';

export interface ImagesSpec {
  images: ArrayBuffer[];
  size: ImagePageSize;
  /** A 10 mm margin on paper sizes. */
  margin: boolean;
}

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  HEAPU8: Uint8Array;
  setValue(ptr: number, v: number, t: 'float'): void;
}

/** Throws on an empty job, too many or too large images, or an unknown page size. */
export function checkImagesSpec(spec: ImagesSpec): void {
  if (spec.images.length === 0 || spec.images.length > IMAGES_MAX)
    throw new RpcError('images-count', 'The number of images is out of range');
  if (spec.images.reduce((n, b) => n + b.byteLength, 0) > IMAGES_MAX_BYTES)
    throw new RpcError('images-bytes', 'The images are too large for one document');
  if (!['fit', 'a4', 'letter'].includes(spec.size))
    throw new RpcError('images-size', 'Unknown page size');
}

/** The new document's bytes. An image PDFium can't read fails the job with `images-unreadable:<index>`. */
export async function imagesToPdf(
  mod: WrappedPdfiumModule,
  spec: ImagesSpec,
  slice: JobSlice,
  progress: (p: { done: number; total: number }) => void,
): Promise<Uint8Array> {
  checkImagesSpec(spec);
  const heap = mod.pdfium as unknown as Heap;
  const call = (name: string, ...a: number[]) => rawCall(mod, name, ...a);
  const doc = mod.FPDF_CreateNewDocument();
  if (!doc) throw new RpcError('images', 'The new document could not be created');
  try {
    const total = spec.images.length;
    for (let i = 0; i < total; i++) {
      await slice.checkpoint();
      const bytes = new Uint8Array(spec.images[i] ?? new ArrayBuffer(0));
      const info = readImageInfo(bytes.subarray(0, IMAGE_HEADER_BYTES));
      if (!info) throw new RpcError(`images-unreadable:${String(i)}`, 'Not a JPG or PNG image');
      const at = placeImage(info, spec.size, spec.margin);
      const page = call('FPDFPage_New', doc, i, at.width, at.height);
      if (!page) throw new RpcError('page-new', 'The page could not be created');
      try {
        const obj = call('FPDFPageObj_NewImageObj', doc);
        if (!obj) throw new RpcError('images', 'The image object could not be created');
        let inserted = false;
        try {
          const buf = heap.wasmExports.malloc(bytes.length);
          let ok: number;
          try {
            heap.HEAPU8.set(bytes, buf);
            ok = call(
              info.kind === 'jpeg' ? 'EPDFImageObj_SetJpeg' : 'EPDFImageObj_SetPng',
              0,
              0,
              obj,
              buf,
              bytes.length,
            );
          } finally {
            heap.wasmExports.free(buf);
          }
          if (!ok) throw new RpcError(`images-unreadable:${String(i)}`, 'PDFium refused the image');
          const m = heap.wasmExports.malloc(24);
          try {
            at.matrix.forEach((v, k) => {
              heap.setValue(m + k * 4, v, 'float');
            });
            if (!call('FPDFPageObj_SetMatrix', obj, m))
              throw new RpcError('images', 'The image could not be placed');
          } finally {
            heap.wasmExports.free(m);
          }
          call('FPDFPage_InsertObject', page, obj);
          inserted = true;
        } finally {
          if (!inserted) call('FPDFPageObj_Destroy', obj);
        }
        if (!call('FPDFPage_GenerateContent', page))
          throw new RpcError('images', 'The page content could not be written');
      } finally {
        call('FPDF_ClosePage', page);
      }
      progress({ done: i + 1, total });
    }
    await slice.checkpoint();
    const bytes = saveWithFlags(mod, doc, FPDF_NO_INCREMENTAL);
    return withFreshId(bytes, crypto.getRandomValues(new Uint8Array(16)));
  } finally {
    mod.FPDF_CloseDocument(doc);
  }
}
