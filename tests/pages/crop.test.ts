// M11-08·O9 (D-55): Crop pages. The margins → /CropBox maths (pure), the
// Render worker's crop on real PDFium (what is shown moves by exactly the
// margins on pages turned 0°, 90°, 180° and 270°; crops add up; Remove Crop
// shows the whole sheet; too little left is refused), and the crop saved as
// one narrow, verified, qpdf-clean revision that other readers see.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { PdfDocumentObject } from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildPdf, simplePdf } from '../../e2e/fixtures/generate';
import { contentPages } from '../../src/features/pages/changed';
import {
  CROP_MIN_SIDE,
  croppedBox,
  isCropped,
  keptRect,
  marginsFit,
  marginsFromRect,
  marginsValid,
  marginToPoints,
  shownMargins,
  userInsets,
  visibleBox,
  type CropMargins,
} from '../../src/model/cropBox';
import { concatBytes } from '../../src/workers/render/save/bytes';
import { digestDocument } from '../../src/workers/render/save/digest';
import { SaveTracker } from '../../src/workers/render/save/tracker';
import { applyPageOp, type PageOp } from '../../src/workers/render/pages';
import { docPtrOf, pageInfos, rawCall } from '../../src/workers/render/pdfium';
import { compareDigests } from '../../src/workers/work/verifySave';

const require = createRequire(import.meta.url);
const hasQpdf = spawnSync('qpdf', ['--version']).status === 0;
const tmp = mkdtempSync(join(tmpdir(), 'pdftools-crop-'));
const MM = 72 / 25.4;

const M = (left: number, top: number, right: number, bottom: number): CropMargins => ({
  left,
  top,
  right,
  bottom,
});

describe('crop maths (pure)', () => {
  it('maps the margins as shown to the stored page’s sides for each /Rotate', () => {
    const m = M(1, 2, 3, 4);
    expect(userInsets(0, m)).toEqual(M(1, 2, 3, 4));
    // Turned 90° clockwise: the stored left edge is shown on top.
    expect(userInsets(1, m)).toEqual({ left: 2, top: 3, right: 4, bottom: 1 });
    expect(userInsets(2, m)).toEqual({ left: 3, top: 4, right: 1, bottom: 2 });
    expect(userInsets(3, m)).toEqual({ left: 4, top: 1, right: 2, bottom: 3 });
    expect(userInsets(-1, m)).toEqual(userInsets(3, m));
    // A drag on the stored page back to the margins as shown.
    for (const r of [0, 1, 2, 3]) expect(shownMargins(r, userInsets(r, m))).toEqual(m);
  });

  it('cuts the margins off the visible box; refuses too little left and bad margins', () => {
    const v = { left: 10, bottom: 20, right: 610, top: 820 };
    expect(croppedBox(v, 0, M(5, 10, 15, 20))).toEqual({
      left: 15,
      bottom: 40,
      right: 595,
      top: 810,
    });
    expect(croppedBox(v, 0, M(300, 0, 300 - CROP_MIN_SIDE, 0))).not.toBeNull();
    expect(croppedBox(v, 0, M(300, 0, 300 - CROP_MIN_SIDE + 0.5, 0))).toBeNull();
    expect(croppedBox(v, 0, M(-1, 0, 0, 0))).toBeNull();
    expect(croppedBox(v, 0, M(Number.NaN, 0, 0, 0))).toBeNull();
    expect(marginsValid(M(0, 0, 0, Number.POSITIVE_INFINITY))).toBe(false);
  });

  it('the visible box is the crop box inside the media box', () => {
    const media = { left: 0, bottom: 0, right: 600, top: 800 };
    expect(visibleBox(media, null)).toEqual(media);
    expect(visibleBox(media, { left: -10, bottom: 100, right: 300, top: 900 })).toEqual({
      left: 0,
      bottom: 100,
      right: 300,
      top: 800,
    });
    // No overlap: the media box, as PDFium does.
    expect(visibleBox(media, { left: 700, bottom: 0, right: 800, top: 10 })).toEqual(media);
    expect(isCropped(media, null)).toBe(false);
    expect(isCropped(media, { ...media })).toBe(false);
    expect(isCropped(media, { ...media, top: 700 })).toBe(true);
  });

  it('a drawn area gives the margins that keep it, clamped to the page', () => {
    const size = { width: 600, height: 800 };
    expect(marginsFromRect({ x: 50, y: 100, width: 400, height: 500 }, size)).toEqual(
      M(50, 100, 150, 200),
    );
    expect(marginsFromRect({ x: -20, y: -5, width: 700, height: 900 }, size)).toEqual(
      M(0, 0, 0, 0),
    );
    expect(keptRect(size, M(50, 100, 150, 200))).toEqual({
      x: 50,
      y: 100,
      width: 400,
      height: 500,
    });
    expect(marginsFit(size, M(300, 0, 297, 0))).toBe(true);
    expect(marginsFit(size, M(300, 0, 298, 0))).toBe(false);
  });

  it('margins typed in mm or inches; empty is 0; a comma works as the decimal sign', () => {
    expect(marginToPoints('25.4', 'mm')).toBeCloseTo(72, 6);
    expect(marginToPoints('0,5', 'in')).toBe(36);
    expect(marginToPoints(' ', 'mm')).toBe(0);
    expect(marginToPoints('-3', 'mm')).toBeNull();
    expect(marginToPoints('3 mm', 'mm')).toBeNull();
  });

  it('the cropped pages lose their cached text geometry (same size or not)', () => {
    expect(
      contentPages({ kind: 'op', op: { kind: 'crop', pages: [2, 0], margins: null } }),
    ).toEqual([2, 0]);
  });
});

