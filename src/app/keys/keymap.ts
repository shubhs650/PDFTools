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
  b('file.open', ['Ctrl+O']),
  b('file.save', ['Ctrl+S']),
  b('file.saveAs', ['Ctrl+Shift+S']),
  b('view.fitPage', ['Ctrl+0']),
  b('view.actualSize', ['Ctrl+1']),
  b('view.fitWidth', ['Ctrl+2']),
  b('view.zoomIn', ['Ctrl+=', 'Ctrl++']),
  b('view.zoomOut', ['Ctrl+-']),
  b('view.collapseRibbon', ['Ctrl+F1']),
  b('home.hand', ['H'], 'document'),
  b('home.select', ['V'], 'document'),
  { ...b('tool.cancel', ['Escape']), preventWhenDisabled: false },
  // Browser-reserved first, alternates after (M1-Q1).
  b('tab.close', ['Ctrl+F4', 'Ctrl+Alt+W', 'Ctrl+Alt+F4'], 'global', true),
  b('tab.next', ['Ctrl+PageDown', 'Ctrl+Alt+PageDown'], 'global', true),
  b('tab.prev', ['Ctrl+PageUp', 'Ctrl+Alt+PageUp'], 'global', true),
];
