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
  /**
   * Bounds of everything drawn on a page (text, paths, images), in points from
   * the page's top-left corner, unrotated; null for an empty page. For Fit
   * Visible (§5). Runs in the Render worker over the page's objects.
   */
  contentBox: MethodSpec<
    { docId: string; pageIndex: number },
    { left: number; top: number; right: number; bottom: number } | null
  >;
  memory: MethodSpec<null, { wasmBytes: number }>;
  /** What a render of this page costs (M1-17 cost model): objects and path segments. */
  pageCost: MethodSpec<{ docId: string; pageIndex: number }, { objects: number; segments: number }>;
  /**
   * Progressive render of a whole page at `scale` (M1-17): RGBA pixels,
   * transferred. Cancellable between slices; progress = slices done.
   */
  renderProgressive: MethodSpec<
    { docId: string; pageIndex: number; scale: number; sliceMs?: number },
    {
      data: Uint8ClampedArray<ArrayBuffer>;
      width: number;
      height: number;
      slices: number;
      maxSliceMs: number;
      totalMs: number;
    },
    { slices: number }
  >;
}

/** RpcError code for a failed PDFium/EmbedPDF task: `pdfium:<PdfErrorCode>`. */
export const PDFIUM_ERROR_PREFIX = 'pdfium:';
