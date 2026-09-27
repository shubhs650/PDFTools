// Save state per open document in the Render worker (M1-20, ADR-005, rules 7
// and 9). Wraps the executor calls the main thread makes:
//   - before a mutating call: refuse it if the document's permission flags
//     forbid it (rule 9; annotations need "annotate", form values "fill
//     forms", other changes "modify", with each revision's rules from
//     src/model/permissions.ts — ADR-013 decision 2);
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
import { allows, type Capability, type Security } from '../../../model/permissions';
import { acquirePage, docPtrOf, rawCall, withWideString } from '../pdfium';
import { concatBytes, latin1 } from './bytes';
import type { PdfValue } from '../../../model/pdf/objects';
import { PdfReader, inflateStream } from '../../../model/pdf/reader';
import type { StandardCrypt } from '../../../model/pdf/security/standard';
import {
  PatchError,
  PatchSet,
  applyPatch,
  patchDigest,
  type Patch,
  type PatchTarget,
} from '../objects/patches';
import { digestDocument, uncheckNames, type DocDigest, type ObjectDigest } from './digest';
import { narrowTail, type ExtraObject, type ObjectPatch } from './narrowTail';
import { FPDF_INCREMENTAL, FPDF_NO_INCREMENTAL, saveWithFlags } from './writer';
import { saveBaseOf, trailerRef, type SaveBase } from './xref';

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
  /** Keys our object layer adds to PDFium's objects (M3-03, ADR-007). */
  patches: PatchSet;
  /**
   * The file key for our object layer's strings in an encrypted file (M3-04),
   * from the password the document was opened with; memory only (M2-Q7).
   * Null when the file isn't encrypted or its handler isn't supported.
   */
  crypt: StandardCrypt | null;
  /** Resolves once `crypt` is known. */
  cryptReady: Promise<void>;
  /** A save or rewrite handed out and not yet committed (`rewrite`: a full rewrite). */
  pending?: { next: SaveBase; tailLength: number; seq: number; rewrite?: boolean };
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

/** The newest trailer names /Encrypt (the reader then derives the file key). */
const namesEncrypt = (base: SaveBase | undefined): boolean =>
  base !== undefined && /\/Encrypt\s+\d+\s+\d+\s+R/.test(base.trailer);

function readBase(bytes: Uint8Array): SaveBase | undefined {
  try {
    return saveBaseOf(bytes);
  } catch {
    return undefined;
  }
}

/**
 * PDFium's objects never hold our keys, so a full rewrite drops them: the
 * patched objects follow as one small incremental section (object numbers
 * survive a rewrite, M1-23).
 */
