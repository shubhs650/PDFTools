// M6-10 (ADR-021 D-38 d, ADR-022 decision 1): Attach File comments created and
// updated by direct PDFium calls in the Render worker, on real PDFium — the
// annotation's keys, EmbedPDF reading it back, the embedded file byte for
// byte, a move that redraws the paperclip, Ctrl+S's narrow verified tail and
// the size limit.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import {
  PdfAnnotationSubtype,
  type PdfAnnotationObject,
  type PdfDocumentObject,
} from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { simplePdf } from '../../e2e/fixtures/generate';
import { ATTACH_MAX_BYTES } from '../../src/model/attachFile';
import { readAnnotString } from '../../src/workers/render/annotTiles';
import {
  createFileAttachment,
  isFileAttachmentCall,
  readFileAttachment,
  updateFileAttachment,
} from '../../src/workers/render/fileAttach';
import { acquirePage, annotWriter, rawCall } from '../../src/workers/render/pdfium';
import { concatBytes } from '../../src/workers/render/save/bytes';
import { digestDocument } from '../../src/workers/render/save/digest';
import { SaveTracker } from '../../src/workers/render/save/tracker';
import { listAttachments, readAttachment } from '../../src/workers/work/attachments';
import { compareDigests } from '../../src/workers/work/verifySave';

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

async function open(bytes: Uint8Array, track = true): Promise<PdfDocumentObject> {
  const id = `a${String(++seq)}`;
  const doc = await native
    .openDocumentBuffer({ id, content: bytes.slice().buffer }, {})
    .toPromise();
  if (track) {
    tracker.opened(id, bytes);
    await tracker.securityReady(id);
  }
  return doc;
}

async function annots(doc: PdfDocumentObject): Promise<PdfAnnotationObject[]> {
  const page = doc.pages[0];
  if (!page) throw new Error('no page');
  return (await native.getPageAnnotations(doc, page).toPromise()) as PdfAnnotationObject[];
}

const FILE = new TextEncoder().encode('a,b\n1,2\n');
const slice = { signal: new AbortController().signal, checkpoint: () => Promise.resolve() };

function object(over: Partial<PdfAnnotationObject> = {}): PdfAnnotationObject {
  return {
    id: 'att-1',
    type: PdfAnnotationSubtype.FILEATTACHMENT,
    pageIndex: 0,
    rect: { origin: { x: 100, y: 100 }, size: { width: 20, height: 20 } },
    contents: 'calc-sheet.csv',
    author: 'Tester',
    flags: ['print'],
    strokeColor: '#0000FF',
    ...over,
  } as PdfAnnotationObject;
}

const ctxOf = (bytes: Uint8Array = FILE, name = 'calc-sheet.csv') => ({
  attachFile: { name, data: bytes.slice().buffer },
});

function attach(doc: PdfDocumentObject, obj = object(), ctx: unknown = ctxOf()): string {
  const args = [doc, doc.pages[0], obj, ctx];
  const id = createFileAttachment(mod, native, args);
  tracker.recordMutation('createPageAnnotation', args);
  return id;
}

/** A key of the page's annotation named `id`. */
function key(docId: string, id: string, k: string): string {
  const ref = acquirePage(native, docId, 0);
  try {
    const a = annotWriter(native).byName(ref.pagePtr, id);
    try {
      return readAnnotString(mod, a, k);
    } finally {
      rawCall(mod, 'FPDFPage_CloseAnnot', a);
    }
  } finally {
    ref.release();
  }
}

function rectOf(docId: string, id: string) {
  const ref = acquirePage(native, docId, 0);
  try {
    const w = annotWriter(native);
    const a = w.byName(ref.pagePtr, id);
    try {
      return w.readRect(a);
    } finally {
      rawCall(mod, 'FPDFPage_CloseAnnot', a);
    }
  } finally {
    ref.release();
  }
}

