// Self-made "scanned" PDFs for OCR (M5, ADR-020; CLAUDE.md rule 13), promoted
// from spikes/s17-ocr/fixtures.ts: a fictional pump datasheet page in
// Helvetica, rendered with PDFium (the same WASM the workers load) and wrapped
// as image-only pages. Values are fictional; no standard or company document
// is reproduced. Generated at test time, never committed.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { buildPdf, type PdfObject } from './generate.ts';

export const TITLE = 'Pump P-101 Datasheet (fictional)';

/** Body lines at 11 pt; punctuation and a few WinAnsi symbols are included on purpose. */
export const LINES = [
  'Service: cooling water transfer from tank T-201 to header H-7.',
  'Design pressure 16 bar g at 80 °C; test pressure 24 bar g.',
  'Rated flow 125 m3/h, differential head 42 m, NPSH available 6.5 m.',
  'Casing material ASTM A216 WCB; impeller 316 stainless steel.',
  'Shaft seal: single mechanical seal, plan 11, tolerance ±0.05 mm.',
  'Motor 22 kW, 2950 rpm, IE3, 400 V 50 Hz, IP55 enclosure.',
  'Nozzles: suction DN150 PN16, discharge DN100 PN16, drain 1/2 in.',
  'Notes: spare impeller supplied; coupling guard per EN 953.',
];

/** A word that occurs once per datasheet page and nowhere else. */
export const SCANNED_NEEDLE = 'Datasheet';
/** The text of the fixture's fourth page (a real text layer). */
export const TEXT_PAGE_LINE = 'This page already has a text layer.';

/** The words a perfect OCR of the datasheet page contains (letters and digits only). */
export function expectedWords(): string[] {
  return [TITLE, ...LINES]
    .join(' ')
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => w.length > 0);
}

const esc = (s: string): string =>
  s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[\u0100-\uffff]/g, '?');

function pageContent(fontSize: number): string {
  const out = [`BT /F1 20 Tf 60 770 Td (${esc(TITLE)}) Tj ET`];
  let y = 730;
  for (const line of LINES) {
    out.push(`BT /F1 ${String(fontSize)} Tf 60 ${String(y)} Td (${esc(line)}) Tj ET`);
    y -= fontSize * 1.7;
  }
  return out.join('\n');
}

/** The text source: page 1 at 11 pt, page 2 at 8 pt (small print). */
export function sourcePdf(): Uint8Array {
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
    { dict: '<< >>', stream: pageContent(11) },
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
    { dict: '<< >>', stream: pageContent(8) },
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ]);
}

export interface GrayImage {
  width: number;
  height: number;
  /** One byte per pixel, rows top-down. */
  data: Uint8Array;
}

const VECTOR = '0 0 1 RG 4 w 40 40 m 555 40 l S 0.5 g 500 790 50 30 re f';

/**
 * The "scanned" document:
 *   page 1: image only (the 11 pt page at `dpi`);
 *   page 2: image plus an existing vector content stream (the stream must survive untouched);
 *   page 3: the 8 pt page as an image on a page with /Rotate 90 (a sideways scan);
 *   page 4: a real text page (OCR must skip it: it has a text layer).
 */
export function scannedPdf(page1: GrayImage, page2: GrayImage, dpi: number): Uint8Array {
  const image = (img: GrayImage): PdfObject => ({
    dict: `<< /Type /XObject /Subtype /Image /Width ${String(img.width)} /Height ${String(img.height)} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode >>`,
    stream: deflateSync(img.data).toString('latin1'),
  });
  const w = (img: GrayImage) => ((img.width * 72) / dpi).toFixed(2);
  const h = (img: GrayImage) => ((img.height * 72) / dpi).toFixed(2);
  const draw = (img: GrayImage, name: string) => `q ${w(img)} 0 0 ${h(img)} 0 0 cm /${name} Do Q`;
  const media = (img: GrayImage) => `/MediaBox [0 0 ${w(img)} ${h(img)}]`;
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R 8 0 R 10 0 R] /Count 4 >>',
    `<< /Type /Page /Parent 2 0 R ${media(page1)} /Resources << /XObject << /Im1 12 0 R >> >> /Contents 4 0 R >>`,
    { dict: '<< >>', stream: draw(page1, 'Im1') },
    `<< /Type /Page /Parent 2 0 R ${media(page1)} /Resources << /XObject << /Im1 12 0 R >> >> /Contents [6 0 R 7 0 R] >>`,
    { dict: '<< >>', stream: draw(page1, 'Im1') },
    { dict: '<< >>', stream: VECTOR },
    `<< /Type /Page /Parent 2 0 R ${media(page2)} /Rotate 90 /Resources << /XObject << /Im2 13 0 R >> >> /Contents 9 0 R >>`,
    { dict: '<< >>', stream: draw(page2, 'Im2') },
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 14 0 R >> >> /Contents 11 0 R >>',
    { dict: '<< >>', stream: `BT /F1 14 Tf 60 770 Td (${esc(TEXT_PAGE_LINE)}) Tj ET` },
    image(page1),
    image(page2),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ]);
}

