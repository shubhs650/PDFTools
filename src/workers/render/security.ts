// Password Security (M6-12, D-40 a, §7.12) in the Render worker: the copy
// route of spike S18 (ADR-022 decision 2). The current state is rewritten
// (our staged keys under the file's own key), opened as a second document,
// encrypted or decrypted there and saved without the incremental flag; the
// copy is closed. The open document, its save base and its Ctrl+S are never
// touched: encrypting in place would leave Ctrl+S writing a plain file and
// garble the object layer's strings under the new key.
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import { PdfErrorCode, type PdfDocumentObject } from '@embedpdf/models';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { RpcError } from '../../engine/errors';
import { PDFIUM_ERROR_PREFIX } from '../../engine/renderApi';
import { hasOwnerRights } from '../../model/passwordSecurity';
import { docPtrOf, rawCall } from './pdfium';
import { digestDocument, type DocDigest } from './save/digest';
import type { SaveTracker } from './save/tracker';
import { FPDF_NO_INCREMENTAL, saveWithFlags } from './save/writer';

export type SecureAction =
  | { kind: 'encrypt'; userPassword: string; ownerPassword: string; flags: number }
  | { kind: 'remove' };

export interface SecuredCopy {
  bytes: Uint8Array<ArrayBuffer>;
  /** What the output must show (pages, annotations, fields), taken from the copy before. */
  expected: DocDigest;
}

let copySeq = 0;

const securityDenied = (): RpcError =>
  new RpcError(
    `${PDFIUM_ERROR_PREFIX}${String(PdfErrorCode.Security)}`,
    'Changing security needs the owner password',
  );

/** Owner rights read live from PDFium (an owner unlock counts). */
export function ownerRightsOf(mod: WrappedPdfiumModule, native: PdfiumNative, docId: string) {
  const doc = docPtrOf(native, docId);
  const revision = rawCall(mod, 'FPDF_GetSecurityHandlerRevision', doc);
  return {
    revision,
    owner: hasOwnerRights({
      revision,
      ownerUnlocked: Boolean(rawCall(mod, 'EPDF_IsOwnerUnlocked', doc)),
    }),
  };
}

export async function secureCopy(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  tracker: SaveTracker,
  docId: string,
  action: SecureAction,
  signal: AbortSignal,
  progress: (step: number) => void,
): Promise<SecuredCopy> {
  // Rule 9 and ADR-022 decision 2: owner rights, never just "modify".
  const rights = ownerRightsOf(mod, native, docId);
  if (!rights.owner) throw securityDenied();
  if (action.kind === 'remove' && rights.revision < 2)
    throw new RpcError('security-none', 'The document is not encrypted');
  await tracker.securityReady(docId);
  const current = tracker.rewriteCopy(docId);
  progress(1);
  signal.throwIfAborted();

  const id = `secure-${String(++copySeq)}`;
  const password = tracker.copyPassword(docId);
  let doc: PdfDocumentObject;
  try {
    doc = await native
      .openDocumentBuffer(
        { id, content: current.buffer },
        password === undefined ? {} : { password },
      )
      .toPromise();
  } catch {
    throw new RpcError('security-copy', 'The copy could not be opened');
  }
  try {
    // The copy must have the rights the open document has (same password).
    if (!ownerRightsOf(mod, native, id).owner) throw securityDenied();
    const expected = digestDocument(mod, native, id, 'all');
    signal.throwIfAborted();
    const task =
      action.kind === 'encrypt'
        ? native.setDocumentEncryption(doc, action.userPassword, action.ownerPassword, action.flags)
        : native.removeEncryption(doc);
    const ok = await task.toPromise().catch(() => false);
    if (!ok) throw new RpcError('security-failed', 'PDFium did not change the security');
    const bytes = saveWithFlags(mod, docPtrOf(native, id), FPDF_NO_INCREMENTAL);
    progress(2);
    return { bytes, expected };
  } finally {
    await native.closeDocument(doc).toPromise();
  }
}
