// Search in the Work worker (D-08, D-10, §6, ADR-006). Page text comes from raw
// FPDFText_* on the Work copy's pages (normalized like the viewer's) and is
// cached for the session; matching is searchCore.ts. A search runs pages in
// viewport order, yields at every page (scheduler checkpoint: cancel and
// higher-priority work get in), and streams batches at most every 50 ms.
// At most `detailLimit` hits (5,000) are sent with context; beyond that only
// per-page counts, and the exact total (ADR-006 decision 2).
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { PdfDocumentObject } from '@embedpdf/models';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { RpcError } from '../../engine/errors';
import { acquirePage, rawCall } from '../render/pdfium';
import type { JobSlice } from './scheduler';
import {
  Batcher,
  QueryError,
  compileQuery,
  countInPage,
  findInPage,
  searchOrder,
  type Hit,
  type SearchOptions,
} from './searchCore';

export const DETAIL_LIMIT = 5000;
export const BATCH_MS = 50;

export interface SearchRequest {
  docId: string;
  /** Chosen by the caller; every batch carries it, so stale batches can be dropped. */
  searchId: number;
  query: string;
  options: SearchOptions;
  /** Pages in view: searched first (§6). */
  visible: number[];
  detailLimit?: number;
}

export interface SearchBatch {
  searchId: number;
  /** Hits with context (only while under the detail limit). */
  hits: Hit[];
  /** [page, count] of hits beyond the detail limit. */
  counts: [number, number][];
  pagesDone: number;
  pageCount: number;
}

export interface SearchSummary {
  searchId: number;
  totalHits: number;
  /** Hits sent with context (≤ detailLimit). */
  detailedHits: number;
  pageCount: number;
  ms: number;
  /** From the start of the search to the first page with a hit (null: none). */
  firstHitMs: number | null;
}

/** Top-left page coordinates in points (the viewer's unrotated page space). */
export interface HitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  HEAPU8: Uint8Array;
  HEAPF64: Float64Array;
}

/** Page text per document, for the session only (ADR-006 decision 4: never persisted). */
export class TextCache {
  private readonly docs = new Map<string, Map<number, string>>();

  get(docId: string, page: number): string | undefined {
    return this.docs.get(docId)?.get(page);
  }

  set(docId: string, page: number, text: string): void {
    let m = this.docs.get(docId);
    if (!m) {
      m = new Map();
      this.docs.set(docId, m);
    }
    m.set(page, text);
  }

  pages(docId: string): number {
    return this.docs.get(docId)?.size ?? 0;
  }

  drop(docId: string): void {
    this.docs.delete(docId);
  }
}

/** Runs `fn` with the page's FPDF_TEXTPAGE (and its page pointer). */
function withTextPage<T>(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  doc: PdfDocumentObject,
  pageIndex: number,
  fn: (textPage: number, pagePtr: number) => T,
): T {
  const page = acquirePage(native, doc.id, pageIndex);
  try {
    const tp = rawCall(mod, 'FPDFText_LoadPage', page.pagePtr);
    if (!tp) throw new RpcError('text-page-failed', 'The page text could not be loaded');
    try {
      return fn(tp, page.pagePtr);
    } finally {
      rawCall(mod, 'FPDFText_ClosePage', tp);
    }
  } finally {
    page.release();
  }
}

/** A page's text as PDFium extracts it (UTF-16; string index = char index for BMP text). */
export function extractPageText(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  doc: PdfDocumentObject,
  pageIndex: number,
): string {
  return withTextPage(mod, native, doc, pageIndex, (tp) => {
    const n = rawCall(mod, 'FPDFText_CountChars', tp);
    if (n <= 0) return '';
    const heap = mod.pdfium as unknown as Heap;
    const buf = heap.wasmExports.malloc((n + 1) * 2);
    try {
      const written = rawCall(mod, 'FPDFText_GetText', tp, 0, n, buf);
      // HEAPU8 is read after the call: the heap may have grown meanwhile.
      const bytes = heap.HEAPU8.subarray(buf, buf + Math.max(0, written - 1) * 2);
      return new TextDecoder('utf-16le').decode(bytes);
    } finally {
      heap.wasmExports.free(buf);
    }
  });
}

export class SearchEngine {
  readonly cache = new TextCache();
  private readonly mod: () => WrappedPdfiumModule;
  private readonly native: () => PdfiumNative;

  constructor(mod: () => WrappedPdfiumModule, native: () => PdfiumNative) {
    this.mod = mod;
    this.native = native;
  }

