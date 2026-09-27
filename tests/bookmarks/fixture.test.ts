import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import {
  PdfAnnotationSubtype,
  PdfZoomMode,
  type PdfAnnotationObject,
  type PdfBookmarkObject,
  type PdfLinkAnnoObject,
} from '@embedpdf/models';
import { init } from '@embedpdf/pdfium';
import { describe, expect, it } from 'vitest';
import { LINK_URL, outlinedPdf } from '../../e2e/fixtures/generate';
import { externalUrl, internalDestination } from '../../src/features/view/links';

// M2-10: the self-made outline/link fixture reads back as the engine sees it.

const require = createRequire(import.meta.url);

describe('outlinedPdf', () => {
  it('has a 500-entry, 3-level outline and three resolved links', async () => {
    const mod = await init({
      wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')),
    });
    const native = new PdfiumNative(mod, { fontFallback: null });
    const doc = await native
      .openDocumentBuffer({ id: 'o', content: outlinedPdf().slice().buffer })
      .toPromise();
    const { bookmarks } = (await native.getBookmarks(doc).toPromise()) as {
      bookmarks: PdfBookmarkObject[];
    };
    const count = (l: PdfBookmarkObject[]): number =>
      l.reduce((n, b) => n + 1 + count(b.children ?? []), 0);
    expect(count(bookmarks)).toBe(500);
    expect(bookmarks[1]?.children?.[2]?.children?.[0]?.title).toBe('Item 2.3.1');
    expect(internalDestination(bookmarks[1]?.children?.[2]?.target)?.pageIndex).toBe(11);

    const page = doc.pages[0];
    if (!page) throw new Error('no page');
    const annots = (await native
      .getPageAnnotations(doc, page)
      .toPromise()) as PdfAnnotationObject[];
    const links = annots
      .filter((a): a is PdfLinkAnnoObject => a.type === PdfAnnotationSubtype.LINK)
      .map((a) => a.target);
    expect(links.map((t) => internalDestination(t)?.pageIndex ?? externalUrl(t))).toEqual([
      29,
      2,
      LINK_URL,
    ]);
    expect(internalDestination(links[1])?.zoom.mode).toBe(PdfZoomMode.FitPage);
    await native.closeDocument(doc).toPromise();
  });
});
