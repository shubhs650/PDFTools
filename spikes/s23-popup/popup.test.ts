// Spike S23 (M7-06, ADR-023 D-44): can a sticky note's pop-up window be saved
// as a standard /Popup annotation? Real PDFium, the SaveTracker as the Render
// worker drives it, our reader for what the saved file holds. Questions:
//  a. Acrobat's and PDF-XChange's /Popup objects (self-made in their layout)
//     survive our edits of the note and Ctrl+S, plain and encrypted;
//  b. we can write a /Popup (/Parent, /Rect, /Open) and the note's /Popup in
//     the narrow tail, also in encrypted files, and move it later;
//  c. PDFium lists it (subtype Popup, never a comment) without drawing it, on
//     screen or in print;
//  d. deleting the note can take its pop-up along.
// Result recorded in ADR-023 Evidence (S23). Runs with the unit tests.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import {
  PdfAnnotationSubtype,
  type PdfAnnotationObject,
  type PdfDocumentObject,
} from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildPdf, simplePdf } from '../../e2e/fixtures/generate';
import {
  isDict,
  PdfRef,
  PdfString,
  type PdfDict,
  type PdfValue,
} from '../../src/model/pdf/objects';
import { PdfReader } from '../../src/model/pdf/reader';
import { listNotePopups, placeNotePopup, removePopupOf } from '../../src/workers/render/notePopups';
import { docPtrOf, rawCall } from '../../src/workers/render/pdfium';
import { concatBytes } from '../../src/workers/render/save/bytes';
import { digestDocument } from '../../src/workers/render/save/digest';
import { SaveTracker } from '../../src/workers/render/save/tracker';
import { popupStates } from '../../src/workers/work/popups';
import { verifyObjects } from '../../src/workers/work/verifyObjects';
import { compareDigests } from '../../src/workers/work/verifySave';

const require = createRequire(import.meta.url);
let mod: WrappedPdfiumModule;
let native: PdfiumNative;
let tracker: SaveTracker;
let seq = 0;

const hasQpdf = spawnSync('qpdf', ['--version']).status === 0;
const tmp = mkdtempSync(join(tmpdir(), 'pdftools-s23-'));
const OWNER = 'owner-pw';

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
  tracker = new SaveTracker(mod, native);
});
const opened: PdfDocumentObject[] = [];
afterAll(async () => {
  for (const d of opened) await native.closeDocument(d).toPromise();
});

async function open(bytes: Uint8Array): Promise<PdfDocumentObject> {
  const id = `s23-${String(++seq)}`;
  const doc = await native
    .openDocumentBuffer({ id, content: bytes.slice().buffer }, {})
    .toPromise();
  tracker.opened(id, bytes);
  await tracker.securityReady(id);
  opened.push(doc);
  return doc;
}

const page0 = (doc: PdfDocumentObject) => {
  const p = doc.pages[0];
  if (!p) throw new Error('no page');
  return p;
};

const annotations = async (doc: PdfDocumentObject) =>
  (await native.getPageAnnotations(doc, page0(doc)).toPromise()) as PdfAnnotationObject[];

/** What the Render worker does around an executor call. */
async function exec(
  doc: PdfDocumentObject,
  method: 'createPageAnnotation' | 'updatePageAnnotation' | 'removePageAnnotation',
  annot: PdfAnnotationObject,
): Promise<void> {
  tracker.checkAllowed(method, doc.id);
  if (method === 'removePageAnnotation') removePopupOf(mod, native, doc.id, 0, annot.id);
  await native[method](doc, page0(doc), annot as never).toPromise();
  tracker.recordMutation(method, [doc, page0(doc), annot]);
}

/** What the Render worker's setNotePopup does: place it, record it, stage /Open. */
function setPopup(doc: PdfDocumentObject, noteId: string, rect: DeviceRectLike, open: boolean) {
  tracker.checkAllowed('updatePageAnnotation', doc.id);
  const r = placeNotePopup(mod, native, doc, page0(doc), noteId, rect);
  tracker.recordMutation('updatePageAnnotation', [doc, page0(doc), { id: noteId }]);
  tracker.recordMutation('updatePageAnnotation', [doc, page0(doc), { id: r.popupId }]);
  tracker.stagePatch(doc.id, { page: 0, annot: r.popupId }, new Map([['Open', open]]));
  return r;
}
interface DeviceRectLike {
  origin: { x: number; y: number };
  size: { width: number; height: number };
}

