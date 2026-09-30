// What a save must preserve, per page (M1-21, ADR-005 decision 2): each
// annotation's subtype, rect, /NM and a hash of /Contents, and each form
// field's value (hashed). Both workers compute it for the same pages — the
// Render worker from its edited document, the Work worker from original +
// tail — and the Work worker compares.
//
// Raw PDFium reads only: EmbedPDF's annotation readers write a random /NM into
// annotations without one, which would change the document being measured.
// Text is hashed so digests carry no document content (rule 10).
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { acquirePage, docPtrOf, rawCall } from '../pdfium';

export interface AnnotDigest {
  subtype: number;
  /** left, bottom, right, top in points, rounded to 0.1 (PDFium stores float32). */
  rect: [number, number, number, number];
  /** `*` when not checked: an existing annotation the save does not rewrite (see NM_UNCHECKED). */
  nm: string;
  contents: string;
  /** Object number (not compared: a rewrite may renumber). */
  obj: number;
}

export interface FieldDigest {
  name: string;
  value: string;
  checked: boolean;
}

export interface PageDigest {
  page: number;
  /**
   * Page identity (ADR-016 decision 3): the page object's number, /Rotate in
   * quarter turns and the size in points (rounded to 0.1), so a save that
   * lost a page operation (order, rotation, an inserted page) cannot verify.
   */
  obj?: number;
  rotation?: number;
  size?: [number, number];
  annots: AnnotDigest[];
  fields: FieldDigest[];
}

/**
 * Keys our object layer wrote into an object (M3-03): key → hash of the
 * serialized value, or ABSENT for a removed key. Checked by the Work worker
 * with our own reader (PDFium can't read nested dictionaries).
 */
export interface ObjectDigest {
  obj: number;
  keys: Record<string, string>;
}

export const ABSENT = '-';

export interface DocDigest {
  pageCount: number;
  pages: PageDigest[];
  objects?: ObjectDigest[];
}

const WIDGET = 20; // FPDF_ANNOT_WIDGET

