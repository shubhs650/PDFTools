// The text menu (M7-05, ADR-023 D-43 e): what is in it, and the Text Style
// it shows and sets. Text Style applies to the whole comment (`/DA` font,
// size and colour, `/Q` alignment): per-character styles would need rich text
// (`/RC`), which is not in M7. Hyperlink, Paragraph and Spell Check are not
// in it either (Q6). Pure.
import type { PdfAnnotationObject } from '@embedpdf/models';
import type { ContextMenuEntry } from '../../ui/components/contextMenuModel';
import {
  FONT_FAMILIES,
  patchFor,
  readProps,
  type FontFamily,
  type Plain,
  type Prop,
} from './properties/model';

const cmd = (id: string, keysOf?: string): ContextMenuEntry => ({
  kind: 'command',
  id,
  ...(keysOf ? { keysOf } : {}),
});
const sep = (key: string): ContextMenuEntry => ({ kind: 'separator', key });

/**
 * The edit commands, in PDF-XChange's order. Their keys are the editor's own
 * (the browser's, as in any text field), shown with the document commands'
 * labels for them: one keymap entry per chord.
 */
export const TEXT_EDIT_ENTRIES: readonly ContextMenuEntry[] = [
  cmd('text.undo', 'qat.undo'),
  cmd('text.redo', 'qat.redo'),
  sep('clipboard'),
  cmd('text.cut', 'edit.cut'),
  cmd('text.copy', 'edit.copy'),
  cmd('text.paste', 'edit.paste'),
  cmd('text.delete', 'comment.delete'),
  sep('select'),
  cmd('text.selectAll', 'edit.selectAll'),
];

/** After the Text Style submenu. */
export const TEXT_PROPERTIES_ENTRIES: readonly ContextMenuEntry[] = [cmd('edit.properties')];

/** The sizes offered (points), as a desktop editor's size list. */
export const FONT_SIZES: readonly number[] = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];

export interface TextStyle {
  family: FontFamily;
  bold: boolean;
  italic: boolean;
  /** Points. */
  size: number;
  /** `#rrggbb`. */
  color: string;
  /** 0 left, 1 centre, 2 right (`/Q`). */
  align: number;
}

const DEFAULT_STYLE: TextStyle = {
  family: 'helvetica',
  bold: false,
  italic: false,
  size: 12,
  color: '#000000',
  align: 0,
};

/** The comment's Text Style as the menu ticks it. */
export function textStyleOf(a: PdfAnnotationObject): TextStyle {
  const p = readProps([a]);
  const family = p.fontFamily;
  return {
    family: FONT_FAMILIES.includes(family as FontFamily)
      ? (family as FontFamily)
      : DEFAULT_STYLE.family,
    bold: p.bold === true,
    italic: p.italic === true,
    size: typeof p.fontSize === 'number' ? p.fontSize : DEFAULT_STYLE.size,
    color: typeof p.fontColor === 'string' ? p.fontColor.toLowerCase() : DEFAULT_STYLE.color,
    align: typeof p.textAlign === 'number' ? p.textAlign : DEFAULT_STYLE.align,
  };
}

/** One Text Style change. */
export type StyleChange =
  | { prop: 'fontFamily'; value: FontFamily }
  | { prop: 'bold' | 'italic'; value: boolean }
  | { prop: 'fontSize'; value: number }
  | { prop: 'fontColor'; value: string }
  | { prop: 'textAlign'; value: number };

/** The patch a Text Style change makes on the comment; null when it changes nothing. */
export function stylePatch(
  a: PdfAnnotationObject,
  change: StyleChange,
): Partial<PdfAnnotationObject> | null {
  const before = textStyleOf(a);
  const same: Record<StyleChange['prop'], Plain> = {
    fontFamily: before.family,
    bold: before.bold,
    italic: before.italic,
    fontSize: before.size,
    fontColor: before.color,
    textAlign: before.align,
  };
  const value = change.prop === 'fontColor' ? change.value.toLowerCase() : change.value;
  if (same[change.prop] === value) return null;
  return patchFor(a, change.prop satisfies Prop, value);
}
