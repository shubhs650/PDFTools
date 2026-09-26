// Quick Find commands (M2-07): Ctrl+F opens the bar; F3 / Shift+F3 walk the
// results (or open the bar when there are none).
import { registerCommand } from '../../app/commands/dispatch';
import { findNext, findStore, openFind } from './findStore';

export function registerFindCommands(): () => void {
  const step = (dir: 1 | -1) => () => {
    const s = findStore.getState();
    if (s.open && s.query.trim()) return findNext(dir);
    openFind();
    return undefined;
  };
  const offs = [
    registerCommand('home.find', { requiresDocument: true, run: openFind }),
    registerCommand('find.next', { requiresDocument: true, run: step(1) }),
    registerCommand('find.prev', { requiresDocument: true, run: step(-1) }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
