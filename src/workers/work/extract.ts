// Extraction jobs over PDF Oxide (M4-04, §7.6): one page per step, with a
// checkpoint between pages (cancel, and room for interactive jobs, rule 2) and
// progress in pages. The output is built here as a Blob, so the main thread
// only receives a handle (rule 1). M4-05 adds the Markdown and HTML formats.
import type { OxideDocument } from './oxide';
import type { JobSlice } from './scheduler';

export type ExtractFormat = 'text';

export interface ExtractResult {
  blob: Blob;
  pages: number;
  chars: number;
}

/** Page separator of the plain-text export: a form feed at each page end (as pdftotext). */
export const PAGE_BREAK = '\f';

export async function extractText(
  doc: OxideDocument,
  pages: readonly number[],
  slice: JobSlice,
  progress: (p: { done: number; total: number }) => void,
): Promise<ExtractResult> {
  const count = doc.pageCount();
  const list = pages.filter((p) => Number.isInteger(p) && p >= 0 && p < count);
  const parts: string[] = [];
  let chars = 0;
  progress({ done: 0, total: list.length });
  for (const [i, p] of list.entries()) {
    await slice.checkpoint();
    const text = doc.toPlainText(p).replace(/\s+$/u, '');
    chars += text.length;
    parts.push(`${text}\n${PAGE_BREAK}`);
    progress({ done: i + 1, total: list.length });
  }
  return {
    blob: new Blob(parts, { type: 'text/plain;charset=utf-8' }),
    pages: list.length,
    chars,
  };
}
