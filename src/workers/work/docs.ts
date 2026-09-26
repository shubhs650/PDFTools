// Documents held by the Work worker: the original bytes (kept in JS memory,
// never re-serialized) plus the latest incremental tail. A refreshed tail is
// applied lazily, on the next job that touches the document (ADR-001 B11).
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { PdfDocumentObject } from '@embedpdf/models';
import { RpcError } from '../../engine/errors';

interface Entry {
  original: ArrayBuffer;
  password: string | undefined;
  /** Owner password once unlocked (session memory only, M2-Q7); applied after every reload. */
  ownerPassword: string | undefined;
  /** Bytes appended to the original so far (the latest saved tail). */
  tail: ArrayBuffer | null;
  /** Tail waiting to be applied (null: nothing pending). */
  pendingTail: ArrayBuffer | null;
  appliedTailBytes: number;
  doc: PdfDocumentObject;
  generation: number;
}

/**
 * Like the Render worker's document manager: page coordinates in the unrotated
 * (0°) space, so text geometry and hit rectangles from here line up with the
 * viewer on rotated pages (M2-04, M2-05).
 */
function openOptions(password: string | undefined) {
  return { normalizeRotation: true, ...(password === undefined ? {} : { password }) };
}

export function concat(a: ArrayBuffer, b: ArrayBuffer | null | undefined): ArrayBuffer {
  if (!b || b.byteLength === 0) return a.slice(0);
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(new Uint8Array(a), 0);
  out.set(new Uint8Array(b), a.byteLength);
  return out.buffer;
}

export class WorkDocs {
  private readonly entries = new Map<string, Entry>();
  private verifySeq = 0;
  private readonly native: () => PdfiumNative;

  constructor(native: () => PdfiumNative) {
    this.native = native;
  }

  get size(): number {
    return this.entries.size;
  }

  private async load(
    docId: string,
    bytes: ArrayBuffer,
    password: string | undefined,
    generation: number,
    ownerPassword?: string,
  ) {
    // Each (re)load gets a fresh engine id, so a stale handle can never be reused.
    const doc = await this.native()
      .openDocumentBuffer(
        { id: `${docId}#${String(generation)}`, content: bytes },
        openOptions(password),
      )
      .toPromise();
    if (ownerPassword !== undefined)
      await this.native().unlockOwnerPermissions(doc, ownerPassword).toPromise();
    return doc;
  }

  async open(
    docId: string,
    original: ArrayBuffer,
    tail: ArrayBuffer | undefined,
    password?: string,
    ownerPassword?: string,
  ) {
    if (this.entries.has(docId)) await this.close(docId);
    const doc = await this.load(docId, concat(original, tail), password, 0, ownerPassword);
    this.entries.set(docId, {
      original,
      password,
      ownerPassword,
      tail: tail ?? null,
      pendingTail: null,
      appliedTailBytes: tail?.byteLength ?? 0,
      doc,
      generation: 0,
    });
    return doc;
  }

  refresh(docId: string, tail: ArrayBuffer): boolean {
    const e = this.require(docId);
    e.tail = tail;
    e.pendingTail = tail;
    return true;
  }

  /** A saved tail piece appended after the current tail; applied lazily like refresh. */
  append(docId: string, piece: ArrayBuffer): number {
    const e = this.require(docId);
    const tail = concat(e.tail ?? new ArrayBuffer(0), piece);
    e.tail = tail;
    e.pendingTail = tail;
    return tail.byteLength;
  }

  /**
   * Opens original + current tail + `piece` as a throwaway document, runs
   * `fn` on it and closes it (M1-21 save verification). The kept copy is untouched.
   */
  async withCandidate<T>(
    docId: string,
    piece: ArrayBuffer,
    fn: (candidateId: string, doc: PdfDocumentObject) => T,
  ): Promise<T> {
    const e = this.require(docId);
    const bytes = concat(concat(e.original, e.tail), piece);
    const candidateId = `${docId}#verify${String(++this.verifySeq)}`;
    const doc = await this.native()
      .openDocumentBuffer({ id: candidateId, content: bytes }, openOptions(e.password))
      .toPromise();
    try {
      return fn(candidateId, doc);
    } finally {
      await this.native().closeDocument(doc).toPromise();
    }
  }

  /** The document with any pending tail applied (reopens original + tail). */
  async get(docId: string): Promise<{ doc: PdfDocumentObject; appliedTailBytes: number }> {
    const e = this.require(docId);
    if (e.pendingTail) {
      const tail = e.pendingTail;
      const generation = e.generation + 1;
      const doc = await this.load(
        docId,
        concat(e.original, tail),
        e.password,
        generation,
        e.ownerPassword,
      );
      await this.native().closeDocument(e.doc).toPromise();
      e.doc = doc;
      e.generation = generation;
      e.appliedTailBytes = tail.byteLength;
      e.pendingTail = null;
    }
    return { doc: e.doc, appliedTailBytes: e.appliedTailBytes };
  }

  /** Unlocks the kept copy with the owner password; remembered for later reloads. */
  async unlock(docId: string, ownerPassword: string): Promise<boolean> {
    const e = this.require(docId);
    const ok = await this.native().unlockOwnerPermissions(e.doc, ownerPassword).toPromise();
    if (ok) e.ownerPassword = ownerPassword;
    return ok;
  }

  async close(docId: string): Promise<void> {
    const e = this.entries.get(docId);
    if (!e) return;
    this.entries.delete(docId);
    await this.native().closeDocument(e.doc).toPromise();
  }

  private require(docId: string): Entry {
    const e = this.entries.get(docId);
    if (!e) throw new RpcError('unknown-document', 'The document is not open in the work worker');
    return e;
  }
}
