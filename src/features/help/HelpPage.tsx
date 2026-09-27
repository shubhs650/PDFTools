import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import { appStore } from '../../app/store/appStore';
import { msg, type MessageKey } from '../../i18n';
import { Button, Dialog } from '../../ui/components';
import { openReport } from '../report/reportStore';
import { closeHelp as close, helpStore } from './helpStore';

// Help → Help (M2-17): bundled, offline help. Everything is in the app's own
// strings (rule 11); nothing is fetched.

const SECTIONS: [MessageKey, MessageKey][] = [
  [msg('help.section.start.title'), msg('help.section.start.body')],
  [msg('help.section.view.title'), msg('help.section.view.body')],
  [msg('help.section.find.title'), msg('help.section.find.body')],
  [msg('help.section.panes.title'), msg('help.section.panes.body')],
  [msg('help.section.forms.title'), msg('help.section.forms.body')],
  [msg('help.section.save.title'), msg('help.section.save.body')],
  [msg('help.section.print.title'), msg('help.section.print.body')],
  [msg('help.section.protect.title'), msg('help.section.protect.body')],
  [msg('help.section.privacy.title'), msg('help.section.privacy.body')],
];

export function HelpPage() {
  const { t } = useTranslation();
  const open = useStore(helpStore, (s) => s.open);
  if (!open) return null;
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) close();
      }}
      title={t('help.title')}
      description={t('help.description')}
      closeIcon={<Dismiss20Regular />}
      footer={<Button label={t('help.close')} variant="primary" onClick={close} />}
    >
      <div className="help-page" data-testid="help-page">
        {SECTIONS.map(([title, body]) => (
          <section key={title} className="help-section">
            <h3>{t(title)}</h3>
            <p>{t(body)}</p>
          </section>
        ))}
        <div className="help-actions">
          <Button
            label={t('help.shortcuts')}
            onClick={() => {
              close();
              appStore.getState().setShortcutsOpen(true);
            }}
          />
          <Button
            label={t('help.report')}
            onClick={() => {
              close();
              openReport();
            }}
          />
        </div>
      </div>
    </Dialog>
  );
}
