// Work worker (ARCHITECTURE §3.1, D-10, ADR-004 decision 1): a second,
// independent PDFium instance with read-only copies of the open documents.
// Jobs run through a cooperative priority scheduler (scheduler.ts) and yield
// between pages, so cancellation and higher-priority work get in (rule 2).
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import oxideWasmUrl from 'pdf-oxide-wasm/wasm?url';
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
import { readViewports } from './work/viewports';
import { flattenCopy } from './work/flatten';
import { pageBox, renderBand } from './work/print';
import { readProperties } from './work/properties';
import { checkSignatures } from './work/signatures';
import { extractGeometry } from './work/geometry';
import { exportCrs } from './work/crs';
import { buildGrid, DENSE_BYTES, DENSE_SEGMENTS, thin } from '../model/snapIndex';
import { OxideHost, webLoader } from './work/oxide';
import { requireCapability, securityOf } from './work/permissionGate';
import { extract } from './work/extract';
import { zipBlob } from './work/zip';
import { exportImages } from './work/images';
import { assemble, fullAccess, type AssemblePart } from './work/assemble';
import { commentSource, copyComments, transferComments } from './work/transferJobs';
import type { PdfDocumentObject } from '@embedpdf/models';

let mod: WrappedPdfiumModule | undefined;
let native: PdfiumNative | undefined;
let peak = 0;

function need(): PdfiumNative {
  if (!native) throw new RpcError('not-initialized', 'The work worker is not initialized');
  return native;
}

/**
 * PDF Oxide (M4-04, ADR-009): lazy, one instance, its WASM from our own origin
 * by an explicit URL (never the glue's default).
 */
const oxide = new OxideHost(webLoader(() => new URL(oxideWasmUrl, self.location.href).href));

/** PDFium's and Oxide's WASM memory: both count for the respawn policy (ADR-004 d4, ADR-009). */
function wasmBytes(): number {
  const bytes = (mod ? (wasmMemory(mod)?.buffer.byteLength ?? 0) : 0) + oxide.memoryBytes();
  peak = Math.max(peak, bytes);
  return bytes;
}

const docs = new WorkDocs(need);

/** zlib inflate (FlateDecode) with the platform's DecompressionStream. */
async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes.slice()]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
/** Snap geometry per document and page (M3-18): extracted once, reused at every zoom. */
const geometry = new Map<string, Map<number, Float32Array>>();

