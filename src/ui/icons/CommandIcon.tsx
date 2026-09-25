import { createElement } from 'react';
import { iconFor } from './registry';

export interface CommandIconProps {
  /** Command id from src/app/commands.ts. */
  id: string;
  large?: boolean;
  /** Filled glyph for the active/pressed state (ADR-010). */
  pressed?: boolean;
  className?: string;
}

/** Renders a command's icon (decorative: the control carries the name, rule 12). */
export function CommandIcon({ id, large = false, pressed = false, className }: CommandIconProps) {
  return createElement(iconFor(id, { large, pressed }), {
    'aria-hidden': true,
    ...(className ? { className } : {}),
  });
}
