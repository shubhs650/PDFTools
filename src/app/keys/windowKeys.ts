// Keys that work in one pane or window and are read by its own listener, not by the
// central keymap (M13-09, D-29): held keys (Space, Z, X, Alt) and the keys of a
// comparison's lists and of Review & Extract. The shortcut sheet lists them under
// the keymap's rows, and tests/keys/everyKeyListed.test.ts checks that every key a
// listener in src/ reads is on the sheet. The listeners import their keys from here.
import { msg, type MessageKey } from '../../i18n';
import { parseChord, type Chord } from './chord';

/** Next difference or change in a comparison (M12-14, M12-17). */
export const NEXT_DIFFERENCE_KEY = 'F8';
/** Previous difference or change in a comparison, as `aria-keyshortcuts` spells it. */
export const PREV_DIFFERENCE_KEYS = 'Shift+F8';
/** Held in a PDF overlay: blink between old and new (M12-12). */
export const BLINK_KEY = 'x';

export interface WindowKey {
  /** A stable id (the row's React key and the test's name). */
  id: string;
  chords: Chord[];
  label: MessageKey;
  /** Held down rather than pressed. */
  hold?: boolean;
}

const k = (id: string, chords: string[], label: MessageKey, hold = false): WindowKey => ({
  id,
  chords: chords.map(parseChord),
  label,
  ...(hold ? { hold } : {}),
});

export const WINDOW_KEYS: readonly WindowKey[] = [
  k('hand', ['Space'], msg('shortcuts.window.spaceHand'), true),
  k('zoomHold', ['Z'], msg('shortcuts.window.zoomHold'), true),
  k('noSnap', ['Alt'], msg('shortcuts.window.noSnap'), true),
  k('nextDifference', [NEXT_DIFFERENCE_KEY], msg('shortcuts.window.nextDifference')),
  k('prevDifference', [PREV_DIFFERENCE_KEYS], msg('shortcuts.window.prevDifference')),
  k('blink', [BLINK_KEY.toUpperCase()], msg('shortcuts.window.blink'), true),
  k('tableMerge', ['M'], msg('shortcuts.window.tableMerge')),
  k('tableUnmerge', ['U'], msg('shortcuts.window.tableUnmerge')),
  k('tableHeader', ['H'], msg('shortcuts.window.tableHeader')),
  k('tableDivider', ['Insert'], msg('shortcuts.window.tableDivider')),
];
