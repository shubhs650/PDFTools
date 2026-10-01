// M4-09 (ADR-016 decisions 2, 3 and 5): page operations on real PDFium, saved
// with the semantic narrow tail — one revision, qpdf-clean, verified with the
// page-identity digest — on xref-table, object-stream, encrypted and signed
// originals; mixed with markups; undone by reopening from the snapshot,
// before and after a save (the disk overlay writes back what a save changed).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import {
  PdfAnnotationBorderStyle,
  PdfAnnotationSubtype,
  type PdfDocumentObject,
  type PdfSquareAnnoObject,
} from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { OWNER_PW, USER_PW, qpdfEncrypt } from '../../e2e/fixtures/encrypted';
import { simplePdf } from '../../e2e/fixtures/generate';
import { makeSigner, signedPdf } from '../../e2e/fixtures/signed';
import { findSignatures } from '../../src/model/signatures';
import { concatBytes } from '../../src/workers/render/save/bytes';
import { digestDocument } from '../../src/workers/render/save/digest';
import { applyPageOp, type PageOp } from '../../src/workers/render/pages';
import { docPtrOf, pageInfos, rawCall } from '../../src/workers/render/pdfium';
import { SaveTracker } from '../../src/workers/render/save/tracker';
import { compareDigests } from '../../src/workers/work/verifySave';

const require = createRequire(import.meta.url);
const hasQpdf = spawnSync('qpdf', ['--version']).status === 0;
const tmp = mkdtempSync(join(tmpdir(), 'pdftools-pages-'));

let mod: WrappedPdfiumModule;
let native: PdfiumNative;
let tracker: SaveTracker;
let seq = 0;

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
  tracker = new SaveTracker(mod, native);
});

async function open(bytes: Uint8Array, password?: string): Promise<PdfDocumentObject> {
  const id = `g${String(++seq)}`;
  const doc = await native
    .openDocumentBuffer(
      { id, content: bytes.slice().buffer },
      password === undefined ? {} : { password },
    )
    .toPromise();
  tracker.opened(id, bytes, password);
  await tracker.securityReady(id);
  return doc;
}

async function close(docId: string): Promise<void> {
  tracker.closed(docId);
  await native.closeDocument({ id: docId } as PdfDocumentObject).toPromise();
}

const noop = { signal: new AbortController().signal, progress: () => undefined };

/** What the Render worker does for a page operation. */
async function pageOp(docId: string, op: PageOp) {
  tracker.requireCapability(docId, 'assemble');
  const r = await applyPageOp(mod, native, docId, op, noop);
  tracker.pageOperation(docId, (old) => {
    const v = r.map[old];
    return v === undefined || v < 0 ? null : v;
  });
  return r;
}

async function square(docId: string, page: number, nm: string): Promise<void> {
  const a: PdfSquareAnnoObject = {
    id: nm,
    pageIndex: page,
    type: PdfAnnotationSubtype.SQUARE,
    rect: { origin: { x: 60, y: 60 }, size: { width: 80, height: 40 } },
    flags: ['print'],
    color: 'transparent',
    strokeColor: '#E44234',
    opacity: 1,
    strokeWidth: 2,
    strokeStyle: PdfAnnotationBorderStyle.SOLID,
  };
  const doc = { id: docId } as PdfDocumentObject;
  const pageObj = pageInfos(mod, native, docId)[page] as never;
  tracker.checkAllowed('createPageAnnotation', docId);
  await native.createPageAnnotation(doc, pageObj, a).toPromise();
  tracker.recordMutation('createPageAnnotation', [doc, pageObj, a]);
}

/** First text of each page, its rotation and object number (the page's identity). */
function identities(docId: string): string[] {
  const ptr = docPtrOf(native, docId);
  const n = rawCall(mod, 'FPDF_GetPageCount', ptr);
  return Array.from({ length: n }, (_, i) => {
    const page = rawCall(mod, 'FPDF_LoadPage', ptr, i);
    const tp = rawCall(mod, 'FPDFText_LoadPage', page);
    const chars = Math.min(8, rawCall(mod, 'FPDFText_CountChars', tp));
    const heap = mod.pdfium as unknown as {
      wasmExports: { malloc(n: number): number; free(p: number): void };
      UTF16ToString(p: number): string;
    };
    let text = '';
    if (chars > 0) {
      const buf = heap.wasmExports.malloc((chars + 1) * 2);
      rawCall(mod, 'FPDFText_GetText', tp, 0, chars, buf);
      text = heap.UTF16ToString(buf);
      heap.wasmExports.free(buf);
    }
    const out = `${text.trim()}|r${String(rawCall(mod, 'FPDFPage_GetRotation', page))}|a${String(rawCall(mod, 'FPDFPage_GetAnnotCount', page))}`;
    rawCall(mod, 'FPDFText_ClosePage', tp);
    rawCall(mod, 'FPDF_ClosePage', page);
    return out;
  });
}

