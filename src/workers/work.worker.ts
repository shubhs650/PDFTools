// Work worker (ARCHITECTURE §3.1, D-10, ADR-004 decision 1): a second,
// independent PDFium instance with read-only copies of the open documents.
// Jobs run through a cooperative priority scheduler (scheduler.ts) and yield
// between pages, so cancellation and higher-priority work get in (rule 2).
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import oxideWasmUrl from 'pdf-oxide-wasm/wasm?url';
import subsetWasmUrl from 'harfbuzzjs/dist/harfbuzz-subset.wasm?url';
import { RpcError } from '../engine/errors';
import type { WorkApi } from '../engine/workApi';
import { Transfer } from '../engine/protocol';
import { serve } from './rpc-host';
import { acquirePage, docPtrOf, wasmMemory } from './render/pdfium';
import {
  analysisBand,
  displayedSegments,
  frameOf,
  plainFrame,
  signatureOf,
  textOf,
} from './work/compareMaterial';
import { textBuffers } from '../model/compare/material';
import { digestDocument } from './render/save/digest';
import { WorkDocs } from './work/docs';
import { verifyCandidate } from './work/verify';
import { verifySecured } from './work/verifySecurity';
import { Scheduler, type JobSlice } from './work/scheduler';
import { buildTextLayer } from './work/ocrLayer';
import { pageMapper, rasterForOcr } from './work/ocrRaster';
import { PdfReader } from '../model/pdf/reader';
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
import { mayHoldTables, pageObjects, tablesOf } from './work/compareStructure';
import { exportCrs } from './work/crs';
import { exportTemplateCrs } from './work/crsTemplate/job';
import { inspectTemplate } from './work/crsTemplate/inspect';
import { workbookKind } from './work/crsTemplate/kind';
import { readPageLabels } from './work/pageLabels';
import { readTemplateFile, writeTemplateFile } from '../model/crs/templateFile';
import { buildGrid, DENSE_BYTES, DENSE_SEGMENTS, thin } from '../model/snapIndex';
import { OxideHost, webLoader } from './work/oxide';
import { requireCapability, securityOf } from './work/permissionGate';
import { extract } from './work/extract';
import { zipBlob } from './work/zip';
import { exportImages } from './work/images';
import { pageImagePng } from './work/pageImage';
import { assemble, fullAccess, type AssemblePart } from './work/assemble';
import { splitDocument } from './work/split';
import { createBlank } from './work/blank';
import { imagesToPdf } from './work/imagesPdf';
import { commentSource, copyComments, transferComments } from './work/transferJobs';
import { toBase64 } from '../model/base64';
import { detectTables, exportTables, tableCells, type TableSources } from './work/tables/job';
import { applyRedactions } from './work/redact/apply';
import type { PdfDocumentObject } from '@embedpdf/models';
import { installFontReadback } from './render/freeTextFonts';
import { copyItems, editObjects, OutlineError, readOutline } from './work/outline';
import { popupStates } from './work/popups';
import { LayerCopyError, layerCopy, layerKey, type LayerStates } from './shared/layerCopy';
import { buildVectorOverlay } from './work/vectorOverlay';
import { FaceStore, workerFontSource } from './render/commentFonts/faces';
import {
  compareFileProbe,
  compareFileRead,
  compareFileSave,
  compareNotesSeed,
  type FileJobEnv,
} from './work/comparisonFile/jobs';

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

/**
 * The font library's faces (the comparison file's summary page, M12-21), from
 * our own origin on first use (rule 4).
 */
const faces = new FaceStore(
  workerFontSource(self.location.origin, new URL(subsetWasmUrl, self.location.href).href),
);

/** What the comparison file's jobs need (M12-20). */
function fileEnv(
  slice: JobSlice,
  progress: (p: { done: number; total: number }) => void,
): FileJobEnv {
  if (!mod) throw new RpcError('not-initialized', 'The work worker is not initialized');
  return { mod, native: need(), docs, inflate, liveReader, slice, progress, faces };
}

