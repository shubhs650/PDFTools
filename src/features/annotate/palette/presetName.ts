import type { TFunction } from 'i18next';
import { msg, type MessageKey } from '../../../i18n';
import {
  presetOf,
  type PresetColor,
  type PresetStyle,
  type UserStyle,
} from '../tools/stylePalette';
import type { StyleTool } from '../tools/toolDefaults';

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

/** A style's shown name: its own, or its preset's (rule 11) — M6-17. */
export function styleName(tool: StyleTool, style: UserStyle, t: TFunction): string {
  if (style.name) return style.name;
  const p = presetOf(tool, style);
  return p ? presetName(p, t) : style.name;
}
