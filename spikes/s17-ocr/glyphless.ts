// S17 follow-up (ADR-020 amendments): (1) the Tesseract core with five languages
// loaded at once (eng+chi_sim+hin+spa+fra): init time and memory; (2) a text
// layer in Tesseract's own "GlyphLessFont" style — a 572-byte TrueType font
// embedded once, Identity-H with 2-byte codes = UTF-16 code units, a
// ToUnicode CMap — so Devanagari and Chinese words can be written; PDFium's
// text extraction and character boxes on the result, qpdf check.
//   node --import ./spikes/shared/ts-ext.ts spikes/s17-ocr/glyphless.ts
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, deflateSync } from 'node:zlib';
import { init } from '@embedpdf/pdfium';
import { rawCall } from '../../src/workers/render/pdfium.ts';
import { buildPdf, type PdfObject } from '../../e2e/fixtures/generate.ts';

const require = createRequire(import.meta.url);
const out: Record<string, unknown> = {};
const rss = () => Math.round(process.memoryUsage().rss / 1048576);

// ---- (1) five languages ----
{
  const core = require('tesseract.js-core/tesseract-core-simd-lstm.js') as (o: object) => Promise<{
    FS: { writeFile(p: string, d: Uint8Array): void };
    TessBaseAPI: new () => { Init(p: null, l: string, o: number): number; End(): void };
  }>;
  const tess = await core({});
  const t0 = performance.now();
  const langs = ['eng', 'chi_sim', 'hin', 'spa', 'fra'];
  let bytes = 0;
  for (const l of langs) {
    const gz = readFileSync(
      require.resolve(`@tesseract.js-data/${l}/4.0.0_best_int/${l}.traineddata.gz`),
    );
    const data = gunzipSync(gz);
    bytes += data.length;
    tess.FS.writeFile(`/${l}.traineddata`, data);
  }
  const t1 = performance.now();
  const api = new tess.TessBaseAPI();
  const ok = api.Init(null, langs.join('+'), 1);
  out.fiveLanguages = {
    initOk: ok === 0,
    inflatedMB: Math.round(bytes / 1e5) / 10,
    loadMs: Math.round(t1 - t0),
    initMs: Math.round(performance.now() - t1),
    rssMB: rss(),
  };
  api.End();
}

