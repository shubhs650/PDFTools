import { forwardRef, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '../../ui/components';
import { CommandIcon } from '../../ui/icons/CommandIcon';
import type { CommandDef } from '../commands';
import { commandLabelKey, commandShortKey } from '../commandLabels';
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
  /** After the command started (the backstage closes, M1-22). */
  onRan?: () => void;
}

/**
 * One ribbon command. Disabled commands use aria-disabled (not `disabled`) so
 * they stay focusable and the reason is announced and shown as a tooltip
 * (rule 12). Toggles expose aria-pressed and the Filled icon (ADR-010).
 * Compact commands show the icon only; `short` commands show a shorter text;
 * in both cases the full label is the accessible name and the tooltip.
 */
export const RibbonButton = forwardRef<HTMLButtonElement, RibbonButtonProps>(function RibbonButton(
  { command, large, tabIndex, iconOnly = false, onRan },
  ref,
) {
  const { t } = useTranslation();
  const state = useCommandState(command.id);
  const reasonId = useId();
  const label = t(commandLabelKey(command.id));
  const compact = iconOnly || command.compact === true;
  const visible = compact ? null : command.short ? t(commandShortKey(command.id)) : label;
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
      aria-label={visible === label ? undefined : label}
      {...(command.toggle ? { 'aria-pressed': state.pressed } : {})}
      onClick={() => {
        if (disabled) return;
        void runCommand(command.id);
        onRan?.();
      }}
    >
      <CommandIcon id={command.id} large={large} pressed={state.pressed} className="ribbon-icon" />
      {visible === null ? null : <span className="ribbon-label">{visible}</span>}
      {reason ? (
        <span id={reasonId} className="ui-visually-hidden">
          {reason}
        </span>
      ) : null}
    </button>
  );
  return visible !== label || reason ? (
    <Tooltip content={reason ? `${label} — ${reason}` : label}>{button}</Tooltip>
  ) : (
    button
  );
});
