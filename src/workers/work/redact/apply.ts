// Apply redactions (M4-17/18, §7.9 steps 2–5, ADR-017): on a separately opened
// copy of the current state (original + saved tail + unsaved edits, ADR-013),
// never the open document. Per page with /Redact marks: crossing paths re-cut
// (pathRecut.ts), EmbedPDF's EPDFPage_ApplyRedactions (text, images, paths
// inside; the marks go, their fill is painted), annotations over the areas
// removed; then PDFium's full rewrite, our sanitize, a second full rewrite
// (one revision, the source's encryption kept, M4-Q4); then the output is
// reopened and verified by location, by string and by structure. Progress
// per page and cancel between pages (rules 1, 2). The caller writes the bytes
// only when no leak was found (rule 8).
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { PdfDocumentObject } from '@embedpdf/models';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { isDict, nameOf, PdfRef } from '../../../model/pdf/objects';
import { PdfReader } from '../../../model/pdf/reader';
import { docPtrOf, rawCall } from '../../render/pdfium';
import { FPDF_NO_INCREMENTAL, saveWithFlags } from '../../render/save/writer';
import type { JobSlice } from '../scheduler';
import { overlaps, type Rect } from './geometry';
import { emptyRecut, recutPaths, type RecutReport } from './pathRecut';
import { sanitize, type SanitizeReport } from './sanitize';
import { Verifier, wordsToSearch, type Leak } from './verify';

const REDACT = 28; // FPDF_ANNOT_REDACT
const WIDGET = 20;

/** e2e only: leave out one step, so the verification failure path can be tested (M4-18). */
export type SkipStep = 'recut' | 'annotations' | 'sanitize';

export interface RedactProgress {
  phase: 'apply' | 'verify';
  done: number;
  total: number;
}

export interface RedactOutcome {
  /** The redacted file; the caller writes it only when `leaks` is empty. */
  bytes: Uint8Array<ArrayBuffer>;
  marks: number;
  /** 0-based pages that had marks. */
  pages: number[];
  removedAnnotations: number;
  recut: RecutReport;
  sanitize: SanitizeReport;
  /** Redacted words searched for in the output (count only leaves the worker). */
  searched: number;
  leaks: Leak[];
}

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  getValue(ptr: number, t: 'float'): number;
}

let seq = 0;

/** The redacted areas per page index: each mark's quads, else its rectangle. */
export function redactAreas(mod: WrappedPdfiumModule, docPtr: number): Map<number, Rect[]> {
  const heap = mod.pdfium as unknown as Heap;
  const call = (name: string, ...a: number[]) => rawCall(mod, name, ...a);
  const out = new Map<number, Rect[]>();
  const pages = call('FPDF_GetPageCount', docPtr);
  const p = heap.wasmExports.malloc(32);
  try {
    for (let i = 0; i < pages; i++) {
      const page = call('FPDF_LoadPage', docPtr, i);
      const n = call('FPDFPage_GetAnnotCount', page);
      for (let k = 0; k < n; k++) {
        const a = call('FPDFPage_GetAnnot', page, k);
        if (call('FPDFAnnot_GetSubtype', a) === REDACT) {
          const list = out.get(i) ?? [];
          const quads = call('FPDFAnnot_CountAttachmentPoints', a);
          for (let q = 0; q < quads; q++)
            if (call('FPDFAnnot_GetAttachmentPoints', a, q, p)) {
              const v = Array.from({ length: 8 }, (_, j) => heap.getValue(p + j * 4, 'float'));
              const xs = [v[0], v[2], v[4], v[6]].map((x) => x ?? 0);
              const ys = [v[1], v[3], v[5], v[7]].map((y) => y ?? 0);
              list.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
            }
          if (quads === 0 && call('FPDFAnnot_GetRect', a, p)) {
            const [l, t, r, b] = [0, 1, 2, 3].map((j) => heap.getValue(p + j * 4, 'float'));
            list.push([l ?? 0, Math.min(t ?? 0, b ?? 0), r ?? 0, Math.max(t ?? 0, b ?? 0)]);
          }
          out.set(
            i,
            list.filter((r) => r[2] - r[0] > 0.1 && r[3] - r[1] > 0.1),
          );
        }
        call('FPDFPage_CloseAnnot', a);
      }
      call('FPDF_ClosePage', page);
    }
  } finally {
    heap.wasmExports.free(p);
  }
  for (const [k, v] of out) if (v.length === 0) out.delete(k);
  return out;
}

