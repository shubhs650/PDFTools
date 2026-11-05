// Spike S25 (M7 follow-up to M7-05): a text comment (FreeText) with a text
// colour and a border colour of its own, drawn right by PDFium and stored so
// Acrobat and PDF-XChange read both. Route under test:
//  1. EmbedPDF writes the comment (border colour in /DA, text colour in its
//     private /TextColor); PDFium's appearance draws text AND border in /DA's.
//  2. Ours: PDFium's appearance content (FPDFAnnot_GetAP) with the colour
//     operator after `BT` replaced by the text colour, set back through a
//     one-page PDF and EPDFAnnot_SetAppearanceFromPage (which keeps the
//     page's /Resources); /DA keeps the border colour (Acrobat's convention)
//     and /DS `color:` gets the text colour. Result recorded in ADR-024.
// Re-run after an EmbedPDF upgrade: the "before" checks fail once PDFium
// draws the text in /TextColor itself, and the workaround can go.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import {
  PdfAnnotationSubtype,
  PdfStandardFont,
  PdfTextAlignment,
  PdfVerticalAlignment,
  type PdfDocumentObject,
} from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, expect, it } from 'vitest';
import { simplePdf } from '../../e2e/fixtures/generate';
import { readAnnotString } from '../../src/workers/render/annotTiles';
import { docPtrOf, rawCall, withWideString } from '../../src/workers/render/pdfium';

const require = createRequire(import.meta.url);
let mod: WrappedPdfiumModule;
let native: PdfiumNative;
let seq = 0;

interface Heap {
  HEAPU8: Uint8Array;
  HEAPU32: Uint32Array;
  HEAPF32: Float32Array;
  wasmExports: { malloc(n: number): number; free(p: number): void };
}
const heap = () => mod.pdfium as unknown as Heap;

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
});

async function open(bytes: Uint8Array): Promise<PdfDocumentObject> {
  return native
    .openDocumentBuffer({ id: `s${String(++seq)}`, content: bytes.slice().buffer }, {})
    .toPromise();
}

function pixel(docId: string, x: number, y: number, scale = 2): [number, number, number] {
  const doc = docPtrOf(native, docId);
  const page = rawCall(mod, 'FPDF_LoadPage', doc, 0);
  const w = 595 * scale;
  const h = 842 * scale;
  const bmp = rawCall(mod, 'FPDFBitmap_Create', w, h, 0);
  rawCall(mod, 'FPDFBitmap_FillRect', bmp, 0, 0, w, h, 0xffffffff);
  // FPDF_ANNOT = 1
  rawCall(mod, 'FPDF_RenderPageBitmap', bmp, page, 0, 0, w, h, 0, 1);
  const buf = rawCall(mod, 'FPDFBitmap_GetBuffer', bmp);
  const stride = rawCall(mod, 'FPDFBitmap_GetStride', bmp);
  const at = buf + Math.round(y * scale) * stride + Math.round(x * scale) * 4;
  const H = heap().HEAPU8;
  const out: [number, number, number] = [H[at + 2] ?? 0, H[at + 1] ?? 0, H[at] ?? 0];
  rawCall(mod, 'FPDFBitmap_Destroy', bmp);
  rawCall(mod, 'FPDF_ClosePage', page);
  return out;
}

/** Colours present in a horizontal run of pixels (page points, top-left origin). */
function colorsAlong(docId: string, y: number, x0: number, x1: number): Set<string> {
  const s = new Set<string>();
  for (let x = x0; x <= x1; x += 0.5) {
    const [r, g, b] = pixel(docId, x, y);
    s.add(`${String(r)},${String(g)},${String(b)}`);
  }
  return s;
}

function getAP(annot: number): string {
  const n = rawCall(mod, 'FPDFAnnot_GetAP', annot, 0, 0, 0);
  if (n <= 2) return '';
  const p = heap().wasmExports.malloc(n);
  try {
    rawCall(mod, 'FPDFAnnot_GetAP', annot, 0, p, n);
    return (mod.pdfium as unknown as { UTF16ToString(p: number): string }).UTF16ToString(p);
  } finally {
    heap().wasmExports.free(p);
  }
}

function withAnnot<T>(docId: string, fn: (annot: number, page: number) => T): T {
  const doc = docPtrOf(native, docId);
  const page = rawCall(mod, 'FPDF_LoadPage', doc, 0);
  const annot = rawCall(mod, 'FPDFPage_GetAnnot', page, 0);
  try {
    return fn(annot, page);
  } finally {
    rawCall(mod, 'FPDFPage_CloseAnnot', annot);
    rawCall(mod, 'FPDF_ClosePage', page);
  }
}

