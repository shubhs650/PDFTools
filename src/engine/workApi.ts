// Work worker API (ARCHITECTURE §3.1, D-10): PDFium #2 with a read-only copy of
// each document. M1 uses it for save verification (M1-21); M2 adds search.
import type { MethodSpec } from './protocol';

export type WorkPriority = 'interactive' | 'save-verify' | 'background';

export interface WorkApi {
  init: MethodSpec<{ wasmUrl: string }, { ms: number; wasmBytes: number }>;
  /** `original` is transferred (the worker keeps it); `tail` is the incremental tail so far. */
  open: MethodSpec<
    { docId: string; original: ArrayBuffer; tail?: ArrayBuffer; password?: string },
    { pageCount: number; wasmBytes: number }
  >;
  /** Replaces the document's tail (bytes appended since the original). Applied lazily (ADR-001 B11). */
  refresh: MethodSpec<{ docId: string; tail: ArrayBuffer }, { pending: boolean }>;
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
  textStats: MethodSpec<
    { docId: string; priority?: WorkPriority },
    { pages: number; chars: number; ms: number },
    { done: number; total: number }
  >;
}
