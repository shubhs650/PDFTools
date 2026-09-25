// Render worker (D-10), "hosted" variant: EmbedPDF's own PdfiumNative executor
// running in *our* worker module instead of EmbedPDF's inline blob: worker.
// The main thread wraps it in EmbedPDF's PdfEngine orchestrator
// (hosted-engine.ts), so the headless plugins see an ordinary PdfEngine.
// Hosting it ourselves gives us the WASM module for memory probes and for the
// direct PDFium calls ADR-001 B14 allows (S1 incremental save, progressive
// rendering below).

import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { Task } from '@embedpdf/models';

export type RenderIn =
  | { type: 'init'; wasmUrl: string }
  | { type: 'exec'; id: number; method: string; args: unknown[] }
  | { type: 'special'; id: number; method: 'memory' | 'stats' | 'progressive'; args?: unknown }
  | { type: 'cancelProgressive' };

export type RenderOut =
  | { type: 'ready'; ms: number; wasmBytes: number }
  | { type: 'result'; id: number; data: unknown }
  | { type: 'error'; id: number; error: unknown }
  | { type: 'progress'; id: number; progress: unknown };

let mod: WrappedPdfiumModule | undefined;
let native: PdfiumNative | undefined;
const stats: Record<string, number> = {};
let cancelProgressive = false;

const post = (m: RenderOut, transfer: Transferable[] = []): void => {
  (self as unknown as Worker).postMessage(m, { transfer });
};

function wasmMemory(): WebAssembly.Memory | undefined {
  return (mod?.pdfium.wasmExports as unknown as { memory?: WebAssembly.Memory } | undefined)
    ?.memory;
}

/** Transfer pixel buffers instead of copying them — never the WASM heap itself. */
function transferables(data: unknown): Transferable[] {
  const d = (data as { data?: unknown } | null)?.data;
  if (
    d instanceof Uint8ClampedArray &&
    d.buffer instanceof ArrayBuffer &&
    d.buffer !== wasmMemory()?.buffer &&
    d.byteOffset === 0 &&
    d.byteLength === d.buffer.byteLength
  ) {
    return [d.buffer];
  }
  return [];
}

self.addEventListener('message', (ev: MessageEvent<RenderIn>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'init':
      void (async () => {
        const t0 = performance.now();
        const wasmBinary = await (await fetch(msg.wasmUrl)).arrayBuffer();
        mod = await init({ wasmBinary });
        native = new PdfiumNative(mod, { fontFallback: null });
        post({
          type: 'ready',
          ms: performance.now() - t0,
          wasmBytes: wasmMemory()?.buffer.byteLength ?? 0,
        });
      })();
      return;
    case 'exec': {
      stats[msg.method] = (stats[msg.method] ?? 0) + 1;
      const fn = (native as unknown as Record<string, (...a: unknown[]) => Task<unknown, unknown>>)[
        msg.method
      ];
      if (!native || !fn) {
        post({ type: 'error', id: msg.id, error: { type: 'reject', reason: `no ${msg.method}` } });
        return;
      }
      const task = fn.apply(native, msg.args);
      task.onProgress((progress) => {
        post({ type: 'progress', id: msg.id, progress });
      });
      task.wait(
        (data) => {
          post({ type: 'result', id: msg.id, data }, transferables(data));
        },
        (error) => {
          post({ type: 'error', id: msg.id, error });
        },
      );
      return;
    }
    case 'special':
      void special(msg.method, msg.args).then(
        (data) => {
          post({ type: 'result', id: msg.id, data });
        },
        (error: unknown) => {
          post({ type: 'error', id: msg.id, error: { type: 'reject', reason: String(error) } });
        },
      );
      return;
    case 'cancelProgressive':
      cancelProgressive = true;
      return;
  }
});

async function special(method: string, args: unknown): Promise<unknown> {
  switch (method) {
    case 'memory':
      return { wasmBytes: wasmMemory()?.buffer.byteLength ?? 0 };
    case 'stats':
      return { ...stats };
    case 'progressive':
      return progressive(args as ProgressiveArgs);
    default:
      throw new Error(`unknown special ${method}`);
  }
}

