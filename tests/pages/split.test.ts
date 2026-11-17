// M11-08·O7 (D-55): Split Document. The plan (every N, ranges, top-level
// bookmarks), the file names, and the parts built by real PDFium as the Work
// worker builds them: each its pages in order, qpdf-clean and unencrypted.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { PdfActionType, PdfZoomMode, type PdfDocumentObject } from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { simplePdf } from '../../e2e/fixtures/generate';
import { RpcError } from '../../src/engine/errors';
import {
  SPLIT_MAX_PARTS,
  partNumber,
  rangeText,
  safeTitle,
  splitBookmarks,
  splitEvery,
  splitRanges,
  targetPage,
  uniqueNames,
} from '../../src/features/pages/splitPlan';
import { docPtrOf, rawCall } from '../../src/workers/render/pdfium';
import { splitDocument } from '../../src/workers/work/split';

const pagesOf = (r: ReturnType<typeof splitEvery>) => (r.ok ? r.parts.map((p) => p.pages) : r);

describe('split plan: every N pages', () => {
  it('cuts every N pages; the last file takes the rest', () => {
    expect(pagesOf(splitEvery(7, 3))).toEqual([[0, 1, 2], [3, 4, 5], [6]]);
    expect(pagesOf(splitEvery(4, 1))).toEqual([[0], [1], [2], [3]]);
    expect(pagesOf(splitEvery(4, 4))).toEqual([[0, 1, 2, 3]]);
  });

  it('refuses 0, fractions, more than the page count and NaN', () => {
    for (const n of [0, -1, 1.5, 5, Number.NaN])
      expect(splitEvery(4, n), String(n)).toEqual({ ok: false, error: 'every' });
  });

  it(`refuses more than ${String(SPLIT_MAX_PARTS)} files`, () => {
    expect(splitEvery(SPLIT_MAX_PARTS, 1).ok).toBe(true);
    expect(splitEvery(SPLIT_MAX_PARTS + 1, 1)).toEqual({ ok: false, error: 'tooMany' });
  });
});

describe('split plan: page ranges', () => {
  it('one file per comma or semicolon item; spaces and open ends allowed', () => {
    expect(pagesOf(splitRanges('1-2, 3 - 4; 6-', 7))).toEqual([
      [0, 1],
      [2, 3],
      [5, 6],
    ]);
    expect(pagesOf(splitRanges('5, -2', 6))).toEqual([[4], [0, 1]]);
    expect(pagesOf(splitRanges('3–1', 3))).toEqual([[2, 1, 0]]);
  });

  it('reports the print dialog range errors', () => {
    expect(splitRanges(' , ;', 5)).toEqual({ ok: false, error: 'empty' });
    expect(splitRanges('1-2, x', 5)).toEqual({ ok: false, error: 'syntax' });
    expect(splitRanges('1-2, 9', 5)).toEqual({ ok: false, error: 'outOfRange' });
  });
});

describe('split plan: top-level bookmarks', () => {
  it('each bookmark to the page before the next; earlier pages join the first', () => {
    const r = splitBookmarks(
      [
        { title: 'Intro', page: 2 },
        { title: 'Sections', page: 5 },
        { title: 'Appendix', page: 8 },
      ],
      10,
    );
    expect(r).toEqual({
      ok: true,
      parts: [
        { pages: [0, 1, 2, 3, 4], title: 'Intro' },
        { pages: [5, 6, 7], title: 'Sections' },
        { pages: [8, 9], title: 'Appendix' },
      ],
    });
  });

  it('goes in page order, skips bookmarks to nowhere, merges ones on the same page', () => {
    const r = splitBookmarks(
      [
        { title: 'B', page: 3 },
        { title: 'Web link', page: -1 },
        { title: 'A', page: 0 },
        { title: 'A again', page: 0 },
        { title: 'Past the end', page: 12 },
      ],
      5,
    );
    expect(r).toEqual({
      ok: true,
      parts: [
        { pages: [0, 1, 2], title: 'A' },
        { pages: [3, 4], title: 'B' },
      ],
    });
  });

  it('no usable bookmark: an error', () => {
    expect(splitBookmarks([], 3)).toEqual({ ok: false, error: 'noBookmarks' });
    expect(splitBookmarks([{ title: 'x', page: -1 }], 3)).toEqual({
      ok: false,
      error: 'noBookmarks',
    });
  });

  it('reads the page of a destination or a GoTo action, -1 for anything else', () => {
    const destination = { pageIndex: 4, zoom: { mode: PdfZoomMode.FitPage as const }, view: [] };
    expect(targetPage({ type: 'destination', destination })).toBe(4);
    expect(targetPage({ type: 'action', action: { type: PdfActionType.Goto, destination } })).toBe(
      4,
    );
    expect(
      targetPage({ type: 'action', action: { type: PdfActionType.URI, uri: 'https://x.test' } }),
    ).toBe(-1);
    expect(targetPage(undefined)).toBe(-1);
  });
});

