// The Compare ribbon tab and Compare with… on a document tab's menu (M12-08, D-58).
// None needs an active document: each opens a comparison tab on its input window.
import { watchAppPanes } from './layout/appPanes';
import { addCommandGuard, notify, registerCommand } from '../../app/commands/dispatch';
import { pairingStore } from './pairingFlow';
import { textStore } from './text/textFlow';
import { PREVIEWS_ON } from '../../app/commands';
import { documentStore } from '../../app/store/documentStore';
import { msg } from '../../i18n';
import { startComparison } from './compareFlow';
import type { CompareType } from './model';
import { compareGuard } from './review/guard';
import { registerCloseOutCommands } from './closeout/commands';
import { beginAreas } from './area/areaPick';
import { setPicking } from './align/manualAlign';
import { setLayout, updateView } from './overlay/overlayState';

/** The overlay result in the selected tab an area can be drawn in (not an area comparison itself). */
function areaHost(): string | null {
  const s = documentStore.getState();
  const c = s.activeTab ? s.comparisons[s.activeTab] : undefined;
  return c?.type === 'overlay' && c.stage === 'result' && !c.area ? c.id : null;
}

import { comparisonSheets, exportBlock, openExportOverlay } from './overlay/vectorOverlay';
import { openRegister, registerBlock } from './register/changeRegister';
import { openSavePreset } from './presets/presetStore';
import { setSaveRedirect } from '../save/save';
import { setOpenedHook } from '../open/openDocument';
import {
  exportDocuments,
  hasResult,
  linkedOf,
  openSaveComparison,
  reviewRedirect,
  saveBlock,
} from './file/fileFlow';
import { onOpened } from './file/reopen';

/** The comparison in the selected tab, or null. */
const activeComparison = () => {
  const s = documentStore.getState();
  return s.activeTab ? (s.comparisons[s.activeTab] ?? null) : null;
};

/** The PDF overlay in the active tab, or null. */
const activeOverlay = () => {
  const s = documentStore.getState();
  const c = s.activeTab ? s.comparisons[s.activeTab] : undefined;
  return c?.type === 'overlay' ? c : null;
};

/** Why Save Comparison… can't run on the active tab, or null. */
function saveReason() {
  const c = activeComparison();
  if (!c) return msg('compare.file.save.needsComparison');
  if (!hasResult(c)) return msg('compare.file.save.needsResult');
  return saveBlock(c) ? msg('compare.file.save.needsPermission') : null;
}

/** Export Document A / B: a comparison reopened from its file. */
const exportReason = () => {
  const c = activeComparison();
  return c && linkedOf(c.id) ? null : msg('compare.file.export.needsFile');
};

/** The type Compare with… starts with: the last one started (the window can switch it). */
let lastType: CompareType = 'overlay';

const start = (
  type: CompareType,
  a: readonly string[] = [],
  b: readonly string[] = [],
  at?: number,
): void => {
  lastType = type;
  startComparison(type, a, b, at);
};

/**
 * PDF Overlay or Text Comparison; from "Compare these two" (a tab dropped on a tab, O4)
 * with both open documents on the sides, else empty.
 */
const startFrom = (type: CompareType, pair: readonly [string, string] | undefined): void => {
  const { docs, order } = documentStore.getState();
  // Its tab goes right after the later of the two.
  if (pair && docs[pair[0]] && docs[pair[1]])
    start(type, [pair[0]], [pair[1]], Math.max(...pair.map((d) => order.indexOf(d))) + 1);
  else start(type);
};

export function registerCompareCommands(): () => void {
  // Off in release builds until acceptance (D-58): a comparison file then opens as the PDF it is.
  if (PREVIEWS_ON) setOpenedHook(onOpened);
  // Save Comparison… waits on the result, which lives in the comparison's own stores.
  let resultKey = '';
  const refresh = (): void => {
    const key = JSON.stringify([
      Object.entries(textStore.getState().runs).map(([id, r]) => [id, r.status, r.result !== null]),
      Object.entries(pairingStore.getState().byId).map(([id, p]) => [id, p.status, p.rows.length]),
    ]);
    if (key === resultKey) return;
    resultKey = key;
    notify();
  };
  const offStores = [textStore.subscribe(refresh), pairingStore.subscribe(refresh)];
  const offs = [
    // A comparison's windows keep to their sheet; its notes take comment and view commands.
    addCommandGuard(compareGuard),
    // The app's left panes close on a comparison tab; Maximise ends with its comparison (M12-25).
    watchAppPanes(),
    // Review across revisions (M12-15): aligned copy and paste, close-out.
    registerCloseOutCommands(),
    registerCommand('compare.overlay', {
      run: (_ctx, args) => {
        startFrom('overlay', args?.pair);
      },
    }),
    registerCommand('compare.text', {
      run: (_ctx, args) => {
        startFrom('text', args?.pair);
      },
    }),
    registerCommand('compare.area', {
      // Compare an area (O1): the result's panel starts drawing on Document A.
      run: () => {
        const id = areaHost();
        if (!id) return;
        updateView(id, (v) => setLayout(v.manual?.picking ? setPicking(v, false) : v, 'review'));
        beginAreas(id);
      },
      disabledReason: () => (areaHost() ? null : msg('compare.area.needsOverlay')),
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
    // Export Change Register… (M12-21): needs every file's content-copying permission (rule 9).
    registerCommand('compare.exportRegister', {
      run: () => {
        const c = activeComparison();
        if (c?.stage === 'result') openRegister(c.id);
      },
      disabledReason: () => {
        const c = activeComparison();
        if (!c) return msg('compare.register.needsComparison');
        if (c.stage !== 'result') return msg('compare.register.needsResult');
        return registerBlock(c) ? msg('compare.register.needsCopy') : null;
      },
    }),
    // Save as Preset… (M12-21): the result's settings, kept on this device.
    registerCommand('compare.savePreset', {
      run: () => {
        const c = activeComparison();
        if (c?.stage === 'result') openSavePreset(c.id);
      },
      disabledReason: () => {
        const c = activeComparison();
        if (!c) return msg('compare.presets.needsComparison');
        return c.stage === 'result' ? null : msg('compare.presets.needsResult');
      },
    }),
    // The comparison file (M12-20, D-65): Save Comparison…, Export Document A / B.
    registerCommand('compare.saveComparison', {
      run: () => {
        const c = activeComparison();
        if (c) openSaveComparison(c.id);
      },
      disabledReason: saveReason,
    }),
    registerCommand('compare.exportA', {
      run: () => {
        const c = activeComparison();
        if (c) void exportDocuments(c.id, 'a');
      },
      disabledReason: exportReason,
    }),
    registerCommand('compare.exportB', {
      run: () => {
        const c = activeComparison();
        if (c) void exportDocuments(c.id, 'b');
      },
      disabledReason: exportReason,
    }),
    // Ctrl+S in a comparison is Save review; a comparison file opened becomes its comparison.
    setSaveRedirect(reviewRedirect),
    () => {
      setOpenedHook(null);
      for (const off of offStores) off();
    },
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
