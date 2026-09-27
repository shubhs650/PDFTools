import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { PdfDocumentObject } from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { ANNOT_FILE_TEXT, attachmentsPdf } from '../../e2e/fixtures/generate';
import { listAttachments, readAttachment } from '../../src/workers/work/attachments';
import type { JobSlice } from '../../src/workers/work/scheduler';

// M2-11: embedded files, document-level and on FileAttachment annotations.

const require = createRequire(import.meta.url);
let mod: WrappedPdfiumModule;
let native: PdfiumNative;
let doc: PdfDocumentObject;
const BIG = 256 * 1024; // the e2e uses 20 MB; the mapping is the same

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
  doc = await native
    .openDocumentBuffer({ id: 'att', content: attachmentsPdf(BIG).slice().buffer })
    .toPromise();
});

const slice = (): JobSlice => ({
  signal: new AbortController().signal,
  checkpoint: () => Promise.resolve(),
});

describe('attachments', () => {
  it('lists 19 document-level files and 1 annotation file with metadata', async () => {
    const progress: number[] = [];
    const list = await listAttachments(mod, native, doc, slice(), (p) => progress.push(p.done));
    expect(list).toHaveLength(20);
    expect(progress).toEqual([1, 2]);
    const big = list.find((a) => a.name === 'big.bin');
    expect(big).toMatchObject({
      ref: { source: 'document' },
      description: 'Large binary',
      size: BIG,
    });
    const note = list.find((a) => a.name === 'note.txt');
    expect(note).toMatchObject({
      ref: { source: 'annotation', page: 0, annot: 0 },
      description: 'A note',
      size: ANNOT_FILE_TEXT.length,
      created: '2024-05-06T07:08:09.000Z',
    });
  });

  it('reads the bytes of both kinds', async () => {
    const list = await listAttachments(mod, native, doc, slice(), () => undefined);
    const inner = list.find((a) => a.name === 'inner.pdf');
    const note = list.find((a) => a.name === 'note.txt');
    if (!inner || !note) throw new Error('missing');
    const pdf = new Uint8Array(await readAttachment(mod, native, doc, inner.ref));
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-');
    const text = new TextDecoder().decode(await readAttachment(mod, native, doc, note.ref));
    expect(text).toBe(ANNOT_FILE_TEXT);
    await expect(
      readAttachment(mod, native, doc, { source: 'annotation', page: 1, annot: 0 }),
    ).rejects.toMatchObject({ code: 'attachment-missing' });
  });
});