// ---- real PDFium ----------------------------------------------------------------------

let mod: WrappedPdfiumModule;
let native: PdfiumNative;
let tracker: SaveTracker;
let seq = 0;

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
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

async function close(docId: string): Promise<void> {
  tracker.closed(docId);
  await native.closeDocument({ id: docId } as PdfDocumentObject).toPromise();
}

const noop = { signal: new AbortController().signal, progress: () => undefined };

/** As the Render worker runs it: modify checked, then the save tracker learns the change. */
async function pageOp(docId: string, op: PageOp) {
  tracker.requireCapability(docId, op.kind === 'crop' ? 'modify' : 'assemble');
  const r = await applyPageOp(mod, native, docId, op, noop);
  tracker.pageOperation(docId, (old) => {
    const v = r.map[old];
    return v === undefined || v < 0 ? null : v;
  });
  return r;
}

const heap = () =>
  mod.pdfium as unknown as {
    wasmExports: { malloc(n: number): number; free(p: number): void };
    getValue(ptr: number, type: 'i32'): number;
  };

/** Where user point (x, y) is shown on page `index`, in points from the shown top-left. */
function shownAt(docId: string, index: number, x: number, y: number): { x: number; y: number } {
  const info = pageInfos(mod, native, docId)[index];
  if (!info) throw new Error('no page');
  const doc = docPtrOf(native, docId);
  const page = rawCall(mod, 'FPDF_LoadPage', doc, index);
  const h = heap();
  const out = h.wasmExports.malloc(8);
  const K = 20; // device pixels per point: rounding stays below 0.05 pt
  try {
    rawCall(
      mod,
      'FPDF_PageToDevice',
      page,
      0,
      0,
      Math.round(info.size.width * K),
      Math.round(info.size.height * K),
      0,
      x,
      y,
      out,
      out + 4,
    );
    return { x: h.getValue(out, 'i32') / K, y: h.getValue(out + 4, 'i32') / K };
  } finally {
    h.wasmExports.free(out);
    rawCall(mod, 'FPDF_ClosePage', page);
  }
}

const sheet = (rotate: number, extra = '') =>
  `<< /Type /Page /Parent 2 0 R /MediaBox [10 20 610 820] /Rotate ${String(rotate)}${extra} >>`;

function fourTurns(): Uint8Array {
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R 6 0 R] /Count 4 >>',
    sheet(0),
    sheet(90),
    sheet(180),
    sheet(270),
  ]);
}

