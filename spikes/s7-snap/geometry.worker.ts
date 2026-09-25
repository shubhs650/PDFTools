// M0-S7 Work-worker role: PDFium geometry extraction + grid index. It can
// answer snap queries itself ("work" route) and hands a copy of each page
// index to the pure-JS snap worker ("snap" route), zero-copy via transfer.

import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { serve, type CallContext } from '../s3-two-engines/rpc.ts';
import { extractPage } from './extract.ts';
import { buildGrid, snap, type GridIndex } from './snap-core.ts';

let mod: WrappedPdfiumModule | undefined;
let doc: { ptr: number; buf: number; pages: number } | undefined;
const indexes = new Map<number, GridIndex>();
let seen = new Uint32Array(1);
let stamp = 0;
type F = (...a: (number | string)[]) => number;
const call = (n: string, ...a: (number | string)[]): number =>
  (mod as unknown as Record<string, F>)[n]?.(...a) ?? 0;
const r2 = (n: number): number => Math.round(n * 100) / 100;

const handlers = {
  async init(args: { wasmUrl: string }) {
    mod = await init({ wasmBinary: await (await fetch(args.wasmUrl)).arrayBuffer() });
    new PdfiumNative(mod, { fontFallback: null });
    return true;
  },
  open(args: { bytes: ArrayBuffer }) {
    if (!mod) throw new Error('not initialised');
    const em = mod.pdfium as unknown as {
      wasmExports: { malloc(n: number): number; free(p: number): void };
      HEAPU8: Uint8Array;
    };
    if (doc) {
      call('FPDF_CloseDocument', doc.ptr);
      em.wasmExports.free(doc.buf);
    }
    indexes.clear();
    const bytes = new Uint8Array(args.bytes);
    const buf = em.wasmExports.malloc(bytes.length);
    em.HEAPU8.set(bytes, buf);
    const ptr = call('FPDF_LoadMemDocument', buf, bytes.length, '');
    doc = { ptr, buf, pages: call('FPDF_GetPageCount', ptr) };
    return { pages: doc.pages };
  },
  /** Extract + index one page; returns a transferable copy for the snap worker. */
  async extract(args: { page: number; sliceMs?: number }, ctx: CallContext) {
    if (!mod || !doc) throw new Error('no document');
    const { segs, stats } = await extractPage(mod, doc.ptr, args.page, {
      raw: true,
      includeFillOnly: true,
      ...(args.sliceMs === undefined ? {} : { sliceMs: args.sliceMs }),
      signal: ctx.signal,
    });
    const t = performance.now();
    const g = buildGrid(segs);
    const gridMs = performance.now() - t;
    indexes.set(args.page, g);
    if (seen.length < segs.length / 4) seen = new Uint32Array(segs.length / 4);
    const copy = {
      segs: g.segs.slice(),
      cellStart: g.cellStart.slice(),
      items: g.items.slice(),
      x0: g.x0,
      y0: g.y0,
      cell: g.cell,
      cols: g.cols,
      rows: g.rows,
    };
    ctx.transfer([copy.segs.buffer, copy.cellStart.buffer, copy.items.buffer]);
    return {
      page: args.page,
      stats: { ...stats, ms: r2(stats.ms), maxSliceMs: r2(stats.maxSliceMs) },
      gridMs: r2(gridMs),
      index: copy,
    };
  },
  snap(args: { page: number; x: number; y: number; r: number }) {
    const g = indexes.get(args.page);
    return g ? snap(g, args.x, args.y, args.r, 2048, seen, ++stamp) : null;
  },
};

export type GeometryHandlers = typeof handlers;
serve(handlers);
