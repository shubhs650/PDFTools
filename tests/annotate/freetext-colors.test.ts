// ADR-024 (spike S25) on real PDFium: a text box's text colour apart from its
// border colour — drawn on the page, written to /DS as Acrobat reads it, kept
// through Ctrl+S's narrow tail (verified like the save flow), and read back;
// one colour clears a stale /TextColor; callouts, typewriters and moves; and
// another viewer's /DS text colour read back.
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
import { beforeAll, describe, expect, it } from 'vitest';
import { simplePdf } from '../../e2e/fixtures/generate';
import { isDict, PdfRef, PdfStream, type PdfValue } from '../../src/model/pdf/objects';
import { PdfReader } from '../../src/model/pdf/reader';
import { readAnnotString } from '../../src/workers/render/annotTiles';
import { applyTextColors } from '../../src/workers/render/freeTextColors';
import { installFontReadback } from '../../src/workers/render/freeTextFonts';
import { docPtrOf, rawCall, withWideString } from '../../src/workers/render/pdfium';
import { concatBytes } from '../../src/workers/render/save/bytes';
import { digestDocument } from '../../src/workers/render/save/digest';
import { SaveTracker } from '../../src/workers/render/save/tracker';
import { compareDigests } from '../../src/workers/work/verifySave';

const require = createRequire(import.meta.url);
let mod: WrappedPdfiumModule;
let native: PdfiumNative;
let tracker: SaveTracker;
let seq = 0;

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
  installFontReadback(native);
  tracker = new SaveTracker(mod, native);
});

async function open(bytes: Uint8Array): Promise<PdfDocumentObject> {
  const id = `c${String(++seq)}`;
  const doc = await native
    .openDocumentBuffer({ id, content: bytes.slice().buffer }, {})
    .toPromise();
  tracker.opened(id, bytes);
  await tracker.securityReady(id);
  return doc;
}

const RED = '#ff0000';
const BLUE = '#0000ff';

