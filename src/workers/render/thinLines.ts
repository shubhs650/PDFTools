// Thin Lines (M13-05, D-69, ADR-034 Amendment 2, route b): while it is on, page
// tiles, previews and the loupe's page come from a second, view-only copy of
// each document whose stroked paths have width 0, which PDFium draws one device
// pixel wide at any zoom (ISO 32000-2 §8.4.3.2: the thinnest line the device
// can draw). The document itself is never touched, so saves, print, exports,
// snapshots and the CRS stay exactly as they were.
//
// The copy reads the file as opened straight from the document's own buffer on
// the WASM heap (FPDF_LoadCustomDocument: never held twice), plus, only after
// the page content changed, PDFium's incremental section for the current
// state. It is registered in EmbedPDF's cache (pdfium.ts), so its tiles go
// through the same renderPageRect, page cache and rotation handling. Each page
// load of the copy is walked once and its widths set to 0; EmbedPDF parses a
// page again after 5 s unused, which is a new page context, walked again.
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { RpcError } from '../../engine/errors';
import {
  acquirePage,
  docPtrOf,
  filePtrOf,
  isNormalized,
  openedBytes,
  registerDocument,
} from './pdfium';
import { FPDF_INCREMENTAL, saveWithFlags } from './save/writer';

export { CONTENT_METHODS, THIN_METHODS } from '../../engine/mutations';

type RawFn = (...a: number[]) => number;

interface Heap {
  wasmExports: Record<string, RawFn | undefined> & {
    malloc(n: number): number;
    free(p: number): void;
  };
  HEAPU8: Uint8Array;
  HEAP32: Int32Array;
  HEAPF32: Float32Array;
  addFunction(fn: (...a: number[]) => number, sig: string): number;
  removeFunction(p: number): void;
}

const heapOf = (mod: WrappedPdfiumModule): Heap => mod.pdfium as unknown as Heap;

function exportFn(heap: Heap, name: string): RawFn {
  const fn = heap.wasmExports[name];
  if (typeof fn !== 'function') throw new Error(`PDFium export ${name} is missing`);
  return fn;
}

const FPDF_PAGEOBJ_PATH = 2;
const FPDF_PAGEOBJ_FORM = 5;

/**
 * Sets every stroked path of a loaded page to width 0, inside form XObjects at
 * any depth; returns how many. Text (also text drawn as outlines), images,
 * shadings and fills are left alone. Calls the WASM exports directly: the
 * module's wrapped functions made the walk 9× slower (S32: 21 ms for 128,016
 * objects).
 */
export function thinPage(mod: WrappedPdfiumModule, pagePtr: number): number {
  const heap = heapOf(mod);
  const getType = exportFn(heap, 'FPDFPageObj_GetType');
  const countForm = exportFn(heap, 'FPDFFormObj_CountObjects');
  const getFormObj = exportFn(heap, 'FPDFFormObj_GetObject');
  const drawMode = exportFn(heap, 'FPDFPath_GetDrawMode');
  const setWidth = exportFn(heap, 'FPDFPageObj_SetStrokeWidth');
  const scratch = heap.wasmExports.malloc(8);
  let thinned = 0;
  const visit = (obj: number): void => {
    const type = getType(obj);
    if (type === FPDF_PAGEOBJ_FORM) {
      const n = countForm(obj);
      for (let i = 0; i < n; i++) visit(getFormObj(obj, i));
      return;
    }
    if (type !== FPDF_PAGEOBJ_PATH) return;
    // FPDFPath_GetDrawMode(path, int* fillmode, FPDF_BOOL* stroke)
    if (!drawMode(obj, scratch, scratch + 4) || !heap.HEAP32[(scratch + 4) >> 2]) return;
    if (setWidth(obj, 0)) thinned++;
  };
  try {
    const n = exportFn(heap, 'FPDFPage_CountObjects')(pagePtr);
    const get = exportFn(heap, 'FPDFPage_GetObject');
    for (let i = 0; i < n; i++) visit(get(pagePtr, i));
  } finally {
    heap.wasmExports.free(scratch);
  }
  return thinned;
}