/** A one-page PDF: the content, one standard font and the /GS state PDFium's appearance uses. */
function onePagePdf(
  w: number,
  h: number,
  content: string,
  fontName: string,
  baseFont: string,
): Uint8Array {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(w)} ${String(h)}] /Resources << /Font << /${fontName} 4 0 R >> /ExtGState << /GS << /Type /ExtGState /CA 1 /ca 1 /BM /Normal /AIS false >> >> >> /Contents 5 0 R >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /${baseFont} /Encoding /WinAnsiEncoding >>`,
    `<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream`,
  ];
  let out = '%PDF-1.7\n';
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${String(i + 1)} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${String(objs.length + 1)}\n0000000000 65535 f \n`;
  for (const o of offs) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${String(objs.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}

const RED = '#ff0000';
const BLUE = '#0000ff';

/** Ink colours in a run of pixels: which are reddish and which are bluish (anti-aliasing aside). */
function inks(colours: Set<string>): { red: boolean; blue: boolean } {
  let red = false;
  let blue = false;
  for (const c of colours) {
    const [r = 0, g = 0, b = 0] = c.split(',').map(Number);
    if (r > 150 && g < 100 && b < 100) red = true;
    if (b > 150 && r < 100 && g < 100) blue = true;
  }
  return { red, blue };
}

it('S25: separate text and border colours', async () => {
  const doc = await open(simplePdf(1));
  const page = doc.pages[0];
  if (!page) throw new Error('no page');
  const id = 'ft-1';
  await native
    .createPageAnnotation(doc, page, {
      type: PdfAnnotationSubtype.FREETEXT,
      id,
      pageIndex: 0,
      rect: { origin: { x: 100, y: 100 }, size: { width: 200, height: 60 } },
      contents: process.env.S25_TEXT ?? 'Hello world',
      fontFamily: PdfStandardFont.Courier_Bold,
      fontSize: 18,
      fontColor: BLUE,
      strokeColor: RED,
      strokeWidth: 2,
      color: 'transparent',
      textAlign: PdfTextAlignment.Center,
      verticalAlign: PdfVerticalAlignment.Top,
      opacity: 1,
    } as never)
    .toPromise();

  // 1. As EmbedPDF leaves it.
  const before = withAnnot(doc.id, (a) => ({
    ap: getAP(a),
    da: readAnnotString(mod, a, 'DA'),
  }));
  const borderY = 101; // the top border line
  const textY = 112; // through the first line of text
  expect(before.da).toMatch(/1 0 0 rg/);
  expect(before.ap).toMatch(/BT\s+1 0 0 rg/);
  expect(inks(colorsAlong(doc.id, borderY, 150, 250))).toEqual({ red: true, blue: false });
  // PDFium draws the text in /DA's (the border's) colour, not /TextColor's.
  expect(inks(colorsAlong(doc.id, textY, 120, 280))).toEqual({ red: true, blue: false });

  // 2. Ours: PDFium's appearance with the text's colour operator replaced,
  // as a one-page PDF built here (content + standard font + ExtGState), set
  // as the appearance by EPDFAnnot_SetAppearanceFromPage; /DS gets the text colour.
  const rect = { x: 100, y: 682, w: 200, h: 60 }; // page space of /Rect
  const patched = before.ap.replace(/(BT\s+)[\d.]+\s+[\d.]+\s+[\d.]+\s+rg/, '$10 0 1 rg');
  const content = `q 1 0 0 1 ${String(-rect.x)} ${String(-rect.y)} cm\n${patched}\nQ\n`;
  const pdf = onePagePdf(rect.w, rect.h, content, 'FXF_Courier-Bold', 'Courier-Bold');
  withAnnot(doc.id, (a) => {
    const h = heap();
    const fp = h.wasmExports.malloc(pdf.length);
    h.HEAPU8.set(pdf, fp);
    const tmp = rawCall(mod, 'FPDF_LoadMemDocument', fp, pdf.length, '');
    expect(tmp).toBeGreaterThan(0);
    expect(rawCall(mod, 'EPDFAnnot_SetAppearanceFromPage', a, tmp, 0)).toBeTruthy();
    rawCall(mod, 'FPDF_CloseDocument', tmp);
    h.wasmExports.free(fp);
    withWideString(mod, 'font: bold Courier 18pt; text-align:center; color:#0000FF', (s) =>
      rawCall(mod, 'FPDFAnnot_SetStringValue', a, 'DS', s),
    );
  });
  const after = withAnnot(doc.id, (a) => ({
    ap: getAP(a),
    da: readAnnotString(mod, a, 'DA'),
    ds: readAnnotString(mod, a, 'DS'),
  }));
  expect(after.da).toMatch(/1 0 0 rg/);
  expect(after.ds).toMatch(/color:#0000FF/);
  expect(after.ap).toMatch(/BT\s+0 0 1 rg/);
  expect(inks(colorsAlong(doc.id, borderY, 150, 250))).toEqual({ red: true, blue: false });
  expect(inks(colorsAlong(doc.id, textY, 120, 280))).toEqual({ red: false, blue: true });

  // Save and reopen: what EmbedPDF reads back.
  const saved = (await native.saveAsCopy(doc).toPromise()) as ArrayBuffer;
  const text = Buffer.from(saved).toString('latin1');
  expect(text).toMatch(/\/DS\s*\(font: bold Courier 18pt; text-align:center; color:#0000FF\)/);
  const again = await open(new Uint8Array(saved));
  const againPage = again.pages[0];
  if (!againPage) throw new Error('no page');
  const anns = (await native.getPageAnnotations(again, againPage).toPromise()) as unknown[];
  const ft = anns[0] as { fontColor?: string; strokeColor?: string };
  expect(ft.fontColor?.toLowerCase()).toBe(BLUE);
  expect(ft.strokeColor?.toLowerCase()).toBe(RED);
  // (The font comes back through our own readback, freeTextFonts.ts, not EmbedPDF's.)
  expect(inks(colorsAlong(again.id, borderY, 150, 250))).toEqual({ red: true, blue: false });
  expect(inks(colorsAlong(again.id, textY, 120, 280))).toEqual({ red: false, blue: true });
}, 60000);
