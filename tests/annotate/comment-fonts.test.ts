// M11-07 (D-52, ADR-028, spike S26 route R2) on real PDFium: a text comment in
// a library font is drawn in its face with HarfBuzz, the font embedded as a
// subset; characters the face lacks come from the fallbacks (symbols,
// Devanagari, Chinese); bold and italic faces or synthetic ones; /DS carries
// the family and /DA its standard fallback; Ctrl+S's narrow tail carries the
// fonts, a reopen reads the family back, and flattened text is still found.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import {
  PdfAnnotationSubtype,
  PdfStandardFont,
  PdfTextAlignment,
  PdfVerticalAlignment,
  type PdfDocumentObject,
} from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { unzlibSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import { simplePdf } from '../../e2e/fixtures/generate';
import { readAnnotString } from '../../src/workers/render/annotTiles';
import {
  applyCommentFont,
  commentFontOf,
  prepareCommentFont,
  takeCommentFontFallbacks,
} from '../../src/workers/render/commentFonts/apply';
import { FaceStore, missingIn } from '../../src/workers/render/commentFonts/faces';
import { applyTextColors } from '../../src/workers/render/freeTextColors';
import { installFontReadback } from '../../src/workers/render/freeTextFonts';
import { docPtrOf, rawCall } from '../../src/workers/render/pdfium';
import { concatBytes } from '../../src/workers/render/save/bytes';
import { FPDF_NO_INCREMENTAL, saveWithFlags } from '../../src/workers/render/save/writer';
import { SaveTracker } from '../../src/workers/render/save/tracker';

const require = createRequire(import.meta.url);
const VENDOR = join(import.meta.dirname, '..', '..', 'vendor', 'fonts', 'files');
let mod: WrappedPdfiumModule;
let native: PdfiumNative;
let tracker: SaveTracker;
let seq = 0;
const loaded: string[] = [];
const store = new FaceStore({
  harfbuzz: () => import('harfbuzzjs'),
  subsetWasm: () =>
    Promise.resolve(readFileSync(require.resolve('harfbuzzjs/dist/harfbuzz-subset.wasm'))),
  fontFile: (file) => {
    loaded.push(file);
    return Promise.resolve(new Uint8Array(readFileSync(join(VENDOR, file))));
  },
});

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
  installFontReadback(native);
  tracker = new SaveTracker(mod, native);
});

async function open(bytes: Uint8Array): Promise<PdfDocumentObject> {
  const id = `f${String(++seq)}`;
  const doc = await native
    .openDocumentBuffer({ id, content: bytes.slice().buffer }, {})
    .toPromise();
  tracker.opened(id, bytes);
  await tracker.securityReady(id);
  return doc;
}

const box = (extra: Record<string, unknown> = {}) => ({
  type: PdfAnnotationSubtype.FREETEXT,
  id: `ft-${String(++seq)}`,
  pageIndex: 0,
  rect: { origin: { x: 100, y: 100 }, size: { width: 300, height: 80 } },
  contents: 'Flange ⌀50 ±0.5 mm',
  fontFamily: PdfStandardFont.Helvetica,
  libraryFont: 'roboto',
  fontSize: 14,
  fontColor: '#0000ff',
  strokeColor: '#ff0000',
  strokeWidth: 1,
  color: 'transparent',
  textAlign: PdfTextAlignment.Left,
  verticalAlign: PdfVerticalAlignment.Top,
  opacity: 1,
  ...extra,
});

/** What the Render worker does for an executor call (render.worker.ts `exec`). */
async function write(
  doc: PdfDocumentObject,
  method: 'createPageAnnotation' | 'updatePageAnnotation',
  annot: Record<string, unknown>,
  opts?: Record<string, unknown>,
): Promise<string> {
  const page = doc.pages[0];
  if (!page) throw new Error('no page');
  const args: unknown[] = [doc, page, annot, ...(opts ? [opts] : [])];
  const faces = await prepareCommentFont(store, method, args);
  const fn = native[method].bind(native) as (...a: unknown[]) => { toPromise(): Promise<unknown> };
  await fn(...args).toPromise();
  applyTextColors(mod, native, method, args, faces !== null);
  const outcome = applyCommentFont(mod, native, method, args, faces);
  tracker.recordMutation(method, args);
  return outcome;
}

function withAnnot<T>(docId: string, fn: (a: number) => T): T {
  const page = rawCall(mod, 'FPDF_LoadPage', docPtrOf(native, docId), 0);
  const a = rawCall(mod, 'FPDFPage_GetAnnot', page, 0);
  try {
    return fn(a);
  } finally {
    rawCall(mod, 'FPDFPage_CloseAnnot', a);
    rawCall(mod, 'FPDF_ClosePage', page);
  }
}

