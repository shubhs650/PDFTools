// Attach File comments in the Render worker (M6-10, ADR-021 D-38 d, ADR-022
// decision 1, §7.1). EmbedPDF 2.15.1 can neither create nor update a
// /FileAttachment annotation (createPageAnnotation has no case for it, and
// updatePageAnnotation moves it, then rejects the subtype with error 20). The
// executor calls for this subtype are answered here with direct PDFium calls
// (ADR-001 B14): the annotation, its /FS filespec and /EmbeddedFile stream
// (PDFium writes and, in an encrypted file, encrypts them), /Name /Paperclip,
// /C, the base keys through EmbedPDF's own writers, and our paperclip
// appearance — the one exception to "no custom appearance streams". Deleting
// stays EmbedPDF's removePageAnnotation. The save tracker is told by the
// caller, as for any executor call, so Ctrl+S keeps the narrow tail.
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import { PdfAnnotationName, PdfAnnotationSubtype } from '@embedpdf/models';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { RpcError } from '../../engine/errors';
import {
  ATTACH_DEFAULT_COLOR,
  ATTACH_MAX_BYTES,
  paperclipAppearance,
} from '../../model/attachFile';
import { fileBytes, readWide } from '../work/attachments';
import { readAnnotString } from './annotTiles';
import { acquirePage, annotWriter, docPtrOf, rawCall, withWideString } from './pdfium';

const FPDF_ANNOT_FILEATTACHMENT = 17;
const APPEARANCE_NORMAL = 0;

/** What the main thread passes as the create call's context (never stored in the file). */
export interface AttachFileContext {
  attachFile: { name: string; data: ArrayBuffer };
}

export function isAttachFileContext(ctx: unknown): ctx is AttachFileContext {
  const f = (ctx as { attachFile?: { name?: unknown; data?: unknown } } | null | undefined)
    ?.attachFile;
  return typeof f?.name === 'string' && f.data instanceof ArrayBuffer;
}

interface AnnotArg {
  id?: unknown;
  type?: unknown;
  strokeColor?: unknown;
  color?: unknown;
}

interface DocArg {
  id: string;
}
interface PageArg {
  index: number;
}

/** Is this executor call one this module answers? */
export function isFileAttachmentCall(method: string, args: readonly unknown[]): boolean {
  if (method !== 'createPageAnnotation' && method !== 'updatePageAnnotation') return false;
  return (args[2] as AnnotArg | undefined)?.type === PdfAnnotationSubtype.FILEATTACHMENT;
}

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  HEAPU8: Uint8Array;
  HEAP32: Int32Array;
}

const heapOf = (mod: WrappedPdfiumModule): Heap => mod.pdfium as unknown as Heap;

/** The annotation's /C as `#RRGGBB`, or null. */
export function readColor(mod: WrappedPdfiumModule, annot: number): string | null {
  const heap = heapOf(mod);
  const out = heap.wasmExports.malloc(16);
  try {
    if (!rawCall(mod, 'FPDFAnnot_GetColor', annot, 0, out, out + 4, out + 8, out + 12)) return null;
    const c = [0, 1, 2].map((i) => (heap.HEAP32[(out >> 2) + i] ?? 0) & 0xff);
    return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  } finally {
    heap.wasmExports.free(out);
  }
}

const colorOf = (a: AnnotArg): string | null =>
  typeof a.strokeColor === 'string' ? a.strokeColor : typeof a.color === 'string' ? a.color : null;

/** Writes /Rect, /C, /Name, the base keys and the paperclip appearance. */
function writeCommon(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  doc: DocArg,
  page: PageArg & { rect?: unknown },
  pagePtr: number,
  annot: number,
  object: AnnotArg & { rect?: unknown },
): boolean {
  const w = annotWriter(native);
  if (!w.setRect(doc, page, annot, object.rect)) return false;
  const color = colorOf(object) ?? readColor(mod, annot) ?? ATTACH_DEFAULT_COLOR;
  if (!w.setColor(annot, color)) return false;
  if (!w.setIcon(annot, PdfAnnotationName.Paperclip)) return false;
  if (!w.applyBase(doc, page, pagePtr, annot, object)) return false;
  const r = w.readRect(annot);
  const ap = paperclipAppearance(
    { left: r.left, bottom: r.bottom, right: r.right, top: r.top },
    color,
  );
  return Boolean(
    withWideString(mod, ap, (p) => rawCall(mod, 'FPDFAnnot_SetAP', annot, APPEARANCE_NORMAL, p)),
  );
}

