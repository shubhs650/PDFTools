import type {
  Affine,
  PageFrame,
  PageSignature,
  PageText,
  RasterBand,
} from '../model/compare/material';
import type { HfBands } from '../model/compare/text/headers';
import type { OcrLine } from '../model/ocr/types';
import type { AsIsCheck, SheetAlignment } from '../model/compare/align/aligner';
import type { PairingResult } from '../model/compare/pairing';
import type { TextComparison } from '../model/compare/text/match';
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
 * A text comparison (M12-17, D-63) puts each page's text with `layout`: the
 * worker reads the page's words in reading order at once and keeps that
 * (typed arrays, about a fifth of the characters' size) instead of the
 * characters; `matchText` then compares the pages put so far.
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

/**
 * A text comparison's progress: pages read into paragraphs, then the
 * stretches compared (their number is not known before: total 0).
 */
export interface TextMatchProgress {
  stage: 'read' | 'match';
  done: number;
  total: number;
}

/** Rows of the similarity matrix done so far. */
export interface PairingProgress {
  done: number;
  total: number;
}

/** The switches of a text comparison (D-63). */
export interface TextOptions {
  /** Detect moves (default true). */
  moves?: boolean;
  /** Leave headers and footers out and report them once (default true; experimental). */
  headersFooters?: boolean;
  /** Header and footer bands drawn by hand, per side: they replace the detection. */
  bands?: { a?: HfBands; b?: HfBands };
  /** Fold clause renumbering into one entry (default true; experimental). */
  renumbering?: boolean;
}

export interface CompareApi {
  /** Starts a comparison's store (idempotent). */
  open: MethodSpec<{ cmpId: string }, null>;
  putSignature: MethodSpec<
    { cmpId: string; side: CompareSide; page: number; signature: PageSignature },
    { bytes: number }
  >;
  putText: MethodSpec<
    { cmpId: string; side: CompareSide; page: number; text: PageText; layout?: boolean },
    { bytes: number }
  >;
  /**
   * Compares the text of the two sides (M12-17, D-63) on the pages put with
   * `layout`: side pages 0 … `pages.a` − 1 of A against 0 … `pages.b` − 1 of
   * B (default: every page up to the first one missing). Progress counts
   * pages read into paragraphs, then the stretches compared.
   */
  matchText: MethodSpec<
    { cmpId: string; pages?: { a: number; b: number } } & TextOptions,
    TextComparison,
    TextMatchProgress
  >;
  /**
   * A scanned page read by OCR at compare time (M12-18, D-63, Q29): the OCR
   * worker's lines on a raster at `dpi` in PDFium's layout of the page,
   * `turn` to the displayed page. Kept like a text page put with `layout`.
   */
  putOcr: MethodSpec<
    {
      cmpId: string;
      side: CompareSide;
      page: number;
      lines: OcrLine[];
      dpi: number;
      frame: PageFrame;
      turn: Affine;
    },
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
  /** Forgets a sheet's facts: its analysis starts again (layer switches changed what is drawn). */
  resetSheet: MethodSpec<{ cmpId: string; sheet: number }, null>;
  /** A sheet's facts once its bands are in. */
  sheetFacts: MethodSpec<{ cmpId: string; sheet: number }, SheetFacts>;
  summary: MethodSpec<{ cmpId: string }, CompareSummary>;
  /** Drops everything the comparison holds (it was closed). */
  release: MethodSpec<{ cmpId: string }, { freedBytes: number }>;
  memory: MethodSpec<null, CompareMemory>;
}
