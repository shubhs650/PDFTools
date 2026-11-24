// Render worker (ARCHITECTURE §3.1, D-10, ADR-004 decision 2): PDFium #1 with
// EmbedPDF's PdfiumNative executor, hosted in our own module so direct PDFium
// calls are possible (ADR-001 B14). The main thread drives it through
// EmbedPDF's PdfEngine (src/engine/hostedEngine.ts) over our typed RPC.
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import {
  PDF_FORM_FIELD_FLAG,
  PdfErrorCode,
  TaskRejectedError,
  type PdfDocumentObject,
  type Task,
} from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { RpcError } from '../engine/errors';
import { Transfer } from '../engine/protocol';
import { PDFIUM_ERROR_PREFIX, type RenderApi } from '../engine/renderApi';
import { fromJson } from '../model/pdf/wire';
import { serve, type Handlers } from './rpc-host';
import { CallOrder } from './render/callOrder';
import {
  acquirePage,
  docPtrOf,
  isNormalized,
  pageInfo,
  pageInfos,
  rawCall,
  wasmMemory,
} from './render/pdfium';
import { applyPageOp, withSource } from './render/pages';
import { renderProgressive } from './render/progressive';
import { AnnotBoxCache, annotBoxes, renderAnnotTile } from './render/annotTiles';
import { renderSnapshot } from './render/snapshot';
import { OverlayTiles, displayedSize } from './render/overlayTiles';
import { imageUnder } from './shared/pageImages';
import { dropCustom, keepAuthor, nameTargets, writeMarkupIntent } from './render/annotIds';
import { installFontReadback } from './render/freeTextFonts';
import { applyTextColors, takeTextColorFallbacks } from './render/freeTextColors';
import subsetWasmUrl from 'harfbuzzjs/dist/harfbuzz-subset.wasm?url';
import {
  applyCommentFont,
  commentFontOf,
  prepareCommentFont,
  takeCommentFontFallbacks,
} from './render/commentFonts/apply';
import { FaceStore, workerFontSource } from './render/commentFonts/faces';
import { SaveTracker, isMutation } from './render/save/tracker';
import {
  createFileAttachment,
  isFileAttachmentCall,
  readFileAttachment,
  updateFileAttachment,
} from './render/fileAttach';
import { secureCopy } from './render/security';
import { listNotePopups, placeNotePopup, removePopupOf } from './render/notePopups';

const FPDF_PAGEOBJ_PATH = 2;
/** `FPDF_GetFormType` for a dynamic (full) XFA form: nothing to fill (M2-14). */
const FORMTYPE_XFA_FULL = 2;
/** Calls that change a field's value (M2-14 read-only and XFA guard). */
const FORM_VALUE_METHODS = new Set(['setFormFieldValue', 'setFormFieldState']);

let mod: WrappedPdfiumModule | undefined;
let native: PdfiumNative | undefined;
let tracker: SaveTracker | undefined;
const annotBoxCache = new AnnotBoxCache();
const overlayTiles = new OverlayTiles();
/** Layer copies the overlay draws from (comparison layer switches, D-59, Q24). */
const layerCopies = new Map<string, PdfDocumentObject>();

/** One macrotask: a cancel sent behind a burst of tile requests is read before they draw. */
const nextTask = (): Promise<void> =>
  new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(null);
  });
/** The font library's faces (M11-07, D-52), loaded on first use from our own origin. */
const commentFaces = new FaceStore(
  workerFontSource(self.location.origin, new URL(subsetWasmUrl, self.location.href).href),
);

/** An executor call that draws a text comment in a library font (its faces may load first). */
function blocksForFont(args: unknown): boolean {
  const { method, args: a } = args as { method?: unknown; args?: unknown };
  return typeof method === 'string' && Array.isArray(a) && commentFontOf(method, a) !== null;
}

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