export async function applyRedactions(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  source: Uint8Array,
  password: string | undefined,
  slice: JobSlice,
  progress: (p: RedactProgress) => void,
  skip?: SkipStep,
): Promise<RedactOutcome> {
  const call = (name: string, ...a: number[]) => rawCall(mod, name, ...a);
  const heap = mod.pdfium as unknown as Heap;
  const open = (bytes: Uint8Array) =>
    native
      .openDocumentBuffer(
        { id: `redact-${String(++seq)}`, content: bytes.slice().buffer },
        password === undefined ? {} : { password },
      )
      .toPromise();
  const close = (d: PdfDocumentObject) => native.closeDocument(d).toPromise();
  const verifier = new Verifier(mod);

  // 1. The copy: areas, the words inside them (for the string rule), the source text.
  const doc = await open(source);
  let output: Uint8Array<ArrayBuffer>;
  let areas: Map<number, Rect[]>;
  let search: string[];
  let marks = 0;
  let removedAnnotations = 0;
  const recut = emptyRecut();
  const removedWidgets = new Set<number>();
  const byPageObj = new Map<number, Rect[]>();
  try {
    const d = docPtrOf(native, doc.id);
    areas = redactAreas(mod, d);
    const pages = [...areas.keys()];
    const total = pages.length * 2;
    const words: string[] = [];
    for (const [i, rs] of areas) {
      await slice.checkpoint();
      const page = call('FPDF_LoadPage', d, i);
      words.push(...verifier.textInRects(i, page, rs, []));
      call('FPDF_ClosePage', page);
    }
    search = wordsToSearch(verifier.documentText(d), words);

    // 2. Per page: re-cut crossing paths, apply, remove annotations over the areas.
    const box = heap.wasmExports.malloc(16);
    try {
      for (const [n, [i, rs]] of [...areas].entries()) {
        await slice.checkpoint();
        const page = call('FPDF_LoadPage', d, i);
        marks += countRedacts(call, page);
        if (skip !== 'recut') recutPaths(mod, page, rs, recut);
        call('EPDFPage_ApplyRedactions', page);
        call('FPDFPage_GenerateContent', page);
        byPageObj.set(call('EPDFPage_GetObjectNumber', page), rs);
        if (skip !== 'annotations')
          for (let k = call('FPDFPage_GetAnnotCount', page) - 1; k >= 0; k--) {
            const a = call('FPDFPage_GetAnnot', page, k);
            let drop = false;
            if (call('FPDFAnnot_GetRect', a, box)) {
              const [l, t, r, b] = [0, 1, 2, 3].map((j) => heap.getValue(box + j * 4, 'float'));
              const ab: Rect = [l ?? 0, Math.min(t ?? 0, b ?? 0), r ?? 0, Math.max(t ?? 0, b ?? 0)];
              drop = rs.some((rc) => overlaps(ab, rc));
              if (drop && call('FPDFAnnot_GetSubtype', a) === WIDGET)
                removedWidgets.add(call('EPDFAnnot_GetObjectNumber', a));
            }
            call('FPDFPage_CloseAnnot', a);
            if (drop && call('FPDFPage_RemoveAnnot', page, k)) removedAnnotations++;
          }
        call('FPDF_ClosePage', page);
        progress({ phase: 'apply', done: n + 1, total });
      }
    } finally {
      heap.wasmExports.free(box);
    }
    output = saveWithFlags(mod, d, FPDF_NO_INCREMENTAL);
  } finally {
    await close(doc);
  }

  // 3. Sanitize, then PDFium rewrites once more: one revision, unreferenced objects gone.
  await slice.checkpoint();
  let report: SanitizeReport = { removed: [], outlineItemsRemoved: 0, fieldsRemoved: 0 };
  if (skip !== 'sanitize') {
    const s = await sanitize(output, byPageObj, removedWidgets, password);
    report = s.report;
    const doc2 = await open(s.bytes);
    try {
      output = saveWithFlags(mod, docPtrOf(native, doc2.id), FPDF_NO_INCREMENTAL);
    } finally {
      await close(doc2);
    }
  }

  // 4. Verify the output as written.
  const leaks: Leak[] = [];
  const pages = [...areas.keys()];
  const doc3 = await open(output);
  try {
    const d = docPtrOf(native, doc3.id);
    for (const [n, [i, rs]] of [...areas].entries()) {
      await slice.checkpoint();
      const page = call('FPDF_LoadPage', d, i);
      verifier.textInRects(i, page, rs, leaks);
      verifier.objectsInRects(i, page, rs, leaks);
      verifier.annotsInRects(i, page, rs, leaks);
      call('FPDF_ClosePage', page);
      progress({ phase: 'verify', done: pages.length + n + 1, total: pages.length * 2 });
    }
    // A page whose marks did not all go (e.g. a mark the engine could not apply).
    for (const i of pages) {
      const page = call('FPDF_LoadPage', d, i);
      if (countRedacts(call, page) > 0) leaks.push({ page: i, kind: 'annotation' });
      call('FPDF_ClosePage', page);
    }
    const text = verifier.documentText(d);
    if (search.some((w) => text.includes(w))) leaks.push({ page: -1, kind: 'string' });
  } finally {
    await close(doc3);
  }
  if (await structureLeaks(output, password)) leaks.push({ page: -1, kind: 'structure' });
  return {
    bytes: output,
    marks,
    pages,
    removedAnnotations,
    recut,
    sanitize: report,
    searched: search.length,
    leaks,
  };
}

