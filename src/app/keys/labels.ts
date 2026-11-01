// Platform-aware key names for display (preview review UI04): one source for
// the shortcut sheet and the Help text, so both say Cmd on macOS and Ctrl
// elsewhere, and Help never drifts from the keymap.
import type { TFunction } from 'i18next';
import { msg, type MessageKey } from '../../i18n';
import { formatChord, isMac, type KeyLabels } from './chord';
import { KEYMAP } from './keymap';

const NAMED: Record<string, MessageKey> = {
  PageUp: msg('shortcuts.key.pageUp'),
  PageDown: msg('shortcuts.key.pageDown'),
  Escape: msg('shortcuts.key.escape'),
  ArrowLeft: msg('shortcuts.key.arrowLeft'),
  ArrowRight: msg('shortcuts.key.arrowRight'),
  ArrowUp: msg('shortcuts.key.arrowUp'),
  ArrowDown: msg('shortcuts.key.arrowDown'),
  Delete: msg('shortcuts.key.delete'),
  Tab: msg('shortcuts.key.tab'),
  ContextMenu: msg('shortcuts.key.menu'),
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
      const key = NAMED[k];
      return key ? t(key) : k;
    },
  };
}

/**
 * The displayed keys of a command's binding ("Ctrl+S", "Cmd+S" on macOS):
 * the first chord that is not browser-reserved, preferring "+" over its
 * unshifted "=" twin. Empty when nothing is bound.
 */
export function shortcutText(target: string, t: TFunction, mac: boolean = isMac()): string {
  const binding = KEYMAP.find((b) => b.target === target);
  if (!binding) return '';
  const chord =
    binding.chords.find((c) => c.key === '+') ??
    binding.chords[binding.reservedFirst ? 1 : 0] ??
    binding.chords[0];
  return chord ? formatChord(chord, keyLabels(t, mac)) : '';
}
