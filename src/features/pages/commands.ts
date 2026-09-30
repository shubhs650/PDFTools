// Organize → Rotate Clockwise / Counterclockwise, Delete Pages, Insert Blank
// Page (M4-09, §7.8). They act on the pages selected in the Thumbnails pane,
// else on the current page. Page operations need the assemble permission
// (rule 9, ADR-016 decision 9); while one runs, or the document is saving,
// the commands are disabled with the reason.
import { notify, registerCommand } from '../../app/commands/dispatch';
import { documentStore } from '../../app/store/documentStore';
import { format, msg, t } from '../../i18n';
import { openPageDialog } from './dialogStore';
import { announce, pageOpBlocked, pagesStore, runPageOp } from './pageOps';
import { targetPages } from './selection';

const activeId = (): string | null => documentStore.getState().activeId;

/** Busy/saving reasons; the permission itself is checked by `requires`. */
function blocked() {
  const id = activeId();
  if (!id) return null;
  const why = pageOpBlocked(id);
  return why === msg('pages.restricted') ? null : why;
}

export function rotatePages(docId: string, quarter: 1 | 3): Promise<boolean> {
  return runPageOp(
    docId,
    { kind: 'rotate', pages: targetPages(docId), quarter },
    msg('pages.rotating'),
  );
}

export function registerPageCommands(): () => void {
  const common = { requiresDocument: true, requires: 'assemble' as const, disabledReason: blocked };
  const offs = [
    registerCommand('organize.rotateCw', {
      ...common,
      run: () => {
        const id = activeId();
        if (id) void rotatePages(id, 1);
      },
    }),
    registerCommand('organize.rotateCcw', {
      ...common,
      run: () => {
        const id = activeId();
        if (id) void rotatePages(id, 3);
      },
    }),
    registerCommand('organize.delete', {
      ...common,
      run: () => {
        const id = activeId();
        if (id) openPageDialog('delete', id);
      },
    }),
    registerCommand('organize.move', {
      ...common,
      run: () => {
        const id = activeId();
        if (id) openPageDialog('move', id);
      },
    }),
    registerCommand('organize.insertBlank', {
      ...common,
      run: () => {
        const id = activeId();
        if (id) openPageDialog('insertBlank', id);
      },
    }),
  ];
  // Busy and saving states change the commands' enabled state.
  const off = pagesStore.subscribe((s, prev) => {
    if (s.busy !== prev.busy) notify();
  });
  return () => {
    off();
    for (const o of offs) o();
  };
}

/**
 * Moves the pages so the first lands at `to` (M4-10) as one undo step, and
 * announces the new position (the Thumbnails pane's live region).
 */
export async function movePages(
  docId: string,
  pages: readonly number[],
  to: number,
): Promise<boolean> {
  const ok = await runPageOp(docId, { kind: 'move', pages: [...pages], to }, msg('pages.moving'));
  if (ok) {
    const page = format.number(to + 1, 0);
    announce(
      pages.length === 1
        ? t('pages.movedOne', { page })
        : t('pages.moved', { count: format.number(pages.length, 0), page }),
    );
  }
  return ok;
}
