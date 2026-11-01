import { ChevronRight16Regular } from '@fluentui/react-icons/svg/chevron-right';
import * as CM from '@radix-ui/react-context-menu';
import { useId, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { runCommand, type CommandArgs } from '../../app/commands/dispatch';
import { useCommandStates } from '../../app/commands/useCommandState';
import { shortcutText } from '../../app/keys/labels';
import { msg } from '../../i18n';
import { CommandIcon } from '../icons/CommandIcon';
import { menuItems, type ContextMenuEntry, type MenuItemView } from './contextMenuModel';

export type { ContextMenuEntry, MenuChoice } from './contextMenuModel';

export interface ContextMenuProps {
  /** The area that opens the menu on right click: one element (Radix `asChild`). */
  children: ReactElement;
  /** The open menu's accessible name (translated, rule 11). */
  label: string;
  entries: readonly ContextMenuEntry[];
  /** Passed to every command the menu runs: where it was opened (M6-02). */
  args?: CommandArgs;
  onOpenChange?: (open: boolean) => void;
  /** Where focus goes when the menu closes (default: back to where it was). */
  onCloseAutoFocus?: (e: Event) => void;
}

const NOT_READY = { enabled: false, pressed: false, reason: msg('ribbon.notReady') } as const;

/**
 * A right-click menu of commands (M6-02, ADR-021 D-38 a): label, icon,
 * shortcut and disabled reason come from the command table and keymap. Keyboard
 * as any menu (Radix): arrows, Enter, Esc closes. Disabled items stay
 * focusable and say why (as the ribbon's do, rule 12). The owner opens it from
 * the keyboard (Shift+F10, the Menu key) by dispatching `contextmenu` on the area.
 */
export function ContextMenu({
  children,
  label,
  entries,
  args,
  onOpenChange,
  onCloseAutoFocus,
}: ContextMenuProps) {
  return (
    <CM.Root modal {...(onOpenChange ? { onOpenChange } : {})}>
      <CM.Trigger asChild>{children}</CM.Trigger>
      <CM.Portal>
        <CM.Content
          className="ui-menu ui-context-menu"
          aria-label={label}
          collisionPadding={8}
          loop
          {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}
        >
          <Body entries={entries} args={args} />
        </CM.Content>
      </CM.Portal>
    </CM.Root>
  );
}

function Body({
  entries,
  args,
}: {
  entries: readonly ContextMenuEntry[];
  args: CommandArgs | undefined;
}) {
  const { t } = useTranslation();
  const states = useCommandStates(entries.flatMap((e) => (e.kind === 'separator' ? [] : [e.id])));
  const items = menuItems(
    entries,
    (id) => states[id] ?? NOT_READY,
    (id) => shortcutText(id, t),
  );
  return items.map((item) =>
    item.kind === 'separator' ? (
      <CM.Separator key={item.key} className="ui-menu-separator" />
    ) : (
      <Item key={item.id} item={item} args={args} />
    ),
  );
}

function Item({
  item,
  args,
}: {
  item: Exclude<MenuItemView, { kind: 'separator' }>;
  args: CommandArgs | undefined;
}) {
  const { t } = useTranslation();
  const reasonId = useId();
  const reason = item.reason ? t(item.reason) : null;
  const props = {
    className: 'ui-menu-item',
    'data-command': item.id,
    ...(reason
      ? {
          'aria-disabled': true,
          'data-disabled': '',
          'aria-describedby': reasonId,
          title: reason,
        }
      : {}),
  };
  const content = (
    <>
      <span className="ui-menu-icon">
        <CommandIcon id={item.id} pressed={item.pressed} />
      </span>
      <span className="ui-menu-label">{t(item.label)}</span>
      {item.shortcut ? (
        <span className="ui-menu-shortcut" aria-hidden="true">
          {item.shortcut}
        </span>
      ) : null}
    </>
  );
  // Outside the item, so it describes it without becoming part of its name.
  const why = reason ? (
    <span id={reasonId} hidden>
      {reason}
    </span>
  ) : null;
  const onSelect = (e: Event): void => {
    if (!item.enabled) {
      e.preventDefault(); // stays open: the reason is the answer
      return;
    }
    void runCommand(item.id, args);
  };

  if (item.kind === 'submenu')
    return (
      <CM.Sub>
        <CM.SubTrigger {...props} disabled={!item.enabled}>
          {content}
          <ChevronRight16Regular aria-hidden className="ui-menu-chevron" />
        </CM.SubTrigger>
        {why}
        <CM.Portal>
          <CM.SubContent className="ui-menu ui-context-menu" collisionPadding={8} loop>
            {item.choices.map((c) => (
              <CM.Item key={c.key} className="ui-menu-item" onSelect={c.onSelect}>
                <span className="ui-menu-icon" />
                <span className="ui-menu-label">{t(c.label)}</span>
              </CM.Item>
            ))}
          </CM.SubContent>
        </CM.Portal>
      </CM.Sub>
    );
  return (
    <>
      {item.toggle ? (
        <CM.CheckboxItem {...props} checked={item.pressed} onSelect={onSelect}>
          {content}
        </CM.CheckboxItem>
      ) : (
        <CM.Item {...props} onSelect={onSelect}>
          {content}
        </CM.Item>
      )}
      {why}
    </>
  );
}
