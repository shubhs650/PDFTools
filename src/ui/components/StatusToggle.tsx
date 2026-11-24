import type { ReactNode } from 'react';
import { Tooltip } from './Tooltip';

export interface StatusToggleProps {
  /** The visible text and accessible name (rule 12), translated (rule 11). */
  label: string;
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  /** The icon: Regular, or Filled while pressed (ADR-010); the caller picks. */
  icon: ReactNode;
  /** Tooltip text, e.g. the label with its shortcut; the label when left out. */
  tooltip?: string;
  /** The shortcut as `aria-keyshortcuts` spells it ("Control+5"), when there is one. */
  keys?: string;
  'data-testid'?: string;
}

/**
 * A labelled status bar toggle (M13-04, D-70): icon and always-visible text, at least
 * 28 px tall, the whole button clickable; pressed shows the accent tint and the Filled
 * icon, `aria-pressed` says so. Only a very narrow window hides the text (the status
 * bar folds the view modes first); the name and tooltip stay.
 */
export function StatusToggle({
  label,
  pressed,
  onPressedChange,
  icon,
  tooltip,
  keys,
  'data-testid': testId,
}: StatusToggleProps) {
  return (
    <Tooltip content={tooltip ?? label} side="top">
      <button
        type="button"
        className="status-toggle ui-focusable"
        aria-pressed={pressed}
        {...(keys ? { 'aria-keyshortcuts': keys } : {})}
        data-testid={testId}
        onClick={() => {
          onPressedChange(!pressed);
        }}
      >
        <span aria-hidden="true" className="status-toggle-icon">
          {icon}
        </span>
        <span className="status-toggle-label">{label}</span>
      </button>
    </Tooltip>
  );
}
