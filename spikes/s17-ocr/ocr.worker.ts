// S17 OCR worker stand-in: tesseract.js-core (SIMD, LSTM-only build) in a
// module worker under the §10.1 CSP. The WASM is a same-origin asset passed
// through `locateFile` (never the glue's own default), the English data is a
// same-origin gzip inflated here. One page per call; Recognize is synchronous
// in the WASM, so a cancel mid-page is the caller terminating this worker.
import TesseractCore, {
  type TessApi,
  type TessModule,
} from 'tesseract.js-core/tesseract-core-simd-lstm.js';
import wasmUrl from 'tesseract.js-core/tesseract-core-simd-lstm.wasm?url';
import { serve, type CallContext } from '../s3-two-engines/rpc.ts';

let tess: TessModule | undefined;
let api: TessApi | undefined;
let progressSink: ((p: number) => void) | undefined;
const RIL_TEXTLINE = 2;
const RIL_WORD = 3;
const r1 = (n: number) => Math.round(n * 10) / 10;

async function gunzip(bytes: ArrayBuffer): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const handlers = {
  async init(a: { dataUrl: string }): Promise<{
    coreMs: number;
    dataMs: number;
    initMs: number;
    version: string;
    wasmFrom: string;
  }> {
    const t0 = performance.now();
    tess = await TesseractCore({
      locateFile: () => new URL(wasmUrl, self.location.href).href,
      TesseractProgress: (p) => progressSink?.(p),
    });
    const coreMs = r1(performance.now() - t0);
    const t1 = performance.now();
    const gz = await (await fetch(a.dataUrl)).arrayBuffer();
    tess.FS.writeFile('/eng.traineddata', await gunzip(gz));
    const dataMs = r1(performance.now() - t1);
    const t2 = performance.now();
    api = new tess.TessBaseAPI();
    if (api.Init(null, 'eng', 1) !== 0) throw new Error('Init failed');
    api.SetVariable('tessedit_pageseg_mode', '3');
    return {
      coreMs,
      dataMs,
      initMs: r1(performance.now() - t2),
      version: api.Version(),
      wasmFrom: new URL(wasmUrl, self.location.href).pathname,
    };
  },
  recognize(
    a: { pgm: ArrayBuffer; dpi: number },
    ctx: CallContext,
  ): { ms: number; words: string[]; conf: number; progressTicks: number } {
    if (!tess || !api) throw new Error('not initialized');
    let ticks = 0;
    progressSink = (p) => {
      ticks++;
      ctx.progress({ percent: p });
    };
    tess.FS.writeFile('/input', new Uint8Array(a.pgm));
    if (api.SetImageFile(1, 0) === 1) throw new Error('SetImageFile failed');
    api.SetSourceResolution(a.dpi);
    const t0 = performance.now();
    api.Recognize(null);
    const ms = r1(performance.now() - t0);
    const it = api.GetIterator();
    it.Begin();
    const words: string[] = [];
    do {
      if (it.IsAtBeginningOf(RIL_TEXTLINE)) it.getBaseline(RIL_TEXTLINE);
      const w = it.GetUTF8Text(RIL_WORD).trim();
      if (w) words.push(w);
      it.getBoundingBox(RIL_WORD);
    } while (it.Next(RIL_WORD));
    it.__destroy__();
    tess.FS.unlink('/input');
    progressSink = undefined;
    return { ms, words, conf: api.MeanTextConf(), progressTicks: ticks };
  },
};

export type OcrHandlers = typeof handlers;
serve(handlers);
