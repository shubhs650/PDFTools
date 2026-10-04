// S17 OCR spike, Node part (ADR-020): tesseract.js-core (the WASM the OCR
// worker would load) on self-made scanned pages, then an invisible text layer
// written through EmbedPDF's PDFium build (text objects, render mode 3,
// FPDFPage_GenerateContent) and saved incrementally; the output is reopened and
// checked: words found by FPDFText at the right places, pixels unchanged, the
// original content streams untouched, qpdf clean.
//
//   node --import ./spikes/shared/ts-ext.ts spikes/s17-ocr/run-node.ts
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { gunzipSync } from 'node:zlib';
import { init } from '@embedpdf/pdfium';
import { PdfRef, PdfStream, isDict } from '../../src/model/pdf/objects.ts';
import { PdfReader, inflateStream } from '../../src/model/pdf/reader.ts';
import { rawCall, withWideString } from '../../src/workers/render/pdfium.ts';
import { FPDF_INCREMENTAL, saveWithFlags } from '../../src/workers/render/save/writer.ts';
import { expectedWords, scannedPdf, sourcePdf, type GrayImage } from './fixtures.ts';
import { buildTextLayer, type PageOcr } from './layer.ts';
import { narrowTail } from '../../src/workers/render/save/narrowTail.ts';
import { saveBaseOf } from '../../src/workers/render/save/xref.ts';
import { concatBytes } from '../../src/workers/render/save/bytes.ts';

const require = createRequire(import.meta.url);
const here = join(import.meta.dirname, 'out');
mkdirSync(here, { recursive: true });
const out: Record<string, unknown> = {};
const ms = (t: number) => Math.round((performance.now() - t) * 10) / 10;
const at = <T>(xs: readonly T[] | undefined, i: number): T => {
  const v = xs?.[i];
  if (v === undefined) throw new Error(`missing element ${String(i)}`);
  return v;
};
const rss = () => Math.round(process.memoryUsage().rss / 1048576);

// ---------- PDFium ----------
const mod = await init({
  wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')),
});
(mod as unknown as { PDFiumExt_Init(): void }).PDFiumExt_Init();
const heap = mod.pdfium as unknown as {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  HEAPU8: Uint8Array;
  getValue(ptr: number, t: 'float' | 'double' | 'i32'): number;
};
const call = (name: string, ...a: (number | string)[]) => rawCall(mod, name, ...a);
const FPDFBitmap_Gray = 1;
const FPDFBitmap_BGRA = 4;

function openDoc(bytes: Uint8Array): number {
  const p = heap.wasmExports.malloc(bytes.length);
  heap.HEAPU8.set(bytes, p);
  const doc = call('FPDF_LoadMemDocument', p, bytes.length, '');
  if (!doc) throw new Error('open failed');
  return doc;
}

/** The page as displayed (its /Rotate applied), one gray byte per pixel. */
function renderGray(doc: number, index: number, dpi: number): GrayImage {
  const page = call('FPDF_LoadPage', doc, index);
  const width = Math.round((call('FPDF_GetPageWidthF', page) * dpi) / 72);
  const height = Math.round((call('FPDF_GetPageHeightF', page) * dpi) / 72);
  const bmp = call('FPDFBitmap_CreateEx', width, height, FPDFBitmap_Gray, 0, 0);
  if (!bmp) throw new Error('gray bitmap refused');
  try {
    call('FPDFBitmap_FillRect', bmp, 0, 0, width, height, 0xffffffff);
    call('FPDF_RenderPageBitmap', bmp, page, 0, 0, width, height, 0, 0);
    const buf = call('FPDFBitmap_GetBuffer', bmp);
    const stride = call('FPDFBitmap_GetStride', bmp);
    const data = new Uint8Array(width * height);
    for (let y = 0; y < height; y++)
      data.set(heap.HEAPU8.subarray(buf + y * stride, buf + y * stride + width), y * width);
    return { width, height, data };
  } finally {
    call('FPDFBitmap_Destroy', bmp);
    call('FPDF_ClosePage', page);
  }
}