const handlers: Handlers<RenderApi> = {
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
    // A comment's pop-up goes with it (M7-06): EmbedPDF removes only the comment.
    if (method === 'removePageAnnotation' && typeof docId === 'string') {
      const page = (callArgs[1] as { index?: unknown } | undefined)?.index;
      const id = (callArgs[2] as { id?: unknown } | undefined)?.id;
      if (typeof page === 'number' && typeof id === 'string') removePopupOf(m, n, docId, page, id);
    }
    // A text comment in a library font (M11-07): its faces are loaded before PDFium draws it.
    const faces =
      typeof docId === 'string' ? await prepareCommentFont(commentFaces, method, callArgs) : null;
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
    if (typeof docId === 'string') {
      writeMarkupIntent(m, n, method, callArgs);
      // A text comment's own text colour, in /DS and its appearance (ADR-024).
      applyTextColors(m, n, method, callArgs, faces !== null);
      // Its text in a library font, shaped and embedded (M11-07, D-52).
      applyCommentFont(m, n, method, callArgs, faces);
    }
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
    // Text comments whose appearance kept PDFium's colours (ADR-024): a count for diagnostics.
    const textColorFallbacks = takeTextColorFallbacks(docId);
    // Text comments whose library font could not be drawn (M11-07): a count for diagnostics.
    const commentFontFallbacks = takeCommentFontFallbacks(docId);
    return new Transfer({ ...r, tail, textColorFallbacks, commentFontFallbacks }, [tail]);
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

  // Copy Image / Save Image As (M11-08·O6): the page menu's hit test, on the live page.
  imageAt: ({ docId, pageIndex, x, y }) => {
    const { mod: m, native: n } = ready();
    const ref = acquirePage(n, docId, pageIndex);
    try {
      const hit = imageUnder(m, ref.pagePtr, { x, y });
      return hit ? { width: hit.width, height: hit.height } : null;
    } finally {
      ref.release();
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

  overlayFrame: ({ docId, pageIndex }) => {
    const { mod: m, native: n } = ready();
    return displayedSize(m, n, docId, pageIndex);
  },

  overlayTile: async (req, ctx) => {
    const { mod: m, native: n } = ready();
    // Requests of a zoom or a sheet the view has left are cancelled before they draw (S29).
    await nextTask();
    ctx.throwIfAborted();
    const rgba = overlayTiles.render(m, n, req, ctx.signal);
    const bitmap = await createImageBitmap(new ImageData(rgba, req.width, req.height));
    return new Transfer({ bitmap, cachedBytes: overlayTiles.cachedBytes }, [bitmap]);
  },

  overlayRelease: ({ docIds }) => {
    for (const d of docIds) overlayTiles.drop(d);
    return null;
  },

  overlayCopyOpen: async ({ copyId, bytes }) => {
    const { native: n } = ready();
    if (layerCopies.has(copyId)) throw new RpcError('copy-open', 'The layer copy is already open');
    let doc: PdfDocumentObject;
    try {
      // Like the app's own copies (normalized rotation): the overlay's frames match.
      doc = await n
        .openDocumentBuffer({ id: copyId, content: bytes }, { normalizeRotation: true })
        .toPromise();
    } catch (err) {
      throw toRpcError(err);
    }
    layerCopies.set(copyId, doc);
    return { pageCount: doc.pageCount };
  },

  overlayCopyClose: async ({ copyIds }) => {
    const { native: n } = ready();
    for (const id of copyIds) {
      const doc = layerCopies.get(id);
      overlayTiles.drop(id);
      if (!doc) continue;
      layerCopies.delete(id);
      await n
        .closeDocument(doc)
        .toPromise()
        .catch(() => undefined);
    }
    return null;
  },

  snapshot: ({ docId, ...req }) => {
    const { mod: m, native: n, tracker: t } = ready();
    // Rule 9: a snapshot copies the page's content (M6-09).
    t.requireCapability(docId, 'copy');
    const out = renderSnapshot(m, n, docId, req);
    return new Transfer(out, [out.data.buffer]);
  },

  loupe: async ({ docId, ...req }, ctx) => {
    const { mod: m, native: n } = ready();
    // A spot the pointer has already left is cancelled before it draws (one in flight).
    await nextTask();
    ctx.throwIfAborted();
    // On screen only, as the page itself (no copy permission needed, unlike a snapshot).
    const out = renderSnapshot(m, n, docId, req);
    const bitmap = await createImageBitmap(new ImageData(out.data, out.width, out.height));
    return new Transfer({ bitmap }, [bitmap]);
  },

  fileAttachment: ({ docId, pageIndex, id }) => {
    const { mod: m, native: n } = ready();
    const out = readFileAttachment(m, n, docId, pageIndex, id);
    return new Transfer(out, [out.data]);
  },

  notePopups: ({ docId, pageIndex }) => {
    const { mod: m, native: n } = ready();
    const doc = { id: docId, normalizedRotation: isNormalized(n, docId) };
    return { popups: listNotePopups(m, n, doc, pageInfo(m, n, docId, pageIndex)) };
  },

  setNotePopup: async ({ docId, pageIndex, noteId, rect, open }) => {
    const { mod: m, native: n, tracker: t } = ready();
    // Rule 9: a pop-up is part of the comment.
    t.checkAllowed('updatePageAnnotation', docId);
    await t.securityReady(docId);
    const doc = { id: docId, normalizedRotation: isNormalized(n, docId) };
    const page = pageInfo(m, n, docId, pageIndex);
    const r = placeNotePopup(m, n, doc, page, noteId, rect);
    // The page's /Annots and the note's /Popup (a new pop-up), the pop-up itself.
    t.recordMutation('updatePageAnnotation', [doc, page, { id: noteId }]);
    t.recordMutation('updatePageAnnotation', [doc, page, { id: r.popupId }]);
    t.stagePatch(docId, { page: pageIndex, annot: r.popupId }, new Map([['Open', open]]));
    return r;
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
    // A crop changes how pages show, not which pages there are: modify (M11-08·O9).
    if (op.kind === 'flatten') {
      t.requireCapability(docId, 'modify');
      t.requireCapability(docId, 'annotate');
    } else if (op.kind === 'crop') t.requireCapability(docId, 'modify');
    else t.requireCapability(docId, 'assemble');
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
      overlayTiles.drop(docId);
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
    overlayTiles.drop(docId);
    return { pages: pageInfos(m, n, docId) };
  },

  pagesApply: async ({ docId, objects, firstNew, capability }) => {
    const { mod: m, native: n, tracker: t } = ready();
    await t.applyObjects(docId, objects, firstNew, capability ?? 'annotate');
    annotBoxCache.drop(docId);
    overlayTiles.drop(docId);
    return { pages: pageInfos(m, n, docId) };
  },

  pagesDrop: ({ tokens }) => {
    ready().tracker.dropSnapshots(tokens);
    return null;
  },
};

/**
 * Every call in arrival order across a comment font's loading (M11-07): a save
 * or an edit sent after a comment in a library font never overtakes it.
 */
const order = new CallOrder();
const inOrder = Object.fromEntries(
  Object.entries(handlers).map(([name, h]) => [
    name,
    (args: unknown, ctx: unknown) =>
      order.run(
        () => (h as (a: unknown, c: unknown) => unknown)(args, ctx),
        name === 'exec' && blocksForFont(args),
      ),
  ]),
) as unknown as Handlers<RenderApi>;
serve<RenderApi>(self, inOrder);