describe('split names', () => {
  it('range text: runs of consecutive pages, 1-based', () => {
    expect(rangeText([0, 1, 2, 7])).toBe('1-3, 8');
    expect(rangeText([4])).toBe('5');
    expect(rangeText([2, 1, 0])).toBe('3, 2, 1');
    expect(rangeText([])).toBe('');
  });

  it('bookmark titles lose what a file system refuses, and are cut at 80 characters', () => {
    expect(safeTitle('Level 1: Plan / Section A?')).toBe('Level 1_ Plan _ Section A_');
    expect(safeTitle('  Notes\n\t2024.  ')).toBe('Notes 2024');
    expect(safeTitle('...')).toBe('');
    expect(Array.from(safeTitle('é'.repeat(200)))).toHaveLength(80);
  });

  it('numbers sort in order; names are unique within the split', () => {
    expect(partNumber(0, 3)).toBe('01');
    expect(partNumber(99, 120)).toBe('100');
    expect(partNumber(6, 120)).toBe('007');
    expect(uniqueNames(['a.pdf', 'A.pdf', 'a.pdf', 'b.pdf'])).toEqual([
      'a.pdf',
      'A (2).pdf',
      'a (3).pdf',
      'b.pdf',
    ]);
  });
});

// ---------------------------------------------------------------- real PDFium

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

const open = (bytes: Uint8Array): Promise<PdfDocumentObject> =>
  native.openDocumentBuffer({ id: `s${String(++seq)}`, content: bytes.slice().buffer }).toPromise();

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
  const f = join(mkdtempSync(join(tmpdir(), 'split-')), 'out.pdf');
  writeFileSync(f, bytes);
  return spawnSync('qpdf', ['--check', f]).status === 0;
}

describe('split parts (Work worker, real PDFium)', () => {
  it('builds one document per part with its pages, in order, with overall progress', async () => {
    const src = await open(simplePdf(7));
    const seen: { done: number; total: number }[] = [];
    const files = await splitDocument(
      mod,
      docPtrOf(native, src.id),
      [
        { pages: [0, 1, 2], name: 'a.pdf' },
        { pages: [5, 3], name: 'b.pdf' },
        { pages: [6], name: 'c.pdf' },
      ],
      slice,
      (p) => seen.push(p),
    );
    expect(files.map((f) => f.name)).toEqual(['a.pdf', 'b.pdf', 'c.pdf']);
    const got: string[][] = [];
    for (const f of files) {
      expect(qpdfOk(f.bytes)).toBe(true);
      const doc = await open(f.bytes);
      got.push(texts(doc.id));
      expect(rawCall(mod, 'FPDF_GetSecurityHandlerRevision', docPtrOf(native, doc.id))).toBe(-1);
      await native.closeDocument(doc).toPromise();
    }
    expect(got).toEqual([['Page 1', 'Page 2', 'Page 3'], ['Page 6', 'Page 4'], ['Page 7']]);
    expect(seen.at(-1)).toEqual({ done: 6, total: 6 });
    expect(seen.every((p, i) => i === 0 || p.done >= (seen[i - 1]?.done ?? 0))).toBe(true);
    await native.closeDocument(src).toPromise();
  });

  it('refuses an empty part', async () => {
    const src = await open(simplePdf(2));
    await expect(
      splitDocument(
        mod,
        docPtrOf(native, src.id),
        [{ pages: [], name: 'x.pdf' }],
        slice,
        () => undefined,
      ),
    ).rejects.toBeInstanceOf(RpcError);
    await native.closeDocument(src).toPromise();
  });

  it('stops between parts when cancelled', async () => {
    const src = await open(simplePdf(4));
    const ctl = new AbortController();
    let calls = 0;
    const cancelling = {
      signal: ctl.signal,
      checkpoint: () => {
        calls++;
        if (calls > 2) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
        return Promise.resolve();
      },
    };
    await expect(
      splitDocument(
        mod,
        docPtrOf(native, src.id),
        [
          { pages: [0], name: 'a.pdf' },
          { pages: [1], name: 'b.pdf' },
          { pages: [2], name: 'c.pdf' },
        ],
        cancelling,
        () => undefined,
      ),
    ).rejects.toThrow('Cancelled');
    await native.closeDocument(src).toPromise();
  });
});
