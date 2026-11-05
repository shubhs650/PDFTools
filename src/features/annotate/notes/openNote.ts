// Opening a sticky note's window from a command (M7-06, D-44): Open Popup in
// the comment menus and the Comments pane, Enter or F2 on a selected note, and
// a double-click on the note.
import { PdfAnnotationSubtype, type PdfAnnotationObject } from '@embedpdf/models';
import { selectedRoots } from '../comments/threadActions';
import { annotationCapability } from '../selection';
import { openNotePopup } from './notePopupStore';

/** The selected sticky note (a selected reply stands for its note), if one alone is selected. */
export function selectedNote(docId: string): PdfAnnotationObject | null {
  const roots = selectedRoots(docId);
  const [only] = roots;
  return roots.length === 1 && only?.type === PdfAnnotationSubtype.TEXT && !only.inReplyToId
    ? only
    : null;
}

/** Opens (or brings forward) the selected note's window, the caret in its text. */
export function openSelectedNote(docId: string): boolean {
  const note = selectedNote(docId);
  if (!note) return false;
  openNotePopup(docId, note, { focus: true });
  return true;
}

/**
 * The sticky note a double-click is on. The first click selects the note, and
 * from then on the plugin's selection frame (a sibling of the note's body, in
 * the same container) takes the presses, so the container is what is matched.
 */
function noteAt(target: EventTarget | null): { docId: string; note: PdfAnnotationObject } | null {
  if (!(target instanceof Element) || target.closest('[data-note-popup]')) return null;
  const body = target
    .closest('[data-no-interaction]')
    ?.querySelector<HTMLElement>('.annotation-body[data-annotation-id]');
  const docId = body?.closest<HTMLElement>('[data-doc-id]')?.dataset['docId'];
  const id = body?.dataset['annotationId'];
  if (!docId || !id) return null;
  try {
    const obj = annotationCapability()?.forDocument(docId).getAnnotationById(id)?.object;
    return obj?.type === PdfAnnotationSubtype.TEXT && !obj.inReplyToId
      ? { docId, note: obj }
      : null;
  } catch {
    return null;
  }
}

/** A double-click on a sticky note opens its window (B12). Called once at startup. */
export function installNoteDoubleClick(): () => void {
  const onDouble = (e: MouseEvent): void => {
    const hit = noteAt(e.target);
    if (!hit) return;
    openNotePopup(hit.docId, hit.note, { focus: true });
  };
  document.addEventListener('dblclick', onDouble);
  return () => {
    document.removeEventListener('dblclick', onDouble);
  };
}
