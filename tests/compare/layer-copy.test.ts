// Layer switches (follow-up to M12-11, D-59, Q24): the copy with another
// default layer state is the file plus one incremental update, and PDFium
// draws it with the chosen layers. Self-made fixtures and corpus pair 11.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { corpusBytes, corpusPair } from '../../e2e/fixtures/comparison-corpus/index';
import { hasQpdf, qpdfEncrypt } from '../../e2e/fixtures/encrypted';
import { buildPdf, layersPdf, simplePdf } from '../../e2e/fixtures/generate';
import { readLayers } from '../../src/model/ocg';
import { IDENTITY } from '../../src/model/compare/material';
import { DEFAULT_STYLE } from '../../src/model/compare/overlay';
import { OverlayTiles, displayedSize } from '../../src/workers/render/overlayTiles';
import { acquirePage, rawCall } from '../../src/workers/render/pdfium';
import {
  LayerCopyError,
  changedStates,
  layerCopy,
  layerKey,
} from '../../src/workers/shared/layerCopy';

const inflate = (b: Uint8Array) => Promise.resolve(new Uint8Array(inflateSync(b)));
const require = createRequire(import.meta.url);
let mod: WrappedPdfiumModule;
let native: PdfiumNative;
let seq = 0;

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
});

/** The first page at 1 px/pt in BGRA, opened as the Render worker opens documents. */
async function render(bytes: Uint8Array): Promise<{ px: Uint8Array; w: number; h: number }> {
  const id = `copy${String(++seq)}`;
  const doc = await native
    .openDocumentBuffer({ id, content: bytes.slice().buffer }, { normalizeRotation: true })
    .toPromise();
  const ref = acquirePage(native, id, 0);
  try {
    const w = Math.ceil(rawCall(mod, 'FPDF_GetPageWidthF', ref.pagePtr));
    const h = Math.ceil(rawCall(mod, 'FPDF_GetPageHeightF', ref.pagePtr));
    const bmp = rawCall(mod, 'FPDFBitmap_Create', w, h, 0);
    rawCall(mod, 'FPDFBitmap_FillRect', bmp, 0, 0, w, h, 0xffffffff);
    rawCall(mod, 'FPDF_RenderPageBitmap', bmp, ref.pagePtr, 0, 0, w, h, 0, 0);
    const buf = rawCall(mod, 'FPDFBitmap_GetBuffer', bmp);
    const heap = (mod.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8;
    const px = heap.slice(buf, buf + w * h * 4);
    rawCall(mod, 'FPDFBitmap_Destroy', bmp);
    return { px, w, h };
  } finally {
    ref.release();
    await native.closeDocument(doc).toPromise();
  }
}

/** BGRA at a point given in PDF user space (y up). */
function at(img: { px: Uint8Array; w: number; h: number }, x: number, y: number): number[] {
  const i = ((img.h - y) * img.w + x) * 4;
  return [img.px[i + 2] ?? 0, img.px[i + 1] ?? 0, img.px[i] ?? 0];
}

/** Pixels that are not white. */
function ink(img: { px: Uint8Array }): number {
  let n = 0;
  for (let i = 0; i < img.px.length; i += 4)
    if ((img.px[i] ?? 255) < 200 || (img.px[i + 1] ?? 255) < 200 || (img.px[i + 2] ?? 255) < 200)
      n++;
  return n;
}

describe('layerKey and changedStates', () => {
  it('gives one key per set of switches, in object order', () => {
    expect(layerKey(undefined)).toBe('');
    expect(layerKey({})).toBe('');
    expect(layerKey({ 12: true, 5: false })).toBe('5- 12+');
    expect(layerKey({ 5: false, 12: true })).toBe(layerKey({ 12: true, 5: false }));
  });

  it('keeps only switches that differ from the file’s defaults', () => {
    const defaults = [
      { id: 5, on: true },
      { id: 6, on: false },
    ];
    expect(changedStates(defaults, { 5: true, 6: false })).toEqual({});
    expect(changedStates(defaults, { 5: false, 6: false, 99: true })).toEqual({ 5: false });
  });
});

describe('layerCopy', () => {
  it('turns a hidden layer on and a shown one off (inline /D in the catalog)', async () => {
    const src = layersPdf();
    const copy = await layerCopy(src, { 5: false, 6: true }, inflate);
    // The file is untouched: the copy is the file plus one update.
    expect(copy.subarray(0, src.length)).toEqual(src);
    expect((await readLayers(copy, inflate)).layers).toEqual([
      { name: 'Dimensions', on: false, id: 5 },
      { name: 'Hidden notes', on: true, id: 6 },
    ]);
    // PDFium draws the chosen layers: Dimensions (blue) gone, Hidden notes (red) shown.
    const before = await render(src);
    const after = await render(copy);
    expect(at(before, 150, 650)).toEqual([0, 0, 255]);
    expect(at(before, 400, 650)).toEqual([255, 255, 255]);
    expect(at(after, 150, 650)).toEqual([255, 255, 255]);
    expect(at(after, 400, 650)).toEqual([255, 0, 0]);
  });

  it('rewrites an indirect /D in place and drops /AS', async () => {
    const bytes = buildPdf([
      '<< /Type /Catalog /Pages 2 0 R /OCProperties 8 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>',
      '<< >>',
      '<< /Type /OCG /Name (A) /Usage << /View << /ViewState /OFF >> >> >>',
      '<< /Type /OCG /Name (B) >>',
      '<< /BaseState /OFF /ON [6 0 R] /AS [<< /Event /View /Category [/View] /OCGs [5 0 R] >>] >>',
      '<< /OCGs [5 0 R 6 0 R] /D 7 0 R >>',
    ]);
    const copy = await layerCopy(bytes, { 5: true }, inflate);
    const tail = new TextDecoder('latin1').decode(copy.subarray(bytes.length));
    expect(tail).toMatch(/^\n?7 0 obj\n/);
    expect(tail).not.toContain('/AS');
    expect(tail).toContain('/BaseState /ON');
    expect((await readLayers(copy, inflate)).layers.map((l) => l.on)).toEqual([true, true]);
  });

  it.skipIf(!hasQpdf())('writes a valid update after an xref stream (object streams)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pdftools-layers-'));
    writeFileSync(join(dir, 'in.pdf'), layersPdf());
    spawnSync('qpdf', ['--object-streams=generate', join(dir, 'in.pdf'), join(dir, 'packed.pdf')]);
    const packed = new Uint8Array(readFileSync(join(dir, 'packed.pdf')));
    const copy = await layerCopy(packed, { 6: true }, inflate);
    writeFileSync(join(dir, 'copy.pdf'), copy);
    const check = spawnSync('qpdf', ['--check', join(dir, 'copy.pdf')], { encoding: 'utf8' });
    expect(check.status, check.stdout + check.stderr).toBe(0);
    expect((await readLayers(copy, inflate)).layers.map((l) => l.on)).toEqual([true, true]);
    expect(at(await render(copy), 400, 650)).toEqual([255, 0, 0]);
  });

  it('pair 11: FIRE_PROTECTION switched on in Rev A is drawn', async () => {
    const src = corpusBytes(corpusPair('overlay', '11'), 'old');
    const list = await readLayers(src, inflate);
    const fire = list.layers.find((l) => l.name === 'FIRE_PROTECTION');
    expect(fire?.on).toBe(false);
    if (!fire) return;
    const copy = await layerCopy(src, { [fire.id]: true }, inflate);
    const after = await readLayers(copy, inflate);
    expect(after.layers.find((l) => l.name === 'FIRE_PROTECTION')?.on).toBe(true);
    // Every other layer keeps its default.
    expect(after.layers.filter((l) => l.name !== 'FIRE_PROTECTION')).toEqual(
      list.layers.filter((l) => l.name !== 'FIRE_PROTECTION'),
    );
    expect(ink(await render(copy))).toBeGreaterThan(ink(await render(src)) + 200);
    // And every layer off leaves an emptier sheet.
    const none = Object.fromEntries(list.layers.map((l) => [l.id, false]));
    expect(ink(await render(await layerCopy(src, none, inflate)))).toBeLessThan(
      ink(await render(src)),
    );
  });

  it('refuses files without layers and encrypted files', async () => {
    await expect(layerCopy(simplePdf(1), { 5: true }, inflate)).rejects.toBeInstanceOf(
      LayerCopyError,
    );
    if (hasQpdf()) {
      const enc = qpdfEncrypt(layersPdf(), '', 'owner', ['256']);
      await expect(layerCopy(enc, { 5: true }, inflate)).rejects.toMatchObject({
        code: 'layers-encrypted',
      });
    }
  });
});

