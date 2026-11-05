// Work worker API (ARCHITECTURE §3.1, D-10): PDFium #2 with a read-only copy of
// each document. M1 uses it for save verification (M1-21); M2 adds search.
import type { PdfAnnotationObject, PageTextSlice, PdfPageGeometry } from '@embedpdf/models';
import type { DocDigest } from '../workers/render/save/digest';
import type { AttachmentInfo, AttachmentRef } from '../workers/work/attachments';
import type { FormFacts } from '../model/formFacts';
import type { PageVp } from '../workers/work/viewports';
import type { Band, BandRequest } from '../workers/work/print';
import type { FlattenOptions } from '../workers/work/flatten';
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
import type { SecurityCheck, SecurityVerifyResult } from '../workers/work/verifySecurity';
import type { GridIndex } from '../model/snapIndex';
import type { SnapshotRegion } from '../workers/work/crs';
import type { WorkbookSpec } from '../workers/work/crsWorkbook';
import type { ExtractOptions } from '../workers/work/extract';
import type {
  SourceSummary,
  TransferCounts,
  TransferObject,
  TransferSource,
  TransferSpec,
} from '../workers/work/transferJobs';
import type { TableData, TableGrid } from '../model/tableGrid';
import type {
  ClipItem,
  OutlineEdit,
  OutlineExpect,
  OutlineItem,
  OutlinePath,
} from '../model/outline';
import type { PageOcr } from '../model/ocr/types';
import type { LayerResult } from '../workers/work/ocrLayer';
import type { RedactProgress, SkipStep } from '../workers/work/redact/apply';
import type { RecutReport } from '../workers/work/redact/pathRecut';
import type { Leak } from '../workers/work/redact/verify';
import type { PageTables } from '../workers/work/tables/detect';
import type { TableExportResult, TableFormat, TablePackaging } from '../workers/work/tables/job';
import type { MethodSpec } from './protocol';