function qpdfOk(bytes: Uint8Array, password?: string): boolean {
  if (!hasQpdf) return true;
  const file = join(tmp, `f${String(++seq)}.pdf`);
  writeFileSync(file, bytes);
  const pw = password === undefined ? [] : [`--password=${password}`];
  return spawnSync('qpdf', [...pw, '--check', file]).status === 0;
}

const revisions = (from: number, saved: Uint8Array): number =>
  (
    Buffer.from(saved.subarray(from))
      .toString('latin1')
      .match(/startxref/g) ?? []
  ).length;

/**
 * Ctrl+S as the save flow does it: the tracker's tail, verified by reopening
 * file + tail (the Work worker's check), then committed. Returns the new file.
 */
async function saveAndVerify(docId: string, file: Uint8Array, password?: string) {
  const r = await tracker.save(docId);
  const saved = concatBytes([file, r.tail]);
  expect(qpdfOk(saved, password)).toBe(true);
  expect(revisions(file.length, saved)).toBe(r.tail.length ? 1 : 0);
  const back = await native
    .openDocumentBuffer(
      { id: `v${String(++seq)}`, content: saved.slice().buffer },
      password === undefined ? {} : { password },
    )
    .toPromise();
  const expected = r.expected;
  if (!expected) throw new Error('no digest');
  const verify = compareDigests(expected, digestDocument(mod, native, back.id, 'all'));
  const pages = identitiesOf(back.id);
  await native.closeDocument(back).toPromise();
  tracker.commit(docId, r.tail.length);
  return { saved, verify, pages, tailBytes: r.tail.length };
}

const identitiesOf = (id: string) => identities(id);

const ORIGINALS: { name: string; bytes: () => Uint8Array; password?: string }[] = [
  { name: 'xref table', bytes: () => simplePdf(6) },
  {
    name: 'object streams',
    bytes: () => {
      const f = join(tmp, `in${String(++seq)}.pdf`);
      const o = join(tmp, `out${String(seq)}.pdf`);
      writeFileSync(f, simplePdf(6));
      spawnSync('qpdf', ['--object-streams=generate', f, o]);
      return new Uint8Array(readFileSync(o));
    },
  },
  {
    name: 'AES-256',
    bytes: () => qpdfEncrypt(simplePdf(6), USER_PW, OWNER_PW, ['256']),
    password: OWNER_PW,
  },
  {
    name: 'RC4-128',
    bytes: () => qpdfEncrypt(simplePdf(6), USER_PW, OWNER_PW, ['128', '--use-aes=n']),
    password: OWNER_PW,
  },
];

const OPS: { name: string; op: PageOp }[] = [
  { name: 'rotate p2 cw, p5 ccw', op: { kind: 'rotate', pages: [1], quarter: 1 } },
  { name: 'delete p3', op: { kind: 'delete', pages: [2] } },
  { name: 'delete p1 and p2', op: { kind: 'delete', pages: [0, 1] } },
  {
    name: 'insert 2 blank at the front',
    op: { kind: 'insertBlank', at: 0, count: 2, width: 595, height: 842 },
  },
  {
    name: 'insert blank at the end',
    op: { kind: 'insertBlank', at: 6, count: 1, width: 612, height: 792 },
  },
  { name: 'move p5, p6 to the front', op: { kind: 'move', pages: [4, 5], to: 0 } },
];

