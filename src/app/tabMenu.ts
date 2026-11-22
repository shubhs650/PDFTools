// The file tab menu and the strip menu (M11-05, ADR-028 D-50). Pure: the entries,
// natural-order sorting and each tab command's state for one tab, so the menu (the tab
// it was opened on) and the keys (the active tab) agree.
import { msg } from '../i18n';
import type { ContextMenuEntry } from '../ui/components/contextMenuModel';
import type { CommandState } from './commands/dispatch';
import type { Comparison } from '../features/compare/model';
import { isAvailable, COMMANDS } from './commands';
import type { DocumentSlice } from './store/documentStore';

const sep = (key: string): ContextMenuEntry => ({ kind: 'separator', key });
const cmd = (id: string): ContextMenuEntry => ({ kind: 'command', id });

/**
 * A tab's menu, desktop-editor style (D-50). Rename File is listed only where the browser
 * can rename the original file in place (`canRename`): never a fake rename.
 */
export function tabMenuEntries(canRename: boolean): ContextMenuEntry[] {
  return [
    cmd('file.save'),
    cmd('file.saveAs'),
    sep('save'),
    // Compare with… (M12-08, D-58), behind the Compare build switch.
    ...(compareShown() ? [cmd('tab.compareWith'), sep('compare')] : []),
    cmd('tab.close'),
    cmd('tab.closeOthers'),
    cmd('tab.closeRight'),
    cmd('tab.closeAll'),
    sep('close'),
    cmd('tab.reopenClosed'),
    sep('reopen'),
    cmd('tab.moveLeft'),
    cmd('tab.moveRight'),
    cmd('tab.sortByName'),
    sep('order'),
    cmd('tab.copyName'),
    ...(canRename ? [cmd('tab.rename')] : []),
    sep('file'),
    cmd('file.properties'),
  ];
}

const compareShown = (): boolean =>
  COMMANDS.some((c) => c.id === 'tab.compareWith' && isAvailable(c));

/** A comparison tab's menu (M12-08): the tab commands that are not about a file. */
export const COMPARISON_TAB_MENU: readonly ContextMenuEntry[] = [
  cmd('tab.close'),
  cmd('tab.closeOthers'),
  cmd('tab.closeRight'),
  cmd('tab.closeAll'),
  sep('close'),
  cmd('tab.reopenClosed'),
  sep('reopen'),
  cmd('tab.moveLeft'),
  cmd('tab.moveRight'),
  cmd('tab.sortByName'),
];

/** The empty part of the strip (D-50): Open, Create Blank PDF, Reopen Closed Tab, Close All. */
export const STRIP_MENU: readonly ContextMenuEntry[] = [
  cmd('file.open'),
  { kind: 'command', id: 'file.new', label: msg('frame.menu.createBlank') },
  sep('open'),
  cmd('tab.reopenClosed'),
  cmd('tab.closeAll'),
];

/** The tab commands whose state depends on the tab (or on the closed-tab list). */
export const TAB_COMMANDS = [
  'tab.close',
  'tab.closeOthers',
  'tab.closeRight',
  'tab.closeAll',
  'tab.reopenClosed',
  'tab.moveLeft',
  'tab.moveRight',
  'tab.sortByName',
  'tab.copyName',
  'tab.rename',
] as const;
export type TabCommand = (typeof TAB_COMMANDS)[number];

export const isTabCommand = (id: string): id is TabCommand =>
  (TAB_COMMANDS as readonly string[]).includes(id);

const collator = (): Intl.Collator =>
  new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * The tab order sorted by file name in natural order ("Sheet 2" before "Sheet 10"),
 * ignoring case and accents; equal names keep their order (stable).
 */
export function sortedByName(
  order: readonly string[],
  nameOf: (id: string) => string,
  compare: (a: string, b: string) => number = collator().compare,
): string[] {
  return order
    .map((id, i) => ({ id, i, name: nameOf(id) }))
    .sort((a, b) => compare(a.name, b.name) || a.i - b.i)
    .map((e) => e.id);
}

export interface TabWorld {
  order: readonly string[];
  docs: Readonly<Record<string, DocumentSlice | undefined>>;
  /** Comparison tabs (M12-08): tabs too, with no file of their own. */
  comparisons?: Readonly<Record<string, Comparison | undefined>>;
  /** How many closed tabs can be reopened (this session). */
  closedCount: number;
}

const off = (reason: ReturnType<typeof msg>): CommandState => ({
  enabled: false,
  pressed: false,
  reason,
});
const ON: CommandState = { enabled: true, pressed: false };

/** A tab command's state for tab `target` (null: no tab, e.g. the strip menu). Pure. */
export function tabCommandState(
  id: TabCommand,
  target: string | null,
  world: TabWorld,
  nameOf: (id: string) => string = (d) => world.docs[d]?.meta.name ?? '',
): CommandState {
  const { order } = world;
  if (id === 'tab.reopenClosed')
    return world.closedCount > 0 ? ON : off(msg('frame.menu.nothingClosed'));
  if (id === 'tab.closeAll') return order.length > 0 ? ON : off(msg('ribbon.needsDocument'));
  if (id === 'tab.sortByName') {
    if (order.length < 2) return off(msg('frame.menu.oneTab'));
    const sorted = sortedByName(order, nameOf);
    return sorted.every((d, i) => d === order[i]) ? off(msg('frame.menu.sorted')) : ON;
  }
  const i = target ? order.indexOf(target) : -1;
  const doc = target ? world.docs[target] : undefined;
  const comparison = target ? world.comparisons?.[target] : undefined;
  if (i < 0 || (!doc && !comparison)) return off(msg('ribbon.needsDocument'));
  switch (id) {
    case 'tab.closeOthers':
      return order.length > 1 ? ON : off(msg('frame.menu.oneTab'));
    case 'tab.closeRight':
      return i < order.length - 1 ? ON : off(msg('frame.menu.noneRight'));
    case 'tab.moveLeft':
      return i > 0 ? ON : off(msg('frame.menu.first'));
    case 'tab.moveRight':
      return i < order.length - 1 ? ON : off(msg('frame.menu.last'));
    case 'tab.rename':
      if (!doc) return off(msg('ribbon.needsDocument'));
      return doc.save === 'saving' ? off(msg('frame.menu.saving')) : ON;
    default:
      return ON;
  }
}

/** The tabs Close Others / Close Tabs to the Right / Close All close, in tab order. */
export function tabsToClose(
  kind: 'others' | 'right' | 'all',
  target: string | null,
  order: readonly string[],
): string[] {
  if (kind === 'all') return [...order];
  const i = target ? order.indexOf(target) : -1;
  if (i < 0) return [];
  return kind === 'others' ? order.filter((d) => d !== target) : order.slice(i + 1);
}

/** Characters no file name may hold on Windows, macOS or Linux. */
// eslint-disable-next-line no-control-regex
const BAD_NAME = /[\\/:*?"<>|\u0000-\u001f]/;

export type RenameError = 'empty' | 'chars' | 'reserved';

/**
 * The new file name from what the user typed: trimmed, ".pdf" added when no extension
 * was given (the file stays a PDF). Pure.
 */
export function renameTarget(
  typed: string,
): { name: string; error?: never } | { name?: never; error: RenameError } {
  const name = typed.trim().replace(/[. ]+$/, '');
  if (!name || name === '.pdf') return { error: 'empty' };
  if (BAD_NAME.test(name)) return { error: 'chars' };
  const base = name.replace(/\.[^.]*$/, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base) || base === '' || base === '.')
    return { error: 'reserved' };
  return { name: /\.pdf$/i.test(name) ? name : `${name}.pdf` };
}
