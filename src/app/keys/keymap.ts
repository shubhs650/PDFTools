// The central keymap (D-29, §8.1, ADR-001 B5, M1-Q1). Every shortcut in the app
// is declared here; the shortcut sheet (Help) is generated from it. Feature
// tasks add their keys here when their commands land.
//
// Browser-reserved keys: Chrome keeps Ctrl+W, Ctrl+F4, Ctrl+(Shift+)Tab and
// Ctrl+PageUp/PageDown in a normal tab. They are still bound (they reach the
// page in some installed-PWA cases) and each has an alternate (M1-Q1).

import { parseChord, type Chord } from './chord';

export type KeyScope =
  /** Anywhere except while typing in a text field (Esc works there too). */
  | 'global'
  /** Only when focus is inside the document area (single-letter keys). */
  | 'document';

export interface Binding {
  /** A command id from src/app/commands.ts or an internal action. */
  target: string;
  chords: Chord[];
  scope: KeyScope;
  /** Chrome reserves the first chord in a normal tab; the rest are alternates. */
  reservedFirst?: boolean;
  /**
   * Swallow the key even when the command is disabled (default). Esc sets
   * false so the browser keeps it when nothing in the app uses it.
   */
  preventWhenDisabled?: boolean;
  /**
   * Also while typing in a text field (a form field, the find box): Ctrl
   * chords that no text field uses for editing, so Ctrl+S in a form field
   * saves instead of reaching the browser's "Save page".
   */
  inText?: boolean;
}

const b = (
  target: string,
  chords: string[],
  scope: KeyScope = 'global',
  reservedFirst = false,
): Binding => ({
  target,
  chords: chords.map(parseChord),
  scope,
  ...(reservedFirst ? { reservedFirst } : {}),
});

export const KEYMAP: readonly Binding[] = [
  { ...b('file.open', ['Ctrl+O']), inText: true },
  { ...b('file.save', ['Ctrl+S']), inText: true },
  { ...b('file.saveAs', ['Ctrl+Shift+S']), inText: true },
  // Our print dialog (M2-15), not the browser's print of the app window.
  { ...b('file.print', ['Ctrl+P']), inText: true },
  b('view.fitPage', ['Ctrl+0']),
  b('view.actualSize', ['Ctrl+1']),
  b('view.fitWidth', ['Ctrl+2']),
  b('view.zoomIn', ['Ctrl+=', 'Ctrl++']),
  b('view.zoomOut', ['Ctrl+-']),
  b('view.collapseRibbon', ['Ctrl+F1']),
  // Quick Find (M2-07, §8.1): runs only on Enter in the bar; F3 walks the results.
  { ...b('home.find', ['Ctrl+F']), inText: true },
  b('find.next', ['F3']),
  b('find.prev', ['Shift+F3']),
  // Advanced Search pane (M2-09).
  { ...b('home.advancedSearch', ['Ctrl+Shift+F']), inText: true },
  // Previous / Next View (M2-10).
  b('view.prevView', ['Alt+ArrowLeft']),
  b('view.nextView', ['Alt+ArrowRight']),
  b('home.hand', ['H'], 'document'),
  b('home.select', ['V'], 'document'),
  // Text selection (M2-04): in the document only, so text fields keep their own.
  b('edit.copy', ['Ctrl+C'], 'document'),
  b('edit.selectAll', ['Ctrl+A'], 'document'),
  { ...b('tool.cancel', ['Escape']), preventWhenDisabled: false },
  // Annotations (M3-05, §7.1): undo/redo per document; in the document, the
  // selected annotations are deleted, nudged (1 pt, Shift: 10 pt) and Tab walks
  // a page's annotations. Without a selection the keys keep their usual job
  // (scrolling, focus), so they are never swallowed then.
  b('qat.undo', ['Ctrl+Z']),
  b('qat.redo', ['Ctrl+Y', 'Ctrl+Shift+Z']),
  { ...b('annotation.delete', ['Delete'], 'document'), preventWhenDisabled: false },
  { ...b('annotation.next', ['Tab'], 'document'), preventWhenDisabled: false },
  { ...b('annotation.prev', ['Shift+Tab'], 'document'), preventWhenDisabled: false },
  { ...b('annotation.nudgeLeft', ['ArrowLeft'], 'document'), preventWhenDisabled: false },
  { ...b('annotation.nudgeRight', ['ArrowRight'], 'document'), preventWhenDisabled: false },
  { ...b('annotation.nudgeUp', ['ArrowUp'], 'document'), preventWhenDisabled: false },
  { ...b('annotation.nudgeDown', ['ArrowDown'], 'document'), preventWhenDisabled: false },
  {
    ...b('annotation.nudgeLeftFar', ['Shift+ArrowLeft'], 'document'),
    preventWhenDisabled: false,
  },
  {
    ...b('annotation.nudgeRightFar', ['Shift+ArrowRight'], 'document'),
    preventWhenDisabled: false,
  },
  { ...b('annotation.nudgeUpFar', ['Shift+ArrowUp'], 'document'), preventWhenDisabled: false },
  {
    ...b('annotation.nudgeDownFar', ['Shift+ArrowDown'], 'document'),
    preventWhenDisabled: false,
  },
  // Browser-reserved first, alternates after (M1-Q1).
  b('tab.close', ['Ctrl+F4', 'Ctrl+Alt+W', 'Ctrl+Alt+F4'], 'global', true),
  b('tab.next', ['Ctrl+PageDown', 'Ctrl+Alt+PageDown'], 'global', true),
  b('tab.prev', ['Ctrl+PageUp', 'Ctrl+Alt+PageUp'], 'global', true),
];
