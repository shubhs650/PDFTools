// M0-S4 Work-worker stand-in: PDF Oxide WASM in a module worker under the
// §10.1 CSP. The WASM is self-hosted and passed as an explicit URL, so the
// glue's own `new URL(…, import.meta.url)` default is never used. Per-page
// loops yield between pages so a cancel message is honored (CLAUDE.md rule 2).

import initOxide, { WasmPdfDocument } from 'pdf-oxide-wasm/web';
import { makeYielder, serve, type CallContext } from '../s3-two-engines/rpc.ts';

let memory: WebAssembly.Memory | undefined;
let doc: WasmPdfDocument | undefined;
const r1 = (n: number): number => Math.round(n * 10) / 10;
const memMB = (): number => r1((memory?.buffer.byteLength ?? 0) / 1e6);

const handlers = {
  async init(a: { wasmUrl: string }): Promise<{ initMs: number; memMB: number }> {
    const t0 = performance.now();
    const out = await initOxide({ module_or_path: a.wasmUrl });
    memory = out.memory;
    return { initMs: r1(performance.now() - t0), memMB: memMB() };
  },
  open(a: { bytes: ArrayBuffer }): { pages: number; openMs: number } {
    doc?.free();
    const t0 = performance.now();
    doc = new WasmPdfDocument(new Uint8Array(a.bytes));
    return { pages: doc.pageCount(), openMs: r1(performance.now() - t0) };
  },
  async extract(
    a: { mode: 'text' | 'markdown'; from?: number; to?: number },
    ctx: CallContext,
  ): Promise<{
    pages: number;
    ms: number;
    pagesPerSec: number;
    maxPageMs: number;
    chars: number;
    memMB: number;
  }> {
    if (!doc) throw new Error('no document');
    const d = doc;
    const from = a.from ?? 0;
    const to = Math.min(a.to ?? d.pageCount(), d.pageCount());
    const yieldNow = makeYielder(8);
    const t0 = performance.now();
    let max = 0;
    let chars = 0;
    let lastProgress = t0;
    for (let p = from; p < to; p++) {
      await yieldNow(ctx.signal);
      const tp = performance.now();
      chars += (a.mode === 'text' ? d.toPlainText(p) : d.toMarkdown(p, true, false, false)).length;
      max = Math.max(max, performance.now() - tp);
      if (performance.now() - lastProgress > 100) {
        lastProgress = performance.now();
        ctx.progress({ done: p + 1 - from, total: to - from });
      }
    }
    const ms = performance.now() - t0;
    const pages = to - from;
    return {
      pages,
      ms: Math.round(ms),
      pagesPerSec: Math.round(pages / (ms / 1000)),
      maxPageMs: r1(max),
      chars,
      memMB: memMB(),
    };
  },
  tables(a: { page: number }): { tables: number; firstGrid: string[][] } {
    if (!doc) throw new Error('no document');
    const plain = (v: unknown): unknown =>
      v instanceof Map
        ? Object.fromEntries([...v].map(([k, x]) => [k, plain(x)]))
        : Array.isArray(v)
          ? v.map(plain)
          : v;
    const t = plain(doc.extractTables(a.page)) as { rows: { cells: { text: string }[] }[] }[];
    return { tables: t.length, firstGrid: t[0]?.rows.map((r) => r.cells.map((c) => c.text)) ?? [] };
  },
};

export type OxideHandlers = typeof handlers;
serve(handlers);
