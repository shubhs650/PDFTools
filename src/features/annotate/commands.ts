// Annotation commands (M3-05, §7.1, §8.1): Select Comments, undo/redo per
// document (plugin-history, ADR-014 decision 4), delete, nudge with the arrow
// keys and cycle with Tab. Every change needs the annotate permission (rule 9);
// the Render worker refuses independently (M1-20).
import type { AnnotationCapability } from '@embedpdf/plugin-annotation';
import type { HistoryCapability } from '@embedpdf/plugin-history';
import { pagesBusy } from '../pages/pageOps';
import { notify, registerCommand, type CommandHandler } from '../../app/commands/dispatch';
import { undoOverride } from '../../app/commands/undoOverride';
import { appStore } from '../../app/store/appStore';
import { documentStore, selectActive } from '../../app/store/documentStore';
import { msg } from '../../i18n';
import { openProfileDialog, requestProfile } from '../settings/profile/profileStore';
import { openSchemes } from '../stamps/schemes/schemeStore';
import { placeDynamicStamp, placeImageStamp } from '../stamps/stampTools';
import { stampStore } from '../stamps/stampStore';
import { loadScales, openScaleDialog, scaleStore } from '../measure/scaleStore';
import { MEASURE_COMMANDS } from '../measure/measureTools';
import { setSnapping, snapStore, toggleKind } from '../measure/snapping';
import { openCrs } from '../crs/crsExport';
import { capability, hostStore } from '../view/host';
import { annotationCapability, annotationState } from './selection';
import { cycleTarget, pageAnnotations } from './model';
import { DRAW_COMMANDS, isDrawTool, KEYBOARD_PLACED, VERTEX_TOOLS } from './tools/drawModel';
import { isSignatureTool, placeAtCentre as placeSignatureAtCentre } from '../sign/signDocument';
import { finishDrawing, placeAtCentre } from './tools/drawTools';
import { copiedStyle, copyStyle, pasteStyle } from './properties/style';
import {
  allFlagged,
  fixedReason,
  flagTargets,
  marksOf,
  setFlag,
  setMarked,
} from './properties/flagActions';
import { defaultToolOf, makeCurrentDefault } from './properties/toolProperties';
import { openStylesDialog } from './tools/commentStylesStore';
import { isStyleTool } from './tools/toolDefaults';
import type { Flag } from './properties/model';
import { commentsStore } from './comments/commentsStore';
import { deleteComments, startReply } from './comments/threadActions';
import { MARKUP_TOOLS } from './tools/markupModel';
import { markupFromSelection } from './tools/textMarkup';
import { selectionSettled } from '../select/commands';
import { openAnnotationExport } from './export/annotationExport';
import { openImportComments } from './transfer/importComments';
import {
  clipboardStore,
  copyBlocked,
  copySelectedComments,
  pasteBlocked,
  pasteComments,
} from './transfer/copyPaste';
import { flattenBlocked, transferBlocked } from '../pages/pageOps';
import { flattenSelected, flattenSelectedBlocked, openFlatten } from './flatten/flatten';

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

/** Delete, nudge, Apply Style: not on a Locked or Read only comment (M6-06). */
const withMovable: Pick<CommandHandler, 'requires' | 'disabledReason'> = {
  requires: 'annotate',
  disabledReason: () => {
    const id = activeId();
    const sel = id ? selectedOf(id).map((t) => t.object) : [];
    return sel.length > 0 ? fixedReason(sel) : msg('annotate.noneSelected');
  },
};

