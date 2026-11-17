// Select Text and Hand on a text markup (M11-06, ADR-028 D-51, owner's Q6):
// a press that turns into a drag selects the text under the highlight (so
// highlighted text can still be copied) or, with Hand, pans (a markup cannot
// move), and a click without a drag selects the markup. The plugin selects a
// comment on the press, so with these tools the markups let presses through
// to the page (app.css: `[data-markup]`) and the click is matched to a markup
// here, by its line boxes. A right press selects it at once, so the comment
// menu opens on it.
import { appStore } from '../../app/store/appStore';
import { onTextSelectionAt } from '../select/textSelection';
import { pagePointAt } from '../view/pagePoint';
import { isClick, markupAt } from './pointerModes';
import { annotationCapability, annotationState } from './selection';

/** A control or another comment on top takes the press itself. */
const OWN_PRESS =
  '.annotation-layer [data-no-interaction], button, a, input, textarea, select, [contenteditable="true"], [role="button"]';

function docOf(target: EventTarget | null): string | null {
  if (!(target instanceof Element) || !target.closest('.page-content')) return null;
  if (target.closest(OWN_PRESS)) return null;
  return target.closest<HTMLElement>('[data-doc-id]')?.dataset['docId'] ?? null;
}

/** The markup under a screen point of a document's view, if any. */
function markupUnder(docId: string, x: number, y: number) {
  const at = pagePointAt(docId, x, y);
  const st = annotationState(docId);
  if (!at || !st) return null;
  const o = markupAt(st, at.page, at);
  return o ? { id: o.id, page: at.page } : null;
}

function select(docId: string, hit: { id: string; page: number }, toggle: boolean): void {
  try {
    const scope = annotationCapability()?.forDocument(docId);
    if (!scope) return;
    if (toggle) scope.toggleSelection(hit.page, hit.id);
    else scope.selectAnnotation(hit.page, hit.id);
  } catch {
    // The document closed meanwhile.
  }
}

/** The tools whose presses pass through markups (Space held is Hand too). */
const passesMarkups = (): boolean => {
  const s = appStore.getState();
  return s.tool === 'selectText' || s.tool === 'hand' || s.spaceHand;
};

/** Called once at startup (DocumentHost); returns the uninstall. */
export function installMarkupPointer(): () => void {
  let press: { docId: string; x: number; y: number; id: number; toggle: boolean } | null = null;

  const onDown = (e: PointerEvent): void => {
    press = null;
    if (!e.isTrusted || !passesMarkups()) return;
    const docId = docOf(e.target);
    if (!docId) return;
    if (e.button === 2) {
      // On selected text, the selected-text menu opens instead (M11-08·O1).
      if (onTextSelectionAt(docId, e.clientX, e.clientY)) return;
      // Before the contextmenu event: the comment menu opens on the markup.
      const hit = markupUnder(docId, e.clientX, e.clientY);
      const selected = annotationCapability()?.forDocument(docId).getSelectedAnnotationIds();
      if (hit && !selected?.includes(hit.id)) select(docId, hit, false);
      return;
    }
    if (e.button !== 0) return;
    press = {
      docId,
      x: e.clientX,
      y: e.clientY,
      id: e.pointerId,
      toggle: e.shiftKey || e.ctrlKey || e.metaKey,
    };
  };
  const onUp = (e: PointerEvent): void => {
    const p = press;
    press = null;
    if (p?.id !== e.pointerId || !passesMarkups()) return;
    if (!isClick(e.clientX - p.x, e.clientY - p.y)) return;
    const hit = markupUnder(p.docId, e.clientX, e.clientY);
    // After the page's own handlers (the plugins clear on the press): a
    // timer, so the selection made here is the last word.
    if (hit)
      setTimeout(() => {
        select(p.docId, hit, p.toggle);
      }, 0);
  };
  const onCancel = (): void => {
    press = null;
  };
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onCancel, true);
  return () => {
    window.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
  };
}
