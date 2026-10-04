// OCR worker API (ADR-020 decisions 1, 2, 6): tesseract.js-core hosted in our
// own worker behind the typed RPC. One page raster per call; Recognize is one
// synchronous WASM call, so a mid-page cancel is the client terminating the
// worker (ocrClient.ts).
import type { OcrLanguage } from '../model/ocr/languages';
import type { OcrLine } from '../model/ocr/types';
import type { MethodSpec } from './protocol';

/** One language's data file (self-hosted, scripts/vite-assets.ts). */
export interface OcrDataSource {
  code: OcrLanguage;
  url: string;
}

export interface OcrRaster {
  width: number;
  height: number;
  /** One gray byte per pixel, rows top-down; transferred. */
  data: ArrayBuffer;
  dpi: number;
}

export interface OcrApi {
  /** Loads the core (its WASM from this origin) and the data of `languages`, in that order. */
  init: MethodSpec<{ languages: OcrDataSource[] }, { ms: number; version: string }>;
  /** Recognizes one raster; progress is Tesseract's percent within the page. */
  recognize: MethodSpec<
    OcrRaster,
    { lines: OcrLine[]; conf: number; ms: number },
    { percent: number }
  >;
}
