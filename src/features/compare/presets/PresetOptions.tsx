import { ChevronDown20Regular } from '@fluentui/react-icons/svg/chevron-down';
import { ChevronRight20Regular } from '@fluentui/react-icons/svg/chevron-right';
import { Delete20Regular } from '@fluentui/react-icons/svg/delete';
import type { TFunction } from 'i18next';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { recordError } from '../../../app/diagnostics';
import { format, msg, type MessageKey } from '../../../i18n';
import type { Sensitivity } from '../../../model/compare/detect/entries';
import { presetsFor, type ComparePreset } from '../../../model/compare/presets';
import { IconButton } from '../../../ui/components';
import type { Comparison } from '../model';
import {
  CARRIED_PRESET,
  DEFAULT_PRESET,
  carriedFor,
  deletePreset,
  loadPresets,
  pickPreset,
  pickedPreset,
  usePresets,
} from './presetStore';

const SENSITIVITY: Record<Sensitivity, MessageKey> = {
  low: msg('compare.register.sensitivity_low'),
  normal: msg('compare.register.sensitivity_normal'),
  high: msg('compare.register.sensitivity_high'),
};

/** What a preset sets, in a line. */
function summaryOf(t: TFunction, p: ComparePreset): string {
  const yesNo = (on: boolean): string =>
    on ? t('compare.register.yes') : t('compare.register.no');
  if (p.type === 'text')
    return t('compare.presets.summary_text', {
      headers: yesNo(p.text.headersFooters),
      renumbering: yesNo(p.text.renumbering),
    });
  const o = p.overlay;
  return t('compare.presets.summary_overlay', {
    sensitivity: t(SENSITIVITY[o.sensitivity]),
    size:
      o.minSize === 0
        ? t('compare.diff.minSize_off')
        : t('compare.diff.minSize_mm', { size: format.number(o.minSize, 1) }),
    zones: format.number(o.zones.length),
  });
}

/**
 * The input window's Options (M12-21, D-58, Q35): collapsed at first; the
 * named presets of this comparison type, saved from results on this device.
 * The preset picked is applied when Compare runs; it can be deleted here.
 */
export function PresetOptions({ comparison: c }: { comparison: Comparison }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const bodyId = useId();
  const selectId = useId();
  const loaded = usePresets((s) => s.loaded);
  const all = usePresets((s) => s.presets);
  const picked = usePresets((s) => pickedPreset(s, c.id));
  // New comparison (M12-24): the earlier result's settings, offered first.
  const carried = usePresets((s) => carriedFor(s, c.id, c.type));
  useEffect(() => {
    if (!loaded) void loadPresets();
  }, [loaded]);
  const presets = presetsFor(all, c.type);
  const preset =
    picked === CARRIED_PRESET
      ? carried && { ...carried, name: t('compare.presets.carried') }
      : (presets.find((p) => p.id === picked) ?? null);
  const saved = preset !== null && preset.id !== CARRIED_PRESET;
  const remove = async (): Promise<void> => {
    if (!preset || !saved) return;
    try {
      await deletePreset(preset.id);
      setNotice(t('compare.presets.deleted', { name: preset.name }));
    } catch (err) {
      recordError('compare.presets', err);
    }
  };
  return (
    <section className="compare-options" data-testid="compare-options">
      <h3 className="compare-options-title">
        <button
          type="button"
          className="compare-options-toggle ui-focusable"
          aria-expanded={open}
          aria-controls={bodyId}
          data-testid="compare-options-toggle"
          onClick={() => {
            setOpen((o) => !o);
          }}
        >
          {open ? <ChevronDown20Regular aria-hidden /> : <ChevronRight20Regular aria-hidden />}
          <span>{t('compare.presets.options')}</span>
          {preset ? <span className="compare-options-picked">{preset.name}</span> : null}
        </button>
      </h3>
      {open ? (
        <div id={bodyId} className="compare-options-body">
          <div className="compare-options-row">
            <label htmlFor={selectId} className="ui-field-label">
              {t('compare.presets.preset')}
            </label>
            <select
              id={selectId}
              className="ui-field-input"
              data-testid="compare-preset"
              value={preset ? preset.id : DEFAULT_PRESET}
              onChange={(e) => {
                setNotice(null);
                pickPreset(c.id, e.currentTarget.value);
              }}
            >
              <option value={DEFAULT_PRESET}>{t('compare.presets.default')}</option>
              {carried ? (
                <option value={CARRIED_PRESET}>{t('compare.presets.carried')}</option>
              ) : null}
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <IconButton
              label={t('compare.presets.delete')}
              icon={<Delete20Regular />}
              disabled={!saved}
              onClick={() => {
                void remove();
              }}
            />
          </div>
          {preset ? (
            <>
              {preset.type === 'overlay' ? (
                <p className="compare-options-colours">
                  <Swatch colour={preset.overlay.colA} label={t('compare.presets.colourA')} />
                  <Swatch colour={preset.overlay.colB} label={t('compare.presets.colourB')} />
                </p>
              ) : null}
              <p className="compare-options-note" data-testid="compare-preset-summary">
                {summaryOf(t, preset)} {t('compare.presets.applies')}
              </p>
            </>
          ) : presets.length === 0 && !carried ? (
            <p className="compare-options-note">{t('compare.presets.none')}</p>
          ) : null}
          {notice ? (
            <p className="compare-options-note" role="status">
              {notice}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** A colour of the preset next to its side's name (the name is what is read out). */
function Swatch({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="compare-options-swatch">
      <span className="compare-options-chip" style={{ background: colour }} aria-hidden="true" />
      {label}
    </span>
  );
}