async function saveAndCheck(doc: PdfDocumentObject, base: Uint8Array, password?: string) {
  const s = await tracker.save(doc.id);
  const saved = concatBytes([base, s.tail]);
  tracker.commit(doc.id, s.tail.length);
  // Verified like the save flow: page digest, then our object layer's keys.
  const back = await native
    .openDocumentBuffer(
      { id: `s23-${String(++seq)}`, content: saved.slice().buffer },
      password === undefined ? {} : { password },
    )
    .toPromise();
  opened.push(back);
  if (s.expected) {
    expect(compareDigests(s.expected, digestDocument(mod, native, back.id, 'all')).ok).toBe(true);
    expect(await verifyObjects(s.expected.objects ?? [], saved, password)).toEqual({ ok: true });
  }
  return { saved, tail: s.tail, back };
}

async function reader(bytes: Uint8Array, password?: string): Promise<PdfReader> {
  return PdfReader.open(bytes, undefined, password === undefined ? {} : { password });
}

/** Page 1's annotations, resolved, with their object numbers. */
async function pageAnnots(r: PdfReader): Promise<{ num: number; dict: PdfDict }[]> {
  const [page] = await r.pages();
  const arr = await r.resolve(page?.dict.get('Annots'));
  const out: { num: number; dict: PdfDict }[] = [];
  for (const ref of Array.isArray(arr) ? arr : []) {
    const d = await r.resolve(ref);
    if (ref instanceof PdfRef && isDict(d)) out.push({ num: ref.num, dict: d });
  }
  return out;
}

const text = (v: PdfValue | undefined): string | undefined =>
  v instanceof PdfString ? v.text() : undefined;
const sub = (d: PdfDict): string | undefined => (d.get('Subtype') as { name?: string }).name;
const refNum = (v: PdfValue | undefined): number => (v instanceof PdfRef ? v.num : -1);

/** The pairs (note, pop-up) on page 1, from the saved file. */
async function pairs(bytes: Uint8Array, password?: string) {
  const r = await reader(bytes, password);
  const all = await pageAnnots(r);
  return all
    .filter((a) => sub(a.dict) === 'Text' && a.dict.has('Popup'))
    .map((note) => {
      const popup = all.find((a) => a.num === refNum(note.dict.get('Popup')));
      return {
        nm: text(note.dict.get('NM')),
        contents: text(note.dict.get('Contents')),
        popup: popup
          ? {
              subtype: sub(popup.dict),
              parentIsNote: refNum(popup.dict.get('Parent')) === note.num,
              rect: popup.dict.get('Rect') as number[],
              open: popup.dict.get('Open'),
              flags: popup.dict.get('F'),
              num: popup.num,
            }
          : null,
      };
    });
}

function qpdf(
  bytes: Uint8Array,
  name: string,
  args: string[],
): { status: number | null; out: Uint8Array } {
  const inFile = join(tmp, `${name}.in.pdf`);
  const outFile = join(tmp, `${name}.out.pdf`);
  writeFileSync(inFile, bytes);
  const r = spawnSync('qpdf', [...args, inFile, outFile]);
  return {
    status: r.status,
    out:
      r.status === 0 || r.status === 3 ? new Uint8Array(readFileSync(outFile)) : new Uint8Array(),
  };
}
function qpdfCheck(bytes: Uint8Array, name: string, password?: string): number | null {
  const file = join(tmp, `${name}.pdf`);
  writeFileSync(file, bytes);
  return spawnSync('qpdf', [...(password ? [`--password=${password}`] : []), '--check', file])
    .status;
}

