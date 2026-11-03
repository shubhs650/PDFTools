// The "Standard colors" grid of the colour picker (M6-16): our own palette,
// 8 hues across and 6 tones down. Row 1 is grays from black to white, row 2
// the pure colours, then pale, light, dark and darkest tones. It holds the
// shipped defaults (red #FF0000, the highlight yellow #FFE14D) and the
// style-palette presets (purple, indigo, green). Pure: no React.
import { msg, type MessageKey } from '../../i18n';

export interface PaletteColor {
  /** Lower-case `#rrggbb`. */
  hex: string;
  /** The colour's name (rule 11): the swatch's accessible name and tooltip. */
  name: MessageKey;
}

export const PALETTE_COLUMNS = 8;

const c = (hex: string, name: MessageKey): PaletteColor => ({ hex, name });

export const STANDARD_COLORS: readonly PaletteColor[] = [
  // Grays.
  c('#000000', msg('colorPicker.color.black')),
  c('#404040', msg('colorPicker.color.gray75')),
  c('#595959', msg('colorPicker.color.gray65')),
  c('#808080', msg('colorPicker.color.gray50')),
  c('#a6a6a6', msg('colorPicker.color.gray35')),
  c('#c0c0c0', msg('colorPicker.color.gray25')),
  c('#e0e0e0', msg('colorPicker.color.gray10')),
  c('#ffffff', msg('colorPicker.color.white')),
  // Pure.
  c('#ff0000', msg('colorPicker.color.red')),
  c('#ff8000', msg('colorPicker.color.orange')),
  c('#ffff00', msg('colorPicker.color.yellow')),
  c('#00ff00', msg('colorPicker.color.lime')),
  c('#00ffff', msg('colorPicker.color.cyan')),
  c('#0000ff', msg('colorPicker.color.blue')),
  c('#800080', msg('colorPicker.color.purple')),
  c('#ff00ff', msg('colorPicker.color.magenta')),
  // Pale.
  c('#ffcccc', msg('colorPicker.color.paleRed')),
  c('#ffe5cc', msg('colorPicker.color.paleOrange')),
  c('#ffffcc', msg('colorPicker.color.paleYellow')),
  c('#ccffcc', msg('colorPicker.color.paleGreen')),
  c('#ccffff', msg('colorPicker.color.paleCyan')),
  c('#ccccff', msg('colorPicker.color.paleBlue')),
  c('#e5cce5', msg('colorPicker.color.palePurple')),
  c('#ffccff', msg('colorPicker.color.paleMagenta')),
  // Light.
  c('#ff8080', msg('colorPicker.color.lightRed')),
  c('#ffbf80', msg('colorPicker.color.lightOrange')),
  c('#ffe14d', msg('colorPicker.color.highlightYellow')),
  c('#80ff80', msg('colorPicker.color.lightGreen')),
  c('#80ffff', msg('colorPicker.color.lightCyan')),
  c('#8080ff', msg('colorPicker.color.lightBlue')),
  c('#bf80bf', msg('colorPicker.color.lightPurple')),
  c('#ff80ff', msg('colorPicker.color.lightMagenta')),
  // Dark.
  c('#c00000', msg('colorPicker.color.darkRed')),
  c('#c06000', msg('colorPicker.color.darkOrange')),
  c('#c0a000', msg('colorPicker.color.darkYellow')),
  c('#008000', msg('colorPicker.color.green')),
  c('#008080', msg('colorPicker.color.teal')),
  c('#0000c0', msg('colorPicker.color.darkBlue')),
  c('#4b0082', msg('colorPicker.color.indigo')),
  c('#c000c0', msg('colorPicker.color.darkMagenta')),
  // Darkest.
  c('#800000', msg('colorPicker.color.maroon')),
  c('#804000', msg('colorPicker.color.brown')),
  c('#808000', msg('colorPicker.color.olive')),
  c('#004000', msg('colorPicker.color.darkGreen')),
  c('#004040', msg('colorPicker.color.darkTeal')),
  c('#000080', msg('colorPicker.color.navy')),
  c('#400040', msg('colorPicker.color.darkPurple')),
  c('#800040', msg('colorPicker.color.plum')),
];

/** Where "More colors…" starts when there is no single colour (Mixed, none). */
export const NATIVE_START = '#000000';

const HEX6 = /^#[0-9a-f]{6}$/iu;

/** `#rrggbb` (any case) → lower case; anything else → null. */
export function normalizeHex(value: string): string | null {
  return HEX6.test(value) ? value.toLowerCase() : null;
}

/** The palette entry of a colour, if it is one of the standard colours. */
export function paletteColor(value: string): PaletteColor | undefined {
  const hex = normalizeHex(value);
  return hex === null ? undefined : STANDARD_COLORS.find((p) => p.hex === hex);
}

/** `#rrggbb` → [r, g, b] (0–255). */
export function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/**
 * Where a key moves focus in a grid of `count` cells, `columns` wide
 * (ARIA grid pattern): arrows by one, stopping at the edges; Home/End to the
 * row's ends; Ctrl+Home/End to the first and last cell. `null` for other keys.
 */
export function gridMove(
  index: number,
  key: string,
  ctrl: boolean,
  count: number,
  columns: number,
): number | null {
  const row = Math.floor(index / columns);
  const rowStart = row * columns;
  const rowEnd = Math.min(rowStart + columns, count) - 1;
  switch (key) {
    case 'ArrowRight':
      return Math.min(index + 1, rowEnd);
    case 'ArrowLeft':
      return Math.max(index - 1, rowStart);
    case 'ArrowDown':
      return index + columns < count ? index + columns : index;
    case 'ArrowUp':
      return index - columns >= 0 ? index - columns : index;
    case 'Home':
      return ctrl ? 0 : rowStart;
    case 'End':
      return ctrl ? count - 1 : rowEnd;
    default:
      return null;
  }
}
