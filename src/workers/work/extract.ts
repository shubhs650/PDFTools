// Extraction jobs over PDF Oxide (M4-04, M4-05, §7.6): plain text, Markdown
// (optionally with its images as files beside it) and a self-contained HTML
// file. One page per step, with a checkpoint between pages (cancel, and room
// for interactive jobs, rule 2) and progress in pages. Everything is built
// here, so the main thread only receives Blob handles (rule 1). Images go
// where they sit on the page (imagePlacement.ts, M4-Q6). User-visible words
// inside the files (alt text, page labels, the no-text note) come from the
// main thread already translated (rule 11).
import {
  blockTops,
  placeImages,
  splitHtmlBlocks,
  splitMarkdownBlocks,
  type ImageBox,
  type LineBox,
} from './imagePlacement';
import { inertMarkdown } from './markdownSafe';
import { toPlain, type OxideDocument } from './oxide';
import type { JobSlice } from './scheduler';

export type ExtractFormat = 'text' | 'markdown' | 'html';

/** Templates with %P (page number) and %N (image number), translated by the caller. */
export interface ExportLabels {
  page: string;
  image: string;
  noText: string;
}

export interface ExtractOptions {
  format: ExtractFormat;
  /** Markdown: images as files beside it; HTML: images embedded. Ignored for text. */
  images: boolean;
  /** File name without extension, for the main file and the image folder. */
  baseName: string;
  /** HTML <title>. */
  title: string;
  /** BCP 47 tag of the UI language, for <html lang>. */
  lang: string;
  labels: ExportLabels;
}

export interface ExportFile {
  /** Path inside the output folder or archive ("report.md", "images/page-1-image-1.png"). */
  path: string;
  data: Uint8Array | string;
  type: string;
}

export interface ExtractResult {
  files: ExportFile[];
  pages: number;
  chars: number;
  images: number;
}

/** Page separator of the plain-text export: a form feed at each page end (as pdftotext). */
export const PAGE_BREAK = '\f';
/** Images smaller than this in either dimension (pixels) are rules, dots and bullets: skipped. */
export const MIN_IMAGE_PX = 16;