/** FNV-1a over UTF-16 code units: equality check only, never reversible content. */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${String(s.length)}:${(h >>> 0).toString(16)}`;
}

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  UTF16ToString(ptr: number): string;
  getValue(ptr: number, type: 'float'): number;
}

const heapOf = (mod: WrappedPdfiumModule): Heap => mod.pdfium;

/** Reads a UTF-16 string through a PDFium "call twice" getter (length first). */
function readWide(mod: WrappedPdfiumModule, read: (buf: number, len: number) => number): string {
  const len = read(0, 0);
  if (len <= 2) return '';
  const heap = heapOf(mod);
  const ptr = heap.wasmExports.malloc(len + 2);
  try {
    read(ptr, len + 2);
    return heap.UTF16ToString(ptr);
  } finally {
    heap.wasmExports.free(ptr);
  }
}

function readRect(mod: WrappedPdfiumModule, annot: number): AnnotDigest['rect'] {
  const heap = heapOf(mod);
  const ptr = heap.wasmExports.malloc(16);
  try {
    if (!rawCall(mod, 'FPDFAnnot_GetRect', annot, ptr)) return [0, 0, 0, 0];
    const f = (i: number) => Math.round(heap.getValue(ptr + i * 4, 'float') * 10) / 10;
    // FS_RECTF is left, top, right, bottom.
    return [f(0), f(3), f(2), f(1)];
  } finally {
    heap.wasmExports.free(ptr);
  }
}

/**
 * EmbedPDF writes a random /NM into annotations it reads. For an annotation
 * the save does not rewrite, that /NM is not persisted by design (ADR-005), so
 * the Render side marks its /NM unchecked (`uncheckNames`).
 */
export const NM_UNCHECKED = '*';

function readAnnot(mod: WrappedPdfiumModule, annot: number): AnnotDigest {
  const str = (key: string) =>
    readWide(mod, (b, l) => rawCall(mod, 'FPDFAnnot_GetStringValue', annot, key, b, l));
  return {
    subtype: rawCall(mod, 'FPDFAnnot_GetSubtype', annot),
    rect: readRect(mod, annot),
    obj: rawCall(mod, 'EPDFAnnot_GetObjectNumber', annot),
    nm: str('NM'),
    contents: hashText(str('Contents')),
  };
}

function eachAnnot(mod: WrappedPdfiumModule, pagePtr: number, fn: (annot: number) => void): void {
  const n = rawCall(mod, 'FPDFPage_GetAnnotCount', pagePtr);
  for (let i = 0; i < n; i++) {
    const annot = rawCall(mod, 'FPDFPage_GetAnnot', pagePtr, i);
    if (!annot) continue;
    try {
      fn(annot);
    } finally {
      rawCall(mod, 'FPDFPage_CloseAnnot', annot);
    }
  }
}

function pageDigest(mod: WrappedPdfiumModule, docPtr: number, pagePtr: number, page: number) {
  // Document-level reads: a page loaded with EmbedPDF's normalized rotation
  // (the Work worker's copies) reports /Rotate 0 and a swapped size.
  const heap = heapOf(mod);
  const buf = heap.wasmExports.malloc(8);
  let size: [number, number] | undefined;
  try {
    if (rawCall(mod, 'FPDF_GetPageSizeByIndexF', docPtr, page, buf)) {
      const r = (i: number) => Math.round(heap.getValue(buf + i * 4, 'float') * 10) / 10;
      size = [r(0), r(1)];
    }
  } finally {
    heap.wasmExports.free(buf);
  }
  const out: PageDigest = {
    page,
    obj: rawCall(mod, 'EPDFPage_GetObjectNumber', pagePtr),
    rotation: rawCall(mod, 'EPDF_GetPageRotationByIndex', docPtr, page),
    ...(size ? { size } : {}),
    annots: [],
    fields: [],
  };
  eachAnnot(mod, pagePtr, (annot) => out.annots.push(readAnnot(mod, annot)));
  // A form-fill environment makes PDFium generate missing appearance streams
  // (new objects the next save would write), so only pages with widgets get one.
  if (!out.annots.some((a) => a.subtype === WIDGET)) return out;
  const info = rawCall(mod, 'PDFiumExt_OpenFormFillInfo');
  const form = rawCall(mod, 'PDFiumExt_InitFormFillEnvironment', docPtr, info);
  rawCall(mod, 'FORM_OnAfterLoadPage', pagePtr, form);
  try {
    eachAnnot(mod, pagePtr, (annot) => {
      if (rawCall(mod, 'FPDFAnnot_GetSubtype', annot) !== WIDGET) return;
      const name = readWide(mod, (b, l) =>
        rawCall(mod, 'FPDFAnnot_GetFormFieldName', form, annot, b, l),
      );
      const value = readWide(mod, (b, l) =>
        rawCall(mod, 'FPDFAnnot_GetFormFieldValue', form, annot, b, l),
      );
      out.fields.push({
        name: hashText(name),
        value: hashText(value),
        checked: Boolean(rawCall(mod, 'FPDFAnnot_IsChecked', form, annot)),
      });
    });
  } finally {
    rawCall(mod, 'FORM_OnBeforeClosePage', pagePtr, form);
    rawCall(mod, 'PDFiumExt_ExitFormFillEnvironment', form);
    rawCall(mod, 'PDFiumExt_CloseFormFillInfo', info);
  }
  return out;
}

/** Digest of `pages` (all pages when 'all') of an open document. */
export function digestDocument(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  docId: string,
  pages: readonly number[] | 'all',
): DocDigest {
  const docPtr = docPtrOf(native, docId);
  const pageCount = rawCall(mod, 'FPDF_GetPageCount', docPtr);
  const list = pages === 'all' ? Array.from({ length: pageCount }, (_, i) => i) : pages;
  const out: DocDigest = { pageCount, pages: [] };
  for (const page of list) {
    if (page < 0 || page >= pageCount) continue;
    const ref = acquirePage(native, docId, page);
    try {
      out.pages.push(pageDigest(mod, docPtr, ref.pagePtr, page));
    } finally {
      ref.release();
    }
  }
  return out;
}

/** Marks the /NM of annotations outside `rewritten` (object numbers) as unchecked. */
export function uncheckNames(d: DocDigest, rewritten: ReadonlySet<number>): DocDigest {
  return {
    ...d,
    pages: d.pages.map((p) => ({
      ...p,
      annots: p.annots.map((a) => (rewritten.has(a.obj) ? a : { ...a, nm: NM_UNCHECKED })),
    })),
  };
}