/**
 * What the table jobs read (M4-12): Oxide's copy of the current state and
 * PDFium's segments (the snap geometry cache). Copy permission first (rule 9).
 */
async function tableSources(docId: string, slice: JobSlice): Promise<TableSources> {
  if (!mod) throw new RpcError('not-initialized', 'The work worker is not initialized');
  const m = mod;
  const { doc, appliedTailBytes } = await docs.get(docId);
  const ptr = docPtrOf(need(), doc.id);
  requireCapability(securityOf(m, ptr), 'copy');
  const key = `${doc.id}:${String(appliedTailBytes)}`;
  const odoc = await oxide.document(
    docId,
    key,
    () => docs.liveBytes(docId),
    docs.passwordOf(docId),
  );
  return {
    oxide: odoc,
    key,
    segments: async (page) => {
      const pages = geometry.get(docId) ?? new Map<number, Float32Array>();
      geometry.set(docId, pages);
      let segs = pages.get(page);
      if (!segs) {
        segs = (
          await extractGeometry(m, docPtrOf(need(), (await docs.get(docId)).doc.id), page, slice)
        ).segs;
        pages.set(page, segs);
      }
      return segs;
    },
  };
}

/** zlib inflate (FlateDecode) with the platform's DecompressionStream. */
async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes.slice()]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
/** The document's current state (original + tail + live section) read by our object layer. */
async function liveReader(docId: string): Promise<PdfReader> {
  await docs.get(docId);
  const password = docs.passwordOf(docId);
  const reader = await PdfReader.open(
    docs.liveBytes(docId),
    inflate,
    password === undefined ? {} : { password },
  );
  if (!reader.readable) throw new RpcError('pdfium:4', 'The file could not be decrypted');
  return reader;
}

/** Bookmark editing's own errors cross the boundary with their codes (M6-11). */
async function outlineCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof OutlineError) throw new RpcError(err.code, err.message);
    throw err;
  }
}

/** Runs `fn` on a page held from EmbedPDF's page cache (M12-07). */
function onComparePage<T>(
  docId: string,
  pageIndex: number,
  pageCount: number,
  fn: (page: number) => T,
): T {
  if (pageIndex < 0 || pageIndex >= pageCount)
    throw new RpcError('page-out-of-range', 'No such page');
  const ref = acquirePage(need(), docId, pageIndex);
  try {
    return fn(ref.pagePtr);
  } finally {
    ref.release();
  }
}

/** A layer copy's own errors cross the boundary with their codes (layer switches, Q24). */
async function layerCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof LayerCopyError) throw new RpcError(err.code, err.message);
    throw err;
  }
}

