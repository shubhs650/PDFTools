// Page operations in the Render worker (M4-09 … M4-11, ADR-016 decision 1):
// direct PDFium exports on the open document — rotate (/Rotate, never a
// content rewrite), delete, insert blank, move and import. EmbedPDF's page
// cache is keyed by page index, so it is closed before and after every
// operation (finding 3). Long operations yield between pages so a cancel can
// arrive (rule 2); the caller rolls a cancelled operation back from its undo
// snapshot. The save tracker learns the change (semantic saves, patches
// following their pages).
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { RpcError } from '../../engine/errors';
import { CAPABILITIES, allows } from '../../model/permissions';
import { checkFlattenPlan, flattenOnPage, type FlattenCounts, type FlattenPage } from './flatten';
import { docPtrOf, pageInfos, purgePageCache, rawCall, type PageInfo } from './pdfium';

export type PageOp =
  /** Turn each page by quarter turns clockwise (1) or counterclockwise (3). */
  | { kind: 'rotate'; pages: number[]; quarter: 1 | 2 | 3 }
  | { kind: 'delete'; pages: number[] }
  /** `count` blank pages of `width` × `height` points, the first at index `at`. */
  | { kind: 'insertBlank'; at: number; count: number; width: number; height: number }
  /** Move the pages (in document order) so the first lands at `to` (an index in the result). */
  | { kind: 'move'; pages: number[]; to: number }
  /** Insert pages of another PDF (M4-11), the first at index `at`. */
  | { kind: 'import'; source: ArrayBuffer; password?: string; pages: number[]; at: number }
  /**
   * Flatten comments into page content (M6-09, ADR-021 D-38 c): needs modify
   * and annotate, not assemble (render.worker.ts). Pages keep their identity.
   */
  | { kind: 'flatten'; pages: FlattenPage[] };

export interface PageOpResult {
  pages: PageInfo[];
  /** Old page index → new index (−1: deleted). */
  map: number[];
  /** A flatten's outcome (M6-09). */
  flattened?: FlattenCounts;
}

/** Largest page size PDFium accepts for a new page (ISO 32000: 14,400 units). */
const MAX_SIDE = 14_400;

interface OpContext {
  signal: AbortSignal;
  progress(p: { done: number; total: number }): void;
}

/** Yields to the event loop about every 40 ms, so a cancel message can arrive. */
function yielder(signal: AbortSignal): () => Promise<void> {
  let last = performance.now();
  return async () => {
    if (performance.now() - last < 40) return;
    await new Promise((r) => setTimeout(r, 0));
    last = performance.now();
    if (signal.aborted) throw new RpcError('cancelled', 'The page operation was cancelled');
  };
}

function withInts<T>(mod: WrappedPdfiumModule, xs: readonly number[], fn: (ptr: number) => T): T {
  const heap = mod.pdfium as unknown as {
    wasmExports: { malloc(n: number): number; free(p: number): void };
    setValue(ptr: number, v: number, t: 'i32'): void;
  };
  const ptr = heap.wasmExports.malloc(Math.max(4, xs.length * 4));
  try {
    xs.forEach((x, i) => {
      heap.setValue(ptr + i * 4, x, 'i32');
    });
    return fn(ptr);
  } finally {
    heap.wasmExports.free(ptr);
  }
}

/** Sorted, unique, in-range page indexes; throws on an empty or out-of-range list. */
export function checkPages(pages: readonly number[], count: number): number[] {
  const out = [...new Set(pages)].sort((a, b) => a - b);
  if (out.length === 0) throw new RpcError('pages-empty', 'No pages given');
  for (const p of out)
    if (!Number.isInteger(p) || p < 0 || p >= count)
      throw new RpcError('pages-range', 'A page is out of range');
  return out;
}

