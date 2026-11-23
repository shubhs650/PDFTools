// The commands of review across revisions (M12-15, D-62): Copy to New
// Revision and Copy to Old Revision on a comparison window's comment menu,
// Close Out with its outcomes on Document A's, and the aligned paste between
// the windows. Each acts on the window in use (the document commands act on).
import { registerCommand } from '../../../app/commands/dispatch';
import { documentStore } from '../../../app/store/documentStore';
import { msg, type MessageKey } from '../../../i18n';
import type { ContextMenuEntry, MenuChoice } from '../../../ui/components';
import { addCommentMenuItems } from '../../view/documentMenus';
import {
  closeOut,
  closeOutBlocked,
  copyToBlocked,
  copyToRevision,
  installAlignedPaste,
  reopen,
  selectedRootObjects,
} from './actions';
import { OUTCOMES, type Outcome } from './closeOutModel';
import { closeOutStore, dropCloseOut, updateCloseOut } from './closeOutStore';
import { windowOf } from './context';

const activeId = (): string | null => documentStore.getState().activeId;

const ACTION: Record<Outcome, MessageKey> = {
  addressed: msg('compare.closeout.action_addressed'),
  carried: msg('compare.closeout.action_carried'),
  changed: msg('compare.closeout.action_changed'),
};

/** The Close Out submenu: the three outcomes and Reopen, on the selected comments. */
function closeOutChoices(docId: string): MenuChoice[] {
  return [
    ...OUTCOMES.map((o) => ({
      key: o,
      label: ACTION[o],
      onSelect: () => {
        void closeOut(docId, selectedRootObjects(docId), o);
      },
    })),
    {
      key: 'reopen',
      label: msg('compare.closeout.reopen'),
      onSelect: () => {
        reopen(docId, selectedRootObjects(docId));
      },
    },
  ];
}

/** The comment menu's items in a comparison window (none elsewhere). */
function menuItems(docId: string): ContextMenuEntry[] {
  const w = windowOf(docId);
  if (!w) return [];
  const out: ContextMenuEntry[] = [{ kind: 'separator', key: 'compare' }];
  if (w.role !== 'b') out.push({ kind: 'command', id: 'compare.copyToNew' });
  if (w.role !== 'a') out.push({ kind: 'command', id: 'compare.copyToOld' });
  if (w.role === 'a')
    out.push({ kind: 'submenu', id: 'compare.closeOut', choices: closeOutChoices(docId) });
  return out;
}

let watching = false;

/** A closed comparison forgets its close-out pane. */
function watchClosing(): void {
  if (watching) return;
  watching = true;
  documentStore.subscribe((s) => {
    for (const id of Object.keys(closeOutStore.getState().byId))
      if (!s.comparisons[id]) dropCloseOut(id);
  });
}

export function registerCloseOutCommands(): () => void {
  watchClosing();
  const offs = [
    installAlignedPaste(),
    addCommentMenuItems(menuItems),
    registerCommand('compare.copyToNew', {
      disabledReason: () => copyToBlocked(activeId(), 'b'),
      run: async () => {
        const id = activeId();
        if (id) await copyToRevision(id, 'b');
      },
    }),
    registerCommand('compare.copyToOld', {
      disabledReason: () => copyToBlocked(activeId(), 'a'),
      run: async () => {
        const id = activeId();
        if (id) await copyToRevision(id, 'a');
      },
    }),
    // The submenu's own command: shows the close-out list, with the comment selected.
    registerCommand('compare.closeOut', {
      disabledReason: () => {
        const id = activeId();
        const why = closeOutBlocked(id);
        if (why || !id) return why;
        return selectedRootObjects(id).length ? null : msg('transfer.copy.none');
      },
      run: () => {
        const id = activeId();
        const w = windowOf(id);
        const [root] = id ? selectedRootObjects(id) : [];
        if (!w || !id) return;
        updateCloseOut(w.comparison.id, (v) => ({
          ...v,
          open: true,
          selected: root ? { docId: id, id: root.id } : v.selected,
        }));
      },
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
