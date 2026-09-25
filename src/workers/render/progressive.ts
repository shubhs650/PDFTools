// Progressive page render (M1-17, ADR-004 decision 3, ADR-001 B9/B14): PDFium's
// FPDF_RenderPageBitmap_Start/Continue with an IFSDK_PAUSE callback that asks
// to pause after each slice. Between slices the worker yields, so a cancel
// message is handled at the next slice boundary (rule 2).
//
// Output matches EmbedPDF's own renders: FPDF_REVERSE_BYTE_ORDER (RGBA), no
// annotations, white background, the page as loaded by EmbedPDF's page cache.
//
// The accepted exception (ADR-004): one slice, like one in-flight 256 px tile
// (~2–50 ms), is not interruptible.
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { AbortError } from '../../engine/errors';
import { rawCall } from './pdfium';

const FPDF_REVERSE_BYTE_ORDER = 0x10;
const FPDFBitmap_BGRA = 4;
const FPDF_RENDER_TOBECONTINUED = 1;
const WHITE = 0xffffffff;

export const DEFAULT_SLICE_MS = 10;

export interface ProgressiveResult {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
  slices: number;
  maxSliceMs: number;
  totalMs: number;
}

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  HEAPU8: Uint8Array;
  HEAP32: Int32Array;
  addFunction(fn: (p: number) => number, sig: string): number;
  removeFunction(p: number): void;
}

// A function, so the compiler doesn't narrow `aborted` across the awaits.
const isAborted = (signal: AbortSignal): boolean => signal.aborted;

/** Yields to the worker's event loop without the 4 ms nested-timer clamp. */
function yieldNow(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(null);
  });
}

export async function renderProgressive(
  mod: WrappedPdfiumModule,
  pagePtr: number,
  page: { width: number; height: number },
  scale: number,
  signal: AbortSignal,
  sliceMs = DEFAULT_SLICE_MS,
): Promise<ProgressiveResult> {
  const heap = mod.pdfium as unknown as Heap;
  const width = Math.max(1, Math.round(page.width * scale));
  const height = Math.max(1, Math.round(page.height * scale));
  const stride = width * 4;
  const bytes = stride * height;
  const buf = heap.wasmExports.malloc(bytes);
  const bitmap = rawCall(mod, 'FPDFBitmap_CreateEx', width, height, FPDFBitmap_BGRA, buf, stride);
  rawCall(mod, 'FPDFBitmap_FillRect', bitmap, 0, 0, width, height, WHITE);

  let sliceStart = performance.now();
  const needPause = heap.addFunction(
    () => (performance.now() - sliceStart >= sliceMs ? 1 : 0),
    'ii',
  );
  const pause = heap.wasmExports.malloc(12); // IFSDK_PAUSE { version, NeedToPauseNow, user }
  heap.HEAP32[pause >> 2] = 1;
  heap.HEAP32[(pause + 4) >> 2] = needPause;
  heap.HEAP32[(pause + 8) >> 2] = 0;

  const t0 = performance.now();
  const slices: number[] = [];
  let started = false;
  try {
    if (isAborted(signal)) throw new AbortError();
    let status = rawCall(
      mod,
      'FPDF_RenderPageBitmap_Start',
      bitmap,
      pagePtr,
      0,
      0,
      width,
      height,
      0,
      FPDF_REVERSE_BYTE_ORDER,
      pause,
    );
    started = true;
    slices.push(performance.now() - sliceStart);
    while (status === FPDF_RENDER_TOBECONTINUED) {
      await yieldNow();
      if (isAborted(signal)) throw new AbortError();
      sliceStart = performance.now();
      status = rawCall(mod, 'FPDF_RenderPage_Continue', pagePtr, pause);
      slices.push(performance.now() - sliceStart);
    }
    // Copy out of the WASM heap into a buffer we can transfer.
    const data = new Uint8ClampedArray(bytes);
    data.set(heap.HEAPU8.subarray(buf, buf + bytes));
    return {
      data,
      width,
      height,
      slices: slices.length,
      maxSliceMs: Math.max(...slices),
      totalMs: performance.now() - t0,
    };
  } finally {
    if (started) rawCall(mod, 'FPDF_RenderPage_Close', pagePtr);
    rawCall(mod, 'FPDFBitmap_Destroy', bitmap);
    heap.removeFunction(needPause);
    heap.wasmExports.free(pause);
    heap.wasmExports.free(buf);
  }
}
