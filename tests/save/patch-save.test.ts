// M3-03 (ADR-007 decisions 1 and 5): keys our object layer stages (/Measure,
// /IT on an annotation; /VP on a page) are written in the single Ctrl+S
// revision, again whenever a later save rewrites the object, after Save
// Optimized, and are checked by the Work worker's reader. Real PDFium, the
// SaveTracker as the Render worker drives it, the S1 originals.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import {
  PdfAnnotationBorderStyle,
  PdfAnnotationSubtype,
  type PdfAnnotationObject,
  type PdfDocumentObject,
  type PdfLineAnnoObject,
} from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { RpcError } from '../../src/engine/errors';
import { D, N, S, isDict, nameOf, type PdfValue } from '../../src/model/pdf/objects';
import { PdfReader } from '../../src/model/pdf/reader';
import { concatBytes } from '../../src/workers/render/save/bytes';
import { SaveTracker } from '../../src/workers/render/save/tracker';
import { verifyObjects } from '../../src/workers/work/verifyObjects';

const require = createRequire(import.meta.url);
const DIR = 'e2e/fixtures/self-made/s1-interop';
const PLAIN = ['plain', 'annotated', 'form', 'objstm', 'signed'] as const;
const ENCRYPTED = ['encrypted-aes256', 'encrypted-rc4-128'] as const;

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

async function open(bytes: Uint8Array): Promise<PdfDocumentObject> {
  const id = `p${String(++seq)}`;
  const doc = await native.openDocumentBuffer({ id, content: bytes.slice().buffer }).toPromise();
  tracker.opened(id, bytes);
  return doc;
}

async function close(doc: PdfDocumentObject): Promise<void> {
  tracker.closed(doc.id);
  await native.closeDocument(doc).toPromise();
}

const line = (id: string, color = '#E44234'): PdfLineAnnoObject => ({
  id,
  pageIndex: 0,
  type: PdfAnnotationSubtype.LINE,
  rect: { origin: { x: 40, y: 90 }, size: { width: 120, height: 20 } },
  linePoints: { start: { x: 50, y: 100 }, end: { x: 150, y: 100 } },
  flags: ['print'],
  color,
  strokeColor: color,
  opacity: 1,
  strokeWidth: 2,
  strokeStyle: PdfAnnotationBorderStyle.SOLID,
});

/** What the executor does around a mutation: check, run, record. */
async function mutate(
  doc: PdfDocumentObject,
  method: 'createPageAnnotation' | 'updatePageAnnotation' | 'removePageAnnotation',
  annot: PdfLineAnnoObject,
): Promise<void> {
  const page = doc.pages[0];
  if (!page) throw new Error('no page');
  tracker.checkAllowed(method, doc.id);
  await native[method](doc, page, annot).toPromise();
  tracker.recordMutation(method, [doc, page, annot]);
}

const measure = (): PdfValue =>
  D({
    Type: N('Measure'),
    Subtype: N('RL'),
    R: S('1 mm = 100 mm'),
    X: [D({ Type: N('NumberFormat'), U: S('m'), C: 0.0352777778, D: 100 })],
    D: [D({ Type: N('NumberFormat'), U: S('m'), C: 1, D: 100 })],
    A: [D({ Type: N('NumberFormat'), U: S('m²'), C: 1, D: 100 })],
  });
const viewport = (): PdfValue => [
  D({ Type: N('Viewport'), BBox: [0, 0, 612, 792], Name: S('Sheet'), Measure: measure() }),
];

async function readBack(bytes: Uint8Array, id: string) {
  const r = await PdfReader.open(bytes);
  const [page] = await r.pages();
  if (!page) throw new Error('no page');
  const annots = await r.resolve(page.dict.get('Annots'));
  let annot: Map<string, PdfValue> | undefined;
  for (const ref of Array.isArray(annots) ? annots : []) {
    const a = await r.resolve(ref);
    if (isDict(a) && (a.get('NM') as { text?: () => string } | undefined)?.text?.() === id)
      annot = a;
  }
  return { page: page.dict, annot, reader: r };
}

