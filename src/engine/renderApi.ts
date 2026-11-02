// Render worker API (ARCHITECTURE §3.1, ADR-004): the hosted PdfiumNative
// executor behind our typed RPC, plus direct PDFium calls EmbedPDF does not
// expose (ADR-001 B14).
import type { FontFallbackConfig } from '@embedpdf/engines/pdfium';
import type { PdfJson } from '../model/pdf/wire';
import type { Capability } from '../model/permissions';
import type { AnnotTileRequest } from '../workers/render/annotTiles';
import type { FlattenCounts } from '../workers/render/flatten';
import type { SnapshotPixels, SnapshotRequest } from '../workers/render/snapshot';
import type { PageOp } from '../workers/render/pages';
import type { PageInfo } from '../workers/render/pdfium';
import type { DocDigest } from '../workers/render/save/digest';
import type { SecureAction } from '../workers/render/security';
import type { MethodSpec } from './protocol';

export interface DocumentInfo {
  pageCount: number;
  /** `FPDF_GetDocPermissions` bits (rule 9, D-19). 0xFFFFFFFF when unrestricted. */
  permissions: number;
  /** `FPDF_GetSecurityHandlerRevision`: -1 when the file is not encrypted (ADR-013). */
  securityRevision: number;
  /** Opened with, or unlocked by, the owner password (`EPDF_IsOwnerUnlocked`). */
  ownerUnlocked: boolean;
  /** Number of signature fields (D-06: Save Optimized warns when > 0). */
  signatureCount: number;
  /** `FPDF_GetFormType`: 0 none, 1 AcroForm, 2 full XFA, 3 hybrid XFA (ADR-013). */
  formType: number;
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
   * A page operation (M4-09 … M4-11, ADR-016): needs the assemble permission
   * (rule 9; a flatten, M6-09: modify and annotate). Returns the new page list
   * and old index → new index (−1: deleted). Cancellable between pages; a
   * cancelled operation may be partly done, so the caller restores its snapshot.
   */
  pagesOp: MethodSpec<
    { docId: string; op: PageOp },
    { pages: PageInfo[]; map: number[]; flattened?: FlattenCounts },
    { done: number; total: number }
  >;
  /**
   * A PDF picked for Insert from File or Merge (M4-11): page count and whether
   * it is open with full access (M4-Q2). A missing or wrong password rejects
   * with `pdfium:4`.
   */
  pagesSource: MethodSpec<
    { bytes: ArrayBuffer; password?: string },
    { pageCount: number; encrypted: boolean; fullAccess: boolean }
  >;
  /** Undo snapshot before a page operation (ADR-016 d5); `dropped`: older tokens evicted. */
  pagesSnapshot: MethodSpec<{ docId: string }, { token: number; dropped: number[] }>;
  /** Undo of a page operation: reopens the document from its snapshot, same id. */
  pagesRestore: MethodSpec<{ docId: string; token: number }, { pages: PageInfo[] }>;
  /**
   * Comment transfer (M4-20/21): objects copied by the Work worker join the
   * document, which is reopened; the annotate permission is needed (rule 9).
   * `firstNew`: the first new object number (`transfer-stale` if taken since).
   */
  pagesApply: MethodSpec<
    {
      docId: string;
      objects: { num: number; gen: number; bytes: Uint8Array }[];
      firstNew: number;
      /** What the objects need (rule 9): annotate for comments (default), modify for OCR (M5). */
      capability?: Capability;
    },
    { pages: PageInfo[] }
  >;
  /** Forgets undo snapshots (history cleared, document closed). */
  pagesDrop: MethodSpec<{ tokens: number[] }, null>;
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
  /** Crash recovery (M1-24): the narrow tail as of now, leaving any pending save alone. */
  snapshotTail: MethodSpec<{ docId: string }, { tail: ArrayBuffer; baseLength: number }>;
  /** Save Optimized core (ADR-005 decision 3): the whole file rewritten. */
  saveRewrite: MethodSpec<{ docId: string }, { bytes: ArrayBuffer }>;
  /**
   * Password Security (M6-12, ADR-022 decision 2): the current state as a new
   * file with AES-256 encryption set, or with it removed — made on a copy, the
   * open document is not changed. Needs owner rights (rule 9): an unencrypted
   * document, or one opened with or unlocked by its owner password.
   * `expected`: the copy's digest before, for the Work worker's check.
   * Progress: steps done of 2.
   */
  secureCopy: MethodSpec<
    { docId: string; action: SecureAction },
    { bytes: ArrayBuffer; expected: DocDigest },
    { done: number; total: number }
  >;
  /** Existing objects changed since the last save (tests and diagnostics; no content). */
  saveState: MethodSpec<
    { docId: string },
    { dirty: number[]; untracked: boolean; baseLength: number; staged: number }
  >;
  /**
   * Object-layer keys EmbedPDF/PDFium can't write (M3-03, ADR-007): measurement
   * keys on an annotation (by EmbedPDF id) or `/VP` on a page. Saved with the
   * next Ctrl+S in the same revision; `remove` deletes keys (undo). Needs the
   * annotate permission (rule 9). The caller marks the document dirty.
   */
  stageObjects: MethodSpec<
    {
      docId: string;
      target: { page: number; annot?: string; field?: true };
      set: Record<string, PdfJson>;
      remove?: string[];
    },
    { staged: number }
  >;
  /**
   * An annotation tile (M3-05, ADR-014 decision 3): RGBA pixels (straight
   * alpha) of the markups meeting a tile, or null when none does. `frame` is
   * the page's height and crop-box origin (EmbedPDF's page object).
   */
  annotationTile: MethodSpec<
    {
      docId: string;
      frame: { height: number; originX: number; originY: number };
    } & AnnotTileRequest,
    { data: Uint8ClampedArray<ArrayBuffer>; drawn: number } | null
  >;
  /**
   * A region of a page as the view shows it (M6-09 snapshot): content, the
   * drawn markups and form fields, at the given rotation; RGBA, transferred.
   * Needs the copy permission.
   */
  snapshot: MethodSpec<{ docId: string } & SnapshotRequest, SnapshotPixels>;
  /**
   * The embedded file of a FileAttachment comment, by its /NM (M6-10: Save
   * Attachment… from the page or the Comments pane). Transferred.
   */
  fileAttachment: MethodSpec<
    { docId: string; pageIndex: number; id: string },
    { name: string; data: ArrayBuffer }
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

export type { PageOp, PageInfo, SecureAction };

/** RpcError code for a failed PDFium/EmbedPDF task: `pdfium:<PdfErrorCode>`. */
export const PDFIUM_ERROR_PREFIX = 'pdfium:';
