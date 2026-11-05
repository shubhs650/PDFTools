import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { setTheme, useTheme, type Theme } from '../../app/theme';
import { msg, type MessageKey } from '../../i18n';

const THEMES: readonly [Theme, MessageKey][] = [
  ['light', msg('settings.appearance.light')],
  ['dark', msg('settings.appearance.dark')],
];

/** File → Settings → Appearance (M7-11, ADR-023 D-42): light or dark theme. */
export function AppearanceSection() {
  const { t } = useTranslation();
  const theme = useTheme();
  const name = useId();
  return (
    <div className="profile-section" data-testid="appearance-section">
      <h3 className="local-data-title">{t('settings.appearance.title')}</h3>
      <fieldset className="appearance-themes">
        <legend>{t('settings.appearance.theme')}</legend>
        {THEMES.map(([value, label]) => (
          <label key={value} className="scale-radio">
            <input
              type="radio"
              name={name}
              value={value}
              checked={theme === value}
              onChange={() => {
                setTheme(value);
              }}
            />
            {t(label)}
          </label>
        ))}
      </fieldset>
      <p className="local-data-note">{t('settings.appearance.note')}</p>
    </div>
  );
}
