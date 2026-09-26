// Save state per open document in the Render worker (M1-20, ADR-005, rules 7
// and 9). Wraps the executor calls the main thread makes:
//   - before a mutating call: refuse it if the document's permission flags
//     forbid it (rule 9; bit 6 annotations/forms, bit 9 form filling, bit 4
//     other changes);
//   - after it: record the existing objects it changed (the dirty set the
//     narrow tail keeps), or mark the document "untracked" so the next save
//     keeps every object PDFium appends (always correct, just larger).
// Saves: `saveIncremental` returns the narrow tail against the file as last
// saved; `commit` makes that tail the new base after it was written (M1-22).
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { PdfErrorCode } from '@embedpdf/models';
import { RpcError } from '../../../engine/errors';
import {
  ANNOTATION_METHODS,
  FORM_METHODS,
  OTHER_MUTATIONS,
  isMutation,
} from '../../../engine/mutations';
import { PDFIUM_ERROR_PREFIX } from '../../../engine/renderApi';
import { acquirePage, docPtrOf, rawCall, withWideString } from '../pdfium';
import { latin1 } from './bytes';
import { digestDocument, uncheckNames, type DocDigest } from './digest';
import { narrowTail, type ExtraObject } from './narrowTail';
import { FPDF_INCREMENTAL, FPDF_NO_INCREMENTAL, saveWithFlags } from './writer';
import { saveBaseOf, trailerRef, type SaveBase } from './xref';

/** ISO 32000-1 Table 22 permission bits. */
const PERM_MODIFY = 1 << 3; // bit 4
const PERM_ANNOTATE = 1 << 5; // bit 6
const PERM_FILL_FORMS = 1 << 8; // bit 9

export { ANNOTATION_METHODS, FORM_METHODS, OTHER_MUTATIONS, isMutation };

interface DocState {
  /** Length of the bytes PDFium opened: its incremental output appends after this. */
  openedLength: number;
  /**
   * Undefined when the opened file's trailer could not be read (PDFium repaired
   * it on open): an incremental save needs a valid /Prev, so only a rewrite works.
   */
  base: SaveBase | undefined;
  /** Existing objects changed since the base → sequence number of the last change. */
  dirty: Map<number, number>;
  /** Pages with changes since the base → sequence number (the pages a save verifies). */
  pages: Map<number, number>;
  /** Sequence numbers of the last mutation that set each flag (0 = not set). */
  formEdited: number;
  infoEdited: number;
  untracked: number;
  /** Increments on every recorded mutation. */
  seq: number;
  pending?: { next: SaveBase; tailLength: number; seq: number };
}

export interface IncrementalSave {
  /** Bytes to append to the file as last saved; empty when nothing changed. */
  tail: Uint8Array<ArrayBuffer>;
  mode: 'narrow' | 'keep-all';
  kept: number[];
  dropped: number;
  /** Length of the file this tail appends to. */
  baseLength: number;
  /**
   * What the saved file must show on the changed pages (all pages after an
   * untracked change), for the Work worker's check (M1-21). Null when the
   * tail is empty.
   */
  expected: DocDigest | null;
}

interface DocRef {
  id: string;
}
interface PageRef {
  index: number;
}
interface AnnotRef {
  id?: string;
}

function readBase(bytes: Uint8Array): SaveBase | undefined {
  try {
    return saveBaseOf(bytes);
  } catch {
    return undefined;
  }
}

export class SaveTracker {
  private readonly docs = new Map<string, DocState>();
  private readonly mod: WrappedPdfiumModule;
  private readonly native: PdfiumNative;

  constructor(mod: WrappedPdfiumModule, native: PdfiumNative) {
    this.mod = mod;
    this.native = native;
  }

  /** The bytes a document was opened from (their newest trailer is read, nothing kept). */
  opened(docId: string, bytes: Uint8Array): void {
    this.docs.set(docId, {
      openedLength: bytes.length,
      base: readBase(bytes),
      dirty: new Map(),
      pages: new Map(),
      formEdited: 0,
      infoEdited: 0,
      untracked: 0,
      seq: 0,
    });
  }

  closed(docId: string): void {
    this.docs.delete(docId);
  }

  has(docId: string): boolean {
    return this.docs.has(docId);
  }

  permissions(docId: string): number {
    return rawCall(this.mod, 'FPDF_GetDocPermissions', docPtrOf(this.native, docId)) >>> 0;
  }

  /** Throws before a mutation the document's permissions forbid (rule 9). */
  checkAllowed(method: string, docId: string): void {
    if (!isMutation(method)) return;
    const p = this.permissions(docId);
    const ok = ANNOTATION_METHODS.has(method)
      ? (p & PERM_ANNOTATE) !== 0
      : FORM_METHODS.has(method)
        ? (p & (PERM_ANNOTATE | PERM_FILL_FORMS)) !== 0
        : (p & PERM_MODIFY) !== 0;
    if (!ok) {
      throw new RpcError(
        `${PDFIUM_ERROR_PREFIX}${String(PdfErrorCode.Security)}`,
        'The document does not allow this change',
      );
    }
  }

