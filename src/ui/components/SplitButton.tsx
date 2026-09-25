import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';
import { DropdownMenu, type MenuEntry } from './DropdownMenu';
import { IconButton } from './IconButton';

export interface SplitButtonProps {
  /** Primary action text and accessible name (rule 12). */
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  /** Alternatives shown by the arrow part. */
  entries: MenuEntry[];
  /** Accessible name of the arrow part; defaults to "More options for <label>". */
  menuLabel?: string;
  /** The arrow glyph (an icon from the registry). */
  menuIcon: ReactNode;
  disabled?: boolean | undefined;
  size?: 'small' | 'medium' | undefined;
}

export function SplitButton({
  label,
  icon,
  onClick,
  entries,
  menuLabel,
  menuIcon,
  disabled,
  size,
}: SplitButtonProps) {
  const { t } = useTranslation();
  return (
    <span className="ui-split">
      <Button
        label={label}
        icon={icon}
        onClick={onClick}
        disabled={disabled ?? false}
        size={size}
      />
      <DropdownMenu
        entries={entries}
        trigger={
          <IconButton
            label={menuLabel ?? t('ui.splitButton.more', { label })}
            icon={menuIcon}
            variant="default"
            size={size}
            tooltip={false}
            disabled={disabled ?? false}
          />
        }
      />
    </span>
  );
}