describe.skipIf(!hasQpdf)('page operations save as one narrow, verified revision', () => {
  for (const o of ORIGINALS)
    for (const { name, op } of OPS)
      it(`${o.name}: ${name}`, async () => {
        const file = o.bytes();
        const doc = await open(file, o.password);
        await pageOp(doc.id, op);
        const want = identities(doc.id);
        const r = await saveAndVerify(doc.id, file, o.password);
        expect(r.verify).toEqual({ ok: true });
        expect(r.pages).toEqual(want);
        // Small: the page tree, the pages touched, new pages — never the whole file.
        expect(r.tailBytes).toBeLessThan(6000);
        await close(doc.id);
      });

  it('a mix of markups and page operations, saved twice', async () => {
    const file = simplePdf(6);
    const doc = await open(file);
    await square(doc.id, 3, 'sq-before');
    await pageOp(doc.id, { kind: 'delete', pages: [0] });
    await square(doc.id, 2, 'sq-after');
    await pageOp(doc.id, { kind: 'rotate', pages: [2], quarter: 1 });
    const want = identities(doc.id);
    const first = await saveAndVerify(doc.id, file);
    expect(first.verify).toEqual({ ok: true });
    expect(first.pages).toEqual(want);
    expect(want[2]).toMatch(/\|r1\|a2$/);
    await pageOp(doc.id, { kind: 'insertBlank', at: 1, count: 1, width: 595, height: 842 });
    const want2 = identities(doc.id);
    const second = await saveAndVerify(doc.id, first.saved);
    expect(second.verify).toEqual({ ok: true });
    expect(second.pages).toEqual(want2);
    // Nothing changed since: Ctrl+S writes nothing.
    expect((await tracker.save(doc.id)).tail.length).toBe(0);
    await close(doc.id);
  });

  it('undo by reopening: before a save and after one', async () => {
    const file = simplePdf(6);
    const doc = await open(file);
    await square(doc.id, 1, 'sq-1');
    const before = identities(doc.id);
    const { token } = await tracker.takeSnapshot(doc.id);
    await pageOp(doc.id, { kind: 'delete', pages: [0, 1] });
    await pageOp(doc.id, { kind: 'rotate', pages: [0], quarter: 3 });
    // Saved with the pages deleted …
    const saved = await saveAndVerify(doc.id, file);
    expect(saved.verify).toEqual({ ok: true });
    expect(saved.pages).toHaveLength(4);
    // … then undone: the next save must bring them back on disk.
    await tracker.restore(doc.id, token);
    expect(identities(doc.id)).toEqual(before);
    const back = await saveAndVerify(doc.id, saved.saved);
    expect(back.verify).toEqual({ ok: true });
    expect(back.pages).toEqual(before);
    await close(doc.id);
  });

  it('undo before any save restores the document and saves nothing new', async () => {
    const file = simplePdf(4);
    const doc = await open(file);
    const before = identities(doc.id);
    const { token } = await tracker.takeSnapshot(doc.id);
    await pageOp(doc.id, { kind: 'move', pages: [3], to: 0 });
    expect(identities(doc.id)).not.toEqual(before);
    await tracker.restore(doc.id, token);
    expect(identities(doc.id)).toEqual(before);
    expect((await tracker.save(doc.id)).tail.length).toBe(0);
    await close(doc.id);
  });

  it('a signed original: narrow, verified, the signature listed once and unchanged', async () => {
    const file = await signedPdf(await makeSigner('Pages Signer'));
    const doc = await open(file);
    await pageOp(doc.id, { kind: 'insertBlank', at: 1, count: 1, width: 595, height: 842 });
    await pageOp(doc.id, { kind: 'rotate', pages: [0], quarter: 1 });
    const r = await saveAndVerify(doc.id, file);
    expect(r.verify).toEqual({ ok: true });
    const sigs = findSignatures(r.saved);
    expect(sigs).toHaveLength(1);
    expect(sigs[0]?.byteRange[0]).toBe(0);
    await close(doc.id);
  });

  it('the page-identity digest catches a save that lost the page order (negative control)', async () => {
    const file = simplePdf(4);
    const doc = await open(file);
    await pageOp(doc.id, { kind: 'move', pages: [3], to: 0 });
    const r = await tracker.save(doc.id);
    const expected = r.expected;
    if (!expected) throw new Error('no digest');
    // The original without the tail: same annotations, old order.
    const back = await native
      .openDocumentBuffer({ id: `n${String(++seq)}`, content: file.slice().buffer })
      .toPromise();
    const v = compareDigests(expected, digestDocument(mod, native, back.id, 'all'));
    await native.closeDocument(back).toPromise();
    expect(v).toEqual({ ok: false, reason: 'page-identity', page: 0 });
    await close(doc.id);
  });

  it('refuses the operations without the assemble permission (rule 9)', async () => {
    const file = qpdfEncrypt(simplePdf(3), USER_PW, OWNER_PW, ['256', '--modify=none']);
    const doc = await open(file, USER_PW);
    expect(() => {
      tracker.requireCapability(doc.id, 'assemble');
    }).toThrow(/does not allow/);
    await close(doc.id);
  });

  it('never deletes the last page', async () => {
    const doc = await open(simplePdf(2));
    await expect(pageOp(doc.id, { kind: 'delete', pages: [0, 1] })).rejects.toThrow(/last page/);
    await close(doc.id);
  });
});
