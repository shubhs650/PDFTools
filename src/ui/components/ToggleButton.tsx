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
  /**
   * Icon and visible label, the label hidden visually (still the name) where the bar is
   * narrow (`.ui-compact-bar`, M12-25); a tooltip always.
   */
  compact?: boolean;
  /** Tooltip text, when it says more than the label (compact buttons). */
  tooltip?: string;
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
  compact = false,
  tooltip,
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
      className={buttonClass(
        'subtle',
        size,
        iconOnly ? 'ui-button--icon' : compact ? 'ui-button--compact' : '',
      )}
    >
      {shown ? <span aria-hidden="true">{shown}</span> : null}
      {iconOnly ? null : <span className={compact ? 'ui-button-label' : undefined}>{label}</span>}
    </Toggle.Root>
  );
  return iconOnly || compact ? <Tooltip content={tooltip ?? label}>{root}</Tooltip> : root;
}
