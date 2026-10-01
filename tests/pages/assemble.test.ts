// M4-11: Extract/Merge build a new document in the Work worker (real PDFium
// here): pages in order, one bookmark per merged file at its first page, the
// output qpdf-clean and unencrypted; an encrypted source needs full access
// (M4-Q2); Insert from File imports pages through the Render operation.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { PdfDocumentObject } from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { OWNER_PW, USER_PW, qpdfEncrypt } from '../../e2e/fixtures/encrypted';
import { simplePdf } from '../../e2e/fixtures/generate';
import { sourcePages } from '../../src/features/pages/assemble';
import { PdfString, isDict } from '../../src/model/pdf/objects';
import { PdfReader } from '../../src/model/pdf/reader';
import { applyPageOp } from '../../src/workers/render/pages';
import { docPtrOf, rawCall } from '../../src/workers/render/pdfium';
import { assemble, fullAccess } from '../../src/workers/work/assemble';

const require = createRequire(import.meta.url);
const hasQpdf = spawnSync('qpdf', ['--version']).status === 0;
let mod: WrappedPdfiumModule;
let native: PdfiumNative;
let seq = 0;
const slice = { checkpoint: () => Promise.resolve(), signal: new AbortController().signal };

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
});

const open = (bytes: Uint8Array, password?: string): Promise<PdfDocumentObject> =>
  native
    .openDocumentBuffer(
      { id: `a${String(++seq)}`, content: bytes.slice().buffer },
      password === undefined ? {} : { password },
    )
    .toPromise();

/** Each page's first text ("Page n"). */
function texts(docId: string): string[] {
  const ptr = docPtrOf(native, docId);
  const heap = mod.pdfium as unknown as {
    wasmExports: { malloc(n: number): number; free(p: number): void };
    UTF16ToString(p: number): string;
  };
  return Array.from({ length: rawCall(mod, 'FPDF_GetPageCount', ptr) }, (_, i) => {
    const page = rawCall(mod, 'FPDF_LoadPage', ptr, i);
    const tp = rawCall(mod, 'FPDFText_LoadPage', page);
    const buf = heap.wasmExports.malloc(40);
    rawCall(mod, 'FPDFText_GetText', tp, 0, 6, buf);
    const s = heap.UTF16ToString(buf);
    heap.wasmExports.free(buf);
    rawCall(mod, 'FPDFText_ClosePage', tp);
    rawCall(mod, 'FPDF_ClosePage', page);
    return s;
  });
}

function qpdfOk(bytes: Uint8Array): boolean {
  if (!hasQpdf) return true;
  const f = join(mkdtempSync(join(tmpdir(), 'assemble-')), 'out.pdf');
  writeFileSync(f, bytes);
  return spawnSync('qpdf', ['--check', f]).status === 0;
}

describe('merge plan', () => {
  it('empty range = every page; a range picks and orders them', () => {
    expect(sourcePages({ pageCount: 3, range: '' })).toEqual({ ok: true, pages: [0, 1, 2] });
    expect(sourcePages({ pageCount: 5, range: '4, 1-2' })).toEqual({
      ok: true,
      pages: [3, 0, 1],
    });
    expect(sourcePages({ pageCount: 2, range: '5' }).ok).toBe(false);
  });
});

describe('assemble (Work worker)', () => {
  it('merges two files in order with one bookmark per file', async () => {
    const a = await open(simplePdf(3));
    const b = await open(simplePdf(2));
    const bytes = await assemble(
      mod,
      [
        { docPtr: docPtrOf(native, a.id), pages: [2, 0], title: 'First file' },
        { docPtr: docPtrOf(native, b.id), pages: [0, 1], title: 'Zweite Datei' },
      ],
      true,
      slice,
      () => undefined,
    );
    expect(qpdfOk(bytes)).toBe(true);
    const out = await open(bytes);
    expect(texts(out.id)).toEqual(['Page 3', 'Page 1', 'Page 1', 'Page 2']);
    // The outline: two top-level items pointing at pages 1 and 3.
    const r = await PdfReader.open(bytes);
    const pages = await r.pages();
    const cat = await r.resolve(r.trailer.get('Root'));
    const outlines = isDict(cat) ? await r.resolve(cat.get('Outlines')) : undefined;
    const titles: string[] = [];
    const dests: number[] = [];
    let item = isDict(outlines) ? await r.resolve(outlines.get('First')) : undefined;
    while (isDict(item)) {
      titles.push((item.get('Title') as PdfString).text());
      const dest = item.get('Dest');
      const ref = Array.isArray(dest) ? dest[0] : undefined;
      dests.push(pages.findIndex((p) => (ref as { num?: number } | undefined)?.num === p.num));
      item = await r.resolve(item.get('Next'));
    }
    expect(titles).toEqual(['First file', 'Zweite Datei']);
    expect(dests).toEqual([0, 2]);
    // EmbedPDF reads the bookmarks.
    const { bookmarks } = (await native.getBookmarks(out).toPromise()) as {
      bookmarks: { title: string }[];
    };
    expect(bookmarks.map((x) => x.title)).toEqual(['First file', 'Zweite Datei']);
    for (const d of [a, b, out]) await native.closeDocument(d).toPromise();
  });

  it('an encrypted source: only with full access (M4-Q2); the output is not encrypted', async () => {
    const enc = qpdfEncrypt(simplePdf(2), USER_PW, OWNER_PW, ['256', '--modify=none']);
    const user = await open(enc, USER_PW);
    expect(fullAccess(mod, docPtrOf(native, user.id))).toBe(false);
    const owner = await open(enc, OWNER_PW);
    expect(fullAccess(mod, docPtrOf(native, owner.id))).toBe(true);
    const bytes = await assemble(
      mod,
      [{ docPtr: docPtrOf(native, owner.id), pages: [1], title: 'x' }],
      false,
      slice,
      () => undefined,
    );
    expect(Buffer.from(bytes).toString('latin1')).not.toMatch(/\/Encrypt/);
    for (const d of [user, owner]) await native.closeDocument(d).toPromise();
  });
});

describe('Insert from File (Render operation)', () => {
  it('imports the chosen pages at the position, from an encrypted file with its owner password', async () => {
    const target = await open(simplePdf(2));
    const source = qpdfEncrypt(simplePdf(3), USER_PW, OWNER_PW, ['256', '--modify=none']);
    const noop = { signal: new AbortController().signal, progress: () => undefined };
    await expect(
      applyPageOp(
        mod,
        native,
        target.id,
        { kind: 'import', source: source.slice().buffer, password: USER_PW, pages: [0], at: 1 },
        noop,
      ),
    ).rejects.toThrow(/restricted/);
    const r = await applyPageOp(
      mod,
      native,
      target.id,
      { kind: 'import', source: source.slice().buffer, password: OWNER_PW, pages: [2, 1], at: 1 },
      noop,
    );
    expect(r.pages).toHaveLength(4);
    expect(texts(target.id)).toEqual(['Page 1', 'Page 3', 'Page 2', 'Page 2']);
    expect(r.map).toEqual([0, 3]);
    await native.closeDocument(target).toPromise();
  });
});
