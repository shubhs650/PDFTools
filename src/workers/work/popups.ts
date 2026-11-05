// Sticky note pop-ups' open state (M7-06, spike S23): /Open is a boolean, which
// PDFium can't read, so the Work worker reads it from the document's current
// bytes with our own reader. The Render worker lists the pop-ups (object
// numbers, /Rect); a pop-up the file doesn't have yet, or without /Open, is closed.
import { isDict, type PdfValue } from '../../model/pdf/objects';
import type { PdfReader } from '../../model/pdf/reader';

/** Whether each pop-up object (by number) is open; false for anything else. */
export async function popupStates(reader: PdfReader, objs: readonly number[]): Promise<boolean[]> {
  const out: boolean[] = [];
  for (const num of objs) {
    let v: PdfValue = null;
    try {
      v = num > 0 && reader.xref.has(num) ? await reader.get(num) : null;
    } catch {
      v = null;
    }
    out.push(isDict(v) && v.get('Open') === true);
  }
  return out;
}
