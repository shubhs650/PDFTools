import type { PageSignature, PageText, RasterBand } from '../model/compare/material';
import type { AsIsCheck, SheetAlignment } from '../model/compare/align/aligner';
import type { PairingResult } from '../model/compare/pairing';
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

/**
 * One side of a pairing (M12-09, D-60): its side pages 0 … count − 1 (the
 * side's files one after the other, each with its page range), the file each
 * comes from, and the files' names.
 */
export interface PairingLayout {
  count: number;
  /** File index per side page. */
  files: number[];
  names: string[];
}

/** Rows of the similarity matrix done so far. */
export interface PairingProgress {
  done: number;
  total: number;
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
  /**
   * Pairs the pages of A and B (M12-09, D-60) on the signatures put so far
   * (keyed by side page): similarity, then the order-keeping assignment.
   * The similarity matrix comes back by transfer for the pairing table.
   */
  pairPages: MethodSpec<
    { cmpId: string; a: PairingLayout; b: PairingLayout; threshold?: number },
    PairingResult,
    PairingProgress
  >;
  /**
   * A page's line geometry (M12-10, D-60): segments in displayed space, from
   * the Work worker's `compareGeometry`. The worker keeps only the page's
   * feature points (line ends, corners, junctions).
   */
  putGeometry: MethodSpec<
    { cmpId: string; side: CompareSide; page: number; segments: Float32Array },
    { features: number; bytes: number }
  >;
  /** The "as is" check of a sheet pair (S28): features within 0.1 pt, no transform. */
  alignAsIs: MethodSpec<{ cmpId: string; a: number; b: number }, AsIsCheck>;
  /**
   * Aligns a vector sheet that failed the as-is check: both pages' coarse
   * ink rasters at `scale` px per pt (whole pages, one band each) and the
   * features put before. The result is kept as the sheet's alignment.
   */
  alignVector: MethodSpec<
    {
      cmpId: string;
      sheet: number;
      a: number;
      b: number;
      coarse: { a: RasterBand; b: RasterBand; scale: number };
    },
    SheetAlignment
  >;
  /** A band of a page's raster for the image method (scans), kept until `alignImage`. */
  putAlignBand: MethodSpec<
    { cmpId: string; sheet: number; side: CompareSide; band: RasterBand },
    { bytes: number }
  >;
  /** Aligns a sheet by the image method on the bands put (at `scale` px per pt), then drops them. */
  alignImage: MethodSpec<{ cmpId: string; sheet: number; scale: number }, SheetAlignment>;
  /** Records a sheet's alignment (as is, or set by hand later: M12-13). */
  setAlignment: MethodSpec<{ cmpId: string; sheet: number; alignment: SheetAlignment }, null>;
  /** A sheet's facts once its bands are in. */
  sheetFacts: MethodSpec<{ cmpId: string; sheet: number }, SheetFacts>;
  summary: MethodSpec<{ cmpId: string }, CompareSummary>;
  /** Drops everything the comparison holds (it was closed). */
  release: MethodSpec<{ cmpId: string }, { freedBytes: number }>;
  memory: MethodSpec<null, CompareMemory>;
}
