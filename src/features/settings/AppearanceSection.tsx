import { useId, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ACCENTS,
  setAccent,
  setTheme,
  useAccent,
  useTheme,
  type Accent,
  type Theme,
} from '../../app/theme';
import { msg, type MessageKey } from '../../i18n';

const THEMES: readonly [Theme, MessageKey][] = [
  ['light', msg('settings.appearance.light')],
  ['dark', msg('settings.appearance.dark')],
];

const ACCENT_NAMES: Readonly<Record<Accent, MessageKey>> = {
  blue: msg('settings.appearance.accentBlue'),
  teal: msg('settings.appearance.accentTeal'),
  indigo: msg('settings.appearance.accentIndigo'),
  graphite: msg('settings.appearance.accentGraphite'),
};

/**
 * File → Settings → Appearance (M7-11, ADR-023 D-42): light or dark theme, and
 * the accent colour (ADR-027 D-47, M10 O7). The accents are radio buttons drawn
 * as colour swatches, as in the colour picker's grid: the current one has a
 * ring, arrows move between them, and each has its name beside it.
 */
export function AppearanceSection() {
  const { t } = useTranslation();
  const theme = useTheme();
  const accent = useAccent();
  const name = useId();
  const accentName = useId();
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
      <fieldset className="appearance-themes appearance-accents" data-testid="accent-choice">
        <legend>{t('settings.appearance.accent')}</legend>
        {ACCENTS.map((value) => (
          <label key={value} className="appearance-accent">
            <input
              type="radio"
              className="appearance-accent-input"
              name={accentName}
              value={value}
              checked={accent === value}
              onChange={() => {
                setAccent(value);
              }}
            />
            <span
              className="appearance-accent-swatch"
              style={{ '--swatch': `var(--accent-swatch-${value})` } as CSSProperties}
              aria-hidden="true"
            />
            {t(ACCENT_NAMES[value])}
          </label>
        ))}
      </fieldset>
      <p className="local-data-note">{t('settings.appearance.note')}</p>
    </div>
  );
}
