// Comment transfer jobs in the Work worker (M4-20, M4-21, ADR-018): a source
// PDF's summary for the Import dialog, the import itself (objects for the
// Render worker to apply) and the in-app clipboard's mini-PDF. The target is
// read as its current state (original + saved tail + live section, which the
// main thread refreshes first), so the object numbers allocated here follow
// the Render worker's. Permissions (rule 9): the source needs copy (checked
// with PDFium, which knows an owner unlock); the Render worker checks annotate
// on the target when it applies the objects.
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { RpcError } from '../../engine/errors';
import { allows } from '../../model/permissions';
import { PdfReader } from '../../model/pdf/reader';
import { concatBytes } from '../render/save/bytes';
import { docPtrOf, rawCall } from '../render/pdfium';
import type { WorkDocs } from './docs';
import { securityOf } from './permissionGate';
import type { JobSlice } from './scheduler';
import {
  findRoots,
  importComments,
  pageBox,
  skeletonPdf,
  summarize,
  type CommentSummary,
  type ImportOptions,
  type ImportReport,
} from './transfer';

type Inflate = (bytes: Uint8Array) => Promise<Uint8Array>;

export interface TransferSource {
  bytes: ArrayBuffer;
  password?: string;
}

/** The import's options as they cross the worker boundary (plain data). */
export interface TransferSpec {
  /** 0-based source pages (default: all). */
  pages?: number[];
  /** Target page = source page + offset. */
  offset?: number;
  authors?: string[];
  types?: string[];
  withReplies?: boolean;
  /** Paste: every copy gets a new /NM (no duplicate check). */
  newNames?: boolean;
  /** Target page per source page (index: source page; null: none), overriding `offset`. */
  pageMap?: (number | null)[];
  /** Move right/down by this much as displayed (paste onto its own page). */
  shift?: { dx: number; dy: number };
  /** Count only (the dialog's preview). */
  dryRun?: boolean;
}

/** What the dialog shows and the announcement says. */
export interface TransferCounts {
  /** Annotations to copy (comments and their replies). */
  selected: number;
  /** Of them, comments (thread roots). */
  roots: number;
  skipped: ImportReport['skipped'];
}

export interface TransferObject {
  num: number;
  gen: number;
  bytes: Uint8Array;
}

export interface SourceSummary {
  pages: number;
  comments: CommentSummary[];
  /** The source allows copying (rule 9; an owner password allows everything). */
  copyAllowed: boolean;
  encrypted: boolean;
}

let seq = 0;

/** Opens a source PDF in PDFium (password and permission check), runs `fn`, closes it. */
async function withPdfium<T>(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  source: TransferSource,
  fn: (copyAllowed: boolean, encrypted: boolean) => Promise<T>,
): Promise<T> {
  const doc = await native
    .openDocumentBuffer(
      { id: `transfer-${String(++seq)}`, content: source.bytes.slice(0) },
      source.password === undefined ? {} : { password: source.password },
    )
    .toPromise()
    .catch((err: unknown) => {
      const e = err as { code?: unknown; reason?: { code?: unknown } };
      const code = e.reason?.code ?? e.code;
      throw new RpcError(`pdfium:${String(typeof code === 'number' ? code : 0)}`, 'Not opened');
    });
  try {
    const ptr = docPtrOf(native, doc.id);
    const sec = securityOf(mod, ptr);
    const owner = Boolean(rawCall(mod, 'EPDF_IsOwnerUnlocked', ptr));
    return await fn(owner || allows(sec, 'copy'), sec.revision >= 0);
  } finally {
    await native.closeDocument(doc).toPromise();
  }
}

async function readerOf(bytes: Uint8Array, inflate: Inflate, password?: string) {
  const r = await PdfReader.open(bytes, inflate, password === undefined ? {} : { password });
  if (!r.readable) throw new RpcError('pdfium:4', 'The file could not be decrypted');
  return r;
}

export async function commentSource(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  source: TransferSource,
  inflate: Inflate,
): Promise<SourceSummary> {
  return withPdfium(mod, native, source, async (copyAllowed, encrypted) => {
    if (!copyAllowed) return { pages: 0, comments: [], copyAllowed, encrypted };
    const src = await readerOf(new Uint8Array(source.bytes), inflate, source.password);
    return { ...(await summarize(src)), copyAllowed, encrypted };
  });
}

