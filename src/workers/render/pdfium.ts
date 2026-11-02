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

interface ContextInternals {
  docPtr: number;
  normalizeRotation?: boolean;
  filePtr?: number;
  acquirePage?(index: number): PageRef;
  pageCache?: { forceReleaseAll?(): void };
}

interface NativeInternals {
  cache?: {
    getContext(id: string): ContextInternals | undefined;
  };
  readPageBoxes?(docPtr: number, index: number, boxPtr: number): unknown;
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

/**
 * The bytes PDFium opened the document from, as a view on the WASM heap (no
 * copy): EmbedPDF keeps the buffer for the document's lifetime and PDFium
 * never writes to it. The view is detached if the heap grows, so callers use
 * it within one synchronous run (microtasks only) and check `byteLength`.
 */
export function openedBytes(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  docId: string,
  length: number,
): Uint8Array {
  const ctx = (native as unknown as NativeInternals).cache?.getContext(docId);
  if (!ctx) throw new Error('Document is not open');
  if (typeof ctx.filePtr !== 'number' || ctx.filePtr === 0) {
    throw new Error('EmbedPDF internals changed: context.filePtr is not a pointer');
  }
  const heap = (mod.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8;
  return heap.subarray(ctx.filePtr, ctx.filePtr + length);
}

/**
 * Closes every page EmbedPDF has cached for the document (ADR-016 finding 3):
 * its page cache is keyed by page index, so after a page operation a cached
 * `FPDF_PAGE` would be the wrong page. Called before and after each operation.
 */
export function purgePageCache(native: PdfiumNative, docId: string): void {
  const ctx = (native as unknown as NativeInternals).cache?.getContext(docId) as
    (ContextInternals & { pageCache?: { forceReleaseAll?(): void } }) | undefined;
  if (!ctx) throw new Error('Document is not open');
  const cache = ctx.pageCache;
  if (typeof cache?.forceReleaseAll !== 'function') {
    throw new Error('EmbedPDF internals changed: pageCache.forceReleaseAll is missing');
  }
  cache.forceReleaseAll();
}

export interface PageInfo {
  index: number;
  size: { width: number; height: number };
  rotation: 0 | 1 | 2 | 3;
  objectNumber: number;
  boxes?: unknown;
}

/**
 * The page list as EmbedPDF's openDocumentBuffer builds it (unnormalized
 * rotation, as the Render worker opens documents): size, rotation, page
 * object number and boxes, read after a page operation (ADR-016 decision 6).
 */
export function pageInfos(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  docId: string,
): PageInfo[] {
  const internals = native as unknown as NativeInternals;
  const docPtr = docPtrOf(native, docId);
  const heap = mod.pdfium as unknown as {
    wasmExports: { malloc(n: number): number; free(p: number): void };
    getValue(ptr: number, type: 'float'): number;
  };
  const count = rawCall(mod, 'FPDF_GetPageCount', docPtr);
  // The document manager opens documents with normalized rotation: sizes unrotated.
  const normalized = isNormalized(native, docId);
  const size = heap.wasmExports.malloc(8);
  const box = heap.wasmExports.malloc(16);
  const out: PageInfo[] = [];
  try {
    for (let index = 0; index < count; index++) {
      const read = normalized ? 'EPDF_GetPageSizeByIndexNormalized' : 'FPDF_GetPageSizeByIndexF';
      if (!rawCall(mod, read, docPtr, index, size))
        throw new Error(`page ${String(index)} has no size`);
      const page: PageInfo = {
        index,
        size: { width: heap.getValue(size, 'float'), height: heap.getValue(size + 4, 'float') },
        rotation: (rawCall(mod, 'EPDF_GetPageRotationByIndex', docPtr, index) & 3) as 0 | 1 | 2 | 3,
        objectNumber: rawCall(mod, 'EPDFDoc_GetPageObjectNumberByIndex', docPtr, index),
      };
      if (typeof internals.readPageBoxes === 'function')
        page.boxes = internals.readPageBoxes.call(native, docPtr, index, box);
      out.push(page);
    }
  } finally {
    heap.wasmExports.free(size);
    heap.wasmExports.free(box);
  }
  return out;
}

/** Whether EmbedPDF opened the document with normalized rotation (a reopen keeps it). */
export function isNormalized(native: PdfiumNative, docId: string): boolean {
  const ctx = (native as unknown as NativeInternals).cache?.getContext(docId);
  if (!ctx) throw new Error('Document is not open');
  return ctx.normalizeRotation === true;
}

/** Rect in PDF page space, as PDFium stores /Rect. */
export interface PageSpaceRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * PdfiumNative's private annotation writers (M6-10, ADR-022 decision 1): the
 * helpers its own create/update use, so an annotation EmbedPDF can't create
 * (FileAttachment) gets the same /Rect conversion, colour and base keys
 * (/T, /Contents, /Subj, /M, /CreationDate, /F, /IRT, /RT) as every other.
 */
export interface AnnotWriter {
  /** Device rect (top-left, points) → /Rect, as EmbedPDF converts it. */
  setRect(doc: unknown, page: unknown, annot: number, rect: unknown): boolean;
  readRect(annot: number): PageSpaceRect;
  /** `#RRGGBB` → /C. */
  setColor(annot: number, hex: string): boolean;
  /** PdfAnnotationName → /Name. */
  setIcon(annot: number, name: number): boolean;
  applyBase(doc: unknown, page: unknown, pagePtr: number, annot: number, object: unknown): boolean;
  /** The page's annotation with this /NM (0: none); the caller closes it. */
  byName(pagePtr: number, id: string): number;
  removeByName(pagePtr: number, id: string): boolean;
}

type Fn = (...a: unknown[]) => unknown;

export function annotWriter(native: PdfiumNative): AnnotWriter {
  const n = native as unknown as Record<string, Fn | undefined>;
  const get = (name: string): Fn => {
    const f = n[name];
    if (typeof f !== 'function')
      throw new Error(`EmbedPDF internals changed: PdfiumNative.${name} is missing`);
    return f.bind(native);
  };
  const setRect = get('setPageAnnoRect');
  const readRect = get('readPageAnnoRect');
  const setColor = get('setAnnotationColor');
  const setIcon = get('setAnnotationName');
  const applyBase = get('applyBaseAnnotationProperties');
  const byName = get('getAnnotationByName');
  const removeByName = get('removeAnnotationByName');
  return {
    setRect: (doc, page, annot, rect) => Boolean(setRect(doc, page, annot, rect)),
    readRect: (annot) => readRect(annot) as PageSpaceRect,
    setColor: (annot, hex) => Boolean(setColor(annot, hex, 0)),
    setIcon: (annot, name) => Boolean(setIcon(annot, name)),
    applyBase: (doc, page, pagePtr, annot, object) =>
      Boolean(applyBase(doc, page, pagePtr, annot, object)),
    byName: (pagePtr, id) => Number(byName(pagePtr, id)),
    removeByName: (pagePtr, id) => Boolean(removeByName(pagePtr, id)),
  };
}
