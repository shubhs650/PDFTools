// Spike S32, route b: the view-only copy of a document for thin-line tiles.
//
// Its bytes are the file as opened plus PDFium's own incremental section for
// everything changed since (FPDF_SaveAsCopy with FPDF_INCREMENTAL writes the
// opened bytes unchanged, then the section). Two ways to open it:
//   - "buffer": EmbedPDF's openDocumentBuffer, which copies all of it into the
//     WASM heap (a second copy of the file);
//   - "shared": FPDF_LoadCustomDocument reading the opened bytes straight from
//     the original's buffer in the heap and only the section from a new block,
//     then registered in EmbedPDF's document cache so tiles render through the
//     same renderPageRect as the original's (rotation handling included).
//     The copy must be closed before the original (it reads its buffer).
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { PdfDocumentObject } from '@embedpdf/models';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { docPtrOf } from '../../src/workers/render/pdfium.ts';
import { FPDF_INCREMENTAL, saveWithFlags } from '../../src/workers/render/save/writer.ts';

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  HEAPU8: Uint8Array;
  HEAP32: Int32Array;
  addFunction(fn: (...a: number[]) => number, sig: string): number;
  removeFunction(p: number): void;
}

interface CacheInternals {
  cache: {
    getContext(id: string): { filePtr: number; docPtr: number } | undefined;
    setDocument(id: string, filePtr: number, docPtr: number, normalizeRotation: boolean): void;
  };
}

/** The section PDFium appends to the opened bytes for the current state. */
export function currentSection(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  docId: string,
  openedLength: number,
  opened: Uint8Array,
): Uint8Array {
  const all = saveWithFlags(mod, docPtrOf(native, docId), FPDF_INCREMENTAL);
  // PDFium writes the opened file unchanged first; checked, not assumed.
  for (let i = 0; i < openedLength; i += 4093)
    if (all[i] !== opened[i])
      throw new Error('incremental save did not start with the opened bytes');
  return all.subarray(openedLength);
}

/** Opens the copy through EmbedPDF (a second copy of the file in the heap). */
export async function openBufferCopy(
  native: PdfiumNative,
  id: string,
  opened: Uint8Array,
  section: Uint8Array,
  password?: string,
): Promise<PdfDocumentObject> {
  const bytes = new Uint8Array(opened.length + section.length);
  bytes.set(opened, 0);
  bytes.set(section, opened.length);
  return native
    .openDocumentBuffer(
      { id, content: bytes.buffer },
      { normalizeRotation: true, ...(password ? { password } : {}) },
    )
    .toPromise();
}

export interface SharedCopy {
  doc: PdfDocumentObject;
  close(): Promise<void>;
}

/** Opens the copy on the original's own bytes in the heap plus the section. */
export function openSharedCopy(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  original: PdfDocumentObject,
  id: string,
  openedLength: number,
  section: Uint8Array,
  password = '',
): SharedCopy {
  const heap = mod.pdfium as unknown as Heap;
  const cache = (native as unknown as CacheInternals).cache;
  const src = cache.getContext(original.id);
  if (!src) throw new Error('original not open');
  const basePtr = src.filePtr;
  // One block: the section, then FPDF_FILEACCESS { m_FileLen, m_GetBlock, m_Param }.
  const block = heap.wasmExports.malloc(section.length + 16);
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
  const docPtr = (
    mod as unknown as { FPDF_LoadCustomDocument: (a: number, p: string) => number }
  ).FPDF_LoadCustomDocument(access, password);
  if (!docPtr) {
    heap.removeFunction(getBlock);
    heap.wasmExports.free(block);
    throw new Error('FPDF_LoadCustomDocument failed');
  }
  // EmbedPDF frees "filePtr" when it closes the document: hand it our block.
  cache.setDocument(id, block, docPtr, true);
  const doc: PdfDocumentObject = { ...original, id };
  return {
    doc,
    async close() {
      await native.closeDocument(doc).toPromise();
      heap.removeFunction(getBlock);
    },
  };
}
