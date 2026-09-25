// Direct access to the PDFium WASM module and EmbedPDF's private document cache
// (ADR-001 B14, ADR-005 decision 4). This is the ONLY file that reaches into
// PdfiumNative's internals; tests/engine/pdfium-access.test.ts fails loudly if
// EmbedPDF (pinned at 2.15.1) changes them.
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';

interface PageRef {
  pagePtr: number;
  release(): void;
}

interface NativeInternals {
  cache?: {
    getContext(id: string): { docPtr: number; acquirePage?(index: number): PageRef } | undefined;
  };
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

/**
 * A page from EmbedPDF's own page cache (the same `FPDF_PAGE` its renders
 * use, so a heavy page is parsed once). Hold it with `release()` in a
 * `finally`; the cache closes the page after its TTL once released.
 */
export function acquirePage(native: PdfiumNative, docId: string, pageIndex: number): PageRef {
  const ctx = (native as unknown as NativeInternals).cache?.getContext(docId);
  if (!ctx) throw new Error('Document is not open');
  if (typeof ctx.acquirePage !== 'function') {
    throw new Error('EmbedPDF internals changed: context.acquirePage is missing');
  }
  const ref = ctx.acquirePage(pageIndex);
  if (typeof ref.pagePtr !== 'number' || ref.pagePtr === 0 || typeof ref.release !== 'function') {
    throw new Error('EmbedPDF internals changed: page context has no pagePtr/release');
  }
  return ref;
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

interface WideHeap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  stringToUTF16(s: string, ptr: number, maxBytes: number): number;
}

/** Calls `fn` with a NUL-terminated UTF-16LE copy of `s` on the WASM heap (FPDF_WIDESTRING). */
export function withWideString<T>(mod: WrappedPdfiumModule, s: string, fn: (ptr: number) => T): T {
  const heap = mod.pdfium as unknown as WideHeap;
  const bytes = (s.length + 1) * 2;
  const ptr = heap.wasmExports.malloc(bytes);
  try {
    heap.stringToUTF16(s, ptr, bytes);
    return fn(ptr);
  } finally {
    heap.wasmExports.free(ptr);
  }
}