describe('overlay tiles from a layer copy', () => {
  it('draw the page content from the copy (contentId), A switched to show FIRE_PROTECTION', async () => {
    const src = corpusBytes(corpusPair('overlay', '11'), 'old');
    const fire = (await readLayers(src, inflate)).layers.find((l) => l.name === 'FIRE_PROTECTION');
    if (!fire) throw new Error('no FIRE_PROTECTION layer');
    const copy = await layerCopy(src, { [fire.id]: true }, inflate);
    for (const [id, bytes] of [
      ['t11a', src],
      ['t11a~layers', copy],
    ] as const)
      await native
        .openDocumentBuffer({ id, content: bytes.slice().buffer }, { normalizeRotation: true })
        .toPromise();
    const size = displayedSize(mod, native, 't11a', 0);
    const tiles = new OverlayTiles();
    const draw = (contentId?: string): number => {
      const out = tiles.render(mod, native, {
        a: {
          docId: 't11a',
          pageIndex: 0,
          place: IDENTITY,
          version: 0,
          ...(contentId ? { contentId } : {}),
        },
        b: null,
        scale: 0.5,
        x: 0,
        y: 0,
        width: Math.ceil(size.width * 0.5),
        height: Math.ceil(size.height * 0.5),
        style: DEFAULT_STYLE,
        thicken: false,
        comments: { a: true, b: false, hideChecks: false },
      });
      let n = 0;
      for (let i = 0; i < out.length; i += 4) if ((out[i + 1] ?? 255) < 200) n++;
      return n;
    };
    const own = draw();
    const switched = draw('t11a~layers');
    expect(switched).toBeGreaterThan(own + 50);
    // Cached apart: the document's own tiles are unchanged.
    expect(draw()).toBe(own);
  });
});
