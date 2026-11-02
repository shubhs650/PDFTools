// Form field design keys (M6-14, ADR-022 decision 4, ADR-007): EmbedPDF writes
// a new field's name, flags and options but not its tooltip (/TU) or default
// (/DV), nor a page's tab order (/Tabs). Those are staged on our object layer,
// on the widget's field, and land in the one narrow Ctrl+S revision. Designing
// fields needs modify + annotate (rule 9).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import {
  PDF_FORM_FIELD_FLAG,
  PDF_FORM_FIELD_TYPE,
  PdfAnnotationSubtype,
  PdfStandardFont,
  type PdfDocumentObject,
  type PdfWidgetAnnoObject,
} from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { OWNER_PW, hasQpdf, qpdfEncrypt } from '../../e2e/fixtures/encrypted';
import { simplePdf } from '../../e2e/fixtures/generate';
import { N, PdfString, S, isDict, nameOf, type PdfValue } from '../../src/model/pdf/objects';
import { PdfReader } from '../../src/model/pdf/reader';
import { mergePatches, type Patch } from '../../src/workers/render/objects/patches';
import { concatBytes } from '../../src/workers/render/save/bytes';
import { SaveTracker } from '../../src/workers/render/save/tracker';
import { verifyObjects } from '../../src/workers/work/verifyObjects';

const require = createRequire(import.meta.url);
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
  const id = `f${String(++seq)}`;
  const doc = await native.openDocumentBuffer({ id, content: bytes.slice().buffer }).toPromise();
  tracker.opened(id, bytes);
  await tracker.securityReady(id);
  return doc;
}

async function close(doc: PdfDocumentObject): Promise<void> {
  tracker.closed(doc.id);
  await native.closeDocument(doc).toPromise();
}

const textField = (id: string, name: string): PdfWidgetAnnoObject => ({
  id,
  pageIndex: 0,
  type: PdfAnnotationSubtype.WIDGET,
  rect: { origin: { x: 72, y: 100 }, size: { width: 150, height: 24 } },
  fontFamily: PdfStandardFont.Helvetica,
  fontSize: 12,
  fontColor: '#000000',
  strokeColor: '#000000',
  color: '#FFFFFF',
  strokeWidth: 1,
  field: {
    flag: PDF_FORM_FIELD_FLAG.NONE,
    name,
    alternateName: '',
    value: '',
    type: PDF_FORM_FIELD_TYPE.TEXTFIELD,
  },
});

/** The executor's steps around a mutation: check, run, record. */
async function create(doc: PdfDocumentObject, w: PdfWidgetAnnoObject): Promise<void> {
  const page = doc.pages[0];
  if (!page) throw new Error('no page');
  tracker.checkAllowed('createPageAnnotation', doc.id, [doc, page, w]);
  await native.createPageAnnotation(doc, page, w).toPromise();
  tracker.recordMutation('createPageAnnotation', [doc, page, w]);
}

/** The field dictionary of the widget with /NM `id` (its /Parent, or itself when merged). */
async function fieldOf(bytes: Uint8Array, id: string) {
  const r = await PdfReader.open(bytes);
  const [page] = await r.pages();
  if (!page) throw new Error('no page');
  const annots = await r.resolve(page.dict.get('Annots'));
  for (const ref of Array.isArray(annots) ? annots : []) {
    const a = await r.resolve(ref);
    if (!isDict(a) || (a.get('NM') as PdfString | undefined)?.text() !== id) continue;
    const parent = await r.resolve(a.get('Parent'));
    return { field: isDict(parent) && parent.has('T') ? parent : a, page: page.dict };
  }
  return { field: undefined, page: page.dict };
}

const text = (v: PdfValue | undefined): string | undefined => (v as PdfString | undefined)?.text();