export type WorkPriority = 'interactive' | 'save-verify' | 'geometry' | 'background';

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
  /**
   * Unsaved changes the jobs must see (M4-09 page operations): a section after
   * the saved tail, dropped when a save is appended. Drops the document's
   * search, snap-geometry and Oxide caches (pages may have moved).
   */
  setLive: MethodSpec<{ docId: string; live: ArrayBuffer | null }, null>;
  /**
   * Extract Pages / Merge Files (M4-11): a new, unencrypted document from pages
   * of open documents (their Work copies, unsaved changes included) and of
   * picked files, in order; `outline`: one bookmark per part (merge). Refused
   * for an encrypted source without full access (M4-Q2).
   */
  assemble: MethodSpec<
    {
      parts: (
        | { docId: string; pages: number[]; title: string }
        | { bytes: ArrayBuffer; password?: string; pages: number[]; title: string }
      )[];
      outline: boolean;
    },
    { bytes: ArrayBuffer },
    { done: number; total: number }
  >;
  /**
   * Import Comments (M4-20, ADR-018): a source PDF's comments for the dialog's
   * summary. Wrong or missing password: `pdfium:4`. `copyAllowed` false: the
   * source's permissions forbid copying (rule 9) and nothing else is read.
   */
  commentSource: MethodSpec<TransferSource, SourceSummary>;
  /**
   * Copies the source's comments into the document's current state (its live
   * section must be current): the objects for the Render worker's `pagesApply`
   * and the counts; with `dryRun`, the counts only (the dialog's preview).
   */
  transferComments: MethodSpec<
    { docId: string; source: TransferSource; spec: TransferSpec },
    { objects: TransferObject[]; firstNew: number; counts: TransferCounts },
    { done: number; total: number }
  >;
  /**
   * OCR (M5, ADR-020 d3, d5): the page as displayed, 8-bit gray at `dpi`, from
   * the document as it is now (live section current); `hasText` and no pixels
   * when the page has a text layer already (rendered anyway with `force`). Needs modify (rule 9).
   */
  ocrRaster: MethodSpec<
    { docId: string; pageIndex: number; dpi: number; force?: boolean },
    { hasText: boolean; width: number; height: number; data: ArrayBuffer }
  >;
  /**
   * The recognized pages as text-layer objects for the Render worker's
   * `pagesApply` (ADR-020 d4), built on the document's current state.
   */
  ocrLayer: MethodSpec<{ docId: string; pages: PageOcr[] }, LayerResult>;
  /**
   * Bookmarks (M6-11, §7.15): the outline as the Bookmarks pane shows it, read
   * by our object layer from the current state (live section synced first).
   */
  readOutline: MethodSpec<{ docId: string }, { items: OutlineItem[] }>;
  /**
   * Sticky note pop-ups (M7-06, spike S23): whether each pop-up object (by
   * number, from the Render worker's list) is open — /Open is a boolean
   * PDFium can't read.
   */
  popupStates: MethodSpec<{ docId: string; objs: number[] }, { open: boolean[] }>;
  /** Copy / Cut of bookmarks: the items with every key (`bookmark-stale` if moved since). */
  copyOutline: MethodSpec<
    { docId: string; paths: OutlinePath[]; expect: OutlineExpect[] },
    { items: ClipItem[] }
  >;
  /**
   * A bookmark edit (ADR-022 decision 5, route B): the outline objects to write
   * for the Render worker's `pagesApply` (capability modify). `bookmark-stale`:
   * the outline changed since it was shown; `bookmark-invalid`: a bad edit.
   */
  editOutline: MethodSpec<
    { docId: string; edit: OutlineEdit; expect: OutlineExpect[] },
    { objects: TransferObject[]; firstNew: number }
  >;
  /** The in-app clipboard (M4-21): the chosen comments as a small PDF. Needs copy. */
  copyComments: MethodSpec<
    { docId: string; ids: string[]; withReplies: boolean },
    { bytes: ArrayBuffer; pages: number[]; count: number }
  >;
  /**
   * Tables (M4-12, §7.7): detected per page — ruled and unruled candidates,
   * merged headers rebuilt, cells filled — or an OCR note for a page without
   * text. Copy permission (rule 9); cancellable between pages.
   */
  detectTables: MethodSpec<
    { docId: string; pages: number[] },
    { pages: PageTables[] },
    { done: number; total: number }
  >;
  /** The cells of given grids (review edits, templates): text by word centre. */
  tableCells: MethodSpec<{ docId: string; grids: TableGrid[] }, { tables: TableData[] }>;
  /**
   * Express Extract (M4-13) / Review & Extract export (M4-14): the tables of
   * `pages` (detected) or of `grids` → one workbook or CSV files; `tables: 0`
   * when there are none.
   */
  exportTables: MethodSpec<
    {
      docId: string;
      pages?: number[];
      grids?: TableGrid[];
      /** Tables already read (Express Extract's detection result). */
      tables?: TableData[];
      format: TableFormat;
      packaging: TablePackaging;
      baseName: string;
    },
    TableExportResult,
    { done: number; total: number }
  >;
  /**
   * Apply redactions (M4-17/18, §7.9): the /Redact marks of the current state
   * applied on a copy, sanitized, fully rewritten (encryption kept) and
   * verified by location, string and structure. `bytes` may be written only
   * when `leaks` is empty (rule 8). Modify permission (rule 9); cancellable
   * between pages. `skip` exists for the e2e failure-path test only.
   */
  redact: MethodSpec<
    { docId: string; skip?: SkipStep },
    {
      bytes: ArrayBuffer;
      marks: number;
      pages: number[];
      removedAnnotations: number;
      recut: RecutReport;
      removed: string[];
      outlineItemsRemoved: number;
      fieldsRemoved: number;
      leaks: Leak[];
    },
    RedactProgress
  >;
  /** Appends a saved tail piece to the document's tail (after a committed save). */
  append: MethodSpec<{ docId: string; piece: ArrayBuffer }, { tailBytes: number }>;
  /**
   * Save verification (M1-21, ADR-005 decision 2): reopens original + tail +
   * `piece` and compares it with the Render worker's `expected` digest.
   */
  verify: MethodSpec<{ docId: string; piece: ArrayBuffer; expected: DocDigest }, VerifyResult>;
  /**
   * Password Security's check (M6-12, §7.12): the new file reopened with no
   * password, the open password and the permissions password (or, after a
   * removal, without one) and compared with the Render worker's digest.
   * Progress: pages digested.
   */
  verifySecurity: MethodSpec<
    { bytes: ArrayBuffer; check: SecurityCheck; expected: DocDigest },
    SecurityVerifyResult,
    { done: number; total: number }
  >;
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
  /**
   * Every annotation, by page, for plugin-annotation's store (M3-05, ADR-014
   * decision 2); ids for /NM-less annotations are stable (`obj-<n>`). The
   * pages arrive with the progress, one batch at a time, so no single message
   * (and its copy on the main thread) holds them all; the result is the count.
   */
  annotations: MethodSpec<
    { docId: string },
    { pages: number },
    { done: number; total: number; pages: Record<number, PdfAnnotationObject[]> }
  >;
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
  /** Each page's /VP (as plain PDF data) and MediaBox (M3-15, ADR-007). */
  pageViewports: MethodSpec<{ docId: string }, PageVp[]>;
  /**
   * A page's snap index (M3-18, ADR-008): its vector geometry extracted whole
   * (cached per page), indexed, and transferred — the main thread hands it on
   * to the Snap worker untouched. Geometry priority: below interactive search,
   * above background indexing. `minLen` (points) drops shorter segments on
   * dense pages (decision 3); `dense` says the page needed it.
   */
  snapGeometry: MethodSpec<
    { docId: string; pageIndex: number; minLen: number },
    { index: GridIndex; segments: number; dense: boolean; ms: number }
  >;
  /**
   * CRS export (M3-19, D-15, ADR-015): the workbook built here (ExcelJS,
   * lazy), with a snapshot per row when `snapshots` is given — rendered from
   * a copy of the current revision plus `piece` (unsaved edits). Progress per
   * row; cancellable between rows; the file's bytes come back transferred.
   */
  crs: MethodSpec<
    { docId: string; piece?: ArrayBuffer; spec: WorkbookSpec; snapshots: SnapshotRegion[] | null },
    { bytes: ArrayBuffer },
    { done: number; total: number }
  >;
  /** Form facts EmbedPDF doesn't give: /Tabs per page, /DV per field (M2-14). */
  formFacts: MethodSpec<{ docId: string }, FormFacts>;
  /**
   * Printing (M2-15): a separate copy of the current revision, with the
   * Render worker's unsaved edits (`piece`, a narrow tail) appended.
   */
  printOpen: MethodSpec<{ docId: string; piece?: ArrayBuffer }, { printId: string }>;
  /** Displayed size (points, /Rotate applied) and rotation of each page. */
  printPages: MethodSpec<
    { printId: string; pages: number[] },
    { width: number; height: number; rotation: number }[]
  >;
  /** One band of a printed page, RGBA, transferred. */
  printBand: MethodSpec<{ printId: string } & BandRequest, Band>;
  printClose: MethodSpec<{ printId: string }, null>;
  /**
   * Export Print-Ready PDF (M2-16, ADR-013 decision 6): a copy of the current
   * revision plus `piece` (unsaved edits) with annotations and form fields
   * flattened, rewritten in full, /AcroForm dropped. Progress counts pages;
   * cancellable between pages. The kept copy is untouched.
   */
  printReady: MethodSpec<
    { docId: string; piece?: ArrayBuffer } & FlattenOptions,
    { bytes: ArrayBuffer },
    { done: number; total: number }
  >;
  /**
   * An attachment's content as a Blob made here (never parsed or run): the
   * main thread gets a handle, never a copy of a large file (rule 1).
   */
  readAttachment: MethodSpec<{ docId: string; ref: AttachmentRef }, { blob: Blob }>;
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
  /**
   * PDF Oxide warm-up (M4-04, ADR-009 decision 2): loads Oxide and runs one
   * throwaway extraction, at background priority, so the first export does not
   * pay the ~0.7 s first call. Idempotent.
   */
  oxideWarm: MethodSpec<null, { warmUpMs: number; oxideBytes: number }>;
  /**
   * An extraction through PDF Oxide (M4-04, M4-05, §7.6) of `pages` (0-based,
   * document order) of the current revision. PDFium's permission check comes
   * first (copy, rule 9): refused with `permission-denied:copy`. Built in the
   * worker: `single` returns the main file, `zip` one archive of every file,
   * `folder` the files for writing into a folder (M4-Q5). Cancellable between
   * pages.
   */
  extract: MethodSpec<
    {
      docId: string;
      pages: number[];
      options: ExtractOptions;
      packaging: 'single' | 'zip' | 'folder';
    },
    {
      blob?: Blob;
      name?: string;
      files?: { path: string; blob: Blob }[];
      pages: number;
      chars: number;
      images: number;
    },
    { done: number; total: number }
  >;
  /**
   * Export Images (M4-06): every distinct image of `pages` as a file (JPEG
   * passed through, the rest PNG), copy permission first; `zip` one archive,
   * `folder` the files. Cancellable between pages.
   */
  exportImages: MethodSpec<
    { docId: string; pages: number[]; baseName: string; packaging: 'zip' | 'folder' },
    {
      blob?: Blob;
      name?: string;
      files?: { path: string; blob: Blob }[];
      pages: number;
      images: number;
      duplicates: number;
      skipped: number;
    },
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