export async function applyPageOp(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  docId: string,
  op: PageOp,
  ctx: OpContext,
): Promise<PageOpResult> {
  const doc = docPtrOf(native, docId);
  const count = rawCall(mod, 'FPDF_GetPageCount', doc);
  const before = Array.from({ length: count }, (_, i) =>
    rawCall(mod, 'EPDFDoc_GetPageObjectNumberByIndex', doc, i),
  );
  const pause = yielder(ctx.signal);
  let flattened: FlattenCounts | undefined;
  purgePageCache(native, docId);
  try {
    if (op.kind === 'flatten') {
      const plan = checkFlattenPlan(op.pages, count);
      flattened = { flattened: 0, removed: 0, failed: 0 };
      for (const [i, entry] of plan.entries()) {
        const page = rawCall(mod, 'FPDF_LoadPage', doc, entry.page);
        if (!page) throw new RpcError('page-not-loaded', 'The page could not be loaded');
        try {
          const c = flattenOnPage(mod, page, entry);
          flattened.flattened += c.flattened;
          flattened.removed += c.removed;
          flattened.failed += c.failed;
        } finally {
          rawCall(mod, 'FPDF_ClosePage', page);
        }
        ctx.progress({ done: i + 1, total: plan.length });
        await pause();
      }
    } else if (op.kind === 'rotate') {
      const pages = checkPages(op.pages, count);
      for (const [i, index] of pages.entries()) {
        // FPDFPage_SetRotation needs a loaded page (ADR-016 finding 6).
        const page = rawCall(mod, 'FPDF_LoadPage', doc, index);
        if (!page) throw new RpcError('page-not-loaded', 'The page could not be loaded');
        try {
          const now = rawCall(mod, 'FPDFPage_GetRotation', page);
          rawCall(mod, 'FPDFPage_SetRotation', page, (now + op.quarter) % 4);
        } finally {
          rawCall(mod, 'FPDF_ClosePage', page);
        }
        ctx.progress({ done: i + 1, total: pages.length });
        await pause();
      }
    } else if (op.kind === 'delete') {
      const pages = checkPages(op.pages, count);
      if (pages.length >= count)
        throw new RpcError('pages-last', 'The last page of a document cannot be deleted');
      // From the end, so the remaining indexes stay valid.
      for (const [i, index] of [...pages].reverse().entries()) {
        rawCall(mod, 'FPDFPage_Delete', doc, index);
        ctx.progress({ done: i + 1, total: pages.length });
        await pause();
      }
    } else if (op.kind === 'insertBlank') {
      const { at, width, height } = op;
      if (!Number.isInteger(at) || at < 0 || at > count)
        throw new RpcError('pages-range', 'The position is out of range');
      if (!Number.isInteger(op.count) || op.count < 1 || op.count > 1000)
        throw new RpcError('pages-count', 'The number of pages is out of range');
      if (!(width >= 3 && width <= MAX_SIDE && height >= 3 && height <= MAX_SIDE))
        throw new RpcError('pages-size', 'The page size is out of range');
      for (let i = 0; i < op.count; i++) {
        const page = rawCall(mod, 'FPDFPage_New', doc, at + i, width, height);
        if (!page) throw new RpcError('page-new', 'The page could not be created');
        rawCall(mod, 'FPDF_ClosePage', page);
        ctx.progress({ done: i + 1, total: op.count });
        await pause();
      }
    } else if (op.kind === 'import') {
      if (!Number.isInteger(op.at) || op.at < 0 || op.at > count)
        throw new RpcError('pages-range', 'The position is out of range');
      await withSource(mod, native, op.source, op.password, async (src) => {
        // The order given is kept (a range like "3, 1-2").
        checkPages(op.pages, src.pageCount);
        const pages = op.pages;
        if (!src.fullAccess)
          throw new RpcError('pages-source-restricted', 'The source file is restricted');
        const srcPtr = docPtrOf(native, src.id);
        // In slices, so a cancel can arrive between them (rule 2). PDFium imports
        // a list in ascending order, so a slice that isn't is imported page by page.
        const SLICE = 50;
        for (let i = 0; i < pages.length; i += SLICE) {
          const part = pages.slice(i, i + SLICE);
          const ascending = part.every((p, k) => k === 0 || p > (part[k - 1] ?? -1));
          const runs = ascending ? [part] : part.map((p) => [p]);
          let at = op.at + i;
          for (const run of runs) {
            const ok = withInts(mod, run, (ptr) =>
              rawCall(mod, 'FPDF_ImportPagesByIndex', doc, srcPtr, ptr, run.length, at),
            );
            if (!ok) throw new RpcError('pages-import', 'The pages could not be imported');
            at += run.length;
          }
          ctx.progress({ done: Math.min(pages.length, i + SLICE), total: pages.length });
          await pause();
        }
      });
    } else {
      const pages = checkPages(op.pages, count);
      if (!Number.isInteger(op.to) || op.to < 0 || op.to > count - pages.length)
        throw new RpcError('pages-range', 'The position is out of range');
      const ok = withInts(mod, pages, (ptr) =>
        rawCall(mod, 'FPDF_MovePages', doc, ptr, pages.length, op.to),
      );
      if (!ok) throw new RpcError('pages-move', 'The pages could not be moved');
      ctx.progress({ done: pages.length, total: pages.length });
    }
  } finally {
    purgePageCache(native, docId);
  }
  const pages = pageInfos(mod, native, docId);
  const after = new Map(pages.map((p) => [p.objectNumber, p.index]));
  const map = before.map((obj) => (obj > 0 ? (after.get(obj) ?? -1) : -1));
  return flattened ? { pages, map, flattened } : { pages, map };
}

export interface SourceInfo {
  pageCount: number;
  /** Opened with full access: not encrypted, owner password, or no restrictions (M4-Q2). */
  fullAccess: boolean;
  encrypted: boolean;
}

let sourceSeq = 0;

/**
 * Opens another PDF for an import (M4-11) as a throwaway document, runs `fn`
 * and closes it. A wrong or missing password rejects with `pdfium:4`.
 */
export async function withSource<T>(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  bytes: ArrayBuffer,
  password: string | undefined,
  fn: (src: SourceInfo & { id: string }) => Promise<T> | T,
): Promise<T> {
  const id = `import-${String(++sourceSeq)}`;
  const doc = await native
    .openDocumentBuffer({ id, content: bytes.slice(0) }, password === undefined ? {} : { password })
    .toPromise()
    .catch((err: unknown) => {
      // EmbedPDF rejects with a TaskRejectedError whose reason holds the PdfErrorCode.
      const e = err as { code?: unknown; reason?: { code?: unknown } };
      const code = e.reason?.code ?? e.code;
      throw new RpcError(`pdfium:${String(typeof code === 'number' ? code : 0)}`, 'Not opened');
    });
  try {
    return await fn({ id, ...sourceInfo(mod, native, id), pageCount: doc.pageCount });
  } finally {
    await native.closeDocument(doc).toPromise();
  }
}

/** What M4-Q2 needs to know about a source file. */
export function sourceInfo(mod: WrappedPdfiumModule, native: PdfiumNative, id: string): SourceInfo {
  const ptr = docPtrOf(native, id);
  const revision = rawCall(mod, 'FPDF_GetSecurityHandlerRevision', ptr);
  const permissions = rawCall(mod, 'FPDF_GetDocPermissions', ptr) >>> 0;
  const owner = Boolean(rawCall(mod, 'EPDF_IsOwnerUnlocked', ptr));
  return {
    pageCount: rawCall(mod, 'FPDF_GetPageCount', ptr),
    encrypted: revision >= 0,
    fullAccess:
      revision < 0 || owner || CAPABILITIES.every((c) => allows({ permissions, revision }, c)),
  };
}
