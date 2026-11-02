// Annotation flags and review marks (M6-06, ADR-021 D-38 f): Read only,
// Printable and Locked are /F bits of the comment; Marked is the reviewer's
// own tick, a hidden /StateModel /Marked reply as Acrobat writes it. The
// Properties pane and the comment menu both change them here; each change to
// a selection is one undo step.
import { PdfAnnotationState, uuidV4, type PdfAnnotationObject } from '@embedpdf/models';
import { STATUS_KEYS } from '../comments/statusLabels';
import { t, msg, type MessageKey } from '../../../i18n';
import { requestProfile } from '../../settings/profile/profileStore';
import { currentAuthor } from '../authoring';
import { objectsOf } from '../comments/commentsStore';
import { selectedRoots } from '../comments/threadActions';
import { isMarkedBy, makeMark } from '../comments/thread';
import { joinStep } from '../historyJoin';
import { annotationCapability, annotationState } from '../selection';
import { flagPatch, hasFlag, isFixed, type Flag } from './model';

const scope = (docId: string) => annotationCapability()?.forDocument(docId) ?? null;

/** Flag `f` on or off for `targets` (one undo step). */
export function setFlag(
  docId: string,
  targets: readonly PdfAnnotationObject[],
  f: Flag,
  on: boolean,
): void {
  const patches = targets
    .filter((a) => hasFlag(a, f) !== on)
    .map((a) => ({ pageIndex: a.pageIndex, id: a.id, patch: flagPatch(a, f, on) }));
  if (patches.length) scope(docId)?.updateAnnotations(patches);
}

/** Whether every one of `targets` has flag `f` (the menu's tick). */
export const allFlagged = (targets: readonly PdfAnnotationObject[], f: Flag): boolean =>
  targets.length > 0 && targets.every((a) => hasFlag(a, f));

/** The current reviewer's mark on each of `roots`. */
export function marksOf(docId: string, roots: readonly PdfAnnotationObject[]): boolean[] {
  const st = annotationState(docId);
  const all = st ? objectsOf(st.byUid) : [];
  const me = currentAuthor();
  return roots.map((r) => isMarkedBy(all, r.id, me));
}

/** Marks (or unmarks) `roots` for the current reviewer: one hidden state reply each, one undo step. */
export async function setMarked(
  docId: string,
  roots: readonly PdfAnnotationObject[],
  marked: boolean,
): Promise<void> {
  await requestProfile();
  const author = currentAuthor();
  const now = new Date();
  const state = t(STATUS_KEYS[marked ? PdfAnnotationState.Marked : PdfAnnotationState.Unmarked]);
  const current = marksOf(docId, roots);
  const changed = roots.filter((_, i) => current[i] !== marked);
  changed.forEach((r, i) => {
    const mark = makeMark(
      r,
      marked,
      author,
      t('comments.stateSetBy', { state, author }),
      now,
      uuidV4(),
    );
    const create = () => scope(docId)?.createAnnotation(r.pageIndex, mark);
    if (i === 0) create();
    else joinStep(create);
  });
}

/** The thread roots the menu's flag commands act on. */
export const flagTargets = (docId: string): PdfAnnotationObject[] => selectedRoots(docId);

/**
 * Why a selection can't be moved, resized, deleted or restyled (null: it
 * can): a Locked or Read only comment stays as it is until unlocked.
 */
export function fixedReason(sel: readonly Pick<PdfAnnotationObject, 'flags'>[]): MessageKey | null {
  if (sel.some((a) => hasFlag(a, 'readOnly'))) return msg('annotProps.readOnlyReason');
  if (sel.some(isFixed)) return msg('annotProps.lockedReason');
  return null;
}