/** What the copies need to know about a document from the save tracker. */
export interface ThinSource {
  /** Length of the bytes PDFium opened the document from (its buffer on the heap). */
  openedLength(docId: string): number;
  /** The password the document was opened (or unlocked) with, if any. */
  password(docId: string): string | undefined;
}

interface Copy {
  id: string;
  docId: string;
  users: number;
  retired: boolean;
  /** Page contexts (EmbedPDF's, one per page load) already made thin. */
  thinned: WeakSet<object>;
  shutting: boolean;
  /** Resolves once the copy is closed. */
  done: Promise<void>;
  markDone(): void;
  close(): Promise<void>;
}

/** A page of a copy, held until `release()` (its copy stays open meanwhile). */
export interface ThinPage {
  /** The copy's document id: render with it in place of the document's. */
  docId: string;
  pagePtr: number;
  release(): void;
}

/** The view-only copies, at most one current per document (plus retiring ones in use). */
export class ThinCopies {
  private readonly current = new Map<string, Copy>();
  private readonly retiring = new Set<Copy>();
  /** Documents whose page content changed since PDFium opened their bytes. */
  private readonly changed = new Set<string>();
  /** Documents whose bytes are being replaced (a reopen): no copy may open meanwhile. */
  private readonly blocked = new Set<string>();
  private seq = 0;
  private readonly mod: WrappedPdfiumModule;
  private readonly native: PdfiumNative;
  private readonly source: ThinSource;
  /** Diagnostics for the tests: copies opened, pages walked, paths made thin. */
  readonly stats = { opened: 0, walked: 0, thinned: 0 };

  constructor(mod: WrappedPdfiumModule, native: PdfiumNative, source: ThinSource) {
    this.mod = mod;
    this.native = native;
    this.source = source;
  }

  /** Copies open now (current and retiring). */
  get openCount(): number {
    return this.current.size + this.retiring.size;
  }

  /** The copy's page, thin, held until `release()`. Opens the copy when needed. */
  page(docId: string, pageIndex: number): ThinPage {
    const copy = this.current.get(docId) ?? this.open(docId);
    copy.users++;
    let ref: { pagePtr: number; release(): void } | undefined;
    try {
      ref = acquirePage(this.native, copy.id, pageIndex);
      if (!copy.thinned.has(ref)) {
        this.stats.walked++;
        this.stats.thinned += thinPage(this.mod, ref.pagePtr);
        copy.thinned.add(ref);
      }
    } catch (err) {
      ref?.release();
      this.unuse(copy);
      throw err;
    }
    const held = ref;
    let released = false;
    return {
      docId: copy.id,
      pagePtr: held.pagePtr,
      release: () => {
        if (released) return;
        released = true;
        held.release();
        this.unuse(copy);
      },
    };
  }

  /**
   * The document's page content changed in place (a page operation, a flatten):
   * the next thin page opens a fresh copy with the current state.
   */
  contentChanged(docId: string): void {
    this.changed.add(docId);
    this.retire(docId);
  }

  /**
   * The document's bytes are about to go (it closes or is reopened): its copies
   * read them, so they close first, once the renders using them finish. Pair
   * with `replaced()` when the document is open again.
   */
  async replacing(docId: string): Promise<void> {
    this.blocked.add(docId);
    this.retire(docId);
    await Promise.all([...this.retiring].filter((c) => c.docId === docId).map((c) => c.done));
  }

  /** The document is open again (or closed for good): its bytes are its state. */
  replaced(docId: string): void {
    this.blocked.delete(docId);
    this.changed.delete(docId);
  }

  /** Thin Lines off: every copy closes (once in-flight renders finish). */
  async closeAll(): Promise<void> {
    for (const docId of [...this.current.keys()]) this.retire(docId);
    await Promise.all([...this.retiring].map((c) => c.done));
  }

  private open(docId: string): Copy {
    if (this.blocked.has(docId)) throw new RpcError('thin-busy', 'The document is being reopened');
    const id = `${docId}#thin${String(++this.seq)}`;
    const openedLength = this.source.openedLength(docId);
    const section = this.changed.has(docId)
      ? currentSection(this.mod, this.native, docId, openedLength)
      : new Uint8Array(0);
    const close = openSharedCopy(
      this.mod,
      this.native,
      docId,
      id,
      openedLength,
      section,
      this.source.password(docId) ?? '',
    );
    let markDone = (): void => undefined;
    const done = new Promise<void>((resolve) => {
      markDone = resolve;
    });
    const copy: Copy = {
      id,
      docId,
      users: 0,
      retired: false,
      thinned: new WeakSet(),
      shutting: false,
      done,
      markDone,
      close,
    };
    this.current.set(docId, copy);
    this.stats.opened++;
    return copy;
  }