const fill = (tpl: string, page: number, n = 0): string =>
  tpl.replace(/%P/g, String(page)).replace(/%N/g, String(n));

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`);

interface PageImage {
  box: ImageBox<number>;
  png: Uint8Array;
  width: number;
  height: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A page's images with their boxes (PDF space, y up) and PNG bytes, small ones dropped. */
export function pageImages(doc: OxideDocument, page: number): PageImage[] {
  const boxes = toPlain(doc.extractImages(page)) as { bbox?: Box; width: number; height: number }[];
  const bytes = toPlain(doc.extractImageBytes(page)) as {
    width: number;
    height: number;
    data: Uint8Array;
  }[];
  const out: PageImage[] = [];
  let b = 0;
  for (const [i, img] of bytes.entries()) {
    // The two lists come in the same order; if one skipped an image, match by pixel size.
    let box = boxes[i];
    if (box?.width !== img.width || box.height !== img.height) {
      while (b < boxes.length && (boxes[b]?.width !== img.width || boxes[b]?.height !== img.height))
        b++;
      box = boxes[b];
    }
    b++;
    if (!box?.bbox || img.width < MIN_IMAGE_PX || img.height < MIN_IMAGE_PX) continue;
    out.push({
      box: { top: box.bbox.y + box.bbox.height, left: box.bbox.x, ref: out.length },
      png: img.data,
      width: img.width,
      height: img.height,
    });
  }
  return out;
}

function lineBoxes(doc: OxideDocument, page: number): LineBox[] {
  const lines = toPlain(doc.extractTextLines(page)) as { text: string; bbox: Box }[];
  return lines.map((l) => ({ text: l.text, top: l.bbox.y + l.bbox.height }));
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Oxide escapes text; its own attributes are kept to safe targets anyway. */
export function inertHtml(fragment: string): string {
  return fragment
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(href|src)\s*=\s*"(?!https?:|mailto:|#)[^"]*"/gi, ' $1="#"');
}

/** The HTML export's page: every file is self-contained and runs no script. */
export function htmlDocument(title: string, lang: string, sections: string[]): string {
  return [
    '<!doctype html>',
    `<html lang="${escapeHtml(lang)}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">`,
    `<title>${escapeHtml(title)}</title>`,
    '<style>body{font:16px/1.5 system-ui,sans-serif;max-width:52rem;margin:2rem auto;padding:0 1rem}img{max-width:100%;height:auto}figure{margin:1rem 0}section+section{border-top:1px solid #ccc;margin-top:2rem;padding-top:1rem}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:.25rem .5rem}</style>',
    '</head>',
    '<body>',
    ...sections,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

export async function extract(
  doc: OxideDocument,
  pages: readonly number[],
  o: ExtractOptions,
  slice: JobSlice,
  progress: (p: { done: number; total: number }) => void,
): Promise<ExtractResult> {
  const count = doc.pageCount();
  const list = pages.filter((p) => Number.isInteger(p) && p >= 0 && p < count);
  const parts: string[] = [];
  const extra: ExportFile[] = [];
  let chars = 0;
  let images = 0;
  progress({ done: 0, total: list.length });
  for (const [i, p] of list.entries()) {
    await slice.checkpoint();
    const n = p + 1;
    if (o.format === 'text') {
      const text = doc.toPlainText(p).replace(/\s+$/u, '');
      chars += text.length;
      parts.push(`${text || fill(o.labels.noText, n)}\n${PAGE_BREAK}`);
    } else {
      const withImages = o.images;
      const imgs = withImages ? pageImages(doc, p) : [];
      const raw =
        o.format === 'markdown' ? doc.toMarkdown(p, true, false) : doc.toHtml(p, false, true);
      const blocks = o.format === 'markdown' ? splitMarkdownBlocks(raw) : splitHtmlBlocks(raw);
      const placed = imgs.length
        ? placeImages(
            blockTops(blocks, lineBoxes(doc, p)),
            imgs.map((x) => x.box),
          )
        : blocks.map((_, index) => ({ kind: 'block' as const, index }));
      chars += blocks.reduce((a, b) => a + b.length, 0);
      const body: string[] = [];
      for (const item of placed) {
        if (item.kind === 'block') {
          const b = blocks[item.index] ?? '';
          body.push(o.format === 'markdown' ? inertMarkdown(b) : inertHtml(b));
          continue;
        }
        const img = imgs[item.ref];
        if (!img) continue;
        images++;
        const k = item.ref + 1;
        const alt = fill(o.labels.image, n, k);
        if (o.format === 'markdown') {
          const path = `images/page-${String(n)}-image-${String(k)}.png`;
          extra.push({ path, data: img.png, type: 'image/png' });
          body.push(`![${alt.replace(/[[\]\\]/g, '')}](${path})`);
        } else {
          body.push(
            `<figure><img src="data:image/png;base64,${base64(img.png)}" alt="${escapeHtml(alt)}" width="${String(img.width)}" height="${String(img.height)}"></figure>`,
          );
        }
      }
      if (blocks.length === 0)
        body.unshift(
          o.format === 'markdown'
            ? fill(o.labels.noText, n)
            : `<p>${escapeHtml(fill(o.labels.noText, n))}</p>`,
        );
      parts.push(
        o.format === 'markdown'
          ? `<!-- page ${String(n)} -->\n\n${body.join('\n\n')}\n`
          : `<section id="page-${String(n)}" aria-label="${escapeHtml(fill(o.labels.page, n))}">\n${body.join('\n')}\n</section>`,
      );
    }
    progress({ done: i + 1, total: list.length });
  }
  const main: ExportFile =
    o.format === 'text'
      ? { path: `${o.baseName}.txt`, data: parts.join(''), type: 'text/plain;charset=utf-8' }
      : o.format === 'markdown'
        ? { path: `${o.baseName}.md`, data: parts.join('\n'), type: 'text/markdown;charset=utf-8' }
        : {
            path: `${o.baseName}.html`,
            data: htmlDocument(o.title, o.lang, parts),
            type: 'text/html;charset=utf-8',
          };
  return { files: [main, ...extra], pages: list.length, chars, images };
}
