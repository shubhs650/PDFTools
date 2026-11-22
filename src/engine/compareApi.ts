import type { PageSignature, PageText, RasterBand } from '../model/compare/material';
import type { MethodSpec } from './protocol';

/**
 * Compare worker API (M12-07, D-66, ARCHITECTURE §3.1): our own code, no
 * PDFium, like the Snap worker. It holds each open comparison's material —
 * signatures and positioned text per page, transferred from the Work worker
 * through the main thread, never copied — and works on it, so a long
 * comparison never blocks search, snapping or the main thread. Analysis
 * rasters are never kept whole (S28): each band pair is folded into its
 * sheet's running state and dropped. Later tasks add alignment (M12-10),
 * detection (M12-14) and text matching (M12-17) as further methods.
 *
 * `cmpId` names one comparison; `release` drops everything it holds.
 */
export type CompareSide = 'a' | 'b';

/** What one sheet pair's analysis rasters showed (exact pixels, no tolerance). */
export interface SheetFacts {
  /** Raster size (B's frame at `dpi`). */
  width: number;
  height: number;
  dpi: number;
  /** Pixels with ink (at the ink level) on A, on B, on both. */
  inkA: number;
  inkB: number;
  both: number;
  /** Bounding box of each side's ink in the frame (pt), or null on a blank side. */
  boxA: [number, number, number, number] | null;
  boxB: [number, number, number, number] | null;
  /** Both rasters equal pixel for pixel: the sheet can skip detection. */
  identical: boolean;
  /** Rows folded in (a sheet is complete when rows === height). */
  rows: number;
}

export interface CompareMemory {
  /** Bytes the worker's stores hold (typed arrays and words). */
  bytes: number;
  comparisons: number;
}

export interface CompareSummary {
  signatures: Record<CompareSide, number>;
  texts: Record<CompareSide, number>;
  /** Sheets with facts so far. */
  sheets: number;
  bytes: number;
}

export interface CompareApi {
  /** Starts a comparison's store (idempotent). */
  open: MethodSpec<{ cmpId: string }, null>;
  putSignature: MethodSpec<
    { cmpId: string; side: CompareSide; page: number; signature: PageSignature },
    { bytes: number }
  >;
  putText: MethodSpec<
    { cmpId: string; side: CompareSide; page: number; text: PageText },
    { bytes: number }
  >;
  /**
   * The same rows of both analysis rasters of sheet `sheet` (A already drawn
   * into B's frame): folded into the sheet's facts, then dropped.
   */
  sheetBand: MethodSpec<
    { cmpId: string; sheet: number; dpi: number; a: RasterBand; b: RasterBand; inkLevel?: number },
    { rows: number }
  >;
  /** A sheet's facts once its bands are in. */
  sheetFacts: MethodSpec<{ cmpId: string; sheet: number }, SheetFacts>;
  summary: MethodSpec<{ cmpId: string }, CompareSummary>;
  /** Drops everything the comparison holds (it was closed). */
  release: MethodSpec<{ cmpId: string }, { freedBytes: number }>;
  memory: MethodSpec<null, CompareMemory>;
}
