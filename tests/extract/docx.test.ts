// Word export (M4-07, §7.6, M4-Q6): Markdown → mdast → docx per node type, and
// a whole .docx from the extraction fixture on real PDF Oxide, unzipped and
// read back (document.xml): styles, lists, tables, images in reading order,
// markup-like PDF text kept as text.
import JSZip from 'jszip';
import * as nodeOxide from 'pdf-oxide-wasm';
import { describe, expect, it } from 'vitest';
import {
  extractionFixture,
  HOSTILE,
  IMAGE_PAGE,
  STRUCTURE,
} from '../../e2e/fixtures/extraction.ts';
import { buildDocx, parseMarkdown, type WordPage } from '../../src/workers/work/docxBuild';
import { extract } from '../../src/workers/work/extract';
import type { OxideDocument } from '../../src/workers/work/oxide';
import type { JobSlice } from '../../src/workers/work/scheduler';

const slice = { checkpoint: () => Promise.resolve() } as unknown as JobSlice;

async function documentXml(bytes: Uint8Array): Promise<{ xml: string; files: string[] }> {
  const zip = await JSZip.loadAsync(bytes);
  const xml = (await zip.file('word/document.xml')?.async('string')) ?? '';
  return { xml, files: Object.keys(zip.files) };
}
const md = (text: string): WordPage[] => [{ items: [{ kind: 'markdown', text }] }];
const para = (xml: string) => xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [];

describe('Markdown → Word mapping (M4-07)', () => {
  it('headings get Word heading styles', async () => {
    const { xml } = await documentXml(
      await buildDocx(md('# One\n\n### Three'), { title: 't', pageBreaks: false }),
    );
    expect(xml).toMatch(/<w:pStyle w:val="Heading1"\/>[\s\S]*One/);
    expect(xml).toMatch(/<w:pStyle w:val="Heading3"\/>[\s\S]*Three/);
  });

  it('bold, italic and code runs', async () => {
    const { xml } = await documentXml(
      await buildDocx(md('a **b** _c_ `d`'), { title: 't', pageBreaks: false }),
    );
    expect(xml).toMatch(/<w:b\/>[\s\S]*?<w:t[^>]*>b<\/w:t>/);
    expect(xml).toMatch(/<w:i\/>[\s\S]*?<w:t[^>]*>c<\/w:t>/);
    expect(xml).toMatch(/Consolas[\s\S]*?<w:t[^>]*>d<\/w:t>/);
  });

  it('bullet and numbered lists use Word numbering', async () => {
    const { xml } = await documentXml(
      await buildDocx(md('- a\n- b\n\n1. one\n2. two'), { title: 't', pageBreaks: false }),
    );
    expect((xml.match(/<w:numPr>/g) ?? []).length).toBe(4);
  });

  it('GFM tables become Word tables with a bold header row', async () => {
    const { xml } = await documentXml(
      await buildDocx(md('| A | B |\n| --- | --- |\n| 1 | 2 |'), { title: 't', pageBreaks: false }),
    );
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('<w:tblHeader/>');
    expect((xml.match(/<w:tc>/g) ?? []).length).toBe(4);
  });

  it('links keep only http(s)/mailto targets; raw HTML stays text', async () => {
    const page: WordPage[] = md('[ok](https://e.com) [bad](javascript:alert(1)) <b>x</b>');
    const bytes = await buildDocx(page, { title: 't', pageBreaks: false });
    const zip = await JSZip.loadAsync(bytes);
    const rels = (await zip.file('word/_rels/document.xml.rels')?.async('string')) ?? '';
    expect(rels).toContain('https://e.com');
    expect(rels).not.toContain('javascript:');
    const { xml } = await documentXml(bytes);
    expect(xml).toContain('&lt;b&gt;');
  });

  it('parses GFM tables (the extension is wired)', () => {
    expect(parseMarkdown('| a |\n| - |\n| 1 |').children[0]?.type).toBe('table');
  });
});

describe('Word export of the extraction fixture (M4-07, M4-Q6)', () => {
  const doc = (): OxideDocument =>
    new (
      nodeOxide as unknown as { WasmPdfDocument: new (d: Uint8Array) => OxideDocument }
    ).WasmPdfDocument(extractionFixture());
  const run = (pages: number[], pageBreaks = false) =>
    extract(
      doc(),
      pages,
      {
        format: 'word',
        images: true,
        pageBreaks,
        baseName: 'spec',
        title: 'Spec',
        lang: 'en',
        labels: {
          page: 'Page %P',
          image: 'Image %N on page %P',
          noText: 'Page %P has no text layer',
        },
      },
      slice,
      () => undefined,
    );

  it('heading → paragraph → image → paragraph, in page order; one .docx', async () => {
    const r = await run([3, 4]);
    expect(r.files.map((f) => f.path)).toEqual(['spec.docx']);
    const { xml, files } = await documentXml(r.files[0]?.data as Uint8Array);
    expect(files.some((f) => f.startsWith('word/media/'))).toBe(true);
    const ps = para(xml);
    const idx = (pred: (p: string) => boolean) => ps.findIndex(pred);
    const h1 = idx((p) => p.includes(STRUCTURE.h1));
    const before = idx((p) => p.includes(IMAGE_PAGE.before));
    const image = idx((p) => p.includes('<w:drawing>'));
    const after = idx((p) => p.includes(IMAGE_PAGE.after));
    expect(h1).toBeGreaterThanOrEqual(0);
    expect(h1).toBeLessThan(before);
    expect(before).toBeLessThan(image);
    expect(image).toBeLessThan(after);
    expect(xml).toContain('descr="Image 1 on page 5"');
    expect(r.images).toBe(1);
  });

  it('page breaks when asked; the no-text note for an empty page', async () => {
    const r = await run([4, 6], true);
    const { xml } = await documentXml(r.files[0]?.data as Uint8Array);
    expect(xml).toContain('<w:pageBreakBefore/>');
    expect(xml).toContain('Page 7 has no text layer');
  });

  it('markup-like PDF text is plain text in Word', async () => {
    const r = await run([5]);
    const { xml } = await documentXml(r.files[0]?.data as Uint8Array);
    expect(xml).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(xml).not.toContain('javascript:');
    expect(HOSTILE.length).toBe(3);
  });
});
