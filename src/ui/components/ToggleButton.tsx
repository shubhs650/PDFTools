import * as Toggle from '@radix-ui/react-toggle';
import type { ReactNode } from 'react';
import { buttonClass } from './buttonClass';
import { Tooltip } from './Tooltip';

export interface ToggleButtonProps {
  /** Accessible name (rule 12); also the visible text unless `iconOnly`. */
  label: string;
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  icon?: ReactNode;
  /** Filled variant of the icon for the pressed state (ADR-010). */
  pressedIcon?: ReactNode;
  iconOnly?: boolean;
  disabled?: boolean | undefined;
  size?: 'small' | 'medium' | undefined;
}

/** A two-state button (`aria-pressed`), e.g. "Enable snapping". */
export function ToggleButton({
  label,
  pressed,
  onPressedChange,
  icon,
  pressedIcon,
  iconOnly = false,
  disabled,
  size,
}: ToggleButtonProps) {
  const shown = pressed && pressedIcon ? pressedIcon : icon;
  const root = (
    <Toggle.Root
      pressed={pressed}
      onPressedChange={onPressedChange}
      disabled={disabled ?? false}
      aria-label={iconOnly ? label : undefined}
      className={buttonClass('subtle', size, iconOnly ? 'ui-button--icon' : '')}
    >
      {shown ? <span aria-hidden="true">{shown}</span> : null}
      {iconOnly ? null : <span>{label}</span>}
    </Toggle.Root>
  );
  return iconOnly ? <Tooltip content={label}>{root}</Tooltip> : root;
}
