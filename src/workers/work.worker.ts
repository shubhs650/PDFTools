// Work worker (ARCHITECTURE §3.1, D-10, ADR-004 decision 1): a second,
// independent PDFium instance with read-only copies of the open documents.
// Jobs run through a cooperative priority scheduler (scheduler.ts) and yield
// between pages, so cancellation and higher-priority work get in (rule 2).
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { RpcError } from '../engine/errors';
import type { WorkApi } from '../engine/workApi';
import { Transfer } from '../engine/protocol';
import { serve } from './rpc-host';
import { docPtrOf, wasmMemory } from './render/pdfium';
import { digestDocument } from './render/save/digest';
import { WorkDocs } from './work/docs';
import { verifyCandidate } from './work/verify';
import { Scheduler } from './work/scheduler';
import { listAnnotations } from './work/annotations';
import { Activity, indexDocument } from './work/indexer';
import { SearchEngine } from './work/search';
import { listAttachments, readAttachment } from './work/attachments';
import { readFormFacts } from '../model/formFacts';
import { readLayers } from '../model/ocg';
import { flattenCopy } from './work/flatten';
import { pageBox, renderBand } from './work/print';
import { readProperties } from './work/properties';
import { checkSignatures } from './work/signatures';

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

/** zlib inflate (FlateDecode) with the platform's DecompressionStream. */
async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes.slice()]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
const scheduler = new Scheduler();
const activity = new Activity();
const search = new SearchEngine(() => {
  if (!mod) throw new RpcError('not-initialized', 'The work worker is not initialized');
  return mod;
}, need);

