// Work worker (D-10): a second, independent PDFium instance driven directly
// through EmbedPDF's PdfiumNative executor, behind our own typed RPC.

import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { PdfDocumentObject } from '@embedpdf/models';
import { makeYielder, serve, type CallContext } from './rpc.ts';

let mod: WrappedPdfiumModule | undefined;
let native: PdfiumNative | undefined;
const docs = new Map<string, PdfDocumentObject>();

function wasmBytes(): number {
  return (
    (mod?.pdfium.wasmExports as unknown as { memory?: WebAssembly.Memory } | undefined)?.memory
      ?.buffer.byteLength ?? 0
  );
}

function need(): PdfiumNative {
  if (!native) throw new Error('not initialised');
  return native;
}

const handlers = {
  async init(args: { wasmUrl: string }) {
    const t0 = performance.now();
    const wasmBinary = await (await fetch(args.wasmUrl)).arrayBuffer();
    mod = await init({ wasmBinary });
    native = new PdfiumNative(mod, { fontFallback: null });
    return { ms: performance.now() - t0, wasmBytes: wasmBytes() };
  },

  async open(args: { docId: string; bytes: ArrayBuffer }) {
    const t0 = performance.now();
    const doc = await need()
      .openDocumentBuffer({ id: args.docId, content: args.bytes })
      .toPromise();
    docs.set(args.docId, doc);
    return { ms: performance.now() - t0, pageCount: doc.pageCount, wasmBytes: wasmBytes() };
  },

  async close(args: { docId: string }) {
    const doc = docs.get(args.docId);
    if (doc) await need().closeDocument(doc).toPromise();
    docs.delete(args.docId);
    return { wasmBytes: wasmBytes() };
  },

  memory() {
    return { wasmBytes: wasmBytes() };
  },

  /** Full-text extraction, page by page; cancellable between pages. */
  async extractAll(args: { docId: string }, ctx: CallContext) {
    const doc = docs.get(args.docId);
    if (!doc) throw new Error('unknown doc');
    const n = need();
    const tick = makeYielder(8);
    const t0 = performance.now();
    let chars = 0;
    let lastProgress = 0;
    let maxPageMs = 0;
    for (let i = 0; i < doc.pageCount; i++) {
      await tick(ctx.signal);
      const tp = performance.now();
      const text = String(await n.extractText(doc, [i]).toPromise());
      chars += text.length;
      maxPageMs = Math.max(maxPageMs, performance.now() - tp);
      if (performance.now() - lastProgress > 100) {
        ctx.progress({ done: i + 1, total: doc.pageCount });
        lastProgress = performance.now();
      }
    }
    const ms = performance.now() - t0;
    return { ms, pages: doc.pageCount, chars, pagesPerSec: doc.pageCount / (ms / 1000), maxPageMs };
  },
};

export type WorkHandlers = typeof handlers;
serve(handlers);