/** Acrobat's layout: /Popup with /Parent, /Open, /F 28; the note has /Popup and /NM. */
const acrobatPdf = (): Uint8Array =>
  buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Annots [5 0 R 6 0 R] /Contents 4 0 R >>',
    { dict: '<< >>', stream: '' },
    '<< /Type /Annot /Subtype /Text /Rect [100 700 120 720] /P 3 0 R /Name /Comment /Contents (first\\rsecond) /T (Ana) /NM (acro-note) /Popup 6 0 R /C [1 1 0] /F 28 /M (D:20260101120000Z) >>',
    '<< /Type /Annot /Subtype /Popup /Rect [130 600 330 720] /P 3 0 R /Parent 5 0 R /Open true /F 28 >>',
  ]);

/** PDF-XChange's layout: the pop-up first in /Annots, /NM on both, /Open false, no /F. */
const xchangePdf = (): Uint8Array =>
  buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Annots [6 0 R 5 0 R] /Contents 4 0 R >>',
    { dict: '<< >>', stream: '' },
    '<< /Type /Annot /Subtype /Text /Rect [300 500 320 520] /Name /Note /Contents (x) /T (Bo) /NM (pxce-note) /Popup 6 0 R /C [1 0.8 0] /F 4 /CreationDate (D:20260102) >>',
    '<< /Type /Annot /Subtype /Popup /Rect [330 380 530 500] /Parent 5 0 R /Open false /NM (pxce-popup) >>',
  ]);

const noteObject = (id: string, contents: string): PdfAnnotationObject =>
  ({
    id,
    pageIndex: 0,
    type: PdfAnnotationSubtype.TEXT,
    rect: { origin: { x: 100, y: 100 }, size: { width: 20, height: 20 } },
    contents,
    color: '#FFFF00',
    strokeColor: '#FFFF00',
    opacity: 1,
    flags: ['print'],
    author: 'Tester',
    icon: 'Comment',
  }) as unknown as PdfAnnotationObject;

