// M4-01 spike, viewer side (ADR-016): what EmbedPDF 2.15.1's headless plugins
// do when a document's page list changes under them. The same plugins as
// src/features/view/plugins.ts that hold per-page state (document manager,
// viewport, scroll, history, annotation), run in Node over PdfiumNative with
// the PdfEngine orchestrator. Probes: is there an action that replaces the
// page list; what re-dispatching SET_DOCUMENT_LOADED does to scroll,
// annotations and the undo timeline; what an undo does afterwards.
//
//   node --import ./spikes/shared/ts-ext.ts spikes/s14-pages/plugins-node.ts
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { PluginRegistry, setDocumentLoaded, refreshDocument, setPages } from '@embedpdf/core';
import { PdfEngine, PdfiumNative } from '@embedpdf/engines/pdfium';
import { PdfAnnotationSubtype, type PdfDocumentObject } from '@embedpdf/models';
import { init } from '@embedpdf/pdfium';
import { AnnotationPluginPackage, type AnnotationPlugin } from '@embedpdf/plugin-annotation';
import {
  DocumentManagerPluginPackage,
  type DocumentManagerPlugin,
} from '@embedpdf/plugin-document-manager';
import { HistoryPluginPackage, type HistoryPlugin } from '@embedpdf/plugin-history';
import { InteractionManagerPluginPackage } from '@embedpdf/plugin-interaction-manager';
import { ScrollPluginPackage } from '@embedpdf/plugin-scroll';
import { SelectionPluginPackage } from '@embedpdf/plugin-selection';
import { ViewportPluginPackage } from '@embedpdf/plugin-viewport';
import { buildPdf, type PdfObject } from '../../e2e/fixtures/generate.ts';
import { docPtrOf, rawCall } from '../../src/workers/render/pdfium.ts';
import { FPDF_INCREMENTAL, saveWithFlags } from '../../src/workers/render/save/writer.ts';

// The plugins use window timers and requestAnimationFrame; Node has neither.
Object.assign(globalThis, {
  window: globalThis,
  requestAnimationFrame: (f: (t: number) => void) =>
    setTimeout(() => {
      f(performance.now());
    }, 16),
  cancelAnimationFrame: (id: number) => {
    clearTimeout(id);
  },
});
const require = createRequire(import.meta.url);
const mod = await init({
  wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')),
});
const native = new PdfiumNative(mod, { fontFallback: null });
const engine = new PdfEngine(native, {
  imageConverter: () => Promise.resolve(new Blob()),
});
const out: Record<string, unknown> = {};
const tick = () => new Promise((r) => setTimeout(r, 50));

/** 6 pages "Page n"; a Square annotation (NM sq-4) on page 4. */
function fixture(): Uint8Array {
  const objs: PdfObject[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: 6 }, (_, i) => `${String(3 + i * 2)} 0 R`).join(' ')}] /Count 6 >>`,
  ];
  for (let i = 0; i < 6; i++) {
    const annots = i === 3 ? ' /Annots [16 0 R]' : '';
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 15 0 R >> >> /Contents ${String(4 + i * 2)} 0 R${annots} >>`,
      { dict: '<< >>', stream: `BT /F1 36 Tf 72 740 Td (Page ${String(i + 1)}) Tj ET` },
    );
  }
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objs.push(
    '<< /Type /Annot /Subtype /Square /Rect [100 100 200 200] /C [1 0 0] /NM (sq-4) /T (Owner) /Contents (on page 4) /P 9 0 R >>',
  );
  return buildPdf(objs);
}

const registry = new PluginRegistry(engine);
registry.registerPlugin(DocumentManagerPluginPackage, { maxDocuments: 4 });
registry.registerPlugin(ViewportPluginPackage, { viewportGap: 10 });
registry.registerPlugin(ScrollPluginPackage, { defaultPageGap: 10 });
registry.registerPlugin(InteractionManagerPluginPackage, {});
registry.registerPlugin(SelectionPluginPackage, {});
registry.registerPlugin(HistoryPluginPackage, {});
registry.registerPlugin(AnnotationPluginPackage, { autoCommit: true });
await registry.initialize();

const store = registry.getStore();
const need = <T>(p: T | null): T => {
  if (!p) throw new Error('plugin missing');
  return p;
};
const dm = need(registry.getPlugin<DocumentManagerPlugin>('document-manager')).provides();
const annot = need(registry.getPlugin<AnnotationPlugin>('annotation')).provides();
const history = need(registry.getPlugin<HistoryPlugin>('history')).provides();

const bytes = fixture();
const opened = await dm
  .openDocumentBuffer({ buffer: bytes.slice().buffer, name: 'fixture.pdf', documentId: 'doc' })
  .toPromise();
for (let i = 0; i < 40 && store.getState().core.documents.doc?.status !== 'loaded'; i++)
  await tick();
