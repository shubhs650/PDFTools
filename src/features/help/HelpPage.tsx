import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import { keyLabels, shortcutText } from '../../app/keys/labels';
import { appStore } from '../../app/store/appStore';
import { msg, type MessageKey } from '../../i18n';
import { Button, Dialog } from '../../ui/components';
import { openReport } from '../report/reportStore';
import { closeHelp as close, helpStore } from './helpStore';

// Help → Help (M2-17): bundled, offline help. Everything is in the app's own
// strings (rule 11); nothing is fetched.

type HelpBody = Extract<MessageKey, `help.section.${string}.body`>;

const SECTIONS: [MessageKey, HelpBody][] = [
  [msg('help.section.start.title'), msg('help.section.start.body')],
  [msg('help.section.view.title'), msg('help.section.view.body')],
  [msg('help.section.find.title'), msg('help.section.find.body')],
  [msg('help.section.panes.title'), msg('help.section.panes.body')],
  [msg('help.section.review.title'), msg('help.section.review.body')],
  [msg('help.section.transfer.title'), msg('help.section.transfer.body')],
  [msg('help.section.measure.title'), msg('help.section.measure.body')],
  [msg('help.section.tables.title'), msg('help.section.tables.body')],
  [msg('help.section.redact.title'), msg('help.section.redact.body')],
  [msg('help.section.forms.title'), msg('help.section.forms.body')],
  [msg('help.section.save.title'), msg('help.section.save.body')],
  [msg('help.section.print.title'), msg('help.section.print.body')],
  [msg('help.section.protect.title'), msg('help.section.protect.body')],
  [msg('help.section.privacy.title'), msg('help.section.privacy.body')],
];

/** Keys named in the Help text, from the keymap and for this platform (UI04). */
function helpKeys(t: TFunction) {
  const k = (target: string) => shortcutText(target, t);
  return {
    mod: keyLabels(t).ctrl,
    open: k('file.open'),
    save: k('file.save'),
    print: k('file.print'),
    zoomIn: k('view.zoomIn'),
    zoomOut: k('view.zoomOut'),
    fitPage: k('view.fitPage'),
    fitWidth: k('view.fitWidth'),
    fullScreen: k('view.fullScreen'),
    find: k('home.find'),
    findNext: k('find.next'),
    advancedSearch: k('home.advancedSearch'),
    undo: k('qat.undo'),
    delete: k('comment.delete'),
    copy: k('edit.copy'),
    cut: k('edit.cut'),
    paste: k('edit.paste'),
    menu: k('menu.context'),
  };
}

export function HelpPage() {
  const { t } = useTranslation();
  const open = useStore(helpStore, (s) => s.open);
  if (!open) return null;
  const keys = helpKeys(t);
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
            <p>{t(body, keys)}</p>
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
