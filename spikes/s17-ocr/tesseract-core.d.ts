// Typings for the spike's direct use of the tesseract.js-core glue (CommonJS, emscripten MODULARIZE).
declare module 'tesseract.js-core/tesseract-core-simd-lstm.js' {
  export interface TessBox {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  }
  export interface TessIterator {
    Begin(): void;
    Next(level: number): boolean;
    IsAtBeginningOf(level: number): boolean;
    GetUTF8Text(level: number): string;
    Confidence(level: number): number;
    getBoundingBox(level: number): TessBox;
    getBaseline(level: number): TessBox & { has_baseline: boolean };
    __destroy__(): void;
  }
  export interface TessApi {
    Init(path: null, lang: string, oem: number): number;
    SetVariable(k: string, v: string): boolean;
    SetImageFile(exif: number, angle: number): number;
    SetSourceResolution(ppi: number): void;
    Recognize(monitor: null): number;
    GetIterator(): TessIterator;
    MeanTextConf(): number;
    Version(): string;
    End(): void;
  }
  export interface TessModule {
    FS: { writeFile(p: string, d: Uint8Array | string): void; unlink(p: string): void };
    TessBaseAPI: new () => TessApi;
  }
  const factory: (args: {
    locateFile?: (path: string, prefix: string) => string;
    TesseractProgress?: (percent: number) => void;
  }) => Promise<TessModule>;
  export default factory;
}
declare module 'tesseract.js-core/tesseract-core-simd-lstm.wasm?url' {
  const url: string;
  export default url;
}