/** Reddish / bluish ink in a horizontal run of pixels (page points from the top-left). */
function inks(docId: string, y: number, x0: number, x1: number): { red: boolean; blue: boolean } {
  const doc = docPtrOf(native, docId);
  const page = rawCall(mod, 'FPDF_LoadPage', doc, 0);
  const scale = 2;
  const w = 595 * scale;
  const h = 842 * scale;
  const bmp = rawCall(mod, 'FPDFBitmap_Create', w, h, 0);
  rawCall(mod, 'FPDFBitmap_FillRect', bmp, 0, 0, w, h, 0xffffffff);
  rawCall(mod, 'FPDF_RenderPageBitmap', bmp, page, 0, 0, w, h, 0, 1);
  const buf = rawCall(mod, 'FPDFBitmap_GetBuffer', bmp);
  const stride = rawCall(mod, 'FPDFBitmap_GetStride', bmp);
  const heap = (mod.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8;
  let red = false;
  let blue = false;
  for (let x = x0; x <= x1; x += 0.5) {
    const at = buf + Math.round(y * scale) * stride + Math.round(x * scale) * 4;
    const [b, g, r] = [heap[at] ?? 0, heap[at + 1] ?? 0, heap[at + 2] ?? 0];
    if (r > 150 && g < 100 && b < 100) red = true;
    if (b > 150 && r < 100 && g < 100) blue = true;
  }
  rawCall(mod, 'FPDFBitmap_Destroy', bmp);
  rawCall(mod, 'FPDF_ClosePage', page);
  return { red, blue };
}

/** The box of every non-white pixel on the page (points), title text excluded. */
function inkBox(docId: string): [number, number, number, number] {
  const doc = docPtrOf(native, docId);
  const page = rawCall(mod, 'FPDF_LoadPage', doc, 0);
  const w = 595;
  const h = 842;
  const bmp = rawCall(mod, 'FPDFBitmap_Create', w, h, 0);
  rawCall(mod, 'FPDFBitmap_FillRect', bmp, 0, 0, w, h, 0xffffffff);
  rawCall(mod, 'FPDF_RenderPageBitmap', bmp, page, 0, 0, w, h, 0, 1);
  const buf = rawCall(mod, 'FPDFBitmap_GetBuffer', bmp);
  const stride = rawCall(mod, 'FPDFBitmap_GetStride', bmp);
  const heap = (mod.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8;
  const out: [number, number, number, number] = [w, h, 0, 0];
  for (let y = 80; y < h; y++)
    for (let x = 0; x < w; x++) {
      const at = buf + y * stride + x * 4;
      if ((heap[at] ?? 0) + (heap[at + 1] ?? 0) + (heap[at + 2] ?? 0) > 720) continue;
      out[0] = Math.min(out[0], x);
      out[1] = Math.min(out[1], y);
      out[2] = Math.max(out[2], x);
      out[3] = Math.max(out[3], y);
    }
  rawCall(mod, 'FPDFBitmap_Destroy', bmp);
  rawCall(mod, 'FPDF_ClosePage', page);
  return out;
}

/** A string key of the page's first annotation. */
function key(docId: string, k: string): string {
  const doc = docPtrOf(native, docId);
  const page = rawCall(mod, 'FPDF_LoadPage', doc, 0);
  const a = rawCall(mod, 'FPDFPage_GetAnnot', page, 0);
  try {
    return readAnnotString(mod, a, k);
  } finally {
    rawCall(mod, 'FPDFPage_CloseAnnot', a);
    rawCall(mod, 'FPDF_ClosePage', page);
  }
}

const box = (extra: Record<string, unknown> = {}) => ({
  type: PdfAnnotationSubtype.FREETEXT,
  id: 'ft-1',
  pageIndex: 0,
  rect: { origin: { x: 100, y: 100 }, size: { width: 200, height: 60 } },
  contents: 'Revised per RFI 12',
  fontFamily: PdfStandardFont.Courier_Bold,
  fontSize: 18,
  fontColor: BLUE,
  strokeColor: RED,
  strokeWidth: 2,
  color: 'transparent',
  textAlign: PdfTextAlignment.Center,
  verticalAlign: PdfVerticalAlignment.Top,
  opacity: 1,
  ...extra,
});

/** What the Render worker does for an executor call: EmbedPDF's write, then ours. */
async function write(
  doc: PdfDocumentObject,
  method: 'createPageAnnotation' | 'updatePageAnnotation',
  annot: Record<string, unknown>,
  opts?: Record<string, unknown>,
): Promise<string> {
  const page = doc.pages[0];
  if (!page) throw new Error('no page');
  const args: unknown[] = [doc, page, annot, ...(opts ? [opts] : [])];
  const fn = native[method].bind(native) as (...a: unknown[]) => { toPromise(): Promise<unknown> };
  await fn(...args).toPromise();
  const outcome = applyTextColors(mod, native, method, args);
  tracker.recordMutation(method, args);
  return outcome;
}

async function reopened(doc: PdfDocumentObject, original: Uint8Array) {
  const s = await tracker.save(doc.id);
  const saved = concatBytes([original, s.tail]);
  const back = await open(saved);
  if (!s.expected) throw new Error('empty tail');
  expect(compareDigests(s.expected, digestDocument(mod, native, back.id, 'all')).ok).toBe(true);
  const page = back.pages[0];
  if (!page) throw new Error('no page');
  const anns = (await native.getPageAnnotations(back, page).toPromise()) as unknown[];
  return { back, saved, ft: anns[0] as Record<string, unknown> };
}

/**
 * Every font, graphics state and XObject name an annotation's normal
 * appearance (and any form it draws) uses, missing from that form's own
 * /Resources. A strict reader (poppler, pdf.js, Acrobat) finds nothing else:
 * PDFium falls back to its stock Helvetica, so its pixels alone don't show it.
 */
async function missingResources(saved: Uint8Array): Promise<string[]> {
  const r = await PdfReader.open(saved);
  const missing: string[] = [];
  const check = async (v: PdfValue | undefined, where: string, depth: number): Promise<void> => {
    const form = await r.resolve(v);
    if (!(form instanceof PdfStream) || depth > 4) return;
    const content = Buffer.from(await r.decode(form)).toString('latin1');
    const res = await r.resolve(form.dict.get('Resources'));
    const kinds: [string, RegExp][] = [
      ['Font', /\/([^\s/()<>[\]]+)\s+[-\d.]+\s+Tf\b/gu],
      ['ExtGState', /\/([^\s/()<>[\]]+)\s+gs\b/gu],
      ['XObject', /\/([^\s/()<>[\]]+)\s+Do\b/gu],
    ];
    for (const [kind, re] of kinds) {
      const group = isDict(res) ? await r.resolve(res.get(kind)) : undefined;
      for (const m of content.matchAll(re)) {
        const name = m[1] ?? '';
        const entry = isDict(group) ? group.get(name) : undefined;
        if (entry === undefined) missing.push(`${where}: ${kind} /${name}`);
        else if (kind === 'XObject') await check(entry, `${where} > ${name}`, depth + 1);
      }
    }
  };
  for (const { dict } of await r.pages()) {
    const annots = await r.resolve(dict.get('Annots'));
    if (!Array.isArray(annots)) continue;
    for (const ref of annots) {
      const a = await r.resolve(ref);
      if (!isDict(a)) continue;
      const ap = await r.resolve(a.get('AP'));
      const label = `annot ${ref instanceof PdfRef ? String(ref.num) : '?'}`;
      if (isDict(ap)) await check(ap.get('N'), label, 0);
    }
  }
  return missing;
}

const BORDER_Y = 101;
const TEXT_Y = 112;

describe('text and border colours (ADR-024)', () => {
  it('draws blue text on a red border, writes /DS, and keeps both through Ctrl+S', async () => {
    const original = simplePdf(1);
    const doc = await open(original);
    // EmbedPDF alone: PDFium draws the text in the border's colour.
    const page = doc.pages[0];
    if (!page) throw new Error('no page');
    await native.createPageAnnotation(doc, page, box() as never).toPromise();
    expect(inks(doc.id, TEXT_Y, 120, 280)).toEqual({ red: true, blue: false });
    await native.removePageAnnotation(doc, page, box() as never).toPromise();

    expect(await write(doc, 'createPageAnnotation', box())).toBe('recolored');
    expect(key(doc.id, 'DA')).toMatch(/1 0 0 rg/);
    expect(key(doc.id, 'DS')).toBe('font: bold Courier 18pt; text-align:center; color:#0000FF');
    expect(inks(doc.id, BORDER_Y, 150, 250)).toEqual({ red: true, blue: false });
    expect(inks(doc.id, TEXT_Y, 120, 280)).toEqual({ red: false, blue: true });

    const { back, saved, ft } = await reopened(doc, original);
    expect(Buffer.from(saved).toString('latin1')).toContain('color:#0000FF');
    // M7-12: the appearance carries its own fonts and graphics states (strict readers).
    expect(await missingResources(saved)).toEqual([]);
    expect(ft.fontColor).toBe(BLUE);
    expect(ft.strokeColor).toBe(RED);
    expect(ft.fontFamily).toBe(PdfStandardFont.Courier_Bold);
    expect(inks(back.id, BORDER_Y, 150, 250)).toEqual({ red: true, blue: false });
    expect(inks(back.id, TEXT_Y, 120, 280)).toEqual({ red: false, blue: true });
  });

  it('draws exactly where PDFium drew, turned or not', async () => {
    for (const rotation of [0, 30]) {
      const doc = await open(simplePdf(1));
      const page = doc.pages[0];
      if (!page) throw new Error('no page');
      const a = box({ rotation });
      await native.createPageAnnotation(doc, page, a as never).toPromise();
      const before = inkBox(doc.id);
      expect(applyTextColors(mod, native, 'createPageAnnotation', [doc, page, a])).toBe(
        'recolored',
      );
      const after = inkBox(doc.id);
      after.forEach((v, i) => {
        expect(Math.abs(v - (before[i] ?? 0)), `rotation ${String(rotation)}`).toBeLessThanOrEqual(
          1,
        );
      });
    }
  });

  it('keeps the text colour through an edit of the text and a resize', async () => {
    const original = simplePdf(1);
    const doc = await open(original);
    await write(doc, 'createPageAnnotation', box());
    expect(
      await write(
        doc,
        'updatePageAnnotation',
        box({
          contents: 'Revised per RFI 12 and 14, see sheet A-201',
          rect: { origin: { x: 100, y: 100 }, size: { width: 240, height: 90 } },
        }),
      ),
    ).toBe('recolored');
    expect(inks(doc.id, BORDER_Y, 150, 250)).toEqual({ red: true, blue: false });
    expect(inks(doc.id, TEXT_Y, 110, 330)).toEqual({ red: false, blue: true });
    const { saved } = await reopened(doc, original);
    expect(await missingResources(saved)).toEqual([]);
  });

  it('one colour: /DA has it and a stale /TextColor is cleared', async () => {
    const original = simplePdf(1);
    const doc = await open(original);
    await write(doc, 'createPageAnnotation', box());
    // Text red again: the same colour as the border (EmbedPDF leaves /TextColor blue).
    expect(await write(doc, 'updatePageAnnotation', box({ fontColor: RED }))).toBe('style');
    expect(key(doc.id, 'DS')).toContain('color:#FF0000');
    expect(inks(doc.id, TEXT_Y, 120, 280)).toEqual({ red: true, blue: false });
    const { ft } = await reopened(doc, original);
    expect(ft.fontColor).toBe(RED);
    expect(ft.strokeColor).toBe(RED);
  });

  it('a typewriter (no border) and a move without a new appearance are left as they are', async () => {
    const original = simplePdf(1);
    const doc = await open(original);
    const typewriter = box({
      strokeColor: undefined,
      strokeWidth: 0,
      intent: 'FreeTextTypeWriter',
    });
    expect(await write(doc, 'createPageAnnotation', typewriter)).toBe('style');
    expect(inks(doc.id, TEXT_Y - 6, 120, 280)).toEqual({ red: false, blue: true });
    const moved = {
      ...typewriter,
      rect: { origin: { x: 120, y: 100 }, size: { width: 200, height: 60 } },
    };
    expect(await write(doc, 'updatePageAnnotation', moved, { regenerateAppearance: false })).toBe(
      'none',
    );
  });

  it('a callout: the text colour shows, its line and box keep the border colour', async () => {
    const original = simplePdf(1);
    const doc = await open(original);
    const callout = box({
      id: 'co-1',
      intent: 'FreeTextCallout',
      strokeWidth: 1,
      rect: { origin: { x: 100, y: 100 }, size: { width: 250, height: 100 } },
      calloutLine: [
        { x: 110, y: 190 },
        { x: 150, y: 150 },
        { x: 200, y: 150 },
      ],
      lineEnding: 1,
    });
    expect(['recolored', 'style']).toContain(await write(doc, 'createPageAnnotation', callout));
    const { ft } = await reopened(doc, original);
    expect(ft.fontColor).toBe(BLUE);
    expect(ft.strokeColor).toBe(RED);
  });

  it('reads the text colour from /DS when there is no /TextColor (Acrobat, PDF-XChange)', async () => {
    const original = simplePdf(1);
    const doc = await open(original);
    // A file as Acrobat writes it: /DA red (the border), the text colour only in /DS.
    await write(doc, 'createPageAnnotation', box({ fontColor: RED }));
    const d = docPtrOf(native, doc.id);
    const page = rawCall(mod, 'FPDF_LoadPage', d, 0);
    const a = rawCall(mod, 'FPDFPage_GetAnnot', page, 0);
    withWideString(mod, 'font: Helvetica,sans-serif 12.0pt; text-align:left; color:#0000FF ', (p) =>
      rawCall(mod, 'FPDFAnnot_SetStringValue', a, 'DS', p),
    );
    rawCall(mod, 'FPDFPage_CloseAnnot', a);
    rawCall(mod, 'FPDF_ClosePage', page);
    tracker.recordMutation('updatePageAnnotation', [doc, doc.pages[0], box()]);
    const { ft } = await reopened(doc, original);
    expect(ft.fontColor).toBe(BLUE);
    expect(ft.strokeColor).toBe(RED);
  });
});
