// "What's new" (M10-08·O6, ADR-027): the list in File › About, and the banner
// shown once after an update (whatsNew.ts decides when).
import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { Sparkle20Regular } from '@fluentui/react-icons/svg/sparkle';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { runCommand } from '../../app/commands/dispatch';
import { format } from '../../i18n';
import { Button, IconButton } from '../../ui/components';
import {
  clearWhatsNewFocus,
  dismissWhatsNew,
  releaseDate,
  releases,
  requestWhatsNewInAbout,
  useWhatsNew,
  type Release,
} from './releases';

const HEADING_ID = 'about-whats-new';
/** The command that opens File › About. */
const ABOUT = 'file.about';

function ReleaseNotes({ release, headingLevel }: { release: Release; headingLevel: 'h4' }) {
  const { t } = useTranslation();
  const Heading = headingLevel;
  return (
    <>
      <Heading className="whats-new-release-title">{release.title}</Heading>
      <p className="whats-new-release-date">
        {t('whatsNew.released', { date: format.date(releaseDate(release.date)) })}
      </p>
      <ul className="whats-new-items">
        {release.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </>
  );
}

/** File › About: the newest release in full, earlier ones folded. */
export function WhatsNewSection() {
  const { t, i18n } = useTranslation();
  const [latest, ...earlier] = releases(i18n.language);
  const focusInAbout = useWhatsNew((s) => s.focusInAbout);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!focusInAbout) return;
    // After the backstage's own focus on opening (its effect runs after this one).
    const frame = requestAnimationFrame(() => {
      clearWhatsNewFocus();
      heading.current?.scrollIntoView({ block: 'start' });
      heading.current?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [focusInAbout]);

  if (!latest) return null;
  return (
    <section
      className="about-section whats-new"
      aria-labelledby={HEADING_ID}
      data-testid="whats-new"
    >
      <h3 id={HEADING_ID} ref={heading} tabIndex={-1} className="about-section-title">
        {t('whatsNew.title')}
      </h3>
      <article className="whats-new-release" data-testid="whats-new-latest">
        <ReleaseNotes release={latest} headingLevel="h4" />
      </article>
      {earlier.length > 0 ? (
        <details className="whats-new-earlier" data-testid="whats-new-earlier">
          <summary className="ui-focusable">{t('whatsNew.earlier')}</summary>
          {earlier.map((r) => (
            <article key={r.id} className="whats-new-release">
              <ReleaseNotes release={r} headingLevel="h4" />
            </article>
          ))}
        </details>
      ) : null}
    </section>
  );
}

/**
 * Shown once after an update, at the bottom right over the document area: it
 * takes no room in the layout and no focus. "See what's new" opens File ›
 * About at the list; Close dismisses it.
 */
export function WhatsNewBanner() {
  const { t, i18n } = useTranslation();
  const shown = useWhatsNew((s) => s.banner);
  const release = shown ? releases(i18n.language).find((r) => r.id === shown) : undefined;
  return (
    // Always mounted, so screen readers hear the banner when it appears.
    <div className="whats-new-banner-region" aria-live="polite">
      {release ? (
        <section
          className="whats-new-banner"
          aria-labelledby="whats-new-banner-title"
          data-testid="whats-new-banner"
        >
          <span className="whats-new-banner-icon" aria-hidden="true">
            <Sparkle20Regular />
          </span>
          <div className="whats-new-banner-text">
            <h2 id="whats-new-banner-title" className="whats-new-banner-title">
              {t('whatsNew.banner.title')}
            </h2>
            <p className="whats-new-banner-release">{release.title}</p>
            <div className="whats-new-banner-actions">
              <Button
                label={t('whatsNew.banner.see')}
                variant="primary"
                size="small"
                onClick={() => {
                  requestWhatsNewInAbout();
                  void runCommand(ABOUT);
                }}
              />
            </div>
          </div>
          <IconButton
            label={t('whatsNew.banner.dismiss')}
            icon={<Dismiss20Regular />}
            size="small"
            className="whats-new-banner-close"
            onClick={dismissWhatsNew}
          />
        </section>
      ) : null}
    </div>
  );
}
