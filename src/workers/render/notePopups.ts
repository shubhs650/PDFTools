// Sticky note pop-ups in the Render worker (M7-06, ADR-023 D-44, spike S23).
// A note's pop-up window is saved as a standard /Popup annotation, as Acrobat
// and PDF-XChange write it: /Parent → the note, the note's /Popup → it, /Rect
// where the window is, /Open whether it is open. EmbedPDF 2.15.1 neither reads
// nor writes /Popup, so this is direct PDFium (ADR-001 B14): PDFium creates
// the annotation, links both ways and (in an encrypted file) encrypts its /NM;
// /Open is a boolean PDFium can't write, so our object layer stages it
// (ADR-007), keyed by the pop-up's /NM. PDFium can't read a boolean either: the
// Work worker reads /Open from the file (`popupStates`).
//
// Deleting a comment removes its pop-up too (EmbedPDF removes only the
// comment, which left Acrobat files with orphan pop-ups).
import type { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { RpcError } from '../../engine/errors';
import { stableAnnotId } from '../shared/annotId';
import { ensureName } from './annotIds';
import { readAnnotString } from './annotTiles';
import { acquirePage, annotWriter, rawCall, withWideString, type DeviceRect } from './pdfium';

const FPDF_ANNOT_TEXT = 1;
const FPDF_ANNOT_POPUP = 16;
/** NoZoom | NoRotate, as Acrobat flags its pop-ups (never Print: a window is not page content). */
const POPUP_FLAGS = 8 | 16;

interface DocArg {
  id: string;
}
interface PageArg {
  index: number;
}

/** A note's pop-up as the page has it. */
export interface NotePopupInfo {
  /** The note's /NM. */
  noteId: string;
  /** The pop-up's /NM, if it has one (reading never writes one: the file stays as it was). */
  popupId: string | null;
  /** The pop-up's object number (the Work worker reads /Open by it). */
  obj: number;
  rect: DeviceRect;
}

const close = (mod: WrappedPdfiumModule, annot: number): void => {
  if (annot) rawCall(mod, 'FPDFPage_CloseAnnot', annot);
};

const isReply = (mod: WrappedPdfiumModule, annot: number): boolean => {
  const parent = rawCall(mod, 'FPDFAnnot_GetLinkedAnnot', annot, 'IRT');
  close(mod, parent);
  return parent !== 0;
};

/** A pop-up's /NM, written when it has none (a file from another viewer). */
function popupName(mod: WrappedPdfiumModule, popup: number): string {
  const nm = readAnnotString(mod, popup, 'NM');
  if (nm) return nm;
  const id = crypto.randomUUID();
  withWideString(mod, id, (p) => rawCall(mod, 'FPDFAnnot_SetStringValue', popup, 'NM', p));
  return id;
}

/** The sticky notes on a page that have a pop-up (replies have none of their own). */
export function listNotePopups(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  doc: DocArg,
  page: PageArg,
): NotePopupInfo[] {
  const w = annotWriter(native);
  const out: NotePopupInfo[] = [];
  const ref = acquirePage(native, doc.id, page.index);
  try {
    const count = rawCall(mod, 'FPDFPage_GetAnnotCount', ref.pagePtr);
    for (let i = 0; i < count; i++) {
      const a = rawCall(mod, 'FPDFPage_GetAnnot', ref.pagePtr, i);
      if (!a) continue;
      try {
        if (rawCall(mod, 'FPDFAnnot_GetSubtype', a) !== FPDF_ANNOT_TEXT || isReply(mod, a))
          continue;
        // Without /NM, the stable id both workers list it by (ADR-014 d2).
        const noteId =
          readAnnotString(mod, a, 'NM') ||
          stableAnnotId(rawCall(mod, 'EPDFAnnot_GetObjectNumber', a), page.index, i);
        const popup = rawCall(mod, 'FPDFAnnot_GetLinkedAnnot', a, 'Popup');
        if (!noteId || !popup) {
          close(mod, popup);
          continue;
        }
        try {
          if (rawCall(mod, 'FPDFAnnot_GetSubtype', popup) !== FPDF_ANNOT_POPUP) continue;
          out.push({
            noteId,
            popupId: readAnnotString(mod, popup, 'NM') || null,
            obj: rawCall(mod, 'EPDFAnnot_GetObjectNumber', popup),
            rect: w.toDeviceRect(doc, page, w.readRect(popup)),
          });
        } finally {
          close(mod, popup);
        }
      } finally {
        close(mod, a);
      }
    }
  } finally {
    ref.release();
  }
  return out;
}

/**
 * Creates the note's pop-up, or moves an existing one, to `rect` (device
 * space). Returns the pop-up's /NM; the caller records the change with the
 * save tracker (the page's /Annots, the note's /Popup, the pop-up) and stages
 * /Open.
 */
export function placeNotePopup(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  doc: DocArg,
  page: PageArg,
  noteId: string,
  rect: DeviceRect,
): { popupId: string; created: boolean } {
  const w = annotWriter(native);
  ensureName(mod, native, doc.id, page.index, noteId);
  const ref = acquirePage(native, doc.id, page.index);
  try {
    const note = w.byName(ref.pagePtr, noteId);
    if (!note) throw new RpcError('annotation-missing', 'No such annotation');
    try {
      if (rawCall(mod, 'FPDFAnnot_GetSubtype', note) !== FPDF_ANNOT_TEXT)
        throw new RpcError('annotation-type', 'Only sticky notes have a pop-up window');
      let popup = rawCall(mod, 'FPDFAnnot_GetLinkedAnnot', note, 'Popup');
      if (popup && rawCall(mod, 'FPDFAnnot_GetSubtype', popup) !== FPDF_ANNOT_POPUP) {
        close(mod, popup);
        popup = 0;
      }
      const created = popup === 0;
      if (created) {
        popup = rawCall(mod, 'EPDFPage_CreateAnnot', ref.pagePtr, FPDF_ANNOT_POPUP);
        if (!popup) throw new RpcError('popup-failed', 'The pop-up could not be created');
      }
      try {
        const popupId = popupName(mod, popup);
        const ok =
          w.setRect(doc, page, popup, rect) &&
          (!created ||
            (Boolean(rawCall(mod, 'FPDFAnnot_SetFlags', popup, POPUP_FLAGS)) &&
              Boolean(rawCall(mod, 'EPDFAnnot_SetLinkedAnnot', popup, 'Parent', note)) &&
              Boolean(rawCall(mod, 'EPDFAnnot_SetLinkedAnnot', note, 'Popup', popup))));
        if (!ok) {
          if (created) removeAnnot(mod, ref.pagePtr, popup);
          throw new RpcError('popup-failed', 'The pop-up could not be written');
        }
        return { popupId, created };
      } finally {
        close(mod, popup);
      }
    } finally {
      close(mod, note);
    }
  } finally {
    ref.release();
  }
}

function removeAnnot(mod: WrappedPdfiumModule, pagePtr: number, annot: number): void {
  const index = rawCall(mod, 'FPDFPage_GetAnnotIndex', pagePtr, annot);
  if (index >= 0) rawCall(mod, 'FPDFPage_RemoveAnnot', pagePtr, index);
}

/**
 * Before a comment is removed (`removePageAnnotation`): removes its pop-up,
 * so no pop-up is left pointing at a deleted comment. True if one went.
 */
export function removePopupOf(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  docId: string,
  pageIndex: number,
  id: string,
): boolean {
  const w = annotWriter(native);
  const ref = acquirePage(native, docId, pageIndex);
  try {
    const a = w.byName(ref.pagePtr, id);
    if (!a) return false;
    let popup = 0;
    try {
      popup = rawCall(mod, 'FPDFAnnot_GetLinkedAnnot', a, 'Popup');
      if (!popup || rawCall(mod, 'FPDFAnnot_GetSubtype', popup) !== FPDF_ANNOT_POPUP) return false;
      // Close our handles before the removal invalidates the pop-up's.
      const index = rawCall(mod, 'FPDFPage_GetAnnotIndex', ref.pagePtr, popup);
      close(mod, popup);
      popup = 0;
      return index >= 0 && Boolean(rawCall(mod, 'FPDFPage_RemoveAnnot', ref.pagePtr, index));
    } finally {
      close(mod, popup);
      close(mod, a);
    }
  } finally {
    ref.release();
  }
}
