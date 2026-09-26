// Work worker API (ARCHITECTURE §3.1, D-10): PDFium #2 with a read-only copy of
// each document. M1 uses it for save verification (M1-21); M2 adds search.
import type { PageTextSlice, PdfPageGeometry } from '@embedpdf/models';
import type { DocDigest } from '../workers/render/save/digest';
import type { AttachmentInfo, AttachmentRef } from '../workers/work/attachments';
import type { LayerList } from '../model/ocg';
import type { DocProperties } from '../workers/work/properties';
import type { SignatureInfo } from '../workers/work/signatures';
import type {
  ExtraHit,
  ExtrasRequest,
  HitRect,
  SearchBatch,
  SearchRequest,
  SearchSummary,
} from '../workers/work/search';
import type { Hit, SearchOptions } from '../workers/work/searchCore';
import type { VerifyResult } from '../workers/work/verifySave';
import type { MethodSpec } from './protocol';

export type WorkPriority = 'interactive' | 'save-verify' | 'background';

export interface WorkApi {
  init: MethodSpec<{ wasmUrl: string }, { ms: number; wasmBytes: number }>;
  /** `original` is transferred (the worker keeps it); `tail` is the incremental tail so far. */
  open: MethodSpec<
    {
      docId: string;
      original: ArrayBuffer;
      tail?: ArrayBuffer;
      password?: string;
      /** Owner password given in this session: the copy is unlocked after every (re)load. */
      ownerPassword?: string;
    },
    { pageCount: number; wasmBytes: number }
  >;
  /** Owner-password unlock of the kept copy (§7.12, ADR-013 decision 3). */
  unlock: MethodSpec<{ docId: string; ownerPassword: string }, { unlocked: boolean }>;
  /** Replaces the document's tail (bytes appended since the original). Applied lazily (ADR-001 B11). */
  refresh: MethodSpec<{ docId: string; tail: ArrayBuffer }, { pending: boolean }>;
  /** Appends a saved tail piece to the document's tail (after a committed save). */
  append: MethodSpec<{ docId: string; piece: ArrayBuffer }, { tailBytes: number }>;
  /**
   * Save verification (M1-21, ADR-005 decision 2): reopens original + tail +
   * `piece` and compares it with the Render worker's `expected` digest.
   */
  verify: MethodSpec<{ docId: string; piece: ArrayBuffer; expected: DocDigest }, VerifyResult>;
  /** Digest of pages of the kept copy (hashes and counts only; tests and diagnostics). */
  digest: MethodSpec<{ docId: string; pages: number[]; priority?: WorkPriority }, DocDigest>;
  close: MethodSpec<{ docId: string }, { wasmBytes: number }>;
  /** Current and peak WASM memory (ADR-004 decision 4). */
  memory: MethodSpec<null, { wasmBytes: number; peakWasmBytes: number }>;
  /** State of one document: pages and the tail length actually loaded. */
  docState: MethodSpec<
    { docId: string; priority?: WorkPriority },
    { pageCount: number; appliedTailBytes: number }
  >;
  /**
   * Extracts every page's text inside the worker and returns counts only (the
   * text stays in the worker). Cancellable between pages; the base of M2's
   * background indexing, and the "large job" of the memory tests.
   */
  /**
   * A page's text geometry (glyph runs) for the text layer and selection
   * (M2-04, ADR-012 decision 1): served here so it never waits in, or blocks,
   * the Render worker's one-call-at-a-time queue.
   */
  pageGeometry: MethodSpec<
    { docId: string; pageIndex: number; priority?: WorkPriority },
    PdfPageGeometry
  >;
  /** Text of glyph ranges (selection → clipboard). */
  textSlices: MethodSpec<
    { docId: string; slices: PageTextSlice[]; priority?: WorkPriority },
    string[]
  >;
  /**
   * Search (D-08, §6, ADR-006): runs at interactive priority, streams
   * `SearchBatch`es (≥ 50 ms apart; all delivered), resolves with the summary.
   * Cancel it to stop between pages. Query errors reject with `search-*` codes.
   */
  search: MethodSpec<SearchRequest, SearchSummary, SearchBatch>;
  /** Hits with context for pages past the 5,000-hit context cap (ADR-006 decision 2). */
  searchContext: MethodSpec<
    { docId: string; query: string; options: SearchOptions; pages: number[] },
    Hit[]
  >;
  /** Annotation text and bookmark title hits (Advanced Search, M2-09, M2-Q3). */
  searchExtras: MethodSpec<ExtrasRequest, ExtraHit[]>;
  /**
   * Embedded files (M2-11): document-level and FileAttachment annotations.
   * Walks the pages (progress, cancellable).
   */
  listAttachments: MethodSpec<{ docId: string }, AttachmentInfo[], { done: number; total: number }>;
  /**
   * Signatures with an offline integrity check (D-24, M2-13): one at a time,
   * progress per signature, cancellable between them. Never fetches anything.
   */
  checkSignatures: MethodSpec<{ docId: string }, SignatureInfo[], { done: number; total: number }>;
  /** Document Properties and Security Info facts (M2-12). */
  docProperties: MethodSpec<{ docId: string }, DocProperties>;
  /** Optional content groups: names and default visibility (list-only, ADR-012 d5). */
  listLayers: MethodSpec<{ docId: string }, LayerList>;
  /** An attachment's bytes, transferred (never parsed or run here). */
  readAttachment: MethodSpec<{ docId: string; ref: AttachmentRef }, { bytes: ArrayBuffer }>;
  /** Highlight rectangles for hits on one page, in the viewer's page space. */
  hitRects: MethodSpec<
    { docId: string; pageIndex: number; hits: { start: number; length: number }[] },
    HitRect[][]
  >;
  /**
   * Background text indexing after open (M2-06, ADR-006 decision 3): fills
   * the search cache page by page, viewport order first. Background priority;
   * pauses while `activity` reports scrolling or zooming.
   */
  indexText: MethodSpec<
    { docId: string; visible: number[] },
    { pages: number; extracted: number; pausedMs: number; ms: number },
    { done: number; total: number }
  >;
  /** The user is scrolling or zooming: background work backs off for `quietMs`. */
  activity: MethodSpec<{ quietMs?: number }, null>;
  textStats: MethodSpec<
    { docId: string; priority?: WorkPriority },
    { pages: number; chars: number; ms: number },
    { done: number; total: number }
  >;
}
