// Annotation commands (M3-05, §7.1, §8.1): Select Comments, undo/redo per
// document (plugin-history, ADR-014 decision 4), delete, nudge with the arrow
// keys and cycle with Tab. Every change needs the annotate permission (rule 9);
// the Render worker refuses independently (M1-20).
import type { AnnotationCapability } from '@embedpdf/plugin-annotation';
import type { HistoryCapability } from '@embedpdf/plugin-history';
import { notify, registerCommand, type CommandHandler } from '../../app/commands/dispatch';
import { appStore } from '../../app/store/appStore';
import { documentStore, selectActive } from '../../app/store/documentStore';
import { msg } from '../../i18n';
import { openProfileDialog } from '../settings/profile/profileStore';
import { capability, hostStore } from '../view/host';
import { annotationCapability, annotationState } from './selection';
import { cycleTarget, pageAnnotations } from './model';

const activeId = (): string | null => selectActive(documentStore.getState())?.meta.id ?? null;

function history(docId: string) {
  const registry = hostStore.getState().registry;
  if (!registry) return null;
  try {
    return capability<HistoryCapability>(registry, 'history').forDocument(docId);
  } catch {
    return null;
  }
}

function scope(docId: string) {
  try {
    return annotationCapability()?.forDocument(docId) ?? null;
  } catch {
    return null;
  }
}

const selectedOf = (docId: string) => scope(docId)?.getSelectedAnnotations() ?? [];

/** Page annotations the keyboard can reach: drawable, not replies, not links or widgets. */
function reachable(docId: string, pageIndex: number) {
  const st = annotationState(docId);
  return st ? pageAnnotations(st, pageIndex) : [];
}

/** Moves the selected annotations by (dx, dy) points; the plugin moves vertices too. */
export function nudge(dx: number, dy: number): void {
  const id = activeId();
  if (!id) return;
  const s = scope(id);
  for (const t of selectedOf(id))
    s?.moveAnnotation(t.object.pageIndex, t.object.id, { x: dx, y: dy }, 'delta');
}

const withSelection: Pick<CommandHandler, 'requires' | 'disabledReason'> = {
  requires: 'annotate',
  disabledReason: () => {
    const id = activeId();
    return id && selectedOf(id).length > 0 ? null : msg('annotate.noneSelected');
  },
};

/** 1 pt per arrow key, 10 with Shift (§8.1 conventions). */
const STEP = 1;
const BIG_STEP = 10;

export function registerAnnotateCommands(): () => void {
  const cycle = (dir: 1 | -1): CommandHandler => ({
    requiresDocument: true,
    disabledReason: () => {
      const id = activeId();
      if (!id) return msg('ribbon.needsDocument');
      const t = appStore.getState().tool;
      if (t !== 'select' && t !== 'selectObjects') return msg('annotate.noneSelected');
      const page = documentStore.getState().docs[id]?.view.page ?? 0;
      const current = selectedOf(id)[0]?.object.id ?? null;
      // Past the last (or first) annotation, Tab leaves the document as usual (rule 12).
      return cycleTarget(reachable(id, page), current, dir) ? null : msg('annotate.noneSelected');
    },
    run: () => {
      const id = activeId();
      if (!id) return;
      const page = documentStore.getState().docs[id]?.view.page ?? 0;
      const current = selectedOf(id)[0]?.object.id ?? null;
      const next = cycleTarget(reachable(id, page), current, dir);
      if (next) scope(id)?.selectAnnotation(page, next.id);
    },
  });
  const offs = [
    registerCommand('home.selectAnnotations', {
      run: () => {
        appStore.getState().setTool('selectObjects');
      },
      isPressed: () => appStore.getState().tool === 'selectObjects',
    }),
    registerCommand('qat.undo', {
      requiresDocument: true,
      disabledReason: () => {
        const id = activeId();
        return id && history(id)?.canUndo() ? null : msg('annotate.nothingToUndo');
      },
      run: () => {
        const id = activeId();
        if (id) history(id)?.undo();
      },
    }),
    registerCommand('qat.redo', {
      requiresDocument: true,
      disabledReason: () => {
        const id = activeId();
        return id && history(id)?.canRedo() ? null : msg('annotate.nothingToRedo');
      },
      run: () => {
        const id = activeId();
        if (id) history(id)?.redo();
      },
    }),
    registerCommand('comment.reviewerProfile', {
      run: openProfileDialog,
    }),
    registerCommand('annotation.delete', {
      ...withSelection,
      run: () => {
        const id = activeId();
        if (!id) return;
        const sel = selectedOf(id);
        scope(id)?.deleteAnnotations(
          sel.map((t) => ({ pageIndex: t.object.pageIndex, id: t.object.id })),
        );
      },
    }),
    registerCommand('annotation.next', cycle(1)),
    registerCommand('annotation.prev', cycle(-1)),
    registerCommand('annotation.nudgeLeft', {
      ...withSelection,
      run: () => {
        nudge(-STEP, 0);
      },
    }),
    registerCommand('annotation.nudgeRight', {
      ...withSelection,
      run: () => {
        nudge(STEP, 0);
      },
    }),
    registerCommand('annotation.nudgeUp', {
      ...withSelection,
      run: () => {
        nudge(0, -STEP);
      },
    }),
    registerCommand('annotation.nudgeDown', {
      ...withSelection,
      run: () => {
        nudge(0, STEP);
      },
    }),
    registerCommand('annotation.nudgeLeftFar', {
      ...withSelection,
      run: () => {
        nudge(-BIG_STEP, 0);
      },
    }),
    registerCommand('annotation.nudgeRightFar', {
      ...withSelection,
      run: () => {
        nudge(BIG_STEP, 0);
      },
    }),
    registerCommand('annotation.nudgeUpFar', {
      ...withSelection,
      run: () => {
        nudge(0, -BIG_STEP);
      },
    }),
    registerCommand('annotation.nudgeDownFar', {
      ...withSelection,
      run: () => {
        nudge(0, BIG_STEP);
      },
    }),
  ];
  // Undo/redo, delete and nudge availability follow the history and the
  // selection: the ribbon and the keymap re-read command states.
  let offPlugins = (): void => undefined;
  const watch = (): void => {
    const registry = hostStore.getState().registry;
    if (!registry) return;
    try {
      const a = capability<AnnotationCapability>(registry, 'annotation').onStateChange(notify);
      const h = capability<HistoryCapability>(registry, 'history').onHistoryChange(notify);
      offPlugins = () => {
        a();
        h();
      };
    } catch {
      // Plugins not ready yet: the registry subscription tries again.
    }
  };
  watch();
  const offRegistry = hostStore.subscribe((st, prev) => {
    if (st.registry !== prev.registry) {
      offPlugins();
      watch();
    }
  });
  return () => {
    offRegistry();
    offPlugins();
    for (const off of offs) off();
  };
}

/** Esc (§8.1) also drops the annotation selection. */
export function deselectAnnotations(): void {
  const id = activeId();
  if (id) scope(id)?.deselectAnnotation();
}