/** Locked / Printable in the comment menu (M6-06, D-38 f): a tick for the whole selection. */
function flagCommand(f: Flag): CommandHandler {
  return {
    requires: 'annotate',
    disabledReason: () => {
      const id = activeId();
      const targets = id ? flagTargets(id) : [];
      if (targets.length === 0) return msg('annotate.noneSelected');
      // Locked itself is always changeable; Printable not while Locked or Read only.
      return f === 'locked' ? null : fixedReason(targets);
    },
    isPressed: () => {
      const id = activeId();
      return id ? allFlagged(flagTargets(id), f) : false;
    },
    run: () => {
      const id = activeId();
      if (!id) return;
      const targets = flagTargets(id);
      setFlag(id, targets, f, !allFlagged(targets, f));
    },
  };
}

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
        const o = undoOverride();
        if (o) return o.canUndo() ? null : o.nothingToUndo;
        const id = activeId();
        if (id && pagesBusy()) return msg('pages.busy');
        return id && history(id)?.canUndo() ? null : msg('annotate.nothingToUndo');
      },
      run: () => {
        const o = undoOverride();
        if (o) {
          o.undo();
          return;
        }
        const id = activeId();
        if (id) history(id)?.undo();
      },
    }),
    registerCommand('qat.redo', {
      requiresDocument: true,
      disabledReason: () => {
        const o = undoOverride();
        if (o) return o.canRedo() ? null : o.nothingToRedo;
        const id = activeId();
        if (id && pagesBusy()) return msg('pages.busy');
        return id && history(id)?.canRedo() ? null : msg('annotate.nothingToRedo');
      },
      run: () => {
        const o = undoOverride();
        if (o) {
          o.redo();
          return;
        }
        const id = activeId();
        if (id) history(id)?.redo();
      },
    }),
    // Text markup tools (M3-08): selected text becomes the markup at once;
    // otherwise the tool turns on (profile first, M3-07) or, if on, off.
    // A Select All still reading the page's text counts as a selection.
    ...MARKUP_TOOLS.map((tool) =>
      registerCommand(`comment.${tool}`, {
        requires: 'annotate',
        isPressed: () => appStore.getState().tool === tool,
        run: async () => {
          await selectionSettled();
          const id = activeId();
          if (!id || markupFromSelection(id, tool)) return;
          if (appStore.getState().tool === tool) {
            appStore.getState().setTool('select');
            return;
          }
          await requestProfile();
          appStore.getState().setTool(tool);
        },
      }),
    ),
    // Note, text and drawing tools (M3-09): on until Esc or the command again.
    ...Object.entries(DRAW_COMMANDS).map(([command, tool]) =>
      registerCommand(command, {
        requires: 'annotate',
        isPressed: () => appStore.getState().tool === tool,
        run: async () => {
          if (appStore.getState().tool === tool) {
            appStore.getState().setTool('select');
            return;
          }
          await requestProfile();
          appStore.getState().setTool(tool);
        },
      }),
    ),
    // Measurements (M3-16): on until Esc or the command again; the page's scales load first.
    ...Object.entries(MEASURE_COMMANDS).map(([command, tool]) =>
      registerCommand(command, {
        requires: 'annotate',
        isPressed: () => appStore.getState().tool === tool,
        run: async () => {
          if (appStore.getState().tool === tool) {
            appStore.getState().setTool('select');
            return;
          }
          const id = activeId();
          if (id) void loadScales(id);
          await requestProfile();
          appStore.getState().setTool(tool);
        },
      }),
    ),
    // Enter on the page: place a note or text box at its centre (M3-Q6), or
    // finish the polyline/polygon being drawn. Otherwise Enter keeps its job.
    registerCommand('tool.enter', {
      requires: 'annotate',
      disabledReason: () => {
        const t = appStore.getState().tool;
        return isDrawTool(t) && (KEYBOARD_PLACED.has(t) || VERTEX_TOOLS.has(t))
          ? null
          : msg('annotate.noneSelected');
      },
      run: async () => {
        const t = appStore.getState().tool;
        const id = activeId();
        const registry = hostStore.getState().registry;
        if (!isDrawTool(t) || !id || !registry) return;
        if (VERTEX_TOOLS.has(t)) {
          finishDrawing();
          return;
        }
        const page = documentStore.getState().docs[id]?.view.page ?? 0;
        // Visual signatures (M6-13) and stamps (M3-14) at the page centre too.
        if (isSignatureTool(t)) {
          placeSignatureAtCentre(id);
          return;
        }
        if (t === 'dynamicStamp') {
          await placeDynamicStamp(id, page);
          return;
        }
        if (t === 'imageStamp') {
          await placeImageStamp(id, page);
          return;
        }
        if (t !== 'textComment' && t !== 'freeText') return;
        await requestProfile();
        placeAtCentre(registry, id, page, t);
      },
    }),
    // Copy/Apply Style (M3-10): the first selected annotation's style onto others.
    registerCommand('comment.copyStyle', {
      requiresDocument: true,
      disabledReason: () => {
        const id = activeId();
        return id && selectedOf(id).length > 0 ? null : msg('annotate.noneSelected');
      },
      run: () => {
        const id = activeId();
        const first = id ? selectedOf(id)[0] : undefined;
        if (first) copyStyle(first.object);
      },
    }),
    registerCommand('comment.applyStyle', {
      ...withSelection,
      disabledReason: (ctx) => {
        if (!copiedStyle()) return msg('annotProps.noStyle');
        return withMovable.disabledReason?.(ctx) ?? null;
      },
      run: () => {
        const id = activeId();
        if (id)
          pasteStyle(
            id,
            selectedOf(id).map((t) => t.object),
          );
      },
    }),
    // Flatten Comments (M6-09, D-38 c): the dialog; the comment menus flatten the selection.
    registerCommand('comment.flatten', {
      requiresDocument: true,
      requires: 'modify',
      disabledReason: () => {
        const id = activeId();
        return id ? flattenBlocked(id) : null;
      },
      run: () => {
        const id = activeId();
        if (id) openFlatten(id);
      },
    }),
    registerCommand('comment.flattenSelected', {
      requiresDocument: true,
      requires: 'modify',
      disabledReason: () => {
        const id = activeId();
        return id ? flattenSelectedBlocked(id) : null;
      },
      run: async () => {
        const id = activeId();
        if (id) await flattenSelected(id);
      },
    }),
    // Comment Styles Palette (M6-07): the user's own styles, for the active tool if it has any.
    registerCommand('comment.stylesPalette', {
      run: () => {
        const tool = appStore.getState().tool;
        openStylesDialog(isStyleTool(tool) ? tool : undefined);
      },
    }),
    // Comments pane (M3-11): open it; Filter opens it with focus on the filters.
    registerCommand('comment.commentsPane', {
      run: () => {
        const s = appStore.getState();
        if (!(s.leftPaneOpen && s.leftPane === 'rail.comments')) s.choosePane('rail.comments');
      },
      isPressed: () => {
        const s = appStore.getState();
        return s.leftPaneOpen && s.leftPane === 'rail.comments';
      },
    }),
    registerCommand('comment.filter', {
      requiresDocument: true,
      run: () => {
        const s = appStore.getState();
        if (!(s.leftPaneOpen && s.leftPane === 'rail.comments')) s.choosePane('rail.comments');
        commentsStore.setState((c) => ({ focusFilters: c.focusFilters + 1 }));
      },
    }),
    // Reply (M3-12, M6-05): the reply editor in the selected comment's card;
    // Set Status: the Comments pane's Set status menu.
    registerCommand('comment.reply', {
      ...withSelection,
      run: () => {
        const id = activeId();
        if (!id) return;
        const s = appStore.getState();
        if (!(s.leftPaneOpen && s.leftPane === 'rail.comments')) s.choosePane('rail.comments');
        startReply(id);
      },
    }),
    registerCommand('comment.setStatus', {
      ...withSelection,
      run: () => {
        const s = appStore.getState();
        if (!(s.leftPaneOpen && s.leftPane === 'rail.comments')) s.choosePane('rail.comments');
        // After the pane has rendered its toolbar.
        requestAnimationFrame(() => {
          commentsStore.setState((c) => ({ focusStatus: c.focusStatus + 1 }));
        });
      },
    }),
    registerCommand('comment.autoNumber', {
      run: () => {
        commentsStore.setState((c) => ({ numbersOnPage: !c.numbersOnPage }));
      },
      isPressed: () => commentsStore.getState().numbersOnPage,
    }),
    // Stamps (M3-14): Stamp asks for the code (and the document's number and
    // revision) and turns the tool on; Image Stamp asks for the image.
    registerCommand('comment.stamp', {
      requires: 'annotate',
      isPressed: () => appStore.getState().tool === 'dynamicStamp',
      run: async () => {
        if (appStore.getState().tool === 'dynamicStamp') {
          appStore.getState().setTool('select');
          return;
        }
        await requestProfile();
        stampStore.setState({ pickerOpen: true });
      },
    }),
    registerCommand('comment.imageStamp', {
      requires: 'annotate',
      isPressed: () => appStore.getState().tool === 'imageStamp',
      run: () => {
        if (appStore.getState().tool === 'imageStamp') {
          appStore.getState().setTool('select');
          return;
        }
        stampStore.setState({ imageOpen: true });
      },
    }),
    // Scales (M3-15): Set Scale and Units open the scale dialog; Calibrate its sibling.
    ...(['measure.setScale', 'measure.units'] as const).map((command) =>
      registerCommand(command, {
        requiresDocument: true,
        run: () => {
          openScaleDialog('setScale');
        },
      }),
    ),
    // Snapping (M3-18): the switch (also in the status bar) and one per snap kind.
    registerCommand('measure.snapping', {
      run: () => {
        void setSnapping(!snapStore.getState().enabled);
      },
      isPressed: () => snapStore.getState().enabled,
    }),
    ...(
      [
        ['measure.snapEndpoint', 'endpoint'],
        ['measure.snapMidpoint', 'midpoint'],
        ['measure.snapIntersection', 'intersection'],
        ['measure.snapNearest', 'nearest'],
      ] as const
    ).map(([command, kind]) =>
      registerCommand(command, {
        run: () => {
          toggleKind(kind);
        },
        isPressed: () => snapStore.getState().kinds[kind],
      }),
    ),
    registerCommand('measure.calibrate', {
      requiresDocument: true,
      isPressed: () => appStore.getState().tool === 'calibrate',
      run: () => {
        scaleStore.setState({ picked: null });
        openScaleDialog('calibrate');
      },
    }),
    // Scale viewports (M3-17): draw a rectangle, then name and scale it.
    registerCommand('measure.scaleViewport', {
      requires: 'annotate',
      isPressed: () => appStore.getState().tool === 'scaleViewport',
      run: () => {
        if (appStore.getState().tool === 'scaleViewport') {
          appStore.getState().setTool('select');
          return;
        }
        const id = activeId();
        if (id) void loadScales(id);
        appStore.getState().setTool('scaleViewport');
      },
    }),
    // Comment Review Sheet (M3-19): the dialog, prefilled.
    registerCommand('comment.exportCrs', {
      requiresDocument: true,
      run: () => {
        const id = activeId();
        if (id) void openCrs(id);
      },
    }),
    // Export Annotations (M4-08): the comments' text leaves the document, so copy is needed (rule 9).
    registerCommand('comment.exportAnnotations', {
      requiresDocument: true,
      requires: 'copy',
      run: () => {
        const id = activeId();
        if (id) openAnnotationExport(id);
      },
    }),
    // Import Comments (M4-20): the target needs annotate (rule 9; the source's copy is checked on choosing it).
    registerCommand('comment.importComments', {
      requiresDocument: true,
      requires: 'annotate',
      disabledReason: () => {
        const id = activeId();
        return id ? transferBlocked(id) : null;
      },
      run: () => {
        const id = activeId();
        if (id) openImportComments(id);
      },
    }),
    // Copy / Paste Comments (M4-21): an in-app clipboard (ADR-018 d8).
    registerCommand('comment.copyComments', {
      requiresDocument: true,
      requires: 'copy',
      disabledReason: () => copyBlocked(activeId()),
      run: async () => {
        const id = activeId();
        if (id) await copySelectedComments(id);
      },
    }),
    registerCommand('comment.pasteComments', {
      requiresDocument: true,
      requires: 'annotate',
      disabledReason: () => pasteBlocked(activeId()),
      run: async () => {
        const id = activeId();
        if (id) await pasteComments(id, 'current');
      },
    }),
    registerCommand('comment.pasteToOriginal', {
      requiresDocument: true,
      requires: 'annotate',
      disabledReason: () => pasteBlocked(activeId()),
      run: async () => {
        const id = activeId();
        if (id) await pasteComments(id, 'original');
      },
    }),
    registerCommand('comment.statusSchemes', {
      run: openSchemes,
    }),
    registerCommand('comment.reviewerProfile', {
      run: openProfileDialog,
    }),
    // Delete: the ribbon button (Comment → Review), the Delete key in the
    // document and in the Comments pane (preview review USR01/OBS01).
    registerCommand('comment.delete', {
      ...withMovable,
      run: () => {
        const id = activeId();
        if (!id) return;
        // A comment with replies asks first; its thread goes with it (M3-12).
        deleteComments(
          id,
          selectedOf(id).map((t) => t.object),
        );
      },
    }),
    // Flags, review mark and tool defaults from the comment menu (M6-06, D-37, D-38 f).
    registerCommand('comment.toggleLocked', flagCommand('locked')),
    registerCommand('comment.togglePrintable', flagCommand('print')),
    registerCommand('comment.toggleMarked', {
      requires: 'annotate',
      disabledReason: () => {
        const id = activeId();
        return id && flagTargets(id).length > 0 ? null : msg('annotate.noneSelected');
      },
      isPressed: () => {
        const id = activeId();
        const marks = id ? marksOf(id, flagTargets(id)) : [];
        return marks.length > 0 && marks.every(Boolean);
      },
      run: async () => {
        const id = activeId();
        if (!id) return;
        const targets = flagTargets(id);
        await setMarked(id, targets, !marksOf(id, targets).every(Boolean));
      },
    }),
    registerCommand('comment.makeDefault', {
      requires: 'annotate',
      disabledReason: () => {
        const id = activeId();
        const sel = id ? selectedOf(id).map((t) => t.object) : [];
        if (sel.length === 0) return msg('annotate.noneSelected');
        return defaultToolOf(sel) ? null : msg('annotProps.noDefaultTool');
      },
      run: async () => {
        const id = activeId();
        if (id)
          await makeCurrentDefault(
            id,
            selectedOf(id).map((t) => t.object),
          );
      },
    }),
    registerCommand('annotation.next', cycle(1)),
    registerCommand('annotation.prev', cycle(-1)),
    registerCommand('annotation.nudgeLeft', {
      ...withMovable,
      run: () => {
        nudge(-STEP, 0);
      },
    }),
    registerCommand('annotation.nudgeRight', {
      ...withMovable,
      run: () => {
        nudge(STEP, 0);
      },
    }),
    registerCommand('annotation.nudgeUp', {
      ...withMovable,
      run: () => {
        nudge(0, -STEP);
      },
    }),
    registerCommand('annotation.nudgeDown', {
      ...withMovable,
      run: () => {
        nudge(0, STEP);
      },
    }),
    registerCommand('annotation.nudgeLeftFar', {
      ...withMovable,
      run: () => {
        nudge(-BIG_STEP, 0);
      },
    }),
    registerCommand('annotation.nudgeRightFar', {
      ...withMovable,
      run: () => {
        nudge(BIG_STEP, 0);
      },
    }),
    registerCommand('annotation.nudgeUpFar', {
      ...withMovable,
      run: () => {
        nudge(0, -BIG_STEP);
      },
    }),
    registerCommand('annotation.nudgeDownFar', {
      ...withMovable,
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
  // Snap switches are toggles on the Measure tab.
  const offSnap = snapStore.subscribe((s, prev) => {
    if (s.enabled !== prev.enabled || s.kinds !== prev.kinds) notify();
  });
  // Paste is enabled once something is copied (M4-21).
  const offClip = clipboardStore.subscribe(notify);
  return () => {
    offRegistry();
    offPlugins();
    offSnap();
    offClip();
    for (const off of offs) off();
  };
}

/** Esc (§8.1) also drops the annotation selection. */
export function deselectAnnotations(): void {
  const id = activeId();
  if (id) scope(id)?.deselectAnnotation();
}
