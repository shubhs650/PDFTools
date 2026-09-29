import type { GridIndex, Snap, SnapKind } from '../model/snapIndex';
import type { MethodSpec } from './protocol';

/**
 * Snap worker API (M3-18, ADR-008 decision 2): pure JS, no PDFium. Holds the
 * page indexes the Work worker built (transferred through the main thread,
 * never copied) and answers pointer queries, so a query never waits for PDFium.
 * Keys are `<docId>/<page>`; coordinates are PDF user space.
 */
export interface SnapApi {
  load: MethodSpec<{ key: string; index: GridIndex }, { segments: number }>;
  /** Drops the indexes of a document (closed) or one page. */
  drop: MethodSpec<{ prefix: string }, null>;
  snap: MethodSpec<
    { key: string; x: number; y: number; r: number; kinds: SnapKind[] },
    Snap | null
  >;
}
