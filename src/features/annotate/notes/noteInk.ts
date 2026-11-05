// The ink of a sticky note window's header, drawn in the note's own colour
// (M7-06, rule 12): dark text on a light note, light text on a dark one,
// whichever has the higher contrast. Pure; the colours are theme tokens.
import { contrastRatio, parseHex, type Rgb } from '../../bookmarks/readableColor';
import { NOTE_YELLOW } from '../tools/toolDefaults';

export const NOTE_DEFAULT_COLOR = NOTE_YELLOW;

const DARK: Rgb = [0x1f / 255, 0x1f / 255, 0x1f / 255];
const LIGHT: Rgb = [1, 1, 1];

/** The CSS colour for text on `color` (`#rrggbb`): a token. */
export function noteInk(color: string): string {
  const c = parseHex(color);
  if (!c) return 'var(--color-note-ink-dark)';
  return contrastRatio(c, DARK) >= contrastRatio(c, LIGHT)
    ? 'var(--color-note-ink-dark)'
    : 'var(--color-note-ink-light)';
}
