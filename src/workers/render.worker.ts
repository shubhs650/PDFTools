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
import { acquirePage, docPtrOf, rawCall, wasmMemory } from './render/pdfium';
import { renderProgressive } from './render/progressive';
import { SaveTracker, isMutation } from './render/save/tracker';

const FPDF_PAGEOBJ_PATH = 2;

let mod: WrappedPdfiumModule | undefined;
let native: PdfiumNative | undefined;
let tracker: SaveTracker | undefined;

function ready(): { mod: WrappedPdfiumModule; native: PdfiumNative; tracker: SaveTracker } {
  if (!mod || !native || !tracker)
    throw new RpcError('not-initialized', 'The render worker is not initialized');
  return { mod, native, tracker };
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
    tracker = new SaveTracker(mod, native);
    return { ms: performance.now() - t0, wasmBytes: wasmMemory(mod)?.buffer.byteLength ?? 0 };
  },

  exec: async ({ method, args }, ctx) => {
    const { mod: m, native: n, tracker: t } = ready();
    const docId = (args[0] as { id?: unknown } | undefined)?.id;
    // Rule 9: a mutation the document's permissions forbid never reaches PDFium.
    if (isMutation(method) && typeof docId === 'string') t.checkAllowed(method, docId);
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
    // Save bookkeeping (M1-20): the opened bytes' trailer, and what each edit changed.
    if (method === 'openDocumentBuffer') {
      const file = args[0] as { id: string; content: ArrayBuffer };
      t.opened(file.id, new Uint8Array(file.content));
    } else if (method === 'closeDocument' && typeof docId === 'string') {
      t.closed(docId);
    } else if (isMutation(method)) {
      t.recordMutation(method, args);
    }
    return new Transfer(value, transferables(value, wasmMemory(m)?.buffer));
  },

  saveIncremental: ({ docId, keepAll }) => {
    const r = ready().tracker.saveIncremental(docId, keepAll ? { keepAll } : {});
    const tail = r.tail.buffer;
    return new Transfer({ ...r, tail }, [tail]);
  },

  commitSave: ({ docId, tailLength, rewrite }) => ({
    baseLength: ready().tracker.commit(docId, tailLength, rewrite ?? false),
  }),

  snapshotTail: ({ docId }) => {
    const r = ready().tracker.snapshotTail(docId);
    const tail = r.tail.buffer;
    return new Transfer({ tail, baseLength: r.baseLength }, [tail]);
  },

  saveRewrite: ({ docId }) => {
    const bytes = ready().tracker.saveRewrite(docId).buffer;
    return new Transfer({ bytes }, [bytes]);
  },

  saveState: ({ docId }) => ready().tracker.dirtyState(docId),

  docInfo: ({ docId }) => {
    const { mod: m, native: n } = ready();
    const doc = docPtrOf(n, docId);
    return {
      pageCount: rawCall(m, 'FPDF_GetPageCount', doc),
      permissions: rawCall(m, 'FPDF_GetDocPermissions', doc) >>> 0,
      securityRevision: rawCall(m, 'FPDF_GetSecurityHandlerRevision', doc),
      ownerUnlocked: Boolean(rawCall(m, 'EPDF_IsOwnerUnlocked', doc)),
      signatureCount: rawCall(m, 'FPDF_GetSignatureCount', doc),
    };
  },

  contentBox: ({ docId, pageIndex }) => {
    const { mod: m, native: n } = ready();
    const page = rawCall(m, 'FPDF_LoadPage', docPtrOf(n, docId), pageIndex);
    if (!page) throw new RpcError('page-not-loaded', 'The page could not be loaded');
    const buf = m.pdfium.wasmExports.malloc(16);
    try {
      // The visible page area (crop box ∩ media box) gives the top-left origin.
      const heap = m.pdfium as unknown as { getValue(ptr: number, type: 'float'): number };
      const f = (i: number): number => heap.getValue(buf + 4 * i, 'float');
      if (!rawCall(m, 'FPDF_GetPageBoundingBox', page, buf)) return null;
      const pageLeft = f(0);
      const pageTop = f(1);
      let left = Infinity;
      let bottom = Infinity;
      let right = -Infinity;
      let top = -Infinity;
      const count = rawCall(m, 'FPDFPage_CountObjects', page);
      for (let i = 0; i < count; i++) {
        const obj = rawCall(m, 'FPDFPage_GetObject', page, i);
        if (!obj || !rawCall(m, 'FPDFPageObj_GetBounds', obj, buf, buf + 4, buf + 8, buf + 12))
          continue;
        left = Math.min(left, f(0));
        bottom = Math.min(bottom, f(1));
        right = Math.max(right, f(2));
        top = Math.max(top, f(3));
      }
      if (!(right > left) || !(top > bottom)) return null;
      return {
        left: left - pageLeft,
        top: pageTop - top,
        right: right - pageLeft,
        bottom: pageTop - bottom,
      };
    } finally {
      m.pdfium.wasmExports.free(buf);
      rawCall(m, 'FPDF_ClosePage', page);
    }
  },

  pageCost: ({ docId, pageIndex }) => {
    const { mod: m, native: n } = ready();
    const page = acquirePage(n, docId, pageIndex);
    try {
      const objects = rawCall(m, 'FPDFPage_CountObjects', page.pagePtr);
      let segments = 0;
      for (let i = 0; i < objects; i++) {
        const obj = rawCall(m, 'FPDFPage_GetObject', page.pagePtr, i);
        if (obj && rawCall(m, 'FPDFPageObj_GetType', obj) === FPDF_PAGEOBJ_PATH)
          segments += Math.max(0, rawCall(m, 'FPDFPath_CountSegments', obj));
      }
      return { objects, segments };
    } finally {
      page.release();
    }
  },

  renderProgressive: async ({ docId, pageIndex, scale, sliceMs }, ctx) => {
    const { mod: m, native: n } = ready();
    const page = acquirePage(n, docId, pageIndex);
    try {
      const size = {
        width: rawCall(m, 'FPDF_GetPageWidthF', page.pagePtr),
        height: rawCall(m, 'FPDF_GetPageHeightF', page.pagePtr),
      };
      const out = await renderProgressive(m, page.pagePtr, size, scale, ctx.signal, sliceMs);
      ctx.progress({ slices: out.slices });
      return new Transfer(out, [out.data.buffer]);
    } finally {
      page.release();
    }
  },

  memory: () => ({ wasmBytes: mod ? (wasmMemory(mod)?.buffer.byteLength ?? 0) : 0 }),
});