serve<WorkApi>(self, {
  init: async ({ wasmUrl }) => {
    const t0 = performance.now();
    const wasmBinary = await (await fetch(wasmUrl)).arrayBuffer();
    mod = await init({ wasmBinary });
    // No fallback fonts: the Work worker never renders text for display (rule 4).
    native = new PdfiumNative(mod, { fontFallback: null });
    return { ms: performance.now() - t0, wasmBytes: wasmBytes() };
  },

  open: async ({ docId, original, tail, password, ownerPassword }) => {
    const doc = await docs.open(docId, original, tail, password, ownerPassword);
    return { pageCount: doc.pageCount, wasmBytes: wasmBytes() };
  },

  unlock: async ({ docId, ownerPassword }) => ({
    unlocked: await docs.unlock(docId, ownerPassword),
  }),

  refresh: ({ docId, tail }) => ({ pending: docs.refresh(docId, tail) }),

  append: ({ docId, piece }) => ({ tailBytes: docs.append(docId, piece) }),

  verify: ({ docId, piece, expected }, ctx) =>
    scheduler.run('save-verify', ctx.signal, async () => {
      if (!mod) throw new RpcError('not-initialized', 'The work worker is not initialized');
      try {
        return await verifyCandidate(mod, need(), docs, docId, piece, expected);
      } finally {
        wasmBytes();
      }
    }),

  digest: ({ docId, pages, priority = 'interactive' }, ctx) =>
    scheduler.run(priority, ctx.signal, async () => {
      if (!mod) throw new RpcError('not-initialized', 'The work worker is not initialized');
      const { doc } = await docs.get(docId);
      return digestDocument(mod, need(), doc.id, pages);
    }),

  close: async ({ docId }) => {
    search.cache.drop(docId);
    await docs.close(docId);
    return { wasmBytes: wasmBytes() };
  },

  memory: () => ({ wasmBytes: wasmBytes(), peakWasmBytes: peak }),

  docState: ({ docId, priority = 'interactive' }, ctx) =>
    scheduler.run(priority, ctx.signal, async () => {
      const { doc, appliedTailBytes } = await docs.get(docId);
      return { pageCount: doc.pageCount, appliedTailBytes };
    }),

  pageGeometry: ({ docId, pageIndex, priority = 'interactive' }, ctx) =>
    scheduler.run(priority, ctx.signal, async () => {
      const { doc } = await docs.get(docId);
      const page = doc.pages[pageIndex];
      if (!page) throw new RpcError('page-out-of-range', 'No such page');
      return need().getPageGeometry(doc, page).toPromise();
    }),

  annotations: ({ docId }, ctx) =>
    scheduler.run('interactive', ctx.signal, async (slice) => {
      if (!mod) throw new RpcError('not-initialized', 'The work worker is not initialized');
      const { doc } = await docs.get(docId);
      try {
        return await listAnnotations(mod, need(), doc, slice, (p) => {
          ctx.progress(p);
        });
      } finally {
        wasmBytes();
      }
    }),

  textSlices: ({ docId, slices, priority = 'interactive' }, ctx) =>
    scheduler.run(priority, ctx.signal, async () => {
      const { doc } = await docs.get(docId);
      return need().getTextSlices(doc, slices).toPromise();
    }),

  search: (req, ctx) =>
    scheduler.run('interactive', ctx.signal, async (slice) => {
      const { doc } = await docs.get(req.docId);
      return search.search(req, doc, slice, (batch) => {
        ctx.stream(batch);
      });
    }),

  searchContext: ({ docId, query, options, pages }, ctx) =>
    scheduler.run('interactive', ctx.signal, async (slice) => {
      const { doc } = await docs.get(docId);
      return search.context(docId, doc, query, options, pages, slice);
    }),

  searchExtras: (req, ctx) =>
    scheduler.run('interactive', ctx.signal, async (slice) => {
      const { doc } = await docs.get(req.docId);
      return search.extras(req, doc, slice);
    }),

  listAttachments: ({ docId }, ctx) =>
    scheduler.run('interactive', ctx.signal, async (slice) => {
      if (!mod) throw new RpcError('not-initialized', 'The work worker is not initialized');
      const { doc } = await docs.get(docId);
      return listAttachments(mod, need(), doc, slice, (p) => {
        ctx.progress(p);
      });
    }),

  checkSignatures: ({ docId }, ctx) =>
    scheduler.run('interactive', ctx.signal, (slice) =>
      checkSignatures(docs.bytes(docId), slice, (p) => {
        ctx.progress(p);
      }),
    ),

  docProperties: ({ docId }, ctx) =>
    scheduler.run('interactive', ctx.signal, async () => {
      if (!mod) throw new RpcError('not-initialized', 'The work worker is not initialized');
      const { doc } = await docs.get(docId);
      return readProperties(mod, need(), doc, docs.bytes(docId));
    }),

  listLayers: ({ docId }, ctx) =>
    scheduler.run('interactive', ctx.signal, () => readLayers(docs.bytes(docId), inflate)),

  formFacts: ({ docId }, ctx) =>
    scheduler.run('interactive', ctx.signal, () => readFormFacts(docs.bytes(docId), inflate)),

  printOpen: ({ docId, piece }, ctx) =>
    scheduler.run('interactive', ctx.signal, async () => {
      const { candidateId } = await docs.openCandidate(docId, piece ?? null);
      return { printId: candidateId };
    }),

  printPages: ({ printId, pages }, ctx) =>
    scheduler.run('interactive', ctx.signal, async () => {
      if (!mod) throw new RpcError('not-initialized', 'The work worker is not initialized');
      await Promise.resolve();
      const m = mod;
      const ptr = docPtrOf(need(), docs.candidate(printId).id);
      return pages.map((i) => pageBox(m, ptr, i));
    }),

  printBand: ({ printId, ...req }, ctx) =>
    scheduler.run('interactive', ctx.signal, async () => {
      if (!mod) throw new RpcError('not-initialized', 'The work worker is not initialized');
      await Promise.resolve();
      try {
        const band = renderBand(mod, docPtrOf(need(), docs.candidate(printId).id), req);
        return new Transfer(band, [band.data.buffer]);
      } finally {
        wasmBytes(); // high-DPI bands grow the heap (ADR-004 respawn policy)
      }
    }),

  printClose: async ({ printId }) => {
    await docs.closeCandidate(printId);
    return null;
  },

  printReady: ({ docId, piece, pages, markups }, ctx) =>
    scheduler.run('interactive', ctx.signal, async (slice) => {
      if (!mod) throw new RpcError('not-initialized', 'The work worker is not initialized');
      const m = mod;
      const { candidateId } = await docs.openCandidate(docId, piece ?? null);
      try {
        const out = await flattenCopy(
          m,
          docPtrOf(need(), candidateId),
          { pages, markups },
          slice,
          (p) => {
            ctx.progress(p);
          },
        );
        return new Transfer({ bytes: out.buffer }, [out.buffer]);
      } finally {
        await docs.closeCandidate(candidateId);
        wasmBytes(); // a large copy grows the heap (ADR-004 respawn policy)
      }
    }),

  readAttachment: ({ docId, ref }, ctx) =>
    scheduler.run('interactive', ctx.signal, async () => {
      if (!mod) throw new RpcError('not-initialized', 'The work worker is not initialized');
      const { doc } = await docs.get(docId);
      try {
        const bytes = await readAttachment(mod, need(), doc, ref);
        // The Blob copy of a large file happens here, off the main thread.
        return { blob: new Blob([bytes], { type: 'application/octet-stream' }) };
      } finally {
        wasmBytes(); // a large read grows the heap (ADR-004 respawn policy)
      }
    }),

  hitRects: ({ docId, pageIndex, hits }, ctx) =>
    scheduler.run('interactive', ctx.signal, async () => {
      const { doc } = await docs.get(docId);
      return search.rects(docId, doc, pageIndex, hits);
    }),

  indexText: ({ docId, visible }, ctx) =>
    scheduler.run('background', ctx.signal, async (slice) => {
      const { doc } = await docs.get(docId);
      try {
        return await indexDocument(search, docId, doc, visible, slice, activity, (p) => {
          ctx.progress(p);
        });
      } finally {
        wasmBytes();
      }
    }),

  activity: ({ quietMs }) => {
    activity.poke(quietMs);
    return null;
  },

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