// ---- rendering with PDFium in Node (test time only) ----------------------------------

let pdfium: Promise<WrappedPdfiumModule> | undefined;

/** The PDFium module the workers load, initialized once per process. */
export function nodePdfium(): Promise<WrappedPdfiumModule> {
  pdfium ??= (async () => {
    const require = createRequire(import.meta.url);
    const mod = await init({
      wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')),
    });
    (mod as unknown as { PDFiumExt_Init(): void }).PDFiumExt_Init();
    return mod;
  })();
  return pdfium;
}

type Raw = Record<string, (...a: (number | string)[]) => number>;

/** Renders page `index` of `bytes` as displayed, 8-bit gray at `dpi`. */
export async function renderGray(
  bytes: Uint8Array,
  index: number,
  dpi: number,
): Promise<GrayImage> {
  const mod = await nodePdfium();
  const raw = mod as unknown as Raw;
  const heap = mod.pdfium as unknown as {
    wasmExports: { malloc(n: number): number; free(p: number): void };
    HEAPU8: Uint8Array;
  };
  const call = (name: string, ...a: (number | string)[]): number => {
    const fn = raw[name];
    if (!fn) throw new Error(`PDFium export ${name} is missing`);
    return fn(...a);
  };
  const p = heap.wasmExports.malloc(bytes.length);
  heap.HEAPU8.set(bytes, p);
  const doc = call('FPDF_LoadMemDocument', p, bytes.length, '');
  if (!doc) throw new Error('fixture did not open');
  const page = call('FPDF_LoadPage', doc, index);
  const width = Math.round((call('FPDF_GetPageWidthF', page) * dpi) / 72);
  const height = Math.round((call('FPDF_GetPageHeightF', page) * dpi) / 72);
  const bmp = call('FPDFBitmap_CreateEx', width, height, 1, 0, 0);
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
    call('FPDF_CloseDocument', doc);
    heap.wasmExports.free(p);
  }
}

/** `n` image-only pages of the 11 pt datasheet (one image object shared): the perf stand-in. */
export function scannedPagesPdf(page1: GrayImage, n: number, dpi: number): Uint8Array {
  const w = ((page1.width * 72) / dpi).toFixed(2);
  const h = ((page1.height * 72) / dpi).toFixed(2);
  const imageNum = 3 + n * 2;
  const objs: PdfObject[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: n }, (_, i) => `${String(3 + i * 2)} 0 R`).join(' ')}] /Count ${String(n)} >>`,
  ];
  for (let i = 0; i < n; i++) {
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im1 ${String(imageNum)} 0 R >> >> /Contents ${String(4 + i * 2)} 0 R >>`,
      { dict: '<< >>', stream: `q ${w} 0 0 ${h} 0 0 cm /Im1 Do Q` },
    );
  }
  objs.push({
    dict: `<< /Type /XObject /Subtype /Image /Width ${String(page1.width)} /Height ${String(page1.height)} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode >>`,
    stream: deflateSync(page1.data).toString('latin1'),
  });
  return buildPdf(objs);
}

/** `n` scanned pages at `dpi` (perf scenarios). */
export async function scannedPagesFixture(n: number, dpi = 300): Promise<Uint8Array> {
  return scannedPagesPdf(await renderGray(sourcePdf(), 0, dpi), n, dpi);
}

/** The four-page scanned fixture at `dpi` (300 by default: ~150 KB). */
export async function scannedFixture(dpi = 300): Promise<Uint8Array> {
  const src = sourcePdf();
  const page1 = await renderGray(src, 0, dpi);
  const page2 = await renderGray(src, 1, dpi);
  return scannedPdf(page1, page2, dpi);
}