describe('Attach File in the Render worker (M6-10)', () => {
  it('answers only FileAttachment create and update calls', () => {
    const fa = object();
    expect(isFileAttachmentCall('createPageAnnotation', [{}, {}, fa])).toBe(true);
    expect(isFileAttachmentCall('updatePageAnnotation', [{}, {}, fa])).toBe(true);
    expect(isFileAttachmentCall('removePageAnnotation', [{}, {}, fa])).toBe(false);
    const note = { ...fa, type: PdfAnnotationSubtype.TEXT };
    expect(isFileAttachmentCall('createPageAnnotation', [{}, {}, note])).toBe(false);
  });

  it('creates a standard annotation EmbedPDF and the Attachments pane read back', async () => {
    const doc = await open(simplePdf(1));
    expect(attach(doc)).toBe('att-1');
    expect(key(doc.id, 'att-1', 'Contents')).toBe('calc-sheet.csv');
    expect(key(doc.id, 'att-1', 'T')).toBe('Tester');
    const list = (await annots(doc)).filter((a) => a.type === PdfAnnotationSubtype.FILEATTACHMENT);
    expect(list).toHaveLength(1);
    const [fa] = list;
    if (!fa) throw new Error('not listed');
    expect(fa).toMatchObject({ id: 'att-1', contents: 'calc-sheet.csv', author: 'Tester' });
    expect(fa.rect.origin.x).toBeCloseTo(100, 1);
    // Our own appearance, so it draws everywhere.
    expect(fa.appearanceModes ?? 0).toBeGreaterThan(0);
    const files = await listAttachments(mod, native, doc, slice, () => undefined);
    expect(files).toEqual([expect.objectContaining({ name: 'calc-sheet.csv', size: FILE.length })]);
    const read = readFileAttachment(mod, native, doc.id, 0, 'att-1');
    expect(read.name).toBe('calc-sheet.csv');
    expect(new Uint8Array(read.data)).toEqual(FILE);
    await native.closeDocument(doc).toPromise();
  });

  it('moves, recolours and edits it with its own update; the appearance follows', async () => {
    const doc = await open(simplePdf(1));
    attach(doc);
    const before = rectOf(doc.id, 'att-1');
    updateFileAttachment(mod, native, [
      doc,
      doc.pages[0],
      object({
        rect: { origin: { x: 300, y: 400 }, size: { width: 30, height: 30 } },
        strokeColor: '#00FF00',
        contents: 'Updated note',
      }),
    ]);
    const after = rectOf(doc.id, 'att-1');
    expect(after.left - before.left).toBeCloseTo(200, 1);
    expect(after.right - after.left).toBeCloseTo(30, 1);
    expect(key(doc.id, 'att-1', 'Contents')).toBe('Updated note');
    // The file is still there.
    expect(new Uint8Array(readFileAttachment(mod, native, doc.id, 0, 'att-1').data)).toEqual(FILE);
    expect(() => {
      updateFileAttachment(mod, native, [doc, doc.pages[0], object({ id: 'nope' })]);
    }).toThrow(/No such annotation/);
    await native.closeDocument(doc).toPromise();
  });

  it('Ctrl+S writes a narrow verified tail; the file reopens with the attachment', async () => {
    const original = simplePdf(2);
    const doc = await open(original);
    attach(doc);
    const s = await tracker.save(doc.id);
    expect(s.mode).toBe('narrow');
    expect(s.tail.length).toBeGreaterThan(0);
    const saved = concatBytes([original, s.tail]);
    const back = await open(saved, false);
    if (!s.expected) throw new Error('no digest');
    expect(compareDigests(s.expected, digestDocument(mod, native, back.id, 'all')).ok).toBe(true);
    const files = await listAttachments(mod, native, back, slice, () => undefined);
    expect(files).toHaveLength(1);
    const first = files[0];
    if (!first) throw new Error('no attachment');
    expect(new Uint8Array(await readAttachment(mod, native, back, first.ref))).toEqual(FILE);
    const text = Buffer.from(s.tail).toString('latin1');
    expect(text).toContain('/FileAttachment');
    expect(text).toContain('/Paperclip');
    expect(text).toMatch(/\/EF\s*<</);
    await native.closeDocument(back).toPromise();
    tracker.commit(doc.id, s.tail.length);
    await native.closeDocument(doc).toPromise();
  });

  it('a moved attachment still saves narrow (its new appearance in the tail)', async () => {
    const original = simplePdf(1);
    const doc = await open(original);
    attach(doc);
    const args = [
      doc,
      doc.pages[0],
      object({ rect: { origin: { x: 150, y: 120 }, size: { width: 20, height: 20 } } }),
    ];
    updateFileAttachment(mod, native, args);
    tracker.recordMutation('updatePageAnnotation', args);
    const s = await tracker.save(doc.id);
    expect(s.mode).toBe('narrow');
    const back = await open(concatBytes([original, s.tail]), false);
    if (!s.expected) throw new Error('no digest');
    expect(compareDigests(s.expected, digestDocument(mod, native, back.id, 'all')).ok).toBe(true);
    await native.closeDocument(back).toPromise();
    await native.closeDocument(doc).toPromise();
  });

  it('refuses a file over the limit and a call without a file', async () => {
    const doc = await open(simplePdf(1));
    const big = new Uint8Array(ATTACH_MAX_BYTES + 1);
    expect(() => attach(doc, object(), ctxOf(big))).toThrow(/larger than the limit/);
    expect(() => attach(doc, object(), null)).toThrow(/No file/);
    expect(await annots(doc)).toHaveLength(0);
    await native.closeDocument(doc).toPromise();
  });
});
