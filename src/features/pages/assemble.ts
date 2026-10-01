// Insert from File, Extract Pages and Merge Files on the main thread (M4-11,
// §7.8, M4-Q2, M4-Q8). Files are read here (async I/O) and handed to the
// workers: the Render worker checks a picked PDF (page count, password, full
// access) and imports pages; the Work worker builds Extract/Merge results,
// which open as new unsaved tabs (the first save is Save As).
import { documentStore, securityOf, type DocumentMeta } from '../../app/store/documentStore';
import { isAbortError, RpcError } from '../../engine/errors';
import { format, msg, t, type MessageKey } from '../../i18n';
import { parseRange } from '../print/options';
import { CAPABILITIES, allows } from '../../model/permissions';
import { pickPdfFiles } from '../../storage/fileAccess';
import { openFiles } from '../open/openDocument';
import { renderEngine, workClient } from '../view/host';
import { runBusy, settleEdits, showPagesError } from './pageOps';

export interface SourceFile {
  id: string;
  name: string;
  bytes: ArrayBuffer;
  /** Null until the file opened (it may need a password). */
  pageCount: number | null;
  needsPassword: boolean;
  /** The password was tried and is wrong. */
  wrongPassword: boolean;
  password: string | undefined;
  /** M4-Q2: not encrypted, owner password, or no restrictions. */
  fullAccess: boolean;
  /** Page range text; empty = all pages. */
  range: string;
}

let seq = 0;

const RANGE_ERRORS: Record<string, MessageKey> = {
  empty: msg('pages.error.empty'),
  syntax: msg('pages.error.syntax'),
  outOfRange: msg('pages.error.outOfRange'),
};

/** The pages of a source (M4-11 merge plan): its range, or all pages when empty. Pure. */
export function sourcePages(
  src: Pick<SourceFile, 'pageCount' | 'range'>,
): { ok: true; pages: number[] } | { ok: false; error: MessageKey } {
  const count = src.pageCount ?? 0;
  if (!src.range.trim()) return { ok: true, pages: Array.from({ length: count }, (_, i) => i) };
  const r = parseRange(src.range, count);
  return r.ok
    ? { ok: true, pages: r.pages }
    : { ok: false, error: RANGE_ERRORS[r.error] ?? msg('pages.error.syntax') };
}

/** A document open with full access (M4-Q2), so its pages may leave it unencrypted. */
export function hasFullAccess(meta: DocumentMeta): boolean {
  const sec = securityOf(meta);
  return (
    sec.revision < 0 || meta.ownerUnlocked === true || CAPABILITIES.every((c) => allows(sec, c))
  );
}

/** Opens the file in the Render worker to learn its page count and access. */
export async function inspect(src: SourceFile, password?: string): Promise<SourceFile> {
  try {
    const info = await renderEngine().rpc.call('pagesSource', {
      bytes: src.bytes.slice(0),
      ...(password === undefined ? {} : { password }),
    }).promise;
    return {
      ...src,
      pageCount: info.pageCount,
      fullAccess: info.fullAccess,
      needsPassword: false,
      wrongPassword: false,
      password,
    };
  } catch (err) {
    if (err instanceof RpcError && err.code === 'pdfium:4')
      return {
        ...src,
        needsPassword: true,
        wrongPassword: password !== undefined,
        password: undefined,
      };
    throw err;
  }
}

/** The user picks PDFs (one or many); each is read and inspected. */
export async function pickSources(multiple: boolean): Promise<SourceFile[]> {
  const picked = await pickPdfFiles();
  const out: SourceFile[] = [];
  for (const { file } of multiple ? picked : picked.slice(0, 1)) {
    const src: SourceFile = {
      id: `src-${String(++seq)}`,
      name: file.name,
      bytes: await file.arrayBuffer(),
      pageCount: null,
      needsPassword: false,
      wrongPassword: false,
      password: undefined,
      fullAccess: false,
      range: '',
    };
    out.push(await inspect(src).catch(() => src));
  }
  return out;
}

/** Opens a built document as a new unsaved tab. */
async function openResult(name: string, bytes: ArrayBuffer): Promise<string | undefined> {
  const [id] = await openFiles([
    { file: new File([bytes], name, { type: 'application/pdf' }), recordRecent: false },
  ]);
  if (id) documentStore.getState().markDirty(id);
  return id;
}

const base = (name: string) => name.replace(/\.pdf$/iu, '');

/**
 * Extract Pages (M4-11): the pages, with unsaved changes, as a new unsaved
 * tab. Resolves the new tab's id (undefined: cancelled or failed).
 */
export async function extractPages(
  docId: string,
  pages: readonly number[],
  rangeText: string,
): Promise<string | undefined> {
  const meta = documentStore.getState().docs[docId]?.meta;
  if (!meta || pages.length === 0) return undefined;
  try {
    const bytes = await runBusy(docId, msg('pages.extracting'), async (progress, onCancel) => {
      await settleEdits(docId);
      // The Work copy with every unsaved change (markups too) as its live section.
      const { tail } = await renderEngine().rpc.call('snapshotTail', { docId }).promise;
      await workClient().setLive(docId, tail);
      const job = workClient().run(
        'assemble',
        { parts: [{ docId, pages: [...pages], title: meta.name }], outline: false },
        { onProgress: progress },
      );
      onCancel(() => {
        job.cancel();
      });
      return (await job.promise).bytes;
    });
    return await openResult(
      t('pages.extract.fileName', { base: base(meta.name), range: rangeText }),
      bytes,
    );
  } catch (err) {
    if (!isAbortError(err)) showPagesError(msg('pages.failed'));
    return undefined;
  }
}

/** Merge Files (M4-11): the files' chosen pages, in order, one bookmark per file. */
export async function mergeFiles(
  sources: readonly { src: SourceFile; pages: number[] }[],
): Promise<string | undefined> {
  const docId = documentStore.getState().activeId ?? '';
  try {
    const bytes = await runBusy(docId, msg('pages.merging'), async (progress, onCancel) => {
      const job = workClient().run(
        'assemble',
        {
          parts: sources.map(({ src, pages }) => ({
            bytes: src.bytes.slice(0),
            ...(src.password === undefined ? {} : { password: src.password }),
            pages,
            title: base(src.name),
          })),
          outline: true,
        },
        { onProgress: progress },
      );
      onCancel(() => {
        job.cancel();
      });
      return (await job.promise).bytes;
    });
    const total = sources.reduce((n, s) => n + s.pages.length, 0);
    return await openResult(t('pages.merge.fileName', { count: format.number(total, 0) }), bytes);
  } catch (err) {
    if (!isAbortError(err)) showPagesError(msg('pages.failed'));
    return undefined;
  }
}