describe('field keys on a created field (real PDFium)', () => {
  it('/TU, /DV and /Tabs: one narrow revision, verified, sticky across a later edit', async () => {
    const o = simplePdf(1);
    const doc = await open(o);
    const w = textField('fld-1', 'customer');
    await create(doc, w);
    const target = { page: 0, annot: 'fld-1', field: true as const };
    tracker.stagePatch(doc.id, target, new Map<string, PdfValue>([['TU', S('Customer name')]]));
    tracker.stagePatch(doc.id, target, new Map<string, PdfValue>([['DV', S('n/a')]]));
    tracker.stagePatch(doc.id, { page: 0 }, new Map<string, PdfValue>([['Tabs', N('R')]]));
    const r = tracker.saveIncremental(doc.id);
    expect(r.mode).toBe('narrow');
    const saved = concatBytes([o, r.tail]);
    expect(await verifyObjects(r.expected?.objects ?? [], saved)).toEqual({ ok: true });
    const back = await fieldOf(saved, 'fld-1');
    expect(text(back.field?.get('T'))).toBe('customer');
    expect(text(back.field?.get('TU'))).toBe('Customer name');
    expect(text(back.field?.get('DV'))).toBe('n/a');
    expect(nameOf(back.page.get('Tabs'))).toBe('R');
    // No JavaScript is written (§7.10).
    expect(Buffer.from(r.tail).toString('latin1')).not.toMatch(/\/JavaScript|\/JS\b/);
    tracker.commit(doc.id, r.tail.length);

    // A later edit rewrites the field: the keys are applied again.
    const page = doc.pages[0];
    if (!page) throw new Error('no page');
    const moved = { ...w, rect: { origin: { x: 80, y: 120 }, size: w.rect.size } };
    tracker.checkAllowed('updatePageAnnotation', doc.id, [doc, page, moved]);
    await native.updatePageAnnotation(doc, page, moved).toPromise();
    tracker.recordMutation('updatePageAnnotation', [doc, page, moved]);
    const r2 = tracker.saveIncremental(doc.id);
    const saved2 = concatBytes([saved, r2.tail]);
    const back2 = await fieldOf(saved2, 'fld-1');
    expect(text(back2.field?.get('TU'))).toBe('Customer name');
    expect(text(back2.field?.get('DV'))).toBe('n/a');

    // Removing the tooltip writes the field without it.
    tracker.commit(doc.id, r2.tail.length);
    tracker.stagePatch(doc.id, target, new Map(), ['TU']);
    const r3 = tracker.saveIncremental(doc.id);
    const back3 = await fieldOf(concatBytes([saved2, r3.tail]), 'fld-1');
    expect(back3.field?.has('TU')).toBe(false);
    expect(text(back3.field?.get('DV'))).toBe('n/a');
    await close(doc);
  });

  it('only /TU and /DV on fields; /Tabs and /VP on pages', async () => {
    const doc = await open(simplePdf(1));
    const code = (target: { page: number; annot?: string; field?: true }, key: string) => {
      try {
        tracker.stagePatch(doc.id, target, new Map<string, PdfValue>([[key, 1]]));
        return 'accepted';
      } catch (e) {
        return (e as { code?: string }).code ?? 'other';
      }
    };
    expect(code({ page: 0, annot: 'x', field: true }, 'T')).toBe('patch-key');
    expect(code({ page: 0, annot: 'x', field: true }, 'V')).toBe('patch-key');
    expect(code({ page: 0, annot: 'x', field: true }, 'Measure')).toBe('patch-key');
    expect(code({ page: 0, annot: 'x' }, 'TU')).toBe('patch-key');
    expect(code({ page: 0 }, 'Tabs')).toBe('accepted');
    await close(doc);
  });
});

describe('mergePatches (a field that is also its widget)', () => {
  const p = (
    seq: number,
    set: [string, PdfValue][],
    remove: string[] = [],
    clean = true,
  ): Patch => ({
    target: { page: 0, annot: 'a' },
    set: new Map(set),
    remove: new Set(remove),
    seq,
    clean,
  });

  it('the later change wins, key by key', () => {
    const m = mergePatches(
      p(2, [['TU', S('new')]], ['DV']),
      p(1, [
        ['TU', S('old')],
        ['IT', N('X')],
      ]),
    );
    expect(text(m.set.get('TU'))).toBe('new');
    expect(nameOf(m.set.get('IT'))).toBe('X');
    expect([...m.remove]).toEqual(['DV']);
    expect(m.seq).toBe(2);
  });

  it('pending if either is', () => {
    expect(mergePatches(p(1, []), p(2, [], [], false)).clean).toBe(false);
    expect(mergePatches(p(1, []), p(2, [])).clean).toBe(true);
  });
});

describe.skipIf(!hasQpdf())('a document that allows annotating but not changes (rule 9)', () => {
  it('refuses creating fields and staging their keys; comments are still allowed', async () => {
    const locked = qpdfEncrypt(simplePdf(1), '', OWNER_PW, ['256', '--modify=annotate']);
    const doc = await open(locked);
    const page = doc.pages[0];
    if (!page) throw new Error('no page');
    const w = textField('fld-x', 'x');
    expect(() => {
      tracker.checkAllowed('createPageAnnotation', doc.id, [doc, page, w]);
    }).toThrow(expect.objectContaining({ code: 'pdfium:5' }) as Error);
    expect(() => {
      tracker.checkAllowed('renameWidgetField', doc.id, [doc, page, w, 'y']);
    }).toThrow(expect.objectContaining({ code: 'pdfium:5' }) as Error);
    expect(() => {
      tracker.stagePatch(doc.id, { page: 0, annot: 'a', field: true }, new Map([['TU', S('t')]]));
    }).toThrow(expect.objectContaining({ code: 'pdfium:5' }) as Error);
    expect(() => {
      tracker.stagePatch(doc.id, { page: 0 }, new Map([['Tabs', N('R')]]));
    }).toThrow(expect.objectContaining({ code: 'pdfium:5' }) as Error);
    // Markups and filling in are not form design.
    tracker.checkAllowed('createPageAnnotation', doc.id, [doc, page, { type: 9 }]);
    tracker.checkAllowed('setFormFieldValue', doc.id, [doc, page, w]);
    await close(doc);
  });
});
