// The part of tesseract.js-core's embind API the OCR worker uses (ADR-020
// decision 1). The package ships no typings; these were checked against the
// 7.0.0 build in spikes/s17-ocr (tests/ocr/recognize.test.ts drives the
// iterator parsing with a fake of this shape).
declare module 'tesseract.js-core/tesseract-core-simd-lstm.js' {
  export interface TessBox {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  }
  export interface TessBaseline extends TessBox {
    has_baseline: boolean;
  }
  export interface TessIterator {
    Begin(): void;
    /** Advances to the next element of `level`; false at the end. */
    Next(level: number): boolean;
    IsAtBeginningOf(level: number): boolean;
    GetUTF8Text(level: number): string;
    Confidence(level: number): number;
    getBoundingBox(level: number): TessBox;
    getBaseline(level: number): TessBaseline;
    __destroy__(): void;
  }
  export interface TessApi {
    /** 0 on success. `oem` 1 = LSTM only. */
    Init(datapath: null, language: string, oem: number): number;
    SetVariable(name: string, value: string): boolean;
    /** Reads the image written to `/input` in the module FS; 1 on failure. */
    SetImageFile(exif: number, angle: number): number;
    SetSourceResolution(ppi: number): void;
    Recognize(monitor: null): number;
    GetIterator(): TessIterator;
    MeanTextConf(): number;
    Version(): string;
    Clear(): void;
    End(): void;
  }
  export interface TessModule {
    FS: {
      writeFile(path: string, data: Uint8Array | string): void;
      unlink(path: string): void;
    };
    TessBaseAPI: new () => TessApi;
  }
  export interface TessModuleArgs {
    /** Where the glue fetches its `.wasm` from (same-origin, rule 4). */
    locateFile?: (path: string, prefix: string) => string;
    /** Called during Recognize with 0–100. */
    TesseractProgress?: (percent: number) => void;
  }
  const TesseractCore: (args?: TessModuleArgs) => Promise<TessModule>;
  export default TesseractCore;
}
declare module 'tesseract.js-core/tesseract-core-simd-lstm.wasm?url' {
  const url: string;
  export default url;
}
