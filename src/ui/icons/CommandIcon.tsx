import { createElement } from 'react';
import { iconAccentFor } from './accents';
import { iconFor } from './registry';

export interface CommandIconProps {
  /** Command id from src/app/commands.ts. */
  id: string;
  large?: boolean;
  /** Filled glyph for the active/pressed state (ADR-010). */
  pressed?: boolean;
  className?: string;
}

/**
 * Renders a command's icon (decorative: the control carries the name, rule 12).
 * A key tool's icon carries `data-icon-accent` (M10-08·O1); the ribbon and menu
 * styles colour it with that hue's token unless the command is disabled.
 */
export function CommandIcon({ id, large = false, pressed = false, className }: CommandIconProps) {
  const accent = iconAccentFor(id, pressed);
  return createElement(iconFor(id, { large, pressed }), {
    'aria-hidden': true,
    ...(className ? { className } : {}),
    ...(accent ? { 'data-icon-accent': accent } : {}),
  });
}
