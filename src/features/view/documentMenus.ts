// The document's context menus (M6-02, ADR-021 D-38 a): their items, which
// menu a right click opens, and the keyboard's way in. The component is
// DocumentMenu.tsx.
import { PdfAnnotationState, type PdfAnnotationObject } from '@embedpdf/models';
import type { PagePoint } from '../../app/commands/dispatch';
import type { ContextMenuEntry, MenuChoice } from '../../ui/components';
import { objectsOf } from '../annotate/comments/commentsStore';
import { STATUS_KEYS } from '../annotate/comments/statusLabels';
import { setStatus } from '../annotate/comments/threadActions';
import { annotationState } from '../annotate/selection';
import { rootsOf } from '../annotate/transfer/copyPaste';
import { clientPointOf, pageInView, viewOf, type Point } from './pagePoint';

/** The statuses the menu sets (as the Comments pane's thread does). */
const STATUSES = [
  PdfAnnotationState.None,
  PdfAnnotationState.Accepted,
  PdfAnnotationState.Rejected,
  PdfAnnotationState.Cancelled,
  PdfAnnotationState.Completed,
] as const;

const sep = (key: string): ContextMenuEntry => ({ kind: 'separator', key });
const cmd = (id: string): ContextMenuEntry => ({ kind: 'command', id });

/** A comment on the page (and its card). Later tasks add their items here (Flatten: D-38 c). */
export function commentMenu(docId: string): ContextMenuEntry[] {
  return [
    cmd('edit.cut'),
    cmd('edit.copy'),
    cmd('edit.paste'),
    cmd('comment.delete'),
    sep('thread'),
    cmd('comment.reply'),
    { kind: 'submenu', id: 'comment.setStatus', choices: statusChoices(docId) },
    cmd('comment.toggleMarked'),
    sep('flags'),
    cmd('comment.toggleLocked'),
    cmd('comment.togglePrintable'),
    sep('style'),
    cmd('comment.copyStyle'),
    cmd('comment.applyStyle'),
    cmd('comment.makeDefault'),
    sep('properties'),
    cmd('edit.properties'),
  ];
}

/** The page background. */
export const PAGE_MENU: readonly ContextMenuEntry[] = [
  cmd('edit.paste'),
  cmd('edit.selectAll'),
  sep('tools'),
  cmd('home.hand'),
  cmd('home.selectText'),
  cmd('home.selectAnnotations'),
  sep('zoom'),
  cmd('view.zoomIn'),
  cmd('view.zoomOut'),
  cmd('view.fitPage'),
  cmd('view.fitWidth'),
  sep('rotate'),
  cmd('view.rotateCw'),
  sep('properties'),
  cmd('edit.properties'),
];

export function selectedComments(docId: string): PdfAnnotationObject[] {
  const st = annotationState(docId);
  if (!st) return [];
  return st.selectedUids
    .map((uid) => st.byUid[uid]?.object)
    .filter((o): o is PdfAnnotationObject => o !== undefined);
}

function statusChoices(docId: string): MenuChoice[] {
  return STATUSES.map((state) => ({
    key: state,
    label: STATUS_KEYS[state],
    onSelect: () => {
      // The thread root of the first selected comment (a selected reply sets its comment's).
      const st = annotationState(docId);
      const all = st ? objectsOf(st.byUid) : [];
      const [root] = rootsOf(selectedComments(docId), all);
      const parent = all.find((a) => a.id === root);
      if (parent) void setStatus(docId, parent, state);
    },
  }));
}

/** Points of slack around a comment's rect for a right click to count as on it. */
const HIT_SLACK = 4;

/** Whether a page point is on one of the selected comments (the plugin selects on pointerdown). Pure. */
export function onSelectedComment(
  at: Pick<PagePoint, 'page' | 'x' | 'y'>,
  selection: readonly Pick<PdfAnnotationObject, 'pageIndex' | 'rect'>[],
): boolean {
  return selection.some(
    (a) =>
      a.pageIndex === at.page &&
      at.x >= a.rect.origin.x - HIT_SLACK &&
      at.x <= a.rect.origin.x + a.rect.size.width + HIT_SLACK &&
      at.y >= a.rect.origin.y - HIT_SLACK &&
      at.y <= a.rect.origin.y + a.rect.size.height + HIT_SLACK,
  );
}

/** Where a keyboard-opened menu appears: on the selected comment in view, else mid-view. */
export function keyboardAnchor(docId: string): Point | null {
  for (const a of selectedComments(docId)) {
    if (!pageInView(docId, a.pageIndex)) continue;
    const p = clientPointOf(docId, a.pageIndex, {
      x: a.rect.origin.x + a.rect.size.width / 2,
      y: a.rect.origin.y + a.rect.size.height / 2,
    });
    if (p) return p;
  }
  const r = viewOf(docId)?.getBoundingClientRect();
  return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
}

export const openers = new Map<string, () => void>();

/** Shift+F10 / the Menu key in the document (keymap `menu.context`). */
export function openDocumentMenu(docId: string): void {
  openers.get(docId)?.();
}
