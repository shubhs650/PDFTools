// The Work worker's save check (M1-21): original + tail + piece, reopened as a
// throwaway document, digested on the expected pages and compared; keys our
// object layer wrote are checked with our reader (M3-03).
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { RpcError } from '../../engine/errors';
import { digestDocument, type DocDigest } from '../render/save/digest';
import type { WorkDocs } from './docs';
import { verifyObjects } from './verifyObjects';
import { compareDigests, type VerifyResult } from './verifySave';

export async function verifyCandidate(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  docs: WorkDocs,
  docId: string,
  piece: ArrayBuffer,
  expected: DocDigest,
): Promise<VerifyResult> {
  const pages = expected.pages.map((p) => p.page);
  try {
    let bytes: ArrayBuffer | undefined;
    const r = await docs.withCandidate(docId, piece, (candidateId, _doc, candidate) => {
      bytes = candidate;
      return compareDigests(expected, digestDocument(mod, native, candidateId, pages));
    });
    // Our object layer's keys (M3-03): read back with our own reader.
    if (!r.ok || !expected.objects?.length || !bytes) return r;
    return await verifyObjects(expected.objects, new Uint8Array(bytes));
  } catch (err) {
    if (err instanceof RpcError && err.code === 'unknown-document') throw err;
    // A tail PDFium cannot open or read fails verification (never a success).
    return { ok: false, reason: 'unparsable' };
  }
}
