// Render worker (ARCHITECTURE §3.1, D-10, ADR-004 decision 2): PDFium #1 with
// EmbedPDF's PdfiumNative executor, hosted in our own module so direct PDFium
// calls are possible (ADR-001 B14). The main thread drives it through
// EmbedPDF's PdfEngine (src/engine/hostedEngine.ts) over our typed RPC.
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { PdfErrorCode, TaskRejectedError, type Task } from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { RpcError } from '../engine/errors';
import { Transfer } from '../engine/protocol';
import { PDFIUM_ERROR_PREFIX, type RenderApi } from '../engine/renderApi';
import { serve } from './rpc-host';
import { docPtrOf, rawCall, wasmMemory } from './render/pdfium';

let mod: WrappedPdfiumModule | undefined;
let native: PdfiumNative | undefined;

function ready(): { mod: WrappedPdfiumModule; native: PdfiumNative } {
  if (!mod || !native)
    throw new RpcError('not-initialized', 'The render worker is not initialized');
  return { mod, native };
}

/** Pixel buffers we own can be transferred; never the WASM heap itself. */
function transferables(value: unknown, heap: ArrayBufferLike | undefined): Transferable[] {
  const out: Transferable[] = [];
  const consider = (v: unknown): void => {
    if (v instanceof ArrayBuffer) {
      if (v !== heap) out.push(v);
    } else if (ArrayBuffer.isView(v)) {
      const b = v.buffer;
      if (
        b instanceof ArrayBuffer &&
        b !== heap &&
        v.byteOffset === 0 &&
        v.byteLength === b.byteLength
      )
        out.push(b);
    }
  };
  consider(value);
  if (value && typeof value === 'object') for (const v of Object.values(value)) consider(v);
  return [...new Set(out)];
}

/** EmbedPDF task failure → RpcError with the PdfErrorCode, no message text (rule 10). */
function toRpcError(err: unknown): RpcError {
  const reason: unknown =
    err instanceof TaskRejectedError ? err.reason : (err as { reason?: unknown } | null)?.reason;
  const code = (reason as { code?: unknown } | undefined)?.code;
  const n = typeof code === 'number' ? code : PdfErrorCode.Unknown;
  return new RpcError(`${PDFIUM_ERROR_PREFIX}${String(n)}`, `PDFium error ${String(n)}`);
}

serve<RenderApi>(self, {
  init: async ({ wasmUrl, fontFallback }) => {
    // Runtime guard: callers outside TypeScript's reach (tests, future code).
    if ((fontFallback as unknown) === undefined) {
      // ADR-003: undefined silently means "fonts from jsDelivr" inside EmbedPDF.
      throw new RpcError('font-fallback-undefined', 'fontFallback must be null or a local config');
    }
    const t0 = performance.now();
    const wasmBinary = await (await fetch(wasmUrl)).arrayBuffer();
    mod = await init({ wasmBinary });
    native = new PdfiumNative(mod, { fontFallback });
    return { ms: performance.now() - t0, wasmBytes: wasmMemory(mod)?.buffer.byteLength ?? 0 };
  },

  exec: async ({ method, args }, ctx) => {
    const { mod: m, native: n } = ready();
    const fn = (
      n as unknown as Record<string, ((...a: unknown[]) => Task<unknown, unknown>) | undefined>
    )[method];
    if (typeof fn !== 'function')
      throw new RpcError('unknown-method', `Unknown executor method ${method}`);
    const task = fn.apply(n, args);
    task.onProgress((p) => {
      ctx.progress(p);
    });
    ctx.signal.addEventListener('abort', () => {
      task.abort({ code: PdfErrorCode.Cancelled, message: 'cancelled' });
    });
    let value: unknown;
    try {
      value = await task.toPromise();
    } catch (err) {
      throw toRpcError(err);
    }
    return new Transfer(value, transferables(value, wasmMemory(m)?.buffer));
  },

  docInfo: ({ docId }) => {
    const { mod: m, native: n } = ready();
    const doc = docPtrOf(n, docId);
    return {
      pageCount: rawCall(m, 'FPDF_GetPageCount', doc),
      permissions: rawCall(m, 'FPDF_GetDocPermissions', doc) >>> 0,
      signatureCount: rawCall(m, 'FPDF_GetSignatureCount', doc),
    };
  },

  memory: () => ({ wasmBytes: mod ? (wasmMemory(mod)?.buffer.byteLength ?? 0) : 0 }),
});
