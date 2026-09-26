// M1-23: Save Optimized (full rewrite) and the re-base that lets Ctrl+S keep
// appending to the rewritten file. Real PDFium; qpdf when installed.
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
} from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { concatBytes } from '../../src/workers/render/save/bytes';
import { SaveTracker } from '../../src/workers/render/save/tracker';

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

const hasQpdf = spawnSync('qpdf', ['--version']).status === 0;
const tmp = mkdtempSync(join(tmpdir(), 'pdftools-opt-'));
function qpdfStatus(bytes: Uint8Array): number | null {
  const file = join(tmp, `f${String(++seq)}.pdf`);
  writeFileSync(file, bytes);
  return spawnSync('qpdf', ['--check', file]).status;
}

async function open(bytes: Uint8Array): Promise<PdfDocumentObject> {
  const id = `o${String(++seq)}`;
  const doc = await native.openDocumentBuffer({ id, content: bytes.slice().buffer }).toPromise();
  tracker.opened(id, bytes);
  return doc;
}

async function addSquare(doc: PdfDocumentObject, i: number): Promise<void> {
  const page = doc.pages[0];
  if (!page) throw new Error('no page');
  const a: PdfAnnotationObject = {
    id: `opt-${String(i)}`,
    pageIndex: 0,
    type: PdfAnnotationSubtype.SQUARE,
    rect: {
      origin: { x: 20 + (i % 12) * 30, y: 20 + Math.floor(i / 12) * 30 },
      size: { width: 20, height: 20 },
    },
    flags: ['print'],
    color: 'transparent',
    strokeColor: '#E44234',
    opacity: 1,
    strokeWidth: 2,
    strokeStyle: PdfAnnotationBorderStyle.SOLID,
  };
  await native.createPageAnnotation(doc, page, a).toPromise();
  tracker.recordMutation('createPageAnnotation', [doc, page, a]);
}

async function squares(bytes: Uint8Array): Promise<number> {
  const d = await native
    .openDocumentBuffer({ id: `c${String(++seq)}`, content: bytes.slice().buffer })
    .toPromise();
  const page = d.pages[0];
  if (!page) throw new Error('no page');
  const annots = (await native.getPageAnnotations(d, page).toPromise()) as PdfAnnotationObject[];
  await native.closeDocument(d).toPromise();
  return annots.filter((a) => a.type === PdfAnnotationSubtype.SQUARE).length;
}

const fixture = (name: string) =>
  new Uint8Array(readFileSync(`e2e/fixtures/self-made/s1-interop/original__${name}.pdf`));

describe.each(['plain', 'objstm', 'form', 'encrypted-aes256'])(
  'rewrite, re-base, append: %s',
  (name) => {
    it('Ctrl+S after Save Optimized appends a clean revision to the rewritten file', async () => {
      const o = fixture(name);
      const before = await squares(o);
      const doc = await open(o);
      await addSquare(doc, 0);
      const rewritten = tracker.saveRewrite(doc.id);
      expect(tracker.commit(doc.id, rewritten.length, true)).toBe(rewritten.length);
      expect(tracker.saveIncremental(doc.id).tail.length).toBe(0);
      await addSquare(doc, 1);
      const r = tracker.saveIncremental(doc.id);
      expect(r.baseLength).toBe(rewritten.length);
      const saved = concatBytes([rewritten, r.tail]);
      expect(await squares(saved)).toBe(before + 2);
      if (hasQpdf) {
        expect(qpdfStatus(rewritten)).toBe(0);
        expect(qpdfStatus(saved)).toBe(0);
      }
      await native.closeDocument(doc).toPromise();
    });
  },
);

describe('Save Optimized after repeated incremental saves', () => {
  it('is smaller than the grown file and keeps every annotation', async () => {
    const o = fixture('plain');
    const doc = await open(o);
    let file = o;
    for (let round = 0; round < 6; round++) {
      for (let i = 0; i < 5; i++) await addSquare(doc, round * 5 + i);
      const r = tracker.saveIncremental(doc.id, { keepAll: true });
      file = concatBytes([file, r.tail]);
      tracker.commit(doc.id, r.tail.length);
    }
    const rewritten = tracker.saveRewrite(doc.id);
    expect(rewritten.length).toBeLessThan(file.length);
    expect(await squares(rewritten)).toBe(30);
    if (hasQpdf) expect(qpdfStatus(rewritten)).toBe(0);
    await native.closeDocument(doc).toPromise();
  });

  it('a rewrite that is not committed changes nothing (Save As copy on the fallback path)', async () => {
    const doc = await open(fixture('plain'));
    await addSquare(doc, 0);
    tracker.saveRewrite(doc.id);
    const r = tracker.saveIncremental(doc.id);
    expect(r.tail.length).toBeGreaterThan(0);
    expect(() => tracker.commit(doc.id, r.tail.length, true)).toThrow();
    await native.closeDocument(doc).toPromise();
  });
});
