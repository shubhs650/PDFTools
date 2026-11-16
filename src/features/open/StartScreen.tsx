import { DocumentPdf28Regular } from '@fluentui/react-icons/svg/document-pdf';
import { ShieldCheckmark16Regular } from '@fluentui/react-icons/svg/shield-checkmark';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { runCommand } from '../../app/commands/dispatch';
import { shortcutText } from '../../app/keys/labels';
import { msg, type MessageKey } from '../../i18n';
import { buttonClass } from '../../ui/components/buttonClass';
import { CommandIcon } from '../../ui/icons/CommandIcon';
import { openHelp } from '../help/openHelp';
import { RecentList } from '../recent/RecentList';
import { useDragOver } from './dragStore';

const OPEN = 'file.open';

interface QuickAction {
  id: string;
  /** Command whose icon the tile shows. */
  icon: string;
  label: MessageKey;
  detail: MessageKey;
  run: () => void;
}

/** The start screen's quick actions: commands that work with no document open. */
const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    // Create Blank PDF (M10-08·O4, D-49).
    id: 'new',
    icon: 'file.new',
    label: msg('open.start.actions.new'),
    detail: msg('open.start.actions.newDetail'),
    run: () => {
      void runCommand('file.new');
    },
  },
  {
    id: 'merge',
    icon: 'organize.merge',
    label: msg('open.start.actions.merge'),
    detail: msg('open.start.actions.mergeDetail'),
    run: () => {
      void runCommand('organize.merge');
    },
  },
  {
    id: 'help',
    icon: 'help.help',
    label: msg('open.start.actions.help'),
    detail: msg('open.start.actions.helpDetail'),
    run: () => {
      openHelp('welcome');
    },
  },
  {
    id: 'shortcuts',
    icon: 'help.shortcuts',
    label: msg('open.start.actions.shortcuts'),
    detail: msg('open.start.actions.shortcutsDetail'),
    run: () => {
      void runCommand('help.shortcuts');
    },
  },
];

/**
 * Shown when no document is open (§8, M10-05): a drop card with Open…, quick
 * actions that work without a document, and Recent files. The drop card
 * highlights while files are dragged over the window (DropZone).
 */
export function StartScreen() {
  const { t } = useTranslation();
  const over = useDragOver();
  const keys = shortcutText(OPEN, t);
  return (
    <section className="start-screen" aria-labelledby="start-title" data-testid="start-screen">
      <div className="start-column">
        <div className="start-drop" data-testid="start-drop" data-over={over ? '' : undefined}>
          <span className="start-badge start-badge--large" aria-hidden="true">
            <DocumentPdf28Regular />
          </span>
          <h2 id="start-title">{t('open.start.title')}</h2>
          <p className="start-hint">{over ? t('open.dropHint') : t('open.start.hint')}</p>
          <button
            type="button"
            className={buttonClass('primary', undefined, 'start-open')}
            onClick={() => {
              void runCommand(OPEN);
            }}
          >
            <span aria-hidden="true">
              <CommandIcon id={OPEN} />
            </span>
            <span>{t('open.start.open')}</span>
            {keys ? (
              <kbd className="start-open-keys" aria-hidden="true">
                {keys}
              </kbd>
            ) : null}
          </button>
          <p className="start-privacy">
            <ShieldCheckmark16Regular aria-hidden="true" />
            <span>{t('open.start.privacy')}</span>
          </p>
        </div>
        <QuickActions />
        <RecentList variant="card" />
      </div>
    </section>
  );
}

function QuickActions() {
  const { t } = useTranslation();
  const base = useId();
  return (
    <ul className="start-actions" aria-label={t('open.start.actions.title')}>
      {QUICK_ACTIONS.map((a) => (
        <li key={a.id}>
          <button
            type="button"
            className="start-action ui-focusable"
            aria-labelledby={`${base}-${a.id}`}
            aria-describedby={`${base}-${a.id}-detail`}
            onClick={a.run}
          >
            <span className="start-badge" aria-hidden="true">
              <CommandIcon id={a.icon} />
            </span>
            <span className="start-action-text">
              <span id={`${base}-${a.id}`} className="start-action-label">
                {t(a.label)}
              </span>
              <span id={`${base}-${a.id}-detail`} className="start-action-detail">
                {t(a.detail)}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