function countRedacts(call: (name: string, ...a: number[]) => number, page: number): number {
  let n = 0;
  const count = call('FPDFPage_GetAnnotCount', page);
  for (let k = 0; k < count; k++) {
    const a = call('FPDFPage_GetAnnot', page, k);
    if (call('FPDFAnnot_GetSubtype', a) === REDACT) n++;
    call('FPDFPage_CloseAnnot', a);
  }
  return n;
}

/** More than one revision, or document data the sanitize step must have removed. */
export async function structureLeaks(bytes: Uint8Array, password?: string): Promise<boolean> {
  const tail = new TextDecoder('latin1').decode(bytes);
  if ((tail.match(/startxref/gu) ?? []).length !== 1) return true;
  const r = await PdfReader.open(bytes, undefined, password ? { password } : {});
  const info = await r.resolve(r.trailer.get('Info'));
  if (isDict(info) && info.size > 0) return true;
  const rootRef = r.trailer.get('Root');
  const root = rootRef instanceof PdfRef ? await r.get(rootRef) : undefined;
  if (!isDict(root)) return true;
  for (const k of ['Metadata', 'StructTreeRoot', 'PieceInfo']) if (root.has(k)) return true;
  const open = await r.resolve(root.get('OpenAction'));
  if (isDict(open) && nameOf(open.get('S')) === 'JavaScript') return true;
  const names = await r.resolve(root.get('Names'));
  if (isDict(names) && (names.has('JavaScript') || names.has('EmbeddedFiles'))) return true;
  for (const { dict } of await r.pages())
    if (dict.has('Thumb') || dict.has('PieceInfo')) return true;
  return false;
}