describe('crop on real PDFium', () => {
  it('what is shown moves by exactly the margins, on pages turned 0°, 90°, 180° and 270°', async () => {
    const doc = await open(fourTurns());
    const m = M(30, 50, 70, 110);
    const P = { x: 300, y: 400 };
    const before = [0, 1, 2, 3].map((i) => shownAt(doc.id, i, P.x, P.y));
    const sizes = pageInfos(mod, native, doc.id).map((p) => p.size);
    await pageOp(doc.id, { kind: 'crop', pages: [0, 1, 2, 3], margins: m });
    const after = pageInfos(mod, native, doc.id);
    for (const i of [0, 1, 2, 3]) {
      const was = before[i];
      const s = sizes[i];
      const now = after[i];
      if (!was || !s || !now) throw new Error('missing');
      const at = shownAt(doc.id, i, P.x, P.y);
      expect(at.x, `page ${String(i)} x`).toBeCloseTo(was.x - m.left, 1);
      expect(at.y, `page ${String(i)} y`).toBeCloseTo(was.y - m.top, 1);
      expect(now.size.width).toBeCloseTo(s.width - m.left - m.right, 3);
      expect(now.size.height).toBeCloseTo(s.height - m.top - m.bottom, 3);
    }
    await close(doc.id);
  });

  it('crops add up, Remove Crop shows the whole sheet, too little left is refused', async () => {
    const doc = await open(simplePdf(2));
    await pageOp(doc.id, { kind: 'crop', pages: [0], margins: M(10, 20, 30, 40) });
    await pageOp(doc.id, { kind: 'crop', pages: [0], margins: M(5, 5, 5, 5) });
    const [p0, p1] = pageInfos(mod, native, doc.id);
    expect(p0?.boxes).toMatchObject({ crop: { left: 15, top: 817, right: 560, bottom: 45 } });
    expect(p0?.size).toEqual({ width: 545, height: 772 });
    // Page 2 untouched.
    expect(p1?.size).toEqual({ width: 595, height: 842 });

    await pageOp(doc.id, { kind: 'crop', pages: [0], margins: null });
    expect(pageInfos(mod, native, doc.id)[0]?.boxes).toMatchObject({
      crop: { left: 0, top: 842, right: 595, bottom: 0 },
    });

    await expect(
      pageOp(doc.id, { kind: 'crop', pages: [1], margins: M(300, 0, 300, 0) }),
    ).rejects.toMatchObject({ code: 'crop-too-small' });
    await expect(
      pageOp(doc.id, { kind: 'crop', pages: [1], margins: M(-1, 0, 0, 0) }),
    ).rejects.toMatchObject({ code: 'crop-margins' });
    await expect(
      pageOp(doc.id, { kind: 'crop', pages: [5], margins: M(1, 0, 0, 0) }),
    ).rejects.toMatchObject({ code: 'pages-range' });
    await close(doc.id);
  });

  it('a crop box already in the file is cropped further, inside the media box', async () => {
    const bytes = buildPdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      // A crop box that pokes out of the media box: only the overlap is shown.
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /CropBox [-50 100 500 900] >>',
    ]);
    const doc = await open(bytes);
    expect(pageInfos(mod, native, doc.id)[0]?.size).toEqual({ width: 500, height: 700 });
    await pageOp(doc.id, { kind: 'crop', pages: [0], margins: M(10, 10, 10, 10) });
    expect(pageInfos(mod, native, doc.id)[0]?.boxes).toMatchObject({
      crop: { left: 10, top: 790, right: 490, bottom: 110 },
    });
    await close(doc.id);
  });
});

describe.skipIf(!hasQpdf)('a crop saves as one narrow, verified revision', () => {
  function qpdfOk(bytes: Uint8Array): boolean {
    const file = join(tmp, `f${String(++seq)}.pdf`);
    writeFileSync(file, bytes);
    return spawnSync('qpdf', ['--check', file]).status === 0;
  }

  async function saveAndReopen(docId: string, file: Uint8Array) {
    const r = await tracker.save(docId);
    const saved = concatBytes([file, r.tail]);
    expect(qpdfOk(saved)).toBe(true);
    const back = await native
      .openDocumentBuffer({ id: `v${String(++seq)}`, content: saved.slice().buffer }, {})
      .toPromise();
    if (!r.expected) throw new Error('no digest');
    const verify = compareDigests(r.expected, digestDocument(mod, native, back.id, 'all'));
    const pages = pageInfos(mod, native, back.id);
    await native.closeDocument(back).toPromise();
    tracker.commit(docId, r.tail.length);
    return { saved, verify, pages, tail: Buffer.from(r.tail).toString('latin1') };
  }

  it('the /CropBox is written for the cropped pages only; undo and save put it back', async () => {
    const file = simplePdf(3);
    const doc = await open(file);
    const { token } = await tracker.takeSnapshot(doc.id);
    await pageOp(doc.id, {
      kind: 'crop',
      pages: [0, 2],
      margins: M(20 * MM, 10 * MM, 20 * MM, 10 * MM),
    });
    const first = await saveAndReopen(doc.id, file);
    expect(first.verify).toEqual({ ok: true });
    expect(first.tail.match(/\/CropBox/g)).toHaveLength(2);
    // Content streams are not rewritten: only the page dictionaries.
    expect(first.tail).not.toMatch(/stream/);
    expect(first.pages.map((p) => Math.round(p.size.width))).toEqual([482, 595, 482]);

    // Undo (the snapshot) and save again: the pages show their whole sheets.
    await tracker.restore(doc.id, token);
    const back = await saveAndReopen(doc.id, first.saved);
    expect(back.verify).toEqual({ ok: true });
    expect(back.pages.map((p) => p.size)).toEqual([
      { width: 595, height: 842 },
      { width: 595, height: 842 },
      { width: 595, height: 842 },
    ]);
    await close(doc.id);
  });
});
