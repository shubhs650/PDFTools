// Extract Pages and Merge Files (M4-11, §7.8, ADR-016 decision 1, M4-Q8): a
// new document built in the Work worker, never on the Render queue — an empty
// PDFium document, the chosen pages of each source imported in order, written
// by PDFium's full save (the output is not encrypted: M4-Q2 allows only
// sources open with full access). For a merge, our object layer then adds one
// top-level bookmark per source file, pointing at its first page (M4-Q8).
// Progress per imported slice; cancellable between slices (rule 2).
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { RpcError } from '../../engine/errors';
import { CAPABILITIES, allows } from '../../model/permissions';
import {
  D,
  N,
  PdfRef,
  PdfString,
  isDict,
  serializeIndirect,
  type PdfValue,
} from '../../model/pdf/objects';
import { PdfReader } from '../../model/pdf/reader';
import { concatBytes } from '../render/save/bytes';
import { narrowTail, type ExtraObject } from '../render/save/narrowTail';
import { FPDF_NO_INCREMENTAL, saveWithFlags } from '../render/save/writer';
import { saveBaseOf } from '../render/save/xref';
import type { JobSlice } from './scheduler';

export interface AssemblePart {
  /** Document pointer of the source (a Work copy, or a file opened for the merge). */
  docPtr: number;
  /** 0-based page indexes, in the order they go into the result. */
  pages: number[];
  /** The bookmark's title (a merge: the file name). */
  title: string;
}

const SLICE = 50;

function withInts<T>(mod: WrappedPdfiumModule, xs: readonly number[], fn: (ptr: number) => T): T {
  const heap = mod.pdfium as unknown as {
    wasmExports: { malloc(n: number): number; free(p: number): void };
    setValue(ptr: number, v: number, t: 'i32'): void;
  };
  const ptr = heap.wasmExports.malloc(Math.max(4, xs.length * 4));
  try {
    xs.forEach((x, i) => {
      heap.setValue(ptr + i * 4, x, 'i32');
    });
    return fn(ptr);
  } finally {
    heap.wasmExports.free(ptr);
  }
}

/**
 * The new document's bytes. `outline`: one bookmark per part (merge).
 * Throws on an empty result.
 */
export async function assemble(
  mod: WrappedPdfiumModule,
  parts: readonly AssemblePart[],
  outline: boolean,
  slice: JobSlice,
  progress: (p: { done: number; total: number }) => void,
): Promise<Uint8Array> {
  const total = parts.reduce((n, p) => n + p.pages.length, 0);
  if (total === 0) throw new RpcError('pages-empty', 'No pages given');
  const out = mod.FPDF_CreateNewDocument();
  if (!out) throw new RpcError('assemble', 'The new document could not be created');
  const starts: number[] = [];
  let bytes: Uint8Array;
  try {
    let done = 0;
    for (const part of parts) {
      starts.push(done);
      for (let i = 0; i < part.pages.length; i += SLICE) {
        await slice.checkpoint();
        const chunk = part.pages.slice(i, i + SLICE);
        const ok = withInts(mod, chunk, (ptr) =>
          mod.FPDF_ImportPagesByIndex(out, part.docPtr, ptr, chunk.length, done),
        );
        if (!ok) throw new RpcError('assemble', 'The pages could not be copied');
        done += chunk.length;
        progress({ done, total });
      }
    }
    await slice.checkpoint();
    bytes = saveWithFlags(mod, out, FPDF_NO_INCREMENTAL);
  } finally {
    mod.FPDF_CloseDocument(out);
  }
  if (!outline) return bytes;
  return concatBytes([bytes, await outlineSection(bytes, parts, starts)]);
}

/**
 * An incremental section adding /Outlines to the catalog: one item per part,
 * in order, each with a /Fit destination at the part's first page.
 */
export async function outlineSection(
  bytes: Uint8Array,
  parts: readonly Pick<AssemblePart, 'title'>[],
  starts: readonly number[],
): Promise<Uint8Array> {
  const reader = await PdfReader.open(bytes);
  const pages = await reader.pages();
  const rootRef = reader.trailer.get('Root');
  const catalog = await reader.resolve(rootRef);
  if (!(rootRef instanceof PdfRef) || !isDict(catalog))
    throw new RpcError('assemble', 'The new document has no catalog');
  let next = reader.maxObjNum();
  const outlinesNum = next++;
  const items = parts.map(() => next++);
  const extra: ExtraObject[] = [];
  const put = (num: number, value: PdfValue) => {
    extra.push({ num, gen: 0, bytes: serializeIndirect(num, 0, value) });
  };
  parts.forEach((part, i) => {
    const page = pages[starts[i] ?? 0];
    const item = D({
      Title: PdfString.of(part.title),
      Parent: new PdfRef(outlinesNum),
      ...(page ? { Dest: [new PdfRef(page.num), N('Fit')] } : {}),
    });
    const prev = items[i - 1];
    const nextItem = items[i + 1];
    if (prev !== undefined) item.set('Prev', new PdfRef(prev));
    if (nextItem !== undefined) item.set('Next', new PdfRef(nextItem));
    put(items[i] ?? 0, item);
  });
  const first = items[0];
  const last = items.at(-1);
  put(
    outlinesNum,
    D({
      Type: N('Outlines'),
      ...(first !== undefined && last !== undefined
        ? { First: new PdfRef(first), Last: new PdfRef(last), Count: items.length }
        : {}),
    }),
  );
  const newCatalog = new Map(catalog);
  newCatalog.set('Outlines', new PdfRef(outlinesNum));
  put(rootRef.num, newCatalog);
  extra.sort((a, b) => a.num - b.num);
  return narrowTail(saveBaseOf(bytes), bytes, bytes.length, [], { extra, onlyExtra: true }).tail;
}

/**
 * M4-Q2: pages leave an encrypted file only when it is open with full access
 * (not encrypted, the owner password, or no restrictions): the result is not
 * encrypted.
 */
export function fullAccess(mod: WrappedPdfiumModule, docPtr: number): boolean {
  const revision = mod.FPDF_GetSecurityHandlerRevision(docPtr);
  if (revision < 0) return true;
  const call = mod as unknown as Record<string, ((p: number) => number) | undefined>;
  if (call['EPDF_IsOwnerUnlocked']?.(docPtr)) return true;
  const permissions = mod.FPDF_GetDocPermissions(docPtr) >>> 0;
  return CAPABILITIES.every((c) => allows({ permissions, revision }, c));
}

export type { PdfiumNative };