/** `createPageAnnotation` for a FileAttachment: resolves the annotation's /NM. */
export function createFileAttachment(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  args: readonly unknown[],
): string {
  const doc = args[0] as DocArg;
  const page = args[1] as PageArg;
  const object = args[2] as AnnotArg & { rect?: unknown };
  const ctx = args[3];
  if (!isAttachFileContext(ctx)) throw new RpcError('attach-no-file', 'No file to attach');
  const { name, data } = ctx.attachFile;
  if (data.byteLength > ATTACH_MAX_BYTES)
    throw new RpcError('attach-too-large', 'The file is larger than the limit');
  const id = typeof object.id === 'string' && object.id ? object.id : crypto.randomUUID();
  const w = annotWriter(native);
  const ref = acquirePage(native, doc.id, page.index);
  const heap = heapOf(mod);
  try {
    const a = rawCall(mod, 'EPDFPage_CreateAnnot', ref.pagePtr, FPDF_ANNOT_FILEATTACHMENT);
    if (!a) throw new RpcError('attach-failed', 'The annotation could not be created');
    let ok = false;
    try {
      ok = Boolean(
        withWideString(mod, id, (p) => rawCall(mod, 'FPDFAnnot_SetStringValue', a, 'NM', p)),
      );
      const att = ok
        ? withWideString(mod, name, (p) => rawCall(mod, 'FPDFAnnot_AddFileAttachment', a, p))
        : 0;
      if (att) {
        const buf = heap.wasmExports.malloc(Math.max(1, data.byteLength));
        try {
          heap.HEAPU8.set(new Uint8Array(data), buf);
          const docPtr = docPtrOf(native, doc.id);
          ok = Boolean(rawCall(mod, 'FPDFAttachment_SetFile', att, docPtr, buf, data.byteLength));
        } finally {
          heap.wasmExports.free(buf);
        }
      } else ok = false;
      ok = ok && writeCommon(mod, native, doc, page, ref.pagePtr, a, { ...object, id });
    } finally {
      rawCall(mod, 'FPDFPage_CloseAnnot', a);
    }
    if (!ok) {
      w.removeByName(ref.pagePtr, id);
      throw new RpcError('attach-failed', 'The annotation could not be created');
    }
  } finally {
    ref.release();
  }
  return id;
}

/** `updatePageAnnotation` for a FileAttachment: move/resize, colour, contents, flags. */
export function updateFileAttachment(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  args: readonly unknown[],
): true {
  const doc = args[0] as DocArg;
  const page = args[1] as PageArg;
  const object = args[2] as AnnotArg & { rect?: unknown };
  if (typeof object.id !== 'string') throw new RpcError('annotation-missing', 'No such annotation');
  const w = annotWriter(native);
  const ref = acquirePage(native, doc.id, page.index);
  try {
    const a = w.byName(ref.pagePtr, object.id);
    if (!a) throw new RpcError('annotation-missing', 'No such annotation');
    try {
      if (!writeCommon(mod, native, doc, page, ref.pagePtr, a, object))
        throw new RpcError('attach-failed', 'The annotation could not be updated');
    } finally {
      rawCall(mod, 'FPDFPage_CloseAnnot', a);
    }
  } finally {
    ref.release();
  }
  return true;
}

/** The embedded file of the page's FileAttachment named `id` (Save Attachment…). */
export function readFileAttachment(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  docId: string,
  pageIndex: number,
  id: string,
): { name: string; data: ArrayBuffer } {
  const w = annotWriter(native);
  const ref = acquirePage(native, docId, pageIndex);
  try {
    const a = w.byName(ref.pagePtr, id);
    if (!a) throw new RpcError('attachment-missing', 'No such attachment');
    try {
      if (rawCall(mod, 'FPDFAnnot_GetSubtype', a) !== FPDF_ANNOT_FILEATTACHMENT)
        throw new RpcError('attachment-missing', 'No such attachment');
      const att = rawCall(mod, 'FPDFAnnot_GetFileAttachment', a);
      if (!att) throw new RpcError('attachment-missing', 'No such attachment');
      return {
        name: readWide(mod, (buf, len) => rawCall(mod, 'FPDFAttachment_GetName', att, buf, len)),
        data: fileBytes(mod, att),
      };
    } finally {
      rawCall(mod, 'FPDFPage_CloseAnnot', a);
    }
  } finally {
    ref.release();
  }
}

/**
 * /C of the page's FileAttachment annotations by /NM: EmbedPDF's reader keeps
 * only the base keys for this subtype, so the Work worker's listing adds the
 * colour (the Properties pane shows and edits it).
 */
export function fileAttachmentColors(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  docId: string,
  pageIndex: number,
): Map<string, string> {
  const out = new Map<string, string>();
  const ref = acquirePage(native, docId, pageIndex);
  try {
    const n = rawCall(mod, 'FPDFPage_GetAnnotCount', ref.pagePtr);
    for (let i = 0; i < n; i++) {
      const a = rawCall(mod, 'FPDFPage_GetAnnot', ref.pagePtr, i);
      if (!a) continue;
      try {
        if (rawCall(mod, 'FPDFAnnot_GetSubtype', a) !== FPDF_ANNOT_FILEATTACHMENT) continue;
        const color = readColor(mod, a);
        const nm = readAnnotString(mod, a, 'NM');
        if (color && nm) out.set(nm, color);
      } finally {
        rawCall(mod, 'FPDFPage_CloseAnnot', a);
      }
    }
  } finally {
    ref.release();
  }
  return out;
}
