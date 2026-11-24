// Spike S32 (M13-03, D-69): the findings M13-05 builds on, on the PDFium WASM
// and EmbedPDF engine the app ships. Run with the app's unit tests.
/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/non-nullable-type-assertion-style -- WASM exports and test pages known to exist (spike code) */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { PdfDocumentObject, PdfPageObject, Rect } from '@embedpdf/models';
import { PdfAnnotationSubtype } from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { acquirePage } from '../../src/workers/render/pdfium';
import { SaveTracker } from '../../src/workers/render/save/tracker';
import { currentSection, openSharedCopy } from './copy';
import { PROBE, probePdf } from './fixtures';
import { differingPixels, inkAcrossH, inkAcrossV, renderWindow } from './pixels';
import { collectStrokes, restore, thin } from './thin';

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
  const id = `s32-${String(++seq)}`;
  const doc = await native
    .openDocumentBuffer({ id, content: bytes.slice().buffer }, { normalizeRotation: true })
    .toPromise();
  tracker.opened(id, bytes);
  await tracker.securityReady(id);
  return doc;
}

const square = (page: PdfPageObject) => ({
  id: 's32-square',
  type: PdfAnnotationSubtype.SQUARE,
  pageIndex: page.index,
  rect: { origin: { x: 100, y: 100 }, size: { width: 80, height: 40 } },
  strokeColor: '#E44234',
  color: 'transparent',
  strokeWidth: 3,
  opacity: 1,
  flags: ['print'],
  author: 'S32',
  created: new Date(Date.UTC(2026, 10, 24)),
  modified: new Date(Date.UTC(2026, 10, 24)),
});

/** Adds a square comment the way the executor does (check, run, record). */
async function comment(doc: PdfDocumentObject): Promise<void> {
  const page = doc.pages[0] as PdfPageObject;
  const sq = square(page);
  tracker.checkAllowed('createPageAnnotation', doc.id, [doc, page, sq]);
  await native.createPageAnnotation(doc, page, sq as never).toPromise();
  tracker.recordMutation('createPageAnnotation', [doc, page, sq]);
}

const TILE: Rect = { origin: { x: 0, y: 0 }, size: { width: 595, height: 842 } };

describe('S32: width 0 draws one device pixel', () => {
  it('page lines, a scaled line, a dash and lines in nested forms; fills, text and comments unchanged', async () => {
    const doc = await open(probePdf());
    const ref = acquirePage(native, doc.id, 0);
    try {
      const list = collectStrokes(mod, ref.pagePtr);
      expect(list.forms).toBe(2);
      expect(list.objects.length).toBe(8);
      for (const scale of [1, 4, 16]) {
        const at = (k: keyof typeof PROBE) =>
          renderWindow(mod, ref.pagePtr, 842, PROBE[k].x, PROBE[k].y, scale, { annots: true });
        const lines = ['page', 'scaledCtm', 'dashed', 'form', 'nested'] as const;
        const same = ['fillOnly', 'fillStrokeInside', 'strokedText', 'annot'] as const;
        const before = Object.fromEntries([...lines, ...same].map((k) => [k, at(k)]));
        const vBefore = inkAcrossV(at('vertical'));
        thin(mod, list);
        try {
          for (const k of lines) {
            expect(inkAcrossH(before[k]!)).toBeCloseTo(3 * scale, 0);
            expect(inkAcrossH(at(k))).toBeCloseTo(1, 1);
          }
          expect(vBefore).toBeCloseTo(3 * scale, 0);
          expect(inkAcrossV(at('vertical'))).toBeCloseTo(1, 1);
          for (const k of same) expect(differingPixels(before[k]!, at(k))).toBe(0);
        } finally {
          restore(mod, list);
        }
        for (const k of [...lines, ...same]) expect(differingPixels(before[k]!, at(k))).toBe(0);
      }
    } finally {
      ref.release();
    }
  });
});

describe('S32: why route a (toggle widths on the app’s own document) fails', () => {
  it('a comment edit after one thin tile rewrites the page content in Ctrl+S', async () => {
    const tail = async (toggle: boolean) => {
      const doc = await open(probePdf());
      const ref = acquirePage(native, doc.id, 0);
      try {
        if (toggle) {
          const list = collectStrokes(mod, ref.pagePtr);
          thin(mod, list);
          await native.renderPageRect(doc, doc.pages[0]!, TILE, { scaleFactor: 1 }).toPromise();
          restore(mod, list);
        }
      } finally {
        ref.release();
      }
      // EmbedPDF's createPageAnnotation calls FPDFPage_GenerateContent on the cached page.
      await comment(doc);
      return (await tracker.save(doc.id)).tail;
    };
    const plain = await tail(false);
    const toggled = await tail(true);
    expect(toggled.length).toBeGreaterThan(plain.length);
    expect(Buffer.from(toggled).equals(Buffer.from(plain))).toBe(false);
  });
});

describe('S32: route b, a view-only copy kept thin', () => {
  it('saves stay byte-identical, and the copy draws what the original draws', async () => {
    const bytes = probePdf();
    const run = async (viaCopy: boolean) => {
      const doc = await open(bytes);
      const page = doc.pages[0]!;
      let outOfSync = -1;
      if (viaCopy) {
        const copy = openSharedCopy(
          mod,
          native,
          doc,
          `${doc.id}-thin`,
          bytes.length,
          currentSection(mod, native, doc.id, bytes.length, bytes),
        );
        const ref = acquirePage(native, copy.doc.id, 0);
        const list = collectStrokes(mod, ref.pagePtr);
        thin(mod, list);
        const thinTile = await native
          .renderPageRect(copy.doc, copy.doc.pages[0]!, TILE, { scaleFactor: 2 })
          .toPromise();
        restore(mod, list);
        ref.release();
        const a = await native
          .renderPageRect(copy.doc, copy.doc.pages[0]!, TILE, { scaleFactor: 2 })
          .toPromise();
        const b = await native.renderPageRect(doc, page, TILE, { scaleFactor: 2 }).toPromise();
        outOfSync = 0;
        for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) outOfSync++;
        let thinDiff = 0;
        for (let i = 0; i < a.data.length; i++) if (a.data[i] !== thinTile.data[i]) thinDiff++;
        expect(thinDiff).toBeGreaterThan(0);
        await copy.close();
      }
      await comment(doc);
      const ctrlS = (await tracker.save(doc.id)).tail;
      const optimized = tracker.saveRewrite(doc.id);
      return { ctrlS, optimized, outOfSync };
    };
    const plain = await run(false);
    const copy = await run(true);
    expect(copy.outOfSync).toBe(0);
    expect(Buffer.from(copy.ctrlS).equals(Buffer.from(plain.ctrlS))).toBe(true);
    expect(Buffer.from(copy.optimized).equals(Buffer.from(plain.optimized))).toBe(true);
  });
});