function renderBgra(doc: number, index: number, dpi: number): Uint8Array {
  const page = call('FPDF_LoadPage', doc, index);
  const width = Math.round((call('FPDF_GetPageWidthF', page) * dpi) / 72);
  const height = Math.round((call('FPDF_GetPageHeightF', page) * dpi) / 72);
  const bmp = call('FPDFBitmap_CreateEx', width, height, FPDFBitmap_BGRA, 0, 0);
  try {
    call('FPDFBitmap_FillRect', bmp, 0, 0, width, height, 0xffffffff);
    call('FPDF_RenderPageBitmap', bmp, page, 0, 0, width, height, 0, 0);
    const buf = call('FPDFBitmap_GetBuffer', bmp);
    return heap.HEAPU8.slice(buf, buf + width * height * 4);
  } finally {
    call('FPDFBitmap_Destroy', bmp);
    call('FPDF_ClosePage', page);
  }
}

function pageText(doc: number, index: number): string {
  const page = call('FPDF_LoadPage', doc, index);
  const tp = call('FPDFText_LoadPage', page);
  try {
    const n = call('FPDFText_CountChars', tp);
    if (n <= 0) return '';
    const buf = heap.wasmExports.malloc((n + 1) * 2);
    try {
      const written = call('FPDFText_GetText', tp, 0, n, buf);
      const u16 = new Uint16Array(heap.HEAPU8.buffer, buf, Math.max(0, written - 1));
      return String.fromCharCode(...u16);
    } finally {
      heap.wasmExports.free(buf);
    }
  } finally {
    call('FPDFText_ClosePage', tp);
    call('FPDF_ClosePage', page);
  }
}

// ---------- Tesseract ----------
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface Word {
  text: string;
  box: Box;
  conf: number;
}
interface Line {
  box: Box;
  /** Baseline end points in device pixels (y down). */
  baseline: { x0: number; y0: number; x1: number; y1: number } | null;
  words: Word[];
}
interface TessApi {
  Init(path: null, lang: string, oem: number): number;
  SetVariable(k: string, v: string): boolean;
  SetImageFile(exif: number, angle: number): number;
  SetSourceResolution(ppi: number): void;
  Recognize(monitor: null): number;
  GetUTF8Text(): string;
  GetTSVText(page: number): string;
  MeanTextConf(): number;
  GetIterator(): ResultIt;
  Version(): string;
  Clear(): void;
  End(): void;
}
interface ResultIt {
  Begin(): void;
  Next(level: number): boolean;
  IsAtBeginningOf(level: number): boolean;
  GetUTF8Text(level: number): string;
  Confidence(level: number): number;
  getBoundingBox(level: number): Box;
  getBaseline(level: number): {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    has_baseline: boolean;
  };
  delete?(): void;
  __destroy__?(): void;
}
interface TessModule {
  FS: { writeFile(p: string, d: Uint8Array | string): void; unlink(p: string): void };
  TessBaseAPI: new () => TessApi;
}
const RIL_TEXTLINE = 2;
const RIL_WORD = 3;

const t0 = performance.now();
const coreFactory = require('tesseract.js-core/tesseract-core-simd-lstm.js') as (
  o: Record<string, unknown>,
) => Promise<TessModule>;
let lastProgress = -1;
const tess = await coreFactory({
  TesseractProgress(p: number) {
    lastProgress = p;
  },
});
out.coreInitMs = ms(t0);
const t1 = performance.now();
const gz = readFileSync(
  require.resolve('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'),
);
const traineddata = gunzipSync(gz);
out.traineddata = { gzBytes: gz.length, bytes: traineddata.length, gunzipMs: ms(t1) };
tess.FS.writeFile('/eng.traineddata', traineddata);
const t2 = performance.now();
const api = new tess.TessBaseAPI();
if (api.Init(null, 'eng', 1) !== 0) throw new Error('Tesseract Init failed'); // 1 = OEM_LSTM_ONLY
api.SetVariable('tessedit_pageseg_mode', '3'); // PSM_AUTO
out.apiInitMs = ms(t2);
out.tesseractVersion = api.Version();
out.rssAfterInitMB = rss();

function pgm(img: GrayImage): Uint8Array {
  const header = Buffer.from(`P5\n${String(img.width)} ${String(img.height)}\n255\n`, 'latin1');
  const bytes = new Uint8Array(header.length + img.data.length);
  bytes.set(header, 0);
  bytes.set(img.data, header.length);
  return bytes;
}

