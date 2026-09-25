// M1-20 acceptance matrix (ADR-005): the 8 self-made S1 originals, saved with
// the Render worker's SaveTracker through real PDFium, narrow and rewrite.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import {
  PDF_FORM_FIELD_TYPE,
  PdfAnnotationBorderStyle,
  PdfAnnotationSubtype,
  type PdfAnnotationObject,
  type PdfDocumentObject,
} from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { beforeAll, describe, expect, it } from 'vitest';
import { RpcError } from '../../src/engine/errors';
import { concatBytes, isPrefix, signatureParts } from '../../src/workers/render/save/bytes';
import { SaveTracker } from '../../src/workers/render/save/tracker';
import {
  lastStartxref,
  newestTrailerDict,
  trailerIds,
  trailerRef,
  xrefKind,
} from '../../src/workers/render/save/xref';

const require = createRequire(import.meta.url);
const DIR = 'e2e/fixtures/self-made/s1-interop';
const INPUTS = [
  'plain',
  'annotated',
  'form',
  'objstm',
  'encrypted-aes256',
  'encrypted-rc4-128',
  'encrypted-noannotate',
  'signed',
] as const;

let mod: WrappedPdfiumModule;
let native: PdfiumNative;
let tracker: SaveTracker;
let seq = 0;

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
  tracker = new SaveTracker(mod, native);
});

const original = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(`${DIR}/original__${name}.pdf`));

/** Opens as the worker does: PDFium gets a copy, the tracker the opened bytes. */
async function open(bytes: Uint8Array): Promise<PdfDocumentObject> {
  const id = `m${String(++seq)}`;
  const doc = await native.openDocumentBuffer({ id, content: bytes.slice().buffer }).toPromise();
  tracker.opened(id, bytes);
  return doc;
}

async function close(doc: PdfDocumentObject): Promise<void> {
  tracker.closed(doc.id);
  await native.closeDocument(doc).toPromise();
}

const square = (i: number): PdfAnnotationObject => ({
  id: `m1-20-${String(i)}`,
  pageIndex: 0,
  author: 'PDFTools test',
  contents: `square ${String(i)}`,
  type: PdfAnnotationSubtype.SQUARE,
  rect: { origin: { x: 40 + 60 * i, y: 60 }, size: { width: 40, height: 40 } },
  flags: ['print'],
  color: 'transparent',
  strokeColor: '#E44234',
  opacity: 1,
  strokeWidth: 2,
  strokeStyle: PdfAnnotationBorderStyle.SOLID,
});

/** What the executor does for an annotation create: check, run, record. */
async function addSquare(doc: PdfDocumentObject, i: number): Promise<void> {
  const page = doc.pages[0];
  if (!page) throw new Error('no page');
  const annotation = square(i);
  tracker.checkAllowed('createPageAnnotation', doc.id);
  await native.createPageAnnotation(doc, page, annotation).toPromise();
  tracker.recordMutation('createPageAnnotation', [doc, page, annotation]);
}

/** Sets every text field to `text`; returns the field names. */
async function fillText(doc: PdfDocumentObject, text: string): Promise<string[]> {
  const page = doc.pages[0];
  if (!page) return [];
  const names: string[] = [];
  for (const w of await native.getPageAnnoWidgets(doc, page).toPromise()) {
    if (w.field.type !== PDF_FORM_FIELD_TYPE.TEXTFIELD) continue;
    tracker.checkAllowed('setFormFieldValue', doc.id);
    await native.setFormFieldValue(doc, page, w, { kind: 'text', text }).toPromise();
    tracker.recordMutation('setFormFieldValue', [doc, page, w]);
    names.push(w.field.name);
  }
  return names;
}

async function inspect(bytes: Uint8Array) {
  const doc = await native
    .openDocumentBuffer({ id: `r${String(++seq)}`, content: bytes.slice().buffer })
    .toPromise();
  const page = doc.pages[0];
  if (!page) throw new Error('no page');
  const annots = (await native.getPageAnnotations(doc, page).toPromise()) as PdfAnnotationObject[];
  const widgets = await native.getPageAnnoWidgets(doc, page).toPromise();
  await native.closeDocument(doc).toPromise();
  return {
    squares: annots.filter((a) => a.type === PdfAnnotationSubtype.SQUARE).length,
    form: Object.fromEntries(widgets.map((w) => [w.field.name, w.field.value])),
  };
}

const hasQpdf = spawnSync('qpdf', ['--version']).status === 0;
if (!hasQpdf) {
  console.warn(
    'qpdf not found: skipping `qpdf --check` in the save matrix (required in CI, M1-27)',
  );
}
const tmp = mkdtempSync(join(tmpdir(), 'pdftools-save-'));

/** `qpdf --check` (exit 0, or 3 = warnings only) and its encryption report. */
function qpdf(bytes: Uint8Array, name: string): { check: number | null; encryption: string } {
  const file = join(tmp, name);
  writeFileSync(file, bytes);
  const check = spawnSync('qpdf', ['--check', file]).status;
  const enc = spawnSync('qpdf', ['--show-encryption', file]).stdout.toString();
  const pick = (k: string) => new RegExp(`^${k}(?: =|:) (.*)$`, 'm').exec(enc)?.[1] ?? '';
  return {
    check,
    encryption: enc.includes('not encrypted')
      ? 'none'
      : `${pick('R')}/${pick('P')}/${pick('stream encryption method')}`,
  };
}

