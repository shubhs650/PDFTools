// M0-S5 Work worker: search (D-08, D-10, ARCHITECTURE §6). Its own PDFium
// instance; text is extracted per page with FPDFText_* straight from the WASM
// module (string index == PDFium char index, so hits map to rects), cached for
// the session, searched in viewport order, streamed in ≥50 ms batches, and
// cancellable between pages.

import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { PdfDocumentObject } from '@embedpdf/models';
import { makeYielder, serve, type CallContext } from '../s3-two-engines/rpc.ts';
import {
  Batcher,
  compileQuery,
  findInPage,
  searchOrder,
  type Hit,
  type SearchOptions,
} from './search-core.ts';

type Fn = (...a: (number | string)[]) => number;
interface Em {
  wasmExports: { malloc(n: number): number; free(p: number): void; memory?: WebAssembly.Memory };
  HEAPU8: Uint8Array;
  HEAPF64: Float64Array;
}

let mod: WrappedPdfiumModule | undefined;
let native: PdfiumNative | undefined;
let doc: { ptr: number; buf: number; pages: number; sizes: [number, number][] } | undefined;
let nativeDoc: PdfDocumentObject | undefined;
const textCache = new Map<number, string>();

const em = (): Em => (mod as unknown as { pdfium: Em }).pdfium;
const call = (name: string, ...a: (number | string)[]): number => {
  const f = (mod as unknown as Record<string, Fn | undefined>)[name];
  if (!f) throw new Error(`missing ${name}`);
  return f(...a);
};
const r1 = (n: number): number => Math.round(n * 10) / 10;

function pageText(p: number): string {
  const cached = textCache.get(p);
  if (cached !== undefined) return cached;
  if (!doc) throw new Error('no document');
  const page = call('FPDF_LoadPage', doc.ptr, p);
  const tp = call('FPDFText_LoadPage', page);
  const n = call('FPDFText_CountChars', tp);
  let text = '';
  if (n > 0) {
    const e = em();
    const buf = e.wasmExports.malloc((n + 1) * 2);
    const written = call('FPDFText_GetText', tp, 0, n, buf);
    text = new TextDecoder('utf-16le').decode(
      e.HEAPU8.subarray(buf, buf + Math.max(0, written - 1) * 2),
    );
    e.wasmExports.free(buf);
  }
  call('FPDFText_ClosePage', tp);
  call('FPDF_ClosePage', page);
  textCache.set(p, text);
  return text;
}

function closeDoc(): void {
  if (doc) {
    call('FPDF_CloseDocument', doc.ptr);
    em().wasmExports.free(doc.buf);
  }
  doc = undefined;
  textCache.clear();
}