  text(docId: string, doc: PdfDocumentObject, page: number): string {
    const cached = this.cache.get(docId, page);
    if (cached !== undefined) return cached;
    const text = extractPageText(this.mod(), this.native(), doc, page);
    this.cache.set(docId, page, text);
    return text;
  }

  /** One search, streamed through `emit` (ctx.stream). Cancellable at every page. */
  async search(
    req: SearchRequest,
    doc: PdfDocumentObject,
    slice: JobSlice,
    emit: (batch: SearchBatch) => void,
  ): Promise<SearchSummary> {
    const t0 = performance.now();
    const re = compileOrThrow(req.query, req.options);
    const limit = req.detailLimit ?? DETAIL_LIMIT;
    const pageCount = doc.pageCount;
    let pagesDone = 0;
    let total = 0;
    let detailed = 0;
    let firstHitMs: number | null = null;
    let counts: [number, number][] = [];
    const batcher = new Batcher<Hit>((hits) => {
      emit({ searchId: req.searchId, hits, counts, pagesDone, pageCount });
      counts = [];
    }, BATCH_MS);
    for (const page of searchOrder(pageCount, req.visible)) {
      await slice.checkpoint();
      const text = this.text(req.docId, doc, page);
      const room = limit - detailed;
      const hits = room > 0 ? findInPage(text, page, re, 40, room) : [];
      // Exact count: the rest of the page past the room, counted without context.
      const n = hits.length < room ? hits.length : countInPage(text, re);
      pagesDone++;
      total += n;
      detailed += hits.length;
      if (n > hits.length) counts.push([page, n - hits.length]);
      if (n > 0 && firstHitMs === null) firstHitMs = performance.now() - t0;
      batcher.push(hits);
    }
    batcher.push([], true);
    return {
      searchId: req.searchId,
      totalHits: total,
      detailedHits: detailed,
      pageCount,
      ms: performance.now() - t0,
      firstHitMs,
    };
  }

  /** Hits with context for `pages` (rows past the detail limit, fetched as the list scrolls). */
  async context(
    docId: string,
    doc: PdfDocumentObject,
    query: string,
    options: SearchOptions,
    pages: readonly number[],
    slice: JobSlice,
  ): Promise<Hit[]> {
    const re = compileOrThrow(query, options);
    const out: Hit[] = [];
    for (const page of pages) {
      if (page < 0 || page >= doc.pageCount) continue;
      await slice.checkpoint();
      out.push(...findInPage(this.text(docId, doc, page), page, re));
    }
    return out;
  }

  /** Highlight rectangles per hit on one page (FPDFText_CountRects / GetRect). */
  rects(
    _docId: string,
    doc: PdfDocumentObject,
    pageIndex: number,
    hits: readonly { start: number; length: number }[],
  ): HitRect[][] {
    const mod = this.mod();
    return withTextPage(mod, this.native(), doc, pageIndex, (tp, pagePtr) => {
      const height = rawCall(mod, 'FPDF_GetPageHeightF', pagePtr);
      const heap = mod.pdfium as unknown as Heap;
      const box = heap.wasmExports.malloc(32);
      try {
        return hits.map((h) => {
          // Text (UTF-16) index → PDFium char index, as PDFium defines it: this
          // build indexes UTF-16 code units even for non-BMP characters, so
          // never assume either way (M2-05 finding; ADR-006 "char-index mapping").
          const start = rawCall(mod, 'FPDFText_GetCharIndexFromTextIndex', tp, h.start);
          const last = rawCall(
            mod,
            'FPDFText_GetCharIndexFromTextIndex',
            tp,
            h.start + h.length - 1,
          );
          if (start < 0 || last < start) return [];
          const n = rawCall(mod, 'FPDFText_CountRects', tp, start, last - start + 1);
          const rs: HitRect[] = [];
          for (let i = 0; i < n; i++) {
            rawCall(mod, 'FPDFText_GetRect', tp, i, box, box + 8, box + 16, box + 24);
            const f = heap.HEAPF64;
            const [l, t, r, b] = [0, 1, 2, 3].map((k) => f[(box >> 3) + k] ?? 0) as [
              number,
              number,
              number,
              number,
            ];
            rs.push({ x: l, y: height - t, width: r - l, height: t - b });
          }
          return rs;
        });
      } finally {
        heap.wasmExports.free(box);
      }
    });
  }
}

/** A query error crosses as a code the UI can explain (no message text, rule 10). */
function compileOrThrow(query: string, options: SearchOptions): RegExp {
  try {
    return compileQuery(query, options);
  } catch (err) {
    if (err instanceof QueryError) throw new RpcError(err.code, err.code);
    throw err;
  }
}
