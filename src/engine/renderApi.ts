// Render worker API (ARCHITECTURE §3.1, ADR-004): the hosted PdfiumNative
// executor behind our typed RPC, plus direct PDFium calls EmbedPDF does not
// expose (ADR-001 B14).
import type { FontFallbackConfig } from '@embedpdf/engines/pdfium';
import type { DocDigest } from '../workers/render/save/digest';
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
  /**
   * Ctrl+S core (M1-20, ADR-005): the narrow incremental tail to append to
   * the file as last saved (`baseLength` bytes). Empty tail = nothing changed.
   * `keepAll` is the verification fallback (ADR-005 decision 2).
   */
  saveIncremental: MethodSpec<
    { docId: string; keepAll?: boolean },
    {
      tail: ArrayBuffer;
      mode: 'narrow' | 'keep-all';
      kept: number[];
      dropped: number;
      baseLength: number;
      /** What the saved file must show (M1-21); null when the tail is empty. */
      expected: DocDigest | null;
    }
  >;
  /** The tail of the last saveIncremental was written: it becomes the new base (M1-22). */
  commitSave: MethodSpec<
    { docId: string; tailLength: number; rewrite?: boolean },
    { baseLength: number }
  >;
  /** Save Optimized core (ADR-005 decision 3): the whole file rewritten. */
  saveRewrite: MethodSpec<{ docId: string }, { bytes: ArrayBuffer }>;
  /** Existing objects changed since the last save (tests and diagnostics; no content). */
  saveState: MethodSpec<
    { docId: string },
    { dirty: number[]; untracked: boolean; baseLength: number }
  >;
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