function ocr(img: GrayImage, dpi: number): { lines: Line[]; recognizeMs: number; conf: number } {
  tess.FS.writeFile('/input', pgm(img));
  if (api.SetImageFile(1, 0) === 1) throw new Error('SetImageFile failed');
  api.SetSourceResolution(dpi);
  const t = performance.now();
  api.Recognize(null);
  const recognizeMs = ms(t);
  const it = api.GetIterator();
  it.Begin();
  const lines: Line[] = [];
  do {
    if (it.IsAtBeginningOf(RIL_TEXTLINE) || lines.length === 0) {
      const b = it.getBaseline(RIL_TEXTLINE);
      lines.push({
        box: it.getBoundingBox(RIL_TEXTLINE),
        baseline: b.has_baseline ? { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 } : null,
        words: [],
      });
    }
    const text = it.GetUTF8Text(RIL_WORD).trim();
    if (text) {
      at(lines, lines.length - 1).words.push({
        text,
        box: it.getBoundingBox(RIL_WORD),
        conf: it.Confidence(RIL_WORD),
      });
    }
  } while (it.Next(RIL_WORD));
  (it.delete ?? it.__destroy__)?.call(it);
  const conf = api.MeanTextConf();
  tess.FS.unlink('/input');
  return { lines, recognizeMs, conf };
}

const norm = (w: string) => w.replace(/[^\p{L}\p{N}]/gu, '');
function accuracy(lines: Line[]): {
  expected: number;
  found: number;
  recall: number;
  missed: string[];
} {
  const got = new Map<string, number>();
  for (const l of lines)
    for (const w of l.words) got.set(norm(w.text), (got.get(norm(w.text)) ?? 0) + 1);
  const missed: string[] = [];
  let found = 0;
  const expected = expectedWords();
  for (const w of expected) {
    const n = got.get(w) ?? 0;
    if (n > 0) {
      found++;
      got.set(w, n - 1);
    } else missed.push(w);
  }
  return {
    expected: expected.length,
    found,
    recall: Math.round((1000 * found) / expected.length) / 10,
    missed,
  };
}

// ---------- the text layer through PDFium ----------
const FPDF_TEXTRENDERMODE_INVISIBLE = 3;
/** Helvetica: ascender 0.905 em, descender 0.212 em (the standard-14 AFM values). */
const ASCENT = 0.905;

function deviceToPage(
  page: number,
  w: number,
  h: number,
  dx: number,
  dy: number,
): [number, number] {
  const buf = heap.wasmExports.malloc(16);
  try {
    call('FPDF_DeviceToPage', page, 0, 0, w, h, 0, Math.round(dx), Math.round(dy), buf, buf + 8);
    return [heap.getValue(buf, 'double'), heap.getValue(buf + 8, 'double')];
  } finally {
    heap.wasmExports.free(buf);
  }
}

interface LayerStats {
  words: number;
  skipped: number;
  objects: number;
  ms: number;
}

