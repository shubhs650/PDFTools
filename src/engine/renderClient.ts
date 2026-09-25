// Document open/close on the render engine (M1-07; the open pipeline and tabs
// come in M1-13). Returns the document record fields that later tasks need:
// permission flags (rule 9, D-19) and signature count (D-06).
import { PdfErrorCode, type PdfDocumentObject } from '@embedpdf/models';
import type { RenderEngine } from './createEngine';
import { RpcError } from './errors';
import type { DocumentInfo } from './renderApi';

/** The file needs an open password; the prompt arrives in M2 (D-19). */
export class NeedsPasswordError extends RpcError {
  constructor() {
    super('needs-password', 'The document needs a password');
    this.name = 'NeedsPasswordError';
  }
}

export interface OpenedDocument {
  doc: PdfDocumentObject;
  info: DocumentInfo;
}

export async function openDocument(
  r: RenderEngine,
  { docId, bytes, password }: { docId: string; bytes: ArrayBuffer; password?: string },
): Promise<OpenedDocument> {
  await r.ready;
  let doc: PdfDocumentObject;
  try {
    doc = await r.engine
      .openDocumentBuffer({ id: docId, content: bytes }, password === undefined ? {} : { password })
      .toPromise();
  } catch (err) {
    const code = (err as { reason?: { code?: number } }).reason?.code;
    if (code === PdfErrorCode.Password) throw new NeedsPasswordError();
    throw err;
  }
  const info = await r.rpc.call('docInfo', { docId: doc.id }).promise;
  return { doc, info };
}

export async function closeDocument(r: RenderEngine, doc: PdfDocumentObject): Promise<void> {
  await r.engine.closeDocument(doc).toPromise();
}