await tick();
const scope = annot.forDocument('doc');
const where = () => {
  const s = scope.getState();
  const rows: Record<string, string[]> = {};
  for (const [page, uids] of Object.entries(s.pages))
    rows[page] = uids.map((u) => {
      const t = s.byUid[u];
      return `${String(t?.object.id)}@${String(t?.object.pageIndex)}:${String(t?.commitState)}`;
    });
  return rows;
};
const scrollPages = () =>
  (
    store.getState().plugins as Record<
      string,
      { documents?: Record<string, { totalPages?: number }> }
    >
  ).scroll?.documents?.doc?.totalPages;

out.opened = { id: opened.documentId, annotations: where(), scrollTotal: scrollPages() };
out.actionsInReducer = {
  refreshDocument: typeof refreshDocument === 'function',
  setPages: typeof setPages === 'function',
  note: 'core reducer 2.15.1 has no case for REFRESH_DOCUMENT or SET_PAGES (checked in dist)',
};

// An edit before the page operation: a new square on page 5 (index 4).
scope.createAnnotation(4, {
  id: 'new-5',
  type: PdfAnnotationSubtype.SQUARE,
  pageIndex: 4,
  rect: { origin: { x: 50, y: 50 }, size: { width: 40, height: 40 } },
  color: '#00FF00',
  strokeColor: '#00FF00',
  strokeWidth: 1,
  opacity: 1,
} as never);
for (let i = 0; i < 10; i++) await tick();
out.afterCreate = {
  annotations: where(),
  canUndo: history.forDocument('doc').canUndo(),
};

// REFRESH_DOCUMENT with the same object: does anything happen?
const doc0 = need(store.getState().core.documents.doc?.document ?? null);
store.dispatch(refreshDocument('doc', doc0));
out.refreshDocumentNoop = store.getState().core.documents.doc?.document === doc0;

// The page operation: delete page 1 (index 0) in PDFium, then a new document
// object with re-indexed pages, re-dispatched as SET_DOCUMENT_LOADED.
// Undo snapshot first (M4-Q1): the document as it is before the operation.
const snapshot = saveWithFlags(mod, docPtrOf(native, 'doc'), FPDF_INCREMENTAL);
rawCall(mod, 'FPDFPage_Delete', docPtrOf(native, 'doc'), 0);
const pages = doc0.pages.slice(1).map((p, i) => ({ ...p, index: i }));
const doc1: PdfDocumentObject = { ...doc0, pageCount: pages.length, pages };
const actions: string[] = [];
const unsub = store.subscribe((a: { type: string }, st: { plugins: Record<string, unknown> }) => {
  const ann = (
    st.plugins.annotation as { documents: Record<string, { byUid: object }> } | undefined
  )?.documents.doc;
  actions.push(`${a.type}:${String(ann ? Object.keys(ann.byUid).length : -1)}`);
});
const t0 = performance.now();
store.dispatch(setDocumentLoaded('doc', doc1));
const dispatchMs = Math.round((performance.now() - t0) * 100) / 100;
for (let i = 0; i < 10; i++) await tick();
out.afterRedispatch = {
  dispatchMs,
  scrollTotal: scrollPages(),
  annotations: where(),
  canUndo: history.forDocument('doc').canUndo(),
  rawPages: scope.getState().pages,
  actions: (unsub(), actions),
  byUidKeys: Object.keys(scope.getState().byUid),
  note: 'annotation plugin reloads via getAllAnnotations on SET_DOCUMENT_LOADED',
};

// Workaround: empty the annotation store first, then re-dispatch.
const clear = {
  type: 'ANNOTATION/SET_ANNOTATIONS',
  payload: { documentId: 'doc', annotations: {} },
};
store.dispatch(clear);
store.dispatch(setDocumentLoaded('doc', { ...doc1 }));
for (let i = 0; i < 10; i++) await tick();
out.afterClearAndRedispatch = { annotations: where() };

// Undo of the page operation (M4-Q1 route): reopen the snapshot under the same
// id, re-dispatch the old page list; then undo the earlier create.
const t1 = performance.now();
await native.closeDocument(doc1).toPromise();
await native.openDocumentBuffer({ id: 'doc', content: snapshot.slice().buffer }).toPromise();
const reopenMs = Math.round((performance.now() - t1) * 100) / 100;
store.dispatch(clear);
store.dispatch(setDocumentLoaded('doc', { ...doc0 }));
for (let i = 0; i < 10; i++) await tick();
out.afterPageOpUndo = {
  reopenMs,
  annotations: where(),
  canUndo: history.forDocument('doc').canUndo(),
};

// Undo the earlier create: with the old page list back, it targets the right page.
history.forDocument('doc').undo();
for (let i = 0; i < 10; i++) await tick();
const p = (i: number) => {
  const page = rawCall(mod, 'FPDF_LoadPage', docPtrOf(native, 'doc'), i);
  const n = rawCall(mod, 'FPDFPage_GetAnnotCount', page);
  rawCall(mod, 'FPDF_ClosePage', page);
  return n;
};
out.afterUndo = {
  annotations: where(),
  pdfiumAnnotCounts: Array.from({ length: 6 }, (_, i) => p(i)),
};

mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
writeFileSync(new URL('./out/s14-plugins.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(0);
