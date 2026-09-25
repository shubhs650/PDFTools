// Render worker API (ARCHITECTURE §3.1, ADR-004): the hosted PdfiumNative
// executor behind our typed RPC, plus direct PDFium calls EmbedPDF does not
// expose (ADR-001 B14).
import type { FontFallbackConfig } from '@embedpdf/engines/pdfium';
import type { MethodSpec } from './protocol';

export interface DocumentInfo {
  pageCount: number;
  /** `FPDF_GetDocPermissions` bits (rule 9, D-19). 0xFFFFFFFF when unrestricted. */
  permissions: number;
  /** Number of signature fields (D-06: Save Optimized warns when > 0). */
  signatureCount: number;
}

export interface RenderApi {
  init: MethodSpec<
    { wasmUrl: string; fontFallback: FontFallbackConfig | null },
    { ms: number; wasmBytes: number }
  >;
  /** One IPdfiumExecutor call, forwarded by the main-thread proxy (hostedEngine.ts). */
  exec: MethodSpec<{ method: string; args: unknown[] }, unknown, unknown>;
  docInfo: MethodSpec<{ docId: string }, DocumentInfo>;
  memory: MethodSpec<null, { wasmBytes: number }>;
}

/** RpcError code for a failed PDFium/EmbedPDF task: `pdfium:<PdfErrorCode>`. */
export const PDFIUM_ERROR_PREFIX = 'pdfium:';