// ---- (2) the glyphless font layer ----
const mod = await init({
  wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')),
});
(mod as unknown as { PDFiumExt_Init(): void }).PDFiumExt_Init();
const heap = mod.pdfium as unknown as {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  HEAPU8: Uint8Array;
  getValue(ptr: number, t: 'double'): number;
};
const call = (name: string, ...a: (number | string)[]) => rawCall(mod, name, ...a);
const ttf = readFileSync(join(import.meta.dirname, 'out', 'pdf.ttf'));
const latin1 = (b: Uint8Array) => Buffer.from(b).toString('latin1');
const hex16 = (s: string) => {
  let h = '';
  for (let i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(4, '0');
  return `<${h}>`;
};
// CIDToGIDMap: every CID → glyph 1 (as Tesseract does), 64K entries, Flate.
const cid2gid = Buffer.alloc(131072);
for (let i = 0; i < 65536; i++) cid2gid[i * 2 + 1] = 1;
const words: [string, number, number][] = [
  ['Pump', 60, 700],
  ['P-101', 120, 700],
  ['पंप', 60, 640],
  ['डेटाशीट', 120, 640],
  ['泵', 60, 580],
  ['数据表', 100, 580],
  ['tolérance', 60, 520],
];
// Each word at 12 pt, stretched so its box is 40 pt wide: Tm = [40/(n*1) ... ] with DW 1000 → natural = n em.
const ops = words.map(
  ([w, x, y]) =>
    `${(40 / (w.length * 12)).toFixed(4)} 0 0 1 ${String(x)} ${String(y)} Tm ${hex16(w)} Tj`,
);
const content = `BT\n3 Tr\n/PDFToolsOCR 12 Tf\n${ops.join('\n')}\nET`;
const toUnicode =
  '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n1 beginbfrange\n<0000> <FFFF> <0000>\nendbfrange\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
const objs: PdfObject[] = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /PDFToolsOCR 5 0 R >> >> /Contents 4 0 R >>',
  { dict: '<< >>', stream: content },
  '<< /Type /Font /Subtype /Type0 /BaseFont /GlyphLessFont /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 9 0 R >>',
  '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /GlyphLessFont /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 7 0 R /DW 1000 /CIDToGIDMap 8 0 R >>',
  '<< /Type /FontDescriptor /FontName /GlyphLessFont /Flags 5 /FontBBox [0 -200 1000 800] /Ascent 800 /Descent -200 /CapHeight 800 /ItalicAngle 0 /StemV 80 /FontFile2 10 0 R >>',
  { dict: '<< /Filter /FlateDecode >>', stream: latin1(deflateSync(cid2gid)) },
  { dict: '<< >>', stream: toUnicode },
  { dict: `<< /Length1 ${String(ttf.length)} >>`, stream: latin1(ttf) },
];
const pdf = buildPdf(objs);
writeFileSync(join(import.meta.dirname, 'out', 'glyphless.pdf'), pdf);
const p = heap.wasmExports.malloc(pdf.length);
heap.HEAPU8.set(pdf, p);
const doc = call('FPDF_LoadMemDocument', p, pdf.length, '');
const page = call('FPDF_LoadPage', doc, 0);
const tp = call('FPDFText_LoadPage', page);
const n = call('FPDFText_CountChars', tp);
const buf = heap.wasmExports.malloc((n + 1) * 2);
const written = call('FPDFText_GetText', tp, 0, n, buf);
const text = String.fromCharCode(
  ...new Uint16Array(heap.HEAPU8.buffer, buf, Math.max(0, written - 1)),
);
const b = heap.wasmExports.malloc(32);
const boxes: Record<string, number[]> = {};
for (const [w] of words) {
  const at = text.indexOf(w);
  if (at < 0) continue;
  let l = Infinity,
    r = -Infinity,
    bo = Infinity,
    t = -Infinity;
  for (let i = at; i < at + w.length; i++) {
    call('FPDFText_GetCharBox', tp, i, b, b + 8, b + 16, b + 24);
    l = Math.min(l, heap.getValue(b, 'double'));
    r = Math.max(r, heap.getValue(b + 8, 'double'));
    bo = Math.min(bo, heap.getValue(b + 16, 'double'));
    t = Math.max(t, heap.getValue(b + 24, 'double'));
  }
  boxes[w] = [l, bo, r, t].map((v) => Math.round(v * 10) / 10);
}
out.glyphless = { chars: n, text, found: words.map(([w]) => text.includes(w)), boxes };
const bmp = call('FPDFBitmap_CreateEx', 200, 300, 4, 0, 0);
call('FPDFBitmap_FillRect', bmp, 0, 0, 200, 300, 0xffffffff);
call('FPDF_RenderPageBitmap', bmp, page, 0, 0, 200, 300, 0, 0);
const px = heap.HEAPU8.subarray(
  call('FPDFBitmap_GetBuffer', bmp),
  call('FPDFBitmap_GetBuffer', bmp) + 200 * 300 * 4,
);
out.inkPixels = px.filter((v, i) => i % 4 === 0 && v < 250).length; // must be 0: invisible
const dir = mkdtempSync(join(tmpdir(), 's17g-'));
writeFileSync(join(dir, 'g.pdf'), pdf);
const q = spawnSync('qpdf', ['--check', join(dir, 'g.pdf')]);
out.qpdf = q.status === 0 ? 'ok' : q.stderr.toString().split('\n').slice(0, 3).join(' | ');
console.log(JSON.stringify(out, null, 2));
writeFileSync(join(import.meta.dirname, 'out', 's17-glyphless.json'), JSON.stringify(out, null, 2));
