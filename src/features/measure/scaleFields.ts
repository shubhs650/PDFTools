// Scale fields shared by the Set Scale, Calibrate (M3-15) and Scale Viewport
// (M3-17) dialogs: units, precision or ft-in fraction, and the pages.
import { useState } from 'react';
import type { Scale } from '../../model/scale';
import type { MeasureDefaults } from './scaleStore';
import type { UnitChoice } from './units';

export const toScale = (
  paper: number,
  real: number,
  unit: UnitChoice,
  precision: number,
  ftIn: number,
): Scale =>
  unit === 'ftin' ? { paper, real, unit: 'ft', precision, ftIn } : { paper, real, unit, precision };

export const unitOf = (d: MeasureDefaults): UnitChoice =>
  d.ftIn && d.unit === 'ft' ? 'ftin' : d.unit;

/** Units, precision (or ft-in fraction) and the pages a scale applies to: shared by both dialogs. */
export function useScaleFields(defaults: MeasureDefaults) {
  const [unit, setUnit] = useState<UnitChoice>(unitOf(defaults));
  const [precision, setPrecision] = useState(defaults.precision);
  const [ftIn, setFtIn] = useState(defaults.ftIn ?? 16);
  const [where, setWhere] = useState<'page' | 'all' | 'range'>('page');
  const [range, setRange] = useState('');
  return {
    unit,
    setUnit,
    precision,
    setPrecision,
    ftIn,
    setFtIn,
    where,
    setWhere,
    range,
    setRange,
  };
}

export type Fields = ReturnType<typeof useScaleFields>;