  /** Records what a successful mutating call changed. */
  recordMutation(method: string, args: readonly unknown[]): void {
    const doc = args[0] as DocRef | undefined;
    const state = doc ? this.docs.get(doc.id) : undefined;
    if (!doc || !state || !isMutation(method)) return;
    const page = args[1] as PageRef | undefined;
    const annot = args[2] as AnnotRef | undefined;
    const seq = ++state.seq;
    if (OTHER_MUTATIONS.has(method)) {
      if (method === 'setMetadata') state.infoEdited = seq;
      else state.untracked = seq;
      return;
    }
    if (!page) {
      state.untracked = seq;
      return;
    }
    state.pages.set(page.index, seq);
    try {
      const ref = acquirePage(this.native, doc.id, page.index);
      try {
        // The page dict (its /Annots) for creates and removes; harmless otherwise.
        state.dirty.set(rawCall(this.mod, 'EPDFPage_GetObjectNumber', ref.pagePtr), seq);
        if (method !== 'createPageAnnotation' && method !== 'removePageAnnotation' && annot?.id) {
          const num = this.annotObjectNumber(ref.pagePtr, annot.id);
          if (num > 0) state.dirty.set(num, seq);
          else state.untracked = seq;
        }
      } finally {
        ref.release();
      }
    } catch {
      state.untracked = seq;
    }
    if (FORM_METHODS.has(method)) state.formEdited = seq;
  }

  private annotObjectNumber(pagePtr: number, name: string): number {
    const annot = withWideString(this.mod, name, (ptr) =>
      rawCall(this.mod, 'EPDFPage_GetAnnotByName', pagePtr, ptr),
    );
    if (!annot) return 0;
    try {
      return rawCall(this.mod, 'EPDFAnnot_GetObjectNumber', annot);
    } finally {
      rawCall(this.mod, 'FPDFPage_CloseAnnot', annot);
    }
  }

  dirtyState(docId: string): { dirty: number[]; untracked: boolean; baseLength: number } {
    const s = this.need(docId);
    return {
      dirty: [...s.dirty.keys()].sort((a, b) => a - b),
      untracked: s.untracked > 0,
      baseLength: s.base?.length ?? s.openedLength,
    };
  }

  /** Ctrl+S core (§4.2): PDFium incremental → narrow tail against the base. */
  saveIncremental(
    docId: string,
    opts: { keepAll?: boolean; extra?: readonly ExtraObject[] } = {},
  ): IncrementalSave {
    const s = this.need(docId);
    const base = s.base;
    if (!base) {
      throw new RpcError('save-needs-rewrite', 'The file needs a full save (damaged trailer)');
    }
    // Digest first: reading form fields can make PDFium add appearance streams,
    // which then belong to this save rather than silently to the next one.
    const pages = s.untracked > 0 ? 'all' : [...s.pages.keys()].sort((a, b) => a - b);
    const digest = digestDocument(this.mod, this.native, docId, pages);
    const full = saveWithFlags(this.mod, docPtrOf(this.native, docId), FPDF_INCREMENTAL);
    const dirty = new Set(s.dirty.keys());
    const appended = latin1(full.subarray(s.openedLength));
    if (s.formEdited) {
      // Field values can change /AcroForm (e.g. NeedAppearances) or the catalog holding it.
      const acro = /\/AcroForm\s+(\d+)\s+\d+\s+R/.exec(appended);
      if (acro) dirty.add(Number(acro[1]));
      const root = trailerRef(base.trailer, 'Root');
      if (root) dirty.add(Number(root.split(/\s+/)[0]));
    }
    if (s.infoEdited) {
      const info = [...appended.matchAll(/\/Info\s+(\d+)\s+\d+\s+R/g)].at(-1);
      if (info) dirty.add(Number(info[1]));
    }
    const keepAll = opts.keepAll === true || s.untracked > 0;
    const r = narrowTail(base, full, s.openedLength, dirty, {
      keepAll,
      ...(opts.extra ? { extra: opts.extra } : {}),
    });
    s.pending = { next: r.next, tailLength: r.tail.length, seq: s.seq };
    return {
      expected: r.tail.length === 0 ? null : uncheckNames(digest, new Set(r.kept)),
      tail: r.tail,
      mode: keepAll ? 'keep-all' : 'narrow',
      kept: r.kept,
      dropped: r.droppedNums.length,
      baseLength: base.length,
    };
  }

  /**
   * After the tail was written (M1-22): it becomes part of the base, and what
   * it saved is no longer dirty. Changes made after `saveIncremental` stay dirty.
   */
  commit(docId: string, tailLength: number): number {
    const s = this.need(docId);
    const p = s.pending;
    if (p?.tailLength !== tailLength)
      throw new RpcError('save-not-pending', 'No matching save to commit');
    s.base = p.next;
    // Objects and flags changed again after the save stay dirty.
    for (const [n, seq] of s.dirty) if (seq <= p.seq) s.dirty.delete(n);
    for (const [n, seq] of s.pages) if (seq <= p.seq) s.pages.delete(n);
    if (s.formEdited <= p.seq) s.formEdited = 0;
    if (s.infoEdited <= p.seq) s.infoEdited = 0;
    if (s.untracked <= p.seq) s.untracked = 0;
    delete s.pending;
    return p.next.length;
  }

  /** Save Optimized core (ADR-005 decision 3): a full rewrite through our writer. */
  saveRewrite(docId: string): Uint8Array<ArrayBuffer> {
    this.need(docId);
    return saveWithFlags(this.mod, docPtrOf(this.native, docId), FPDF_NO_INCREMENTAL);
  }

  private need(docId: string): DocState {
    const s = this.docs.get(docId);
    if (!s) throw new RpcError('doc-not-open', 'The document is not open');
    return s;
  }
}
