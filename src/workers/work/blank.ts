// Create Blank PDF (M10-08·O4, D-49, §7.8): a new document of `count` empty
// pages of one size, built in the Work worker (rule 1) on the route Extract and
// Merge use (an empty PDFium document, written by its full save). Progress per
// slice of pages; cancellable between slices (rule 2).
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { RpcError } from '../../engine/errors';
import { BLANK_MAX_PAGES, BLANK_MAX_SIDE, BLANK_MIN_SIDE } from '../../model/blankSize';
import { rawCall } from '../render/pdfium';
import { FPDF_NO_INCREMENTAL, saveWithFlags } from '../render/save/writer';
import type { JobSlice } from './scheduler';

export interface BlankSpec {
  /** Page width and height in points (unrotated). */
  width: number;
  height: number;
  count: number;
  /**
   * Each page's own size instead (a comparison's notes, one page per sheet in the
   * sheet's displayed size, M12-12); `count` must equal its length.
   */
  sizes?: readonly { width: number; height: number }[];
}

const SLICE = 50;

/** Throws on a size or page count outside the dialog's limits. */
export function checkBlankSpec({ width, height, count, sizes }: BlankSpec): void {
  if (!Number.isInteger(count) || count < 1 || count > BLANK_MAX_PAGES)
    throw new RpcError('pages-count', 'The number of pages is out of range');
  if (sizes && sizes.length !== count)
    throw new RpcError('pages-count', 'The number of pages is out of range');
  const ok = (v: number) => Number.isFinite(v) && v >= BLANK_MIN_SIDE && v <= BLANK_MAX_SIDE;
  for (const s of sizes ?? [{ width, height }])
    if (!ok(s.width) || !ok(s.height))
      throw new RpcError('pages-size', 'The page size is out of range');
}

/**
 * PDFium writes the same trailer /ID for every new document, so two blank
 * files made in the same second would be byte-identical, and the second would
 * open as "already open" (the fingerprint, §4.3). A random ID of the same
 * length is written in place, so no offset moves.
 */
export function withFreshId(bytes: Uint8Array, random: Uint8Array): Uint8Array {
  const from = Math.max(0, bytes.length - 1024);
  const text = new TextDecoder('latin1').decode(bytes.subarray(from));
  const m = /\/ID\s*\[\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/.exec(text);
  if (!m?.[1] || !m[2]) return bytes;
  const hex = [...random]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  const out = bytes.slice();
  // Both entries get the new ID: a new file's permanent and changing IDs are equal.
  const first = text.indexOf('<', m.index) + 1;
  const second = text.indexOf('<', first + m[1].length) + 1;
  for (const [at, old] of [
    [first, m[1]],
    [second, m[2]],
  ] as const) {
    const id = hex.padEnd(old.length, '0').slice(0, old.length);
    for (let k = 0; k < id.length; k++) out[from + at + k] = id.charCodeAt(k);
  }
  return out;
}

/** The new document's bytes. */
export async function createBlank(
  mod: WrappedPdfiumModule,
  spec: BlankSpec,
  slice: JobSlice,
  progress: (p: { done: number; total: number }) => void,
): Promise<Uint8Array> {
  checkBlankSpec(spec);
  const doc = mod.FPDF_CreateNewDocument();
  if (!doc) throw new RpcError('blank', 'The new document could not be created');
  try {
    for (let i = 0; i < spec.count; i += SLICE) {
      await slice.checkpoint();
      const end = Math.min(spec.count, i + SLICE);
      for (let k = i; k < end; k++) {
        const size = spec.sizes?.[k] ?? spec;
        const page = rawCall(mod, 'FPDFPage_New', doc, k, size.width, size.height);
        if (!page) throw new RpcError('page-new', 'The page could not be created');
        rawCall(mod, 'FPDF_ClosePage', page);
      }
      progress({ done: end, total: spec.count });
    }
    await slice.checkpoint();
    const bytes = saveWithFlags(mod, doc, FPDF_NO_INCREMENTAL);
    return withFreshId(bytes, crypto.getRandomValues(new Uint8Array(16)));
  } finally {
    mod.FPDF_CloseDocument(doc);
  }
}
