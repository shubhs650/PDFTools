// The text, Markdown and HTML exports (M4-05, §7.6) on real PDF Oxide (Node
// build) and the self-made extraction fixture: content, image order (M4-Q6),
// inert output, the no-text note, and the files each format produces.
import { describe, expect, it } from 'vitest';
import * as nodeOxide from 'pdf-oxide-wasm';
import {
  extractionFixture,
  HOSTILE,
  IMAGE_PAGE,
  LATTICE,
  STRUCTURE,
} from '../../e2e/fixtures/extraction.ts';
import {
  extract,
  inertHtml,
  PAGE_BREAK,
  type ExtractFormat,
  type ExtractOptions,
} from '../../src/workers/work/extract';
import type { OxideDocument } from '../../src/workers/work/oxide';
import type { JobSlice } from '../../src/workers/work/scheduler';

const open = (): OxideDocument =>
  new (
    nodeOxide as unknown as { WasmPdfDocument: new (d: Uint8Array) => OxideDocument }
  ).WasmPdfDocument(extractionFixture());
const slice = { checkpoint: () => Promise.resolve() } as unknown as JobSlice;
const opts = (format: ExtractFormat, images = true): ExtractOptions => ({
  format,
  images,
  baseName: 'spec',
  title: 'Spec <A&B>',
  lang: 'en',
  labels: { page: 'Page %P', image: 'Image %N on page %P', noText: 'Page %P has no text layer' },
});
const run = (format: ExtractFormat, pages: number[], images = true) =>
  extract(open(), pages, opts(format, images), slice, () => undefined);
const main = async (format: ExtractFormat, pages: number[], images = true) =>
  String((await run(format, pages, images)).files[0]?.data);

describe('text export (M4-05)', () => {
  it('one form feed per page; a page without text says so', async () => {
    const text = await main('text', [3, 6]);
    const pages = text.split(PAGE_BREAK);
    expect(pages).toHaveLength(3); // two pages and the trailing empty piece
    expect(pages[0]).toContain(STRUCTURE.h1);
    expect(pages[1]?.trim()).toBe('Page 7 has no text layer');
  });
});

describe('Markdown export (M4-05)', () => {
  it('headings, lists and the lattice table as GFM', async () => {
    const md = await main('markdown', [0, 3]);
    expect(md).toContain('<!-- page 1 -->');
    expect(md).toMatch(new RegExp(`^#+ ${STRUCTURE.h1}`, 'm'));
    expect(md).toMatch(/^- Materials shall be certified/m);
    expect(md).toMatch(/^1\. Submit drawings/m);
    expect(md).toMatch(/\|\s*NPS\s*\|\s*OD mm\s*\|/);
    for (const row of LATTICE.rows) expect(md).toContain(row[1]);
  });

  it('puts the image between the two paragraphs, as a file beside the Markdown', async () => {
    const r = await run('markdown', [4]);
    const md = String(r.files[0]?.data);
    const at = (s: string) => md.indexOf(s);
    expect(r.images).toBe(1);
    expect(at(IMAGE_PAGE.before)).toBeLessThan(
      at('![Image 1 on page 5](images/page-5-image-1.png)'),
    );
    expect(at('![Image 1 on page 5]')).toBeLessThan(at(IMAGE_PAGE.after));
    expect(r.files.map((f) => f.path)).toEqual(['spec.md', 'images/page-5-image-1.png']);
    const png = r.files[1]?.data as Uint8Array;
    expect([...png.subarray(1, 4)].map((c) => String.fromCharCode(c)).join('')).toBe('PNG');
  });

  it('without images: one file, no image references', async () => {
    const r = await run('markdown', [4], false);
    expect(r.files).toHaveLength(1);
    expect(String(r.files[0]?.data)).not.toContain('![');
  });

  it('PDF text that looks like markup stays text', async () => {
    const md = await main('markdown', [5]);
    expect(md).not.toMatch(/<script|<img|\]\(javascript:/i);
    expect(md).toContain('&lt;script&gt;');
  });
});

describe('HTML export (M4-05)', () => {
  it('a self-contained page: CSP meta, no script, escaped title, one section per page', async () => {
    const html = await main('html', [3, 4]);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">`,
    );
    expect(html).toContain('<title>Spec &#60;A&#38;B&#62;</title>');
    expect(html).toContain('<section id="page-4" aria-label="Page 4">');
    expect(html).toContain('<section id="page-5" aria-label="Page 5">');
    expect(html).not.toMatch(/<script/i);
    expect(html).toMatch(/<h\d>[^<]*Section 1 Scope of Work/);
  });

  it('embeds the image between the paragraphs', async () => {
    const html = await main('html', [4]);
    const at = (s: string) => html.indexOf(s);
    const img = at('<figure><img src="data:image/png;base64,');
    expect(img).toBeGreaterThan(at(IMAGE_PAGE.before));
    expect(img).toBeLessThan(at(IMAGE_PAGE.after));
    expect(html).toContain(`alt="Image 1 on page 5" width="${String(IMAGE_PAGE.pixels[0])}"`);
  });

  it('PDF text that looks like markup is escaped', async () => {
    const html = await main('html', [5]);
    expect(html).not.toMatch(/<script>|<img src=x|onerror=/);
    for (const s of HOSTILE.slice(0, 1))
      expect(html).toContain(s.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  });

  it('inertHtml drops event handlers and unsafe targets from any markup', () => {
    expect(inertHtml('<a href="javascript:x()" onclick="y()">a</a><img src="x.png">')).toBe(
      '<a href="#">a</a><img src="#">',
    );
    expect(inertHtml('<a href="https://e.com">ok</a>')).toBe('<a href="https://e.com">ok</a>');
  });
});
