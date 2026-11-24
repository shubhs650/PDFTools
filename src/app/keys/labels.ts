// Platform-aware key names for display (preview review UI04): one source for
// the shortcut sheet and the Help text, so both say Cmd on macOS and Ctrl
// elsewhere, and Help never drifts from the keymap.
import type { TFunction } from 'i18next';
import { msg, type MessageKey } from '../../i18n';
import { formatChord, isMac, type KeyLabels } from './chord';
import { KEYMAP, chordsOn } from './keymap';

const NAMED: Record<string, MessageKey> = {
  PageUp: msg('shortcuts.key.pageUp'),
  PageDown: msg('shortcuts.key.pageDown'),
  Escape: msg('shortcuts.key.escape'),
  ArrowLeft: msg('shortcuts.key.arrowLeft'),
  ArrowRight: msg('shortcuts.key.arrowRight'),
  ArrowUp: msg('shortcuts.key.arrowUp'),
  ArrowDown: msg('shortcuts.key.arrowDown'),
  Delete: msg('shortcuts.key.delete'),
  Insert: msg('shortcuts.key.insert'),
  Enter: msg('shortcuts.key.enter'),
  Tab: msg('shortcuts.key.tab'),
  ContextMenu: msg('shortcuts.key.menu'),
  ' ': msg('shortcuts.key.space'),
  // Punctuation reads better by name ("Ctrl+Plus", not "Ctrl++").
  '+': msg('shortcuts.key.plus'),
  '-': msg('shortcuts.key.minus'),
};

export function keyLabels(t: TFunction, mac: boolean = isMac()): KeyLabels {
  return {
    ctrl: mac ? t('shortcuts.key.cmd') : t('shortcuts.key.ctrl'),
    shift: t('shortcuts.key.shift'),
    alt: mac ? t('shortcuts.key.option') : t('shortcuts.key.alt'),
    named: (k) => {
      // A held modifier on its own (Alt while clicking: no snapping, M13-09).
      if (k === 'Alt') return mac ? t('shortcuts.key.option') : t('shortcuts.key.alt');
      const key = NAMED[k];
      return key ? t(key) : k;
    },
  };
}

/**
 * Commands whose key is an action's (M13-09): the loupe's M shows or hides the loupe
 * where the person is, so both Loupe buttons show it in their tooltips.
 */
const KEY_OF: Readonly<Record<string, string>> = {
  'view.loupe': 'loupe.toggle',
  'measure.loupe': 'loupe.toggle',
};

/**
 * The displayed keys of a command's binding ("Ctrl+S", "Cmd+S" on macOS):
 * the first chord that is not browser-reserved, preferring "+" over its
 * unshifted "=" twin. Empty when nothing is bound.
 */
export function shortcutText(target: string, t: TFunction, mac: boolean = isMac()): string {
  const keyed = KEY_OF[target] ?? target;
  const binding = KEYMAP.find((b) => b.target === keyed);
  if (!binding) return '';
  const chords = chordsOn(binding, mac);
  const chord =
    chords.find((c) => c.key === '+') ?? chords[binding.reservedFirst ? 1 : 0] ?? chords[0];
  return chord ? formatChord(chord, keyLabels(t, mac)) : '';
}
