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
  | { kind: 'separator'; id: string };

export interface DropdownMenuProps {
  /** The trigger: a Button or IconButton, which carries the accessible name. */
  trigger: ReactElement;
  entries: MenuEntry[];
  align?: 'start' | 'center' | 'end';
}

/** Keyboard: Enter/Space/ArrowDown open it, arrows move, Esc closes (Radix). */
export function DropdownMenu({ trigger, entries, align = 'start' }: DropdownMenuProps) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>{trigger}</Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="ui-menu" align={align} sideOffset={4}>
          {entries.map((e) =>
            e.kind === 'separator' ? (
              <Menu.Separator key={e.id} className="ui-menu-separator" />
            ) : (
              <Menu.Item
                key={e.id}
                className="ui-menu-item"
                disabled={e.disabled ?? false}
                onSelect={e.onSelect}
              >
                {e.icon ? <span aria-hidden="true">{e.icon}</span> : null}
                <span>{e.label}</span>
              </Menu.Item>
            ),
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