  private retire(docId: string): void {
    const copy = this.current.get(docId);
    if (!copy) return;
    this.current.delete(docId);
    copy.retired = true;
    this.retiring.add(copy);
    if (copy.users === 0) this.shut(copy);
  }

  private unuse(copy: Copy): void {
    copy.users--;
    if (copy.retired && copy.users === 0) this.shut(copy);
  }

  private shut(copy: Copy): void {
    if (copy.shutting) return;
    copy.shutting = true;
    void copy.close().finally(() => {
      this.retiring.delete(copy);
      copy.markDone();
    });
  }
}

/**
 * The section PDFium appends to the opened bytes for the document's current
 * state (`FPDF_SaveAsCopy` with `FPDF_INCREMENTAL` writes the opened bytes
 * unchanged first; checked, not assumed).
 */
export function currentSection(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  docId: string,
  openedLength: number,
): Uint8Array {
  const all = saveWithFlags(mod, docPtrOf(native, docId), FPDF_INCREMENTAL);
  // Read after the save: the heap may have grown (a view taken before would be detached).
  const opened = openedBytes(mod, native, docId, openedLength);
  if (all.length < openedLength) throw new RpcError('thin-copy', 'The section is shorter');
  for (let i = 0; i < openedLength; i += 4093)
    if (all[i] !== opened[i]) throw new RpcError('thin-copy', 'The section does not follow');
  return all.slice(openedLength);
}

/**
 * Opens the copy on the document's own bytes on the heap plus `section`, and
 * registers it with EmbedPDF under `id`. Returns its close, which must run
 * before the document's bytes go.
 */
function openSharedCopy(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  docId: string,
  id: string,
  openedLength: number,
  section: Uint8Array,
  password: string,
): () => Promise<void> {
  const heap = heapOf(mod);
  const basePtr = filePtrOf(native, docId);
  // One block: the section, then FPDF_FILEACCESS { m_FileLen, m_GetBlock, m_Param }.
  const block = heap.wasmExports.malloc(section.length + 4 + 16);
  if (!block) throw new RpcError('thin-memory', 'No memory for the Thin Lines copy');
  heap.HEAPU8.set(section, block);
  const access = block + ((section.length + 3) & ~3);
  const fileLen = openedLength + section.length;
  const getBlock = heap.addFunction((_param: number, pos: number, buf: number, size: number) => {
    if (pos + size > fileLen) return 0;
    const h = heap.HEAPU8;
    let p = pos;
    let out = buf;
    let left = size;
    if (p < openedLength) {
      const n = Math.min(left, openedLength - p);
      h.copyWithin(out, basePtr + p, basePtr + p + n);
      p += n;
      out += n;
      left -= n;
    }
    if (left > 0) h.copyWithin(out, block + (p - openedLength), block + (p - openedLength) + left);
    return 1;
  }, 'iiiii');
  heap.HEAP32[access >> 2] = fileLen;
  heap.HEAP32[(access + 4) >> 2] = getBlock;
  heap.HEAP32[(access + 8) >> 2] = 0;
  const load = (mod as unknown as { FPDF_LoadCustomDocument?: (a: number, p: string) => number })
    .FPDF_LoadCustomDocument;
  const docPtr = typeof load === 'function' ? load(access, password) : 0;
  if (!docPtr) {
    heap.removeFunction(getBlock);
    heap.wasmExports.free(block);
    throw new RpcError('thin-copy', 'The Thin Lines copy could not be opened');
  }
  // EmbedPDF frees "filePtr" when it closes the document: it gets our block.
  registerDocument(native, id, block, docPtr, isNormalized(native, docId));
  return async () => {
    try {
      await native
        .closeDocument({ id } as never)
        .toPromise()
        .catch(() => undefined);
    } finally {
      heap.removeFunction(getBlock);
    }
  };
}