const scheduler = new Scheduler({
  onIdle: () => {
    void docs.closeRetired();
  },
});
let assembleSeq = 0;
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

  assemble: ({ parts, outline }, ctx) =>
    scheduler.run('interactive', ctx.signal, async (slice) => {
      if (!mod) throw new RpcError('not-initialized', 'The work worker is not initialized');
      const m = mod;
      const n = need();
      const opened: PdfDocumentObject[] = [];
      try {
        const resolved: AssemblePart[] = [];
        for (const part of parts) {
          let ptr: number;
          if ('docId' in part) {
            const { doc } = await docs.get(part.docId);
            ptr = docPtrOf(n, doc.id);
          } else {
            const doc = await n
              .openDocumentBuffer(
                { id: `assemble-${String(++assembleSeq)}`, content: part.bytes },
                part.password === undefined ? {} : { password: part.password },
              )
              .toPromise();
            opened.push(doc);
            ptr = docPtrOf(n, doc.id);
          }
          if (!fullAccess(m, ptr))
            throw new RpcError('permission-denied:assemble', 'The source file is restricted');
          resolved.push({ docPtr: ptr, pages: part.pages, title: part.title });
        }
        const bytes = await assemble(m, resolved, outline, slice, (p) => {
          ctx.progress(p);
        });
        const buf = bytes.slice().buffer;
        return new Transfer({ bytes: buf }, [buf]);
      } finally {
        for (const doc of opened) await n.closeDocument(doc).toPromise();
        wasmBytes();
      }
    }),

  commentSource: (source, ctx) =>
    scheduler.run('interactive', ctx.signal, async () => {
      if (!mod) throw new RpcError('not-initialized', 'The work worker is not initialized');
      try {
        return await commentSource(mod, need(), source, inflate);
      } finally {
        wasmBytes();
      }
    }),

  transferComments: ({ docId, source, spec }, ctx) =>
    scheduler.run('interactive', ctx.signal, async (slice) => {
      if (!mod) throw new RpcError('not-initialized', 'The work worker is not initialized');
      try {
        const r = await transferComments(
          mod,
          need(),
          docs,
          docId,
          source,
          spec,
          inflate,
          slice,
          (p) => {
            ctx.progress(p);
          },
        );
        return new Transfer(r, [...new Set(r.objects.map((o) => o.bytes.buffer as ArrayBuffer))]);
      } finally {
        wasmBytes();
      }
    }),

  copyComments: ({ docId, ids, withReplies }, ctx) =>
    scheduler.run('interactive', ctx.signal, async (slice) => {
      if (!mod) throw new RpcError('not-initialized', 'The work worker is not initialized');
      try {
        const r = await copyComments(mod, need(), docs, docId, ids, withReplies, inflate, slice);
        const buf = r.bytes.slice().buffer;
        return new Transfer({ bytes: buf, pages: r.pages, count: r.count }, [buf]);
      } finally {
        wasmBytes();
      }
    }),

  setLive: ({ docId, live }) => {
    docs.setLive(docId, live);
    oxide.drop(docId);
    search.cache.drop(docId);
    geometry.delete(docId);
    return null;
  },

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
    oxide.drop(docId);
    search.cache.drop(docId);
    geometry.delete(docId);
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
        // Streamed, not throttled: each message carries a batch of annotations.
        return await listAnnotations(mod, need(), doc, slice, (p) => {
          ctx.stream(p);
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

  pageViewports: ({ docId }, ctx) =>
    scheduler.run('interactive', ctx.signal, () =>
      readViewports(docs.bytes(docId), inflate, docs.passwordOf(docId)),
    ),

  snapGeometry: ({ docId, pageIndex, minLen }, ctx) =>
    scheduler.run('geometry', ctx.signal, async (slice) => {
      if (!mod) throw new RpcError('not-initialized', 'The work worker is not initialized');
      const t0 = performance.now();
      const { doc } = await docs.get(docId);
      if (pageIndex < 0 || pageIndex >= doc.pageCount)
        throw new RpcError('page-out-of-range', 'No such page');
      const pages = geometry.get(docId) ?? new Map<number, Float32Array>();
      geometry.set(docId, pages);
      let segs = pages.get(pageIndex);
      if (!segs) {
        try {
          segs = (await extractGeometry(mod, docPtrOf(need(), doc.id), pageIndex, slice)).segs;
        } finally {
          wasmBytes();
        }
        pages.set(pageIndex, segs);
      }
      // ADR-008 d3: a very dense page keeps only segments visible at this zoom.
      const n = segs.length / 4;
      const dense = n > DENSE_SEGMENTS || segs.byteLength * 3 > DENSE_BYTES;
      const index = buildGrid(dense && minLen > 0 ? thin(segs, minLen) : segs.slice());
      return new Transfer(
        { index, segments: index.segs.length / 4, dense, ms: performance.now() - t0 },
        [index.segs.buffer, index.cellStart.buffer, index.items.buffer],
      );
    }),

  crs: ({ docId, piece, spec, snapshots }, ctx) =>
    scheduler.run('interactive', ctx.signal, async (slice) => {
      if (!mod) throw new RpcError('not-initialized', 'The work worker is not initialized');
      const m = mod;
      // Snapshots come from a separate copy with the unsaved edits (ADR-013 route).
      const copy = snapshots ? await docs.openCandidate(docId, piece ?? null) : null;
      try {
        const bytes = await exportCrs(
          m,
          copy ? docPtrOf(need(), copy.candidateId) : null,
          spec,
          snapshots,
          slice,
          (p) => {
            ctx.progress(p);
          },
        );
        return new Transfer({ bytes }, [bytes]);
      } finally {
        if (copy) await docs.closeCandidate(copy.candidateId);
        wasmBytes(); // a large workbook grows the heap (ADR-004 respawn policy)
      }
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
        // A live-section change reloads the copy: indexing follows the current one.
        const current = async () => (await docs.get(docId)).doc;
        return await indexDocument(
          search,
          docId,
          doc,
          visible,
          slice,
          activity,
          (p) => {
            ctx.progress(p);
          },
          undefined,
          undefined,
          current,
        );
      } finally {
        wasmBytes();
      }
    }),

  oxideWarm: (_args, ctx) =>
    scheduler.run('background', ctx.signal, async () => {
      try {
        return { warmUpMs: await oxide.warmUp(), oxideBytes: oxide.memoryBytes() };
      } finally {
        wasmBytes();
      }
    }),

  extract: ({ docId, pages, options, packaging }, ctx) =>
    scheduler.run('interactive', ctx.signal, async (slice) => {
      if (!mod) throw new RpcError('not-initialized', 'The work worker is not initialized');
      const { doc, appliedTailBytes } = await docs.get(docId);
      // Rule 9 before Oxide sees a byte (ADR-009 decision 3).
      requireCapability(securityOf(mod, docPtrOf(need(), doc.id)), 'copy');
      const odoc = await oxide.document(
        docId,
        `${doc.id}:${String(appliedTailBytes)}`,
        () => docs.bytes(docId),
        docs.passwordOf(docId),
      );
      try {
        const r = await extract(odoc, pages, options, slice, (p) => {
          ctx.progress(p);
        });
        const { pages: n, chars, images } = r;
        const blobOf = (f: (typeof r.files)[number]) =>
          new Blob([f.data as BlobPart], { type: f.type });
        const [main] = r.files;
        if (!main) throw new RpcError('export-empty', 'Nothing was extracted');
        if (packaging === 'single')
          return { blob: blobOf(main), name: main.path, pages: n, chars, images };
        if (packaging === 'zip') {
          const enc = new TextEncoder();
          const blob = zipBlob(
            r.files.map((f) => ({
              name: f.path,
              data: typeof f.data === 'string' ? enc.encode(f.data) : f.data,
            })),
          );
          return { blob, name: `${options.baseName}.zip`, pages: n, chars, images };
        }
        return {
          files: r.files.map((f) => ({ path: f.path, blob: blobOf(f) })),
          pages: n,
          chars,
          images,
        };
      } finally {
        wasmBytes(); // Oxide's heap counts for the respawn policy
      }
    }),

  exportImages: ({ docId, pages, baseName, packaging }, ctx) =>
    scheduler.run('interactive', ctx.signal, async (slice) => {
      if (!mod) throw new RpcError('not-initialized', 'The work worker is not initialized');
      const { doc } = await docs.get(docId);
      const ptr = docPtrOf(need(), doc.id);
      requireCapability(securityOf(mod, ptr), 'copy'); // rule 9
      try {
        const r = await exportImages(mod, ptr, pages, slice, (p) => {
          ctx.progress(p);
        });
        const { images, duplicates, skipped } = r;
        const counts = { pages: r.pages, images, duplicates, skipped };
        if (packaging === 'zip') {
          const blob = zipBlob(
            r.files.map((f) => ({
              name: f.path,
              data: typeof f.data === 'string' ? new TextEncoder().encode(f.data) : f.data,
            })),
          );
          return { blob, name: `${baseName}.zip`, ...counts };
        }
        return {
          files: r.files.map((f) => ({
            path: f.path,
            blob: new Blob([f.data as BlobPart], { type: f.type }),
          })),
          ...counts,
        };
      } finally {
        wasmBytes(); // decoded images grow the heap (ADR-004 respawn policy)
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
