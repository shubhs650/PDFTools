// Icon registry (ADR-010 decision 4): command id → glyphs. Fluent glyphs come
// from the generated per-icon imports; custom icons override them. Icons are
// decorative: render them aria-hidden; the control's i18n label is its name.
import { COMMANDS } from '../../app/commands';
import { CUSTOM_GLYPHS } from './custom';
import { FLUENT_GLYPHS } from './fluent.generated';
import type { FluentGlyphs, IconComponent } from './types';

export type { FluentGlyphs, GlyphSet, IconComponent } from './types';

export function glyphsFor(commandId: string): FluentGlyphs {
  const custom = CUSTOM_GLYPHS[commandId];
  const fluent = FLUENT_GLYPHS[commandId];
  const g = custom ?? fluent;
  if (!g) throw new Error(`No icon for command ${commandId}`);
  return g;
}

/**
 * The icon to show for a command. `large` falls back to the small glyph for
 * small commands; `pressed` uses the Filled style when the command has one.
 */
export function iconFor(
  commandId: string,
  { large = false, pressed = false }: { large?: boolean; pressed?: boolean } = {},
): IconComponent {
  const g = glyphsFor(commandId);
  const set = pressed && g.filled ? g.filled : g.regular;
  return (large ? set.large : undefined) ?? set.small;
}

/** Ids with a registered icon (for tests and the ribbon). */
export const ICON_COMMAND_IDS: readonly string[] = COMMANDS.map((c) => c.id);