/** Writes `lines` (device pixels of a `w` × `h` render of the displayed page) as invisible text. */
function addTextLayer(doc: number, index: number, w: number, h: number, lines: Line[]): LayerStats {
  const t = performance.now();
  const page = call('FPDF_LoadPage', doc, index);
  const font = call('FPDFText_LoadStandardFont', doc, 'Helvetica');
  if (!font) throw new Error('standard font not loaded');
  const bounds = heap.wasmExports.malloc(16);
  let words = 0;
  let skipped = 0;
  try {
    for (const line of lines) {
      // Baseline (device): from Tesseract when it has one, else the line box bottom.
      const base = line.baseline ?? {
        x0: line.box.x0,
        y0: line.box.y1,
        x1: line.box.x1,
        y1: line.box.y1,
      };
      const slope = base.x1 !== base.x0 ? (base.y1 - base.y0) / (base.x1 - base.x0) : 0;
      const baselineAt = (x: number) => base.y0 + slope * (x - base.x0);
      // Font size from the ascent above the baseline (device px → points via the page mapping below).
      const ascentPx = Math.max(4, baselineAt(line.box.x0) - line.box.y0);
      for (const word of line.words) {
        const obj = call('FPDFPageObj_CreateTextObj', doc, font, 10);
        if (!obj) throw new Error('text object not created');
        const ok = withWideString(mod, word.text, (p) => call('FPDFText_SetText', obj, p));
        if (!ok) {
          call('FPDFPageObj_Destroy', obj);
          skipped++;
          continue;
        }
        call('FPDFTextObj_SetTextRenderMode', obj, FPDF_TEXTRENDERMODE_INVISIBLE);
        call('FPDFPageObj_GetBounds', obj, bounds, bounds + 4, bounds + 8, bounds + 12);
        const natural = heap.getValue(bounds + 8, 'float') - heap.getValue(bounds, 'float');
        if (!(natural > 0)) {
          call('FPDFPageObj_Destroy', obj);
          skipped++;
          continue;
        }
        // Word start and end on the baseline, in page space (unrotated user units).
        const [sx, sy] = deviceToPage(page, w, h, word.box.x0, baselineAt(word.box.x0));
        const [ex, ey] = deviceToPage(page, w, h, word.box.x1, baselineAt(word.box.x1));
        // A point one ascent above the start: gives the up vector and the font size in points.
        const [ux, uy] = deviceToPage(page, w, h, word.box.x0, baselineAt(word.box.x0) - ascentPx);
        const size = Math.hypot(ux - sx, uy - sy) / ASCENT;
        const len = Math.hypot(ex - sx, ey - sy);
        if (!(size > 0.5) || !(len > 0)) {
          call('FPDFPageObj_Destroy', obj);
          skipped++;
          continue;
        }
        // The object was made at 10 pt: scale to `size`, stretch to the word's width, run along the baseline.
        const k = size / 10;
        const dirX = (ex - sx) / len;
        const dirY = (ey - sy) / len;
        const stretch = len / (natural * k);
        const a = dirX * k * stretch;
        const b = dirY * k * stretch;
        const c = -dirY * k;
        const d = dirX * k;
        call('FPDFPageObj_Transform', obj, a, b, c, d, sx, sy);
        call('FPDFPage_InsertObject', page, obj);
        words++;
      }
    }
    if (!call('FPDFPage_GenerateContent', page)) throw new Error('GenerateContent failed');
  } finally {
    heap.wasmExports.free(bounds);
    call('FPDF_ClosePage', page);
  }
  return {
    words,
    skipped,
    objects: call('FPDFPage_CountObjects', call('FPDF_LoadPage', doc, index)),
    ms: ms(t),
  };
}

/** Each OCR word's box (page space) against the union of its characters' boxes in the saved file. */
function checkBoxes(doc: number, index: number, w: number, h: number, lines: Line[]) {
  const page = call('FPDF_LoadPage', doc, index);
  const tp = call('FPDFText_LoadPage', page);
  const buf = heap.wasmExports.malloc(32);
  const n = call('FPDFText_CountChars', tp);
  const text = pageText(doc, index);
  let checked = 0;
  let good = 0;
  let coverageSum = 0;
  const bad: { word: string; coverage: number }[] = [];
  const charBox = (i: number) => {
    call('FPDFText_GetCharBox', tp, i, buf, buf + 8, buf + 16, buf + 24);
    return [
      heap.getValue(buf, 'double'),
      heap.getValue(buf + 8, 'double'),
      heap.getValue(buf + 16, 'double'),
      heap.getValue(buf + 24, 'double'),
    ];
  };
  try {
    for (const line of lines)
      for (const word of line.words) {
        // The OCR box in page space (both corners, so a rotated page is handled).
        const [ax, ay] = deviceToPage(page, w, h, word.box.x0, word.box.y0);
        const [bx, by] = deviceToPage(page, w, h, word.box.x1, word.box.y1);
        const ox0 = Math.min(ax, bx),
          ox1 = Math.max(ax, bx),
          oy0 = Math.min(ay, by),
          oy1 = Math.max(ay, by);
        // Every occurrence of the word in the extracted text (its order is PDFium's); the best one counts.
        let best = -1;
        for (let at = text.indexOf(word.text); at >= 0; at = text.indexOf(word.text, at + 1)) {
          let l = Infinity,
            r = -Infinity,
            bo = Infinity,
            to = -Infinity;
          for (let i = at; i < at + word.text.length && i < n; i++) {
            const [cl, cr, cb, ct] = charBox(i) as [number, number, number, number];
            l = Math.min(l, cl);
            r = Math.max(r, cr);
            bo = Math.min(bo, cb);
            to = Math.max(to, ct);
          }
          const ix = Math.max(0, Math.min(r, ox1) - Math.max(l, ox0));
          const iy = Math.max(0, Math.min(to, oy1) - Math.max(bo, oy0));
          best = Math.max(best, (ix * iy) / Math.max(1e-6, (ox1 - ox0) * (oy1 - oy0)));
        }
        if (best < 0) continue;
        checked++;
        coverageSum += best;
        if (best >= 0.5) good++;
        else bad.push({ word: word.text, coverage: Math.round(best * 100) / 100 });
      }
  } finally {
    heap.wasmExports.free(buf);
    call('FPDFText_ClosePage', tp);
    call('FPDF_ClosePage', page);
  }
  return {
    checked,
    good,
    meanCoverage: Math.round((100 * coverageSum) / Math.max(1, checked)) / 100,
    bad: bad.slice(0, 10),
  };
}

