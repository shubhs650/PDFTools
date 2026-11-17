import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { msg, type MessageKey } from '../../i18n';
import { recentSupported } from '../recent/recent';
import { setStartupChoice, useSession } from '../session/session';
import type { StartupChoice } from '../session/sessionModel';

const CHOICES: readonly [StartupChoice, MessageKey][] = [
  ['start', msg('settings.startup.start')],
  ['reopen', msg('settings.startup.reopen')],
];

/**
 * File → Settings → Start-up (M11-08·O2, D-53): when Triya PDF starts, show the start
 * screen (the default) or reopen the files from last time. Only where the browser keeps
 * file handles (Chromium), as Recent files.
 */
export function StartupSection() {
  const { t } = useTranslation();
  const choice = useSession((s) => s.choice);
  const name = useId();
  const hint = useId();
  if (!recentSupported()) return null;
  return (
    <div className="profile-section" data-testid="startup-section">
      <h3 className="local-data-title">{t('settings.startup.title')}</h3>
      <fieldset className="appearance-themes" aria-describedby={hint}>
        <legend>{t('settings.startup.legend')}</legend>
        {CHOICES.map(([value, label]) => (
          <label key={value} className="scale-radio">
            <input
              type="radio"
              name={name}
              value={value}
              checked={choice === value}
              onChange={() => {
                setStartupChoice(value);
              }}
            />
            {t(label)}
          </label>
        ))}
        <p id={hint} className="ui-field-hint appearance-hint">
          {t('settings.startup.hint')}
        </p>
      </fieldset>
      <p className="local-data-note">{t('settings.startup.note')}</p>
    </div>
  );
}
