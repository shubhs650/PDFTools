// Units offered for scales (M3-15); 'ftin' is feet shown as feet and inches.
import { msg, type MessageKey } from '../../i18n';
import type { Unit } from '../../model/scale';

export type UnitChoice = Unit | 'ftin';

export const UNIT_KEYS: Record<UnitChoice, MessageKey> = {
  mm: msg('scale.units.mm'),
  cm: msg('scale.units.cm'),
  m: msg('scale.units.m'),
  in: msg('scale.units.in'),
  ft: msg('scale.units.ft'),
  ftin: msg('scale.units.ftin'),
};
