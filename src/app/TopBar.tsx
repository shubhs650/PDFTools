// Top bar (M6-01, ADR-021 D-35): the product mark and name at the left of the
// quick access row, and at the right end of the ribbon's tab row the theme
// toggle (M7-11, ADR-023 D-42), the OpenEngTools home link, the GitHub issue
// link and the full-screen button.
import { WeatherSunny20Regular } from '@fluentui/react-icons/svg/weather-sunny';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '../ui/components';
import { CommandIcon } from '../ui/icons/CommandIcon';
import { commandLabelKey } from './commandLabels';
import { runCommand } from './commands/dispatch';
import { useCommandState } from './commands/useCommandState';
import { useFullScreen } from './fullScreen';
import { EXTERNAL_LINK, OPENENGTOOLS_URL, currentIssueUrl } from './links';
import { shortcutText } from './keys/labels';
import { useTheme } from './theme';

/**
 * The app icon (public/icons/icon.svg, our own artwork, rule 15) drawn inline,
 * so showing it costs no request. tests/app/topBar.test.tsx keeps it equal to
 * the file.
 */
export function AppMark({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      aria-hidden="true"
      focusable="false"
      {...(className ? { className } : {})}
    >
      <rect width="512" height="512" rx="112" fill="#0f6cbd" />
      <path
        d="M152 88h148l92 92v244a24 24 0 0 1-24 24H152a24 24 0 0 1-24-24V112a24 24 0 0 1 24-24z"
        fill="#ffffff"
      />
      <path d="M300 88v68a24 24 0 0 0 24 24h68z" fill="#b4d6fa" />
      <path d="M176 248h160M176 296h112" stroke="#0f6cbd" strokeWidth="20" strokeLinecap="round" />
      <path
        d="M176 364h160M176 344v40M336 344v40"
        stroke="#0f6cbd"
        strokeWidth="12"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The visual product name. It is also the page's heading (the `h1` screen
 * readers used before M6-01), with the mark decorative beside it.
 */
export function Brand() {
  const { t } = useTranslation();
  return (
    <div className="app-brand" data-testid="app-brand">
      <AppMark className="app-brand-mark" />
      <h1 className="app-brand-name">{t('app.name')}</h1>
    </div>
  );
}

function TopBarLink({ id, href }: { id: string; href: string }) {
  const { t } = useTranslation();
  const label = t(commandLabelKey(id));
  return (
    <Tooltip content={label}>
      <a
        className="top-bar-button ui-focusable"
        href={href}
        aria-label={label}
        data-command={id}
        {...EXTERNAL_LINK}
      >
        <CommandIcon id={id} className="top-bar-icon" />
      </a>
    </Tooltip>
  );
}

function FullScreenButton() {
  const { t } = useTranslation();
  const on = useFullScreen();
  const state = useCommandState('view.fullScreen');
  const id = on ? 'view.exitFullScreen' : 'view.fullScreen';
  const label = t(commandLabelKey(id));
  const reason = state.enabled ? null : t(state.reason);
  return (
    <Tooltip content={reason ? `${label} — ${reason}` : label}>
      <button
        type="button"
        className="top-bar-button ui-focusable"
        aria-label={label}
        aria-disabled={reason ? true : undefined}
        data-command="view.fullScreen"
        data-testid="full-screen"
        onClick={() => {
          void runCommand(id);
        }}
      >
        <CommandIcon id={id} className="top-bar-icon" />
      </button>
    </Tooltip>
  );
}

/**
 * Light / dark theme (M7-11, D-42): a toggle named "Dark Theme", pressed in
 * dark. The moon offers dark; in dark the sun offers light again.
 */
function ThemeButton() {
  const { t } = useTranslation();
  const dark = useTheme() === 'dark';
  const label = t(commandLabelKey('view.darkTheme'));
  const keys = shortcutText('view.darkTheme', t);
  return (
    <Tooltip content={keys ? t('ribbon.withShortcut', { label, keys }) : label}>
      <button
        type="button"
        className="top-bar-button ui-focusable"
        aria-label={label}
        aria-pressed={dark}
        data-command="view.darkTheme"
        data-testid="theme-toggle"
        onClick={() => {
          void runCommand('view.darkTheme');
        }}
      >
        {dark ? (
          <WeatherSunny20Regular aria-hidden className="top-bar-icon" />
        ) : (
          <CommandIcon id="view.darkTheme" className="top-bar-icon" />
        )}
      </button>
    </Tooltip>
  );
}

/** The right end of the ribbon's tab row: theme, home, report an issue, full screen. */
export function TopBarActions() {
  const { t } = useTranslation();
  return (
    <div className="top-bar-actions" role="group" aria-label={t('topBar.label')}>
      <ThemeButton />
      <TopBarLink id="app.home" href={OPENENGTOOLS_URL} />
      {/* Version, browser and OS only (rule 10); they do not change while the app runs. */}
      <TopBarLink id="app.reportIssue" href={currentIssueUrl(t)} />
      <FullScreenButton />
    </div>
  );
}
