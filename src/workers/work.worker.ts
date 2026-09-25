// Work worker (ARCHITECTURE §3.1, D-10, ADR-004 decision 1): a second,
// independent PDFium instance with read-only copies of the open documents.
// Jobs run through a cooperative priority scheduler (scheduler.ts) and yield
// between pages, so cancellation and higher-priority work get in (rule 2).
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { RpcError } from '../engine/errors';
import type { WorkApi } from '../engine/workApi';
import { serve } from './rpc-host';
import { wasmMemory } from './render/pdfium';
import { WorkDocs } from './work/docs';
import { Scheduler } from './work/scheduler';

let mod: WrappedPdfiumModule | undefined;
let native: PdfiumNative | undefined;
let peak = 0;

function need(): PdfiumNative {
  if (!native) throw new RpcError('not-initialized', 'The work worker is not initialized');
  return native;
}

function wasmBytes(): number {
  const bytes = mod ? (wasmMemory(mod)?.buffer.byteLength ?? 0) : 0;
  peak = Math.max(peak, bytes);
  return bytes;
}

const docs = new WorkDocs(need);
const scheduler = new Scheduler();

serve<WorkApi>(self, {
  init: async ({ wasmUrl }) => {
    const t0 = performance.now();
    const wasmBinary = await (await fetch(wasmUrl)).arrayBuffer();
    mod = await init({ wasmBinary });
    // No fallback fonts: the Work worker never renders text for display (rule 4).
    native = new PdfiumNative(mod, { fontFallback: null });
    return { ms: performance.now() - t0, wasmBytes: wasmBytes() };
  },

  open: async ({ docId, original, tail, password }) => {
    const doc = await docs.open(docId, original, tail, password);
    return { pageCount: doc.pageCount, wasmBytes: wasmBytes() };
  },

  refresh: ({ docId, tail }) => ({ pending: docs.refresh(docId, tail) }),

  close: async ({ docId }) => {
    await docs.close(docId);
    return { wasmBytes: wasmBytes() };
  },

  memory: () => ({ wasmBytes: wasmBytes(), peakWasmBytes: peak }),

  docState: ({ docId, priority = 'interactive' }, ctx) =>
    scheduler.run(priority, ctx.signal, async () => {
      const { doc, appliedTailBytes } = await docs.get(docId);
      return { pageCount: doc.pageCount, appliedTailBytes };
    }),

  textStats: ({ docId, priority = 'background' }, ctx) =>
    scheduler.run(priority, ctx.signal, async (slice) => {
      const { doc } = await docs.get(docId);
      const n = need();
      const t0 = performance.now();
      let chars = 0;
      for (const page of doc.pages) {
        await slice.checkpoint();
        const text = String(await n.extractText(doc, [page.index]).toPromise());
        chars += text.length;
        ctx.progress({ done: page.index + 1, total: doc.pageCount });
        wasmBytes();
      }
      return { pages: doc.pageCount, chars, ms: performance.now() - t0 };
    }),
});
