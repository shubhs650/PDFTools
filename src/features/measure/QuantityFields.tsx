// An Area's or Volume's own units and decimals, and a Volume's Depth (M14-06,
// D-73, Q7, Q28), in the Properties pane: for the selected measurement
// (MeasureInfo) and, while the tool is on, for the next one ("‹Tool› Tool
// Properties", remembered on this device: quantitySettings.ts). "Automatic"
// follows the scale (m² and m³ for metric, sq ft and cu ft for imperial).
import { useTranslation } from 'react-i18next';
import { msg, type MessageKey } from '../../i18n';
import {
  AREA_SYMBOL,
  AREA_UNITS,
  DEPTH_UNITS,
  MAX_DECIMALS,
  QUANTITY_DECIMALS,
  VOLUME_SYMBOL,
  VOLUME_UNITS,
  type AreaUnit,
  type Depth,
  type VolumeUnit,
} from '../../model/measureQuantity';
import type { Unit } from '../../model/scale';
import { NumberField, SelectField } from '../annotate/properties/fields';
import { UNIT_KEYS } from './units';
import { setQuantities, useQuantities } from './quantitySettings';

const AREA_KEYS: Record<AreaUnit, MessageKey> = {
  mm2: msg('measure.units.area.mm2'),
  cm2: msg('measure.units.area.cm2'),
  m2: msg('measure.units.area.m2'),
  in2: msg('measure.units.area.in2'),
  ft2: msg('measure.units.area.ft2'),
  yd2: msg('measure.units.area.yd2'),
};

const VOLUME_KEYS: Record<VolumeUnit, MessageKey> = {
  mm3: msg('measure.units.volume.mm3'),
  cm3: msg('measure.units.volume.cm3'),
  m3: msg('measure.units.volume.m3'),
  in3: msg('measure.units.volume.in3'),
  ft3: msg('measure.units.volume.ft3'),
  yd3: msg('measure.units.volume.yd3'),
};

const AUTO = 'auto';

/** What these fields edit (absent units: Automatic). */
export interface QuantityChoice {
  areaUnit?: AreaUnit | undefined;
  areaDecimals?: number | undefined;
  volumeUnit?: VolumeUnit | undefined;
  volumeDecimals?: number | undefined;
  depth?: Depth | undefined;
}

export function QuantityFields({
  tool,
  value,
  autoArea,
  autoVolume,
  disabled,
  onChange,
}: {
  tool: 'area' | 'volume';
  value: QuantityChoice;
  /** The unit Automatic gives now (a placed measurement's scale), shown in its option. */
  autoArea?: AreaUnit;
  autoVolume?: VolumeUnit;
  disabled?: boolean;
  onChange: (change: QuantityChoice) => void;
}) {
  const { t } = useTranslation();
  const auto = (sym: string | undefined): string =>
    sym ? t('measure.props.unitAutoNow', { unit: sym }) : t('measure.props.unitAuto');
  const decimals = Array.from({ length: MAX_DECIMALS + 1 }, (_, n) => ({
    value: n,
    label: String(n),
  }));
  const areaOptions: { value: AreaUnit | typeof AUTO; label: string }[] = [
    { value: AUTO, label: auto(autoArea ? AREA_SYMBOL[autoArea] : undefined) },
    ...AREA_UNITS.map((u) => ({ value: u, label: t(AREA_KEYS[u]) })),
  ];
  const volumeOptions: { value: VolumeUnit | typeof AUTO; label: string }[] = [
    { value: AUTO, label: auto(autoVolume ? VOLUME_SYMBOL[autoVolume] : undefined) },
    ...VOLUME_UNITS.map((u) => ({ value: u, label: t(VOLUME_KEYS[u]) })),
  ];
  const depthUnits: { value: Unit; label: string }[] = DEPTH_UNITS.map((u) => ({
    value: u,
    label: t(UNIT_KEYS[u]),
  }));
  const depth = value.depth;
  return (
    <>
      {tool === 'volume' && depth ? (
        <>
          <NumberField
            label={t('measure.props.depth')}
            value={depth.value}
            unit={depth.unit}
            min={0.001}
            max={1_000_000}
            digits={4}
            disabled={disabled ?? false}
            onCommit={(v) => {
              if (v > 0) onChange({ depth: { value: v, unit: depth.unit } });
            }}
          />
          <SelectField
            label={t('measure.props.depthUnit')}
            value={depth.unit}
            options={depthUnits}
            disabled={disabled ?? false}
            onCommit={(unit) => {
              onChange({ depth: { value: depth.value, unit } });
            }}
          />
        </>
      ) : null}
      {tool === 'volume' ? (
        <>
          <SelectField
            label={t('measure.props.volumeUnit')}
            value={value.volumeUnit ?? AUTO}
            options={volumeOptions}
            disabled={disabled ?? false}
            onCommit={(u) => {
              onChange({ volumeUnit: u === AUTO ? undefined : u });
            }}
          />
          <SelectField
            label={t('measure.props.volumeDecimals')}
            value={value.volumeDecimals ?? QUANTITY_DECIMALS}
            options={decimals}
            disabled={disabled ?? false}
            onCommit={(n) => {
              onChange({ volumeDecimals: n === QUANTITY_DECIMALS ? undefined : n });
            }}
          />
        </>
      ) : null}
      <SelectField
        label={t('measure.props.areaUnit')}
        value={value.areaUnit ?? AUTO}
        options={areaOptions}
        disabled={disabled ?? false}
        onCommit={(u) => {
          onChange({ areaUnit: u === AUTO ? undefined : u });
        }}
      />
      <SelectField
        label={t('measure.props.areaDecimals')}
        value={value.areaDecimals ?? QUANTITY_DECIMALS}
        options={decimals}
        disabled={disabled ?? false}
        onCommit={(n) => {
          onChange({ areaDecimals: n === QUANTITY_DECIMALS ? undefined : n });
        }}
      />
    </>
  );
}

/** "Area Tool Properties", "Volume Tool Properties": what the next one starts with (remembered). */
export function QuantityToolFields({ tool }: { tool: 'area' | 'volume' }) {
  const { t } = useTranslation();
  const s = useQuantities((q) => q);
  return (
    <>
      <QuantityFields
        tool={tool}
        value={{
          ...(s.areaUnit ? { areaUnit: s.areaUnit } : {}),
          areaDecimals: s.areaDecimals,
          ...(s.volumeUnit ? { volumeUnit: s.volumeUnit } : {}),
          volumeDecimals: s.volumeDecimals,
          depth: s.depth,
        }}
        onChange={(c) => {
          setQuantities({
            ...('areaUnit' in c ? { areaUnit: c.areaUnit ?? null } : {}),
            ...('areaDecimals' in c ? { areaDecimals: c.areaDecimals ?? QUANTITY_DECIMALS } : {}),
            ...('volumeUnit' in c ? { volumeUnit: c.volumeUnit ?? null } : {}),
            ...('volumeDecimals' in c
              ? { volumeDecimals: c.volumeDecimals ?? QUANTITY_DECIMALS }
              : {}),
            ...(c.depth ? { depth: c.depth } : {}),
          });
        }}
      />
      {tool === 'volume' ? <p className="prop-empty-hint">{t('measure.props.depthHint')}</p> : null}
    </>
  );
}
