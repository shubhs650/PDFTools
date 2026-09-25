import { forwardRef, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '../../ui/components';
import { CommandIcon } from '../../ui/icons/CommandIcon';
import type { CommandDef } from '../commands';
import { commandLabelKey } from '../commandLabels';
import { runCommand } from '../commands/dispatch';
import { useCommandState } from '../commands/useCommandState';

export interface RibbonButtonProps {
  command: CommandDef;
  /** Large (32 px icon, label below) or small (20 px icon, label beside). */
  large: boolean;
  /** Roving tabindex: only the current control of the toolbar is in the tab order. */
  tabIndex: number;
  /** Icon only (quick access toolbar); the label becomes the name and tooltip. */
  iconOnly?: boolean;
}

/**
 * One ribbon command. Disabled commands use aria-disabled (not `disabled`) so
 * they stay focusable and the reason is announced and shown as a tooltip
 * (rule 12). Toggles expose aria-pressed and the Filled icon (ADR-010).
 */
export const RibbonButton = forwardRef<HTMLButtonElement, RibbonButtonProps>(function RibbonButton(
  { command, large, tabIndex, iconOnly = false },
  ref,
) {
  const { t } = useTranslation();
  const state = useCommandState(command.id);
  const reasonId = useId();
  const label = t(commandLabelKey(command.id));
  const disabled = !state.enabled;
  const reason = state.enabled ? null : t(state.reason);
  const button = (
    <button
      ref={ref}
      type="button"
      data-command={command.id}
      className={`ribbon-button ${large ? 'ribbon-button--large' : 'ribbon-button--small'} ui-focusable`}
      tabIndex={tabIndex}
      aria-disabled={disabled || undefined}
      aria-describedby={reason ? reasonId : undefined}
      aria-label={iconOnly ? label : undefined}
      {...(command.toggle ? { 'aria-pressed': state.pressed } : {})}
      onClick={() => {
        if (!disabled) void runCommand(command.id);
      }}
    >
      <CommandIcon id={command.id} large={large} pressed={state.pressed} className="ribbon-icon" />
      {iconOnly ? null : <span className="ribbon-label">{label}</span>}
      {reason ? (
        <span id={reasonId} className="ui-visually-hidden">
          {reason}
        </span>
      ) : null}
    </button>
  );
  return iconOnly || reason ? (
    <Tooltip content={reason ? `${label} — ${reason}` : label}>{button}</Tooltip>
  ) : (
    button
  );
});