/** Revisions appended after the original: one `startxref` each. */
const revisionsAfter = (o: Uint8Array, saved: Uint8Array): number =>
  (
    Buffer.from(saved.subarray(o.length))
      .toString('latin1')
      .match(/startxref/g) ?? []
  ).length;

const hasQpdf = spawnSync('qpdf', ['--version']).status === 0;
const tmp = mkdtempSync(join(tmpdir(), 'pdftools-patch-'));
function qpdfCheck(bytes: Uint8Array, name: string): number | null {
  const file = join(tmp, name);
  writeFileSync(file, bytes);
  return spawnSync('qpdf', ['--check', file]).status;
}

describe.each(PLAIN)('staged keys: %s', (name) => {
  it('one revision with the annotation, /Measure, /IT and page /VP; verified; sticky', async () => {
    const o = original(name);
    const doc = await open(o);
    await mutate(doc, 'createPageAnnotation', line('m3-03-a'));
    tracker.stagePatch(
      doc.id,
      { page: 0, annot: 'm3-03-a' },
      new Map([
        ['IT', N('LineDimension')],
        ['Measure', measure()],
      ]),
    );
    tracker.stagePatch(doc.id, { page: 0 }, new Map([['VP', viewport()]]));
    expect(tracker.dirtyState(doc.id).staged).toBe(2);

    const r = tracker.saveIncremental(doc.id);
    expect(r.mode).toBe('narrow');
    const saved = concatBytes([o, r.tail]);
    expect(revisionsAfter(o, saved)).toBe(1);
    expect(r.expected?.objects?.length).toBe(2);
    expect(await verifyObjects(r.expected?.objects ?? [], saved)).toEqual({ ok: true });
    if (hasQpdf) expect([0, 3]).toContain(qpdfCheck(saved, `${name}__patched.pdf`));

    const back = await readBack(saved, 'm3-03-a');
    expect(nameOf(back.annot?.get('IT'))).toBe('LineDimension');
    const m = back.annot?.get('Measure');
    expect(isDict(m) && nameOf(m.get('Subtype'))).toBe('RL');
    const x = isDict(m) ? (m.get('X') as Map<string, PdfValue>[])[0] : undefined;
    expect(x?.get('C')).toBe(0.0352777778);
    const vp = back.page.get('VP');
    expect(Array.isArray(vp) && vp.length).toBe(1);

    // PDFium still reads the annotation (geometry, appearance) normally.
    const reopened = await native
      .openDocumentBuffer({ id: `r${String(++seq)}`, content: saved.slice().buffer })
      .toPromise();
    const page0 = reopened.pages[0];
    if (!page0) throw new Error('no page');
    const annots = (await native
      .getPageAnnotations(reopened, page0)
      .toPromise()) as PdfAnnotationObject[];
    expect(annots.some((a) => a.id === 'm3-03-a' && a.type === PdfAnnotationSubtype.LINE)).toBe(
      true,
    );
    await native.closeDocument(reopened).toPromise();

    // Committed: nothing pending; a save without edits appends nothing.
    tracker.commit(doc.id, r.tail.length);
    expect(tracker.dirtyState(doc.id).staged).toBe(0);
    expect(tracker.saveIncremental(doc.id).tail.length).toBe(0);

    // A later colour change rewrites the annotation: our keys go with it.
    await mutate(doc, 'updatePageAnnotation', line('m3-03-a', '#1E88E5'));
    const r2 = tracker.saveIncremental(doc.id);
    const saved2 = concatBytes([saved, r2.tail]);
    expect(revisionsAfter(saved, saved2)).toBe(1);
    const back2 = await readBack(saved2, 'm3-03-a');
    expect(nameOf(back2.annot?.get('IT'))).toBe('LineDimension');
    expect(isDict(back2.annot?.get('Measure'))).toBe(true);
    // The page was not rewritten this time (the patch is clean): no second /VP copy needed.
    expect(r2.expected?.objects?.length).toBe(2);
    expect(await verifyObjects(r2.expected?.objects ?? [], saved2)).toEqual({ ok: true });
    if (hasQpdf) expect([0, 3]).toContain(qpdfCheck(saved2, `${name}__patched2.pdf`));
    await close(doc);
  });

  it('Save Optimized keeps the keys (PDFium never held them)', async () => {
    const o = original(name);
    const doc = await open(o);
    await mutate(doc, 'createPageAnnotation', line('m3-03-b'));
    tracker.stagePatch(doc.id, { page: 0, annot: 'm3-03-b' }, new Map([['Measure', measure()]]));
    tracker.stagePatch(doc.id, { page: 0 }, new Map([['VP', viewport()]]));
    const bytes = tracker.saveRewrite(doc.id);
    const back = await readBack(bytes, 'm3-03-b');
    expect(isDict(back.annot?.get('Measure'))).toBe(true);
    expect(Array.isArray(back.page.get('VP'))).toBe(true);
    if (hasQpdf) expect([0, 3]).toContain(qpdfCheck(bytes, `${name}__patched-rewrite.pdf`));
    // After it becomes the document's file, a Ctrl+S with no edits appends nothing.
    tracker.commit(doc.id, bytes.length, true);
    expect(tracker.saveIncremental(doc.id).tail.length).toBe(0);
    await close(doc);
  });
});

