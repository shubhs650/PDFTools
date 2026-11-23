// The Compare ribbon tab and Compare with… on a document tab's menu (M12-08, D-58).
// None needs an active document: each opens a comparison tab on its input window.
import { addCommandGuard, registerCommand } from '../../app/commands/dispatch';
import { documentStore } from '../../app/store/documentStore';
import { msg } from '../../i18n';
import { startComparison } from './compareFlow';
import type { CompareType } from './model';
import { compareGuard } from './review/guard';
import { registerCloseOutCommands } from './closeout/commands';
import { comparisonSheets, exportBlock, openExportOverlay } from './overlay/vectorOverlay';

/** The PDF overlay in the active tab, or null. */
const activeOverlay = () => {
  const s = documentStore.getState();
  const c = s.activeTab ? s.comparisons[s.activeTab] : undefined;
  return c?.type === 'overlay' ? c : null;
};

/** The type Compare with… starts with: the last one started (the window can switch it). */
let lastType: CompareType = 'overlay';

const start = (type: CompareType, a: readonly string[] = []): void => {
  lastType = type;
  startComparison(type, a);
};

export function registerCompareCommands(): () => void {
  const offs = [
    // A comparison's windows keep to their sheet; its notes take comment and view commands.
    addCommandGuard(compareGuard),
    // Review across revisions (M12-15): aligned copy and paste, close-out.
    registerCloseOutCommands(),
    registerCommand('compare.overlay', {
      run: () => {
        start('overlay');
      },
    }),
    registerCommand('compare.text', {
      run: () => {
        start('text');
      },
    }),
    // Export Overlay… (M12-16): needs every file's content-copying permission (rule 9).
    registerCommand('compare.exportOverlay', {
      run: () => {
        const c = activeOverlay();
        if (c) openExportOverlay(c.id);
      },
      disabledReason: () => {
        const c = activeOverlay();
        if (!c) return msg('compare.export.needsOverlay');
        if (c.stage !== 'result' || !comparisonSheets(c.id)?.length)
          return msg('compare.export.needsResult');
        return exportBlock(c) ? msg('compare.export.needsCopy') : null;
      },
    }),
    registerCommand('tab.compareWith', {
      // The tab's document is Document A (old); the window has a swap button.
      run: (_ctx, args) => {
        const s = documentStore.getState();
        const docId = args?.tab ?? s.activeTab;
        if (docId && s.docs[docId]) start(lastType, [docId]);
      },
      disabledReason: (_ctx, args) => {
        const s = documentStore.getState();
        const docId = args?.tab ?? s.activeTab;
        return docId && s.docs[docId] ? null : msg('ribbon.needsDocument');
      },
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