function qpdfCheck(bytes: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), 's17-'));
  writeFileSync(join(dir, 'f.pdf'), bytes);
  const r = spawnSync('qpdf', ['--check', join(dir, 'f.pdf')]);
  return r.status === 0
    ? 'ok'
    : `exit ${String(r.status)}: ${r.stderr.toString().split('\n')[0] ?? ''}`;
}

// ---------- run ----------
const DPI = Number(process.env.S17_DPI ?? 300);
const src = openDoc(sourcePdf());
const img1 = renderGray(src, 0, DPI);
const img2 = renderGray(src, 1, DPI);
call('FPDF_CloseDocument', src);
writeFileSync(join(here, 'page1.pgm'), pgm(img1));
const scanned = scannedPdf(img1, img2, DPI);
writeFileSync(join(here, 'scanned.pdf'), scanned);
out.scanned = { bytes: scanned.length, dpi: DPI, page1: { w: img1.width, h: img1.height } };

const doc = openDoc(scanned);
const pageCount = call('FPDF_GetPageCount', doc);
const before = Array.from({ length: pageCount }, (_, i) => pageText(doc, i).length);
out.textBefore = before; // [0, 0, 0, >0]
const pixelsBefore = Array.from({ length: pageCount }, (_, i) => renderBgra(doc, i, 100));

const pages: Record<string, unknown>[] = [];
const ocrLines: (Line[] | null)[] = [];
const sizes: { w: number; h: number }[] = [];
for (let i = 0; i < pageCount; i++) {
  if (at(before, i) > 0) {
    ocrLines.push(null);
    sizes.push({ w: 0, h: 0 });
    pages.push({ page: i + 1, skipped: 'has text' });
    continue;
  }
  const tr = performance.now();
  const img = renderGray(doc, i, DPI);
  const renderMs = ms(tr);
  const r = ocr(img, DPI);
  ocrLines.push(r.lines);
  sizes.push({ w: img.width, h: img.height });
  const acc = accuracy(r.lines);
  const layer = addTextLayer(doc, i, img.width, img.height, r.lines);
  pages.push({
    page: i + 1,
    renderMs,
    recognizeMs: r.recognizeMs,
    meanConf: r.conf,
    lines: r.lines.length,
    words: r.lines.reduce((n, l) => n + l.words.length, 0),
    accuracy: acc,
    layer,
    lastProgress,
    rssMB: rss(),
  });
}
out.pages = pages;

// Save (PDFium's incremental output: original + tail; the product uses the narrow tail).
const ts = performance.now();
const saved = saveWithFlags(mod, doc, FPDF_INCREMENTAL);
out.save = { ms: ms(ts), bytes: saved.length, tailBytes: saved.length - scanned.length };
call('FPDF_CloseDocument', doc);
writeFileSync(join(here, 'scanned-ocr.pdf'), saved);
out.originalPrefixIntact = Buffer.compare(saved.subarray(0, scanned.length), scanned) === 0;
out.qpdf = qpdfCheck(saved);

