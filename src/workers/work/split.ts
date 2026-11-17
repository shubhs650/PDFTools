// Split Document (M11-08·O7, D-55): one new document per part, each built as
// Extract Pages builds one (assemble.ts: an empty PDFium document, the part's
// pages imported, a full save, not encrypted). The source is the Work copy
// with its unsaved changes. Progress counts pages over every part; the job
// can be cancelled between slices (rule 2).
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { RpcError } from '../../engine/errors';
import { assemble } from './assemble';
import type { JobSlice } from './scheduler';

export interface SplitPartSpec {
  /** 0-based page indexes, in order. */
  pages: number[];
  /** The file's name (made unique by the caller). */
  name: string;
}

export async function splitDocument(
  mod: WrappedPdfiumModule,
  docPtr: number,
  parts: readonly SplitPartSpec[],
  slice: JobSlice,
  progress: (p: { done: number; total: number }) => void,
): Promise<{ name: string; bytes: Uint8Array }[]> {
  if (parts.length === 0 || parts.some((p) => p.pages.length === 0))
    throw new RpcError('pages-empty', 'No pages given');
  const total = parts.reduce((n, p) => n + p.pages.length, 0);
  const out: { name: string; bytes: Uint8Array }[] = [];
  let before = 0;
  for (const part of parts) {
    await slice.checkpoint();
    const bytes = await assemble(
      mod,
      [{ docPtr, pages: part.pages, title: part.name }],
      false,
      slice,
      (p) => {
        progress({ done: before + p.done, total });
      },
    );
    before += part.pages.length;
    out.push({ name: part.name, bytes });
  }
  return out;
}
