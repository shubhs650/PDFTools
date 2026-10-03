// OCR worker (ADR-020 decisions 1, 2, 6): tesseract.js-core's SIMD, LSTM-only
// build behind our typed RPC. The WASM is a hashed same-origin asset handed to
// the glue through `locateFile`; the English data is inflated from the
// self-hosted gzip into the module's in-memory FS. One raster per call, as a
// PGM file (Leptonica reads it, no codec); Recognize is synchronous, so the
// client cancels a page by terminating this worker.
import TesseractCore, {
  type TessApi,
  type TessModule,
} from 'tesseract.js-core/tesseract-core-simd-lstm.js';
import wasmUrl from 'tesseract.js-core/tesseract-core-simd-lstm.wasm?url';
import { RpcError } from '../engine/errors';
import type { OcrApi } from '../engine/ocrApi';
import { pgmOf, readLines } from './ocr/recognize';
import { serve } from './rpc-host';

const OEM_LSTM_ONLY = 1;
const PSM_AUTO = 3;
let tess: TessModule | undefined;
let api: TessApi | undefined;
let onPercent: ((p: number) => void) | undefined;

async function gunzip(bytes: ArrayBuffer): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

serve<OcrApi>(self, {
  init: async ({ dataUrl }) => {
    const t0 = performance.now();
    tess = await TesseractCore({
      locateFile: () => new URL(wasmUrl, self.location.href).href,
      TesseractProgress: (p) => onPercent?.(p),
    });
    const res = await fetch(dataUrl);
    if (!res.ok) throw new RpcError('ocr-data', 'The OCR language data could not be loaded');
    tess.FS.writeFile('/eng.traineddata', await gunzip(await res.arrayBuffer()));
    api = new tess.TessBaseAPI();
    if (api.Init(null, 'eng', OEM_LSTM_ONLY) !== 0)
      throw new RpcError('ocr-init', 'The OCR engine could not be initialized');
    api.SetVariable('tessedit_pageseg_mode', String(PSM_AUTO));
    return { ms: performance.now() - t0, version: api.Version() };
  },

  recognize: ({ width, height, data, dpi }, ctx) => {
    if (!tess || !api) throw new RpcError('not-initialized', 'The OCR worker is not initialized');
    const t0 = performance.now();
    onPercent = (percent) => {
      ctx.progress({ percent });
    };
    try {
      tess.FS.writeFile('/input', pgmOf(width, height, new Uint8Array(data)));
      if (api.SetImageFile(1, 0) === 1)
        throw new RpcError('ocr-image', 'The page raster could not be read');
      api.SetSourceResolution(dpi);
      api.Recognize(null);
      const it = api.GetIterator();
      try {
        return { lines: readLines(it), conf: api.MeanTextConf(), ms: performance.now() - t0 };
      } finally {
        it.__destroy__();
      }
    } finally {
      onPercent = undefined;
      try {
        tess.FS.unlink('/input');
      } catch {
        // never written
      }
    }
  },
});
