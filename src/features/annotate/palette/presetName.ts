import type { TFunction } from 'i18next';
import { msg, type MessageKey } from '../../../i18n';
import type { PresetColor, PresetStyle } from '../tools/stylePalette';

const COLOR_KEYS: Record<PresetColor, MessageKey> = {
  red: msg('stylePalette.color.red'),
  purple: msg('stylePalette.color.purple'),
  indigo: msg('stylePalette.color.indigo'),
  blue: msg('stylePalette.color.blue'),
  green: msg('stylePalette.color.green'),
  yellow: msg('stylePalette.color.yellow'),
  black: msg('stylePalette.color.black'),
};

/** A preset's name: its colour, or "‹colour› cloudy" (rule 11). */
export function presetName(p: PresetStyle, t: TFunction): string {
  const color = t(COLOR_KEYS[p.color]);
  return p.cloudy ? t('stylePalette.cloudyName', { color }) : color;
}