/** Non-white pixels inside a device rect of page 1 (FPDF_ANNOT, optionally printing). */
function inked(docId: string, rect: DeviceRectLike, printing: boolean): number {
  const doc = docPtrOf(native, docId);
  const page = rawCall(mod, 'FPDF_LoadPage', doc, 0);
  const w = 595;
  const h = 842;
  const bmp = rawCall(mod, 'FPDFBitmap_Create', w, h, 0);
  rawCall(mod, 'FPDFBitmap_FillRect', bmp, 0, 0, w, h, 0xffffffff);
  const FPDF_ANNOT = 0x01;
  const FPDF_PRINTING = 0x800;
  rawCall(
    mod,
    'FPDF_RenderPageBitmap',
    bmp,
    page,
    0,
    0,
    w,
    h,
    0,
    FPDF_ANNOT | (printing ? FPDF_PRINTING : 0),
  );
  const buf = rawCall(mod, 'FPDFBitmap_GetBuffer', bmp);
  const stride = rawCall(mod, 'FPDFBitmap_GetStride', bmp);
  const heap = (mod.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8;
  let n = 0;
  for (let y = Math.ceil(rect.origin.y); y < rect.origin.y + rect.size.height; y++)
    for (let x = Math.ceil(rect.origin.x); x < rect.origin.x + rect.size.width; x++) {
      const at = buf + y * stride + x * 4;
      if ((heap[at] ?? 255) < 250 || (heap[at + 1] ?? 255) < 250 || (heap[at + 2] ?? 255) < 250)
        n++;
    }
  rawCall(mod, 'FPDFBitmap_Destroy', bmp);
  rawCall(mod, 'FPDF_ClosePage', page);
  return n;
}

describe('S23 a: other viewers’ pop-ups survive our edits and Ctrl+S', () => {
  for (const [name, make, noteId, isOpen] of [
    ['Acrobat', acrobatPdf, 'acro-note', true],
    ['PDF-XChange', xchangePdf, 'pxce-note', false],
  ] as const) {
    it(`${name}: edit the note's text and move it; the pop-up keeps /Parent, /Rect, /Open`, async () => {
      const original = make();
      const before = await pairs(original);
      const doc = await open(original);
      const listed = await annotations(doc);
      // c: listed as a Popup annotation, never as a note.
      expect(listed.filter((a) => a.type === PdfAnnotationSubtype.POPUP)).toHaveLength(1);
      const note = listed.find((a) => a.id === noteId);
      if (!note) throw new Error('no note');
      await exec(doc, 'updatePageAnnotation', {
        ...note,
        contents: 'one\ntwo\nthree',
        rect: { ...note.rect, origin: { x: note.rect.origin.x + 30, y: note.rect.origin.y } },
      });
      const { saved, back } = await saveAndCheck(doc, original);
      const after = await pairs(saved);
      expect(after).toHaveLength(1);
      expect(after[0]?.contents).toBe('one\ntwo\nthree');
      expect(after[0]?.popup).toEqual({ ...before[0]?.popup, num: before[0]?.popup?.num });
      expect(after[0]?.popup?.open).toBe(isOpen);
      if (hasQpdf) expect([0, 3]).toContain(qpdfCheck(saved, `a-${name}`));
      // The Render worker lists it; the Work worker reads its /Open.
      const popups = listNotePopups(mod, native, back, page0(back));
      expect(popups.map((p) => p.noteId)).toEqual([noteId]);
      expect(
        await popupStates(
          await reader(saved),
          popups.map((p) => p.obj),
        ),
      ).toEqual([isOpen]);
    });
  }

  it.skipIf(!hasQpdf)('Acrobat file encrypted (AES-256, owner password only)', async () => {
    const enc = qpdf(acrobatPdf(), 'acro-enc', ['--encrypt', '', OWNER, '256', '--']).out;
    const doc = await open(enc);
    const note = (await annotations(doc)).find((a) => a.id === 'acro-note');
    if (!note) throw new Error('no note');
    await exec(doc, 'updatePageAnnotation', { ...note, contents: 'edited' });
    const { saved } = await saveAndCheck(doc, enc);
    const [p] = await pairs(saved);
    expect(p?.contents).toBe('edited');
    expect(p?.popup?.parentIsNote).toBe(true);
    expect(p?.popup?.open).toBe(true);
    expect([0, 3]).toContain(qpdfCheck(saved, 'acro-enc-saved'));
  });
});

describe('S23 b: we write the pop-up', () => {
  it('a new note: /Popup with /Parent, /Rect, /Open true, /F 24, in one narrow revision', async () => {
    const original = simplePdf(1);
    const doc = await open(original);
    await exec(doc, 'createPageAnnotation', noteObject('n1', 'a\nb\nc'));
    const rect = { origin: { x: 130, y: 100 }, size: { width: 200, height: 120 } };
    const r = setPopup(doc, 'n1', rect, true);
    expect(r.created).toBe(true);
    const { saved, tail, back } = await saveAndCheck(doc, original);
    expect(
      (
        Buffer.from(tail)
          .toString('latin1')
          .match(/startxref/g) ?? []
      ).length,
    ).toBe(1);
    const [p] = await pairs(saved);
    expect(p?.nm).toBe('n1');
    expect(p?.contents).toBe('a\nb\nc');
    expect(p?.popup).toMatchObject({
      subtype: 'Popup',
      parentIsNote: true,
      rect: [130, 622, 330, 742],
      open: true,
      flags: 24,
    });
    if (hasQpdf) expect([0, 3]).toContain(qpdfCheck(saved, 'b-new'));
    // Read back as written (device space, top-left origin).
    const popups = listNotePopups(mod, native, back, page0(back));
    expect(popups).toHaveLength(1);
    expect(popups[0]?.rect).toEqual(rect);
    expect(popups[0]?.popupId).toBe(r.popupId);
  });

  it('moving and closing it later rewrites only that pop-up', async () => {
    const original = simplePdf(1);
    const doc = await open(original);
    await exec(doc, 'createPageAnnotation', noteObject('n2', 'x'));
    setPopup(doc, 'n2', { origin: { x: 130, y: 100 }, size: { width: 200, height: 120 } }, true);
    const first = await saveAndCheck(doc, original);
    const r = setPopup(
      doc,
      'n2',
      { origin: { x: 300, y: 400 }, size: { width: 180, height: 90 } },
      false,
    );
    expect(r.created).toBe(false);
    const second = await saveAndCheck(doc, first.saved);
    const [p] = await pairs(second.saved);
    expect(p?.popup).toMatchObject({ rect: [300, 352, 480, 442], open: false, parentIsNote: true });
    // One pop-up only, the same object.
    expect(p?.popup?.num).toBe((await pairs(first.saved))[0]?.popup?.num);
    expect(
      (await pageAnnots(await reader(second.saved))).filter((a) => sub(a.dict) === 'Popup'),
    ).toHaveLength(1);
  });

  for (const name of ['encrypted-aes256', 'encrypted-rc4-128'] as const) {
    it(`encrypted (${name}): the pop-up's /NM is encrypted, /Open written, qpdf-clean`, async () => {
      const original = new Uint8Array(
        readFileSync(`e2e/fixtures/self-made/s1-interop/original__${name}.pdf`),
      );
      const doc = await open(original);
      await exec(doc, 'createPageAnnotation', noteObject('n3', 'secret line'));
      const r = setPopup(
        doc,
        'n3',
        { origin: { x: 130, y: 100 }, size: { width: 200, height: 120 } },
        true,
      );
      const { saved, tail } = await saveAndCheck(doc, original);
      expect(Buffer.from(tail).toString('latin1')).not.toContain(r.popupId);
      const [p] = await pairs(saved);
      expect(p?.popup).toMatchObject({ parentIsNote: true, open: true });
      expect(p?.contents).toBe('secret line');
      if (hasQpdf) expect([0, 3]).toContain(qpdfCheck(saved, `b-${name}`));
    });
  }
});

describe('S23 c: PDFium draws no pop-up', () => {
  it('neither our pop-up nor an open Acrobat one is drawn on screen or in print', async () => {
    const doc = await open(acrobatPdf());
    // The Acrobat pop-up at [130 600 330 720] → device top 122.
    const acro = { origin: { x: 131, y: 123 }, size: { width: 198, height: 118 } };
    expect(inked(doc.id, acro, false)).toBe(0);
    expect(inked(doc.id, acro, true)).toBe(0);
    const d2 = await open(simplePdf(1));
    await exec(d2, 'createPageAnnotation', noteObject('n4', 'text'));
    const rect = { origin: { x: 200, y: 300 }, size: { width: 200, height: 120 } };
    setPopup(d2, 'n4', rect, true);
    expect(inked(d2.id, rect, false)).toBe(0);
    expect(inked(d2.id, rect, true)).toBe(0);
  });
});

describe('S23 d: deleting the note', () => {
  it('takes its pop-up along (EmbedPDF alone leaves it pointing at the deleted note)', async () => {
    // EmbedPDF alone.
    const original = acrobatPdf();
    const alone = await open(original);
    const note = (await annotations(alone)).find((a) => a.id === 'acro-note');
    if (!note) throw new Error('no note');
    await native.removePageAnnotation(alone, page0(alone), note).toPromise();
    expect(listNotePopups(mod, native, alone, page0(alone))).toHaveLength(0);
    const ref = rawCall(mod, 'FPDF_LoadPage', docPtrOf(native, alone.id), 0);
    const left = rawCall(mod, 'FPDFPage_GetAnnotCount', ref);
    rawCall(mod, 'FPDF_ClosePage', ref);
    expect(left).toBe(1); // the orphan pop-up

    // Ours.
    const doc = await open(original);
    const n = (await annotations(doc)).find((a) => a.id === 'acro-note');
    if (!n) throw new Error('no note');
    await exec(doc, 'removePageAnnotation', n);
    const { saved } = await saveAndCheck(doc, original);
    expect(await pageAnnots(await reader(saved))).toHaveLength(0);
    if (hasQpdf) expect([0, 3]).toContain(qpdfCheck(saved, 'd-removed'));
  });
});
