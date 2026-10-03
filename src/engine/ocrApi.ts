// OCR worker API (ADR-020 decisions 1, 2, 6): tesseract.js-core hosted in our
// own worker behind the typed RPC. One page raster per call; Recognize is one
// synchronous WASM call, so a mid-page cancel is the client terminating the
// worker (ocrClient.ts).
import type { OcrLine } from '../model/ocr/types';
import type { MethodSpec } from './protocol';

/** The English data, self-hosted (scripts/vite-assets.ts) and precached in the background. */
export const OCR_DATA_PATH = 'ocr/eng.traineddata.gz';

export interface OcrRaster {
  width: number;
  height: number;
  /** One gray byte per pixel, rows top-down; transferred. */
  data: ArrayBuffer;
  dpi: number;
}

export interface OcrApi {
  /** Loads the core (its WASM from this origin) and the language data from `dataUrl`. */
  init: MethodSpec<{ dataUrl: string }, { ms: number; version: string }>;
  /** Recognizes one raster; progress is Tesseract's percent within the page. */
  recognize: MethodSpec<
    OcrRaster,
    { lines: OcrLine[]; conf: number; ms: number },
    { percent: number }
  >;
}