const handlers = {
  async init(args: { wasmUrl: string }) {
    const wasmBinary = await (await fetch(args.wasmUrl)).arrayBuffer();
    mod = await init({ wasmBinary });
    native = new PdfiumNative(mod, { fontFallback: null }); // also initialises the library
    return true;
  },

  async open(args: { bytes: ArrayBuffer }) {
    if (!native) throw new Error('not initialised');
    closeDoc();
    const t0 = performance.now();
    const bytes = new Uint8Array(args.bytes);
    const e = em();
    const buf = e.wasmExports.malloc(bytes.length);
    e.HEAPU8.set(bytes, buf);
    const ptr = call('FPDF_LoadMemDocument', buf, bytes.length, '');
    if (!ptr) throw new Error('FPDF_LoadMemDocument failed');
    const pages = call('FPDF_GetPageCount', ptr);
    const sizes: [number, number][] = [];
    const wh = e.wasmExports.malloc(16);
    for (let i = 0; i < pages; i++) {
      call('FPDF_GetPageSizeByIndex', ptr, i, wh, wh + 8);
      sizes.push([e.HEAPF64[wh >> 3] ?? 0, e.HEAPF64[(wh >> 3) + 1] ?? 0]);
    }
    e.wasmExports.free(wh);
    doc = { ptr, buf, pages, sizes };
    // Separate EmbedPDF handle for the PDFium-native search baseline only.
    if (nativeDoc) await native.closeDocument(nativeDoc).toPromise();
    nativeDoc = await native
      .openDocumentBuffer({ id: `n-${String(Date.now())}`, content: bytes.slice().buffer })
      .toPromise();
    return { pages, ms: r1(performance.now() - t0) };
  },

  /** Advanced Search: streams { id, hits, done } batches via progress. */
  async search(
    args: {
      id: number;
      query: string;
      opts: SearchOptions;
      visible: number[];
      /** Hits beyond this are streamed as per-page counts (context fetched lazily). */
      detailLimit?: number;
    },
    ctx: CallContext,
  ) {
    if (!doc) throw new Error('no document');
    const t0 = performance.now();
    const re = compileQuery(args.query, args.opts);
    const tick = makeYielder(8);
    let done = 0;
    let total = 0;
    let extracted = 0;
    let firstHitMs: number | null = null;
    let maxPageMs = 0;
    const detailLimit = args.detailLimit ?? 5000;
    let detailed = 0;
    let counts = new Map<number, number>();
    const batcher = new Batcher<Hit>((hits) => {
      ctx.progress({ id: args.id, hits, counts: [...counts], done });
      counts = new Map();
    }, 50);
    for (const p of searchOrder(doc.pages, args.visible)) {
      await tick(ctx.signal);
      const tp = performance.now();
      if (!textCache.has(p)) extracted++;
      const hits = findInPage(pageText(p), p, re);
      maxPageMs = Math.max(maxPageMs, performance.now() - tp);
      done++;
      total += hits.length;
      if (hits.length && firstHitMs === null) firstHitMs = performance.now() - t0;
      const room = Math.max(0, detailLimit - detailed);
      const detail = hits.length <= room ? hits : hits.slice(0, room);
      detailed += detail.length;
      if (hits.length > detail.length)
        counts.set(p, (counts.get(p) ?? 0) + hits.length - detail.length);
      batcher.push(detail);
    }
    batcher.push([], true);
    return {
      id: args.id,
      totalHits: total,
      pages: doc.pages,
      extractedPages: extracted,
      ms: r1(performance.now() - t0),
      firstHitWorkerMs: firstHitMs === null ? null : r1(firstHitMs),
      maxPageMs: r1(maxPageMs),
    };
  },

  /** Highlight rects (top-left page coordinates) for hits on one page. */
  rects(args: { page: number; hits: { start: number; length: number }[] }) {
    if (!doc) throw new Error('no document');
    const t0 = performance.now();
    const height = doc.sizes[args.page]?.[1] ?? 0;
    const page = call('FPDF_LoadPage', doc.ptr, args.page);
    const tp = call('FPDFText_LoadPage', page);
    const e = em();
    const box = e.wasmExports.malloc(32);
    const out = args.hits.map((h) => {
      const n = call('FPDFText_CountRects', tp, h.start, h.length);
      const rs: [number, number, number, number][] = [];
      for (let i = 0; i < n; i++) {
        call('FPDFText_GetRect', tp, i, box, box + 8, box + 16, box + 24);
        const [l, t, r, b] = [0, 1, 2, 3].map((k) => e.HEAPF64[(box >> 3) + k] ?? 0);
        rs.push([l ?? 0, height - (t ?? 0), (r ?? 0) - (l ?? 0), (t ?? 0) - (b ?? 0)]);
      }
      return rs;
    });
    e.wasmExports.free(box);
    call('FPDFText_ClosePage', tp);
    call('FPDF_ClosePage', page);
    return { rects: out, ms: r1(performance.now() - t0) };
  },

  /** Baseline: PDFium's own FPDFText_Find over all pages (EmbedPDF searchBatch). */
  async nativeSearch(args: { query: string }) {
    if (!native || !nativeDoc) throw new Error('no document');
    const t0 = performance.now();
    const res = (await native
      .searchBatch(nativeDoc, nativeDoc.pages, args.query, 0)
      .toPromise()) as Record<number, unknown[]>;
    const total = Object.values(res).reduce((n, r) => n + r.length, 0);
    return { totalHits: total, ms: r1(performance.now() - t0) };
  },

  cacheInfo() {
    return {
      cachedPages: textCache.size,
      chars: [...textCache.values()].reduce((n, t) => n + t.length, 0),
      wasmBytes: em().wasmExports.memory?.buffer.byteLength ?? null,
    };
  },

  clearCache() {
    textCache.clear();
    return true;
  },
};

export type SearchHandlers = typeof handlers;
serve(handlers);
