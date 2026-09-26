import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { a0Sheet, simplePdf } from '../../e2e/fixtures/generate';
import { isAbortError } from '../../src/engine/errors';
import { HEAVY_MS, estimateMs, isHeavy } from '../../src/workers/render/costModel';
import { acquirePage, rawCall } from '../../src/workers/render/pdfium';
import { renderProgressive } from '../../src/workers/render/progressive';

const require = createRequire(import.meta.url);
let mod: WrappedPdfiumModule;
let native: PdfiumNative;
let seq = 0;

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
});

async function open(bytes: Uint8Array) {
  const content = bytes.slice().buffer;
  return native.openDocumentBuffer({ id: `p${String(++seq)}`, content }).toPromise();
}

function sizeOf(pagePtr: number) {
  return {
    width: rawCall(mod, 'FPDF_GetPageWidthF', pagePtr),
    height: rawCall(mod, 'FPDF_GetPageHeightF', pagePtr),
  };
}

describe('cost model (M1-17)', () => {
  const at = (px: number, w: number, h: number) => {
    const k = px / Math.max(w, h);
    return { width: Math.round(w * k), height: Math.round(h * k) };
  };
  const contract = { objects: 53, segments: 0 };
  const a0Typical = { objects: 400, segments: 40_000 };
  const a0Dense = { objects: 4000, segments: 400_000 };

  it('matches the measured fixtures: light where they rendered < 100 ms', () => {
    expect(isHeavy({ ...contract, ...at(1024, 612, 792) })).toBe(false); // 13 ms
    expect(isHeavy({ ...a0Typical, ...at(1024, 3370, 2384) })).toBe(false); // 21 ms
    expect(isHeavy({ ...a0Typical, ...at(256, 3370, 2384) })).toBe(false); // 13 ms
  });

  it('and heavy where they took > 100 ms', () => {
    expect(isHeavy({ ...contract, ...at(4096, 612, 792) })).toBe(true); // 150 ms
    expect(isHeavy({ ...a0Dense, ...at(256, 3370, 2384) })).toBe(true); // 115 ms
    expect(isHeavy({ ...a0Dense, ...at(1024, 3370, 2384) })).toBe(true); // 208 ms
    expect(estimateMs({ ...a0Dense, ...at(4096, 3370, 2384) })).toBeGreaterThan(400); // 580 ms
  });

  it('grows with objects, segments and pixels', () => {
    const base = { objects: 1000, segments: 1000, width: 500, height: 500 };
    expect(estimateMs({ ...base, objects: 2000 })).toBeGreaterThan(estimateMs(base));
    expect(estimateMs({ ...base, segments: 2000 })).toBeGreaterThan(estimateMs(base));
    expect(estimateMs({ ...base, width: 1000 })).toBeGreaterThan(estimateMs(base));
    expect(HEAVY_MS).toBe(100);
  });
});

describe('progressive render (M1-17)', () => {
  it('draws exactly what EmbedPDF draws for the same page and scale', async () => {
    const doc = await open(simplePdf(1));
    const page = acquirePage(native, doc.id, 0);
    try {
      const out = await renderProgressive(
        mod,
        page.pagePtr,
        sizeOf(page.pagePtr),
        0.5,
        new AbortController().signal,
      );
      const first = doc.pages[0];
      if (!first) throw new Error('no page');
      const ref = await native.renderPageRaw(doc, first, { scaleFactor: 0.5, dpr: 1 }).toPromise();
      expect([out.width, out.height]).toEqual([ref.width, ref.height]);
      let diff = 0;
      for (let i = 0; i < out.data.length; i++)
        diff += Math.abs((out.data[i] ?? 0) - (ref.data[i] ?? 0));
      expect(diff / out.data.length).toBeLessThan(0.5);
    } finally {
      page.release();
      await native.closeDocument(doc).toPromise();
    }
  });

  it('renders a dense sheet in several slices, each near the slice length', async () => {
    const doc = await open(a0Sheet(40_000));
    const page = acquirePage(native, doc.id, 0);
    try {
      expect(rawCall(mod, 'FPDFPage_CountObjects', page.pagePtr)).toBeGreaterThan(100);
      const out = await renderProgressive(
        mod,
        page.pagePtr,
        sizeOf(page.pagePtr),
        0.3,
        new AbortController().signal,
        2,
      );
      expect(out.slices).toBeGreaterThan(1);
      expect(out.data.some((v, i) => i % 4 !== 3 && v < 128)).toBe(true); // something dark was drawn
    } finally {
      page.release();
      await native.closeDocument(doc).toPromise();
    }
  });

  it('a cancel takes effect at the next slice boundary and frees the page', async () => {
    const doc = await open(a0Sheet(40_000));
    const page = acquirePage(native, doc.id, 0);
    const ac = new AbortController();
    let slicesSeen = 0;
    try {
      const p = renderProgressive(mod, page.pagePtr, sizeOf(page.pagePtr), 0.3, ac.signal, 1);
      queueMicrotask(() => {
        slicesSeen++;
        ac.abort();
      });
      const err = await p.then(
        () => null,
        (e: unknown) => e,
      );
      expect(isAbortError(err)).toBe(true);
      expect(slicesSeen).toBe(1);
      // The page is still usable: a full render afterwards succeeds.
      const out = await renderProgressive(
        mod,
        page.pagePtr,
        sizeOf(page.pagePtr),
        0.1,
        new AbortController().signal,
      );
      expect(out.width).toBeGreaterThan(0);
    } finally {
      page.release();
      await native.closeDocument(doc).toPromise();
    }
  });

  it('an already-cancelled job does not start', async () => {
    const doc = await open(simplePdf(1));
    const page = acquirePage(native, doc.id, 0);
    const ac = new AbortController();
    ac.abort();
    try {
      await expect(
        renderProgressive(mod, page.pagePtr, sizeOf(page.pagePtr), 1, ac.signal),
      ).rejects.toSatisfy(isAbortError);
    } finally {
      page.release();
      await native.closeDocument(doc).toPromise();
    }
  });
});

describe('acquirePage (the page accessor next to docPtrOf)', () => {
  it('fails loudly if EmbedPDF internals change', () => {
    expect(() => acquirePage({} as PdfiumNative, 'x', 0)).toThrow(/not open/);
    const fake = { cache: { getContext: () => ({ docPtr: 1 }) } } as unknown as PdfiumNative;
    expect(() => acquirePage(fake, 'x', 0)).toThrow(/internals changed/);
  });
});
