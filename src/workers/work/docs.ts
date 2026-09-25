// Documents held by the Work worker: the original bytes (kept in JS memory,
// never re-serialized) plus the latest incremental tail. A refreshed tail is
// applied lazily, on the next job that touches the document (ADR-001 B11).
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { PdfDocumentObject } from '@embedpdf/models';
import { RpcError } from '../../engine/errors';

interface Entry {
  original: ArrayBuffer;
  password: string | undefined;
  /** Tail waiting to be applied (null: nothing pending). */
  pendingTail: ArrayBuffer | null;
  appliedTailBytes: number;
  doc: PdfDocumentObject;
  generation: number;
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
  ) {
    // Each (re)load gets a fresh engine id, so a stale handle can never be reused.
    return this.native()
      .openDocumentBuffer(
        { id: `${docId}#${String(generation)}`, content: bytes },
        password === undefined ? {} : { password },
      )
      .toPromise();
  }

  async open(
    docId: string,
    original: ArrayBuffer,
    tail: ArrayBuffer | undefined,
    password?: string,
  ) {
    if (this.entries.has(docId)) await this.close(docId);
    const doc = await this.load(docId, concat(original, tail), password, 0);
    this.entries.set(docId, {
      original,
      password,
      pendingTail: null,
      appliedTailBytes: tail?.byteLength ?? 0,
      doc,
      generation: 0,
    });
    return doc;
  }

  refresh(docId: string, tail: ArrayBuffer): boolean {
    const e = this.require(docId);
    e.pendingTail = tail;
    return true;
  }

  /** The document with any pending tail applied (reopens original + tail). */
  async get(docId: string): Promise<{ doc: PdfDocumentObject; appliedTailBytes: number }> {
    const e = this.require(docId);
    if (e.pendingTail) {
      const tail = e.pendingTail;
      const generation = e.generation + 1;
      const doc = await this.load(docId, concat(e.original, tail), e.password, generation);
      await this.native().closeDocument(e.doc).toPromise();
      e.doc = doc;
      e.generation = generation;
      e.appliedTailBytes = tail.byteLength;
      e.pendingTail = null;
    }
    return { doc: e.doc, appliedTailBytes: e.appliedTailBytes };
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