/** Count of pixels in the comment's box matching `pred`. */
function ink(docId: string, pred: (r: number, g: number, b: number) => boolean): number {
  const page = rawCall(mod, 'FPDF_LoadPage', docPtrOf(native, docId), 0);
  const w = 595 * 2;
  const h = 842 * 2;
  const bmp = rawCall(mod, 'FPDFBitmap_Create', w, h, 0);
  rawCall(mod, 'FPDFBitmap_FillRect', bmp, 0, 0, w, h, 0xffffffff);
  rawCall(mod, 'FPDF_RenderPageBitmap', bmp, page, 0, 0, w, h, 0, 1);
  const buf = rawCall(mod, 'FPDFBitmap_GetBuffer', bmp);
  const stride = rawCall(mod, 'FPDFBitmap_GetStride', bmp);
  const heap = (mod.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8;
  let n = 0;
  for (let y = 204; y < 356; y++)
    for (let x = 204; x < 796; x++) {
      const at = buf + y * stride + x * 4;
      if (pred(heap[at + 2] ?? 0, heap[at + 1] ?? 0, heap[at] ?? 0)) n++;
    }
  rawCall(mod, 'FPDFBitmap_Destroy', bmp);
  rawCall(mod, 'FPDF_ClosePage', page);
  return n;
}
const blue = (r: number, g: number, b: number) => b > 150 && r < 110 && g < 110;

/** Page text after flattening (the comment's text joins the page). */
function flattenedText(docId: string): string {
  const doc = docPtrOf(native, docId);
  const page = rawCall(mod, 'FPDF_LoadPage', doc, 0);
  rawCall(mod, 'FPDFPage_Flatten', page, 0);
  rawCall(mod, 'FPDF_ClosePage', page);
  const p2 = rawCall(mod, 'FPDF_LoadPage', doc, 0);
  const tp = rawCall(mod, 'FPDFText_LoadPage', p2);
  const n = rawCall(mod, 'FPDFText_CountChars', tp);
  const heap = mod.pdfium as unknown as {
    wasmExports: { malloc(n: number): number; free(p: number): void };
    UTF16ToString(p: number): string;
  };
  const buf = heap.wasmExports.malloc((n + 1) * 2);
  rawCall(mod, 'FPDFText_GetText', tp, 0, n, buf);
  const s = heap.UTF16ToString(buf);
  heap.wasmExports.free(buf);
  rawCall(mod, 'FPDFText_ClosePage', tp);
  rawCall(mod, 'FPDF_ClosePage', p2);
  return s;
}

/** Every stream of the saved file inflated (what the appearance and font objects say). */
function inflated(bytes: Uint8Array): string {
  const text = Buffer.from(bytes).toString('latin1');
  const out = [text];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    const end = text.indexOf('endstream', start);
    if (end < 0) break;
    try {
      out.push(Buffer.from(unzlibSync(bytes.subarray(start, end))).toString('latin1'));
    } catch {
      // not Flate
    }
  }
  return out.join('\n');
}

const norm = (s: string): string => s.replace(/[\s￾￿]|\0/gu, '');

