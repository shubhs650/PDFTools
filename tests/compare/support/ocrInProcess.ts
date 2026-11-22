// An in-process stand-in for the OCR client in unit tests (M12-18): the same
// tesseract.js-core build and English data the OCR worker loads, run in Node
// with the worker's own result reading (readLines) and raster format (pgmOf).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';
import type { OcrClient } from '../../../src/engine/ocrClient';
import type { OcrRaster } from '../../../src/engine/ocrApi';
import { pgmOf, readLines } from '../../../src/workers/ocr/recognize';

const require = createRequire(import.meta.url);

interface Tess {
  FS: { writeFile(p: string, d: Uint8Array): void; unlink(p: string): void };
  TessBaseAPI: new () => {
    Init(path: null, lang: string, oem: number): number;
    SetVariable(k: string, v: string): boolean;
    SetImageFile(exif: number, angle: number): number;
    SetSourceResolution(ppi: number): void;
    Recognize(monitor: null): number;
    MeanTextConf(): number;
    GetIterator(): Parameters<typeof readLines>[0];
  };
}

let engine: Promise<{ tess: Tess; api: InstanceType<Tess['TessBaseAPI']> }> | null = null;

function start() {
  engine ??= (async () => {
    const factory = require('tesseract.js-core/tesseract-core-simd-lstm.js') as (
      o: Record<string, unknown>,
    ) => Promise<Tess>;
    const tess = await factory({});
    const gz = readFileSync(
      require.resolve('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'),
    );
    tess.FS.writeFile('/eng.traineddata', gunzipSync(gz));
    const api = new tess.TessBaseAPI();
    if (api.Init(null, 'eng', 1) !== 0) throw new Error('Tesseract Init failed');
    api.SetVariable('tessedit_pageseg_mode', '3');
    return { tess, api };
  })();
  return engine;
}

/** An OCR client that recognizes in this process; `pages` counts the pages read. */
export function ocrInProcess(): Pick<OcrClient, 'recognize'> & { pages: number } {
  const client = {
    pages: 0,
    recognize: async (raster: OcrRaster) => {
      const { tess, api } = await start();
      const t0 = performance.now();
      tess.FS.writeFile('/input', pgmOf(raster.width, raster.height, new Uint8Array(raster.data)));
      try {
        if (api.SetImageFile(1, 0) === 1) throw new Error('SetImageFile failed');
        api.SetSourceResolution(raster.dpi);
        api.Recognize(null);
        const it = api.GetIterator();
        try {
          client.pages++;
          return { lines: readLines(it), conf: api.MeanTextConf(), ms: performance.now() - t0 };
        } finally {
          it.__destroy__();
        }
      } finally {
        tess.FS.unlink('/input');
      }
    },
  };
  return client;
}