async function signatureVerifies(pdf: Uint8Array): Promise<boolean> {
  const parts = signatureParts(pdf);
  if (!parts) return false;
  const asn1 = asn1js.fromBER(parts.cms);
  const content = new pkijs.ContentInfo({ schema: asn1.result });
  const sd = new pkijs.SignedData({ schema: content.content });
  const r = await sd.verify({
    signer: 0,
    data: parts.signed.buffer,
    checkChain: false,
    extendedMode: true,
  });
  return r.signatureVerified === true;
}

/** First /ID element, normalized (hex strings are case-insensitive). */
const permanentId = (bytes: Uint8Array) => trailerIds(newestTrailerDict(bytes))?.[0].toLowerCase();
/** The permanent /ID must survive; a file without one gets one from PDFium. */
function expectPermanentId(saved: Uint8Array, o: Uint8Array): void {
  const id = permanentId(o);
  if (id === undefined) expect(permanentId(saved)).toMatch(/^<[0-9a-f]+>$/);
  else expect(permanentId(saved)).toBe(id);
}

describe.each(INPUTS)('save matrix: %s', (name) => {
  const noAnnotate = name === 'encrypted-noannotate';

  it(
    noAnnotate ? 'refuses edits (rule 9) and saves nothing' : 'narrow incremental save',
    async () => {
      const o = original(name);
      const before = await inspect(o);
      const doc = await open(o);
      if (noAnnotate) {
        await expect(addSquare(doc, 0)).rejects.toSatisfy(
          (e) => e instanceof RpcError && e.code === 'pdfium:5',
        );
        expect((await inspect(o)).squares).toBe(before.squares);
        expect(tracker.saveIncremental(doc.id).tail.length).toBe(0);
        await close(doc);
        return;
      }
      await addSquare(doc, 0);
      const fields = await fillText(doc, 'Saved by M1-20');
      if (name === 'form') expect(fields.length).toBeGreaterThan(0);
      const r = tracker.saveIncremental(doc.id);
      expect(r.mode).toBe('narrow');
      expect(r.tail.length).toBeGreaterThan(0);
      expect(r.baseLength).toBe(o.length);
      const saved = concatBytes([o, r.tail]);

      // Original bytes are an exact prefix; one revision linked by /Prev.
      expect(isPrefix(o, saved)).toBe(true);
      const trailer = newestTrailerDict(saved);
      expect(trailer).toMatch(/\/Prev\s+\d+/);
      expect(xrefKind(saved)).toBe(xrefKind(o));
      expectPermanentId(saved, o);
      expect(trailerRef(trailer, 'Encrypt')).toBe(trailerRef(newestTrailerDict(o), 'Encrypt'));

      const after = await inspect(saved);
      expect(after.squares).toBe(before.squares + 1);
      for (const f of fields) expect(after.form[f]).toBe('Saved by M1-20');

      if (name === 'signed') expect(await signatureVerifies(saved)).toBe(true);
      if (hasQpdf) {
        const q = qpdf(saved, `${name}__narrow.pdf`);
        expect([0, 3]).toContain(q.check);
        expect(q.encryption).toBe(qpdf(o, `${name}__original.pdf`).encryption);
      }

      // Commit; a second save without edits appends nothing, one with an edit
      // appends a revision to the committed file.
      expect(tracker.commit(doc.id, r.tail.length)).toBe(saved.length);
      expect(tracker.saveIncremental(doc.id).tail.length).toBe(0);
      await addSquare(doc, 1);
      const r2 = tracker.saveIncremental(doc.id);
      expect(r2.baseLength).toBe(saved.length);
      const saved2 = concatBytes([saved, r2.tail]);
      expect(newestTrailerDict(saved2)).toContain(`/Prev ${String(lastStartxref(saved))}`);
      expect((await inspect(saved2)).squares).toBe(before.squares + 2);
      if (hasQpdf) expect([0, 3]).toContain(qpdf(saved2, `${name}__narrow2.pdf`).check);
      await close(doc);
    },
  );

  it('rewrite (Save Optimized core)', async () => {
    const o = original(name);
    const before = await inspect(o);
    const doc = await open(o);
    if (!noAnnotate) await addSquare(doc, 0);
    const bytes = tracker.saveRewrite(doc.id);
    await close(doc);
    expect(isPrefix(o, bytes)).toBe(false);
    expect((await inspect(bytes)).squares).toBe(before.squares + (noAnnotate ? 0 : 1));
    expectPermanentId(bytes, o);
    if (hasQpdf) {
      const q = qpdf(bytes, `${name}__rewrite.pdf`);
      expect([0, 3]).toContain(q.check);
      expect(q.encryption).toBe(qpdf(o, `${name}__original.pdf`).encryption);
    }
  });
});