describe('comment fonts (M11-07, D-52)', () => {
  it('knows which calls draw a library font', () => {
    const doc = { id: 'd' };
    const page = { index: 0 };
    expect(commentFontOf('createPageAnnotation', [doc, page, box()])?.family.id).toBe('roboto');
    expect(commentFontOf('createPageAnnotation', [doc, page, box({ libraryFont: '' })])).toBeNull();
    expect(
      commentFontOf('updatePageAnnotation', [doc, page, box(), { regenerateAppearance: false }]),
    ).toBeNull();
    expect(commentFontOf('createPageAnnotation', [doc, page, box({ libraryFont: 'nope' })])).toBe(
      null,
    );
    // The hidden symbol fallback is not a family a comment can choose.
    expect(
      commentFontOf('createPageAnnotation', [doc, page, box({ libraryFont: 'notosansmath' })]),
    ).toBeNull();
    const s = commentFontOf('createPageAnnotation', [
      doc,
      page,
      box({ fontFamily: PdfStandardFont.Helvetica_BoldOblique }),
    ]);
    expect(s && [s.bold, s.italic]).toEqual([true, true]);
  });

  it('draws, embeds, saves, reads back and flattens a Roboto comment with symbols', async () => {
    const original = simplePdf(1);
    const doc = await open(original);
    const a = box();
    loaded.length = 0;
    expect(await write(doc, 'createPageAnnotation', a)).toBe('applied');
    // ⌀ is in no family: Noto Sans Math is loaded for it, nothing else.
    expect(loaded).toEqual(['roboto-regular.ttf', 'notosansmath-regular.ttf']);
    expect(ink(doc.id, blue)).toBeGreaterThan(150);
    expect(withAnnot(doc.id, (x) => readAnnotString(mod, x, 'DS'))).toBe(
      'font: Roboto 14pt; text-align:left; color:#0000FF',
    );
    expect(withAnnot(doc.id, (x) => readAnnotString(mod, x, 'DA'))).toMatch(/Helv|Helvetica/u);
    const s = await tracker.save(doc.id);
    const saved = concatBytes([original, s.tail]);
    const tail = inflated(s.tail);
    expect(tail).toMatch(/\/Subtype\s*\/Type0/u);
    expect(tail).toMatch(/\/FontFile2/u);
    expect(tail).toMatch(/\+Roboto/u);
    expect(tail).toMatch(/\/ActualText/u);
    expect(s.tail.length).toBeLessThan(40_000);
    const back = await open(saved);
    const page = back.pages[0];
    if (!page) throw new Error('no page');
    const anns = (await native.getPageAnnotations(back, page).toPromise()) as Record<
      string,
      unknown
    >[];
    expect(anns[0]?.libraryFont).toBe('roboto');
    expect(anns[0]?.fontFamily).toBe(PdfStandardFont.Helvetica);
    expect(ink(back.id, blue)).toBeGreaterThan(150);
    expect(norm(flattenedText(back.id))).toContain(norm('Flange ⌀50 ±0.5 mm'));
  });

  it('draws Hindi and Chinese in a Latin family through the fallbacks (PDFium alone draws nothing)', async () => {
    const text = 'पाइप 管道 OK';
    const doc = await open(simplePdf(1));
    const page = doc.pages[0];
    if (!page) throw new Error('no page');
    // PDFium on its own: no text it cannot encode in WinAnsi.
    const plain = box({ libraryFont: undefined, contents: text });
    await native.createPageAnnotation(doc, page, plain as never).toPromise();
    expect(ink(doc.id, blue)).toBeLessThan(80);
    await native.removePageAnnotation(doc, page, plain as never).toPromise();
    loaded.length = 0;
    expect(
      await write(doc, 'createPageAnnotation', box({ libraryFont: 'tinos', contents: text })),
    ).toBe('applied');
    expect(loaded).toContain('notosansdeva-regular.ttf');
    expect(loaded).toContain('notosanssc-regular.ttf');
    expect(ink(doc.id, blue)).toBeGreaterThan(150);
    const bytes = saveWithFlags(mod, docPtrOf(native, doc.id), FPDF_NO_INCREMENTAL);
    const again = await open(bytes);
    expect(norm(flattenedText(again.id))).toContain(norm(text));
  });

  it('uses bold and italic faces, and synthesizes the ones a family lacks', async () => {
    for (const [libraryFont, fontFamily, file] of [
      ['roboto', PdfStandardFont.Helvetica_BoldOblique, 'roboto-boldItalic.ttf'],
      ['ibmplexsans', PdfStandardFont.Helvetica_Bold, 'ibmplexsans-upright.ttf'],
      ['architectsdaughter', PdfStandardFont.Helvetica_Bold, 'architectsdaughter-regular.ttf'],
    ] as const) {
      const doc = await open(simplePdf(1));
      loaded.length = 0;
      const a = box({ libraryFont, fontFamily, contents: 'Bold note 12' });
      expect(await write(doc, 'createPageAnnotation', a)).toBe('applied');
      if (loaded.length) expect(loaded[0]).toBe(file);
      const ap = inflated(saveWithFlags(mod, docPtrOf(native, doc.id), FPDF_NO_INCREMENTAL));
      // A synthetic bold is a stroke (text render mode 2); a real face needs none.
      expect(/\b2 Tr\b/u.test(ap)).toBe(libraryFont === 'architectsdaughter');
      expect(ink(doc.id, blue)).toBeGreaterThan(150);
    }
  });

  it('is drawn again after an update regenerates the appearance, and not on a move', async () => {
    const doc = await open(simplePdf(1));
    const a = box();
    await write(doc, 'createPageAnnotation', a);
    const resized = {
      ...a,
      rect: { origin: { x: 100, y: 100 }, size: { width: 200, height: 120 } },
    };
    expect(await write(doc, 'updatePageAnnotation', resized)).toBe('applied');
    expect(inflated(saveWithFlags(mod, docPtrOf(native, doc.id), FPDF_NO_INCREMENTAL))).toMatch(
      /\+Roboto/u,
    );
    expect(await write(doc, 'updatePageAnnotation', resized, { regenerateAppearance: false })).toBe(
      'none',
    );
    // Back to a standard font: PDFium's own appearance, /DS without the family.
    expect(await write(doc, 'updatePageAnnotation', { ...resized, libraryFont: '' })).toBe('none');
    expect(withAnnot(doc.id, (x) => readAnnotString(mod, x, 'DS'))).toMatch(/^font: Helvetica /u);
  });

  it('keeps PDFium appearance and counts it when the faces could not be loaded', async () => {
    const doc = await open(simplePdf(1));
    const page = doc.pages[0];
    if (!page) throw new Error('no page');
    const a = box();
    const args = [doc, page, a];
    await native.createPageAnnotation(doc, page, a as never).toPromise();
    expect(applyCommentFont(mod, native, 'createPageAnnotation', args, null)).toBe('fallback');
    expect(takeCommentFontFallbacks(doc.id)).toBe(1);
    expect(takeCommentFontFallbacks(doc.id)).toBe(0);
  });

  it('lists the characters no face draws', async () => {
    const faces = await store.prepare(
      {
        id: 'roboto',
        name: 'Roboto',
        group: 'sans',
        standard: 'helvetica',
        faces: { regular: { file: 'roboto-regular.ttf' } },
      },
      false,
      false,
      'abc',
    );
    expect(faces.fallbacks).toEqual([]);
    expect([...missingIn('a ⌀ b\nक', [faces.primary])]).toEqual([0x2300, 0x915]);
  });
});