describe('staging rules', () => {
  it('removing a key (undo) writes the object without it', async () => {
    const o = original('plain');
    const doc = await open(o);
    await mutate(doc, 'createPageAnnotation', line('m3-03-c'));
    const target = { page: 0, annot: 'm3-03-c' };
    tracker.stagePatch(doc.id, target, new Map([['IT', N('LineDimension')]]));
    const r = tracker.saveIncremental(doc.id);
    const saved = concatBytes([o, r.tail]);
    tracker.commit(doc.id, r.tail.length);
    tracker.stagePatch(doc.id, target, new Map(), ['IT']);
    const r2 = tracker.saveIncremental(doc.id);
    expect(r2.tail.length).toBeGreaterThan(0);
    const saved2 = concatBytes([saved, r2.tail]);
    expect((await readBack(saved2, 'm3-03-c')).annot?.has('IT')).toBe(false);
    expect(await verifyObjects(r2.expected?.objects ?? [], saved2)).toEqual({ ok: true });
    await close(doc);
  });

  it('a deleted annotation drops out of the save; undoing the delete brings the keys back', async () => {
    const o = original('plain');
    const doc = await open(o);
    await mutate(doc, 'createPageAnnotation', line('m3-03-d'));
    tracker.stagePatch(doc.id, { page: 0, annot: 'm3-03-d' }, new Map([['Measure', measure()]]));
    await mutate(doc, 'removePageAnnotation', line('m3-03-d'));
    const r = tracker.saveIncremental(doc.id);
    expect(r.expected?.objects ?? []).toEqual([]);
    const saved = concatBytes([o, r.tail]);
    expect((await readBack(saved, 'm3-03-d')).annot).toBeUndefined();
    // Undo: EmbedPDF recreates it under the same id.
    await mutate(doc, 'createPageAnnotation', line('m3-03-d'));
    const r2 = tracker.saveIncremental(doc.id);
    expect(
      isDict((await readBack(concatBytes([o, r2.tail]), 'm3-03-d')).annot?.get('Measure')),
    ).toBe(true);
    await close(doc);
  });

  it('only measurement keys on annotations and /VP on pages', async () => {
    const doc = await open(original('plain'));
    const bad = (target: { page: number; annot?: string }, key: string) => {
      try {
        tracker.stagePatch(doc.id, target, new Map([[key, 1]]));
      } catch (e) {
        return e instanceof RpcError ? e.code : 'other';
      }
      return 'accepted';
    };
    expect(bad({ page: 0, annot: 'x' }, 'Contents')).toBe('patch-key');
    expect(bad({ page: 0, annot: 'x' }, 'Rect')).toBe('patch-key');
    expect(bad({ page: 0 }, 'Annots')).toBe('patch-key');
    expect(bad({ page: 0 }, 'Measure')).toBe('patch-key');
    expect(bad({ page: 3 }, 'VP')).toBe('patch-target');
    expect(bad({ page: 0 }, 'VP')).toBe('accepted');
    await close(doc);
  });

  it('crash-recovery snapshots carry staged keys', async () => {
    const o = original('plain');
    const doc = await open(o);
    tracker.stagePatch(doc.id, { page: 0 }, new Map([['VP', viewport()]]));
    const { tail } = tracker.snapshotTail(doc.id);
    expect(Array.isArray((await readBack(concatBytes([o, tail]), '')).page.get('VP'))).toBe(true);
    await close(doc);
  });

  it('verification fails when a staged object is missing from the file', async () => {
    const o = original('plain');
    const doc = await open(o);
    tracker.stagePatch(doc.id, { page: 0 }, new Map([['VP', viewport()]]));
    const r = tracker.saveIncremental(doc.id);
    const objects = r.expected?.objects ?? [];
    expect(objects.length).toBe(1);
    // The original without the tail: the page has no /VP.
    expect(await verifyObjects(objects, o)).toEqual({ ok: false, reason: 'objects' });
    // A different value.
    const other = objects.map((x) => ({ ...x, keys: { VP: 'different' } }));
    expect(await verifyObjects(other, concatBytes([o, r.tail]))).toEqual({
      ok: false,
      reason: 'objects',
    });
    await close(doc);
  });

  it('refuses edits the document forbids (rule 9)', async () => {
    const doc = await open(original('encrypted-noannotate'));
    expect(() => {
      tracker.stagePatch(doc.id, { page: 0 }, new Map([['VP', [1]]]));
    }).toThrow(expect.objectContaining({ code: 'pdfium:5' }) as Error);
    await close(doc);
  });
});