async function verify(label: string, bytes: Uint8Array): Promise<void> {
  const re = openDoc(bytes);
  const after: Record<string, unknown>[] = [];
  for (let i = 0; i < pageCount; i++) {
    const text = pageText(re, i);
    const pixelsSame = Buffer.compare(renderBgra(re, i, 100), at(pixelsBefore, i)) === 0;
    const lines = ocrLines[i];
    const boxes = lines ? checkBoxes(re, i, at(sizes, i).w, at(sizes, i).h, lines) : null;
    const savedWords = text.split(/\s+/).map(norm).filter(Boolean);
    const exp = expectedWords();
    const pool = new Map<string, number>();
    for (const w of savedWords) pool.set(w, (pool.get(w) ?? 0) + 1);
    let hit = 0;
    for (const w of exp) {
      const c = pool.get(w) ?? 0;
      if (c > 0) {
        hit++;
        pool.set(w, c - 1);
      }
    }
    after.push({
      page: i + 1,
      chars: text.length,
      pixelsSame,
      savedRecall: lines ? Math.round((1000 * hit) / exp.length) / 10 : null,
      boxes,
    });
  }
  call('FPDF_CloseDocument', re);
  const reader = await PdfReader.open(bytes, inflateStream);
  const pgs = await reader.pages();
  const contents: Record<string, unknown>[] = [];
  const origReader = await PdfReader.open(scanned, inflateStream);
  const origPages = await origReader.pages();
  for (const [i, p] of pgs.entries()) {
    const c = p.dict.get('Contents');
    const arr = c instanceof PdfRef ? [c] : Array.isArray(c) ? c : [];
    const oc = at(origPages, i).dict.get('Contents');
    const onums = new Set(
      (oc instanceof PdfRef ? [oc] : Array.isArray(oc) ? oc : []).map((r) =>
        r instanceof PdfRef ? r.num : -1,
      ),
    );
    const streams: Record<string, unknown>[] = [];
    let originalsKept = 0;
    for (const ref of arr) {
      if (!(ref instanceof PdfRef)) continue;
      const s = await reader.get(ref);
      if (!(s instanceof PdfStream)) continue;
      const data = await reader.decode(s);
      let sameAsOriginal: boolean | null = null;
      if (onums.has(ref.num)) {
        const os = await origReader.get(ref.num);
        if (os instanceof PdfStream)
          sameAsOriginal = Buffer.compare(await origReader.decode(os), data) === 0;
        if (sameAsOriginal) originalsKept++;
      }
      const txt = Buffer.from(data).toString('latin1');
      streams.push({
        num: ref.num,
        bytes: data.length,
        sameAsOriginal,
        invisibleTr: /\b3 Tr\b/.test(txt),
      });
    }
    const res = await reader.resolve(p.dict.get('Resources'));
    const fonts = isDict(res) ? await reader.resolve(res.get('Font')) : undefined;
    contents.push({
      page: i + 1,
      num: p.num,
      streams,
      originalsKept: `${String(originalsKept)}/${String(onums.size)}`,
      fonts: isDict(fonts) ? [...fonts.keys()].length : 0,
    });
  }
  out[label] = {
    bytes: bytes.length,
    tailBytes: bytes.length - scanned.length,
    prefixIntact: Buffer.compare(bytes.subarray(0, scanned.length), scanned) === 0,
    qpdf: qpdfCheck(bytes),
    after,
    contents,
  };
}

await verify('variantA_pdfiumGenerateContent', saved);

