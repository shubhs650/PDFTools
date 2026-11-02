// Render worker (ARCHITECTURE §3.1, D-10, ADR-004 decision 2): PDFium #1 with
// EmbedPDF's PdfiumNative executor, hosted in our own module so direct PDFium
// calls are possible (ADR-001 B14). The main thread drives it through
// EmbedPDF's PdfEngine (src/engine/hostedEngine.ts) over our typed RPC.
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { PDF_FORM_FIELD_FLAG, PdfErrorCode, TaskRejectedError, type Task } from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { RpcError } from '../engine/errors';
import { Transfer } from '../engine/protocol';
import { PDFIUM_ERROR_PREFIX, type RenderApi } from '../engine/renderApi';
import { fromJson } from '../model/pdf/wire';
import { serve } from './rpc-host';
import { acquirePage, docPtrOf, pageInfos, rawCall, wasmMemory } from './render/pdfium';
import { applyPageOp, withSource } from './render/pages';
import { renderProgressive } from './render/progressive';
import { AnnotBoxCache, annotBoxes, renderAnnotTile } from './render/annotTiles';
import { renderSnapshot } from './render/snapshot';
import { dropCustom, keepAuthor, nameTargets, writeMarkupIntent } from './render/annotIds';
import { installFontReadback } from './render/freeTextFonts';
import { SaveTracker, isMutation } from './render/save/tracker';
import {
  createFileAttachment,
  isFileAttachmentCall,
  readFileAttachment,
  updateFileAttachment,
} from './render/fileAttach';
import { secureCopy } from './render/security';

const FPDF_PAGEOBJ_PATH = 2;
/** `FPDF_GetFormType` for a dynamic (full) XFA form: nothing to fill (M2-14). */
const FORMTYPE_XFA_FULL = 2;
/** Calls that change a field's value (M2-14 read-only and XFA guard). */
const FORM_VALUE_METHODS = new Set(['setFormFieldValue', 'setFormFieldState']);

let mod: WrappedPdfiumModule | undefined;
let native: PdfiumNative | undefined;
let tracker: SaveTracker | undefined;
const annotBoxCache = new AnnotBoxCache();

function ready(): { mod: WrappedPdfiumModule; native: PdfiumNative; tracker: SaveTracker } {
  if (!mod || !native || !tracker)
    throw new RpcError('not-initialized', 'The render worker is not initialized');
  return { mod, native, tracker };
}

/** Pixel buffers we own can be transferred; never the WASM heap itself. */
function transferables(value: unknown, heap: ArrayBufferLike | undefined): Transferable[] {
  const out: Transferable[] = [];
  const consider = (v: unknown): void => {
    if (v instanceof ArrayBuffer) {
      if (v !== heap) out.push(v);
    } else if (ArrayBuffer.isView(v)) {
      const b = v.buffer;
      if (
        b instanceof ArrayBuffer &&
        b !== heap &&
        v.byteOffset === 0 &&
        v.byteLength === b.byteLength
      )
        out.push(b);
    }
  };
  consider(value);
  if (value && typeof value === 'object') for (const v of Object.values(value)) consider(v);
  return [...new Set(out)];
}

/** EmbedPDF task failure → RpcError with the PdfErrorCode, no message text (rule 10). */
function toRpcError(err: unknown): RpcError {
  const reason: unknown =
    err instanceof TaskRejectedError ? err.reason : (err as { reason?: unknown } | null)?.reason;
  const code = (reason as { code?: unknown } | undefined)?.code;
  const n = typeof code === 'number' ? code : PdfErrorCode.Unknown;
  return new RpcError(`${PDFIUM_ERROR_PREFIX}${String(n)}`, `PDFium error ${String(n)}`);
}

