// Context menus (M6-02, ADR-021 D-38 a): every item is a command from the
// command table, so its label, icon, shortcut text and disabled reason have one
// source. Pure: the component passes the command states and shortcuts in.
import { commandLabelKey } from '../../app/commandLabels';
import { COMMANDS } from '../../app/commands';
import type { CommandState } from '../../app/commands/dispatch';
import type { MessageKey } from '../../i18n';

/** One sub-item of a submenu (a choice the command takes, e.g. a review status). */
export interface MenuChoice {
  key: string;
  label: MessageKey;
  onSelect: () => void;
}

export type ContextMenuEntry =
  | { kind: 'command'; id: string }
  | { kind: 'separator'; key: string }
  /** The command's label opens a submenu; its state enables or disables it. */
  | { kind: 'submenu'; id: string; choices: readonly MenuChoice[] };

export type MenuItemView =
  | {
      kind: 'command' | 'submenu';
      id: string;
      label: MessageKey;
      /** Keys from the keymap ("Ctrl+C"), empty when none. */
      shortcut: string;
      enabled: boolean;
      /** A toggle (tool, mode): shown checked while pressed. */
      toggle: boolean;
      pressed: boolean;
      /** Why it is disabled (rule 9 and the command's own reason), null when enabled. */
      reason: MessageKey | null;
      choices: readonly MenuChoice[];
    }
  | { kind: 'separator'; key: string };

const TOGGLES = new Set(COMMANDS.filter((c) => c.toggle).map((c) => c.id));

/**
 * The items as shown: separators never lead, trail or repeat (an entry list
 * may be extended by later tasks, D-38). Pure.
 */
export function menuItems(
  entries: readonly ContextMenuEntry[],
  stateOf: (id: string) => CommandState,
  shortcutOf: (id: string) => string,
): MenuItemView[] {
  const out: MenuItemView[] = [];
  for (const e of entries) {
    if (e.kind === 'separator') {
      if (out.length > 0 && out.at(-1)?.kind !== 'separator') out.push(e);
      continue;
    }
    const st = stateOf(e.id);
    out.push({
      kind: e.kind,
      id: e.id,
      label: commandLabelKey(e.id),
      shortcut: e.kind === 'command' ? shortcutOf(e.id) : '',
      enabled: st.enabled,
      toggle: e.kind === 'command' && TOGGLES.has(e.id),
      pressed: st.pressed,
      reason: st.enabled ? null : st.reason,
      choices: e.kind === 'submenu' ? e.choices : [],
    });
  }
  while (out.at(-1)?.kind === 'separator') out.pop();
  return out;
}
