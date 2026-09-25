// Direct access to the PDFium WASM module and EmbedPDF's private document cache
// (ADR-001 B14, ADR-005 decision 4). This is the ONLY file that reaches into
// PdfiumNative's internals; tests/engine/pdfium-access.test.ts fails loudly if
// EmbedPDF (pinned at 2.15.1) changes them.
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';

interface NativeInternals {
  cache?: { getContext(id: string): { docPtr: number } | undefined };
}

/** PDFium `FPDF_DOCUMENT` pointer of an open EmbedPDF document. */
export function docPtrOf(native: PdfiumNative, docId: string): number {
  const cache = (native as unknown as NativeInternals).cache;
  if (!cache || typeof cache.getContext !== 'function') {
    throw new Error('EmbedPDF internals changed: PdfiumNative.cache.getContext is missing');
  }
  const ctx = cache.getContext(docId);
  if (!ctx) throw new Error('Document is not open');
  if (typeof ctx.docPtr !== 'number' || ctx.docPtr === 0) {
    throw new Error('EmbedPDF internals changed: context.docPtr is not a pointer');
  }
  return ctx.docPtr;
}

type RawFn = (...args: (number | string)[]) => number;

/** Calls a raw PDFium export by name (e.g. `FPDF_GetSignatureCount`). */
export function rawCall(
  mod: WrappedPdfiumModule,
  name: string,
  ...args: (number | string)[]
): number {
  const fn = (mod as unknown as Record<string, RawFn | undefined>)[name];
  if (typeof fn !== 'function') throw new Error(`PDFium export ${name} is missing`);
  return fn(...args);
}

/** `WebAssembly.Memory` of the module, for memory probes (ADR-004 decision 4). */
export function wasmMemory(mod: WrappedPdfiumModule): WebAssembly.Memory | undefined {
  return (mod.pdfium.wasmExports as unknown as { memory?: WebAssembly.Memory }).memory;
}
