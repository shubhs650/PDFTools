import * as RadixDialog from '@radix-ui/react-dialog';
import { ArrowLeft20Regular } from '@fluentui/react-icons/svg/arrow-left';
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { msg, type MessageKey } from '../../i18n';
import { CommandIcon } from '../../ui/icons/CommandIcon';
import { commandLabelKey } from '../commandLabels';
import { ribbonLayout } from '../ribbon/layout';
import { RecentList } from '../../features/recent/RecentList';
import { LocalData } from '../../features/settings/LocalData';
import { About, Privacy } from './AboutPrivacy';
import { Properties } from './Properties';
import { RibbonButton } from '../ribbon/RibbonButton';

/** One description per backstage section (content arrives with each feature task). */
const DESCRIPTIONS: Record<string, MessageKey> = {
  'file.open': msg('backstage.section.open'),
  'file.recent': msg('backstage.section.recent'),
  'file.save': msg('backstage.section.save'),
  'file.saveAs': msg('backstage.section.saveAs'),
  'file.saveOptimized': msg('backstage.section.saveOptimized'),
  'file.print': msg('backstage.section.print'),
  'file.properties': msg('backstage.section.properties'),
  'file.settings': msg('backstage.section.settings'),
  'file.about': msg('backstage.section.about'),
  'file.privacy': msg('backstage.section.privacy'),
};

const TEST_ID = 'backstage';
const HEADING_ID = 'backstage-heading';

export interface BackstageProps {
  open: boolean;
  /** Section to show when it opens (a command id, e.g. `file.settings`); the first otherwise. */
  section?: string;
  onOpenChange: (open: boolean) => void;
}

/**
 * File backstage (§8): a full-window modal with a section list on the left.
 * Focus is trapped while open; Esc or "Back" closes it and returns focus to
 * the File button (Radix Dialog). Section content is filled by later tasks
 * (open M1-13, recent M1-18, save M1-22/23, settings, about and privacy M1-26).
 */
export function Backstage({ open, section: initial, onOpenChange }: BackstageProps) {
  const { t } = useTranslation();
  const sections = useMemo(() => ribbonLayout().backstage, []);
  const [current, setCurrent] = useState(0);
  // Each opening starts at the requested section (or keeps the last one).
  const [shownFor, setShownFor] = useState<string | undefined>(undefined);
  const want = open ? initial : undefined;
  if (want !== shownFor) {
    setShownFor(want);
    const i = sections.findIndex((c) => c.id === want);
    if (i >= 0) setCurrent(i);
  }
  const navRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const section = sections[current];
  // Focus goes back to whatever opened the backstage (the File button), as in
  // ui/components/Dialog: Radix only restores focus for its own Trigger.
  const returnTo = useRef<HTMLElement | null>(null);

  const onNavKey = (e: KeyboardEvent, i: number): void => {
    const n = sections.length;
    const to: Record<string, number> = {
      ArrowDown: (i + 1) % n,
      ArrowUp: (i - 1 + n) % n,
      Home: 0,
      End: n - 1,
    };
    const next = to[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setCurrent(next);
    navRefs.current[next]?.focus();
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Content
          className="backstage"
          aria-describedby={undefined}
          data-testid={TEST_ID}
          onOpenAutoFocus={() => {
            const active = document.activeElement;
            returnTo.current = active instanceof HTMLElement ? active : null;
          }}
          onCloseAutoFocus={(e) => {
            const el = returnTo.current;
            if (el?.isConnected) {
              e.preventDefault();
              el.focus();
            }
          }}
        >
          <RadixDialog.Title className="ui-visually-hidden">
            {t('backstage.label')}
          </RadixDialog.Title>
          <nav aria-label={t('backstage.nav')} className="backstage-nav">
            <RadixDialog.Close asChild>
              <button type="button" className="backstage-back ui-focusable">
                <ArrowLeft20Regular aria-hidden />
                <span>{t('backstage.back')}</span>
              </button>
            </RadixDialog.Close>
            <ul className="backstage-list">
              {sections.map((c, i) => (
                <li key={c.id}>
                  <button
                    ref={(el) => {
                      navRefs.current[i] = el;
                    }}
                    type="button"
                    className="backstage-item ui-focusable"
                    aria-current={i === current ? 'page' : undefined}
                    tabIndex={i === current ? 0 : -1}
                    onClick={() => {
                      setCurrent(i);
                    }}
                    onKeyDown={(e) => {
                      onNavKey(e, i);
                    }}
                  >
                    <CommandIcon id={c.id} />
                    <span>{t(commandLabelKey(c.id))}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          {section ? (
            <section className="backstage-content" aria-labelledby={HEADING_ID}>
              <h2 id={HEADING_ID} className="backstage-heading">
                {t(commandLabelKey(section.id))}
              </h2>
              <p className="backstage-description">
                {t(DESCRIPTIONS[section.id] ?? msg('backstage.label'))}
              </p>
              {section.id === 'file.recent' ? (
                <RecentList
                  labelledBy={HEADING_ID}
                  onOpened={() => {
                    onOpenChange(false);
                  }}
                />
              ) : section.id === 'file.properties' ? (
                <Properties />
              ) : section.id === 'file.settings' ? (
                <LocalData />
              ) : section.id === 'file.about' ? (
                <About />
              ) : section.id === 'file.privacy' ? (
                <Privacy />
              ) : (
                <RibbonButton
                  command={section}
                  large
                  tabIndex={0}
                  onRan={() => {
                    onOpenChange(false);
                  }}
                />
              )}
            </section>
          ) : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
