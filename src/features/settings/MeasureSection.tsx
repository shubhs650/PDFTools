import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { format, msg, type MessageKey } from '../../i18n';
import { setLoupeSettings, useLoupeSettings } from '../measure/loupeSettings';
import { LOUPE_MAGS, LOUPE_SIZE_LIST, type LoupeSize } from '../view/loupe/loupeModel';

const SIZE_NAMES: Readonly<Record<LoupeSize, MessageKey>> = {
  small: msg('settings.measure.small'),
  medium: msg('settings.measure.medium'),
  large: msg('settings.measure.large'),
};

/**
 * File → Settings → Measure (M13-02, D-68, ADR-034): the Measure loupe's size
 * and magnification, and whether picking a measuring tool turns snapping on.
 * Kept on this device; the loupe itself is switched on the Measure tab.
 */
export function MeasureSection() {
  const { t } = useTranslation();
  const s = useLoupeSettings((x) => x);
  const sizeName = useId();
  const magName = useId();
  const hint = useId();
  return (
    <div className="profile-section" data-testid="measure-section">
      <h3 className="local-data-title">{t('settings.measure.title')}</h3>
      <fieldset className="appearance-themes">
        <legend>{t('settings.measure.size')}</legend>
        {LOUPE_SIZE_LIST.map((value) => (
          <label key={value} className="scale-radio">
            <input
              type="radio"
              name={sizeName}
              value={value}
              checked={s.size === value}
              onChange={() => {
                setLoupeSettings({ size: value });
              }}
            />
            {t(SIZE_NAMES[value])}
          </label>
        ))}
      </fieldset>
      <fieldset className="appearance-themes">
        <legend>{t('settings.measure.mag')}</legend>
        {LOUPE_MAGS.map((value) => (
          <label key={value} className="scale-radio">
            <input
              type="radio"
              name={magName}
              value={value}
              checked={s.mag === value}
              onChange={() => {
                setLoupeSettings({ mag: value });
              }}
            />
            {t('settings.measure.magValue', { value: format.number(value) })}
          </label>
        ))}
      </fieldset>
      <label className="scale-radio">
        <input
          type="checkbox"
          checked={s.autoSnap}
          aria-describedby={hint}
          onChange={(e) => {
            setLoupeSettings({ autoSnap: e.currentTarget.checked });
          }}
        />
        {t('settings.measure.autoSnap')}
      </label>
      <p id={hint} className="ui-field-hint appearance-hint">
        {t('settings.measure.autoSnapHint')}
      </p>
      <p className="local-data-note">{t('settings.measure.note')}</p>
    </div>
  );
}
