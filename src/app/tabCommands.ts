// The file tab commands (M11-04 moves; M11-05 menus, ADR-028 D-50). Each acts on the
// tab its menu was opened on (`args.tab`), else on the active tab (the keys).
import { openFiles, requestCloseMany } from '../features/open/openDocument';
import { closedCount, takeLastClosed } from '../features/open/closedTabs';
import { reportFailure } from '../features/open/openStore';
import { sources } from '../features/open/sources';
import { msg } from '../i18n';
import { ensurePermission } from '../storage/fileAccess';
import { registerCommand, type CommandArgs } from './commands/dispatch';
import { documentStore } from './store/documentStore';
import {
  sortedByName,
  tabCommandState,
  tabsToClose,
  TAB_COMMANDS,
  type TabCommand,
  type TabWorld,
} from './tabMenu';
import { moveTab, reorderTabs, tellTabs } from './tabMove';
import { openRename } from './tabRename';

const world = (): TabWorld => {
  const s = documentStore.getState();
  return { order: s.order, docs: s.docs, closedCount: closedCount() };
};

/** The tab a command is for: its menu's tab, else the active one. */
const targetOf = (args?: CommandArgs): string | null =>
  args?.tab ?? documentStore.getState().activeId;

/** A tab command's state for the tab a menu was opened on (or the active tab). */
export const tabStateFor = (id: TabCommand, tab: string | null) =>
  tabCommandState(id, tab, world());

/**
 * Whether the browser can rename this document's file in place (File System Access
 * `move()`, Chromium 111+): it has a handle to a file on disk. Write permission is
 * asked for when the user renames.
 */
export function canRenameFile(docId: string): boolean {
  const handle = sources.get(docId)?.handle as
    (FileSystemFileHandle & { move?: unknown }) | undefined;
  return typeof handle?.move === 'function';
}

function closeKind(kind: 'others' | 'right' | 'all', args?: CommandArgs): void {
  const s = documentStore.getState();
  const target = targetOf(args);
  const ids = tabsToClose(kind, target, s.order);
  // The tab the menu was opened on stays and becomes the selected one.
  if (target && kind !== 'all' && s.activeId && ids.includes(s.activeId)) s.activate(target);
  requestCloseMany(ids);
}

async function reopen(): Promise<void> {
  const tab = takeLastClosed();
  if (!tab) return;
  let file: File;
  try {
    if (!(await ensurePermission(tab.handle, 'read'))) {
      reportFailure(tab.name, 'denied');
      return;
    }
    file = await tab.handle.getFile();
  } catch {
    reportFailure(tab.name, 'unreadable');
    return;
  }
  const before = documentStore.getState().order.length;
  const [id] = await openFiles([{ file, handle: tab.handle }], tab.source);
  const s = documentStore.getState();
  // A new tab (not a file that was open again already) goes back to its old place.
  if (id && s.order.length > before && s.order.indexOf(id) !== tab.index) s.move(id, tab.index);
}

async function copyName(args?: CommandArgs): Promise<void> {
  const id = targetOf(args);
  const name = id ? documentStore.getState().docs[id]?.meta.name : undefined;
  if (!name) return;
  try {
    await navigator.clipboard.writeText(name);
    tellTabs({ kind: 'copied' });
  } catch {
    tellTabs({ kind: 'copyFailed' });
  }
}

const RUN: Record<TabCommand, (args?: CommandArgs) => void | Promise<void>> = {
  'tab.close': (args) => {
    const id = targetOf(args);
    if (id) requestCloseMany([id]);
  },
  'tab.closeOthers': (args) => {
    closeKind('others', args);
  },
  'tab.closeRight': (args) => {
    closeKind('right', args);
  },
  'tab.closeAll': (args) => {
    closeKind('all', args);
  },
  'tab.reopenClosed': reopen,
  'tab.moveLeft': (args) => {
    const id = targetOf(args);
    if (id) moveTab(id, documentStore.getState().order.indexOf(id) - 1);
  },
  'tab.moveRight': (args) => {
    const id = targetOf(args);
    if (id) moveTab(id, documentStore.getState().order.indexOf(id) + 1);
  },
  'tab.sortByName': () => {
    const { order, docs } = documentStore.getState();
    reorderTabs(sortedByName(order, (d) => docs[d]?.meta.name ?? ''));
  },
  'tab.copyName': copyName,
  'tab.rename': (args) => {
    const id = targetOf(args);
    if (id && canRenameFile(id)) openRename(id);
  },
};

export function registerTabCommands(): () => void {
  const offs = TAB_COMMANDS.map((id) =>
    registerCommand(id, {
      ...(id === 'tab.reopenClosed' ? {} : { requiresDocument: true }),
      run: (_ctx, args) => RUN[id](args),
      disabledReason: (_ctx, args) => {
        const target = targetOf(args);
        if (id === 'tab.rename' && target && !canRenameFile(target))
          return msg('frame.menu.cannotRename');
        const st = tabCommandState(id, target, world());
        if (st.enabled) return null;
        return st.reason;
      },
    }),
  );
  return () => {
    for (const off of offs) off();
  };
}
