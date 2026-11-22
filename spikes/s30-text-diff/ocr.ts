// Spike S30 (M12-05): OCR at compare time (D-63, Q29). A scanned page with no
// text layer is rendered by PDFium (S28's banded renderer) and read by
// tesseract.js-core, the WASM the app's OCR worker loads (ADR-020), with the
// app's shipped English data. Words come back in the displayed page's space,
// so the rest of the pipeline treats them like PDFium's words ("from OCR").
// In the app this runs in the OCR worker for the comparison only; the file is
// not changed.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';
import { pageInfo, renderInk, type Doc } from '../s28-alignment/pdfium.ts';
import type { OcrFn, OcrWord } from './doc.ts';

const require = createRequire(import.meta.url);

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface TessApi {
  Init(path: null, lang: string, oem: number): number;
  SetVariable(k: string, v: string): boolean;
  SetImageFile(exif: number, angle: number): number;
  SetSourceResolution(ppi: number): void;
  Recognize(monitor: null): number;
  GetIterator(): {
    Begin(): void;
    Next(level: number): boolean;
    GetUTF8Text(level: number): string;
    getBoundingBox(level: number): Box;
    delete?(): void;
  };
}
interface TessModule {
  FS: { writeFile(p: string, d: Uint8Array | string): void; unlink(p: string): void };
  TessBaseAPI: new () => TessApi;
}

const RIL_WORD = 3;
let apiP: Promise<{ tess: TessModule; api: TessApi }> | null = null;

function engine(): Promise<{ tess: TessModule; api: TessApi }> {
  apiP ??= (async () => {
    const factory = require('tesseract.js-core/tesseract-core-simd-lstm.js') as (
      o: Record<string, unknown>,
    ) => Promise<TessModule>;
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
  return apiP;
}

export interface OcrStats {
  pages: number;
  ms: number;
}
export const ocrStats: OcrStats = { pages: 0, ms: 0 };

/** OCR of one page at `dpi`, words in displayed pt. */
export const ocrPage =
  (dpi = 300): OcrFn =>
  async (doc: Doc, page: number): Promise<OcrWord[] | null> => {
    const t = performance.now();
    const { tess, api } = await engine();
    const info = pageInfo(doc, page);
    const scale = dpi / 72;
    const width = Math.ceil(info.w * scale);
    const height = Math.ceil(info.h * scale);
    const ink = renderInk(doc, page, { scale, width, height });
    const header = Buffer.from(`P5\n${String(width)} ${String(height)}\n255\n`, 'latin1');
    const img = new Uint8Array(header.length + ink.data.length);
    img.set(header, 0);
    for (let i = 0; i < ink.data.length; i++) img[header.length + i] = 255 - (ink.data[i] ?? 0);
    tess.FS.writeFile('/input', img);
    if (api.SetImageFile(1, 0) === 1) throw new Error('SetImageFile failed');
    api.SetSourceResolution(dpi);
    api.Recognize(null);
    const it = api.GetIterator();
    it.Begin();
    const out: OcrWord[] = [];
    do {
      const text = it.GetUTF8Text(RIL_WORD).trim();
      if (!text) continue;
      const b = it.getBoundingBox(RIL_WORD);
      const box = { x0: b.x0 / scale, y0: b.y0 / scale, x1: b.x1 / scale, y1: b.y1 / scale };
      out.push({ text, box, size: (box.y1 - box.y0) * 1.15 });
    } while (it.Next(RIL_WORD));
    it.delete?.();
    tess.FS.unlink('/input');
    ocrStats.pages++;
    ocrStats.ms += performance.now() - t;
    return out;
  };
