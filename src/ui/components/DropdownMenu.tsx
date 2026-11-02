import { Checkmark16Regular } from '@fluentui/react-icons/svg/checkmark';
import { ChevronRight16Regular } from '@fluentui/react-icons/svg/chevron-right';
import { Circle16Filled } from '@fluentui/react-icons/svg/circle';
import * as Menu from '@radix-ui/react-dropdown-menu';
import type { ReactElement, ReactNode } from 'react';

export type MenuEntry =
  | {
      kind?: 'item';
      id: string;
      /** Translated text (rule 11); the item's accessible name. */
      label: string;
      icon?: ReactNode;
      disabled?: boolean;
      onSelect: () => void;
    }
  | { kind: 'separator'; id: string }
  /** Opens a submenu of more entries (M6-05). */
  | { kind: 'submenu'; id: string; label: string; icon?: ReactNode; entries: MenuEntry[] }
  /** A tick box; the menu stays open so several can be ticked (M6-05). */
  | {
      kind: 'checkbox';
      id: string;
      label: string;
      checked: boolean;
      disabled?: boolean;
      onCheckedChange: (checked: boolean) => void;
    }
  /** One choice of several (M6-05): the chosen one is marked. */
  | {
      kind: 'radio';
      id: string;
      /** The group's name (screen readers). */
      label: string;
      value: string;
      options: readonly { value: string; label: string }[];
      onValueChange: (value: string) => void;
    };

export interface DropdownMenuProps {
  /** The trigger: a Button or IconButton, which carries the accessible name. */
  trigger: ReactElement;
  entries: MenuEntry[];
  align?: 'start' | 'center' | 'end';
  /** Controlled open state (optional: e.g. opened by a command). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Where focus goes when the menu closes (default: back to the trigger). */
  onCloseAutoFocus?: (e: Event) => void;
}

/** Keyboard: Enter/Space/ArrowDown open it, arrows move, Right opens a submenu, Esc closes (Radix). */
export function DropdownMenu({
  trigger,
  entries,
  align = 'start',
  open,
  onOpenChange,
  onCloseAutoFocus,
}: DropdownMenuProps) {
  return (
    <Menu.Root
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange ? { onOpenChange } : {})}
    >
      <Menu.Trigger asChild>{trigger}</Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          className="ui-menu"
          align={align}
          sideOffset={4}
          collisionPadding={8}
          {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}
        >
          <Entries entries={entries} />
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function Entries({ entries }: { entries: readonly MenuEntry[] }) {
  return entries.map((e) => {
    switch (e.kind) {
      case 'separator':
        return <Menu.Separator key={e.id} className="ui-menu-separator" />;
      case 'submenu':
        return (
          <Menu.Sub key={e.id}>
            <Menu.SubTrigger className="ui-menu-item" data-menu-id={e.id}>
              <span className="ui-menu-icon" aria-hidden="true">
                {e.icon}
              </span>
              <span className="ui-menu-label">{e.label}</span>
              <ChevronRight16Regular aria-hidden className="ui-menu-chevron" />
            </Menu.SubTrigger>
            <Menu.Portal>
              <Menu.SubContent className="ui-menu" collisionPadding={8} sideOffset={2}>
                <Entries entries={e.entries} />
              </Menu.SubContent>
            </Menu.Portal>
          </Menu.Sub>
        );
      case 'checkbox':
        return (
          <Menu.CheckboxItem
            key={e.id}
            className="ui-menu-item"
            checked={e.checked}
            disabled={e.disabled ?? false}
            onCheckedChange={e.onCheckedChange}
            onSelect={(ev) => {
              ev.preventDefault();
            }}
          >
            <span className="ui-menu-icon" aria-hidden="true">
              <Menu.ItemIndicator>
                <Checkmark16Regular />
              </Menu.ItemIndicator>
            </span>
            <span className="ui-menu-label">{e.label}</span>
          </Menu.CheckboxItem>
        );
      case 'radio':
        return (
          <Menu.RadioGroup
            key={e.id}
            aria-label={e.label}
            value={e.value}
            onValueChange={e.onValueChange}
          >
            {e.options.map((o) => (
              <Menu.RadioItem key={o.value} className="ui-menu-item" value={o.value}>
                <span className="ui-menu-icon" aria-hidden="true">
                  <Menu.ItemIndicator>
                    <Circle16Filled className="ui-menu-radio-dot" />
                  </Menu.ItemIndicator>
                </span>
                <span className="ui-menu-label">{o.label}</span>
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        );
      default:
        return (
          <Menu.Item
            key={e.id}
            className="ui-menu-item"
            disabled={e.disabled ?? false}
            onSelect={e.onSelect}
          >
            {e.icon ? (
              <span className="ui-menu-icon" aria-hidden="true">
                {e.icon}
              </span>
            ) : null}
            <span className="ui-menu-label">{e.label}</span>
          </Menu.Item>
        );
    }
  });
}
