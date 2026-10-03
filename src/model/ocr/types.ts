// OCR results as they cross the worker boundaries (ADR-020 decision 3): what
// the OCR worker returns for one page raster, and what the Work worker turns
// into the text layer. Pixel coordinates of the raster (y down), which is the
// page as displayed (its /Rotate applied) at OCR_DPI.

/** A box in raster pixels: `x0,y0` top-left, `x1,y1` bottom-right. */
export interface OcrBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrWord {
  text: string;
  box: OcrBox;
  /** Tesseract's confidence, 0–100. */
  conf: number;
}

export interface OcrLine {
  box: OcrBox;
  /** Baseline from `x0,y0` to `x1,y1` (any direction); null when Tesseract has none. */
  baseline: OcrBox | null;
  words: OcrWord[];
}

/** One recognized page: raster size and its lines. */
export interface PageOcr {
  pageIndex: number;
  width: number;
  height: number;
  lines: OcrLine[];
}

/** Resolution of the raster the pages are recognized at (ADR-020 decision 5). */
export const OCR_DPI = 300;

/** Number of words in a page result. */
export const wordCount = (page: PageOcr): number =>
  page.lines.reduce((n, l) => n + l.words.length, 0);