interface ProgressiveArgs {
  bytes: ArrayBuffer;
  pageIndex: number;
  zoom: number;
  /** Tile origin in page points (top-left). */
  x: number;
  y: number;
  size: number;
  sliceMs: number;
  cancelAfterMs?: number;
}

type Fn = (...a: (number | string)[]) => number;

/**
 * Direct PDFium progressive render (FPDF_RenderPageBitmap_Start/Continue) with
 * an IFSDK_PAUSE callback — not exposed by EmbedPDF (ADR-001 B14 route).
 * Between slices we yield to the event loop so a cancel message can land.
 */
async function progressive(a: ProgressiveArgs): Promise<unknown> {
  if (!mod) throw new Error('not initialised');
  const m = mod as unknown as Record<string, Fn>;
  const em = mod.pdfium as unknown as {
    wasmExports: { malloc(n: number): number; free(p: number): void };
    HEAPU8: Uint8Array;
    HEAP32: Int32Array;
    addFunction(fn: (p: number) => number, sig: string): number;
    removeFunction(p: number): void;
  };
  const call = (name: string, ...args: (number | string)[]): number => {
    const f = m[name];
    if (!f) throw new Error(`missing ${name}`);
    return f(...args);
  };

  cancelProgressive = false;
  const bytes = new Uint8Array(a.bytes);
  const buf = em.wasmExports.malloc(bytes.length);
  em.HEAPU8.set(bytes, buf);
  const doc = call('FPDF_LoadMemDocument', buf, bytes.length, '');
  if (!doc) throw new Error('FPDF_LoadMemDocument failed');
  const t0 = performance.now();
  const page = call('FPDF_LoadPage', doc, a.pageIndex);
  const loadMs = performance.now() - t0;
  const pageW = call('FPDF_GetPageWidthF', page);
  const pageH = call('FPDF_GetPageHeightF', page);
  const bmp = call('FPDFBitmap_Create', a.size, a.size, 1);
  call('FPDFBitmap_FillRect', bmp, 0, 0, a.size, a.size, 0xffffffff);

  let sliceStart = performance.now();
  const pausePtr = em.wasmExports.malloc(12);
  const needPause = em.addFunction(
    () => (performance.now() - sliceStart > a.sliceMs ? 1 : 0),
    'ii',
  );
  em.HEAP32[pausePtr >> 2] = 1; // version
  em.HEAP32[(pausePtr + 4) >> 2] = needPause;
  em.HEAP32[(pausePtr + 8) >> 2] = 0;

  const slices: number[] = [];
  const FPDF_ANNOT = 0x01;
  const tStart = performance.now();
  let status = call(
    'FPDF_RenderPageBitmap_Start',
    bmp,
    page,
    Math.round(-a.x * a.zoom),
    Math.round(-a.y * a.zoom),
    Math.round(pageW * a.zoom),
    Math.round(pageH * a.zoom),
    0,
    FPDF_ANNOT,
    pausePtr,
  );
  slices.push(performance.now() - sliceStart);
  let cancelled = false;
  let cancelSeenAt = 0;
  const TOBECONTINUED = 1;
  while (status === TOBECONTINUED) {
    await new Promise((r) => setTimeout(r, 0));
    if (a.cancelAfterMs !== undefined && performance.now() - tStart > a.cancelAfterMs) {
      cancelProgressive = true;
    }
    if (cancelProgressive) {
      cancelled = true;
      cancelSeenAt = performance.now();
      break;
    }
    sliceStart = performance.now();
    status = call('FPDF_RenderPage_Continue', page, pausePtr);
    slices.push(performance.now() - sliceStart);
  }
  call('FPDF_RenderPage_Close', page);
  const totalMs = performance.now() - tStart;
  const closeMs = cancelled ? performance.now() - cancelSeenAt : 0;

  call('FPDFBitmap_Destroy', bmp);
  call('FPDF_ClosePage', page);
  call('FPDF_CloseDocument', doc);
  em.removeFunction(needPause);
  em.wasmExports.free(pausePtr);
  em.wasmExports.free(buf);
  return {
    finalStatus: status,
    loadMs,
    totalMs,
    slices: slices.length,
    maxSliceMs: Math.max(...slices),
    cancelled,
    closeMs,
  };
}
