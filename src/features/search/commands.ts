// Quick Find commands (M2-07): Ctrl+F opens the bar; F3 / Shift+F3 walk the
// results (or open the bar when there are none).
import { registerCommand } from '../../app/commands/dispatch';
import { appStore } from '../../app/store/appStore';
import { findNext, findStore, openFind } from './findStore';
import { requestSearchFocus } from './searchStore';

export function registerFindCommands(): () => void {
  const step = (dir: 1 | -1) => () => {
    const s = findStore.getState();
    // The bar's query, or the results Advanced Search is showing (M2-09).
    if ((s.open || s.highlights) && s.query.trim()) return findNext(dir);
    openFind();
    return undefined;
  };
  const offs = [
    registerCommand('home.find', { requiresDocument: true, run: openFind }),
    // Opens (never toggles) the Advanced Search pane and focuses its field (M2-09).
    registerCommand('home.advancedSearch', {
      run: () => {
        const app = appStore.getState();
        if (!app.leftPaneOpen || app.leftPane !== 'rail.search') app.choosePane('rail.search');
        requestSearchFocus();
      },
    }),
    registerCommand('find.next', { requiresDocument: true, run: step(1) }),
    registerCommand('find.prev', { requiresDocument: true, run: step(-1) }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