/** The document with other layers shown, opened once per state and generation. */
function layeredDoc(docId: string, layers: LayerStates): Promise<PdfDocumentObject> {
  return layerCall(() =>
    docs.layered(docId, layerKey(layers), (bytes) => layerCopy(bytes, layers, inflate)),
  );
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
    // Text boxes keep their standard font when listed (M6-06).
    installFontReadback(native);
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

  split: ({ docId, parts, packaging }, ctx) =>
    scheduler.run('interactive', ctx.signal, async (slice) => {
      if (!mod) throw new RpcError('not-initialized', 'The work worker is not initialized');
      const { doc } = await docs.get(docId);
      const ptr = docPtrOf(need(), doc.id);
      if (!fullAccess(mod, ptr))
        throw new RpcError('permission-denied:assemble', 'The source file is restricted');
      try {
        const files = await splitDocument(mod, ptr, parts, slice, (p) => {
          ctx.progress(p);
        });
        if (packaging === 'zip')
          return { blob: zipBlob(files.map((f) => ({ name: f.name, data: f.bytes }))) };
        return {
          files: files.map((f) => ({
            path: f.name,
            blob: new Blob([f.bytes as BlobPart], { type: 'application/pdf' }),
          })),
        };
      } finally {
        wasmBytes();
      }
    }),

  createBlank: (spec, ctx) =>
    scheduler.run('interactive', ctx.signal, async (slice) => {
      if (!mod) throw new RpcError('not-initialized', 'The work worker is not initialized');
      try {
        const bytes = await createBlank(mod, spec, slice, (p) => {
          ctx.progress(p);
        });
        const buf = bytes.slice().buffer;
        return new Transfer({ bytes: buf }, [buf]);
      } finally {
        wasmBytes();
      }
    }),

  imagesToPdf: (spec, ctx) =>
    scheduler.run('interactive', ctx.signal, async (slice) => {
      if (!mod) throw new RpcError('not-initialized', 'The work worker is not initialized');
      try {
        const bytes = await imagesToPdf(mod, spec, slice, (p) => {
          ctx.progress(p);
        });
        const buf = bytes.slice().buffer;
        return new Transfer({ bytes: buf }, [buf]);
      } finally {
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

  ocrRaster: ({ docId, pageIndex, dpi, force }, ctx) =>
    scheduler.run('interactive', ctx.signal, async () => {
      const m = mod;
      if (!m) throw new RpcError('not-initialized', 'The work worker is not initialized');
      const { doc } = await docs.get(docId);
      const ptr = docPtrOf(need(), doc.id);
      requireCapability(securityOf(m, ptr), 'modify');
      try {
        const r = rasterForOcr(m, ptr, pageIndex, dpi, force ?? false);
        const data = r.data.buffer;
        return new Transfer({ hasText: r.hasText, width: r.width, height: r.height, data }, [data]);
      } finally {
        wasmBytes();
      }
    }),

  ocrLayer: ({ docId, pages }, ctx) =>
    scheduler.run('interactive', ctx.signal, async (slice) => {
      const m = mod;
      if (!m) throw new RpcError('not-initialized', 'The work worker is not initialized');
      const { doc } = await docs.get(docId);
      const ptr = docPtrOf(need(), doc.id);
      requireCapability(securityOf(m, ptr), 'modify');
      const bytes = docs.liveBytes(docId);
      const password = docs.passwordOf(docId);
      const reader = await PdfReader.open(
        bytes,
        inflate,
        password === undefined ? {} : { password },
      );
      if (!reader.readable) throw new RpcError('pdfium:4', 'The file could not be decrypted');
      await slice.checkpoint();
      const mappers = new Map<number, ReturnType<typeof pageMapper>>();
      try {
        const r = await buildTextLayer(reader, pages, {
          toPage: (pageIndex, dx, dy) => {
            let mp = mappers.get(pageIndex);
            if (!mp) {
              const size = pages.find((p) => p.pageIndex === pageIndex);
              mp = pageMapper(m, ptr, pageIndex, size?.width ?? 1, size?.height ?? 1);
              mappers.set(pageIndex, mp);
            }
            return mp.toPage(dx, dy);
          },
        });
        return new Transfer(r, [...new Set(r.objects.map((o) => o.bytes.buffer as ArrayBuffer))]);
      } finally {
        for (const mp of mappers.values()) mp.release();
        wasmBytes();
      }
    }),

  copyComments: ({ docId, ids, withReplies, base64 }, ctx) =>
    scheduler.run('interactive', ctx.signal, async (slice) => {
      if (!mod) throw new RpcError('not-initialized', 'The work worker is not initialized');
      try {
        const r = await copyComments(mod, need(), docs, docId, ids, withReplies, inflate, slice);
        if (base64) {
          await slice.checkpoint();
          return {
            bytes: new ArrayBuffer(0),
            pages: r.pages,
            count: r.count,
            base64: toBase64(r.bytes),
          };
        }
        const buf = r.bytes.slice().buffer;
        return new Transfer({ bytes: buf, pages: r.pages, count: r.count }, [buf]);
      } finally {
        wasmBytes();
      }
    }),

  detectTables: ({ docId, pages }, ctx) =>
    scheduler.run('interactive', ctx.signal, async (slice) => {
      try {
        const src = await tableSources(docId, slice);
        return {
          pages: await detectTables(src, pages, slice, (p) => {
            ctx.progress(p);
          }),
        };
      } finally {
        wasmBytes();
      }
    }),

  tableCells: ({ docId, grids }, ctx) =>
    scheduler.run('interactive', ctx.signal, async (slice) => {
      try {
        return { tables: await tableCells(await tableSources(docId, slice), grids, slice) };
      } finally {
        wasmBytes();
      }
    }),

  exportTables: ({ docId, pages, grids, tables, format, packaging, baseName }, ctx) =>
    scheduler.run('interactive', ctx.signal, async (slice) => {
      try {
        const src = await tableSources(docId, slice);
        return await exportTables(
          src,
          tables ? { tables } : grids ? { grids } : { pages: pages ?? [] },
          format,
          packaging,
          baseName,
          slice,
          (p) => {
            ctx.progress(p);
          },
        );
      } finally {
        wasmBytes();
      }
    }),

  redact: ({ docId, skip }, ctx) =>
    scheduler.run('interactive', ctx.signal, async (slice) => {
      if (!mod) throw new RpcError('not-initialized', 'The work worker is not initialized');
      const { doc } = await docs.get(docId);
      requireCapability(securityOf(mod, docPtrOf(need(), doc.id)), 'modify'); // rule 9, M4-Q2
      try {
        const r = await applyRedactions(
          mod,
          need(),
          docs.liveBytes(docId),
          docs.passwordOf(docId),
          slice,
          (p) => {
            ctx.progress(p);
          },
          // The failure-path probe exists in e2e builds only.
          import.meta.env.MODE === 'e2e' ? skip : undefined,
        );
        const buf = r.bytes.buffer;
        return new Transfer(
          {
            bytes: buf,
            marks: r.marks,
            pages: r.pages,
            removedAnnotations: r.removedAnnotations,
            recut: r.recut,
            removed: [...new Set(r.sanitize.removed)],
            outlineItemsRemoved: r.sanitize.outlineItemsRemoved,
            fieldsRemoved: r.sanitize.fieldsRemoved,
            leaks: r.leaks,
          },
          [buf],
        );
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

  verifySecurity: ({ bytes, check, expected }, ctx) =>
    scheduler.run('interactive', ctx.signal, async (slice) => {
      if (!mod) throw new RpcError('not-initialized', 'The work worker is not initialized');
      try {
        return await verifySecured(mod, need(), bytes, check, expected, slice, (done, total) => {
          ctx.progress({ done, total });
        });
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

  compareSignature: ({ docId, pageIndex }, ctx) =>
    scheduler.run('compare', ctx.signal, async () => {
      if (!mod) throw new RpcError('not-initialized', 'The work worker is not initialized');
      const m = mod;
      const { doc } = await docs.get(docId);
      const ptr = docPtrOf(need(), doc.id);
      try {
        const sig = onComparePage(doc.id, pageIndex, doc.pageCount, (page) =>
          signatureOf(m, ptr, pageIndex, page),
        );
        return new Transfer(sig, [sig.ink.buffer as ArrayBuffer]);
      } finally {
        wasmBytes();
      }
    }),

  compareGeometry: ({ docId, pageIndex }, ctx) =>
    scheduler.run('compare', ctx.signal, async (slice) => {
      if (!mod) throw new RpcError('not-initialized', 'The work worker is not initialized');
      const m = mod;
      const { doc } = await docs.get(docId);
      if (pageIndex < 0 || pageIndex >= doc.pageCount)
        throw new RpcError('page-out-of-range', 'No such page');
      const ptr = docPtrOf(need(), doc.id);
      try {
        // Snapping's copy when it has one; otherwise read here and not cached (the
        // comparison keeps only feature points).
        const segs =
          geometry.get(docId)?.get(pageIndex) ??
          (await extractGeometry(m, ptr, pageIndex, slice)).segs;
        const frame = onComparePage(doc.id, pageIndex, doc.pageCount, (page) =>
          plainFrame(frameOf(m, ptr, pageIndex, page)),
        );
        const segments = displayedSegments(segs, frame.toDisplay);
        return new Transfer({ frame, segments }, [segments.buffer]);
      } finally {
        wasmBytes();
      }
    }),

  compareText: ({ docId, pageIndex, structure }, ctx) =>
    scheduler.run('compare', ctx.signal, async (slice) => {
      if (!mod) throw new RpcError('not-initialized', 'The work worker is not initialized');
      const m = mod;
      const { doc } = await docs.get(docId);
      const ptr = docPtrOf(need(), doc.id);
      try {
        let paths = 0;
        const text = onComparePage(doc.id, pageIndex, doc.pageCount, (page) => {
          const frame = plainFrame(frameOf(m, ptr, pageIndex, page));
          const t = textOf(m, page, frame);
          if (structure) {
            // A text comparison (M12-18): its pictures, then (below) its tables.
            const o = pageObjects(m, page, frame);
            paths = o.paths;
            t.structure = { imageCover: o.imageCover, figures: o.figures, tables: [] };
          }
          return t;
        });
        if (text.structure && mayHoldTables(text, paths)) {
          const segs =
            geometry.get(docId)?.get(pageIndex) ??
            (await extractGeometry(m, ptr, pageIndex, slice)).segs;
          text.structure.tables = tablesOf(text, segs);
        }
        return new Transfer(text, textBuffers(text));
      } finally {
        wasmBytes();
      }
    }),

  compareOcrRaster: ({ docId, pageIndex, dpi }, ctx) =>
    scheduler.run('compare', ctx.signal, async () => {
      if (!mod) throw new RpcError('not-initialized', 'The work worker is not initialized');
      const m = mod;
      const { doc } = await docs.get(docId);
      const ptr = docPtrOf(need(), doc.id);
      try {
        const loaded = onComparePage(doc.id, pageIndex, doc.pageCount, (page) =>
          frameOf(m, ptr, pageIndex, page),
        );
        // Viewing only (D-58): the page is read for the comparison, the file is not changed.
        const r = rasterForOcr(m, ptr, pageIndex, dpi, true);
        const data = r.data.buffer;
        return new Transfer(
          {
            width: r.width,
            height: r.height,
            data,
            frame: plainFrame(loaded),
            turn: loaded.turn,
          },
          [data],
        );
      } finally {
        wasmBytes();
      }
    }),

  compareRaster: ({ docId, pageIndex, layers, ...req }, ctx) =>
    scheduler.run('compare', ctx.signal, async (slice) => {
      if (!mod) throw new RpcError('not-initialized', 'The work worker is not initialized');
      const m = mod;
      // Layer switches (D-59, Q24): drawn from the copy with those layers shown.
      const doc = layerKey(layers)
        ? await layeredDoc(docId, layers ?? {})
        : (await docs.get(docId)).doc;
      const ptr = docPtrOf(need(), doc.id);
      if (pageIndex < 0 || pageIndex >= doc.pageCount)
        throw new RpcError('page-out-of-range', 'No such page');
      // Held from EmbedPDF's page cache across the checkpoints: a dense sheet is parsed once.
      const ref = acquirePage(need(), doc.id, pageIndex);
      try {
        const turn = frameOf(m, ptr, pageIndex, ref.pagePtr).turn;
        const band = await analysisBand(m, ref.pagePtr, turn, req, () => slice.checkpoint());
        return new Transfer(band, [band.data.buffer as ArrayBuffer]);
      } finally {
        ref.release();
        wasmBytes();
      }
    }),

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

  crsTemplate: ({ template, spec, docs: list, shots }, ctx) =>
    scheduler.run('interactive', ctx.signal, async (slice) => {
      if (!mod) throw new RpcError('not-initialized', 'The work worker is not initialized');
      const m = mod;
      // Snapshots come from a separate copy of each document with its unsaved edits.
      const wanted = new Set(shots?.flatMap((g) => g.map((s) => s?.doc ?? -1)) ?? []);
      const copies: ({ candidateId: string } | null)[] = [];
      try {
        for (const [i, d] of list.entries()) {
          copies.push(wanted.has(i) ? await docs.openCandidate(d.docId, d.piece ?? null) : null);
        }
        const out = await exportTemplateCrs(
          m,
          copies.map((c) => (c ? docPtrOf(need(), c.candidateId) : null)),
          template,
          spec,
          shots,
          slice,
          (p) => {
            ctx.progress(p);
          },
        );
        return new Transfer(out, [out.bytes]);
      } finally {
        for (const c of copies) if (c) await docs.closeCandidate(c.candidateId);
        wasmBytes(); // a large workbook grows the heap (ADR-004 respawn policy)
      }
    }),

  crsTemplateInspect: ({ bytes, probe }, ctx) =>
    scheduler.run('interactive', ctx.signal, async () => {
      const { default: lib } = await import('exceljs');
      return inspectTemplate(lib, bytes, probe);
    }),

  crsTemplateFileWrite: ({ template }, ctx) =>
    scheduler.run('interactive', ctx.signal, () => {
      const bytes = new TextEncoder().encode(writeTemplateFile(template)).buffer;
      return Promise.resolve(new Transfer({ bytes }, [bytes]));
    }),

  crsTemplateFileRead: ({ bytes, appStatus }, ctx) =>
    scheduler.run('interactive', ctx.signal, async () => {
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        return { ok: false as const, reason: 'not-template' as const };
      }
      const read = readTemplateFile(text, appStatus);
      if (!read.ok) return read;
      const kind = workbookKind(new Uint8Array(read.template.workbook));
      if (kind !== 'xlsx' && kind !== 'xltx')
        return { ok: false as const, reason: 'damaged' as const };
      const { default: lib } = await import('exceljs');
      const check = await inspectTemplate(lib, read.template.workbook, null);
      if (!check.ok) return { ok: false as const, reason: 'damaged' as const };
      return new Transfer({ ...read, template: { ...read.template, kind } }, [
        read.template.workbook,
      ]);
    }),

  pageLabels: ({ docId, pages }, ctx) =>
    scheduler.run('interactive', ctx.signal, async () => {
      if (!mod) throw new RpcError('not-initialized', 'The work worker is not initialized');
      const { doc } = await docs.get(docId);
      return readPageLabels(mod, docPtrOf(need(), doc.id), pages);
    }),

  listLayers: ({ docId }, ctx) =>
    scheduler.run('interactive', ctx.signal, () => readLayers(docs.bytes(docId), inflate)),

  compareLayerCopy: ({ docId, layers }, ctx) =>
    scheduler.run('interactive', ctx.signal, async () => {
      await docs.get(docId);
      const bytes = await layerCall(() => layerCopy(docs.liveBytes(docId), layers, inflate));
      return new Transfer({ bytes: bytes.buffer }, [bytes.buffer]);
    }),

  compareVectorOverlay: ({ exported, ...req }, ctx) =>
    scheduler.run('interactive', ctx.signal, async (slice) => {
      if (!mod) throw new RpcError('not-initialized', 'The work worker is not initialized');
      const m = mod;
      const docIds = new Set(req.sheets.flatMap((s) => [s.a?.docId, s.b?.docId]));
      for (const docId of docIds) {
        if (docId === undefined) continue;
        const { doc } = await docs.get(docId);
        // Export Overlay… copies the content out of every file (rule 9, D-58).
        if (exported) requireCapability(securityOf(m, docPtrOf(need(), doc.id)), 'copy');
      }
      try {
        const { bytes, stats } = await buildVectorOverlay(
          {
            mod: m,
            native: need(),
            source: async (docId) => {
              const { doc } = await docs.get(docId);
              return { engineId: doc.id, reader: () => liveReader(docId) };
            },
            slice,
            progress: (p) => {
              ctx.progress(p);
            },
          },
          req,
        );
        return new Transfer({ bytes: bytes.buffer, stats }, [bytes.buffer]);
      } finally {
        wasmBytes(); // the new document and its copy grow the heap (ADR-004)
      }
    }),

  compareFileSave: (req, ctx) =>
    scheduler.run('interactive', ctx.signal, async (slice) => {
      try {
        const r = await compareFileSave(
          fileEnv(slice, (p) => {
            ctx.progress(p);
          }),
          req,
        );
        return new Transfer(r, [r.bytes]);
      } finally {
        wasmBytes(); // the overlay pages and the scratch copies grow the heap (ADR-004)
      }
    }),

  compareFileProbe: ({ docId }, ctx) =>
    scheduler.run('interactive', ctx.signal, (slice) =>
      compareFileProbe(
        fileEnv(slice, () => undefined),
        docId,
      ),
    ),

  compareFileRead: ({ docId }, ctx) =>
    scheduler.run('interactive', ctx.signal, async (slice) => {
      const r = await compareFileRead(
        fileEnv(slice, () => undefined),
        docId,
      );
      return new Transfer(r, [
        ...r.A.map((f) => f.bytes),
        ...r.B.map((f) => f.bytes),
        ...(r.notes ? [r.notes] : []),
      ]);
    }),

  compareNotesSeed: ({ blank, notes }, ctx) =>
    scheduler.run('interactive', ctx.signal, async (slice) => {
      const bytes = await compareNotesSeed(
        fileEnv(slice, () => undefined),
        blank,
        notes,
      );
      return new Transfer({ bytes }, [bytes]);
    }),

  compareFileInput: ({ docId }, ctx) =>
    scheduler.run('interactive', ctx.signal, async () => {
      await docs.get(docId);
      const bytes = docs.bytes(docId).slice().buffer;
      return new Transfer({ bytes }, [bytes]);
    }),

  compareLayersRelease: ({ docIds }) => {
    for (const d of docIds) docs.releaseLayered(d);
    return null;
  },

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
        () => docs.liveBytes(docId),
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

  // Copy Image / Save Image As (M11-08·O6): one image of the page content, as a PNG.
  pageImage: ({ docId, pageIndex, x, y }, ctx) =>
    scheduler.run('interactive', ctx.signal, async (slice) => {
      if (!mod) throw new RpcError('not-initialized', 'The work worker is not initialized');
      const { doc } = await docs.get(docId);
      const ptr = docPtrOf(need(), doc.id);
      requireCapability(securityOf(mod, ptr), 'copy'); // rule 9
      try {
        const r = await pageImagePng(mod, ptr, pageIndex, { x, y }, slice);
        if (!r) return null;
        const { png, width, height } = r;
        return { blob: new Blob([png as BlobPart], { type: 'image/png' }), width, height };
      } finally {
        wasmBytes(); // a decoded image grows the heap (ADR-004 respawn policy)
      }
    }),

  // Bookmarks (M6-11, §7.15, ADR-022 decision 5): our own outline reader and writer.
  readOutline: ({ docId }, ctx) =>
    scheduler.run('interactive', ctx.signal, async () => {
      const reader = await liveReader(docId);
      const items = await readOutline(reader);
      return { items };
    }),

  // Sticky note pop-ups (M7-06): /Open from the current bytes.
  popupStates: ({ docId, objs }, ctx) =>
    scheduler.run('interactive', ctx.signal, async () => ({
      open: await popupStates(await liveReader(docId), objs),
    })),

  copyOutline: ({ docId, paths, expect }, ctx) =>
    scheduler.run('interactive', ctx.signal, () =>
      outlineCall(async () => {
        return { items: await copyItems(await liveReader(docId), paths, expect) };
      }),
    ),

  editOutline: ({ docId, edit, expect }, ctx) =>
    scheduler.run('interactive', ctx.signal, () =>
      outlineCall(async () => {
        if (!mod) throw new RpcError('not-initialized', 'The work worker is not initialized');
        const { doc } = await docs.get(docId);
        requireCapability(securityOf(mod, docPtrOf(need(), doc.id)), 'modify'); // rule 9
        const r = await editObjects(await liveReader(docId), edit, expect);
        return new Transfer(r, [...new Set(r.objects.map((o) => o.bytes.buffer as ArrayBuffer))]);
      }),
    ),

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