serve<RenderApi>(self, {
  init: async ({ wasmUrl, fontFallback }) => {
    // Runtime guard: callers outside TypeScript's reach (tests, future code).
    if ((fontFallback as unknown) === undefined) {
      // ADR-003: undefined silently means "fonts from jsDelivr" inside EmbedPDF.
      throw new RpcError('font-fallback-undefined', 'fontFallback must be null or a local config');
    }
    const t0 = performance.now();
    const wasmBinary = await (await fetch(wasmUrl)).arrayBuffer();
    mod = await init({ wasmBinary });
    native = new PdfiumNative(mod, { fontFallback });
    // Text boxes keep their standard font when read back (M6-06).
    installFontReadback(native);
    tracker = new SaveTracker(mod, native);
    return { ms: performance.now() - t0, wasmBytes: wasmMemory(mod)?.buffer.byteLength ?? 0 };
  },

  exec: async ({ method, args }, ctx) => {
    const { mod: m, native: n, tracker: t } = ready();
    const docId = (args[0] as { id?: unknown } | undefined)?.id;
    // Rule 9: a mutation the document's permissions forbid never reaches PDFium.
    if (isMutation(method) && typeof docId === 'string') t.checkAllowed(method, docId, args);
    // M2-14 (ADR-013 decision 4): PDFium fills read-only fields and full XFA forms; we don't.
    if (FORM_VALUE_METHODS.has(method) && typeof docId === 'string') {
      const field = (args[2] as { field?: { flag?: unknown } } | undefined)?.field;
      if (typeof field?.flag === 'number' && field.flag & PDF_FORM_FIELD_FLAG.READONLY)
        throw new RpcError('form-readonly', 'The field is read-only');
      if (rawCall(m, 'FPDF_GetFormType', docPtrOf(n, docId)) === FORMTYPE_XFA_FULL)
        throw new RpcError('form-xfa', 'XFA forms are not filled');
    }
    const fn = (
      n as unknown as Record<string, ((...a: unknown[]) => Task<unknown, unknown>) | undefined>
    )[method];
    if (typeof fn !== 'function')
      throw new RpcError('unknown-method', `Unknown executor method ${method}`);
    // Stable ids (ADR-014 d2): name the targeted annotation before EmbedPDF looks it up.
    if (typeof docId === 'string') nameTargets(m, n, method, args);
    // An edit keeps the annotation's own author (D-03); no private keys (rule 6).
    const callArgs =
      typeof docId === 'string' ? keepAuthor(m, n, method, dropCustom(method, args)) : args;
    let value: unknown;
    if (typeof docId === 'string' && isFileAttachmentCall(method, callArgs)) {
      // Attach File (M6-10, ADR-022 d1): EmbedPDF can't create or update this subtype.
      value =
        method === 'createPageAnnotation'
          ? createFileAttachment(m, n, callArgs)
          : updateFileAttachment(m, n, callArgs);
    } else {
      const task = fn.apply(n, callArgs);
      task.onProgress((p) => {
        ctx.progress(p);
      });
      ctx.signal.addEventListener('abort', () => {
        task.abort({ code: PdfErrorCode.Cancelled, message: 'cancelled' });
      });
      try {
        value = await task.toPromise();
      } catch (err) {
        throw toRpcError(err);
      }
    }
    if (typeof docId === 'string') writeMarkupIntent(m, n, method, callArgs);
    // A reopen (page-operation undo) re-applies the owner unlock (ADR-016 d5).
    if (method === 'unlockOwnerPermissions' && value === true && typeof docId === 'string') {
      const pw = args[1];
      if (typeof pw === 'string') t.ownerUnlocked(docId, pw);
    }
    // Save bookkeeping (M1-20): the opened bytes' trailer, and what each edit changed.
    if (method === 'openDocumentBuffer') {
      const file = args[0] as { id: string; content: ArrayBuffer };
      // The open password (memory only, M2-Q7) derives our object layer's file key (M3-04).
      const password = (args[1] as { password?: unknown } | undefined)?.password;
      t.opened(
        file.id,
        new Uint8Array(file.content),
        typeof password === 'string' ? password : undefined,
      );
    } else if (method === 'closeDocument' && typeof docId === 'string') {
      t.closed(docId);
    } else if (isMutation(method)) {
      t.recordMutation(method, args);
    }
    // Any change (or close) can move, add or remove markups: annotation tiles re-read boxes.
    if (typeof docId === 'string' && (isMutation(method) || method === 'closeDocument'))
      annotBoxCache.drop(docId);
    return new Transfer(value, transferables(value, wasmMemory(m)?.buffer));
  },

  saveIncremental: async ({ docId, keepAll }) => {
    const r = await ready().tracker.save(docId, keepAll ? { keepAll } : {});
    const tail = r.tail.buffer;
    return new Transfer({ ...r, tail }, [tail]);
  },

  commitSave: ({ docId, tailLength, rewrite }) => ({
    baseLength: ready().tracker.commit(docId, tailLength, rewrite ?? false),
  }),

  snapshotTail: async ({ docId }) => {
    const r = await ready().tracker.snapshot(docId);
    const tail = r.tail.buffer;
    return new Transfer({ tail, baseLength: r.baseLength }, [tail]);
  },

  saveRewrite: ({ docId }) => {
    const bytes = ready().tracker.saveRewrite(docId).buffer;
    return new Transfer({ bytes }, [bytes]);
  },

  secureCopy: async ({ docId, action }, ctx) => {
    const { mod: m, native: n, tracker: t } = ready();
    const total = 2;
    const r = await secureCopy(m, n, t, docId, action, ctx.signal, (done) => {
      ctx.progress({ done, total });
    });
    const bytes = r.bytes.buffer;
    return new Transfer({ bytes, expected: r.expected }, [bytes]);
  },

  saveState: ({ docId }) => ready().tracker.dirtyState(docId),

  stageObjects: async ({ docId, target, set, remove }) => {
    const t = ready().tracker;
    await t.securityReady(docId);
    const values = new Map(Object.entries(set).map(([k, v]) => [k, fromJson(v)]));
    t.stagePatch(
      docId,
      target.annot === undefined
        ? { page: target.page }
        : target.field
          ? { page: target.page, annot: target.annot, field: true }
          : { page: target.page, annot: target.annot },
      values,
      remove ?? [],
    );
    return { staged: t.dirtyState(docId).staged };
  },

  docInfo: ({ docId }) => {
    const { mod: m, native: n } = ready();
    const doc = docPtrOf(n, docId);
    return {
      pageCount: rawCall(m, 'FPDF_GetPageCount', doc),
      permissions: rawCall(m, 'FPDF_GetDocPermissions', doc) >>> 0,
      securityRevision: rawCall(m, 'FPDF_GetSecurityHandlerRevision', doc),
      ownerUnlocked: Boolean(rawCall(m, 'EPDF_IsOwnerUnlocked', doc)),
      signatureCount: rawCall(m, 'FPDF_GetSignatureCount', doc),
      formType: rawCall(m, 'FPDF_GetFormType', doc),
    };
  },

  contentBox: ({ docId, pageIndex }) => {
    const { mod: m, native: n } = ready();
    const page = rawCall(m, 'FPDF_LoadPage', docPtrOf(n, docId), pageIndex);
    if (!page) throw new RpcError('page-not-loaded', 'The page could not be loaded');
    const buf = m.pdfium.wasmExports.malloc(16);
    try {
      // The visible page area (crop box ∩ media box) gives the top-left origin.
      const heap = m.pdfium as unknown as { getValue(ptr: number, type: 'float'): number };
      const f = (i: number): number => heap.getValue(buf + 4 * i, 'float');
      if (!rawCall(m, 'FPDF_GetPageBoundingBox', page, buf)) return null;
      const pageLeft = f(0);
      const pageTop = f(1);
      let left = Infinity;
      let bottom = Infinity;
      let right = -Infinity;
      let top = -Infinity;
      const count = rawCall(m, 'FPDFPage_CountObjects', page);
      for (let i = 0; i < count; i++) {
        const obj = rawCall(m, 'FPDFPage_GetObject', page, i);
        if (!obj || !rawCall(m, 'FPDFPageObj_GetBounds', obj, buf, buf + 4, buf + 8, buf + 12))
          continue;
        left = Math.min(left, f(0));
        bottom = Math.min(bottom, f(1));
        right = Math.max(right, f(2));
        top = Math.max(top, f(3));
      }
      if (!(right > left) || !(top > bottom)) return null;
      return {
        left: left - pageLeft,
        top: pageTop - top,
        right: right - pageLeft,
        bottom: pageTop - bottom,
      };
    } finally {
      m.pdfium.wasmExports.free(buf);
      rawCall(m, 'FPDF_ClosePage', page);
    }
  },

  annotationTile: ({ docId, frame, ...req }) => {
    const { mod: m, native: n } = ready();
    const boxes = annotBoxCache.get(docId, req.pageIndex, () => {
      const ref = acquirePage(n, docId, req.pageIndex);
      try {
        return annotBoxes(m, ref.pagePtr, frame);
      } finally {
        ref.release();
      }
    });
    const tile = renderAnnotTile(m, n, docId, boxes, req);
    return tile ? new Transfer(tile, [tile.data.buffer]) : null;
  },

  snapshot: ({ docId, ...req }) => {
    const { mod: m, native: n, tracker: t } = ready();
    // Rule 9: a snapshot copies the page's content (M6-09).
    t.requireCapability(docId, 'copy');
    const out = renderSnapshot(m, n, docId, req);
    return new Transfer(out, [out.data.buffer]);
  },

  fileAttachment: ({ docId, pageIndex, id }) => {
    const { mod: m, native: n } = ready();
    const out = readFileAttachment(m, n, docId, pageIndex, id);
    return new Transfer(out, [out.data]);
  },

  pageCost: ({ docId, pageIndex }) => {
    const { mod: m, native: n } = ready();
    const page = acquirePage(n, docId, pageIndex);
    try {
      const objects = rawCall(m, 'FPDFPage_CountObjects', page.pagePtr);
      let segments = 0;
      for (let i = 0; i < objects; i++) {
        const obj = rawCall(m, 'FPDFPage_GetObject', page.pagePtr, i);
        if (obj && rawCall(m, 'FPDFPageObj_GetType', obj) === FPDF_PAGEOBJ_PATH)
          segments += Math.max(0, rawCall(m, 'FPDFPath_CountSegments', obj));
      }
      return { objects, segments };
    } finally {
      page.release();
    }
  },

  renderProgressive: async ({ docId, pageIndex, scale, sliceMs }, ctx) => {
    const { mod: m, native: n } = ready();
    const page = acquirePage(n, docId, pageIndex);
    try {
      const size = {
        width: rawCall(m, 'FPDF_GetPageWidthF', page.pagePtr),
        height: rawCall(m, 'FPDF_GetPageHeightF', page.pagePtr),
      };
      const out = await renderProgressive(m, page.pagePtr, size, scale, ctx.signal, sliceMs);
      ctx.progress({ slices: out.slices });
      return new Transfer(out, [out.data.buffer]);
    } finally {
      page.release();
    }
  },

  memory: () => ({ wasmBytes: mod ? (wasmMemory(mod)?.buffer.byteLength ?? 0) : 0 }),

  pagesOp: async ({ docId, op }, ctx) => {
    const { mod: m, native: n, tracker: t } = ready();
    // Rule 9: page operations need assemble (ADR-016 d9); a flatten changes page
    // content and removes comments, so it needs modify and annotate (M6-09).
    if (op.kind === 'flatten') {
      t.requireCapability(docId, 'modify');
      t.requireCapability(docId, 'annotate');
    } else t.requireCapability(docId, 'assemble');
    let map: number[] | null = null;
    try {
      const r = await applyPageOp(m, n, docId, op, {
        signal: ctx.signal,
        progress: (p) => {
          ctx.progress(p);
        },
      });
      map = r.map;
      return r;
    } finally {
      // Even a cancelled (partial) operation changed the document: saves turn semantic.
      const known = map;
      t.pageOperation(docId, (old) => {
        if (!known) return old;
        const v = known[old];
        return v === undefined || v < 0 ? null : v;
      });
      annotBoxCache.drop(docId);
    }
  },

  pagesSnapshot: async ({ docId }) => ready().tracker.takeSnapshot(docId),

  pagesSource: async ({ bytes, password }) => {
    const { mod: m, native: n } = ready();
    return withSource(m, n, bytes, password, (src) => ({
      pageCount: src.pageCount,
      encrypted: src.encrypted,
      fullAccess: src.fullAccess,
    }));
  },

  pagesRestore: async ({ docId, token }) => {
    const { mod: m, native: n, tracker: t } = ready();
    await t.restore(docId, token);
    annotBoxCache.drop(docId);
    return { pages: pageInfos(m, n, docId) };
  },

  pagesApply: async ({ docId, objects, firstNew, capability }) => {
    const { mod: m, native: n, tracker: t } = ready();
    await t.applyObjects(docId, objects, firstNew, capability ?? 'annotate');
    annotBoxCache.drop(docId);
    return { pages: pageInfos(m, n, docId) };
  },

  pagesDrop: ({ tokens }) => {
    ready().tracker.dropSnapshots(tokens);
    return null;
  },
});