// ---------- variant B: our own object layer ----------
{
  // Helvetica advance widths per WinAnsi byte through PDFium (20 copies minus 10 copies of a glyph).
  const d3 = openDoc(scanned);
  const font = call('FPDFText_LoadStandardFont', d3, 'Helvetica');
  const bounds = heap.wasmExports.malloc(16);
  const widthOf = (text: string): number => {
    const obj = call('FPDFPageObj_CreateTextObj', d3, font, 10);
    withWideString(mod, text, (p) => call('FPDFText_SetText', obj, p));
    call('FPDFPageObj_GetBounds', obj, bounds, bounds + 4, bounds + 8, bounds + 12);
    const w = heap.getValue(bounds + 8, 'float') - heap.getValue(bounds, 'float');
    call('FPDFPageObj_Destroy', obj);
    return w;
  };
  const widths: number[] = new Array<number>(256).fill(0);
  for (let b = 32; b < 256; b++) {
    if (b >= 0x7f && b < 0xa0) continue;
    const ch = String.fromCharCode(b); // Latin-1 code points; the 0x80–0x9F block is skipped above
    const w20 = widthOf(ch.repeat(20));
    const w10 = widthOf(ch.repeat(10));
    widths[b] = Math.round(((w20 - w10) / 10 / 10) * 1000);
  }
  heap.wasmExports.free(bounds);
  call('FPDF_CloseDocument', d3);
  writeFileSync(join(here, 'helvetica-widths.json'), JSON.stringify(widths));
  out.widthsProbe = {
    space: widths[32],
    A: widths[65],
    a: widths[97],
    W: widths[87],
    i: widths[105],
    deg: widths[0xb0],
  };

  const docB = openDoc(scanned);
  const pagesOcr: PageOcr[] = [];
  for (let i = 0; i < pageCount; i++) {
    const lines = ocrLines[i];
    if (lines)
      pagesOcr.push({ pageIndex: i, width: at(sizes, i).w, height: at(sizes, i).h, lines });
  }
  const loaded = new Map<number, number>();
  const pageOf = (i: number) => {
    let p = loaded.get(i);
    if (p === undefined) loaded.set(i, (p = call('FPDF_LoadPage', docB, i)));
    return p;
  };
  const tb = performance.now();
  const reader = await PdfReader.open(scanned, inflateStream);
  const layer = await buildTextLayer(reader, pagesOcr, {
    toPage: (i, dx, dy) => deviceToPage(pageOf(i), at(sizes, i).w, at(sizes, i).h, dx, dy),
    width: (b) => widths[b] ?? 0,
  });
  const buildMs = ms(tb);
  for (const p of loaded.values()) call('FPDF_ClosePage', p);
  call('FPDF_CloseDocument', docB);
  // Appended exactly as the Render worker's reopen does (tracker.applyObjects → narrowTail onlyExtra).
  const tail = narrowTail(saveBaseOf(scanned), scanned, scanned.length, [], {
    extra: layer.objects,
    onlyExtra: true,
  }).tail;
  const savedB = concatBytes([scanned, tail]);
  writeFileSync(join(here, 'scanned-ocr-b.pdf'), savedB);
  out.variantB_build = {
    buildMs,
    objects: layer.objects.length,
    words: layer.words,
    skipped: layer.skipped,
    firstNew: layer.firstNew,
  };
  await verify('variantB_objectLayer', savedB);
}

// Unmappable characters in the standard font: what FPDFText_SetText keeps.
{
  const d2 = openDoc(scanned);
  const font = call('FPDFText_LoadStandardFont', d2, 'Helvetica');
  const probe: Record<string, unknown> = {};
  const bounds = heap.wasmExports.malloc(16);
  for (const s of ['ASME', '±0.05', '80°C', '≤ 5', 'Ω µm', '中文']) {
    const obj = call('FPDFPageObj_CreateTextObj', d2, font, 10);
    const ok = withWideString(mod, s, (p) => call('FPDFText_SetText', obj, p));
    call('FPDFPageObj_GetBounds', obj, bounds, bounds + 4, bounds + 8, bounds + 12);
    const width = heap.getValue(bounds + 8, 'float') - heap.getValue(bounds, 'float');
    // What the text object reports back.
    const n = call('FPDFTextObj_GetText', obj, 0, 0, 0);
    const buf = heap.wasmExports.malloc(n * 2 + 2);
    call('FPDFTextObj_GetText', obj, 0, buf, n * 2 + 2);
    const back = String.fromCharCode(
      ...new Uint16Array(heap.HEAPU8.buffer, buf, Math.max(0, n / 2 - 1)),
    );
    heap.wasmExports.free(buf);
    probe[s] = { setText: Boolean(ok), width: Math.round(width * 100) / 100, back };
    call('FPDFPageObj_Destroy', obj);
  }
  heap.wasmExports.free(bounds);
  call('FPDF_CloseDocument', d2);
  out.charProbe = probe;
}

// Repeated recognitions: memory growth of the Tesseract module.
{
  const t = performance.now();
  const runs: number[] = [];
  for (let k = 0; k < 3; k++) {
    const r = ocr(img1, DPI);
    runs.push(r.recognizeMs);
  }
  out.repeat = { recognizeMs: runs, totalMs: ms(t), rssMB: rss() };
}
api.End();
out.rssEndMB = rss();

writeFileSync(join(here, 's17-node.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
