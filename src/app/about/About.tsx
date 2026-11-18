// File → About (M1-26; rebuilt in M10-01, ADR-027 D-48): the product, its
// version, build and offline state, Copy version info for bug reports, links
// to Help, Report an issue, the source code (ADR-029) and Privacy, What's new (M10-08·O6), the main
// components it is built with, and every open-source package with its license text.
import { ArrowDownload20Regular } from '@fluentui/react-icons/svg/arrow-download';
import { Bug20Regular } from '@fluentui/react-icons/svg/bug';
import { CheckmarkCircle20Regular } from '@fluentui/react-icons/svg/checkmark-circle';
import { CloudOff20Regular } from '@fluentui/react-icons/svg/cloud-off';
import { Code20Regular } from '@fluentui/react-icons/svg/code';
import { Copy20Regular } from '@fluentui/react-icons/svg/copy';
import { Open20Regular } from '@fluentui/react-icons/svg/open';
import { QuestionCircle20Regular } from '@fluentui/react-icons/svg/question-circle';
import { ShieldCheckmark20Regular } from '@fluentui/react-icons/svg/shield-checkmark';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import builtWith from 'virtual:built-with';
import { openHelp } from '../../features/help/openHelp';
import { WhatsNewSection } from '../../features/whatsNew/WhatsNew';
import { useOffline, type OfflinePhase } from '../../features/offline/offline';
import { format, msg, type MessageKey } from '../../i18n';
import { Button } from '../../ui/components';
import { buttonClass } from '../../ui/components/buttonClass';
import { EXTERNAL_LINK, REPO_URL, currentIssueUrl } from '../links';
import { AppMark } from '../TopBar';
import { APP_VERSION, BUILD_DATE, versionParts } from '../version';
import { BUILT_WITH } from './components';
import { NOTICES_URL } from './licenses';
import { OpenSourceLicenses } from './OpenSourceLicenses';
import { versionInfoText } from './versionInfo';

const OFFLINE_TEXT: Record<OfflinePhase, MessageKey> = {
  ready: msg('about.offline.ready'),
  preparing: msg('about.offline.preparing'),
  failed: msg('about.offline.failed'),
  off: msg('about.offline.off'),
};

/** The backstage section the Privacy button shows. */
const PRIVACY_SECTION = 'file.privacy';

const HEADING = {
  builtWith: 'about-built-with',
  licenses: 'about-licenses',
} as const;

export interface AboutProps {
  /** Shows another backstage section (Privacy). */
  onShowSection: (id: string) => void;
}

export function About({ onShowSection }: AboutProps) {
  const { t } = useTranslation();
  const phase = useOffline((s) => s.phase);
  const progress = useOffline((s) => s.progress);
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const { version, commit } = versionParts(APP_VERSION);
  const built = BUILD_DATE ? format.date(new Date(BUILD_DATE)) : undefined;
  const offline = t(OFFLINE_TEXT[phase], { percent: format.percent(progress, 0) });

  const copy = async (): Promise<void> => {
    const text = versionInfoText(t, { full: APP_VERSION, built, offline, nav: navigator });
    try {
      await navigator.clipboard.writeText(text);
      setCopied('done');
    } catch {
      setCopied('failed');
    }
  };

  return (
    <div className="about" data-testid="about">
      <header className="about-header">
        <AppMark className="about-mark" />
        <div className="about-identity">
          <p className="about-name">{t('app.name')}</p>
          <p className="about-tagline">{t('app.description')}</p>
          <dl className="about-facts">
            <div>
              <dt>{t('about.version')}</dt>
              <dd data-testid="app-version">{version}</dd>
            </div>
            <div>
              <dt>{t('about.commit')}</dt>
              <dd data-testid="app-commit">{commit ?? t('about.unknown')}</dd>
            </div>
            <div>
              <dt>{t('about.built')}</dt>
              <dd data-testid="app-built">{built ?? t('about.unknown')}</dd>
            </div>
          </dl>
          <p
            className={`about-offline about-offline--${phase}`}
            data-testid="about-offline"
            role="status"
          >
            {phase === 'ready' ? (
              <CheckmarkCircle20Regular aria-hidden />
            ) : phase === 'off' || phase === 'failed' ? (
              <CloudOff20Regular aria-hidden />
            ) : null}
            <span>{offline}</span>
          </p>
        </div>
      </header>

      <div className="about-actions">
        <Button
          label={t('about.copy.label')}
          icon={<Copy20Regular />}
          variant="primary"
          onClick={() => {
            void copy();
          }}
        />
        <Button
          label={t('about.help')}
          icon={<QuestionCircle20Regular />}
          onClick={() => {
            openHelp();
          }}
        />
        <a
          className={buttonClass('default', 'medium', 'ui-focusable')}
          href={currentIssueUrl(t)}
          {...EXTERNAL_LINK}
        >
          <span aria-hidden="true">
            <Bug20Regular />
          </span>
          <span>{t('about.reportIssue')}</span>
        </a>
        <a
          className={buttonClass('default', 'medium', 'ui-focusable')}
          href={REPO_URL}
          data-testid="about-source"
          {...EXTERNAL_LINK}
        >
          <span aria-hidden="true">
            <Code20Regular />
          </span>
          <span>{t('about.source')}</span>
        </a>
        <Button
          label={t('about.privacy')}
          icon={<ShieldCheckmark20Regular />}
          onClick={() => {
            onShowSection(PRIVACY_SECTION);
          }}
        />
        <span className="about-copied" role="status" data-testid="about-copied">
          {copied === 'done'
            ? t('about.copy.done')
            : copied === 'failed'
              ? t('about.copy.failed')
              : ''}
        </span>
      </div>

      <WhatsNewSection />

      <section className="about-section" aria-labelledby={HEADING.builtWith}>
        <h3 id={HEADING.builtWith} className="about-section-title">
          {t('about.builtWith.title')}
        </h3>
        <ul className="about-components" data-testid="about-components">
          {BUILT_WITH.map((c) => {
            const pkg = builtWith[c.pkg];
            return (
              <li key={c.pkg} className="about-component">
                <span className="about-component-name">{t(c.name)}</span>
                <span className="about-component-role">{t(c.role)}</span>
                <span className="about-component-meta">
                  {t('about.builtWith.meta', {
                    license: c.license ?? pkg?.license ?? t('about.unknown'),
                    version: pkg?.version ?? t('about.unknown'),
                  })}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="about-section" aria-labelledby={HEADING.licenses}>
        <h3 id={HEADING.licenses} className="about-section-title">
          {t('about.licenses.title')}
        </h3>
        <p>{t('about.license')}</p>
        <p className="about-links">
          <a className="ui-focusable" href={NOTICES_URL} {...EXTERNAL_LINK}>
            <Open20Regular aria-hidden />
            <span>{t('about.notices')}</span>
          </a>
          <a className="ui-focusable" href={NOTICES_URL} download>
            <ArrowDownload20Regular aria-hidden />
            <span>{t('about.download')}</span>
          </a>
        </p>
        <OpenSourceLicenses />
      </section>
    </div>
  );
}