function optionsOf(spec: TransferSpec, slice: JobSlice, progress: Progress): ImportOptions {
  const map = spec.pageMap;
  return {
    ...(spec.pages ? { pages: spec.pages } : {}),
    ...(spec.offset === undefined ? {} : { offset: spec.offset }),
    ...(spec.authors ? { authors: spec.authors } : {}),
    ...(spec.types ? { types: spec.types } : {}),
    ...(spec.withReplies === undefined ? {} : { withReplies: spec.withReplies }),
    ...(spec.newNames ? { newNames: true } : {}),
    ...(map ? { pageMap: (sp: number) => map[sp] ?? null } : {}),
    ...(spec.shift ? { shift: spec.shift } : {}),
    ...(spec.dryRun ? { dryRun: true } : {}),
    checkpoint: async (done, total) => {
      progress({ done, total });
      await slice.checkpoint();
    },
  };
}

type Progress = (p: { done: number; total: number }) => void;

const countsOf = (r: ImportReport): TransferCounts => ({
  selected: r.selected,
  roots: r.roots,
  skipped: r.skipped,
});

/**
 * Copies the source's comments into the document's current state. Returns the
 * objects to apply (none for a dry run) and the counts.
 */
export async function transferComments(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  docs: WorkDocs,
  docId: string,
  source: TransferSource,
  spec: TransferSpec,
  inflate: Inflate,
  slice: JobSlice,
  progress: Progress,
): Promise<{ objects: TransferObject[]; firstNew: number; counts: TransferCounts }> {
  return withPdfium(mod, native, source, async (copyAllowed) => {
    if (!copyAllowed)
      throw new RpcError('permission-denied:copy', 'The source does not allow copying');
    const src = await readerOf(new Uint8Array(source.bytes), inflate, source.password);
    await slice.checkpoint();
    const bytes = docs.liveBytes(docId);
    const tgt = await readerOf(bytes, inflate, docs.passwordOf(docId));
    const r = await importComments(src, tgt, bytes, optionsOf(spec, slice, progress));
    return {
      objects: r.objects.map((o) => ({ num: o.num, gen: o.gen, bytes: o.bytes })),
      firstNew: r.report.firstNew,
      counts: countsOf(r.report),
    };
  });
}

/**
 * The clipboard (M4-21, ADR-018 d5, d8): the chosen comments (by annotation
 * id) with their replies and appearances, copied into a small unencrypted PDF
 * of the pages involved (same boxes, empty). `pages[i]`: the document page of
 * the clipboard's page i.
 */
export async function copyComments(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  docs: WorkDocs,
  docId: string,
  ids: readonly string[],
  withReplies: boolean,
  inflate: Inflate,
  slice: JobSlice,
): Promise<{ bytes: Uint8Array; pages: number[]; count: number }> {
  const { doc } = await docs.get(docId);
  const ptr = docPtrOf(native, doc.id);
  const owner = Boolean(rawCall(mod, 'EPDF_IsOwnerUnlocked', ptr));
  if (!owner && !allows(securityOf(mod, ptr), 'copy'))
    throw new RpcError('permission-denied:copy', 'The document does not allow copying');
  const bytes = docs.liveBytes(docId);
  const src = await readerOf(bytes, inflate, docs.passwordOf(docId));
  const roots = await findRoots(src, ids);
  if (roots.size === 0) throw new RpcError('transfer-empty', 'No comments to copy');
  const pages = [...new Set(roots.values())].sort((a, b) => a - b);
  const srcPages = await src.pages();
  const boxes = [];
  for (const p of pages) {
    const page = srcPages[p];
    if (page) boxes.push(await pageBox(src, page.dict));
  }
  await slice.checkpoint();
  const skel = skeletonPdf(boxes);
  const tgt = await readerOf(skel, inflate);
  const index = new Map(pages.map((p, i) => [p, i]));
  const r = await importComments(src, tgt, skel, {
    only: new Set(roots.keys()),
    pageMap: (sp) => index.get(sp) ?? null,
    withReplies,
    noTransform: true,
  });
  return { bytes: concatBytes([skel, r.tail]), pages, count: r.report.roots };
}