function withPatches(
  bytes: Uint8Array<ArrayBuffer>,
  resolved: readonly { num: number; patch: Patch }[],
  crypt: StandardCrypt | null,
): Uint8Array<ArrayBuffer> {
  const first = /\d+\s+\d+\s+obj\b/.exec(latin1(bytes.subarray(0, 1024)));
  if (!first) throw new RpcError('save-rewrite', 'The rewritten file has no objects');
  const r = narrowTail(saveBaseOf(bytes), bytes, first.index, [], {
    patches: resolved.map(({ num, patch }) => ({
      num,
      force: true,
      apply: (b) => applyPatch(b, patch, crypt),
    })),
  });
  return concatBytes([bytes, r.tail]);
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
  opened(docId: string, bytes: Uint8Array, password?: string): void {
    const state: DocState = {
      openedLength: bytes.length,
      base: readBase(bytes),
      dirty: new Map(),
      pages: new Map(),
      formEdited: 0,
      infoEdited: 0,
      untracked: 0,
      seq: 0,
      patches: new PatchSet(),
      crypt: null,
      cryptReady: Promise.resolve(),
    };
    // Only the trailer and /Encrypt are read; `bytes` is not kept once the key is known.
    if (namesEncrypt(state.base)) {
      state.cryptReady = PdfReader.open(
        bytes,
        inflateStream,
        password === undefined ? {} : { password },
      )
        .then((r) => {
          state.crypt = r.crypt;
        })
        .catch(() => undefined);
    }
    this.docs.set(docId, state);
  }

  /** Waits until the document's file key is known (stagePatch needs it). */
  async securityReady(docId: string): Promise<void> {
    await this.need(docId).cryptReady;
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

  /** Permission bits (read live, so an owner unlock counts) and the security revision. */
  security(docId: string): Security {
    const doc = docPtrOf(this.native, docId);
    return {
      permissions: rawCall(this.mod, 'FPDF_GetDocPermissions', doc) >>> 0,
      revision: rawCall(this.mod, 'FPDF_GetSecurityHandlerRevision', doc),
    };
  }

  /** Throws before a mutation the document's permissions forbid (rule 9). */
  checkAllowed(method: string, docId: string): void {
    if (!isMutation(method)) return;
    const need: Capability = ANNOTATION_METHODS.has(method)
      ? 'annotate'
      : FORM_METHODS.has(method)
        ? 'fillForms'
        : 'modify';
    const ok = allows(this.security(docId), need);
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
          // A form value lives in the field (the widget's /Parent chain) and a
          // radio change flips the siblings' /AS: all of them go in the tail
          // (ADR-013 finding 3), or the narrow save reopens with the old value.
          if (FORM_METHODS.has(method) && num > 0)
            for (const n of this.fieldFamily(doc.id, ref, annot.id)) state.dirty.set(n, seq);
        }
      } finally {
        ref.release();
      }
    } catch {
      state.untracked = seq;
    }
    if (FORM_METHODS.has(method)) state.formEdited = seq;
  }

  /**
   * The widget's field (the dictionary holding /V; the widget itself when
   * merged) and the page's other widgets of the same field (radio siblings),
   * by object number.
   */
  private fieldFamily(
    docId: string,
    ref: { pagePtr: number; withFormHandle?: (fn: (form: number) => number[]) => number[] },
    name: string,
  ): number[] {
    const run = (fn: (form: number) => number[]): number[] => {
      if (typeof ref.withFormHandle === 'function') return ref.withFormHandle(fn);
      // Same steps as EmbedPDF's PageContext.withFormHandle.
      const info = rawCall(this.mod, 'PDFiumExt_OpenFormFillInfo');
      const form = rawCall(
        this.mod,
        'PDFiumExt_InitFormFillEnvironment',
        docPtrOf(this.native, docId),
        info,
      );
      rawCall(this.mod, 'FORM_OnAfterLoadPage', ref.pagePtr, form);
      try {
        return fn(form);
      } finally {
        rawCall(this.mod, 'FORM_OnBeforeClosePage', ref.pagePtr, form);
        rawCall(this.mod, 'PDFiumExt_ExitFormFillEnvironment', form);
        rawCall(this.mod, 'PDFiumExt_CloseFormFillInfo', info);
      }
    };
    return run((form) => this.familyWith(form, ref.pagePtr, name));
  }

  private familyWith(form: number, pagePtr: number, name: string): number[] {
    const fieldOf = (annot: number): number =>
      rawCall(this.mod, 'EPDFAnnot_GetFormFieldObjectNumber', form, annot);
    const annot = withWideString(this.mod, name, (ptr) =>
      rawCall(this.mod, 'EPDFPage_GetAnnotByName', pagePtr, ptr),
    );
    if (!annot) return [];
    let field: number;
    try {
      field = fieldOf(annot);
    } finally {
      rawCall(this.mod, 'FPDFPage_CloseAnnot', annot);
    }
    if (field <= 0) return [];
    const out = [field];
    const count = rawCall(this.mod, 'FPDFPage_GetAnnotCount', pagePtr);
    for (let i = 0; i < count; i++) {
      const a = rawCall(this.mod, 'FPDFPage_GetAnnot', pagePtr, i);
      if (!a) continue;
      try {
        if (fieldOf(a) === field) {
          const num = rawCall(this.mod, 'EPDFAnnot_GetObjectNumber', a);
          if (num > 0) out.push(num);
        }
      } finally {
        rawCall(this.mod, 'FPDFPage_CloseAnnot', a);
      }
    }
    return out;
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

  /**
   * Stages object-layer keys on a page or annotation (M3-03, ADR-007): written
   * with the next Ctrl+S, in the same revision, and again whenever a later save
   * rewrites the object. Needs the annotate permission (rule 9): measurements
   * are markups.
   */
  stagePatch(
    docId: string,
    target: PatchTarget,
    set: ReadonlyMap<string, PdfValue>,
    remove: readonly string[] = [],
  ): void {
    const s = this.need(docId);
    const security = this.security(docId);
    if (!allows(security, 'annotate')) {
      throw new RpcError(
        `${PDFIUM_ERROR_PREFIX}${String(PdfErrorCode.Security)}`,
        'The document does not allow this change',
      );
    }
    const pageCount = rawCall(this.mod, 'FPDF_GetPageCount', docPtrOf(this.native, docId));
    if (!Number.isInteger(target.page) || target.page < 0 || target.page >= pageCount)
      throw new RpcError('patch-target', 'No such page');
    const seq = s.seq + 1;
    try {
      s.patches.stage(target, set, remove, seq, security.revision >= 0 && !s.crypt);
    } catch (err) {
      if (err instanceof PatchError) throw new RpcError(err.code, err.message);
      throw err;
    }
    s.seq = seq;
    s.pages.set(target.page, seq);
  }

  /**
   * Object numbers of the staged patches' targets. Loading the page (and the
   * annotation) also makes PDFium serialize the object in its incremental
   * output, where the patch is applied. A patch whose annotation no longer
   * exists (deleted, or undone) is skipped; it applies again if an undo brings
   * the annotation back under the same id.
   */
  private resolvePatches(docId: string, s: DocState): { num: number; patch: Patch }[] {
    const out: { num: number; patch: Patch }[] = [];
    for (const patch of s.patches.all()) {
      const ref = acquirePage(this.native, docId, patch.target.page);
      try {
        const num =
          patch.target.annot === undefined
            ? rawCall(this.mod, 'EPDFPage_GetObjectNumber', ref.pagePtr)
            : this.annotObjectNumber(ref.pagePtr, patch.target.annot);
        if (num > 0) out.push({ num, patch });
      } finally {
        ref.release();
      }
    }
    return out;
  }

  dirtyState(docId: string): {
    dirty: number[];
    untracked: boolean;
    baseLength: number;
    staged: number;
  } {
    const s = this.need(docId);
    return {
      dirty: [...s.dirty.keys()].sort((a, b) => a - b),
      untracked: s.untracked > 0,
      baseLength: s.base?.length ?? s.openedLength,
      staged: s.patches.pending,
    };
  }

  /** Ctrl+S core (§4.2): PDFium incremental → narrow tail against the base. */
  saveIncremental(
    docId: string,
    opts: { keepAll?: boolean; extra?: readonly ExtraObject[] } = {},
  ): IncrementalSave {
    const s = this.need(docId);
    // Digest first: reading form fields can make PDFium add appearance streams,
    // which then belong to this save rather than silently to the next one.
    const pages = s.untracked > 0 ? 'all' : [...s.pages.keys()].sort((a, b) => a - b);
    const digest = s.base ? digestDocument(this.mod, this.native, docId, pages) : null;
    const { base, r, keepAll, objects } = this.buildTail(docId, s, opts);
    s.pending = { next: r.next, tailLength: r.tail.length, seq: s.seq };
    const expected = r.tail.length === 0 || !digest ? null : uncheckNames(digest, new Set(r.kept));
    if (expected && objects.length > 0) expected.objects = objects;
    return {
      expected,
      tail: r.tail,
      mode: keepAll ? 'keep-all' : 'narrow',
      kept: r.kept,
      dropped: r.droppedNums.length,
      baseLength: base.length,
    };
  }

  /**
   * Crash-recovery snapshot (M1-24, §4.3): the narrow tail against the file as
   * last saved, without touching the pending save (a Ctrl+S may be running).
   */
  snapshotTail(docId: string): { tail: Uint8Array<ArrayBuffer>; baseLength: number } {
    const s = this.need(docId);
    const { base, r } = this.buildTail(docId, s, {});
    return { tail: r.tail, baseLength: base.length };
  }

  private buildTail(
    docId: string,
    s: DocState,
    opts: { keepAll?: boolean; extra?: readonly ExtraObject[] },
  ) {
    const base = s.base;
    if (!base) {
      throw new RpcError('save-needs-rewrite', 'The file needs a full save (damaged trailer)');
    }
    // Before PDFium serializes: loading the targets puts them in its output.
    const resolved = this.resolvePatches(docId, s);
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
    const patches: ObjectPatch[] = resolved.map(({ num, patch }) => ({
      num,
      force: !patch.clean,
      apply: (bytes) => applyPatch(bytes, patch, s.crypt),
    }));
    const r = narrowTail(base, full, s.openedLength, dirty, {
      keepAll,
      patches,
      ...(opts.extra ? { extra: opts.extra } : {}),
    });
    const objects: ObjectDigest[] = resolved.map(({ num, patch }) => patchDigest(num, patch));
    return { base, r, keepAll, objects };
  }

  /**
   * After the tail was written (M1-22): it becomes part of the base, and what
   * it saved is no longer dirty. Changes made after `saveIncremental` stay dirty.
   */
  commit(docId: string, tailLength: number, rewrite = false): number {
    const s = this.need(docId);
    const p = s.pending;
    if (p?.tailLength !== tailLength || (p.rewrite ?? false) !== rewrite)
      throw new RpcError('save-not-pending', 'No matching save to commit');
    s.base = p.next;
    // Objects and flags changed again after the save stay dirty.
    for (const [n, seq] of s.dirty) if (seq <= p.seq) s.dirty.delete(n);
    for (const [n, seq] of s.pages) if (seq <= p.seq) s.pages.delete(n);
    if (s.formEdited <= p.seq) s.formEdited = 0;
    if (s.infoEdited <= p.seq) s.infoEdited = 0;
    if (s.untracked <= p.seq) s.untracked = 0;
    s.patches.committed(p.seq);
    delete s.pending;
    return p.next.length;
  }

  /**
   * Save Optimized core (ADR-005 decision 3): a full rewrite through our
   * writer. If the rewritten file becomes the document's file, `commit(…,
   * true)` makes it the base: later Ctrl+S tails append to it. PDFium keeps
   * object numbers in a rewrite (it only drops unreferenced objects), so the
   * in-memory document still matches (M1-23, tests/save/optimized.test.ts).
   */
  saveRewrite(docId: string): Uint8Array<ArrayBuffer> {
    const s = this.need(docId);
    const resolved = this.resolvePatches(docId, s);
    let bytes = saveWithFlags(this.mod, docPtrOf(this.native, docId), FPDF_NO_INCREMENTAL);
    if (resolved.length > 0) bytes = withPatches(bytes, resolved, s.crypt);
    const base = saveBaseOf(bytes);
    // Objects PDFium allocated before the rewrite are not new afterwards.
    const newFrom = Math.max(base.size, s.base?.newFrom ?? s.base?.size ?? 0);
    s.pending = { next: { ...base, newFrom }, tailLength: bytes.length, seq: s.seq, rewrite: true };
    return bytes;
  }

  private need(docId: string): DocState {
    const s = this.docs.get(docId);
    if (!s) throw new RpcError('doc-not-open', 'The document is not open');
    return s;
  }
}
