// Snapshot (M6-09, ADR-021 D-38 e): a region of a page as the screen shows it.
// The page content is drawn without PDFium's annotation flag, then each
// annotation the view draws (the annotation tiles' set: no replies, pop-ups,
// links or hidden markups; form fields included) is drawn over it from its own
// appearance stream, through the same matrix. PDFium's annotation flag would
// also draw what the view leaves out, such as reply note icons.
//
// Coordinates follow EmbedPDF's (pages loaded rotation-normalized): device
// space is top-left, in points, relative to the crop box's lower-left corner.
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import { buildUserToDeviceMatrix, type Rect, type Rotation } from '@embedpdf/models';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { RpcError } from '../../engine/errors';
import { MAX_SNAPSHOT_SIDE, snapshotPixels } from '../../features/snapshot/snapshotModel';
import { annotBoxes, type PageFrame } from './annotTiles';
import { acquirePage, rawCall } from './pdfium';

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
}

export interface SnapshotRequest {
  pageIndex: number;
  frame: PageFrame;
  /** The region in device space (points). */
  rect: Rect;
  /** Pixels per point. */
  scale: number;
  /** Quarter turns clockwise: the page's /Rotate plus the view's. */
  rotation: Rotation;
}

export interface SnapshotPixels {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
  /** Annotations drawn over the content. */
  drawn: number;
}

/** Bitmap format FPDFBitmap_BGRA; flags 16 = FPDF_REVERSE_BYTE_ORDER (RGBA out). */
const BGRA = 4;
const RGBA = 16;
const WHITE = 0xffffffff;
/** The longest side, in pixels (snapshotScale keeps within it). */
const MAX_SIDE = MAX_SNAPSHOT_SIDE;

export function renderSnapshot(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  docId: string,
  req: SnapshotRequest,
): SnapshotPixels {
  const { rect, scale, rotation } = req;
  if (!(scale > 0 && Math.max(rect.size.width, rect.size.height) * scale <= MAX_SIDE + 1))
    throw new RpcError('snapshot-size', 'The region is too large');
  const { width, height } = snapshotPixels(rect, scale, rotation);
  const heap = mod.pdfium as unknown as Heap;
  const ref = acquirePage(native, docId, req.pageIndex);
  const bytes = width * height * 4;
  const px = heap.wasmExports.malloc(bytes);
  const m = heap.wasmExports.malloc(24);
  const clip = heap.wasmExports.malloc(16);
  const bmp = px ? rawCall(mod, 'FPDFBitmap_CreateEx', width, height, BGRA, px, width * 4) : 0;
  let drawn = 0;
  try {
    if (!bmp) throw new RpcError('snapshot-memory', 'The region is too large');
    rawCall(mod, 'FPDFBitmap_FillRect', bmp, 0, 0, width, height, WHITE);
    const M = buildUserToDeviceMatrix(rect, rotation, width, height);
    heap.HEAPF32.set([M.a, M.b, M.c, M.d, M.e, M.f], m / 4);
    heap.HEAPF32.set([0, 0, width, height], clip / 4);
    rawCall(mod, 'FPDF_RenderPageBitmapWithMatrix', bmp, ref.pagePtr, m, clip, RGBA);
    const x1 = rect.origin.x + rect.size.width;
    const y1 = rect.origin.y + rect.size.height;
    for (const b of annotBoxes(mod, ref.pagePtr, req.frame, { widgets: true })) {
      if (b.x1 < rect.origin.x || b.x0 > x1 || b.y1 < rect.origin.y || b.y0 > y1) continue;
      const a = rawCall(mod, 'FPDFPage_GetAnnot', ref.pagePtr, b.index);
      if (!a) continue;
      try {
        // Mode 0: the normal appearance.
        if (rawCall(mod, 'EPDF_RenderAnnotBitmap', bmp, ref.pagePtr, a, 0, m, RGBA)) drawn++;
      } finally {
        rawCall(mod, 'FPDFPage_CloseAnnot', a);
      }
    }
    // HEAPU8 is read after the render (the heap may have grown); slice copies out.
    const data = new Uint8ClampedArray(heap.HEAPU8.slice(px, px + bytes).buffer);
    return { data, width, height, drawn };
  } finally {
    if (bmp) rawCall(mod, 'FPDFBitmap_Destroy', bmp);
    heap.wasmExports.free(clip);
    heap.wasmExports.free(m);
    if (px) heap.wasmExports.free(px);
    ref.release();
  }
}