describe.each(ENCRYPTED)('encrypted file: %s', (name) => {
  it('refuses strings until M3-04, writes names and numbers', async () => {
    const o = original(name);
    const doc = await open(o);
    await mutate(doc, 'createPageAnnotation', line('m3-03-e'));
    const target = { page: 0, annot: 'm3-03-e' };
    expect(() => {
      tracker.stagePatch(doc.id, target, new Map([['Measure', measure()]]));
    }).toThrow(expect.objectContaining({ code: 'patch-encrypted' }) as Error);
    tracker.stagePatch(doc.id, target, new Map([['IT', N('LineDimension')]]));
    const r = tracker.saveIncremental(doc.id);
    const saved = concatBytes([o, r.tail]);
    expect(revisionsAfter(o, saved)).toBe(1);
    expect(await verifyObjects(r.expected?.objects ?? [], saved)).toEqual({ ok: true });
    if (hasQpdf) expect([0, 3]).toContain(qpdfCheck(saved, `${name}__patched.pdf`));
    // PDFium reopens it with the annotation intact.
    const reopened = await native
      .openDocumentBuffer({ id: `r${String(++seq)}`, content: saved.slice().buffer })
      .toPromise();
    const page0 = reopened.pages[0];
    if (!page0) throw new Error('no page');
    const annots = (await native
      .getPageAnnotations(reopened, page0)
      .toPromise()) as PdfAnnotationObject[];
    expect(annots.some((a) => a.id === 'm3-03-e')).toBe(true);
    await native.closeDocument(reopened).toPromise();
    await close(doc);
  });
});
